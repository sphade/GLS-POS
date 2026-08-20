import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { colors } from "@/constants/theme";
import { useCatalog } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import { API_URL } from "@/lib/auth-client";
import { feedbackError, feedbackTap } from "@/lib/feedback";
import { syncNowDetailed } from "@/lib/sync";

const VERIFY_TIMEOUT_MS = 12_000;

/**
 * QR code for one table. Guests scan it to open the VIP ordering page already
 * scoped to that table, which is why every table needs its own code.
 *
 * A table can be created while offline, but its QR is only displayed after the
 * public server confirms that table exists. This prevents printing a code that
 * still points at a local-only table.
 */
export default function TableQrScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { tables } = useCatalog();
  const { store } = useStore();
  const [busy, setBusy] = useState(false);
  const [publishState, setPublishState] = useState<"checking" | "ready" | "error">("checking");
  const [publishError, setPublishError] = useState("");
  const verificationAttempt = useRef(0);
  const svgRef = useRef<{ toDataURL: (cb: (b64: string) => void) => void } | null>(null);

  const table = tables.find((t) => t.id === id);
  const url = table ? `${API_URL}/vip/${store.id}/${table.id}` : "";

  const verifyOnline = async () => {
    if (!table) return;
    const attempt = ++verificationAttempt.current;
    setPublishError("");
    setPublishState("checking");

    // Upload only table rows. An unrelated dirty catalog/staff record must not
    // prevent an otherwise-authorized table from becoming available online.
    const syncResult = await syncNowDetailed(store.id, ["tables"]);
    if (attempt !== verificationAttempt.current) return;
    if (!syncResult.ok) {
      setPublishError(syncResult.message);
      setPublishState("error");
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${API_URL}/vip/api/${encodeURIComponent(store.id)}/${encodeURIComponent(table.id)}/menu`,
        { signal: controller.signal },
      );
      const body = (await response.json().catch(() => null)) as
        | { ok: false; error?: { code?: string; message?: string } }
        | { ok: true }
        | null;
      if (attempt !== verificationAttempt.current) return;

      if (response.ok) {
        setPublishState("ready");
        return;
      }

      const code = body && !body.ok ? body.error?.code : undefined;
      const message = body && !body.ok ? body.error?.message : undefined;
      setPublishError(
        code === "table_not_found"
          ? "The server did not receive this table. Retry publishing."
          : code === "store_not_found"
            ? "This store does not exist on the configured server. Sign out and sign in to the correct store."
            : message ?? `The server could not verify this table (${response.status}).`,
      );
      setPublishState("error");
    } catch (e) {
      if (attempt !== verificationAttempt.current) return;
      setPublishError(
        (e as Error).name === "AbortError"
          ? "The server took too long to verify the table. Check your connection and retry."
          : `Could not verify the table: ${(e as Error).message}`,
      );
      setPublishState("error");
    } finally {
      clearTimeout(timeout);
    }
  };

  useEffect(() => {
    void verifyOnline();
    // Invalidate the result if this screen closes or changes to another table.
    return () => {
      verificationAttempt.current += 1;
    };
    // Table/store ids are the stable identity of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table?.id, store.id]);

  /** Grab the rendered QR as base64 so it can go into printable HTML. */
  const qrBase64 = () =>
    new Promise<string | null>((resolve) => {
      if (!svgRef.current) return resolve(null);
      try {
        svgRef.current.toDataURL((b64) => resolve(b64));
      } catch {
        resolve(null);
      }
    });

  const printableHtml = (b64: string) => `<!DOCTYPE html><html><head><meta charset="utf-8" />
<style>
  @page { margin: 14mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center; color:#111; }
  .card { border: 2px solid #5AA02C; border-radius: 18px; padding: 30px 24px; max-width: 460px; margin: 0 auto; }
  .kicker { letter-spacing: 3px; font-size: 12px; font-weight: 800; color:#5AA02C; }
  h1 { font-size: 30px; margin: 6px 0 2px; }
  .table { font-size: 19px; font-weight: 700; margin-bottom: 18px; }
  img { width: 300px; height: 300px; }
  .steps { margin-top: 18px; font-size: 14px; line-height: 1.7; color:#444; }
  .url { margin-top: 14px; font-size: 10px; color:#999; word-break: break-all; }
</style></head><body>
  <div class="card">
    <div class="kicker">VIP TABLE SERVICE</div>
    <h1>${escapeHtml(store.name)}</h1>
    <div class="table">${escapeHtml(table?.name ?? "")}</div>
    <img src="data:image/png;base64,${b64}" />
    <div class="steps">
      <strong>Scan to order</strong><br/>
      Point your phone camera at the code<br/>
      Browse the menu and send your order<br/>
      We'll bring it over — pay when your receipt arrives
    </div>
    <div class="url">${escapeHtml(url)}</div>
  </div>
</body></html>`;

  const doPrint = async () => {
    feedbackTap();
    setBusy(true);
    try {
      const b64 = await qrBase64();
      if (!b64) throw new Error("Could not render the QR code");
      await Print.printAsync({ html: printableHtml(b64) });
    } catch (e) {
      feedbackError();
      Alert.alert("Couldn't print", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doShare = async () => {
    feedbackTap();
    setBusy(true);
    try {
      const b64 = await qrBase64();
      if (!b64) throw new Error("Could not render the QR code");
      const { uri } = await Print.printToFileAsync({ html: printableHtml(b64) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `${table?.name} QR` });
      }
    } catch (e) {
      feedbackError();
      Alert.alert("Couldn't share", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!table) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <Toolbar title="TABLE QR CODE" onBack={() => router.back()} />
        <Text style={styles.missing}>That table no longer exists.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <Toolbar title="TABLE QR CODE" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: 16, alignItems: "center" }}>
        <View style={styles.card}>
          <Text style={styles.kicker}>VIP TABLE SERVICE</Text>
          <Text style={styles.storeName}>{store.name}</Text>
          <Text style={styles.tableName}>{table.name}</Text>

          <View style={[styles.qrWrap, publishState !== "ready" && styles.qrStatusWrap]}>
            {publishState === "ready" ? (
              <QRCode
                value={url}
                size={230}
                color="#111111"
                backgroundColor="#FFFFFF"
                getRef={(c) => (svgRef.current = c as never)}
                ecl="M"
              />
            ) : publishState === "checking" ? (
              <>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.publishTitle}>Publishing table…</Text>
                <Text style={styles.publishText}>Making this QR available to guests.</Text>
              </>
            ) : (
              <>
                <Ionicons name="alert-circle-outline" size={42} color={colors.red800} />
                <Text style={[styles.publishTitle, { color: colors.red800 }]}>Could not publish table</Text>
                <Text style={styles.publishText}>{publishError}</Text>
              </>
            )}
          </View>

          <Text style={styles.scanHint}>
            {publishState === "ready" ? "Scan to order" : "QR unavailable until published"}
          </Text>
          <Text style={styles.url} numberOfLines={3}>
            {url}
          </Text>
        </View>

        {publishState === "error" && (
          <Pressable style={styles.retryBtn} onPress={() => void verifyOnline()} disabled={busy}>
            <Ionicons name="refresh" size={18} color={colors.primary} />
            <Text style={styles.retryBtnText}>RETRY PUBLISHING</Text>
          </Pressable>
        )}

        <View style={styles.actions}>
          <Pressable
            style={[styles.primaryBtn, publishState !== "ready" && styles.disabledBtn]}
            onPress={doPrint}
            disabled={busy || publishState !== "ready"}
          >
            {busy ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <>
                <Ionicons name="print-outline" size={19} color={colors.white} />
                <Text style={styles.primaryBtnText}>PRINT TABLE CARD</Text>
              </>
            )}
          </Pressable>
          <Pressable
            style={[styles.secondaryBtn, publishState !== "ready" && styles.disabledBtn]}
            onPress={doShare}
            disabled={busy || publishState !== "ready"}
          >
            <Ionicons name="share-outline" size={19} color={colors.primary} />
            <Text style={styles.secondaryBtnText}>SHARE AS PDF</Text>
          </Pressable>
        </View>

        <View style={styles.tip}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.tipText}>
            Each table has its own code. Print this one and place it on {table.name} — when a guest
            scans it, their order arrives labelled for this table.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function Toolbar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.toolbar}>
      <Pressable onPress={onBack} style={styles.toolbarBtn} hitSlop={8}>
        <Ionicons name="arrow-back" size={24} color={colors.primary} />
      </Pressable>
      <Text style={styles.toolbarTitle}>{title}</Text>
    </View>
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
  missing: { textAlign: "center", marginTop: 40, color: colors.grey600 },

  card: {
    alignSelf: "stretch",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.primary,
    paddingVertical: 24,
    paddingHorizontal: 18,
  },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 2.5, color: colors.primary },
  storeName: { fontSize: 22, fontWeight: "800", color: colors.grey900, marginTop: 6, textAlign: "center" },
  tableName: { fontSize: 17, fontWeight: "700", color: colors.grey700, marginTop: 2, marginBottom: 18 },
  qrWrap: { padding: 12, backgroundColor: colors.white, borderRadius: 8 },
  qrStatusWrap: { width: 254, height: 254, alignItems: "center", justifyContent: "center" },
  publishTitle: { marginTop: 12, fontSize: 15, fontWeight: "800", color: colors.grey800 },
  publishText: { marginTop: 5, fontSize: 12, color: colors.grey600, textAlign: "center" },
  scanHint: { marginTop: 16, fontSize: 15, fontWeight: "700", color: colors.grey800 },
  url: { marginTop: 8, fontSize: 10, color: colors.grey500, textAlign: "center" },

  retryBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    height: 44,
    marginTop: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.white,
  },
  retryBtnText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  actions: { alignSelf: "stretch", gap: 10, marginTop: 18 },
  disabledBtn: { opacity: 0.45 },
  primaryBtn: {
    flexDirection: "row",
    gap: 8,
    height: 50,
    borderRadius: 6,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  primaryBtnText: { color: colors.white, fontSize: 14, fontWeight: "800", letterSpacing: 0.5 },
  secondaryBtn: {
    flexDirection: "row",
    gap: 8,
    height: 50,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { color: colors.primary, fontSize: 14, fontWeight: "800", letterSpacing: 0.5 },

  tip: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.blue50,
    borderRadius: 6,
    padding: 12,
    marginTop: 18,
  },
  tipText: { flex: 1, fontSize: 12, color: colors.primary, lineHeight: 17 },
});
