import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { EmptyState } from "@/components/EmptyState";
import { isVoidReturn, reasonLabel, useReturns, type SaleReturn } from "@/lib/returns";
import { feedbackTap } from "@/lib/feedback";

/**
 * Every return raised at this store, newest first. Refunds are append-only, so
 * this list is the audit surface a manager checks when reconciling the drawer.
 */
export default function ReturnsScreen() {
  const router = useRouter();
  const { returns } = useReturns();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return returns;
    return returns.filter((ret) =>
      [ret.number, ret.receiptNumber, ret.servedBy, ret.method, reasonLabel(ret.reason)].some((field) =>
        field.toLowerCase().includes(q),
      ),
    );
  }, [returns, q]);

  const refundedTotal = useMemo(
    () => returns.reduce((sum, ret) => (isVoidReturn(ret) ? sum : sum + ret.total), 0),
    [returns],
  );
  const currency = returns[0]?.currency ?? "NGN";

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Returns</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={19} color={colors.grey600} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Credit note, receipt, staff…"
            placeholderTextColor={colors.grey500}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable hitSlop={8} onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={18} color={colors.grey500} />
            </Pressable>
          )}
        </View>
      </View>

      {returns.length > 0 && (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            {returns.length} return{returns.length === 1 ? "" : "s"}
          </Text>
          <Text style={styles.summaryAmount}>{formatMoney(refundedTotal, currency)} refunded</Text>
        </View>
      )}

      {filtered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            text={
              returns.length === 0
                ? "No returns yet. Open a receipt and tap RETURN to refund an item."
                : "No returns match that search."
            }
          />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(ret) => ret.id}
          contentContainerStyle={{ padding: 8, paddingBottom: 24 }}
          renderItem={({ item }) => <ReturnRow ret={item} onPress={() => {
            feedbackTap();
            router.push(`/return-receipt/${item.id}` as Href);
          }} />}
        />
      )}
    </SafeAreaView>
  );
}

function ReturnRow({ ret, onPress }: { ret: SaleReturn; onPress: () => void }) {
  const voided = isVoidReturn(ret);
  const time = new Date(ret.createdAt);
  return (
    <Pressable style={styles.row} onPress={onPress} android_ripple={{ color: "#00000010" }}>
      <View style={styles.rowIcon}>
        <MaterialCommunityIcons
          name={voided ? "cancel" : "cash-refund"}
          size={22}
          color={colors.red500}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {ret.number} · against {ret.receiptNumber}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {ret.itemCount} item{ret.itemCount === 1 ? "" : "s"} · {reasonLabel(ret.reason)} ·{" "}
          {time.toLocaleDateString()} {time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </Text>
        <Text style={styles.rowStaff} numberOfLines={1}>
          {voided ? "Voided" : ret.method} · by {ret.servedBy}
        </Text>
      </View>
      <Text style={styles.rowAmount}>
        {voided ? "—" : `-${formatMoney(ret.total, ret.currency)}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  header: { backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  headerBtn: { width: 48, alignItems: "center" },
  headerTitle: { flex: 1, color: colors.white, fontSize: 19, fontWeight: "700" },

  searchRow: { backgroundColor: colors.primary, paddingHorizontal: 10, paddingBottom: 12 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 46,
    gap: 8,
  },
  searchInput: { flex: 1, color: colors.grey800, fontSize: 16, padding: 0 },

  summaryBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.grey300,
  },
  summaryText: { fontSize: 13, color: colors.grey600, fontWeight: "600" },
  summaryAmount: { fontSize: 13, color: colors.red500, fontWeight: "800" },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 4,
    padding: 12,
    marginBottom: 8,
    elevation: 1,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FDECEA",
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: 14, fontWeight: "700", color: colors.grey900 },
  rowMeta: { fontSize: 12, color: colors.grey600, marginTop: 2 },
  rowStaff: { fontSize: 11, color: colors.grey500, marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: "800", color: colors.red500 },
});
