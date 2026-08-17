import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { useCart } from "@/lib/cart";
import { getSavedPrinter, printReceipt } from "@/lib/printer";
import { printViaSystem } from "@/lib/receipt-share";
import { feedbackTap } from "@/lib/feedback";

/**
 * Sale confirmation screen shown right after payment: green tick, amount, and
 * the GET RECEIPT / NEW SALE actions (sale_confirmation_page).
 */
export default function SaleSuccessScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { receipts } = useCart();
  const receipt = receipts.find((r) => r.id === id);

  const [busy, setBusy] = useState(false);

  const amount = receipt ? formatMoney(receipt.total, receipt.currency) : formatMoney(0);
  const receiptId = receipt?.number.replace(/^#/, "") ?? "—";
  const itemCount = receipt?.itemCount ?? 0;

  /**
   * Print on the paired thermal printer, falling back to the phone's print
   * dialog when there's no printer or it can't be reached.
   */
  const onPrint = async () => {
    if (!receipt) return;
    feedbackTap();
    const useSystem = () =>
      printViaSystem(receipt).catch((e) => Alert.alert("Couldn't print", (e as Error).message));

    if (!getSavedPrinter()) {
      Alert.alert("No printer paired", "Pair a Bluetooth printer, or use the phone's print dialog.", [
        { text: "Printer setup", onPress: () => router.push("/printer-setup" as Href) },
        { text: "Use phone print", onPress: () => void useSystem() },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    setBusy(true);
    try {
      await printReceipt(receipt);
    } catch (e) {
      Alert.alert("Print failed", (e as Error).message, [
        { text: "Use phone print", onPress: () => void useSystem() },
        { text: "OK" },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        <Ionicons name="checkmark-circle-outline" size={96} color={colors.green} />
        <Text style={styles.amount}>{amount}</Text>
      </View>

      <View style={styles.meta}>
        <Text style={styles.metaText}>RECEIPT ID: {receiptId}</Text>
        <Text style={styles.metaText}>ITEM COUNT: {itemCount}</Text>
      </View>

      <View style={styles.actions}>
        {/* Printing is the next physical step, so put it first. */}
        <Pressable
          style={[styles.button, styles.printBtn, busy && { opacity: 0.6 }]}
          onPress={onPrint}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <Ionicons name="print-outline" size={20} color={colors.white} />
              <Text style={styles.buttonText}>PRINT RECEIPT</Text>
            </>
          )}
        </Pressable>

        <Pressable
          style={[styles.button, styles.getReceipt]}
          onPress={() => {
            feedbackTap();
            router.replace({ pathname: "/receipt/[id]", params: { id: id!, fromSale: "1" } });
          }}
        >
          <Text style={styles.buttonText}>GET RECEIPT</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.newSale]}
          onPress={() => {
            feedbackTap();
            router.replace("/(tabs)");
          }}
        >
          <Text style={styles.buttonText}>NEW SALE</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  amount: { fontSize: 40, fontWeight: "800", color: colors.primaryDark, marginTop: 18 },
  meta: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  metaText: { fontSize: 15, color: colors.grey700, fontWeight: "500" },
  unpaidChip: {
    marginTop: 14,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  unpaidChipText: { color: colors.white, fontWeight: "800", fontSize: 12, letterSpacing: 0.5 },
  unpaidHint: {
    marginTop: 10,
    fontSize: 13,
    color: colors.grey600,
    textAlign: "center",
    paddingHorizontal: 32,
    lineHeight: 18,
  },
  actions: { backgroundColor: colors.grey200, padding: 10, gap: 10 },
  button: {
    flexDirection: "row",
    gap: 8,
    height: 52,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  printBtn: { backgroundColor: colors.primary },
  getReceipt: { backgroundColor: colors.green },
  newSale: { backgroundColor: colors.primaryDark },
  buttonText: { color: colors.white, fontSize: 17, fontWeight: "700", letterSpacing: 0.5 },
});
