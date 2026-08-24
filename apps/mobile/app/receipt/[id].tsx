import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { colors, formatAmount, formatMoney, strings } from "@/constants/theme";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
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
  const [busy, setBusy] = useState(false);
  const receipt = receipts.find((r) => r.id === id);

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

  const subtotal = receipt.lines.reduce((s, l) => s + l.price * l.qty, 0);
  const tax = receipt.total - subtotal;
  const time = new Date(receipt.createdAt);

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
          {can("sale:refund") && (
            <Pressable
              style={[styles.outlineBtn, { borderColor: colors.red500 }]}
              onPress={() =>
                Alert.alert("Refunds", "Refunds aren't built yet — coming next.")
              }
            >
              <Text style={[styles.outlineBtnText, { color: colors.red500 }]}>RETURN</Text>
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

          {receipt.lines.map((l, idx) => (
            <View key={idx} style={styles.itemRow}>
              <Text style={[styles.itemText, { flex: 1 }]} numberOfLines={1}>
                {l.name}
              </Text>
              <Text style={[styles.itemText, styles.colPrice]}>{formatAmount(l.price)}</Text>
              <Text style={[styles.itemText, styles.colQty]}>{l.qty}</Text>
              <Text style={[styles.itemText, styles.colTotal]}>{formatAmount(l.price * l.qty)}</Text>
            </View>
          ))}

          <View style={styles.hr} />
          <TotalLine label={strings.subtotal} value={formatMoney(subtotal, receipt.currency)} />
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
  itemRow: { flexDirection: "row", paddingVertical: 4 },
  itemText: { fontSize: 12, color: colors.grey800 },
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
