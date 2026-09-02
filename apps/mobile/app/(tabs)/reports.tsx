import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { PosHeader } from "@/components/PosHeader";
import { DatePickerSheet } from "@/components/DatePickerSheet";
import { EmptyState } from "@/components/EmptyState";
import { useCart } from "@/lib/cart";
import { useCatalog } from "@/lib/catalog";
import { isVoidReturn, useReturns } from "@/lib/returns";
import { useStore } from "@/lib/store";
import { useServerRefresh } from "@/lib/sync";
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

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Calendar-day arithmetic, so a window stays whole days across a DST shift. */
const addDays = (ms: number, n: number) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

/** Exclusive end-of-day, so a single date covers that whole day. */
const endOfDay = (ms: number) => addDays(startOfDay(ms), 1);

const dayLabel = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-US", { month: "short" })}`;
};

/** "12 Aug" for one day, "12 Aug - 18 Aug" for a span. */
function customLabel(from: number, to: number): string {
  // `to` is exclusive, so step inside it to name the final day.
  const lastDay = to - 1;
  const single = startOfDay(from) === startOfDay(lastDay);
  const year = new Date(from).getFullYear();
  const suffix = year === new Date().getFullYear() ? "" : ` ${year}`;
  return single
    ? `${dayLabel(from)}${suffix}`
    : `${dayLabel(from)} - ${dayLabel(lastDay)}${suffix}`;
}

/**
 * How the chart should group a hand-picked window. Presets carry their own
 * sensible grouping; a custom span has to be judged by its length.
 */
