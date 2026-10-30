import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import * as Application from "expo-application";
import * as Device from "expo-device";
import { colors } from "@/constants/theme";
import { API_URL } from "@/lib/auth-client";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { feedbackTap } from "@/lib/feedback";
import { getSyncDiagnostics } from "@/lib/sync";

/**
 * Which server is this phone actually talking to?
 *
 * Written after a custom domain was mistaken for a staging copy. The app can
 * only prove that by asking the server itself: `/health` now reports its
 * environment, so this screen shows PRODUCTION or STAGING in plain words
 * instead of leaving staff to infer it from missing sales.
 *
 * Everything here is read-only and safe to show: no tokens, no cookie, no
 * customer data — just the endpoint, the store identity and how far this
 * device has synced.
 */
type Health =
  | { state: "checking" }
  | { state: "ok"; environment: string; ms: number }
  | { state: "error"; message: string };

export default function DiagnosticsScreen() {
  const router = useRouter();
  const { store } = useStore();
  const { user } = useAuth();
  const [health, setHealth] = useState<Health>({ state: "checking" });
  const [sync, setSync] = useState(() => getSyncDiagnostics(store.id));

  const check = useCallback(async () => {
    setHealth({ state: "checking" });
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(`${API_URL}/health`, { signal: controller.signal });
      const body = (await res.json()) as { ok?: boolean; environment?: string };
      if (!res.ok || body.ok !== true) {
        setHealth({ state: "error", message: `Server answered ${res.status}` });
        return;
      }
      setHealth({
        state: "ok",
        environment: body.environment ?? "unknown",
        ms: Date.now() - started,
      });
    } catch (error) {
      const message =
        (error as Error)?.name === "AbortError"
          ? "Timed out after 8s"
          : ((error as Error)?.message ?? "Could not reach the server");
      setHealth({ state: "error", message });
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // Sync numbers move while a first download runs, so refresh them on a slow
  // tick rather than pretending this is a static page.
  useEffect(() => {
    const timer = setInterval(() => setSync(getSyncDiagnostics(store.id)), 2_000);
    return () => clearInterval(timer);
  }, [store.id]);

  const environment =
    health.state === "ok" ? health.environment.toUpperCase() : null;
  const isStaging = environment === "STAGING";
  const isProduction = environment === "PRODUCTION";

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Diagnostics</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.statusCard,
            isStaging ? styles.statusStaging : null,
            isProduction ? styles.statusProduction : null,
          ]}
        >
          <Text style={styles.statusLabel}>SERVER ENVIRONMENT</Text>
          {health.state === "checking" ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color={colors.white} />
              <Text style={styles.statusValue}>CHECKING…</Text>
            </View>
          ) : health.state === "ok" ? (
            <>
              <Text style={styles.statusValue}>{environment}</Text>
              <Text style={styles.statusHint}>
                Answered in {health.ms} ms
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.statusValue}>UNREACHABLE</Text>
              <Text style={styles.statusHint}>{health.message}</Text>
            </>
          )}
        </View>

        <Card title="SERVER">
          <Row label="API URL" value={API_URL} mono />
          <Row
            label="Environment"
            value={
              health.state === "ok"
                ? health.environment
                : health.state === "checking"
                  ? "checking…"
                  : "unreachable"
            }
            emphasis={isStaging}
          />
        </Card>

        <Card title="STORE">
          <Row label="Shop" value={store.name} />
          <Row label="Store ID" value={store.id} mono />
          <Row label="Role" value={store.role} />
          <Row label="Central" value={store.isCentral ? "yes" : "no"} />
          <Row label="Signed in as" value={user?.name ?? "—"} />
        </Card>

        <Card title="SYNC">
          <Row label="Applied cursor" value={String(sync.cursor)} mono />
          <Row
            label="First-download head"
            value={sync.head === null ? "complete" : String(sync.head)}
            mono
          />
          <Row
            label="Catching up"
            value={
              sync.progress === null
                ? "not running"
                : `${Math.round(sync.progress * 100)}%`
            }
            emphasis={sync.progress !== null}
          />
          <Row
            label="Pending upload"
            value={`${sync.pending} change${sync.pending === 1 ? "" : "s"}`}
            emphasis={sync.pending > 0}
          />
          <Row label="Last error" value={sync.error ?? "none"} />
        </Card>

        <Card title="APP">
          <Row label="Version" value={Constants.expoConfig?.version ?? "—"} />
          <Row
            label="Build"
            value={
              Application.nativeBuildVersion ??
              String(Constants.expoConfig?.android?.versionCode ?? "—")
            }
          />
          <Row label="Package" value={Application.applicationId ?? "—"} mono />
          <Row
            label="Device"
            value={`${Device.manufacturer ?? ""} ${Device.modelName ?? Platform.OS}`.trim()}
          />
        </Card>

        <Pressable
          onPress={() => {
            feedbackTap();
            void check();
            setSync(getSyncDiagnostics(store.id));
          }}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel="Check again"
        >
          <Ionicons name="refresh" size={16} color={colors.white} />
          <Text style={styles.buttonText}>CHECK AGAIN</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({
  label,
  value,
  mono,
  emphasis,
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          mono ? styles.rowValueMono : null,
          emphasis ? styles.rowValueStrong : null,
        ]}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.grey200 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: 4,
    height: 52,
  },
  headerBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, color: colors.white, fontSize: 17, fontWeight: "800" },

  content: { padding: 12, paddingBottom: 32, gap: 10 },

  statusCard: {
    backgroundColor: colors.grey700,
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  statusProduction: { backgroundColor: "#0E7A3C" },
  statusStaging: { backgroundColor: colors.red500 },
  statusLabel: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusValue: { color: colors.white, fontSize: 26, fontWeight: "900", letterSpacing: 0.5 },
  statusHint: { color: "rgba(255,255,255,0.85)", fontSize: 12 },

  card: { backgroundColor: colors.white, borderRadius: 12, padding: 14, gap: 2 },
  cardTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    color: colors.grey600,
    marginBottom: 6,
  },
  row: { paddingVertical: 5, gap: 2 },
  rowLabel: { fontSize: 11, color: colors.grey600, fontWeight: "700" },
  rowValue: { fontSize: 14, color: colors.grey900 },
  rowValueMono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }) },
  rowValueStrong: { color: colors.red500, fontWeight: "800" },

  button: {
    marginTop: 4,
    backgroundColor: colors.primary,
    borderRadius: 10,
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: { color: colors.white, fontWeight: "900", letterSpacing: 0.8, fontSize: 13 },
});
