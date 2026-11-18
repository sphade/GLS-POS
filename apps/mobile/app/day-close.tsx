import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { EmptyState } from "@/components/EmptyState";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { trustedNow } from "@/lib/clock";
import { feedbackError, feedbackTap } from "@/lib/feedback";
import type { DayCloseSummary } from "@gls-pos/types";

/**
 * Close the trading day and keep the numbers.
 *
 * Reports are computed from whatever receipts the store has *now*, so a phone
 * that was offline at closing time can change yesterday's total days later.
 * Closing a day writes the figures down once; they never move again, and any
 * money that arrives afterwards is shown as drift instead of quietly editing a
 * total the owner already read out.
 *
 * The day itself is local: this screen computes the bounds from the corrected
 * clock, and the store counts within them. There is no timezone guessing on the
 * server to get wrong.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar day `offset` days back, with its exact [from, to) bounds. */
function dayBounds(offset: number): { day: string; from: number; to: number } {
  const start = new Date(trustedNow());
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return {
    day: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    from: start.getTime(),
    to: end.getTime(),
  };
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; closes: DayCloseSummary[] }
  | { kind: "error"; message: string };

export default function DayCloseScreen() {
  const router = useRouter();
  const { store } = useStore();
  const { can } = useAuth();
  const allowed = can("reports:view");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const result = await api.listDayCloses(store.id);
    if (result.ok) setState({ kind: "ready", closes: result.data.closes });
    else setState({ kind: "error", message: result.error.message });
  }, [store.id]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const close = useCallback(
    async (offset: number) => {
      feedbackTap();
      setBusy(true);
      const bounds = dayBounds(offset);
      const result = await api.closeDay(store.id, bounds);
      setBusy(false);
      if (!result.ok) {
        feedbackError();
        setState({ kind: "error", message: result.error.message });
        return;
      }
      await load();
    },
    [load, store.id],
  );

  const money = (minor: number) => formatMoney(minor, store.currency);

  if (!allowed) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <Header onBack={() => router.back()} />
        <View style={styles.emptyWrap}>
          <EmptyState text="Only owners and managers can close the day" size={120} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <Header onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>WHAT THIS DOES</Text>
          <Text style={styles.body}>
            Counts the day&apos;s sales and refunds once and keeps them. Later uploads from
            a phone that was offline cannot change a closed day — they show as drift
            instead.
          </Text>
          <View style={styles.actions}>
            <Pressable
              style={[styles.primaryButton, busy ? styles.buttonBusy : null]}
              disabled={busy}
              onPress={() => void close(0)}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Ionicons name="lock-closed-outline" size={16} color={colors.white} />
              )}
              <Text style={styles.primaryButtonText}>CLOSE TODAY</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, busy ? styles.buttonBusy : null]}
              disabled={busy}
              onPress={() => void close(1)}
              accessibilityRole="button"
            >
              <Ionicons name="time-outline" size={16} color={colors.primary} />
              <Text style={styles.secondaryButtonText}>CLOSE YESTERDAY</Text>
            </Pressable>
          </View>
        </View>

        {state.kind === "loading" ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : state.kind === "error" ? (
          <View style={styles.card}>
            <Text style={[styles.body, { color: colors.red500 }]}>{state.message}</Text>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => void load()}
              accessibilityRole="button"
            >
              <Ionicons name="refresh" size={16} color={colors.primary} />
              <Text style={styles.secondaryButtonText}>TRY AGAIN</Text>
            </Pressable>
          </View>
        ) : state.closes.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState text="No day has been closed yet" size={120} />
          </View>
        ) : (
          state.closes.map((close) => (
            <View key={close.day} style={styles.card}>
              <View style={styles.closeHeader}>
                <Text style={styles.day}>{close.day}</Text>
                {close.drift === 0 ? (
                  <View style={styles.settledBadge}>
                    <Text style={styles.settledText}>SETTLED</Text>
                  </View>
                ) : (
                  <View style={styles.driftBadge}>
                    <Text style={styles.driftText}>
                      {close.drift > 0 ? "+" : ""}
                      {money(close.drift)} LATE
                    </Text>
                  </View>
                )}
              </View>

              <Text style={styles.net}>{money(close.net)}</Text>
              <Text style={styles.netLabel}>net after refunds</Text>

              <Row label="Sales" value={`${close.salesCount} · ${money(close.gross)}`} />
              <Row label="Discounts" value={money(close.discounts)} />
              <Row
                label="Refunds"
                value={`${close.returnCount} · ${money(close.refunds)}`}
              />
              {close.byMode.map((mode) => (
                <Row
                  key={mode.mode}
                  label={mode.mode}
                  value={`${mode.count} · ${money(mode.total)}`}
                />
              ))}

              {close.drift !== 0 ? (
                <Text style={styles.driftNote}>
                  Live books now show {money(close.live.net)}. The difference arrived after
                  this day was closed.
                </Text>
              ) : null}

              <Text style={styles.meta}>
                Closed by {close.closedByName} ·{" "}
                {new Date(close.closedAt).toLocaleString([], {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerBtn} hitSlop={8}>
        <Ionicons name="arrow-back" size={24} color={colors.white} />
      </Pressable>
      <Text style={styles.headerTitle}>Day Close</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 10,
  },
  headerBtn: { width: 32, alignItems: "center" },
  headerTitle: { flex: 1, color: colors.white, fontSize: 18, fontWeight: "700" },

  content: { padding: 10, paddingBottom: 32, gap: 10 },
  emptyWrap: { alignItems: "center", justifyContent: "center", marginTop: 60 },
  loading: { paddingVertical: 40, alignItems: "center" },

  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    gap: 6,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    color: colors.grey600,
  },
  body: { fontSize: 13, lineHeight: 19, color: colors.grey800 },

  actions: { marginTop: 10, gap: 8 },
  primaryButton: {
    height: 46,
    borderRadius: 8,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  secondaryButton: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  buttonBusy: { opacity: 0.5 },

  closeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  day: { fontSize: 15, fontWeight: "800", color: colors.grey900 },
  settledBadge: {
    backgroundColor: "#E6F4EA",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  settledText: { color: "#0E7A3C", fontSize: 10, fontWeight: "900", letterSpacing: 0.6 },
  driftBadge: {
    backgroundColor: "#FEF3C7",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  driftText: { color: "#B45309", fontSize: 10, fontWeight: "900", letterSpacing: 0.6 },

  net: { fontSize: 26, fontWeight: "900", color: colors.grey900, marginTop: 4 },
  netLabel: { fontSize: 11, color: colors.grey600, marginBottom: 6 },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.grey200,
  },
  rowLabel: { fontSize: 12, color: colors.grey700 },
  rowValue: { fontSize: 12, fontWeight: "700", color: colors.grey900 },

  driftNote: { fontSize: 12, color: "#B45309", lineHeight: 17, marginTop: 6 },
  meta: { fontSize: 11, color: colors.grey600, marginTop: 6 },
});
