import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, formatMoney, strings } from "@/constants/theme";
import { useCart } from "@/lib/cart";
import { mockItems } from "@/lib/mock-items";
import { feedbackTap } from "@/lib/feedback";

const RANGES = ["Today", "Yesterday", "This Week", "Last Week", "This Month", "Last Month", "This Year", "Last Year"];

export default function ReportsScreen() {
  const { receipts } = useCart();
  const [tab, setTab] = useState<"pos" | "storefront">("pos");
  const [range, setRange] = useState("Today");
  const [pickerOpen, setPickerOpen] = useState(false);

  const stats = useMemo(() => {
    const totalSales = receipts.reduce((s, r) => s + r.total, 0);
    const byMode: Record<string, number> = {};
    receipts.forEach((r) => (byMode[r.mode] = (byMode[r.mode] ?? 0) + r.total));
    const topMode = Object.entries(byMode).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    const lowStock = mockItems.filter((i) => i.stockQuantity !== null && i.stockQuantity <= 3).length;
    const remaining = mockItems.reduce((s, i) => s + (i.stockQuantity ?? 0), 0);
    return {
      totalSales,
      count: receipts.length,
      avg: receipts.length ? Math.round(totalSales / receipts.length) : 0,
      topMode,
      lowStock,
      remaining,
    };
  }, [receipts]);

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{strings.reports}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <MetricCard label="LOW STOCK INVENTORY" value={String(stats.lowStock)} valueColor={colors.red500} message="Items at or below threshold" />
        <MetricCard label="REMAINING STOCKS" value={String(stats.remaining)} valueColor={colors.dkGreen} message="Total units in stock" />

        <View style={styles.dateCard}>
          <Pressable style={styles.arrowBtn} onPress={feedbackTap}>
            <Ionicons name="chevron-back" size={22} color={colors.primary} />
          </Pressable>
          <Pressable
            style={styles.dateCenter}
            onPress={() => {
              feedbackTap();
              setPickerOpen((v) => !v);
            }}
          >
            <Ionicons name="calendar-outline" size={18} color={colors.grey700} />
            <Text style={styles.dateText}>{range}</Text>
          </Pressable>
          <Pressable style={styles.arrowBtn} onPress={feedbackTap}>
            <Ionicons name="chevron-forward" size={22} color={colors.primary} />
          </Pressable>
        </View>

        {pickerOpen && (
          <View style={styles.presetGrid}>
            {RANGES.map((r) => (
              <Pressable
                key={r}
                style={[styles.preset, range === r && styles.presetActive]}
                onPress={() => {
                  feedbackTap();
                  setRange(r);
                  setPickerOpen(false);
                }}
              >
                <Text style={[styles.presetText, range === r && { color: colors.white }]}>{r}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.tabCard}>
          <Pressable style={[styles.tabHalf, tab === "pos" && styles.tabActive]} onPress={() => setTab("pos")}>
            <Text style={[styles.tabText, tab === "pos" && styles.tabTextActive]}>{strings.posReports}</Text>
          </Pressable>
          <Pressable style={[styles.tabHalf, tab === "storefront" && styles.tabActive]} onPress={() => setTab("storefront")}>
            <Text style={[styles.tabText, tab === "storefront" && styles.tabTextActive]}>{strings.storefrontReports}</Text>
          </Pressable>
        </View>

        <MetricCard label="TOTAL SALES" value={formatMoney(stats.totalSales)} />
        <MetricCard label="GROSS PROFIT (SELLING PRICE - COST PRICE)" value={formatMoney(Math.round(stats.totalSales * 0.4))} />
        <MetricCard label="PROFITS ( SALES - EXPENSE )" value={formatMoney(Math.round(stats.totalSales * 0.35))} />
        <MetricCard label="TOP STOCKS" value={mockItems[0]?.name ?? "—"} />
        <MetricCard label="TOP CATEGORY" value="Coffee" />
        <MetricCard label="TOTAL RECEIPT COUNT" value={String(stats.count)} />
        <MetricCard label="TAX" value={formatMoney(Math.round(stats.totalSales * 0.075))} />
        <MetricCard label="DISCOUNT" value={formatMoney(0)} />
        <MetricCard label="AVG SALES VALUE" value={formatMoney(stats.avg)} />
        <MetricCard label="TOP CUSTOMER" value="—" message="No Sales Link to any Customer!" />
        <MetricCard label="PAYMENT MODES" value={stats.topMode} />
        <MetricCard label="SOLD BY" value="—" message="No Cashier Found" />
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricCard({
  label,
  value,
  valueColor,
  message,
}: {
  label: string;
  value: string;
  valueColor?: string;
  message?: string;
}) {
  return (
    <Pressable style={styles.metricCard} onPress={feedbackTap} android_ripple={{ color: "#00000010" }}>
      <View style={{ flex: 1 }}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={[styles.metricValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
        {message ? <Text style={styles.metricMessage}>{message}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  header: { backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 14 },
  headerTitle: { color: colors.white, fontSize: 18, fontWeight: "700" },
  metricCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    marginHorizontal: 10,
    marginTop: 8,
    borderRadius: 4,
    padding: 12,
    elevation: 1,
  },
  metricLabel: { fontSize: 13, color: colors.grey800, fontWeight: "600" },
  metricValue: { fontSize: 22, color: colors.primary, fontWeight: "700", marginTop: 2 },
  metricMessage: { fontSize: 12, color: colors.grey500, marginTop: 2 },
  dateCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    marginHorizontal: 10,
    marginTop: 8,
    borderRadius: 4,
    elevation: 1,
  },
  arrowBtn: { padding: 14 },
  dateCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 },
  dateText: { fontSize: 15, color: colors.grey700, fontWeight: "600" },
  presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 10, paddingTop: 8 },
  preset: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.grey400,
  },
  presetActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetText: { color: colors.grey700, fontWeight: "600", fontSize: 13 },
  tabCard: {
    flexDirection: "row",
    backgroundColor: colors.card,
    margin: 10,
    borderRadius: 4,
    overflow: "hidden",
    elevation: 2,
  },
  tabHalf: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 15, fontWeight: "700", color: colors.primary },
  tabTextActive: { color: colors.white },
});
