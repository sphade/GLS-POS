import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { colors, formatAmount, formatMoney } from "@/constants/theme";
import { isVoidReturn, reasonLabel, returnLineNetOf, useReturns } from "@/lib/returns";
import { getSavedPrinter, printReturn } from "@/lib/printer";
import {
  printReturnViaSystem,
  sendReturnSms,
  sendReturnWhatsApp,
  shareReturnPdf,
  shareReturnText,
} from "@/lib/receipt-share";
import { feedbackError, feedbackTap } from "@/lib/feedback";

/**
 * The credit note for one return: what came back, what was refunded, and why.
 *
 * Reached straight after processing a return (`fresh=1`) or from the receipt it
 * reverses. Printing and sharing mirror the sale receipt exactly, so a refund
 * can always be evidenced even with no printer paired.
 */
export default function ReturnReceiptScreen() {
  const router = useRouter();
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const { returns } = useReturns();
  const [busy, setBusy] = useState(false);

  const ret = returns.find((r) => r.id === id);

  const run = async (fn: () => Promise<void>) => {
    feedbackTap();
    try {
      await fn();
    } catch (e) {
      feedbackError();
      Alert.alert("Couldn't do that", (e as Error).message);
    }
  };

  const onPrint = async () => {
    if (!ret) return;
    feedbackTap();
    if (!getSavedPrinter()) {
      Alert.alert("No printer paired", "Pair a Bluetooth printer, or use the phone's print dialog.", [
        { text: "Printer setup", onPress: () => router.push("/printer-setup" as Href) },
        { text: "Use phone print", onPress: () => void run(() => printReturnViaSystem(ret)) },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    setBusy(true);
    try {
      await printReturn(ret);
    } catch (e) {
      feedbackError();
      Alert.alert("Print failed", (e as Error).message, [
        { text: "Use phone print", onPress: () => void run(() => printReturnViaSystem(ret)) },
        { text: "OK" },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (!ret) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color={colors.grey800} />
          </Pressable>
          <Text style={styles.headerTitleDark}>Credit note</Text>
          <View style={styles.headerBtn} />
        </View>
        <Text style={styles.notFound}>Credit note not found.</Text>
      </SafeAreaView>
    );
  }

  const voided = isVoidReturn(ret);
  const time = new Date(ret.createdAt);

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.grey800} />
        </Pressable>
        <View style={styles.headerActions}>
          <Pressable style={styles.actionBtn} onPress={() => run(() => shareReturnText(ret))}>
            <Ionicons name="share-social-outline" size={22} color={colors.grey800} />
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => run(() => sendReturnSms(ret))}>
            <MaterialCommunityIcons name="message-text-outline" size={22} color={colors.grey800} />
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => run(() => sendReturnWhatsApp(ret))}>
            <MaterialCommunityIcons name="whatsapp" size={22} color={colors.grey800} />
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => run(() => shareReturnPdf(ret))}>
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
        <View style={styles.banner}>
          <MaterialCommunityIcons
            name={voided ? "cancel" : "cash-refund"}
            size={18}
            color={colors.red800}
          />
          <Text style={styles.bannerText}>
            {voided ? "VOIDED — no money was refunded" : "RETURN — credit note"}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.storeName}>{ret.storeName}</Text>
          {ret.storeReference ? <Text style={styles.storeMeta}>{ret.storeReference}</Text> : null}
          <View style={styles.hr} />

          <Text style={styles.line}>Credit note: {ret.number}</Text>
          <Text style={styles.line}>Against receipt: {ret.receiptNumber}</Text>
          <Text style={styles.line}>Processed by: {ret.servedBy}</Text>
          <Text style={styles.line}>
            {time.toLocaleDateString()} -{" "}
            {time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </Text>

          <View style={styles.itemsHeader}>
            <Text style={[styles.itemsHeaderText, { flex: 1 }]}>Returned</Text>
            <Text style={[styles.itemsHeaderText, styles.colPrice]}>Price</Text>
            <Text style={[styles.itemsHeaderText, styles.colQty]}>Qty</Text>
            <Text style={[styles.itemsHeaderText, styles.colTotal]}>Total</Text>
          </View>

          {ret.lines.map((line, index) => (
            <View key={index} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemText} numberOfLines={1}>
                  {line.name}
                </Text>
                {!line.restock && <Text style={styles.itemNote}>Not restocked</Text>}
              </View>
              <Text style={[styles.itemText, styles.colPrice]}>{formatAmount(line.price)}</Text>
              <Text style={[styles.itemText, styles.colQty]}>{line.qty}</Text>
              <Text style={[styles.itemText, styles.colTotal]}>
                {formatAmount(returnLineNetOf(line))}
              </Text>
            </View>
          ))}

          <View style={styles.hr} />
          <TotalLine label="Subtotal" value={formatMoney(ret.subtotal, ret.currency)} />
          {ret.taxTotal > 0 && (
            <TotalLine label="Tax" value={formatMoney(ret.taxTotal, ret.currency)} />
          )}
          <View style={styles.hr} />
          <TotalLine
            label={voided ? "Voided value" : "Total refunded"}
            value={formatMoney(ret.total, ret.currency)}
            bold
          />
          <View style={styles.hr} />
          <TotalLine label="Reason" value={reasonLabel(ret.reason)} />
          <TotalLine label="Method" value={ret.method} />
          {ret.note ? <Text style={styles.noteText}>Note: {ret.note}</Text> : null}
        </View>

        <Pressable
          style={styles.linkCard}
          onPress={() => {
            feedbackTap();
            router.push(`/receipt/${ret.receiptId}` as Href);
          }}
        >
          <MaterialCommunityIcons name="receipt" size={20} color={colors.primary} />
          <Text style={styles.linkCardText}>View original receipt {ret.receiptNumber}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.grey500} />
        </Pressable>
      </ScrollView>

      {fresh === "1" && (
        <View style={styles.doneBar}>
          <Pressable
            style={styles.doneBtn}
            onPress={() => {
              feedbackTap();
              router.replace("/(tabs)");
            }}
          >
            <Text style={styles.doneText}>DONE</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
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

  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FDECEA",
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  bannerText: { flex: 1, color: colors.red800, fontWeight: "800", fontSize: 12, letterSpacing: 0.4 },

  card: { backgroundColor: colors.white, borderRadius: 4, padding: 14, elevation: 2 },
  storeName: { fontSize: 20, fontWeight: "800", color: colors.grey900, textAlign: "center" },
  storeMeta: { fontSize: 13, color: colors.grey600, textAlign: "center", marginTop: 2 },
  hr: { height: StyleSheet.hairlineWidth, backgroundColor: colors.grey400, marginVertical: 8 },
  line: { fontSize: 12, color: colors.grey700, marginTop: 1 },
  itemsHeader: {
    flexDirection: "row",
    marginTop: 12,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey400,
  },
  itemsHeaderText: { fontSize: 11, fontWeight: "800", color: colors.grey700 },
  colPrice: { width: 56, textAlign: "right" },
  colQty: { width: 34, textAlign: "right" },
  colTotal: { width: 62, textAlign: "right" },
  itemRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  itemText: { fontSize: 12, color: colors.grey800 },
  itemNote: { fontSize: 10, color: colors.red500, fontWeight: "700", marginTop: 1 },
  totalLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, gap: 12 },
  totalLabel: { fontSize: 13, color: colors.grey700 },
  totalValue: { fontSize: 13, color: colors.grey900, fontWeight: "600" },
  totalBold: { fontSize: 16, fontWeight: "800", color: colors.red500 },
  noteText: { fontSize: 12, color: colors.grey700, marginTop: 6, fontStyle: "italic" },

  linkCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.white,
    borderRadius: 4,
    padding: 14,
    marginTop: 8,
    elevation: 1,
  },
  linkCardText: { flex: 1, fontSize: 14, color: colors.grey800, fontWeight: "600" },

  doneBar: { backgroundColor: colors.grey200, padding: 10 },
  doneBtn: {
    backgroundColor: colors.green,
    height: 52,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: { color: colors.white, fontSize: 18, fontWeight: "700" },
});
