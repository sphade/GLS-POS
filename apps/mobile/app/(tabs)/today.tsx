import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { WebOrder } from "@gls-pos/types";
import { colors, formatMoney, strings } from "@/constants/theme";
import { EmptyState } from "@/components/EmptyState";
import { useCart, type Receipt } from "@/lib/cart";
import { useWebOrders } from "@/lib/web-orders";
import { useStore } from "@/lib/store";
import { countDirty } from "@/lib/db";
import { onSynced, syncNow } from "@/lib/sync";
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
  const { orders } = useWebOrders();
  const { store } = useStore();
  const [tab, setTab] = useState<"pos" | "online">("pos");
  const [syncing, setSyncing] = useState(false);

  /**
   * Real pending-upload count, read from the sync engine's `dirty` column.
   * (This used to read a flag baked into seeded demo receipts, so it warned
   * about receipts that were never actually out of sync.)
   */
  const [pending, setPending] = useState(() => countDirty("receipts"));
  useEffect(() => onSynced(() => setPending(countDirty("receipts"))), []);
  useEffect(() => {
    const t = setInterval(() => setPending(countDirty("receipts")), 4000);
    return () => clearInterval(t);
  }, []);

  const pushNow = async () => {
    feedbackTap();
    setSyncing(true);
    await syncNow(store.id);
    setPending(countDirty("receipts"));
    setSyncing(false);
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Receipts</Text>
      </View>

      {pending > 0 && (
        <Pressable style={styles.syncBar} onPress={pushNow} disabled={syncing}>
          <Text style={styles.syncText}>
            {syncing
              ? "Uploading…"
              : `${pending} receipt${pending === 1 ? "" : "s"} not uploaded yet · tap to retry`}
          </Text>
          <Ionicons name="sync" size={16} color={colors.white} />
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
          data={receipts}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <EmptyState text={strings.noTransactionsToday} size={120} />
            </View>
          }
          renderItem={({ item }) => (
            <ReceiptRow
              receipt={item}
              onPress={() => router.push({ pathname: "/receipt/[id]", params: { id: item.id } })}
            />
          )}
        />
      ) : (
        /* VIP orders placed from the guest QR site. */
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <EmptyState text="No VIP orders yet" size={120} />
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

function ReceiptRow({ receipt, onPress }: { receipt: Receipt; onPress: () => void }) {
  const time = new Date(receipt.createdAt);
  return (
    <Pressable style={styles.rcptCard} onPress={onPress} android_ripple={{ color: "#00000010" }}>
      <MaterialCommunityIcons name={modeIcon(receipt.mode)} size={28} color={colors.grey700} style={{ margin: 10 }} />
      <View style={{ flex: 1, paddingVertical: 6 }}>
        <View style={styles.rcptTopRow}>
          <Text style={styles.rcptNumber}>{receipt.number}</Text>
          {!receipt.synced && <Ionicons name="sync" size={15} color={colors.red500} style={{ marginLeft: 4 }} />}
        </View>
        <Text style={styles.rcptName}>
          {receipt.customerName ?? strings.guest} {strings.by} {receipt.mode}
        </Text>
        <Text style={styles.rcptMeta}>
          {receipt.itemCount} Items · {time.toLocaleDateString()} - {time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </Text>
      </View>
      <Text style={styles.rcptTotal}>{formatMoney(receipt.total, receipt.currency)}</Text>
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
  rcptTotal: { fontSize: 18, fontWeight: "700", color: colors.primary, margin: 10 },
  footerBtn: { backgroundColor: colors.card, marginHorizontal: 10, marginBottom: 8, paddingVertical: 14, alignItems: "center", borderRadius: 4 },
  footerText: { color: colors.primary, fontWeight: "700", fontSize: 16 },
});
