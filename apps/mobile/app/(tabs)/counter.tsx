import { memo, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney, strings } from "@/constants/theme";
import { PosHeader } from "@/components/PosHeader";
import {
  displayItemName,
  useCart,
  useCartActions,
  useCartCount,
  useCartLine,
  useCartLineIds,
  useCartSummary,
} from "@/lib/cart";
import { DiscountSheet } from "@/components/DiscountSheet";
import { discountAmount, discountLabel } from "@/lib/discount-model";
import { useAuth } from "@/lib/auth";
import { useServerRefresh } from "@/lib/sync";
import { useStore } from "@/lib/store";
import { feedbackAddItem, feedbackTap } from "@/lib/feedback";

type EditingBill = { id: string; label: string };

/**
 * Counter (billing) tab.
 *
 * Its root subscribes only to the stable set of line IDs. Quantity presses do
 * not rerender the screen, header, FlatList, or unrelated rows: the changed row
 * and the two tiny summary consumers update themselves directly.
 */
export default function CounterScreen() {
  const lineIds = useCartLineIds();
  const [editing, setEditing] = useState<EditingBill | null>(null);
  const { store } = useStore();
  const { refreshing, onRefresh } = useServerRefresh(store.id);

  useEffect(() => {
    if (lineIds.length === 0) setEditing(null);
  }, [lineIds]);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.headerRegion}>
        <PosHeader />
      </SafeAreaView>

      {lineIds.length === 0 ? (
        <EmptyCounter onResumeEditing={setEditing} refreshing={refreshing} onRefresh={onRefresh} />
      ) : (
        <ActiveCounter
          lineIds={lineIds}
          editing={editing}
          onEditingChange={setEditing}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}
    </View>
  );
}

/** Empty-cart actions and held bills update rarely, so the full context is safe here. */
function EmptyCounter({
  onResumeEditing,
  refreshing,
  onRefresh,
}: {
  onResumeEditing: (bill: EditingBill | null) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const { can } = useAuth();
  const canSell = can("sale:create");
  const canExpense = can("expenses:manage");
  const cartCount = useCartCount();
  const { heldOrders, resumeHeldOrder, discardHeldOrder } = useCart();

  const onResume = (id: string) => {
    feedbackTap();
    /**
     * Resuming loads the bill into the shared active cart. If the cashier
     * already built an order, replacing it silently would destroy work — ask
     * first.
     */
    if (cartCount > 0) {
      Alert.alert(
        "Replace current order?",
        "Your current cart will be replaced by this open bill.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Replace",
            style: "destructive",
            onPress: () => {
              const bill = heldOrders.find((candidate) => candidate.id === id);
              if (bill) onResumeEditing({ id: bill.id, label: bill.label });
              resumeHeldOrder(id);
            },
          },
        ],
      );
      return;
    }
    const bill = heldOrders.find((candidate) => candidate.id === id);
    if (bill) onResumeEditing({ id: bill.id, label: bill.label });
    resumeHeldOrder(id);
  };

  const onDiscard = (id: string, label: string) => {
    Alert.alert(`Discard "${label}"?`, "This open bill will be removed without charging.", [
      { text: "Cancel", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => discardHeldOrder(id) },
    ]);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.cartListContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
    >
      {canSell && (
        <Pressable
          style={styles.actionCard}
          onPress={() => {
            router.navigate("/(tabs)");
            feedbackTap();
          }}
          android_ripple={{ color: "#00000010" }}
        >
          <View style={styles.plusCircle}>
            <Ionicons name="add" size={28} color={colors.white} />
          </View>
          <Text style={styles.actionTitle}>New order</Text>
          <Text style={styles.actionHint}>Pick items from the menu to start a bill</Text>
        </Pressable>
      )}

      {canExpense && (
        <Pressable
          style={styles.expenseCard}
          onPress={() => {
            router.push("/expense-categories");
            feedbackTap();
          }}
          android_ripple={{ color: "#00000010" }}
        >
          <View style={styles.expenseIcon}>
            <MaterialCommunityIcons name="hand-coin-outline" size={22} color={colors.primaryDark} />
          </View>
          <Text style={styles.expenseTitle}>Add an expense</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.grey400} />
        </Pressable>
      )}

      {heldOrders.length > 0 && (
        <>
          <Text style={styles.openBillsTitle}>OPEN BILLS ({heldOrders.length})</Text>
          {heldOrders.map((bill) => (
            <Pressable
              key={bill.id}
              style={styles.billCard}
              onPress={() => onResume(bill.id)}
              onLongPress={() => onDiscard(bill.id, bill.label)}
              android_ripple={{ color: "#00000010" }}
            >
              <View style={styles.billIcon}>
                <MaterialCommunityIcons
                  name="clipboard-text-clock-outline"
                  size={24}
                  color={colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.billName} numberOfLines={1}>
                  {bill.label}
                </Text>
                <Text style={styles.billMeta}>
                  {bill.itemCount} item{bill.itemCount === 1 ? "" : "s"} ·{" "}
                  {new Date(bill.createdAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
              <Text style={styles.billTotal}>{formatMoney(bill.total, bill.currency)}</Text>
            </Pressable>
          ))}
          <Text style={styles.openBillsHint}>Tap to resume &amp; charge · long-press to discard</Text>
        </>
      )}
    </ScrollView>
  );
}

