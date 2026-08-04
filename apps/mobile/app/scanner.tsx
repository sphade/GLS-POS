import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { feedbackScan, feedbackTap } from "@/lib/feedback";

/** Barcode scanner with the red scan-line overlay, mirroring BarcodeScannerActivity. */
export default function ScannerScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [scanned, setScanned] = useState<string | null>(null);
  const lock = useRef(false);

  const onScan = ({ data }: { data: string }) => {
    if (lock.current) return;
    lock.current = true;
    feedbackScan();
    setScanned(data);
    setTimeout(() => (lock.current = false), 1500);
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Scan Barcode</Text>
        <Pressable
          style={styles.headerBtn}
          onPress={() => {
            feedbackTap();
            setTorch((v) => !v);
          }}
        >
          <Ionicons name={torch ? "flash" : "flash-off"} size={22} color={colors.white} />
        </Pressable>
      </View>

      <View style={styles.cameraWrap}>
        {!permission?.granted ? (
          <View style={styles.permissionWrap}>
            <Ionicons name="camera-outline" size={64} color={colors.grey400} />
            <Text style={styles.permissionText}>Camera access is needed to scan barcodes.</Text>
            <Pressable style={styles.permissionBtn} onPress={requestPermission}>
              <Text style={styles.permissionBtnText}>Grant Permission</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              enableTorch={torch}
              barcodeScannerSettings={{
                barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code39", "code128", "qr", "itf14"],
              }}
              onBarcodeScanned={onScan}
            />
            <View style={styles.overlay}>
              <View style={styles.scanBox}>
                <View style={styles.scanLine} />
              </View>
              <Text style={styles.hint}>Align the barcode inside the frame</Text>
            </View>
          </>
        )}
      </View>

      {scanned && (
        <View style={styles.resultBar}>
          <Text style={styles.resultLabel}>Scanned</Text>
          <Text style={styles.resultCode}>{scanned}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: {
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  headerBtn: { width: 48, alignItems: "center" },
  headerTitle: { color: colors.white, fontSize: 18, fontWeight: "700" },
  cameraWrap: { flex: 1, position: "relative" },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  scanBox: {
    width: "80%",
    height: 180,
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: 8,
    justifyContent: "center",
  },
  scanLine: { height: 2, backgroundColor: colors.red500 },
  hint: { color: colors.white, marginTop: 16, fontSize: 13 },
  permissionWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: colors.grey200 },
  permissionText: { color: colors.grey700, textAlign: "center", paddingHorizontal: 40 },
  permissionBtn: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6 },
  permissionBtnText: { color: colors.white, fontWeight: "700" },
  resultBar: { backgroundColor: colors.white, padding: 14 },
  resultLabel: { fontSize: 12, color: colors.grey600 },
  resultCode: { fontSize: 18, fontWeight: "700", color: colors.grey900, marginTop: 2 },
});
