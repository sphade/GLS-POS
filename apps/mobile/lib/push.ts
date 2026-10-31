import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import {
  API_URL,
  captureBoundAuthCredential,
  isExactCurrentAuthCredential,
  type BoundAuthCredential,
} from "./auth-client";
import { OFFLINE_MODE } from "./offline";

/**
 * Expo push notifications, so staff are alerted to a VIP order even when the
 * app is closed or the phone is locked.
 *
 * The in-app chime (lib/feedback) and the realtime WebSocket cover the app-open
 * case; this is the fallback for a phone in someone's pocket.
 *
 * Requires an EAS project id (app.json → expo.extra.eas.projectId). Without it
 * Expo can't issue a token, so registration is skipped and the app carries on
 * with the other two alert paths.
 */

/**
 * Channel ids shared with the server (`push.service.ts`). They must match, or
 * Android silently falls back to a default channel — and a default channel
 * means the system tone, which is the thing this exists to avoid.
 */
const VIP_CHANNEL_ID = "vip-orders-v2";
const STORE_CHANNEL_ID = "vip-orders";
/** Android raw resource bundled by app.json → expo-notifications.sounds. */
const VIP_SOUND_FILE = "vip_order.wav";

/** Show an alert even when the app is foregrounded. */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // A VIP order already rings the ten-second in-app alarm, so the push tone
    // would only fight it. Stock and low-stock alerts have no in-app sound, so
    // they keep the notification tone.
    const kind = notification.request.content.data?.kind;
    return {
      shouldShowAlert: true,
      shouldPlaySound: kind !== "web_order",
      shouldSetBadge: true,
    };
  },
});

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
}

/**
 * Android needs an explicit high-importance channel to make sound on the lock
 * screen, and the sound is a property of the channel, not the notification.
 *
 * VIP orders get their own channel so they ring the shop's chime instead of the
 * phone's email tone — and so staff can mute stock alerts without also muting
 * guest orders. The channel id is new (`-v2`) because Android freezes a
 * channel's sound once it exists: the original `vip-orders` channel was created
 * with the default tone and can never be changed, only replaced.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync(VIP_CHANNEL_ID, {
    name: "VIP orders",
    description: "New orders placed from a table's QR code.",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 200, 250],
    lightColor: "#4CAF50",
    sound: VIP_SOUND_FILE,
  });

  // Everything else (stock transfers, low stock, conversions, test alerts).
  // Kept on the original id so devices that already have it keep their settings.
  await Notifications.setNotificationChannelAsync(STORE_CHANNEL_ID, {
    name: "Store alerts",
    description: "Stock transfers and low-stock warnings.",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 200, 250],
    lightColor: "#5AA02C",
    sound: "default",
  });
}

type PushRegistrationOptions = {
  /** Captured synchronously by StoreProvider before registration can await. */
  credential: BoundAuthCredential;
  signal: AbortSignal;
};

type PushRegistrationLease = {
  controller: AbortController;
  raw: Promise<string | null>;
  drain: Promise<void>;
};

let registrationRevision = 0;
let activeRegistration: PushRegistrationLease | null = null;
const EMPTY_DRAIN = Promise.resolve();

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function registrationIsCurrent(
  credential: BoundAuthCredential,
  signal: AbortSignal,
): boolean {
  return !signal.aborted && isExactCurrentAuthCredential(credential);
}

