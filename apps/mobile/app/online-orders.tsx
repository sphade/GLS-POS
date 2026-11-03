import { useMemo, useState, type ComponentProps } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { WebOrder, WebOrderStatus } from "@gls-pos/types";
import { colors, formatMoney } from "@/constants/theme";
import { centeredContent } from "@/lib/responsive";
import { loadRecentWebOrders, useWebOrders } from "@/lib/web-orders";
import { countDocs, runAtomic } from "@/lib/db";
import { displayItemName, useCart } from "@/lib/cart";
import { useCatalog } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { sendTestPush } from "@/lib/push";
import { feedbackSaleComplete, feedbackTap } from "@/lib/feedback";

const WEB_ORDER_PAGE = 100;

/**
 * VIP orders placed from the guest website. Staff accept them (which takes the
 * items out of menu stock, so the guest menu shows sold-out items straight
 * away), mark them ready, then bill them as a normal unpaid receipt.
 */
export default function OnlineOrdersScreen() {
  const router = useRouter();
  const { active, webOrderRevision, setStatus, attachReceipt, reload } = useWebOrders();
  const { billWebOrder } = useCart();
  const { recordSale } = useCatalog();
  const { store } = useStore();
  const { user, can } = useAuth();
  const [showDone, setShowDone] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(WEB_ORDER_PAGE);

  const historyPage = useMemo(
    () => loadRecentWebOrders(historyLimit + 1),
    [historyLimit, webOrderRevision],
  );
  const historyHasMore = historyPage.length > historyLimit;
  const history = historyPage.slice(0, historyLimit);
  const totalCount = useMemo(() => countDocs("web_orders"), [webOrderRevision]);
  const list = showDone ? history : active;

  /** Turn a web order into a real (unpaid) receipt. */
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
            // Receipt, any stock movements, audit entry and the order's receipt
            // link commit as one unit.
            const receipt = runAtomic(() => {
              const billed = billWebOrder({
                order,
                storeName: store.name,
                storeReference: store.reference,
                servedBy: user?.name ?? "Staff",
              });
              // The server took the stock when the order was accepted. Only an
              // order this phone hasn't heard that about yet records the sale;
              // the server voids that copy if it turns out to be a duplicate.
              if (!order.stockDeductedAt) {
                recordSale(
                  order.lines.map((l) => ({
                    productId: l.productId,
                    variantId: l.variantId,
                    qty: l.quantity,
                  })),
                  billed.id,
                );
              }
              attachReceipt(order.id, billed.id);
              return billed;
            });
            feedbackSaleComplete();
            router.push({ pathname: "/receipt/[id]", params: { id: receipt.id } });
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
    const accepted = order.status !== "received";
    Alert.alert(
      "Cancel order?",
      `${order.code} from ${order.tableName} will be marked cancelled.${
        accepted ? "\n\nIts items go back into stock." : ""
      }`,
      [
        { text: "Keep", style: "cancel" },
        { text: "Cancel order", style: "destructive", onPress: () => setStatus(order.id, "cancelled") },
      ],
    );
  };

  if (!can("sale:create")) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <Toolbar title="VIP Orders" onBack={() => router.back()} onRefresh={reload} />
        <View style={styles.empty}>
          <Ionicons name="lock-closed-outline" size={44} color={colors.grey400} />
          <Text style={styles.emptyText}>Your role can't take orders.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <Toolbar title="VIP Orders" onBack={() => router.back()} onRefresh={reload} onTestPush={testPush} />

      <View style={styles.filterBar}>
        <View style={styles.segment}>
          {(
            [
              [false, `Open · ${active.length}`],
              [true, `All · ${totalCount}`],
            ] as const
          ).map(([done, label]) => (
            <Pressable
              key={label}
              style={[styles.segBtn, showDone === done && styles.segBtnOn]}
              onPress={() => {
                feedbackTap();
                setShowDone(done);
              }}
            >
              <Text style={[styles.segText, showDone === done && styles.segTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.listBody, centeredContent]}>
        {list.length === 0 && (
          <View style={styles.setup}>
            <View style={styles.setupIcon}>
              <MaterialCommunityIcons name="qrcode-scan" size={30} color={colors.primaryDark} />
            </View>
            <Text style={styles.setupTitle}>{showDone ? "No VIP orders yet" : "No open VIP orders"}</Text>
            <Text style={styles.setupText}>
              Guests order by scanning the QR code on their table. Each table has its own code, so
              the order arrives labelled for the right table.
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
              <Text style={styles.setupBtnText}>Open Table Management</Text>
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

        {showDone && historyHasMore ? (
          <Pressable
            style={styles.more}
            onPress={() => {
              feedbackTap();
              setHistoryLimit((current) => current + WEB_ORDER_PAGE);
            }}
          >
            <Text style={styles.moreText}>Load more</Text>
          </Pressable>
        ) : null}
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
        <Ionicons name="arrow-back" size={24} color={colors.grey900} />
      </Pressable>
      <Text style={styles.toolbarTitle}>{title}</Text>
      {onTestPush && (
        <Pressable onPress={onTestPush} style={styles.toolbarBtn} hitSlop={8}>
          <Ionicons name="notifications-outline" size={21} color={colors.grey700} />
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
        <Ionicons name="refresh" size={22} color={colors.grey700} />
      </Pressable>
    </View>
  );
}

const STATUS_META: Record<WebOrderStatus, { label: string; color: string; tint: string }> = {
  received: { label: "New", color: "#D32F2F", tint: "#FDECEA" },
  preparing: { label: "Preparing", color: "#E65100", tint: "#FFF3E0" },
  ready: { label: "Ready", color: "#0277BD", tint: "#E1F5FE" },
  served: { label: "Billed", color: "#2E7D32", tint: "#E8F5E9" },
  cancelled: { label: "Cancelled", color: "#757575", tint: "#F1F1F1" },
};

const FLOW: readonly WebOrderStatus[] = ["received", "preparing", "ready", "served"];

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
  const step = FLOW.indexOf(order.status);
  const itemCount = order.lines.reduce((n, l) => n + l.quantity, 0);
  const isNew = order.status === "received";

  return (
    <View style={[styles.card, isNew && styles.cardNew]}>
      <View style={styles.cardTop}>
        <View style={[styles.tableBadge, { backgroundColor: meta.tint }]}>
          <MaterialCommunityIcons name="table-furniture" size={20} color={meta.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.table} numberOfLines={1}>
            {order.tableName}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {order.code} · {ago(order.createdAt)}
            {order.guestName ? ` · ${order.guestName}` : ""}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: meta.tint }]}>
          <View style={[styles.pillDot, { backgroundColor: meta.color }]} />
          <Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {step >= 0 ? (
        <View style={styles.progress}>
          {FLOW.map((s, i) => (
            <View
              key={s}
              style={[styles.progressSeg, { backgroundColor: i <= step ? meta.color : colors.grey100 }]}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.lines}>
        {order.lines.map((l, i) => (
          <View key={i} style={styles.lineRow}>
            <Text style={styles.lineQty}>{l.quantity}×</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName} numberOfLines={2}>
                {displayItemName(l.name, l.variantName)}
              </Text>
              {l.note ? <Text style={styles.lineNote}>{l.note}</Text> : null}
            </View>
            <Text style={styles.lineTotal}>{formatMoney(l.lineTotal, order.currency)}</Text>
          </View>
        ))}
      </View>

      {order.note ? (
        <View style={styles.note}>
          <MaterialCommunityIcons name="chef-hat" size={15} color={colors.grey700} />
          <Text style={styles.noteText}>{order.note}</Text>
        </View>
      ) : null}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>
          {itemCount} item{itemCount === 1 ? "" : "s"}
        </Text>
        <Text style={styles.total}>{formatMoney(order.total, order.currency)}</Text>
      </View>

      {open && (
        <View style={styles.actions}>
          {order.status === "received" && (
            <Action icon="check" label="Accept order" onPress={() => onAdvance("preparing")} tone="primary" />
          )}
          {order.status === "preparing" && (
            <Action icon="bell-check-outline" label="Mark ready" onPress={() => onAdvance("ready")} tone="primary" />
          )}
          {order.status === "ready" && (
            <Action icon="receipt" label="Bill & print" onPress={onBill} tone="green" />
          )}
          <Pressable style={styles.cancelBtn} onPress={onCancel} hitSlop={6} accessibilityLabel="Cancel order">
            <Ionicons name="close" size={20} color={colors.grey600} />
          </Pressable>
        </View>
      )}

      {order.status === "served" && order.receiptId ? (
        <Pressable style={styles.receiptLink} onPress={onOpenReceipt}>
          <Ionicons name="receipt-outline" size={16} color={colors.primaryDark} />
          <Text style={styles.receiptLinkText}>View receipt</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primaryDark} />
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
  icon,
  label,
  onPress,
  tone,
}: {
  icon: ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  onPress: () => void;
  tone: "primary" | "green";
}) {
  return (
    <Pressable
      style={[styles.action, { backgroundColor: tone === "green" ? colors.green : colors.primaryDark }]}
      onPress={onPress}
      android_ripple={{ color: "#FFFFFF33" }}
    >
      <MaterialCommunityIcons name={icon} size={18} color={colors.white} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    height: 56,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey100,
  },
  toolbarBtn: { width: 44, alignItems: "center" },
  toolbarTitle: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.grey900 },

  filterBar: { paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.white },
  segment: { flexDirection: "row", backgroundColor: colors.grey100, borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  segBtnOn: { backgroundColor: colors.white, elevation: 1 },
  segText: { fontSize: 13, fontWeight: "700", color: colors.grey600 },
  segTextOn: { color: colors.grey900 },

  listBody: { padding: 12, paddingBottom: 30 },
  empty: { alignItems: "center", justifyContent: "center", padding: 40, gap: 14 },
  emptyText: { color: colors.grey600, fontSize: 14, textAlign: "center", lineHeight: 20 },

  setup: { alignItems: "center", backgroundColor: colors.white, borderRadius: 18, padding: 22 },
  setupIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.grey100,
    alignItems: "center",
    justifyContent: "center",
  },
  setupTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 12 },
  setupText: { fontSize: 13, color: colors.grey600, textAlign: "center", lineHeight: 19, marginTop: 6 },
  steps: { alignSelf: "stretch", gap: 10, marginTop: 18 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: { color: colors.white, fontSize: 12, fontWeight: "800" },
  stepText: { flex: 1, fontSize: 13, color: colors.grey800 },
  setupBtn: {
    alignSelf: "stretch",
    flexDirection: "row",
    gap: 8,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  setupBtnText: { color: colors.white, fontSize: 14, fontWeight: "800" },
  setupNote: { fontSize: 11, color: colors.grey500, textAlign: "center", marginTop: 12 },

  card: {
    backgroundColor: colors.white,
    borderRadius: 18,
    marginBottom: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.grey100,
  },
  cardNew: { borderColor: "#F5B7B1", borderWidth: 1.5 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  tableBadge: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  table: { fontSize: 17, fontWeight: "800", color: colors.grey900 },
  sub: { fontSize: 12, color: colors.grey600, marginTop: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12, fontWeight: "800" },

  progress: { flexDirection: "row", gap: 4, marginTop: 12 },
  progressSeg: { flex: 1, height: 4, borderRadius: 2 },

  lines: { marginTop: 12, gap: 8 },
  lineRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  lineQty: { fontSize: 14, fontWeight: "800", color: colors.primaryDark, minWidth: 26 },
  lineName: { fontSize: 14, fontWeight: "600", color: colors.grey900 },
  lineNote: { fontSize: 12, color: colors.grey600, marginTop: 1 },
  lineTotal: { fontSize: 13, color: colors.grey700, fontWeight: "600" },

  note: {
    flexDirection: "row",
    gap: 7,
    alignItems: "flex-start",
    backgroundColor: colors.grey50,
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  noteText: { flex: 1, fontSize: 13, color: colors.grey800 },

  totalRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.grey100,
  },
  totalLabel: { fontSize: 13, color: colors.grey600, fontWeight: "600" },
  total: { fontSize: 19, fontWeight: "900", color: colors.grey900 },

  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  action: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { color: colors.white, fontSize: 15, fontWeight: "800" },
  cancelBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.grey100,
    alignItems: "center",
    justifyContent: "center",
  },

  more: { alignItems: "center", paddingVertical: 16 },
  moreText: { color: colors.primaryDark, fontWeight: "700", fontSize: 15 },

  receiptLink: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingVertical: 4 },
  receiptLinkText: { color: colors.primaryDark, fontSize: 14, fontWeight: "700" },
});
