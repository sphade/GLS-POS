import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { useCart } from "@/lib/cart";
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

  const amount = receipt ? formatMoney(receipt.total, receipt.currency) : formatMoney(0);
  const receiptId = receipt?.number.replace(/^#/, "") ?? "—";
  const itemCount = receipt?.itemCount ?? 0;

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
  actions: { backgroundColor: colors.grey200, padding: 10, gap: 10 },
  button: { height: 52, borderRadius: 4, alignItems: "center", justifyContent: "center", elevation: 2 },
  getReceipt: { backgroundColor: colors.green },
  newSale: { backgroundColor: colors.primaryDark },
  buttonText: { color: colors.white, fontSize: 17, fontWeight: "700", letterSpacing: 0.5 },
});