function ActiveCounter({
  lineIds,
  editing,
  onEditingChange,
  refreshing,
  onRefresh,
}: {
  lineIds: readonly string[];
  editing: EditingBill | null;
  onEditingChange: (bill: EditingBill | null) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { can } = useAuth();
  const canSell = can("sale:create");
  /** Only owners and managers may discount the bill. */
  const canDiscount = can("discount:apply");

  return (
    <>
      <BillHeader editing={editing} onEditingChange={onEditingChange} canSell={canSell} />

      <FlatList
        data={lineIds}
        keyExtractor={(lineId) => lineId}
        contentContainerStyle={styles.cartListContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        renderItem={({ item: lineId }) => (
          <CartLineRow lineId={lineId} editable={canSell} canDiscount={canDiscount} />
        )}
      />

      {/* Counter totals require selling access. Reports and receipt history use
          their own, stricter permissions. */}
      {canSell && (
        <View style={styles.checkout}>
          <CounterTotals canDiscount={canDiscount} />
          <CounterActions editing={editing} onEditingChange={onEditingChange} />
        </View>
      )}
    </>
  );
}

function BillHeader({
  editing,
  onEditingChange,
  canSell,
}: {
  editing: EditingBill | null;
  onEditingChange: (bill: EditingBill | null) => void;
  canSell: boolean;
}) {
  const { count } = useCartSummary();
  const { clear } = useCartActions();

  return (
    <View style={styles.billHeader}>
      <Text style={styles.billHeaderText}>
        {editing ? `Editing: ${editing.label}` : `${count} item${count === 1 ? "" : "s"} in this bill`}
      </Text>
      {canSell && (
        <Pressable
          onPress={() => {
            clear();
            onEditingChange(null);
            feedbackTap();
          }}
        >
          <Text style={styles.clear}>Clear all</Text>
        </Pressable>
      )}
    </View>
  );
}

const CartLineRow = memo(function CartLineRow({
  lineId,
  editable,
  canDiscount,
}: {
  lineId: string;
  editable: boolean;
  canDiscount: boolean;
}) {
  const entry = useCartLine(lineId);
  const { add, remove, setLineDiscount } = useCartActions();
  const [discountOpen, setDiscountOpen] = useState(false);
  if (!entry) return null;

  const unitPrice = entry.variant?.price ?? entry.item.price;
  const gross = unitPrice * entry.qty;
  const discount = discountAmount(entry.discount, gross);
  const net = gross - discount;
  const name = displayItemName(entry.item.name, entry.variant?.name);

  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.unitPrice}>{formatMoney(unitPrice, entry.item.currency)} each</Text>
        {canDiscount && (
          <Pressable
            style={[styles.lineDiscountBtn, entry.discount && styles.lineDiscountOn]}
            hitSlop={6}
            onPress={() => {
              feedbackTap();
              setDiscountOpen(true);
            }}
          >
            <MaterialCommunityIcons
              name="tag-outline"
              size={13}
              color={entry.discount ? colors.red800 : colors.primaryDark}
            />
            <Text
              style={[styles.lineDiscountText, entry.discount && { color: colors.red800 }]}
              numberOfLines={1}
            >
              {entry.discount
                ? `${discountLabel(entry.discount)} off · -${formatMoney(discount, entry.item.currency)}`
                : "Discount"}
            </Text>
          </Pressable>
        )}
      </View>
      <View style={styles.rowRight}>
        <View style={styles.lineAmounts}>
          {discount > 0 && (
            <Text style={styles.lineWas}>{formatMoney(gross, entry.item.currency)}</Text>
          )}
          <Text style={[styles.lineTotal, discount > 0 && styles.lineTotalDiscounted]}>
            {formatMoney(net, entry.item.currency)}
          </Text>
        </View>
        {editable ? (
          <View style={styles.stepper}>
            <Pressable
              style={styles.stepBtn}
              hitSlop={4}
              accessibilityLabel={entry.qty === 1 ? "Remove item" : "Decrease quantity"}
              onPress={() => {
                remove(lineId);
                feedbackTap();
              }}
            >
              <Ionicons
                name={entry.qty === 1 ? "trash-outline" : "remove"}
                size={18}
                color={entry.qty === 1 ? colors.red500 : colors.grey800}
              />
            </Pressable>
            <Text style={styles.qty}>{entry.qty}</Text>
            <Pressable
              style={[styles.stepBtn, styles.stepPlus]}
              hitSlop={4}
              accessibilityLabel="Increase quantity"
              onPress={() => {
                add(entry.item, entry.variant);
                feedbackAddItem();
              }}
            >
              <Ionicons name="add" size={18} color={colors.white} />
            </Pressable>
          </View>
        ) : (
          <Text style={styles.qtyReadOnly}>x{entry.qty}</Text>
        )}
      </View>

      <DiscountSheet
        visible={discountOpen}
        title="Line discount"
        subtitle={`${name} · ${entry.qty} × ${formatMoney(unitPrice, entry.item.currency)}`}
        base={gross}
        currency={entry.item.currency}
        current={entry.discount ?? null}
        onClose={() => setDiscountOpen(false)}
        onApply={(next) => setLineDiscount(lineId, next)}
      />
    </View>
  );
});