async function performPushRegistration(
  credential: BoundAuthCredential,
  signal: AbortSignal,
): Promise<string | null> {
  // Offline builds have no server to register against.
  if (OFFLINE_MODE || signal.aborted) return null;
  // Push tokens are not issued to simulators/emulators.
  if (!Device.isDevice || !registrationIsCurrent(credential, signal)) return null;

  const id = projectId();
  if (!id) {
    console.warn("[push] no EAS projectId — skipping push registration");
    return null;
  }

  await ensureAndroidChannel();
  if (!registrationIsCurrent(credential, signal)) return null;

  const existing = await Notifications.getPermissionsAsync();
  if (!registrationIsCurrent(credential, signal)) return null;

  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!registrationIsCurrent(credential, signal)) return null;
  }
  if (!granted) return null;

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
  if (!token || !registrationIsCurrent(credential, signal)) return null;

  // This final exact-token check and fetch call are synchronous with respect to
  // each other. A later credential revision aborts the fetch through cleanup.
  if (!registrationIsCurrent(credential, signal)) return null;
  // No store header: the server registers this device for every branch the user
  // belongs to, so one phone hears all of them.
  const res = await fetch(`${API_URL}/api/push/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: credential.cookie,
    },
    body: JSON.stringify({ token, platform: Platform.OS }),
    signal,
  });
  return res.ok ? token : null;
}

/**
 * Abort active registration synchronously and return its raw-settlement drain.
 * A caller may await the drain before unregistering or starting another token.
 */
export function cancelAndDrainPushRegistration(): Promise<void> {
  registrationRevision += 1;
  const active = activeRegistration;
  if (!active) return EMPTY_DRAIN;
  active.controller.abort();
  return active.drain;
}

/**
 * Ask permission, get the Expo token, and register it for every branch the
 * signed-in user belongs to. Every await is fenced by the exact credential
 * captured by StoreProvider.
 */
export async function registerForPush(
  options: PushRegistrationOptions,
): Promise<string | null> {
  const startRevision = ++registrationRevision;
  const predecessor = activeRegistration;
  predecessor?.controller.abort();
  if (predecessor) await predecessor.drain;

  if (
    startRevision !== registrationRevision ||
    !registrationIsCurrent(options.credential, options.signal)
  ) {
    return null;
  }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  options.signal.addEventListener("abort", forwardAbort, { once: true });
  if (options.signal.aborted) controller.abort();

  const raw = performPushRegistration(options.credential, controller.signal);
  const drain = raw.then(
    () => undefined,
    () => undefined,
  );
  const lease: PushRegistrationLease = { controller, raw, drain };
  activeRegistration = lease;

  try {
    return await raw;
  } catch (error) {
    if (!controller.signal.aborted && !isAbortError(error)) {
      console.warn(
        "[push] registration failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  } finally {
    options.signal.removeEventListener("abort", forwardAbort);
    if (activeRegistration === lease) activeRegistration = null;
  }
}

type UnregisterPushOptions = {
  /** Captured before local binding and Better Auth storage are revoked. */
  credential?: BoundAuthCredential | null;
  /** Accepted for callers that still pass it; registration is per user now. */
  storeId?: string | null;
  timeoutMs?: number;
};

/** Stop alerts for this device (called on sign-out). */
export async function unregisterPush(options: UnregisterPushOptions = {}): Promise<void> {
  try {
    if (OFFLINE_MODE) return;

    // Capture synchronously before the first token/permission await. Sign-out
    // passes an even earlier object that remains valid for unregister only.
    const credential = options.credential ?? captureBoundAuthCredential();
    if (!credential || !Device.isDevice) return;

    const id = projectId();
    if (!id) return;

    const controller = new AbortController();
    const timeoutMs = Math.max(1, options.timeoutMs ?? 2_500);
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const work = (async () => {
      const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
      if (!token || controller.signal.aborted) return;

      await fetch(`${API_URL}/api/push/unregister`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: credential.cookie,
        },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      });
    })().catch(() => {
      // Best effort. The local auth transition must never wait indefinitely.
    });

    const deadline = new Promise<void>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve();
      }, timeoutMs);
    });

    await Promise.race([work, deadline]);
    if (timeout) clearTimeout(timeout);
    controller.abort();
  } catch {
    /* best effort */
  }
}

/** Ask the server to send this store's devices a test alert. */
export async function sendTestPush(storeId: string): Promise<number> {
  if (OFFLINE_MODE) return 0;
  const credential = captureBoundAuthCredential();
  if (!credential) return 0;
  const res = await fetch(`${API_URL}/api/push/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: credential.cookie,
      "x-store-id": storeId,
    },
  });
  const body = (await res.json()) as { ok: boolean; data?: { sent: number } };
  return body.ok ? (body.data?.sent ?? 0) : 0;
}
