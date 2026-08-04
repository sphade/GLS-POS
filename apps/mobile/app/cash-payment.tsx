import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, currencySymbol, denominationsFor, formatMoney, strings } from "@/constants/theme";
import { useCart } from "@/lib/cart";
import { feedbackError, feedbackSaleComplete, feedbackTap } from "@/lib/feedback";

/** Mirrors CashPaymentActivity: bill total, big amount-received input, short block, denomination pills. */
export default function CashPaymentScreen() {
  const router = useRouter();
  const { total, completeSale } = useCart();
  const [received, setReceived] = useState("");
  const currency = "USD";
  const sym = currencySymbol(currency);

  const receivedMinor = Math.round((parseFloat(received || "0") || 0) * 100);
  const short = Math.max(0, total - receivedMinor);
  const change = Math.max(0, receivedMinor - total);
  const canConfirm = receivedMinor >= total && total > 0;

  const addDenomination = (value: number) => {
    feedbackTap();
    const next = (receivedMinor + value * 100) / 100;
    setReceived(next.toFixed(2));
  };

  const onConfirm = () => {
    if (!canConfirm) {
      feedbackError();
      return;
    }
    feedbackSaleComplete();
    const receipt = completeSale({ mode: "Cash", customerName: null, cashReceived: receivedMinor });
    router.replace({ pathname: "/receipt/[id]", params: { id: receipt.id, fromSale: "1" } });
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Cash</Text>
        <Pressable style={styles.headerBtn} onPress={feedbackTap}>
          <Ionicons name="document-text-outline" size={22} color={colors.white} />
        </Pressable>
      </View>

      <View style={styles.amountCard}>
        <View style={styles.billRow}>
          <Text style={styles.billLabel}>{strings.billTotal}</Text>
          <Text style={styles.billLabel}>{formatMoney(total, currency)}</Text>
        </View>
        <View style={styles.divider} />

        <View style={styles.receivedBlock}>
          <Text style={styles.receivedLabel}>{strings.amountReceived}</Text>
          <View style={styles.receivedInputRow}>
            <Text style={styles.currencySym}>{sym}</Text>
            <TextInput
              style={styles.receivedInput}
              value={received}
              onChangeText={setReceived}
              placeholder="0.00"
              placeholderTextColor={colors.hint}
              keyboardType="numeric"
            />
          </View>
        </View>

        {short > 0 ? (
          <View style={styles.shortBlock}>
            <Text style={styles.shortLabel}>{strings.amountShort}</Text>
            <Text style={styles.shortAmount}>{formatMoney(short, currency)}</Text>
          </View>
        ) : receivedMinor > 0 ? (
          <View style={[styles.shortBlock, { backgroundColor: "#E8F5E9" }]}>
            <Text style={styles.shortLabel}>Change Amount</Text>
            <Text style={[styles.shortAmount, { color: colors.green }]}>{formatMoney(change, currency)}</Text>
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.denomWrap}>
        {denominationsFor(currency).map((d) => (
          <Pressable key={d} style={styles.pill} onPress={() => addDenomination(d)}>
            <Text style={styles.pillText}>
              {sym}
              {d}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable
          style={[styles.confirmBtn, !canConfirm && { opacity: 0.6 }]}
          onPress={onConfirm}
          disabled={!canConfirm}
        >
          <Text style={styles.confirmText}>{strings.receivedByCash}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.grey200 },
  header: {
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  headerBtn: { width: 48, alignItems: "center" },
  headerTitle: { color: colors.white, fontSize: 18, fontWeight: "700" },
  amountCard: { backgroundColor: colors.white, borderRadius: 2, elevation: 2, marginBottom: 16 },
  billRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 10 },
  billLabel: { fontSize: 14, color: colors.grey800 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.grey800, marginHorizontal: 12, marginTop: 6 },
  receivedBlock: { alignItems: "center", paddingVertical: 10 },
  receivedLabel: { fontSize: 16, color: colors.grey600, marginBottom: 6 },
  receivedInputRow: { flexDirection: "row", alignItems: "center" },
  currencySym: { fontSize: 28, fontWeight: "700", color: colors.grey800 },
  receivedInput: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.grey800,
    minWidth: 120,
    textAlign: "center",
    padding: 0,
  },
  shortBlock: { backgroundColor: colors.blue50, alignItems: "center", paddingVertical: 10 },
  shortLabel: { fontSize: 16, color: colors.hint, marginBottom: 4 },
  shortAmount: { fontSize: 30, fontWeight: "700", color: colors.grey400 },
  denomWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 16 },
  pill: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.grey400,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 32,
  },
  pillText: { fontSize: 14, color: colors.grey800, fontWeight: "600" },
  bottomBar: { backgroundColor: colors.white, padding: 8 },
  confirmBtn: {
    backgroundColor: colors.green,
    borderRadius: 6,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  confirmText: { color: colors.white, fontSize: 16, fontWeight: "700" },
});