function CounterTotals({ canDiscount }: { canDiscount: boolean }) {
  const { count, gross, lineDiscountTotal, orderDiscountTotal, discountTotal, subtotal, taxTotal, total } =
    useCartSummary();
  const { setOrderDiscount, getOrderDiscount } = useCartActions();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Read at open time: the sheet only needs it while it's on screen, so this
  // avoids the totals card re-rendering on every discount change.
  const current = sheetOpen ? getOrderDiscount() : null;
  /** The order discount applies to what's left after line discounts. */
  const orderBase = gross - lineDiscountTotal;

  return (
    <View style={styles.totalsCard}>
      <TotalRow label={strings.subtotal} value={formatMoney(gross)} />

      {lineDiscountTotal > 0 && (
        <TotalRow label="Item discounts" value={`-${formatMoney(lineDiscountTotal)}`} negative />
      )}

      {canDiscount ? (
        <Pressable
          style={styles.discountRow}
          onPress={() => {
            feedbackTap();
            setSheetOpen(true);
          }}
        >
          <View style={styles.discountLabelWrap}>
            <MaterialCommunityIcons
              name="tag-multiple-outline"
              size={15}
              color={orderDiscountTotal > 0 ? colors.red500 : colors.primary}
            />
            <Text
              style={[
                styles.discountLabel,
                orderDiscountTotal > 0 && { color: colors.red500, fontWeight: "700" },
              ]}
            >
              {orderDiscountTotal > 0 ? "Bill discount" : "Add bill discount"}
            </Text>
          </View>
          <Text
            style={[styles.totalValue, orderDiscountTotal > 0 && styles.totalNegative]}
          >
            {orderDiscountTotal > 0 ? `-${formatMoney(orderDiscountTotal)}` : "—"}
          </Text>
        </Pressable>
      ) : (
        orderDiscountTotal > 0 && (
          <TotalRow label="Bill discount" value={`-${formatMoney(orderDiscountTotal)}`} negative />
        )
      )}

      {discountTotal > 0 && <TotalRow label="After discount" value={formatMoney(subtotal)} />}
      {taxTotal > 0 && <TotalRow label="Tax" value={formatMoney(taxTotal)} />}
      <View style={styles.divider} />
      <TotalRow label={strings.grandTotal} value={formatMoney(total)} bold />

      <DiscountSheet
        visible={sheetOpen}
        title="Bill discount"
        subtitle={`${count} item${count === 1 ? "" : "s"} · applies to the whole bill`}
        base={orderBase}
        currency="NGN"
        current={current}
        onClose={() => setSheetOpen(false)}
        onApply={setOrderDiscount}
      />
    </View>
  );
}

