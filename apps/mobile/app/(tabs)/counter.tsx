import { useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney, strings } from "@/constants/theme";
import { PosHeader, PosSearchBar } from "@/components/PosHeader";
import { useCart } from "@/lib/cart";
import { feedbackAddItem, feedbackTap } from "@/lib/feedback";

/**
 * Counter (billing) tab. With an empty cart it shows the NEW ORDER /
 * ADD NEW EXPENSE actions and the table-order count; once items are added it
 * becomes the running bill with a Charge button.
 */
export default function CounterScreen() {
  const router = useRouter();
  const { entries, subtotal, taxTotal, total, add, remove, count, clear } = useCart();
  const [query, setQuery] = useState("");
  const list = Object.values(entries);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.headerRegion}>
        <PosHeader showAddCustomer />
        <PosSearchBar value={query} onChangeText={setQuery} onScan={() => router.push("/scanner")} />
      </SafeAreaView>

      {list.length === 0 ? (
        <ScrollView contentContainerStyle={{ padding: 8 }}>
          <Pressable
            style={styles.actionCard}
            onPress={() => {
              feedbackTap();
              router.push("/select-table");
            }}
            android_ripple={{ color: "#00000010" }}
          >
            <View style={styles.plusCircle}>
              <Ionicons name="add" size={26} color={colors.white} />
            </View>
            <Text style={styles.actionTitle}>NEW ORDER</Text>
          </Pressable>

          <Pressable
            style={styles.expenseCard}
            onPress={() => {
              feedbackTap();
              router.push("/expense-categories");
            }}
            android_ripple={{ color: "#00000010" }}
          >
            <MaterialCommunityIcons name="hand-coin" size={26} color={colors.green} />
            <Text style={styles.expenseTitle}>ADD NEW EXPENSE</Text>
          </Pressable>

          <Text style={styles.tableOrders}>Total Table Orders: 0</Text>
        </ScrollView>
      ) : (
        <>
          <View style={styles.billHeader}>
            <Text style={styles.billHeaderText}>{count} item(s)</Text>
            <Pressable
              onPress={() => {
                feedbackTap();
                clear();
              }}
            >
              <Text style={styles.clear}>CLEAR</Text>
            </Pressable>
          </View>

          <FlatList
            data={list}
            keyExtractor={(e) => e.item.id}
            contentContainerStyle={{ padding: 8, paddingBottom: 8 }}
            renderItem={({ item: entry }) => (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{entry.item.name}</Text>
                  <Text style={styles.unitPrice}>{formatMoney(entry.item.price, entry.item.currency)}</Text>
                </View>
                <View style={styles.stepper}>
                  <Pressable
                    style={styles.stepBtn}
                    onPress={() => {
                      feedbackTap();
                      remove(entry.item.id);
                    }}
                  >
                    <Ionicons name="remove" size={18} color={colors.primary} />
                  </Pressable>
                  <Text style={styles.qty}>{entry.qty}</Text>
                  <Pressable
                    style={styles.stepBtn}
                    onPress={() => {
                      feedbackAddItem();
                      add(entry.item);
                    }}
                  >
                    <Ionicons name="add" size={18} color={colors.primary} />
                  </Pressable>
                </View>
                <Text style={styles.lineTotal}>
                  {formatMoney(entry.item.price * entry.qty, entry.item.currency)}
                </Text>
              </View>
            )}
          />

          <View style={styles.totalsCard}>
            <TotalRow label={strings.subtotal} value={formatMoney(subtotal)} />
            {taxTotal > 0 && <TotalRow label="Tax" value={formatMoney(taxTotal)} />}
            <View style={styles.divider} />
            <TotalRow label={strings.grandTotal} value={formatMoney(total)} bold />
          </View>

          <Pressable
            style={styles.charge}
            onPress={() => {
              feedbackTap();
              router.push("/charge");
            }}
          >
            <Text style={styles.chargeText}>
              {strings.charge} {formatMoney(total)}
            </Text>
          </Pressable>
        </>
      )}
    </View>
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
  headerRegion: { backgroundColor: colors.primary },

  actionCard: {
    backgroundColor: colors.card,
    borderRadius: 3,
    paddingVertical: 26,
    alignItems: "center",
    marginBottom: 8,
    elevation: 1,
  },
  plusCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: { fontSize: 18, fontWeight: "700", color: colors.grey900, marginTop: 18 },

  expenseCard: {
    backgroundColor: colors.card,
    borderRadius: 3,
    paddingVertical: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginBottom: 16,
    elevation: 1,
  },
  expenseTitle: { fontSize: 17, fontWeight: "600", color: colors.grey900 },

  tableOrders: { fontSize: 17, fontWeight: "700", color: colors.grey900, marginLeft: 4 },

  billHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  billHeaderText: { fontSize: 14, color: colors.grey600, fontWeight: "600" },
  clear: { color: colors.red500, fontWeight: "700", fontSize: 13 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 3,
    padding: 12,
    marginBottom: 8,
    gap: 10,
    elevation: 1,
  },
  name: { fontSize: 15, color: colors.grey900, fontWeight: "600" },
  unitPrice: { fontSize: 13, color: colors.grey600, marginTop: 2 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  qty: { minWidth: 20, textAlign: "center", fontWeight: "700", color: colors.grey900 },
  lineTotal: { width: 78, textAlign: "right", fontWeight: "700", color: colors.grey900 },

  totalsCard: { backgroundColor: colors.card, margin: 8, marginTop: 0, borderRadius: 3, padding: 12, elevation: 1 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { color: colors.grey600, fontSize: 14 },
  totalValue: { color: colors.grey800, fontSize: 14, fontWeight: "600" },
  totalBold: { fontSize: 17, fontWeight: "800", color: colors.primary },
  divider: { height: 1, backgroundColor: colors.grey300, marginVertical: 6 },

  charge: {
    margin: 8,
    marginTop: 0,
    height: 52,
    borderRadius: 4,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
  },
  chargeText: { color: colors.white, fontSize: 18, fontWeight: "700" },
});
