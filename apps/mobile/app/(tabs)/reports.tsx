import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { PosHeader } from "@/components/PosHeader";
import { EmptyState } from "@/components/EmptyState";
import { useCart } from "@/lib/cart";
import { useCatalog } from "@/lib/catalog";
import { feedbackTap } from "@/lib/feedback";

const CURRENCY = "NGN";
const RANGES = [
  "Today",
  "Yesterday",
  "This Week",
  "Last Week",
  "This Month",
  "Last Month",
  "This Year",
  "Last Year",
];

const DAY = 86_400_000;

function rangeBounds(range: string): { from: number; to: number } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const today = d.getTime();
  switch (range) {
    case "Today":
      return { from: today, to: Date.now() + 1 };
    case "Yesterday":
      return { from: today - DAY, to: today };
    case "This Week": {
      const w = new Date(d);
      w.setDate(d.getDate() - d.getDay());
      return { from: w.getTime(), to: Date.now() + 1 };
    }
    case "Last Week": {
      const w = new Date(d);
      w.setDate(d.getDate() - d.getDay() - 7);
      return { from: w.getTime(), to: w.getTime() + 7 * DAY };
    }
    case "This Month":
      return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: Date.now() + 1 };
    case "Last Month":
      return {
        from: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(),
        to: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
      };
    case "Last Year":
      return {
        from: new Date(d.getFullYear() - 1, 0, 1).getTime(),
        to: new Date(d.getFullYear(), 0, 1).getTime(),
      };
    default:
      return { from: new Date(d.getFullYear(), 0, 1).getTime(), to: Date.now() + 1 };
  }
}