/** Hold/resume metadata changes rarely; only these controls consume full CartContext. */
function CounterActions({
  editing,
  onEditingChange,
}: {
  editing: EditingBill | null;
  onEditingChange: (bill: EditingBill | null) => void;
}) {
  const router = useRouter();
  const { total, holdOrder } = useCart();
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdName, setHoldName] = useState("");

  const confirmHold = () => {
    setHoldName("");
    setHoldOpen(false);
    holdOrder(holdName);
    feedbackTap();
  };

  const keepEditing = () => {
    if (!editing) return;
    onEditingChange(null);
    holdOrder(editing.label, undefined, editing.id);
    feedbackTap();
  };

  return (
    <>
      <View style={styles.actionRow}>
        <Pressable
          style={styles.hold}
          onPress={() => {
            if (editing) {
              keepEditing();
            } else {
              setHoldOpen(true);
              feedbackTap();
            }
          }}
        >
          <MaterialCommunityIcons
            name={editing ? "content-save-outline" : "clock-outline"}
            size={20}
            color={colors.primary}
          />
          <Text style={styles.holdText}>{editing ? "Keep bill" : "Hold"}</Text>
        </Pressable>
        <Pressable
          style={styles.charge}
          onPress={() => {
            router.push("/charge");
            feedbackTap();
          }}
        >
          <Text style={styles.chargeText}>
            {strings.charge} {formatMoney(total)}
          </Text>
        </Pressable>
      </View>

      <Modal visible={holdOpen} transparent animationType="fade" onRequestClose={() => setHoldOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setHoldOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.modalTitle}>Hold this bill</Text>
            <Text style={styles.modalHint}>Give it a name so you can find it to charge later.</Text>
            <TextInput
              style={styles.modalInput}
              value={holdName}
              onChangeText={setHoldName}
              placeholder="e.g. Table 4, John, Blue cap"
              placeholderTextColor={colors.grey500}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={confirmHold}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setHoldOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSave} onPress={confirmHold}>
                <Text style={styles.modalSaveText}>Hold bill</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function TotalRow({
  label,
  value,
  bold,
  negative,
}: {
  label: string;
  value: string;
  bold?: boolean;
  negative?: boolean;
}) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, bold && styles.totalBold]}>{label}</Text>
      <Text
        style={[
          styles.totalValue,
          negative && styles.totalNegative,
          bold && styles.totalBold,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  headerRegion: { backgroundColor: colors.primary },

  actionCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.grey200,
  },
  plusCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: { fontSize: 19, fontWeight: "800", color: colors.grey900, marginTop: 14 },
  actionHint: { fontSize: 13, color: colors.grey600, marginTop: 4, textAlign: "center" },

  expenseCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.grey200,
  },
  expenseIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E3F2E4",
    alignItems: "center",
    justifyContent: "center",
  },
  expenseTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.grey900 },

  openBillsTitle: { fontSize: 12, fontWeight: "800", color: colors.grey600, letterSpacing: 0.8, marginLeft: 4, marginBottom: 8 },
  openBillsHint: { fontSize: 12, color: colors.grey500, textAlign: "center", marginTop: 6 },
  billCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.grey200,
  },
  billIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E3F2E4",
    alignItems: "center",
    justifyContent: "center",
  },
  billName: { fontSize: 16, fontWeight: "700", color: colors.grey900 },
  billMeta: { fontSize: 12, color: colors.grey600, marginTop: 2 },
  billTotal: { fontSize: 16, fontWeight: "800", color: colors.grey900 },

  billHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 2,
    width: "100%",
    maxWidth: 960,
    alignSelf: "center",
  },
  billHeaderText: { fontSize: 13, color: colors.grey600, fontWeight: "700" },
  clear: { color: colors.red500, fontWeight: "700", fontSize: 13 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.grey200,
  },
  name: { fontSize: 15.5, color: colors.grey900, fontWeight: "700" },
  unitPrice: { fontSize: 12.5, color: colors.grey600, marginTop: 2 },
  rowRight: { alignItems: "flex-end", gap: 8 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.grey100,
    borderRadius: 20,
    padding: 3,
    gap: 4,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
  },
  stepPlus: { backgroundColor: colors.primaryDark },
  qty: { minWidth: 26, textAlign: "center", fontSize: 15, fontWeight: "800", color: colors.grey900 },
  qtyReadOnly: { fontSize: 15, fontWeight: "800", color: colors.grey700 },
  lineAmounts: { alignItems: "flex-end" },
  lineTotal: { textAlign: "right", fontSize: 15.5, fontWeight: "800", color: colors.grey900 },
  lineTotalDiscounted: { color: colors.primaryDark },
  lineWas: {
    fontSize: 11,
    color: colors.grey500,
    textDecorationLine: "line-through",
    marginBottom: 1,
  },
  lineDiscountBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    marginTop: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "#E3F2E4",
  },
  lineDiscountOn: { backgroundColor: "#FDECEA" },
  lineDiscountText: { fontSize: 12, fontWeight: "700", color: colors.primaryDark, flexShrink: 1 },
  discountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
    gap: 12,
  },
  discountLabelWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  discountLabel: { fontSize: 14, color: colors.primary, fontWeight: "600" },
  totalNegative: { color: colors.red500, fontWeight: "700" },

  /** Bottom checkout panel: totals + Hold / Charge, lifted off the list. */
  checkout: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 6,
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
  },
  totalsCard: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 6,
    width: "100%",
    maxWidth: 960,
    alignSelf: "center",
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { color: colors.grey600, fontSize: 14 },
  totalValue: { color: colors.grey800, fontSize: 14, fontWeight: "600" },
  totalBold: { fontSize: 18, fontWeight: "800", color: colors.grey900 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.grey300, marginVertical: 8 },

  actionRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 12,
    width: "100%",
    maxWidth: 960,
    alignSelf: "center",
  },
  /** Cart lines and the checkout footer share one centred column on wide tills. */
  cartListContent: {
    padding: 8,
    paddingBottom: 8,
    width: "100%",
    maxWidth: 960,
    alignSelf: "center",
  },
  hold: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 54,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: "#E3F2E4",
  },
  holdText: { color: colors.primaryDark, fontSize: 16, fontWeight: "800" },
  charge: {
    flex: 1,
    height: 54,
    borderRadius: 14,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
  },
  chargeText: { color: colors.white, fontSize: 18, fontWeight: "800" },

  modalBackdrop: { flex: 1, backgroundColor: "#00000066", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 380, backgroundColor: colors.white, borderRadius: 10, padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: "800", color: colors.grey900 },
  modalHint: { fontSize: 13, color: colors.grey600, marginTop: 4, marginBottom: 14 },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.grey900,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  modalCancel: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8 },
  modalCancelText: { color: colors.grey700, fontSize: 15, fontWeight: "700" },
  modalSave: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 8, backgroundColor: colors.primary },
  modalSaveText: { color: colors.white, fontSize: 15, fontWeight: "800" },
});
