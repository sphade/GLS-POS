import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import {
  forgetPrinter,
  getSavedPrinter,
  isClassicSupported,
  listBondedPrinters,
  printTest,
  savePrinter,
  scanForPrinters,
  type PrinterTransport,
  type SavedPrinter,
} from "@/lib/printer";
import { feedbackError, feedbackTap } from "@/lib/feedback";
import type { PaperWidth } from "@/lib/escpos";

/**
 * Pair a thermal receipt printer.
 *
 * PAIRED DEVICES comes first and is the primary path — it reads the phone's
 * system bond table (Bluetooth settings ▸ paired devices). Manufacturer-bonded
 * printers and Bluetooth Classic printers never show up in a discovery scan,
 * but they all live there. The BLE scan below stays as the secondary option
 * for printers that were never paired.
 */
export default function PrinterSetupScreen() {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedPrinter | null>(() => getSavedPrinter());
  const [bonded, setBonded] = useState<{ id: string; name: string }[]>([]);
  const [loadingBonded, setLoadingBonded] = useState(false);
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([]);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [paper, setPaper] = useState<PaperWidth>(() => getSavedPrinter()?.paper ?? 58);

  const loadBonded = useCallback(async () => {
    if (!isClassicSupported()) return;
    setLoadingBonded(true);
    try {
      setBonded(await listBondedPrinters());
    } catch (e) {
      // Non-fatal: the BLE scan remains available.
      Alert.alert("Couldn't read paired devices", (e as Error).message);
    } finally {
      setLoadingBonded(false);
    }
  }, []);

  const scan = async () => {
    feedbackTap();
    setDevices([]);
    setScanning(true);
    try {
      const found = await scanForPrinters(6000, (d) =>
        setDevices((prev) => (prev.some((p) => p.id === d.id) ? prev : [...prev, d])),
      );
      if (found.length === 0) {
        Alert.alert(
          "No Bluetooth printers found",
          "Pair the printer in Android's Bluetooth settings first (PIN is usually 0000 or 1234), then reopen this screen — it will appear under PAIRED DEVICES.",
        );
      }
    } catch (e) {
      feedbackError();
      Alert.alert("Scan failed", (e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const choose = (d: { id: string; name: string }, transport: PrinterTransport) => {
    feedbackTap();
    const next: SavedPrinter = { ...d, paper, transport };
    savePrinter(next);
    setSaved(next);
    Alert.alert("Printer saved", `${d.name} will be used for receipts.`, [
      { text: "Print test", onPress: () => void runTest() },
      { text: "Done" },
    ]);
  };

  const runTest = async () => {
    setTesting(true);
    try {
      await printTest();
    } catch (e) {
      feedbackError();
      Alert.alert("Could not print", (e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const setPaperWidth = (w: PaperWidth) => {
    feedbackTap();
    setPaper(w);
    if (saved) {
      const next = { ...saved, paper: w };
      savePrinter(next);
      setSaved(next);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} style={styles.toolbarBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.toolbarTitle}>PRINTER SETUP</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 8, paddingBottom: 30 }}>
        {/* Paired printer */}
        <Text style={styles.section}>CURRENT PRINTER</Text>
        <View style={styles.card}>
          {saved ? (
            <>
              <View style={styles.savedRow}>
                <MaterialCommunityIcons name="printer-check" size={26} color={colors.green} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.savedName}>{saved.name}</Text>
                  <Text style={styles.savedMeta}>
                    {saved.transport === "classic" ? "Classic · " : "BLE · "}
                    {saved.paper}mm paper
                  </Text>
                </View>
              </View>
              <View style={styles.btnRow}>
                <Pressable style={styles.testBtn} onPress={() => void runTest()} disabled={testing}>
                  {testing ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <Text style={styles.testBtnText}>PRINT TEST</Text>
                  )}
                </Pressable>
                <Pressable
                  style={styles.forgetBtn}
                  onPress={() => {
                    feedbackTap();
                    forgetPrinter();
                    setSaved(null);
                  }}
                >
                  <Text style={styles.forgetBtnText}>FORGET</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.emptyRow}>
              <MaterialCommunityIcons name="printer-off" size={26} color={colors.grey500} />
              <Text style={styles.emptyText}>
                No printer selected. Pick one from PAIRED DEVICES below.
              </Text>
            </View>
          )}
        </View>

        {/* Paper width */}
        <Text style={styles.section}>PAPER WIDTH</Text>
        <View style={[styles.card, styles.paperRow]}>
          {([58, 80] as PaperWidth[]).map((w) => (
            <Pressable
              key={w}
              style={[styles.paperOption, paper === w && styles.paperOptionActive]}
              onPress={() => setPaperWidth(w)}
            >
              <Text style={[styles.paperText, paper === w && { color: colors.white }]}>{w}mm</Text>
              <Text style={[styles.paperSub, paper === w && { color: colors.white }]}>
                {w === 58 ? "32 chars" : "48 chars"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* System-paired devices — the reliable path */}
        <View style={styles.sectionRow}>
          <Text style={styles.section}>PAIRED DEVICES</Text>
          {isClassicSupported() && (
            <Pressable
              style={styles.refreshChip}
              onPress={() => void loadBonded()}
              disabled={loadingBonded}
              hitSlop={6}
            >
              {loadingBonded ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Ionicons name="sync" size={14} color={colors.primary} />
                  <Text style={styles.refreshText}>REFRESH</Text>
                </>
              )}
            </Pressable>
          )}
        </View>

        {bonded.length > 0 &&
          bonded.map((d) => (
            <Pressable key={d.id} style={styles.deviceRow} onPress={() => choose(d, "classic")}>
              <MaterialCommunityIcons name="printer" size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceName}>{d.name}</Text>
                <Text style={styles.deviceId}>Paired in Android settings · prints via Classic</Text>
              </View>
              {saved?.id === d.id && saved?.transport === "classic" ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.green} />
              ) : (
                <Text style={styles.useText}>USE</Text>
              )}
            </Pressable>
          ))}
        {isClassicSupported() && bonded.length === 0 && !loadingBonded && (
          <Pressable style={styles.loadHint} onPress={() => void loadBonded()}>
            <Text style={styles.loadHintText}>
              Tap REFRESH to list phones/tablets/printers already paired with this device.
            </Text>
          </Pressable>
        )}

        {/* Nearby BLE discovery — secondary */}
        <Text style={styles.section}>NEARBY (BLUETOOTH LE SCAN)</Text>
        <Pressable style={styles.scanBtn} onPress={() => void scan()} disabled={scanning}>
          {scanning ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <>
              <Ionicons name="bluetooth" size={18} color={colors.white} />
              <Text style={styles.scanBtnText}>SCAN FOR NEW PRINTERS</Text>
            </>
          )}
        </Pressable>

        {devices.map((d) => (
          <Pressable key={d.id} style={styles.deviceRow} onPress={() => choose(d, "ble")}>
            <MaterialCommunityIcons name="printer" size={22} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.deviceName}>{d.name}</Text>
              <Text style={styles.deviceId}>{d.id}</Text>
            </View>
            {saved?.id === d.id && saved?.transport === "ble" ? (
              <Ionicons name="checkmark-circle" size={22} color={colors.green} />
            ) : (
              <Text style={styles.useText}>USE</Text>
            )}
          </Pressable>
        ))}

        <View style={styles.help}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.helpText}>
            Can't find your printer? Pair it once in Android's Bluetooth settings (PIN often
            0000 or 1234), then use PAIRED DEVICES — printers that are already paired never show
            up in a scan.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.grey50,
    height: 56,
    paddingHorizontal: 4,
    elevation: 2,
  },
  toolbarBtn: { width: 44, alignItems: "center" },
  toolbarTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.primary, letterSpacing: 0.5 },

  section: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.grey600,
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 6,
    marginLeft: 6,
  },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 6 },
  refreshChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: colors.blue50,
  },
  refreshText: { color: colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  loadHint: { paddingVertical: 10, paddingHorizontal: 8, borderRadius: 4, backgroundColor: colors.card },
  loadHintText: { color: colors.grey600, fontSize: 12, lineHeight: 17 },
  card: { backgroundColor: colors.card, borderRadius: 4, padding: 12, elevation: 1 },

  savedRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  savedName: { fontSize: 16, fontWeight: "700", color: colors.grey900 },
  savedMeta: { fontSize: 12, color: colors.grey600, marginTop: 2 },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  testBtn: {
    flex: 1,
    height: 42,
    borderRadius: 4,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  testBtnText: { color: colors.white, fontWeight: "800", fontSize: 13, letterSpacing: 0.5 },
  forgetBtn: {
    paddingHorizontal: 16,
    height: 42,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.red500,
    alignItems: "center",
    justifyContent: "center",
  },
  forgetBtnText: { color: colors.red500, fontWeight: "800", fontSize: 13 },

  emptyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  emptyText: { flex: 1, color: colors.grey600, fontSize: 14 },

  paperRow: { flexDirection: "row", gap: 8 },
  paperOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 4,
    paddingVertical: 10,
    alignItems: "center",
  },
  paperOptionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  paperText: { fontSize: 16, fontWeight: "800", color: colors.grey900 },
  paperSub: { fontSize: 11, color: colors.grey600, marginTop: 2 },

  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 46,
    borderRadius: 4,
    backgroundColor: colors.primary,
    elevation: 2,
  },
  scanBtnText: { color: colors.white, fontWeight: "800", fontSize: 14, letterSpacing: 0.5 },

  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 4,
    padding: 12,
    marginTop: 6,
    elevation: 1,
  },
  deviceName: { fontSize: 15, fontWeight: "700", color: colors.grey900 },
  deviceId: { fontSize: 11, color: colors.grey500, marginTop: 1 },
  useText: { color: colors.primary, fontWeight: "800", fontSize: 12 },

  help: { flexDirection: "row", gap: 8, backgroundColor: colors.blue50, borderRadius: 4, padding: 12, marginTop: 16 },
  helpText: { flex: 1, fontSize: 12, color: colors.primary, lineHeight: 17 },
});
