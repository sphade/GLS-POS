import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { useCart } from "@/lib/cart";
import { useCatalog } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import {
  NON_RESTOCK_REASONS,
  REFUND_METHODS,
  RETURN_REASONS,
  isOverReturned,
  lineNetForQty,
  quoteReturn,
  receiptTaxOf,
  refundedTotalOf,
  remainingByLine,
  useReturns,
  type RefundMethod,
  type ReturnReason,
} from "@/lib/returns";
import { feedbackError, feedbackTap } from "@/lib/feedback";

/**
 * Build a return against one receipt.
 *
 * Quantities are capped per line at what's still returnable, and the refund is
 * computed from the original receipt — the cashier never types an amount. An
 * unpaid receipt can still be returned, but no money moves: that's a void, so
 * the method is locked to "No refund".
 */
export default function ReturnScreen() {
  const router = useRouter();
  const { receiptId } = useLocalSearchParams<{ receiptId: string }>();
  const { receipts } = useCart();
  const { products } = useCatalog();
  const { store } = useStore();
  const { user, can } = useAuth();
  const { returnsFor, createReturn } = useReturns();

  const receipt = receipts.find((r) => r.id === receiptId);

  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [restockOverride, setRestockOverride] = useState<Record<number, boolean>>({});
  const [reason, setReason] = useState<ReturnReason>("changed_mind");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<RefundMethod>("Cash");
  const [saving, setSaving] = useState(false);

  const prior = receipt ? returnsFor(receipt.id) : [];
  const remaining = useMemo(
    () => (receipt ? remainingByLine(receipt, prior) : []),
    [receipt, prior],
  );

  /**
   * Which lines can go back into stock at all. Untracked items (and variants the
   * owner excluded from auto stock) refund money without touching a count, so
   * they get no toggle.
   */
  const trackedByLine = useMemo(() => {
    if (!receipt) return [];
    return receipt.lines.map((line) => {
      if (!line.productId) return false;
      const product = products.find((p) => p.id === line.productId);
      if (!product) return false;
      if (line.variantId) {
        const variant = product.variants?.find((v) => v.id === line.variantId);
        return !!variant && variant.stock != null && variant.autoUpdateStock;
      }
      return product.stockQuantity != null;
    });
  }, [receipt, products]);

  /** Damaged and expired goods come back but don't go on the shelf. */
  const restockDefault = !NON_RESTOCK_REASONS.includes(reason);
  const restockOf = (index: number) =>
    restockOverride[index] ?? (trackedByLine[index] === true && restockDefault);

  const selections = useMemo(
    () =>
      Object.entries(quantities)
        .map(([index, qty]) => ({ lineIndex: Number(index), qty }))
        .filter((s) => s.qty > 0),
    [quantities],
  );

  const quote = useMemo(
    () => (receipt ? quoteReturn(receipt, selections, prior) : null),
    [receipt, selections, prior],
  );

  if (!receipt) {
    return (
      <Shell title="Return" onBack={() => router.back()}>
        <Text style={styles.notice}>Receipt not found.</Text>
      </Shell>
    );
  }

  if (!can("sale:refund")) {
    return (
      <Shell title="Return" onBack={() => router.back()}>
        <Text style={styles.notice}>Your role can't process returns. Ask a manager or the owner.</Text>
      </Shell>
    );
  }

  const alreadyRefunded = refundedTotalOf(prior);
  const nothingLeft = remaining.every((qty) => qty === 0);
  const overReturned = isOverReturned(receipt, prior);
  const isVoid = receipt.status === "unpaid";
  const effectiveMethod: RefundMethod = isVoid ? "No refund" : method;

  const setQty = (index: number, next: number) => {
    const capped = Math.min(Math.max(0, next), remaining[index] ?? 0);
    setQuantities((prev) => ({ ...prev, [index]: capped }));
  };

  const selectAll = () => {
    feedbackTap();
    const next: Record<number, number> = {};
    remaining.forEach((qty, index) => {
      if (qty > 0) next[index] = qty;
    });
    setQuantities(next);
  };

  const clearAll = () => {
    feedbackTap();
    setQuantities({});
  };

  const submit = () => {
    if (!quote || quote.itemCount === 0 || saving) {
      feedbackError();
      return;
    }
    const summary = isVoid
      ? `Void ${quote.itemCount} item(s) from ${receipt.number}? No money will be refunded.`
      : `Refund ${formatMoney(quote.total, receipt.currency)} for ${quote.itemCount} item(s) from ${receipt.number} via ${effectiveMethod}?`;

    Alert.alert(isVoid ? "Confirm void" : "Confirm refund", summary, [
      { text: "Cancel", style: "cancel" },
      {
        text: isVoid ? "Void items" : "Refund",
        style: "destructive",
        onPress: () => {
          setSaving(true);
          const result = createReturn({
            receipt,
            lines: selections.map((s) => ({
              lineIndex: s.lineIndex,
              qty: s.qty,
              restock: restockOf(s.lineIndex),
            })),
            reason,
            note,
            method: effectiveMethod,
            storeName: receipt.storeName || store.name,
            storeReference: receipt.storeReference ?? store.reference,
            servedBy: user?.name ?? "Staff",
          });
          if (!result.ok) {
            setSaving(false);
            feedbackError();
            Alert.alert("Couldn't complete the return", result.message);
            return;
          }
          feedbackTap();
          router.replace(`/return-receipt/${result.ret.id}?fresh=1` as Href);
        },
      },
    ]);
  };

  return (
    <Shell title={isVoid ? "Void items" : "Return items"} onBack={() => router.back()}>
      <ScrollView contentContainerStyle={{ padding: 10, paddingBottom: 24 }}>
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Receipt</Text>
            <Text style={styles.cardValue}>{receipt.number}</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Sold</Text>
            <Text style={styles.cardValue}>
              {new Date(receipt.createdAt).toLocaleDateString()} ·{" "}
              {formatMoney(receipt.total, receipt.currency)}
            </Text>
          </View>
          {alreadyRefunded > 0 && (
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Already refunded</Text>
              <Text style={[styles.cardValue, { color: colors.red500 }]}>
                {formatMoney(alreadyRefunded, receipt.currency)}
              </Text>
            </View>
          )}
        </View>

        {overReturned && (
          <View style={styles.warnBanner}>
            <MaterialCommunityIcons name="alert-outline" size={18} color={colors.red800} />
            <Text style={styles.warnText}>
              This receipt has more returns on record than it sold — likely two tills refunding
              offline. Have a manager review it.
            </Text>
          </View>
        )}

        {isVoid && (
          <View style={styles.infoBanner}>
            <MaterialCommunityIcons name="information-outline" size={18} color={colors.primaryDark} />
            <Text style={styles.infoText}>
              This receipt was never paid, so nothing is refunded. The items are voided and stock is
              restored.
            </Text>
          </View>
        )}

        {nothingLeft ? (
          <Text style={styles.notice}>Every item on this receipt has already been returned.</Text>
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>ITEMS TO RETURN</Text>
              <View style={styles.sectionActions}>
                <Pressable hitSlop={8} onPress={selectAll}>
                  <Text style={styles.linkAction}>All</Text>
                </Pressable>
                <Pressable hitSlop={8} onPress={clearAll}>
                  <Text style={styles.linkAction}>None</Text>
                </Pressable>
              </View>
            </View>

            {receipt.lines.map((line, index) => {
              const left = remaining[index] ?? 0;
              const qty = quantities[index] ?? 0;
              if (left === 0) {
                return (
                  <View key={index} style={[styles.lineCard, styles.lineDone]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineName} numberOfLines={1}>
                        {line.name}
                      </Text>
                      <Text style={styles.lineMeta}>Fully returned</Text>
                    </View>
                    <Ionicons name="checkmark-circle" size={20} color={colors.grey400} />
                  </View>
                );
              }
              return (
                <View key={index} style={styles.lineCard}>
                  <View style={styles.lineTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineName} numberOfLines={2}>
                        {line.name}
                      </Text>
                      <Text style={styles.lineMeta}>
                        {formatMoney(line.price, receipt.currency)} each · {left} of {line.qty}{" "}
                        returnable
                      </Text>
                      {(line.discount ?? 0) + (line.orderDiscountShare ?? 0) > 0 && (
                        <Text style={styles.lineDiscountNote}>
                          Sold with a discount — refund is based on what was paid
                        </Text>
                      )}
                    </View>
                    <View style={styles.stepper}>
                      <Pressable
                        style={[styles.stepBtn, styles.stepMinus, qty === 0 && styles.stepDisabled]}
                        disabled={qty === 0}
                        onPress={() => {
                          feedbackTap();
                          setQty(index, qty - 1);
                        }}
                      >
                        <Ionicons name="remove" size={20} color={colors.white} />
                      </Pressable>
                      <Text style={styles.qty}>{qty}</Text>
                      <Pressable
                        style={[styles.stepBtn, styles.stepPlus, qty >= left && styles.stepDisabled]}
                        disabled={qty >= left}
                        onPress={() => {
                          feedbackTap();
                          setQty(index, qty + 1);
                        }}
                      >
                        <Ionicons name="add" size={20} color={colors.white} />
                      </Pressable>
                    </View>
                  </View>

                  {qty > 0 && (
                    <View style={styles.lineBottom}>
                      {trackedByLine[index] ? (
                        <Pressable
                          style={styles.restockRow}
                          hitSlop={6}
                          onPress={() => {
                            feedbackTap();
                            setRestockOverride((prev) => ({ ...prev, [index]: !restockOf(index) }));
                          }}
                        >
                          <Ionicons
                            name={restockOf(index) ? "checkbox" : "square-outline"}
                            size={20}
                            color={restockOf(index) ? colors.primary : colors.grey500}
                          />
                          <Text style={styles.restockText}>
                            {restockOf(index) ? "Back into stock" : "Write off (not restocked)"}
                          </Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.untrackedText}>Not stock-tracked</Text>
                      )}
                      <Text style={styles.lineAmount}>
                        {formatMoney(lineNetForQty(line, qty), receipt.currency)}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}

            <Text style={styles.sectionTitle}>REASON</Text>
            <View style={styles.chipWrap}>
              {RETURN_REASONS.map((r) => (
                <Pressable
                  key={r.key}
                  style={[styles.chip, reason === r.key && styles.chipActive]}
                  onPress={() => {
                    feedbackTap();
                    setReason(r.key);
                  }}
                >
                  <Text style={[styles.chipText, reason === r.key && styles.chipTextActive]}>
                    {r.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {!isVoid && (
              <>
                <Text style={styles.sectionTitle}>REFUND METHOD</Text>
                <View style={styles.chipWrap}>
                  {REFUND_METHODS.map((m) => (
                    <Pressable
                      key={m}
                      style={[styles.chip, method === m && styles.chipActive]}
                      onPress={() => {
                        feedbackTap();
                        setMethod(m);
                      }}
                    >
                      <Text style={[styles.chipText, method === m && styles.chipTextActive]}>{m}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.sectionTitle}>NOTE (OPTIONAL)</Text>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="e.g. bottle was cracked"
              placeholderTextColor={colors.grey500}
              multiline
              maxLength={200}
            />

            {quote && quote.itemCount > 0 && (
              <View style={styles.totalsCard}>
                <TotalRow label="Items" value={String(quote.itemCount)} />
                <TotalRow
                  label="Subtotal"
                  value={formatMoney(quote.subtotal, receipt.currency)}
                />
                {receiptTaxOf(receipt) > 0 && (
                  <TotalRow label="Tax" value={formatMoney(quote.taxTotal, receipt.currency)} />
                )}
                <View style={styles.divider} />
                <TotalRow
                  label={isVoid ? "Voided value" : "Total refund"}
                  value={formatMoney(quote.total, receipt.currency)}
                  bold
                />
              </View>
            )}
          </>
        )}
      </ScrollView>

      {!nothingLeft && (
        <View style={styles.bottomBar}>
          <Pressable
            style={[
              styles.submitBtn,
              (!quote || quote.itemCount === 0 || saving) && styles.submitDisabled,
            ]}
            disabled={!quote || quote.itemCount === 0 || saving}
            onPress={submit}
          >
            <Text style={styles.submitText}>
              {quote && quote.itemCount > 0
                ? isVoid
                  ? `VOID ${quote.itemCount} ITEM(S)`
                  : `REFUND ${formatMoney(quote.total, receipt.currency)}`
                : "SELECT ITEMS TO RETURN"}
            </Text>
          </Pressable>
        </View>
      )}
    </Shell>
  );
}

function Shell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.headerBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerBtn} />
      </View>
      {children}
    </SafeAreaView>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, bold && styles.totalBold]}>{label}</Text>
      <Text style={[styles.totalValue, bold && styles.totalBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  header: {
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  headerBtn: { width: 48, alignItems: "center" },
  headerTitle: { flex: 1, color: colors.white, fontSize: 19, fontWeight: "700" },
  notice: { textAlign: "center", marginTop: 32, marginHorizontal: 24, color: colors.grey700, fontSize: 14, lineHeight: 20 },

  card: { backgroundColor: colors.card, borderRadius: 4, padding: 12, marginBottom: 8, elevation: 1 },
  cardRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, gap: 12 },
  cardLabel: { color: colors.grey600, fontSize: 13 },
  cardValue: { color: colors.grey900, fontSize: 13, fontWeight: "700" },

  warnBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#FDECEA",
    borderRadius: 4,
    padding: 10,
    marginBottom: 8,
  },
  warnText: { flex: 1, color: colors.red800, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: colors.blue50,
    borderRadius: 4,
    padding: 10,
    marginBottom: 8,
  },
  infoText: { flex: 1, color: colors.primaryDark, fontSize: 12, lineHeight: 17, fontWeight: "600" },

  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionActions: { flexDirection: "row", gap: 14 },
  linkAction: { color: colors.primary, fontWeight: "800", fontSize: 13 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.grey600,
    letterSpacing: 0.7,
    marginTop: 14,
    marginBottom: 6,
    marginLeft: 2,
  },

  lineCard: { backgroundColor: colors.card, borderRadius: 4, padding: 12, marginBottom: 8, elevation: 1 },
  lineDone: { flexDirection: "row", alignItems: "center", gap: 10, opacity: 0.7 },
  lineTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  lineName: { fontSize: 15, color: colors.grey900, fontWeight: "600" },
  lineMeta: { fontSize: 12, color: colors.grey600, marginTop: 3 },
  lineBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.grey300,
    gap: 10,
  },
  restockRow: { flexDirection: "row", alignItems: "center", gap: 7, flex: 1 },
  restockText: { fontSize: 12, color: colors.grey700, fontWeight: "600", flexShrink: 1 },
  untrackedText: { flex: 1, fontSize: 12, color: colors.grey500, fontStyle: "italic" },
  lineDiscountNote: { fontSize: 11, color: colors.primaryDark, marginTop: 3, fontWeight: "600" },
  lineAmount: { fontSize: 14, fontWeight: "800", color: colors.grey900 },

  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: { width: 36, height: 36, borderRadius: 6, alignItems: "center", justifyContent: "center", elevation: 1 },
  stepMinus: { backgroundColor: colors.actionRemove },
  stepPlus: { backgroundColor: colors.actionAdd },
  stepDisabled: { opacity: 0.35 },
  qty: { minWidth: 24, textAlign: "center", fontSize: 16, fontWeight: "800", color: colors.grey900 },

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.grey400,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.white,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.blue50 },
  chipText: { fontSize: 13, color: colors.grey700, fontWeight: "600" },
  chipTextActive: { color: colors.primaryDark, fontWeight: "800" },

  noteInput: {
    backgroundColor: colors.white,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.grey300,
    padding: 12,
    minHeight: 72,
    fontSize: 14,
    color: colors.grey900,
    textAlignVertical: "top",
  },

  totalsCard: { backgroundColor: colors.card, borderRadius: 4, padding: 12, marginTop: 14, elevation: 1 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { color: colors.grey600, fontSize: 14 },
  totalValue: { color: colors.grey800, fontSize: 14, fontWeight: "600" },
  totalBold: { fontSize: 17, fontWeight: "800", color: colors.red500 },
  divider: { height: 1, backgroundColor: colors.grey300, marginVertical: 6 },

  bottomBar: { padding: 10, backgroundColor: colors.screenBg },
  submitBtn: {
    height: 54,
    borderRadius: 6,
    backgroundColor: colors.red500,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
  },
  submitDisabled: { backgroundColor: colors.grey400, elevation: 0 },
  submitText: { color: colors.white, fontSize: 17, fontWeight: "800", letterSpacing: 0.4 },
});
