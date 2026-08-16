import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import {
  forgetPrinter,
  getSavedPrinter,
  printTest,
  savePrinter,
  scanForPrinters,
  type SavedPrinter,
} from "@/lib/printer";
import { feedbackError, feedbackTap } from "@/lib/feedback";
import type { PaperWidth } from "@/lib/escpos";

/**
 * Pair a Bluetooth (BLE) thermal receipt printer.
 *
 * Only BLE printers show up here — that's what the app can drive directly.
 * Bluetooth Classic/SPP printers can't be reached from JS, so the screen says
 * so and points at the PDF/share route instead.
 */
export default function PrinterSetupScreen() {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedPrinter | null>(() => getSavedPrinter());
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([]);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [paper, setPaper] = useState<PaperWidth>(() => getSavedPrinter()?.paper ?? 58);

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
          "Make sure the printer is switched on and close by.\n\nNote: very cheap printers often use Bluetooth Classic, which can't be detected here — use Share as PDF instead.",
        );
      }
    } catch (e) {
      feedbackError();
      Alert.alert("Scan failed", (e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const choose = (d: { id: string; name: string }) => {
    feedbackTap();
    const next: SavedPrinter = { ...d, paper };
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
                    {saved.paper}mm paper · {saved.id.slice(0, 17)}
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
              <Text style={styles.emptyText}>No printer paired. Scan below to find one.</Text>
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

        {/* Scan */}
        <Text style={styles.section}>AVAILABLE DEVICES</Text>
        <Pressable style={styles.scanBtn} onPress={() => void scan()} disabled={scanning}>
          {scanning ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <>
              <Ionicons name="bluetooth" size={18} color={colors.white} />
              <Text style={styles.scanBtnText}>SCAN FOR PRINTERS</Text>
            </>
          )}
        </Pressable>

        {devices.map((d) => (
          <Pressable key={d.id} style={styles.deviceRow} onPress={() => choose(d)}>
            <MaterialCommunityIcons name="printer" size={22} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.deviceName}>{d.name}</Text>
              <Text style={styles.deviceId}>{d.id}</Text>
            </View>
            {saved?.id === d.id ? (
              <Ionicons name="checkmark-circle" size={22} color={colors.green} />
            ) : (
              <Text style={styles.useText}>USE</Text>
            )}
          </Pressable>
        ))}

        <View style={styles.help}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.helpText}>
            Only Bluetooth LE printers appear here. If your printer doesn't show up it's probably
            Bluetooth Classic — you can still give customers a receipt with Share as PDF or WhatsApp
            from the receipt screen.
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
