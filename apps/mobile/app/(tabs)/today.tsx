import { useEffect, useMemo, useState } from "react";
import {
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import type { WebOrder } from "@gls-pos/types";
import { colors, formatMoney, strings } from "@/constants/theme";
import { EmptyState } from "@/components/EmptyState";
import { useCart, type Receipt } from "@/lib/cart";
import {
  isVoidReturn,
  refundedTotalOf,
  returnStateOf,
  useReturns,
  type ReturnState,
} from "@/lib/returns";
import { useWebOrders } from "@/lib/web-orders";
import { useStore } from "@/lib/store";
import { loadDirtyIds } from "@/lib/db";
import { onSynced, syncNowDetailed, useServerRefresh } from "@/lib/sync";
import { feedbackTap } from "@/lib/feedback";

const modeIcon = (mode: string) => {
  if (mode.includes("Card")) return "credit-card-outline" as const;
  if (mode.includes("UPI")) return "cellphone" as const;
  if (mode === "Credit") return "account-clock-outline" as const;
  return "cash" as const;
};

export default function TodayScreen() {
  const router = useRouter();
  const { receipts } = useCart();
  const { returns: allReturns } = useReturns();
  const { orders } = useWebOrders();
  const { store } = useStore();
  const [tab, setTab] = useState<"pos" | "online">("pos");
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");

  /**
   * Receipt upload state comes from SQLite's dirty column — the same source the
   * sync engine clears — rather than the stale `receipt.synced` JSON property.
   */
  const [pendingIds, setPendingIds] = useState(() => loadDirtyIds("receipts"));
  const [syncError, setSyncError] = useState<string | null>(null);
  const { refreshing, onRefresh: serverRefresh } = useServerRefresh(store.id);
  const pending = pendingIds.length;
  const pendingSet = new Set(pendingIds);
  /** This tab is Today, so older receipts belong in Reports, not this list. */
  const todayReceipts = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return receipts.filter((receipt) => receipt.createdAt >= start.getTime());
  }, [receipts]);

  /**
   * Return state per receipt, derived from its credit notes so a refunded sale
   * is obvious in the list without opening it.
   */
  const returnInfo = useMemo(() => {
    const map = new Map<string, { refunded: number; state: ReturnState }>();
    if (allReturns.length === 0) return map;
    for (const receipt of todayReceipts) {
      const rets = allReturns.filter((ret) => ret.receiptId === receipt.id);
      if (rets.length === 0) continue;
      map.set(receipt.id, {
        refunded: refundedTotalOf(rets),
        state: returnStateOf(receipt, rets),
      });
    }
    return map;
  }, [todayReceipts, allReturns]);

  /** Money refunded today, by refund date — what the drawer actually paid back. */
  const refundedToday = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return allReturns.reduce(
      (sum, ret) =>
        !isVoidReturn(ret) && ret.createdAt >= start.getTime() ? sum + ret.total : sum,
      0,
    );
  }, [allReturns]);

  const q = query.trim().toLowerCase();
  /** Filter receipts by number, customer, or payment mode. */
  const filteredReceipts = useMemo(() => {
    if (!q) return todayReceipts;
    return todayReceipts.filter((r) =>
      [r.number, r.customerName ?? "", r.mode].some((f) => f.toLowerCase().includes(q)),
    );
  }, [todayReceipts, q]);
  /** Filter VIP orders by code, table, or guest. */
  const filteredOrders = useMemo(() => {
    if (!q) return orders;
    return orders.filter((o) =>
      [o.code, o.tableName, o.guestName ?? ""].some((f) => f.toLowerCase().includes(q)),
    );
  }, [orders, q]);
  const refreshPending = () => {
    const ids = loadDirtyIds("receipts");
    setPendingIds(ids);
    if (ids.length === 0) setSyncError(null);
  };

  useEffect(() => onSynced(refreshPending), []);
  useEffect(() => {
    // Foreground-only, like every other poll in the app.
    const t = setInterval(() => {
      if (AppState.currentState !== "active") return;
      refreshPending();
    }, 4000);
    return () => clearInterval(t);
  }, []);

  const pushNow = async () => {
    if (syncing) return;
    feedbackTap();
    setSyncing(true);
    setSyncError(null);
    try {
      // Detailed result so the banner shows the REAL reason a retry failed
      // (expired session, offline, server rejected, timeout) instead of a
      // blanket "check your connection" that hides the actual problem.
      const result = await syncNowDetailed(store.id);
      const remaining = loadDirtyIds("receipts");
      setPendingIds(remaining);
      if (!result.ok) {
        setSyncError(result.message);
      } else if (remaining.length > 0) {
        setSyncError("Upload failed — check your connection, then tap to retry");
      } else {
        setSyncError(null);
      }
    } catch {
      refreshPending();
      setSyncError("Upload failed — check your connection, then tap to retry");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Receipts</Text>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={19} color={colors.grey600} />
          <TextInput
            style={styles.searchInput}
            placeholder={tab === "pos" ? "Search receipt, customer, payment" : "Search order, table, guest"}
            placeholderTextColor={colors.grey500}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.grey500} />
            </Pressable>
          )}
        </View>
      </View>

      {pending > 0 && (
        <Pressable style={styles.syncBar} onPress={pushNow} disabled={syncing}>
          <Text style={styles.syncText}>
            {syncing
              ? "Uploading receipts…"
              : syncError ?? `${pending} receipt${pending === 1 ? "" : "s"} waiting to upload · tap to retry`}
          </Text>
          <Ionicons name="sync" size={16} color={colors.white} />
        </Pressable>
      )}

      {refundedToday > 0 && tab === "pos" && (
        <Pressable
          style={styles.refundBar}
          onPress={() => {
            feedbackTap();
            router.push("/returns" as Href);
          }}
        >
          <MaterialCommunityIcons name="cash-refund" size={16} color={colors.red800} />
          <Text style={styles.refundBarText}>
            {formatMoney(refundedToday, store.currency)} refunded today
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.red800} />
        </Pressable>
      )}

      <View style={styles.tabCard}>
        <Pressable
          style={[styles.tabHalf, tab === "pos" && styles.tabActive]}
          onPress={() => {
            feedbackTap();
            setTab("pos");
          }}
        >
          <Text style={[styles.tabText, tab === "pos" && styles.tabTextActive]}>{strings.posReceipts}</Text>
        </Pressable>
        <Pressable
          style={[styles.tabHalf, tab === "online" && styles.tabActive]}
          onPress={() => {
            feedbackTap();
            setTab("online");
          }}
        >
          <Text style={[styles.tabText, tab === "online" && styles.tabTextActive]}>{strings.onlineOrders}</Text>
        </Pressable>
      </View>

      {tab === "pos" ? (
        <FlatList
          data={filteredReceipts}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={serverRefresh}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <EmptyState text={q ? "No matching receipts" : strings.noTransactionsToday} size={120} />
            </View>
          }
          renderItem={({ item }) => (
            <ReceiptRow
              receipt={item}
              awaitingUpload={pendingSet.has(item.id)}
              returned={returnInfo.get(item.id)}
              onPress={() => router.push({ pathname: "/receipt/[id]", params: { id: item.id } })}
            />
          )}
        />
      ) : (
        /* VIP orders placed from the guest QR site. */
        <FlatList
          data={filteredOrders}
          keyExtractor={(o) => o.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={serverRefresh}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <EmptyState text={q ? "No matching orders" : "No VIP orders yet"} size={120} />
            </View>
          }
          renderItem={({ item }) => (
            <WebOrderRow order={item} onPress={() => router.push("/online-orders")} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function ReceiptRow({
  receipt,
  awaitingUpload,
  returned,
  onPress,
}: {
  receipt: Receipt;
  awaitingUpload: boolean;
  returned?: { refunded: number; state: ReturnState };
  onPress: () => void;
}) {
  const time = new Date(receipt.createdAt);
  return (
    <Pressable style={styles.rcptCard} onPress={onPress} android_ripple={{ color: "#00000010" }}>
      <MaterialCommunityIcons name={modeIcon(receipt.mode)} size={28} color={colors.grey700} style={{ margin: 10 }} />
      <View style={{ flex: 1, paddingVertical: 6 }}>
        <View style={styles.rcptTopRow}>
          <Text style={styles.rcptNumber}>{receipt.number}</Text>
          {awaitingUpload && <Ionicons name="sync" size={15} color={colors.red500} style={{ marginLeft: 4 }} />}
          {returned && (
            <View style={styles.returnChip}>
              <Text style={styles.returnChipText}>
                {returned.state === "full" ? "RETURNED" : "PART. RETURNED"}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.rcptName}>
          {receipt.customerName ?? strings.guest} {strings.by} {receipt.mode}
        </Text>
        <Text style={styles.rcptMeta}>
          {receipt.itemCount} Items · {time.toLocaleDateString()} - {time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text
          style={[
            styles.rcptTotal,
            returned?.state === "full" && styles.rcptTotalVoided,
          ]}
        >
          {formatMoney(receipt.total, receipt.currency)}
        </Text>
        {returned && returned.refunded > 0 && (
          <Text style={styles.rcptRefunded}>
            -{formatMoney(returned.refunded, receipt.currency)}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/** A VIP order row; tapping opens the VIP Orders workflow screen. */
function WebOrderRow({ order, onPress }: { order: WebOrder; onPress: () => void }) {
  const time = new Date(order.createdAt);
  const tone =
    order.status === "received"
      ? colors.red500
      : order.status === "served"
        ? colors.green
        : colors.primary;
  return (
    <Pressable style={styles.rcptCard} onPress={onPress} android_ripple={{ color: "#00000010" }}>
      <MaterialCommunityIcons
        name="qrcode-scan"
        size={28}
        color={colors.grey700}
        style={{ margin: 10 }}
      />
      <View style={{ flex: 1, paddingVertical: 6 }}>
        <View style={styles.rcptTopRow}>
          <Text style={styles.rcptNumber}>{order.code}</Text>
          <View style={[styles.statusPill, { backgroundColor: tone }]}>
            <Text style={styles.statusPillText}>{order.status.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.rcptName}>
          {order.tableName}
          {order.guestName ? ` · ${order.guestName}` : ""}
        </Text>
        <Text style={styles.rcptMeta}>
          {order.lines.length} Items · {time.toLocaleDateString()} -{" "}
          {time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </Text>
      </View>
      <Text style={styles.rcptTotal}>{formatMoney(order.total, order.currency)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  statusPill: { marginLeft: 8, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 2 },
  statusPillText: { color: colors.white, fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },
  header: { backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 14 },
  headerTitle: { color: colors.white, fontSize: 18, fontWeight: "700" },
  searchRow: { backgroundColor: colors.primary, paddingHorizontal: 10, paddingBottom: 12 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  searchInput: { flex: 1, color: colors.grey800, fontSize: 16, padding: 0 },
  syncBar: {
    backgroundColor: colors.red500,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  syncText: { color: colors.white, fontSize: 12, flex: 1 },
  tabCard: {
    flexDirection: "row",
    backgroundColor: colors.card,
    margin: 10,
    borderRadius: 4,
    overflow: "hidden",
    elevation: 2,
  },
  tabHalf: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 16, fontWeight: "700", color: colors.primary },
  tabTextActive: { color: colors.white },
  emptyWrap: { alignItems: "center", justifyContent: "center", marginTop: 80 },
  rcptCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    marginHorizontal: 10,
    marginBottom: 8,
    borderRadius: 4,
    elevation: 1,
  },
  rcptTopRow: { flexDirection: "row", alignItems: "center" },
  rcptNumber: { fontSize: 16, fontWeight: "700", color: colors.grey900 },
  rcptName: { fontSize: 14, color: colors.grey700, marginTop: 1 },
  rcptMeta: { fontSize: 12, color: colors.grey500, marginTop: 1 },
  rcptTotal: { fontSize: 18, fontWeight: "700", color: colors.primary, marginHorizontal: 10, marginTop: 10 },
  rcptTotalVoided: { color: colors.grey500, textDecorationLine: "line-through" },
  rcptRefunded: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.red500,
    marginHorizontal: 10,
    marginBottom: 8,
    marginTop: 1,
  },
  returnChip: {
    backgroundColor: "#FDECEA",
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 6,
  },
  returnChipText: { fontSize: 9, fontWeight: "800", color: colors.red800, letterSpacing: 0.4 },
  refundBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FDECEA",
    marginHorizontal: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 4,
  },
  refundBarText: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.red800 },
  footerBtn: { backgroundColor: colors.card, marginHorizontal: 10, marginBottom: 8, paddingVertical: 14, alignItems: "center", borderRadius: 4 },
  footerText: { color: colors.primary, fontWeight: "700", fontSize: 16 },
});
