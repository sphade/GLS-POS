import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, type Device } from "react-native-ble-plx";
import BluetoothClassic from "react-native-bluetooth-classic";
import { Buffer } from "buffer";
import { metaGet, metaSet } from "./db";
import { buildReceiptBytes } from "./receipt-print";
import type { Receipt } from "./cart";
import { EscPosBuilder, type PaperWidth } from "./escpos";

/**
 * Bluetooth transports for ESC/POS thermal printers.
 *
 * Two kinds of Bluetooth exist on these printers, and the app now drives BOTH:
 *  - **BLE (Bluetooth Low Energy)** via react-native-ble-plx: find a writable
 *    characteristic and push receipt bytes in small chunks.
 *  - **Bluetooth Classic / SPP** via react-native-bluetooth-classic: many
 *    cheap printers (and most manufacturer-bonded ones) are Classic-only and
 *    NEVER appear in a BLE scan. For those we read the phone's system-paired
 *    device list instead — pairing once in Android settings is enough — and
 *    print over an RFCOMM socket.
 *
 * Printer state (chosen device, transport, paper width) persists so the app
 * reconnects without asking again.
 */

type ClassicConnection = { write(data: string, encoding?: string): Promise<boolean>; disconnect(): Promise<void> };

/**
 * Minimal structural typing over the native module: its bundled TS definitions
 * have drifted across versions, so we pin only what we call — using the
 * current documented API (adapter.getBondedDevices, device.connect/write).
 */
const classic = BluetoothClassic as unknown as {
  isBluetoothEnabled(): Promise<boolean>;
  requestBluetoothEnabled(): Promise<boolean>;
  getBondedDevices(): Promise<ClassicDevice[]>;
  connectToDevice(
    id: string,
    options?: Record<string, unknown>,
  ): Promise<ClassicConnection & Record<string, unknown>>;
  disconnectFromDevice?(id: string): Promise<unknown> | void;
};

type ClassicDevice = { id?: string; name?: string; address: string };

/** Fails loudly-but-readably if the native module isn't in this build. */
function requireClassicFn<K extends keyof typeof classic>(name: K): NonNullable<typeof classic[K]> {
  if (!classic || typeof classic !== "object") {
    throw new Error(
      "Bluetooth Classic isn't available in this app build. Rebuild the app with react-native-bluetooth-classic installed.",
    );
  }
  const fn = classic[name];
  if (typeof fn !== "function") {
    throw new Error(
      "Bluetooth Classic isn't available in this app build. Rebuild the app with react-native-bluetooth-classic installed.",
    );
  }
  return fn as NonNullable<typeof classic[K]>;
}

const DEVICE_KEY = "printer_device_id";
const NAME_KEY = "printer_device_name";
const PAPER_KEY = "printer_paper_width";
const TRANSPORT_KEY = "printer_transport";

/** BLE caps each write; most printers accept 180–240 bytes per packet. */
const CHUNK = 180;
/** SPP sockets take larger writes than BLE characteristics. */
const CLASSIC_CHUNK = 512;

let manager: BleManager | null = null;
function ble(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

/** Classic/SPP printing is an Android capability (iOS needs MFi hardware). */
export function isClassicSupported(): boolean {
  return Platform.OS === "android";
}

export type PrinterTransport = "ble" | "classic";
export type SavedPrinter = { id: string; name: string; paper: PaperWidth; transport: PrinterTransport };

export function getSavedPrinter(): SavedPrinter | null {
  const id = metaGet(DEVICE_KEY);
  if (!id) return null;
  return {
    id,
    name: metaGet(NAME_KEY) ?? "Printer",
    paper: (Number(metaGet(PAPER_KEY)) === 80 ? 80 : 58) as PaperWidth,
    transport: metaGet(TRANSPORT_KEY) === "classic" ? "classic" : "ble",
  };
}

export function savePrinter(p: SavedPrinter): void {
  metaSet(DEVICE_KEY, p.id);
  metaSet(NAME_KEY, p.name);
  metaSet(PAPER_KEY, String(p.paper));
  metaSet(TRANSPORT_KEY, p.transport ?? "ble");
}

export function forgetPrinter(): void {
  metaSet(DEVICE_KEY, "");
  metaSet(NAME_KEY, "");
  metaSet(TRANSPORT_KEY, "");
}

/** Android needs runtime location/BT permissions before it will scan. */
export async function ensureBlePermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const needed =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(needed);
  return needed.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/**
 * Scan for nearby BLE devices for `ms`, returning anything with a name.
 * We don't filter by service UUID: thermal printers advertise a grab-bag of
 * vendor UUIDs, so it's more reliable to list everything and let the user pick.
 */
export async function scanForPrinters(
  ms = 6000,
  onFound?: (d: { id: string; name: string }) => void,
): Promise<{ id: string; name: string }[]> {
  const ok = await ensureBlePermissions();
  if (!ok) throw new Error("Bluetooth permission denied");

  const found = new Map<string, { id: string; name: string }>();

  await new Promise<void>((resolve, reject) => {
    ble().startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        ble().stopDeviceScan();
        reject(new Error(error.message));
        return;
      }
      const name = device?.name ?? device?.localName;
      if (device && name && !found.has(device.id)) {
        const entry = { id: device.id, name };
        found.set(device.id, entry);
        onFound?.(entry);
      }
    });
    setTimeout(() => {
      ble().stopDeviceScan();
      resolve();
    }, ms);
  });

  return [...found.values()];
}

