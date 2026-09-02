import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { colors, formatAmount, formatMoney, strings } from "@/constants/theme";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import {
  isOverReturned,
  isVoidReturn,
  lineNetOf,
  receiptNetOf,
  receiptTaxOf,
  refundedTotalOf,
  remainingByLine,
  returnStateOf,
  useReturns,
} from "@/lib/returns";
import { discountLabel } from "@/lib/discount-model";
import { getSavedPrinter, printReceipt } from "@/lib/printer";
import {
  printViaSystem,
  sendReceiptSms,
  sendReceiptWhatsApp,
  shareReceiptPdf,
  shareReceiptText,
} from "@/lib/receipt-share";
import { feedbackError, feedbackTap } from "@/lib/feedback";

export default function ReceiptScreen() {
  const { id, fromSale } = useLocalSearchParams<{ id: string; fromSale?: string }>();
  const router = useRouter();
  const { receipts, settleReceipt } = useCart();
  const { can } = useAuth();
  const { returnsFor } = useReturns();
  const [busy, setBusy] = useState(false);
  const receipt = receipts.find((r) => r.id === id);
  const returns = receipt ? returnsFor(receipt.id) : [];

  /** Run a share/print action, surfacing any failure instead of failing silently. */
  const run = async (fn: () => Promise<void>) => {
    feedbackTap();
    try {
      await fn();
    } catch (e) {
      feedbackError();
      Alert.alert("Couldn't do that", (e as Error).message);
    }
  };

  /**
   * Print on the paired thermal printer. If none is set up (or it's a Classic
   * printer we can't reach), offer the system print dialog / PDF instead.
   */
  const onPrint = async () => {
    if (!receipt) return;
    feedbackTap();
    if (!getSavedPrinter()) {
      Alert.alert("No printer paired", "Pair a Bluetooth printer, or use the phone's print dialog.", [
        { text: "Printer setup", onPress: () => router.push("/printer-setup" as Href) },
        { text: "Use phone print", onPress: () => void run(() => printViaSystem(receipt)) },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    setBusy(true);
    try {
      await printReceipt(receipt);
    } catch (e) {
      feedbackError();
      Alert.alert("Print failed", (e as Error).message, [
        { text: "Use phone print", onPress: () => void run(() => printViaSystem(receipt)) },
        { text: "OK" },
      ]);
    } finally {
      setBusy(false);
    }
  };



  if (!receipt) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.grey800} />
          </Pressable>
          <Text style={styles.headerTitleDark}>Receipt</Text>
          <View style={styles.headerBtn} />
        </View>
        <Text style={styles.notFound}>Receipt not found.</Text>
      </SafeAreaView>
    );
  }

  /**
   * Gross is the list value; net is what was actually charged before tax. With
   * no discount the two are equal, which is why older receipts still read the
   * same. Tax is whatever the total holds above the net.
   */
  const gross = receipt.lines.reduce((s, l) => s + l.price * l.qty, 0);
  const net = receiptNetOf(receipt);
  const discountTotal = receipt.discountTotal ?? Math.max(0, gross - net);
  const tax = receiptTaxOf(receipt);
  const time = new Date(receipt.createdAt);

  /**
   * Return state is derived from this receipt's credit notes, never stored on
   * the receipt itself — the printed original stays immutable and two tills
   * can't overwrite each other's refund.
   */
  const returnState = returnStateOf(receipt, returns);
  const refunded = refundedTotalOf(returns);
  const returnable = remainingByLine(receipt, returns).some((qty) => qty > 0);
  const overReturned = isOverReturned(receipt, returns);
  const netTotal = Math.max(0, receipt.total - refunded);

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.grey800} />
        </Pressable>
        <View style={styles.headerActions}>
          <Pressable style={styles.actionBtn} onPress={() => run(() => shareReceiptText(receipt))}>
            <Ionicons name="share-social-outline" size={22} color={colors.grey800} />
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => run(() => sendReceiptSms(receipt))}>
            <MaterialCommunityIcons name="message-text-outline" size={22} color={colors.grey800} />
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => run(() => sendReceiptWhatsApp(receipt))}>
            <MaterialCommunityIcons name="whatsapp" size={22} color={colors.grey800} />
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => run(() => shareReceiptPdf(receipt))}>
            <Ionicons name="download-outline" size={22} color={colors.grey800} />
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={onPrint} disabled={busy}>
            {busy ? (
              <ActivityIndicator size="small" color={colors.grey800} />
            ) : (
              <Ionicons name="print-outline" size={22} color={colors.grey800} />
            )}
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 10, paddingBottom: 24 }}>
        <View style={styles.actionRow}>
          {/* Settle unpaid receipts (Card/Transfer/Credit print first, pay after). */}
          {receipt.status === "unpaid" && can("sale:create") && (
            <Pressable
              style={[styles.outlineBtn, { borderColor: colors.green }]}
              onPress={() => {
                feedbackTap();
                settleReceipt(receipt.id);
              }}
            >
              <Text style={[styles.outlineBtnText, { color: colors.green }]}>MARK AS PAID</Text>
            </Pressable>
          )}
          {can("sale:refund") && returnable && (
            <Pressable
              style={[styles.outlineBtn, { borderColor: colors.red500 }]}
              onPress={() => {
                feedbackTap();
                router.push(`/return/${receipt.id}` as Href);
              }}
            >
              <Text style={[styles.outlineBtnText, { color: colors.red500 }]}>
                {receipt.status === "unpaid" ? "VOID ITEMS" : "RETURN"}
              </Text>
            </Pressable>
          )}
        </View>

        {receipt.status === "unpaid" && (
          <View style={styles.unpaidBanner}>
            <MaterialCommunityIcons name="clock-alert-outline" size={18} color={colors.red500} />
            <Text style={styles.unpaidBannerText}>
              UNPAID · {receipt.mode.toUpperCase()} — customer pays against this receipt
            </Text>
          </View>
        )}

        {returnState !== "none" && (
          <View style={styles.returnBanner}>
            <MaterialCommunityIcons name="cash-refund" size={18} color={colors.red800} />
            <Text style={styles.returnBannerText}>
              {returnState === "full" ? "FULLY RETURNED" : "PARTIALLY RETURNED"} ·{" "}
              {formatMoney(refunded, receipt.currency)} refunded
              {returnState === "partial" ? ` · ${formatMoney(netTotal, receipt.currency)} net` : ""}
            </Text>
          </View>
        )}

        {overReturned && (
          <View style={styles.returnBanner}>
            <MaterialCommunityIcons name="alert-outline" size={18} color={colors.red800} />
            <Text style={styles.returnBannerText}>
              More has been returned than was sold — likely two tills refunding offline. Needs a
              manager review.
            </Text>
          </View>
        )}

        {returns.length > 0 && (
          <View style={styles.returnList}>
            <Text style={styles.returnListTitle}>CREDIT NOTES</Text>
            {returns.map((ret) => (
              <Pressable
                key={ret.id}
                style={styles.returnRow}
                onPress={() => {
                  feedbackTap();
                  router.push(`/return-receipt/${ret.id}` as Href);
                }}
                android_ripple={{ color: "#00000010" }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.returnRowTitle}>
                    {ret.number}
                    {isVoidReturn(ret) ? " · VOID" : ""}
                  </Text>
                  <Text style={styles.returnRowMeta}>
                    {ret.itemCount} item{ret.itemCount === 1 ? "" : "s"} ·{" "}
                    {new Date(ret.createdAt).toLocaleDateString()} · {ret.method}
                  </Text>
                </View>
                <Text style={styles.returnRowAmount}>
                  -{formatMoney(ret.total, ret.currency)}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.grey500} />
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.receiptCard}>
          <Text style={styles.storeName}>{receipt.storeName}</Text>
          {receipt.storeReference ? <Text style={styles.storeMeta}>{receipt.storeReference}</Text> : null}
          <View style={styles.hr} />

          <Text style={styles.line}>Served by: {receipt.servedBy}</Text>
          {receipt.customerName ? <Text style={styles.line}>Customer: {receipt.customerName}</Text> : null}
          <Text style={styles.line}>Invoice: {receipt.number}</Text>
          <Text style={styles.line}>
            {time.toLocaleDateString()} - {time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </Text>

          <View style={styles.summaryStrip}>
            <SummaryCol label="P Mode" value={receipt.mode.toUpperCase()} />
            <SummaryCol label="I#" value={String(receipt.lines.length)} />
            <SummaryCol label="U#" value={String(receipt.itemCount)} />
            <SummaryCol label="Amount" value={formatMoney(receipt.total, receipt.currency)} />
          </View>

          <View style={styles.itemsHeader}>
            <Text style={[styles.itemsHeaderText, { flex: 1 }]}>Name</Text>
            <Text style={[styles.itemsHeaderText, styles.colPrice]}>Price</Text>
            <Text style={[styles.itemsHeaderText, styles.colQty]}>Qty</Text>
            <Text style={[styles.itemsHeaderText, styles.colTotal]}>Total</Text>
          </View>

          {receipt.lines.map((l, idx) => {
            const lineGross = l.price * l.qty;
            const lineNet = lineNetOf(l);
            return (
              <View key={idx} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemText} numberOfLines={1}>
                    {l.name}
                  </Text>
                  {lineNet < lineGross && (
                    <Text style={styles.itemDiscountNote}>
                      less {formatAmount(lineGross - lineNet)} discount
                    </Text>
                  )}
                </View>
                <Text style={[styles.itemText, styles.colPrice]}>{formatAmount(l.price)}</Text>
                <Text style={[styles.itemText, styles.colQty]}>{l.qty}</Text>
                <Text style={[styles.itemText, styles.colTotal]}>{formatAmount(lineNet)}</Text>
              </View>
            );
          })}

          <View style={styles.hr} />
          <TotalLine label={strings.subtotal} value={formatMoney(gross, receipt.currency)} />
          {discountTotal > 0 && (
            <TotalLine
              label={
                receipt.orderDiscount
                  ? `Discount (${discountLabel(receipt.orderDiscount)})`
                  : "Discount"
              }
              value={`-${formatMoney(discountTotal, receipt.currency)}`}
            />
          )}
          {discountTotal > 0 && (
            <TotalLine label="After discount" value={formatMoney(net, receipt.currency)} />
          )}
          {tax > 0 && <TotalLine label="Tax" value={formatMoney(tax, receipt.currency)} />}
          <View style={styles.hr} />
          <TotalLine label={strings.grandTotal} value={formatMoney(receipt.total, receipt.currency)} bold />

          {receipt.cashReceived != null && (
            <>
              <View style={styles.hr} />
              <TotalLine label="Cash Received" value={formatMoney(receipt.cashReceived, receipt.currency)} />
              <TotalLine
                label="Change Amount"
                value={formatMoney(Math.max(0, receipt.cashReceived - receipt.total), receipt.currency)}
              />
            </>
          )}

          <Text style={styles.thankYou}>{strings.thankYou}</Text>
          <Text style={styles.poweredBy}>Powered By GLS-POS</Text>
        </View>
      </ScrollView>

      {fromSale === "1" && (
        <View style={styles.newSaleBar}>
          <Pressable
            style={styles.newSaleBtn}
            onPress={() => {
              feedbackTap();
              router.replace("/(tabs)");
            }}
          >
            <Text style={styles.newSaleText}>{strings.newSale}</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

function SummaryCol({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function TotalLine({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.totalLine}>
      <Text style={[styles.totalLabel, bold && styles.totalBold]}>{label}</Text>
      <Text style={[styles.totalValue, bold && styles.totalBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.grey200 },
  header: {
    backgroundColor: colors.grey50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    elevation: 2,
  },
  headerBtn: { width: 48, alignItems: "center" },
  headerTitleDark: { color: colors.grey800, fontSize: 18, fontWeight: "700" },
  headerActions: { flexDirection: "row", alignItems: "center" },
  actionBtn: { paddingHorizontal: 8 },
  notFound: { textAlign: "center", marginTop: 40, color: colors.grey600 },
  actionRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginBottom: 8 },
  outlineBtn: { borderWidth: 1, borderColor: colors.primary, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 6 },
  outlineBtnText: { color: colors.primary, fontWeight: "700", fontSize: 12 },
  unpaidBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FDECEA",
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  unpaidBannerText: { flex: 1, color: colors.red500, fontWeight: "700", fontSize: 12, letterSpacing: 0.3 },
  returnBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#FDECEA",
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  returnBannerText: { flex: 1, color: colors.red800, fontWeight: "700", fontSize: 12, lineHeight: 17 },
  returnList: { backgroundColor: colors.white, borderRadius: 4, paddingVertical: 4, marginBottom: 8, elevation: 1 },
  returnListTitle: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.grey600,
    letterSpacing: 0.7,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 2,
  },
  returnRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  returnRowTitle: { fontSize: 13, fontWeight: "700", color: colors.grey900 },
  returnRowMeta: { fontSize: 11, color: colors.grey600, marginTop: 2 },
  returnRowAmount: { fontSize: 13, fontWeight: "800", color: colors.red500 },
  receiptCard: { backgroundColor: colors.white, borderRadius: 4, padding: 14, elevation: 2 },
  storeName: { fontSize: 20, fontWeight: "800", color: colors.grey900, textAlign: "center" },
  storeMeta: { fontSize: 13, color: colors.grey600, textAlign: "center", marginTop: 2 },
  hr: { height: StyleSheet.hairlineWidth, backgroundColor: colors.grey400, marginVertical: 8 },
  line: { fontSize: 12, color: colors.grey700, marginTop: 1 },
  summaryStrip: { flexDirection: "row", marginTop: 10, paddingVertical: 8, backgroundColor: colors.grey100, borderRadius: 3 },
  summaryLabel: { fontSize: 10, color: colors.grey600, fontWeight: "700" },
  summaryValue: { fontSize: 12, color: colors.grey900, fontWeight: "700", marginTop: 2 },
  itemsHeader: { flexDirection: "row", marginTop: 12, paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.grey400 },
  itemsHeaderText: { fontSize: 11, fontWeight: "800", color: colors.grey700 },
  colPrice: { width: 56, textAlign: "right" },
  colQty: { width: 34, textAlign: "right" },
  colTotal: { width: 62, textAlign: "right" },
  itemRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  itemText: { fontSize: 12, color: colors.grey800 },
  itemDiscountNote: { fontSize: 10, color: colors.red500, fontWeight: "700", marginTop: 1 },
  totalLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalLabel: { fontSize: 13, color: colors.grey700 },
  totalValue: { fontSize: 13, color: colors.grey900, fontWeight: "600" },
  totalBold: { fontSize: 16, fontWeight: "800", color: colors.grey900 },
  thankYou: { textAlign: "center", marginTop: 14, fontSize: 13, color: colors.grey700, fontWeight: "600" },
  poweredBy: { textAlign: "center", marginTop: 6, fontSize: 12, color: colors.grey400, fontWeight: "700" },
  newSaleBar: { backgroundColor: colors.grey200, padding: 10 },
  newSaleBtn: { backgroundColor: colors.green, height: 52, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  newSaleText: { color: colors.white, fontSize: 18, fontWeight: "700" },
});
