import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney, strings } from "@/constants/theme";
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

export default function ReportsScreen() {
  const router = useRouter();
  const { receipts } = useCart();
  const { products } = useCatalog();
  const [tab, setTab] = useState<"pos" | "storefront">("pos");
  const [rangeIndex, setRangeIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const range = RANGES[rangeIndex]!;

  const scoped = useMemo(() => {
    const { from, to } = rangeBounds(range);
    return receipts.filter((r) => r.createdAt >= from && r.createdAt < to);
  }, [receipts, range]);

  const stats = useMemo(() => {
    const totalSales = scoped.reduce((s, r) => s + r.total, 0);
    const byMode: Record<string, number> = {};
    const byItem: Record<string, number> = {};
    scoped.forEach((r) => {
      byMode[r.mode] = (byMode[r.mode] ?? 0) + r.total;
      r.lines.forEach((l) => (byItem[l.name] = (byItem[l.name] ?? 0) + l.qty));
    });
    const topItem = Object.entries(byItem).sort((a, b) => b[1] - a[1])[0];
    const highest = scoped.reduce((m, r) => Math.max(m, r.total), 0);
    return {
      totalSales,
      count: scoped.length,
      avg: scoped.length ? Math.round(totalSales / scoped.length) : 0,
      profit: Math.round(totalSales * 0.4),
      tax: Math.round(totalSales * 0.075),
      highest,
      topMode: Object.entries(byMode).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "â€”",
      topItem,
      lowStock: products.filter((i) => i.stockQuantity !== null && i.stockQuantity <= 3).length,
      remaining: products.reduce((s, i) => s + (i.stockQuantity ?? 0), 0),
    };
  }, [scoped, products]);

  const hasData = scoped.length > 0;

  const step = (dir: -1 | 1) => {
    feedbackTap();
    setRangeIndex((i) => Math.min(RANGES.length - 1, Math.max(0, i + dir)));
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <PosHeader showShare />

      {/* Date range bar: â† calendar + label â†’ */}
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
          <EmptyState text="No Reports for Select Date" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={styles.tabCard}>
            <Pressable style={[styles.tabHalf, tab === "pos" && styles.tabActive]} onPress={() => setTab("pos")}>
              <Text style={[styles.tabText, tab === "pos" && styles.tabTextActive]}>{strings.posReports}</Text>
            </Pressable>
            <Pressable
              style={[styles.tabHalf, tab === "storefront" && styles.tabActive]}
              onPress={() => setTab("storefront")}
            >
              <Text style={[styles.tabText, tab === "storefront" && styles.tabTextActive]}>
                {strings.storefrontReports}
              </Text>
            </Pressable>
          </View>

          <MetricCard
            label="TOTAL SALES"
            value={formatMoney(stats.totalSales, CURRENCY)}
            message={`${formatMoney(stats.highest, CURRENCY)} is Highest`}
            type="revenue"
            title="Revenue"
          />
          <MetricCard
            label="GROSS PROFIT (SELLING PRICE - COST PRICE )"
            value={formatMoney(stats.profit, CURRENCY)}
            type="profit"
            title="Gross Profit"
          />
          <MetricCard
            label="PROFITS ( SALES - EXPENSE )"
            value="No Expenses"
            type="profit"
            title="Profits"
          />
          <MetricCard
            label="TOP STOCKS"
            value={stats.topItem ? `${stats.topItem[0]} : ${stats.topItem[1]}` : "â€”"}
            message={stats.topItem ? `Only ${stats.topItem[1]}` : undefined}
            type="topStocks"
            title="Top Stocks"
          />
          <MetricCard label="TOP CATEGORY" value="Fruits : 1" type="topCategory" title="Top Category" />
          <MetricCard
            label="TOTAL RECEIPT COUNT"
            value={String(stats.count)}
            type="salesCount"
            title="Receipt Count"
          />
          <MetricCard label="TAX" value={formatMoney(stats.tax, CURRENCY)} type="tax" title="Tax" />
          <MetricCard label="DISCOUNT" value={formatMoney(0, CURRENCY)} type="discount" title="Discount" />
          <MetricCard
            label="AVG SALES VALUE"
            value={formatMoney(stats.avg, CURRENCY)}
            type="avgSales"
            title="Avg Sales Value"
          />
          <MetricCard
            label="TOP CUSTOMER"
            value="â€”"
            message="No Sales Link to any Customer!"
            type="customer"
            title="Top Customers"
          />
          <MetricCard
            label="PAYMENT MODES"
            value={stats.topMode}
            type="payment"
            title="Payment Modes"
          />
          <MetricCard label="SOLD BY" value="â€”" message="No Cashier Found" type="cashier" title="Sold By" />
          <MetricCard
            label="LOW STOCK INVENTORY"
            value={String(stats.lowStock)}
            valueColor={colors.red500}
            type="lowStock"
            title="Low Stock"
          />
          <MetricCard
            label="REMAINING STOCKS"
            value={String(stats.remaining)}
            valueColor={colors.dkGreen}
            type="remainingStocks"
            title="Remaining Stocks"
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
  type,
  title,
}: {
  label: string;
  value: string;
  valueColor?: string;
  message?: string;
  type?: string;
  title?: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      style={styles.metricCard}
      android_ripple={{ color: "#00000010" }}
      onPress={() => {
        feedbackTap();
        if (type) router.push({ pathname: "/report/[type]", params: { type, title: title ?? label } });
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={[styles.metricValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
        {message ? <Text style={styles.metricMessage}>{message}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={24} color={colors.primary} />
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


