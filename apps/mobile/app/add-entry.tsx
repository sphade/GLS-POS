import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, currencySymbol } from "@/constants/theme";
import { feedbackError, feedbackSaleComplete, feedbackTap } from "@/lib/feedback";

const CURRENCY = "NGN";

function today() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Amount entry for an expense/income category (AddEntryActivity). */
export default function AddEntryScreen() {
  const router = useRouter();
  const { category = "Expense", kind = "expense" } = useLocalSearchParams<{ category?: string; kind?: string }>();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const isExpense = kind !== "income";
  const actionColor = isExpense ? colors.red500 : colors.green;
  const actionLabel = isExpense ? "ADD EXPENSE" : "ADD INCOME";

  const numeric = parseFloat(amount.replace(/,/g, "")) || 0;
  const display = numeric > 0 ? numeric.toLocaleString("en-US") : "";

  const onSubmit = () => {
    if (numeric <= 0) {
      feedbackError();
      return;
    }
    feedbackSaleComplete();
    router.back();
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} style={styles.toolbarBtn} hitSlop={8}>
          <Ionicons name="close" size={26} color={colors.white} />
        </Pressable>
        <Text style={styles.toolbarTitle} numberOfLines={1}>
          {String(category).toUpperCase()}
        </Text>
        <Pressable style={styles.toolbarBtn} onPress={feedbackTap} hitSlop={8}>
          <MaterialCommunityIcons name="calculator-variant-outline" size={24} color={colors.white} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 8 }}>
        <View style={styles.card}>
          <Text style={styles.enterAmount}>Enter Amount</Text>

          <View style={styles.amountRow}>
            <Text style={styles.currency}>{currencySymbol(CURRENCY)}</Text>
            <TextInput
              style={styles.amountInput}
              value={display}
              onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.grey400}
            />
          </View>
          <View style={styles.amountUnderline} />

          <Pressable style={[styles.actionBtn, { backgroundColor: actionColor }]} onPress={onSubmit}>
            <Text style={styles.actionText}>{actionLabel}</Text>
          </Pressable>

          <Pressable style={styles.dateBox} onPress={feedbackTap}>
            <Text style={styles.dateValue}>{today()}</Text>
            <Text style={styles.dateLabel}>DATE</Text>
          </Pressable>

          <Text style={styles.notesLabel}>Notes</Text>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder=""
            underlineColorAndroid="transparent"
          />
          <View style={styles.notesUnderline} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.grey200 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.primary,
    height: 56,
    paddingHorizontal: 6,
  },
  toolbarBtn: { width: 44, alignItems: "center" },
  toolbarTitle: { flex: 1, textAlign: "center", color: colors.white, fontSize: 19, fontWeight: "600", letterSpacing: 0.5 },

  card: { backgroundColor: colors.white, borderRadius: 3, padding: 16, elevation: 1 },
  enterAmount: { textAlign: "center", color: colors.primary, fontSize: 15, fontWeight: "500" },
  amountRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 8 },
  currency: { fontSize: 24, color: colors.grey900, fontWeight: "500", marginRight: 6 },
  amountInput: {
    fontSize: 34,
    fontWeight: "700",
    color: colors.grey900,
    minWidth: 100,
    textAlign: "center",
    padding: 0,
  },
  amountUnderline: {
    alignSelf: "center",
    width: 150,
    height: 1,
    backgroundColor: colors.grey500,
    marginTop: 2,
  },
  actionBtn: {
    marginTop: 20,
    marginHorizontal: 20,
    height: 52,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { color: colors.white, fontSize: 17, fontWeight: "700", letterSpacing: 0.5 },
  dateBox: {
    marginTop: 16,
    backgroundColor: colors.grey100,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 2,
  },
  dateValue: { fontSize: 17, color: colors.grey900 },
  dateLabel: { fontSize: 12, color: colors.primary, marginTop: 4, letterSpacing: 0.6 },
  notesLabel: { marginTop: 18, fontSize: 13, color: colors.primary },
  notesInput: { fontSize: 18, color: colors.grey900, paddingVertical: 6, paddingHorizontal: 0 },
  notesUnderline: { height: 2, backgroundColor: colors.primary },
});

