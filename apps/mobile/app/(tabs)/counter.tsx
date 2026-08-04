import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney, strings } from "@/constants/theme";
import { useCart } from "@/lib/cart";
import { feedbackAddItem, feedbackTap } from "@/lib/feedback";

export default function CounterScreen() {
  const router = useRouter();
  const { entries, subtotal, taxTotal, total, add, remove, count, clear } = useCart();
  const list = Object.values(entries);

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{strings.counter}</Text>
        {count > 0 && (
          <Pressable
            onPress={() => {
              feedbackTap();
              clear();
            }}
          >
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        )}
      </View>

      {list.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="cart-outline" size={64} color={colors.grey400} />
          <Text style={styles.empty}>{strings.counterIsEmpty}</Text>
        </View>
      ) : (
        <>
          <FlatList
            data={list}
            keyExtractor={(e) => e.item.id}
            contentContainerStyle={{ padding: 10, paddingBottom: 8 }}
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
        </>
      )}

      {count > 0 && (
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
      )}
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: { color: colors.white, fontSize: 18, fontWeight: "700" },
  clear: { color: colors.white, fontWeight: "600" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  empty: { color: colors.grey600, fontSize: 15 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 4,
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
  lineTotal: { width: 72, textAlign: "right", fontWeight: "700", color: colors.grey900 },
  totalsCard: { backgroundColor: colors.card, margin: 10, marginTop: 0, borderRadius: 4, padding: 12, elevation: 1 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { color: colors.grey600, fontSize: 14 },
  totalValue: { color: colors.grey800, fontSize: 14, fontWeight: "600" },
  totalBold: { fontSize: 17, fontWeight: "800", color: colors.primary },
  divider: { height: 1, backgroundColor: colors.grey300, marginVertical: 6 },
  charge: {
    margin: 10,
    marginTop: 0,
    height: 52,
    borderRadius: 6,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
  },
  chargeText: { color: colors.white, fontSize: 18, fontWeight: "700" },
});