/**
 * Find a characteristic we can write to. Printers vary wildly in which service
 * they expose, so we walk everything and take the first writable one.
 */
async function findWritable(device: Device) {
  const ready = await device.discoverAllServicesAndCharacteristics();
  for (const service of await ready.services()) {
    for (const ch of await service.characteristics()) {
      if (ch.isWritableWithResponse || ch.isWritableWithoutResponse) {
        return ch;
      }
    }
  }
  return null;
}

/**
 * List the phone's system-paired Bluetooth devices.
 *
 * This is how every shop-floor printer app works: the printer is (or becomes)
 * paired in Android settings — sometimes permanently bonded by the
 * manufacturer — and bonded devices do NOT reliably appear in discovery
 * scans. Reading the bond table instead is instant, works offline, and needs
 * no location permission. Each entry can be printed to over an SPP socket.
 */
export async function listBondedPrinters(): Promise<Array<{ id: string; name: string }>> {
  if (!isClassicSupported()) return [];

  const ok = await ensureBlePermissions();
  if (!ok) throw new Error("Bluetooth permission denied");

  const getBondedDevices = requireClassicFn("getBondedDevices");

  // Skip the isBluetoothEnabled / requestBluetoothEnabled pre-checks: those
  // methods are unreliable on many Android devices and report "off" when
  // Bluetooth is clearly on. Just call getBondedDevices directly — if BT is
  // truly disabled, the native module throws with an accurate message.
  let devices: ClassicDevice[];
  try {
    devices = await getBondedDevices.call(classic);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.toLowerCase().includes("bluetooth") && msg.toLowerCase().includes("off")) {
      throw new Error(
        "Bluetooth is turned off. Enable Bluetooth in your phone's settings, then try again.",
      );
    }
    throw e;
  }
  return devices
    .filter((d) => !!d.name && d.name.trim().length > 0)
    .map((d) => ({ id: d.address || d.id || d.name!, name: d.name! }));
}

/**
 * Send raw ESC/POS bytes over a Bluetooth Classic SPP socket, chunked like the
 * BLE path — thermal printers still have small buffers.
 */
async function printViaClassic(bytes: Uint8Array, saved: SavedPrinter): Promise<void> {
  const ok = await ensureBlePermissions();
  if (!ok) throw new Error("Bluetooth permission denied");

  const connectToDevice = requireClassicFn("connectToDevice");

  let connection: ClassicConnection;
  try {
    connection = await connectToDevice.call(classic, saved.id);
  } catch (e) {
    if ((e as Error).message.startsWith("Bluetooth Classic isn't")) throw e;
    throw new Error(`Could not connect to ${saved.name}. Is it on, paired, and in range?`);
  }

  try {
    for (let i = 0; i < bytes.length; i += CLASSIC_CHUNK) {
      const b64 = Buffer.from(bytes.slice(i, i + CLASSIC_CHUNK)).toString("base64");
      await connection.write(b64, "base64");
      await new Promise((r) => setTimeout(r, 20));
    }
  } finally {
    // Release the socket so the next print (or another till) can use it.
    try {
      await connection.disconnect();
    } catch {
      try {
        await classic.disconnectFromDevice?.(saved.id);
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * Send raw ESC/POS bytes to the saved printer, choosing the transport it was
 * saved with.
 *
 * BLE writes go in small chunks with a short gap: thermal printers have tiny
 * buffers and silently drop data (or print garbage) if you push a whole
 * receipt at once.
 */
export async function printBytes(bytes: Uint8Array): Promise<void> {
  const saved = getSavedPrinter();
  if (!saved) throw new Error("No printer paired yet. Set one up in Printer Setup.");

  if (saved.transport === "classic") {
    await printViaClassic(bytes, saved);
    return;
  }

  const ok = await ensureBlePermissions();
  if (!ok) throw new Error("Bluetooth permission denied");

  let device: Device;
  try {
    device = await ble().connectToDevice(saved.id, { timeout: 10000 });
  } catch {
    throw new Error(`Could not connect to ${saved.name}. Is it on and in range?`);
  }

  try {
    const ch = await findWritable(device);
    if (!ch) throw new Error(`${saved.name} has no writable channel (it may be Bluetooth Classic — pair it in Android settings, then pick it under PAIRED DEVICES).`);

    const withResponse = ch.isWritableWithResponse;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.slice(i, i + CHUNK);
      const b64 = Buffer.from(slice).toString("base64");
      if (withResponse) await ch.writeWithResponse(b64);
      else await ch.writeWithoutResponse(b64);
      await new Promise((r) => setTimeout(r, 25));
    }
  } finally {
    // Always release the connection so the next print (or another till) can use it.
    await device.cancelConnection().catch(() => {});
  }
}

/** Print a receipt on the paired thermal printer. */
export async function printReceipt(receipt: Receipt): Promise<void> {
  const paper = getSavedPrinter()?.paper ?? 58;
  await printBytes(buildReceiptBytes(receipt, paper));
}

/** Print a short test slip so the user can confirm pairing worked. */
export async function printTest(): Promise<void> {
  const paper = getSavedPrinter()?.paper ?? 58;
  const b = new EscPosBuilder(paper);
  b.align("center").big(true).bold(true).line("GLS POS").big(false).bold(false);
  b.line("Printer test").rule();
  b.align("left").keyValue("Paper", `${paper}mm`);
  b.keyValue("Chars/line", String(b.width));
  b.keyValue("Time", new Date().toLocaleString());
  b.rule().align("center").line("If you can read this,").line("printing works.").feed(3).cut();
  await printBytes(b.build());
}
