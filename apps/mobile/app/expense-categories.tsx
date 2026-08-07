import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";

const EXPENSE = [
  "Tax", "Fuel", "Food", "Bill",
  "Transportation", "Insurance", "Salary", "Rent",
  "Repairs", "Commissions", "Advertising", "Fee",
  "Interest", "Loan", "Supplies", "Transfer",
  "Contract", "Miscellaneous",
];

const INCOME = [
  "Profit", "Salary", "Awards", "Rental",
  "Sale", "Refund", "Lottery", "Dividend",
  "Investment", "Interest", "Commission", "Fee",
  "Loan", "Miscellaneous",
];

const CUSTOM = "__custom__";

/** Expense / Income category picker (ExpenseIncomeActivity). */
export default function ExpenseCategoriesScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<"expense" | "income">("expense");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  const isExpense = tab === "expense";
  const circleColor = isExpense ? "#EF3E36" : "#43A047";

  const items = useMemo(() => {
    const base = isExpense ? EXPENSE : INCOME;
    const q = query.trim().toLowerCase();
    const filtered = q ? base.filter((c) => c.toLowerCase().includes(q)) : base;
    return [...filtered, CUSTOM];
  }, [isExpense, query]);

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </Pressable>

        {searching ? (
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search category"
            placeholderTextColor={colors.grey500}
            autoFocus
          />
        ) : (
          <View style={styles.tabs}>
            <Pressable
              style={styles.tab}
              onPress={() => {
                feedbackTap();
                setTab("expense");
              }}
            >
              <Text style={[styles.tabText, isExpense && styles.tabTextActive]}>EXPENSE</Text>
              {isExpense && <View style={styles.indicator} />}
            </Pressable>
            <Pressable
              style={styles.tab}
              onPress={() => {
                feedbackTap();
                setTab("income");
              }}
            >
              <Text style={[styles.tabText, !isExpense && styles.tabTextActive]}>INCOME</Text>
              {!isExpense && <View style={styles.indicator} />}
            </Pressable>
          </View>
        )}

        <Pressable
          onPress={() => {
            feedbackTap();
            setSearching((v) => !v);
            setQuery("");
          }}
          style={styles.backBtn}
          hitSlop={8}
        >
          <Ionicons name={searching ? "close" : "search"} size={22} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {items.map((name) => {
          const custom = name === CUSTOM;
          return (
            <Pressable
              key={name}
              style={styles.cell}
              onPress={() => {
                feedbackTap();
                router.push({
                  pathname: "/add-entry",
                  params: { category: custom ? "Custom" : name, kind: tab },
                });
              }}
              android_ripple={{ color: "#00000010" }}
            >
              <View style={[styles.circle, { backgroundColor: custom ? colors.primary : circleColor }]}>
                {custom ? (
                  <Ionicons name="add" size={26} color={colors.white} />
                ) : (
                  <Text style={styles.initial}>{name.charAt(0).toUpperCase()}</Text>
                )}
              </View>
              <Text style={styles.label} numberOfLines={1}>
                {custom ? "Custom" : name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    height: 56,
    paddingHorizontal: 4,
    elevation: 2,
  },
  backBtn: { width: 44, alignItems: "center" },
  tabs: { flex: 1, flexDirection: "row" },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", height: 56 },
  tabText: { fontSize: 15, fontWeight: "600", color: colors.grey600, letterSpacing: 0.4 },
  tabTextActive: { color: colors.grey900, fontWeight: "700" },
  indicator: {
    position: "absolute",
    bottom: 0,
    left: 12,
    right: 12,
    height: 3,
    backgroundColor: colors.primary,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.grey900, paddingHorizontal: 8 },

  grid: { flexDirection: "row", flexWrap: "wrap", paddingVertical: 4 },
  cell: { width: "25%", alignItems: "center", paddingVertical: 12, paddingHorizontal: 4 },
  circle: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center" },
  initial: { color: colors.white, fontSize: 22, fontWeight: "600" },
  label: { marginTop: 8, fontSize: 13, color: colors.grey800, textAlign: "center" },
});
