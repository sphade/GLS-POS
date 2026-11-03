import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { StockTransfer } from "@gls-pos/types";
import { colors } from "@/constants/theme";
import { useCatalog } from "@/lib/catalog";
import { loadAll } from "@/lib/db";
import { feedbackTap } from "@/lib/feedback";
import { formatQty } from "@/lib/stock-units";

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

/**
 * Central Store report: what is on hand, what is running low, and how much went
 * to each shop in the period. Every figure comes from this store's own synced
 * ingredients and transfers, so it works offline and matches the ledger.
 */
export function CentralLedgerReport() {
  const { ingredients } = useCatalog();
  const [days, setDays] = useState<number>(30);

  const transfers = useMemo(() => loadAll<StockTransfer>("stock_transfers"), [ingredients]);

  const { byItem, byShop, low } = useMemo(() => {
    const since = Date.now() - days * 86_400_000;
    const recent = transfers.filter((t) => t.direction === "out" && t.sentAt >= since);
    const byItem = new Map<string, number>();
    const byShop = new Map<string, { name: string; count: number }>();
    for (const t of recent) {
      byItem.set(t.ingredientId, (byItem.get(t.ingredientId) ?? 0) + t.quantity);
      const shop = byShop.get(t.toStoreId) ?? { name: t.toStoreName, count: 0 };
      shop.count += 1;
      byShop.set(t.toStoreId, shop);
    }
    const low = ingredients.filter((i) => i.lowAt > 0 && i.stock <= i.lowAt);
    return { byItem, byShop, low };
  }, [transfers, ingredients, days]);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.ranges}>
        {RANGES.map((r) => (
          <Pressable
            key={r.days}
            style={[styles.range, days === r.days && styles.rangeActive]}
            onPress={() => {
              feedbackTap();
              setDays(r.days);
            }}
          >
            <Text style={[styles.rangeText, days === r.days && { color: colors.white }]}>{r.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>RUNNING LOW</Text>
      <View style={styles.card}>
        {low.length === 0 ? (
          <Text style={styles.empty}>Nothing is at its alert level.</Text>
        ) : (
          low.map((i) => (
            <View key={i.id} style={styles.row}>
              <Text style={styles.name}>{i.name}</Text>
              <Text style={[styles.value, { color: colors.red500 }]}>{formatQty(i.stock, i.unit)}</Text>
            </View>
          ))
        )}
      </View>

      <Text style={styles.section}>STOCK · SENT IN {days} DAYS</Text>
      <View style={styles.card}>
        {ingredients.length === 0 ? (
          <Text style={styles.empty}>No central stock yet.</Text>
        ) : (
          ingredients.map((i) => (
            <View key={i.id} style={styles.row}>
              <Text style={styles.name}>{i.name}</Text>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.value}>{formatQty(i.stock, i.unit)}</Text>
                <Text style={styles.sub}>sent {formatQty(byItem.get(i.id) ?? 0, i.unit)}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      <Text style={styles.section}>DELIVERIES BY SHOP</Text>
      <View style={styles.card}>
        {byShop.size === 0 ? (
          <Text style={styles.empty}>No deliveries in this period.</Text>
        ) : (
          [...byShop.entries()].map(([id, s]) => (
            <View key={id} style={styles.row}>
              <Text style={styles.name}>{s.name}</Text>
              <Text style={styles.value}>
                {s.count} transfer{s.count === 1 ? "" : "s"}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 12, paddingBottom: 40 },
  ranges: { flexDirection: "row", gap: 8, marginBottom: 6 },
  range: { borderRadius: 16, borderWidth: 1, borderColor: colors.grey400, paddingHorizontal: 14, paddingVertical: 7 },
  rangeActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  rangeText: { fontSize: 13, fontWeight: "600", color: colors.grey700 },
  section: { fontSize: 12, fontWeight: "700", color: colors.grey600, letterSpacing: 0.6, marginTop: 14, marginBottom: 6 },
  card: { backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  name: { fontSize: 14, fontWeight: "600", color: colors.grey900, flex: 1 },
  value: { fontSize: 14, fontWeight: "700", color: colors.grey900 },
  sub: { fontSize: 11, color: colors.grey500, marginTop: 1 },
  empty: { fontSize: 13, color: colors.grey500, paddingVertical: 12 },
});
