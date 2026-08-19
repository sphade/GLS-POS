import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import type { WebOrder, WebOrderStatus } from "@gls-pos/types";
import { colors, formatMoney } from "@/constants/theme";
import { useWebOrders } from "@/lib/web-orders";
import { useCart } from "@/lib/cart";
import { useCatalog } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { sendTestPush } from "@/lib/push";
import { feedbackError, feedbackSaleComplete, feedbackTap } from "@/lib/feedback";

/**
 * VIP orders placed from the guest website. Staff see them here, move them
 * through preparing → ready, then bill them — which raises a normal unpaid
 * receipt (the guest pays against the printed slip) and deducts stock.
 */
export default function OnlineOrdersScreen() {
  const router = useRouter();
  const { orders, active, setStatus, attachReceipt, reload } = useWebOrders();
  const { billWebOrder } = useCart();
  const { recordSale } = useCatalog();
  const { store } = useStore();
  const { user, can } = useAuth();
  const [showDone, setShowDone] = useState(false);

  const list = showDone ? orders : active;

  /** Turn a web order into a real (unpaid) receipt and deduct stock. */
  const bill = (order: WebOrder) => {
    feedbackTap();
    Alert.alert(
      `Bill ${order.code}?`,
      `${order.tableName} · ${formatMoney(order.total, order.currency)}\n\nCreates an unpaid receipt you can print for the guest.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create receipt",
          onPress: () => {
            const receipt = billWebOrder({
              order,
              storeName: store.name,
              storeReference: store.reference,
              servedBy: user?.name ?? "Staff",
            });
            recordSale(
              order.lines.map((l) => ({ productId: l.productId, qty: l.quantity })),
              receipt.id,
            );
            attachReceipt(order.id, receipt.id);
            feedbackSaleComplete();
            router.push({ pathname: "/receipt/[id]", params: { id: receipt.id, fromSale: "1" } });
          },
        },
      ],
    );
  };

  /** Verify notifications reach this device. */
  const testPush = async () => {
    feedbackTap();
    const sent = await sendTestPush(store.id);
    Alert.alert(
      sent > 0 ? "Test sent" : "No devices registered",
      sent > 0
        ? `Sent to ${sent} device${sent === 1 ? "" : "s"}. It should arrive in a few seconds.`
        : "This device isn't registered for notifications yet. That needs a development build with an EAS project id — the in-app chime still works.",
    );
  };

  const advance = (order: WebOrder, next: WebOrderStatus) => {
    feedbackTap();
    setStatus(order.id, next);
  };

  const cancel = (order: WebOrder) => {
    feedbackTap();
    Alert.alert("Cancel order?", `${order.code} from ${order.tableName} will be marked cancelled.`, [
      { text: "Keep", style: "cancel" },
      { text: "Cancel order", style: "destructive", onPress: () => setStatus(order.id, "cancelled") },
    ]);
  };

  if (!can("sale:create")) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <Toolbar title="VIP ORDERS" onBack={() => router.back()} onRefresh={reload} />
        <View style={styles.empty}>
          <Ionicons name="lock-closed-outline" size={44} color={colors.grey400} />
          <Text style={styles.emptyText}>Your role can't take orders.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <Toolbar
        title="VIP ORDERS"
        onBack={() => router.back()}
        onRefresh={reload}
        onTestPush={testPush}
      />

      <View style={styles.filterBar}>
        <Pressable
          style={[styles.filter, !showDone && styles.filterOn]}
          onPress={() => {
            feedbackTap();
            setShowDone(false);
          }}
        >
          <Text style={[styles.filterText, !showDone && styles.filterTextOn]}>
            OPEN ({active.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.filter, showDone && styles.filterOn]}
          onPress={() => {
            feedbackTap();
            setShowDone(true);
          }}
        >
          <Text style={[styles.filterText, showDone && styles.filterTextOn]}>
            ALL ({orders.length})
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 6, paddingBottom: 30 }}>
        {list.length === 0 && (
          <View style={styles.setup}>
            <MaterialCommunityIcons name="qrcode-scan" size={44} color={colors.primary} />
            <Text style={styles.setupTitle}>No VIP orders yet</Text>
            <Text style={styles.setupText}>
              Guests order by scanning the QR code on their table. Each table has its own code —
              that's how the order arrives labelled for the right table.
            </Text>

            <View style={styles.steps}>
              <Step n={1} text="Create your VIP tables in Table Management" />
              <Step n={2} text="Tap the green QR button on a table" />
              <Step n={3} text="Print the card and place it on that table" />
            </View>

            <Pressable
              style={styles.setupBtn}
              onPress={() => {
                feedbackTap();
                router.push("/tables");
              }}
            >
              <MaterialCommunityIcons name="table-furniture" size={18} color={colors.white} />
              <Text style={styles.setupBtnText}>OPEN TABLE MANAGEMENT</Text>
            </Pressable>

            <Text style={styles.setupNote}>
              Your menu must have synced at least once for the QR page to show items.
            </Text>
          </View>
        )}

        {list.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            onBill={() => bill(o)}
            onAdvance={(s) => advance(o, s)}
            onCancel={() => cancel(o)}
            onOpenReceipt={() =>
              o.receiptId && router.push({ pathname: "/receipt/[id]", params: { id: o.receiptId } })
            }
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Toolbar({
  title,
  onBack,
  onRefresh,
  onTestPush,
}: {
  title: string;
  onBack: () => void;
  onRefresh: () => void;
  onTestPush?: () => void;
}) {
  return (
    <View style={styles.toolbar}>
      <Pressable onPress={onBack} style={styles.toolbarBtn} hitSlop={8}>
        <Ionicons name="arrow-back" size={24} color={colors.primary} />
      </Pressable>
      <Text style={styles.toolbarTitle}>{title}</Text>
      {onTestPush && (
        <Pressable onPress={onTestPush} style={styles.toolbarBtn} hitSlop={8}>
          <Ionicons name="notifications-outline" size={21} color={colors.primary} />
        </Pressable>
      )}
      <Pressable
        onPress={() => {
          feedbackTap();
          onRefresh();
        }}
        style={styles.toolbarBtn}
        hitSlop={8}
      >
        <Ionicons name="refresh" size={22} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const STATUS_META: Record<WebOrderStatus, { label: string; color: string }> = {
  received: { label: "NEW", color: "#E53935" },
  preparing: { label: "PREPARING", color: "#EF6C00" },
  ready: { label: "READY", color: "#0277BD" },
  served: { label: "SERVED", color: "#2E7D32" },
  cancelled: { label: "CANCELLED", color: "#9E9E9E" },
};

/** How long ago, in plain words. */
function ago(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} mins ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? "1 hr ago" : `${hrs} hrs ago`;
}

function OrderCard({
  order,
  onBill,
  onAdvance,
  onCancel,
  onOpenReceipt,
}: {
  order: WebOrder;
  onBill: () => void;
  onAdvance: (s: WebOrderStatus) => void;
  onCancel: () => void;
  onOpenReceipt: () => void;
}) {
  const meta = STATUS_META[order.status];
  const open = order.status === "received" || order.status === "preparing" || order.status === "ready";

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <View style={styles.codeRow}>
            <Text style={styles.code}>{order.code}</Text>
            <View style={[styles.pill, { backgroundColor: meta.color }]}>
              <Text style={styles.pillText}>{meta.label}</Text>
            </View>
          </View>
          <Text style={styles.table}>
            {order.tableName} · {ago(order.createdAt)}
          </Text>
          {order.guestName ? <Text style={styles.guest}>Guest: {order.guestName}</Text> : null}
        </View>
        <Text style={styles.total}>{formatMoney(order.total, order.currency)}</Text>
      </View>

      <View style={styles.lines}>
        {order.lines.map((l, i) => (
          <View key={i} style={styles.lineRow}>
            <Text style={styles.lineQty}>{l.quantity}×</Text>
            <Text style={styles.lineName} numberOfLines={1}>
              {l.name}
            </Text>
            <Text style={styles.lineTotal}>{formatMoney(l.lineTotal, order.currency)}</Text>
          </View>
        ))}
      </View>

      {order.note ? (
        <View style={styles.note}>
          <MaterialCommunityIcons name="chef-hat" size={15} color={colors.primary} />
          <Text style={styles.noteText}>{order.note}</Text>
        </View>
      ) : null}

      {open && (
        <View style={styles.actions}>
          {order.status === "received" && (
            <Action label="START PREPARING" onPress={() => onAdvance("preparing")} tone="primary" />
          )}
          {order.status === "preparing" && (
            <Action label="MARK READY" onPress={() => onAdvance("ready")} tone="primary" />
          )}
          {order.status === "ready" && (
            <Action label="BILL & PRINT" onPress={onBill} tone="green" />
          )}
          <Pressable style={styles.cancelBtn} onPress={onCancel} hitSlop={6}>
            <Ionicons name="close" size={18} color={colors.grey500} />
          </Pressable>
        </View>
      )}

      {order.status === "served" && order.receiptId ? (
        <Pressable style={styles.receiptLink} onPress={onOpenReceipt}>
          <Ionicons name="receipt-outline" size={16} color={colors.primary} />
          <Text style={styles.receiptLinkText}>VIEW RECEIPT</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Numbered setup step in the empty state. */
function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

function Action({
  label,
  onPress,
  tone,
}: {
  label: string;
  onPress: () => void;
  tone: "primary" | "green";
}) {
  return (
    <Pressable
      style={[styles.action, { backgroundColor: tone === "green" ? colors.green : colors.primary }]}
      onPress={onPress}
      android_ripple={{ color: "#FFFFFF33" }}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
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

  filterBar: {
    flexDirection: "row",
    gap: 8,
    padding: 8,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey300,
  },
  filter: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.grey300,
    alignItems: "center",
  },
  filterOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontSize: 12, fontWeight: "800", color: colors.grey700, letterSpacing: 0.4 },
  filterTextOn: { color: colors.white },

  empty: { alignItems: "center", justifyContent: "center", padding: 40, gap: 14 },
  emptyText: { color: colors.grey600, fontSize: 14, textAlign: "center", lineHeight: 20 },

  setup: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 6,
    margin: 6,
    padding: 22,
    elevation: 1,
  },
  setupTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 12 },
  setupText: {
    fontSize: 13,
    color: colors.grey600,
    textAlign: "center",
    lineHeight: 19,
    marginTop: 6,
  },
  steps: { alignSelf: "stretch", gap: 10, marginTop: 18 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: { color: colors.white, fontSize: 11, fontWeight: "800" },
  stepText: { flex: 1, fontSize: 13, color: colors.grey800 },
  setupBtn: {
    alignSelf: "stretch",
    flexDirection: "row",
    gap: 8,
    height: 46,
    borderRadius: 6,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  setupBtnText: { color: colors.white, fontSize: 13, fontWeight: "800", letterSpacing: 0.5 },
  setupNote: { fontSize: 11, color: colors.grey500, textAlign: "center", marginTop: 12 },

  card: {
    backgroundColor: colors.card,
    borderRadius: 5,
    marginBottom: 8,
    padding: 12,
    elevation: 1,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  code: { fontSize: 18, fontWeight: "800", color: colors.grey900, letterSpacing: 0.5 },
  pill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { color: colors.white, fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  table: { fontSize: 13, color: colors.grey700, marginTop: 3, fontWeight: "600" },
  guest: { fontSize: 12, color: colors.grey600, marginTop: 1 },
  total: { fontSize: 17, fontWeight: "800", color: colors.green },

  lines: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.grey300,
    gap: 3,
  },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  lineQty: { fontSize: 13, fontWeight: "800", color: colors.primary, minWidth: 26 },
  lineName: { flex: 1, fontSize: 14, color: colors.grey800 },
  lineTotal: { fontSize: 13, color: colors.grey700, fontWeight: "600" },

  note: {
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    backgroundColor: colors.blue50,
    borderRadius: 4,
    padding: 8,
    marginTop: 9,
  },
  noteText: { flex: 1, fontSize: 12, color: colors.primary },

  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  action: {
    flex: 1,
    height: 42,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { color: colors.white, fontSize: 13, fontWeight: "800", letterSpacing: 0.5 },
  cancelBtn: {
    width: 42,
    height: 42,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.grey300,
    alignItems: "center",
    justifyContent: "center",
  },

  receiptLink: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingVertical: 4 },
  receiptLinkText: { color: colors.primary, fontSize: 12, fontWeight: "800", letterSpacing: 0.4 },
});