function granularityForSpan(from: number, to: number): "hour" | "date" | "month" {
  const days = Math.max(1, Math.round((to - from) / DAY));
  if (days <= 1) return "hour";
  if (days <= 62) return "date";
  return "month";
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
  const { returns } = useReturns();
  const { store } = useStore();
  const { refreshing, onRefresh } = useServerRefresh(store.id);
  const [rangeIndex, setRangeIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** A hand-picked window. Overrides the preset while it's set. */
  const [custom, setCustom] = useState<{ from: number; to: number } | null>(null);
  /** Which end of a custom range is being chosen. */
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [draftFrom, setDraftFrom] = useState<number | null>(null);

  const range = RANGES[rangeIndex]!;
  const presetBounds = rangeBounds(range);
  const from = custom ? custom.from : presetBounds.from;
  const to = custom ? custom.to : presetBounds.to;
  const rangeLabel = custom ? customLabel(custom.from, custom.to) : dateLabelFor(range);

  const scoped = useMemo(
    () => receipts.filter((r) => r.createdAt >= from && r.createdAt < to),
    [receipts, from, to],
  );

  /**
   * Returns are scoped by when the refund happened, not when the original sale
   * did — otherwise refunding today would silently rewrite a closed day's
   * report. Voids never moved money, so they're excluded from the figures.
   */
  const scopedReturns = useMemo(
    () =>
      returns.filter((ret) => !isVoidReturn(ret) && ret.createdAt >= from && ret.createdAt < to),
    [returns, from, to],
  );

  const stats = useMemo(() => {
    const grossSales = scoped.reduce((s, r) => s + r.total, 0);
    const refunded = scopedReturns.reduce((s, ret) => s + ret.total, 0);
    /**
     * What was given away at the till. Tracked separately from returns because
     * discounts are the classic staff-fraud vector — an owner wants to see them
     * as a share of what was actually sold.
     */
    const discounted = scoped.reduce((s, r) => s + (r.discountTotal ?? 0), 0);
    const discountRate =
      grossSales + discounted > 0
        ? Math.round((discounted * 1000) / (grossSales + discounted)) / 10
        : 0;
    const byMode: Record<string, number> = {};
    const byItem: Record<string, number> = {};
    scoped.forEach((r) => {
      byMode[r.mode] = (byMode[r.mode] ?? 0) + r.total;
      r.lines.forEach((l) => (byItem[l.name] = (byItem[l.name] ?? 0) + l.qty));
    });
    // Net the refund back out of the method it was paid back through, so the
    // top payment method reflects money actually kept.
    scopedReturns.forEach((ret) => {
      byMode[ret.method] = (byMode[ret.method] ?? 0) - ret.total;
      ret.lines.forEach((l) => (byItem[l.name] = (byItem[l.name] ?? 0) - l.qty));
    });
    const topItem = Object.entries(byItem)
      .filter(([, qty]) => qty > 0)
      .sort((a, b) => b[1] - a[1])[0];
    const topMode = Object.entries(byMode)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])[0];
    const netSales = grossSales - refunded;
    return {
      grossSales,
      refunded,
      discounted,
      discountRate,
      netSales,
      returnCount: scopedReturns.length,
      count: scoped.length,
      avg: scoped.length ? Math.round(netSales / scoped.length) : 0,
      topItem,
      topMode,
      lowStock: products.filter((i) => i.stockQuantity !== null && i.stockQuantity <= 3).length,
      remaining: products.reduce((s, i) => s + (i.stockQuantity ?? 0), 0),
    };
  }, [scoped, scopedReturns, products]);

  const hasData = scoped.length > 0 || scopedReturns.length > 0;

  /**
   * With a preset, the arrows move between presets. With a custom window they
   * slide it by its own length, so picking one day lets you walk back through
   * history a day at a time.
   */
  const step = (dir: -1 | 1) => {
    feedbackTap();
    if (custom) {
      const days = Math.max(1, Math.round((custom.to - custom.from) / DAY));
      const nextFrom = addDays(custom.from, dir * days);
      // Never scroll past today.
      if (dir === 1 && nextFrom >= endOfDay(Date.now())) return;
      setCustom({ from: nextFrom, to: addDays(nextFrom, days) });
      return;
    }
    setRangeIndex((i) => Math.min(RANGES.length - 1, Math.max(0, i + dir)));
  };

  /** Start the two-step from/to flow. */
  const startCustom = () => {
    feedbackTap();
    setPickerOpen(false);
    setDraftFrom(null);
    setPicking("from");
  };

  const onPickDate = (date: Date) => {
    if (picking === "from") {
      setDraftFrom(startOfDay(date.getTime()));
      setPicking("to");
      return;
    }
    const start = draftFrom ?? startOfDay(date.getTime());
    const picked = startOfDay(date.getTime());
    // Tolerate the two dates being chosen in either order.
    const lo = Math.min(start, picked);
    const hi = Math.max(start, picked);
    setCustom({ from: lo, to: endOfDay(hi) });
    setPicking(null);
    setDraftFrom(null);
  };

  /** Open the sales chart for the current range. */
  const openChart = (type: string, title: string, view?: "item" | "time") => {
    feedbackTap();
    router.push({
      pathname: "/report/[type]",
      params: {
        type,
        title,
        from: String(from),
        to: String(to),
        label: rangeLabel,
        // The chart groups itself by whatever this range makes sense as:
        // a day goes hour by hour, a year month by month.
        range,
        // A hand-picked window has no preset name to infer grouping from, so
        // it's judged by how long the span is.
        ...(custom ? { granularity: granularityForSpan(custom.from, custom.to) } : {}),
        ...(view ? { view } : {}),
      },
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
          <Text style={styles.dateText} numberOfLines={1}>
            {rangeLabel}
          </Text>
        </Pressable>
        <Pressable style={styles.dateArrow} hitSlop={8} onPress={() => step(1)}>
          <Ionicons name="arrow-forward" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {pickerOpen && (
        <View style={styles.presetGrid}>
          {RANGES.map((r, i) => {
            const active = !custom && range === r;
            return (
              <Pressable
                key={r}
                style={[styles.preset, active && styles.presetActive]}
                onPress={() => {
                  feedbackTap();
                  setCustom(null);
                  setRangeIndex(i);
                  setPickerOpen(false);
                }}
              >
                <Text style={[styles.presetText, active && { color: colors.white }]}>{r}</Text>
              </Pressable>
            );
          })}
          <Pressable
            style={[styles.preset, styles.presetCustom, !!custom && styles.presetActive]}
            onPress={startCustom}
          >
            <MaterialCommunityIcons
              name="calendar-range"
              size={15}
              color={custom ? colors.white : colors.primary}
            />
            <Text style={[styles.presetText, !!custom && { color: colors.white }]}>Pick dates</Text>
          </Pressable>
        </View>
      )}

      <DatePickerSheet
        visible={picking !== null}
        title={picking === "from" ? "From date" : "To date"}
        value={new Date(picking === "to" ? (draftFrom ?? from) : from)}
        maximumDate={new Date()}
        minimumDate={picking === "to" && draftFrom ? new Date(draftFrom) : undefined}
        onCancel={() => {
          setPicking(null);
          setDraftFrom(null);
        }}
        onConfirm={onPickDate}
      />

      {!hasData ? (
        <View style={styles.emptyWrap}>
          <EmptyState text="No sales in this period" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
        >
          <MetricCard
            label="NET SALES"
            value={formatMoney(stats.netSales, CURRENCY)}
            message={
              stats.refunded > 0
                ? `${formatMoney(stats.grossSales, CURRENCY)} sold less ${formatMoney(stats.refunded, CURRENCY)} refunded`
                : undefined
            }
            onPress={() => openChart("revenue", "Total Sales")}
          />
          {stats.refunded > 0 && (
            <MetricCard
              label="RETURNS"
              value={`-${formatMoney(stats.refunded, CURRENCY)}`}
              valueColor={colors.red500}
              message={`${stats.returnCount} return${stats.returnCount === 1 ? "" : "s"}`}
              onPress={() => {
                feedbackTap();
                router.push("/returns" as Href);
              }}
            />
          )}
          {stats.discounted > 0 && (
            <MetricCard
              label="DISCOUNTS GIVEN"
              value={`-${formatMoney(stats.discounted, CURRENCY)}`}
              valueColor={colors.red500}
              message={`${stats.discountRate}% of what was sold`}
            />
          )}
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
            // Opens the full what-sold breakdown rather than the stock list.
            onPress={() => openChart("revenue", "Item Sales", "item")}
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
  presetCustom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderColor: colors.primary,
  },

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