/** "Yesterday : 04 Aug" style label shown in the date bar. */
function dateLabelFor(range: string) {
  const { from } = rangeBounds(range);
  const d = new Date(from);
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${range} : ${day} ${month}`;
}

/**
 * Reports overview. Deliberately shows only figures we can compute honestly
 * from real receipts and stock — no fabricated profit/tax/category placeholders.
 * Each card either opens the sales chart for the same range, or jumps to a real
 * screen (Inventory), so nothing leads to a dead or misleading page.
 */
export default function ReportsScreen() {
  const router = useRouter();
  const { receipts } = useCart();
  const { products } = useCatalog();
  const [rangeIndex, setRangeIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const range = RANGES[rangeIndex]!;
  const { from, to } = rangeBounds(range);

  const scoped = useMemo(
    () => receipts.filter((r) => r.createdAt >= from && r.createdAt < to),
    [receipts, from, to],
  );

  const stats = useMemo(() => {
    const totalSales = scoped.reduce((s, r) => s + r.total, 0);
    const byMode: Record<string, number> = {};
    const byItem: Record<string, number> = {};
    scoped.forEach((r) => {
      byMode[r.mode] = (byMode[r.mode] ?? 0) + r.total;
      r.lines.forEach((l) => (byItem[l.name] = (byItem[l.name] ?? 0) + l.qty));
    });
    const topItem = Object.entries(byItem).sort((a, b) => b[1] - a[1])[0];
    const topMode = Object.entries(byMode).sort((a, b) => b[1] - a[1])[0];
    return {
      totalSales,
      count: scoped.length,
      avg: scoped.length ? Math.round(totalSales / scoped.length) : 0,
      topItem,
      topMode,
      lowStock: products.filter((i) => i.stockQuantity !== null && i.stockQuantity <= 3).length,
      remaining: products.reduce((s, i) => s + (i.stockQuantity ?? 0), 0),
    };
  }, [scoped, products]);

  const hasData = scoped.length > 0;

  const step = (dir: -1 | 1) => {
    feedbackTap();
    setRangeIndex((i) => Math.min(RANGES.length - 1, Math.max(0, i + dir)));
  };

  /** Open the sales chart for the current range. */
  const openChart = (type: string, title: string) => {
    feedbackTap();
    router.push({
      pathname: "/report/[type]",
      params: { type, title, from: String(from), to: String(to), label: dateLabelFor(range) },
    });
  };

  const openInventory = () => {
    feedbackTap();
    router.push("/inventory" as Href);
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <PosHeader title="Reports" />

      {/* Date range bar: ← calendar + label → */}
      <View style={styles.dateBar}>
        <Pressable style={styles.dateArrow} hitSlop={8} onPress={() => step(-1)}>
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </Pressable>
        <Pressable
          style={styles.dateCenter}
          onPress={() => {
            feedbackTap();
            setPickerOpen((v) => !v);
          }}
        >
          <MaterialCommunityIcons name="calendar-month" size={24} color={colors.primary} />
          <Text style={styles.dateText}>{dateLabelFor(range)}</Text>
        </Pressable>
        <Pressable style={styles.dateArrow} hitSlop={8} onPress={() => step(1)}>
          <Ionicons name="arrow-forward" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {pickerOpen && (
        <View style={styles.presetGrid}>
          {RANGES.map((r, i) => (
            <Pressable
              key={r}
              style={[styles.preset, range === r && styles.presetActive]}
              onPress={() => {
                feedbackTap();
                setRangeIndex(i);
                setPickerOpen(false);
              }}
            >
              <Text style={[styles.presetText, range === r && { color: colors.white }]}>{r}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {!hasData ? (
        <View style={styles.emptyWrap}>
          <EmptyState text="No sales in this period" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <MetricCard
            label="TOTAL SALES"
            value={formatMoney(stats.totalSales, CURRENCY)}
            onPress={() => openChart("revenue", "Total Sales")}
          />
          <MetricCard
            label="RECEIPTS"
            value={String(stats.count)}
            onPress={() => openChart("salesCount", "Receipts")}
          />
          <MetricCard
            label="AVERAGE SALE"
            value={formatMoney(stats.avg, CURRENCY)}
            onPress={() => openChart("revenue", "Total Sales")}
          />
          <MetricCard
            label="TOP ITEM"
            value={stats.topItem ? stats.topItem[0] : "—"}
            message={stats.topItem ? `${stats.topItem[1]} sold` : undefined}
            onPress={openInventory}
          />
          <MetricCard
            label="TOP PAYMENT METHOD"
            value={stats.topMode ? stats.topMode[0] : "—"}
            message={stats.topMode ? formatMoney(stats.topMode[1], CURRENCY) : undefined}
          />
          <MetricCard
            label="LOW STOCK ITEMS"
            value={String(stats.lowStock)}
            valueColor={stats.lowStock > 0 ? colors.red500 : undefined}
            onPress={openInventory}
          />
          <MetricCard
            label="REMAINING STOCK"
            value={String(stats.remaining)}
            valueColor={colors.dkGreen}
            onPress={openInventory}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MetricCard({
  label,
  value,
  valueColor,
  message,
  onPress,
}: {
  label: string;
  value: string;
  valueColor?: string;
  message?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={styles.metricCard}
      android_ripple={onPress ? { color: "#00000010" } : undefined}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={[styles.metricValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
        {message ? <Text style={styles.metricMessage}>{message}</Text> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={24} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },

  dateBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    height: 58,
    paddingHorizontal: 8,
  },
  dateArrow: { width: 44, alignItems: "center" },
  dateCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  dateText: { fontSize: 18, color: colors.grey800, fontWeight: "500" },

  presetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    padding: 10,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey300,
  },
  preset: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.grey400,
  },
  presetActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetText: { color: colors.grey700, fontWeight: "600", fontSize: 13 },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 80 },

  metricCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 3,
    paddingHorizontal: 14,
    paddingVertical: 16,
    elevation: 1,
  },
  metricLabel: { fontSize: 15, color: colors.grey800, fontWeight: "500" },
  metricValue: { fontSize: 24, color: colors.primary, fontWeight: "700", marginTop: 6 },
  metricMessage: { fontSize: 13, color: colors.grey500, marginTop: 4 },
});
