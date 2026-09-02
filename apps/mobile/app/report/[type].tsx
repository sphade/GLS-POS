import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { BarChart, type Bar } from "@/components/BarChart";
import { EmptyState } from "@/components/EmptyState";
import { useCart, type Receipt } from "@/lib/cart";
import { isVoidReturn, useReturns, type SaleReturn } from "@/lib/returns";
import { feedbackTap } from "@/lib/feedback";

const CURRENCY = "NGN";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * How the range is broken up.
 *
 * This follows the range you drilled in from, rather than offering every option
 * regardless. A single day has no meaningful "monthly" view, and grouping a
 * year by weekday name would pile every Monday of the year into one bar — which
 * is what the old fixed HOURLY/WEEKLY/MONTHLY tabs actually did.
 */
type Granularity = "hour" | "weekday" | "date" | "month";

function granularityFor(range: string): Granularity {
  switch (range) {
    case "Today":
    case "Yesterday":
      return "hour";
    case "This Week":
    case "Last Week":
      return "weekday";
    case "This Month":
    case "Last Month":
      return "date";
    default:
      return "month";
  }
}

const GRANULARITY_CAPTION: Record<Granularity, string> = {
  hour: "Hour by hour",
  weekday: "Day by day",
  date: "By date",
  month: "Month by month",
};

/** "8am", "12pm" — short enough for a crowded x-axis. */
function shortHour(hour: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${hour < 12 ? "am" : "pm"}`;
}

/** "8:00am - 9:00am" for the list rows, where there's room. */
function hourRange(hour: number): string {
  const next = (hour + 1) % 24;
  return `${shortHour(hour)} - ${shortHour(next)}`;
}

type Bucket = {
  /** Chronological sort key within the range. */
  key: number;
  /** Short label for the chart axis. */
  label: string;
  /** Fuller label for the list rows. */
  longLabel: string;
  /** Money taken, net of refunds. */
  amount: number;
  /** Units sold, net of returned units. */
  items: number;
  /** Number of sales. A credit note isn't a sale, so refunds don't count here. */
  count: number;
};

function bucketOf(at: number, granularity: Granularity) {
  const d = new Date(at);
  switch (granularity) {
    case "hour": {
      const hour = d.getHours();
      return { key: hour, label: shortHour(hour), longLabel: hourRange(hour) };
    }
    case "weekday": {
      const day = d.getDay();
      const name = WEEKDAYS[day]!;
      return { key: day, label: name, longLabel: name };
    }
    case "date": {
      const date = d.getDate();
      return { key: date, label: String(date), longLabel: `${date} ${MONTHS[d.getMonth()]!}` };
    }
    case "month": {
      const month = d.getMonth();
      const name = MONTHS[month]!;
      return { key: month, label: name, longLabel: name };
    }
  }
}

const lineUnits = (lines: { qty: number }[]) => lines.reduce((sum, line) => sum + line.qty, 0);

/**
 * Group sales into buckets, subtracting refunds from the bucket they were
 * refunded in. Only buckets with activity appear, so a shop that opens at 9am
 * doesn't get eight empty bars.
 */
function bucketize(
  receipts: Receipt[],
  returns: SaleReturn[],
  granularity: Granularity,
): Bucket[] {
  const map = new Map<number, Bucket>();
  const touch = (at: number): Bucket => {
    const { key, label, longLabel } = bucketOf(at, granularity);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { key, label, longLabel, amount: 0, items: 0, count: 0 };
      map.set(key, bucket);
    }
    return bucket;
  };

  for (const receipt of receipts) {
    const bucket = touch(receipt.createdAt);
    bucket.amount += receipt.total;
    bucket.count += 1;
    bucket.items += lineUnits(receipt.lines);
  }
  for (const ret of returns) {
    const bucket = touch(ret.createdAt);
    bucket.amount -= ret.total;
    bucket.items -= lineUnits(ret.lines);
  }

  return [...map.values()];
}

type SortField = "time" | "amount" | "items" | "count";
type SortDir = "asc" | "desc";

const SORT_FIELDS: { key: SortField; label: string }[] = [
  { key: "time", label: "Chronological" },
  { key: "amount", label: "By amount" },
  { key: "items", label: "By items sold" },
  { key: "count", label: "By number of sales" },
];

function sortBuckets(buckets: Bucket[], field: SortField, dir: SortDir): Bucket[] {
  const valueOf = (b: Bucket) =>
    field === "time" ? b.key : field === "amount" ? b.amount : field === "items" ? b.items : b.count;
  return [...buckets].sort((a, b) =>
    dir === "asc" ? valueOf(a) - valueOf(b) : valueOf(b) - valueOf(a),
  );
}

/**
 * Report drill-down.
 *
 * Shows one chart for the range you came from, grouped the way that range makes
 * sense, with amount / items sold / number of sales on every row.
 */
export default function ReportDetailScreen() {
  const router = useRouter();
  const {
    type = "revenue",
    title = "Revenue",
    from,
    to,
    label,
    range = "Today",
  } = useLocalSearchParams<{
    type?: string;
    title?: string;
    from?: string;
    to?: string;
    label?: string;
    range?: string;
  }>();
  const { receipts: allReceipts } = useCart();
  const { returns: allReturns } = useReturns();

  const bounds = useMemo(
    () => ({ lo: from ? Number(from) : 0, hi: to ? Number(to) : Date.now() + 1 }),
    [from, to],
  );

  // Scope to the range the overview was showing. Without this the chart used
  // every receipt ever and mislabelled itself.
  const receipts = useMemo(
    () => allReceipts.filter((r) => r.createdAt >= bounds.lo && r.createdAt < bounds.hi),
    [allReceipts, bounds],
  );

  /** Refunds land in the bucket they were refunded in, and voids moved no money. */
  const returns = useMemo(
    () =>
      allReturns.filter(
        (ret) => !isVoidReturn(ret) && ret.createdAt >= bounds.lo && ret.createdAt < bounds.hi,
      ),
    [allReturns, bounds],
  );

  const granularity = granularityFor(String(range));
  const isCount = type === "salesCount";

  const [sortField, setSortField] = useState<SortField>("time");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [sortOpen, setSortOpen] = useState(false);

  const buckets = useMemo(
    () => sortBuckets(bucketize(receipts, returns, granularity), sortField, sortDir),
    [receipts, returns, granularity, sortField, sortDir],
  );

  const totals = useMemo(
    () =>
      buckets.reduce(
        (acc, b) => ({
          amount: acc.amount + b.amount,
          items: acc.items + b.items,
          count: acc.count + b.count,
        }),
        { amount: 0, items: 0, count: 0 },
      ),
    [buckets],
  );

  const primaryOf = (b: Bucket) => (isCount ? b.count : b.amount);
  const formatAxis = (n: number) => (isCount ? String(n) : formatMoney(n, CURRENCY));
  const formatPrimary = (b: Bucket) =>
    isCount ? `${b.count} ${b.count === 1 ? "sale" : "sales"}` : formatMoney(b.amount, CURRENCY);
  const formatSecondary = (b: Bucket) =>
    isCount
      ? `${formatMoney(b.amount, CURRENCY)} · ${b.items} item${b.items === 1 ? "" : "s"}`
      : `${b.items} item${b.items === 1 ? "" : "s"} · ${b.count} sale${b.count === 1 ? "" : "s"}`;

  const chartData: Bar[] = buckets.map((b) => ({ label: b.label, value: primaryOf(b) }));
  const max = Math.max(...buckets.map((b) => Math.abs(primaryOf(b))), 1);
  const subtitle = (label ?? "All time").toUpperCase();

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <Ionicons name="close" size={26} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{String(title).toUpperCase()}</Text>
          <Text style={styles.headerSub}>{subtitle}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {buckets.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState text="No sales in this period" size={120} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 90 }}>
          {/* What the whole range came to, so drilling in never loses the total. */}
          <View style={styles.summaryCard}>
            <SummaryCell label="AMOUNT" value={formatMoney(totals.amount, CURRENCY)} emphasis />
            <View style={styles.summaryDivider} />
            <SummaryCell label="ITEMS SOLD" value={String(totals.items)} />
            <View style={styles.summaryDivider} />
            <SummaryCell label="SALES" value={String(totals.count)} />
          </View>

          <View style={styles.captionRow}>
            <MaterialCommunityIcons name="chart-bar" size={15} color={colors.grey600} />
            <Text style={styles.caption}>{GRANULARITY_CAPTION[granularity]}</Text>
          </View>

          <BarChart data={chartData} formatValue={formatAxis} />

          {buckets.map((bucket) => {
            const pct = Math.round((Math.max(0, primaryOf(bucket)) / max) * 100);
            return (
              <View key={bucket.key} style={styles.listCard}>
                <View style={styles.listTop}>
                  <Text style={styles.listLabel}>{bucket.longLabel}</Text>
                  <Text style={styles.listValue}>{formatPrimary(bucket)}</Text>
                </View>
                <Text style={styles.listMeta}>{formatSecondary(bucket)}</Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]}>
                    {pct > 20 && <Text style={styles.progressText}>{pct}%</Text>}
                  </View>
                  {pct <= 20 && <Text style={styles.progressTextOut}>{pct}%</Text>}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {buckets.length > 0 && (
        <Pressable
          style={styles.fab}
          onPress={() => {
            feedbackTap();
            setSortOpen(true);
          }}
        >
          <MaterialCommunityIcons name="sort" size={24} color={colors.white} />
        </Pressable>
      )}

      <Modal visible={sortOpen} transparent animationType="slide" onRequestClose={() => setSortOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSortOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Pressable onPress={() => setSortOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={colors.white} />
              </Pressable>
              <Text style={styles.sheetTitle}>SORT</Text>
              <Pressable
                onPress={() => {
                  feedbackTap();
                  setSortOpen(false);
                }}
                hitSlop={8}
              >
                <Ionicons name="checkmark" size={24} color={colors.white} />
              </Pressable>
            </View>
            <View style={styles.sheetBody}>
              {SORT_FIELDS.map((option) => (
                <Pressable
                  key={option.key}
                  style={[styles.sortOption, sortField === option.key && styles.sortOptionActive]}
                  onPress={() => {
                    feedbackTap();
                    setSortField(option.key);
                    // Time reads naturally earliest-first; rankings read best highest-first.
                    setSortDir(option.key === "time" ? "asc" : "desc");
                  }}
                >
                  <Text
                    style={[
                      styles.sortOptionText,
                      sortField === option.key && styles.sortOptionTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                  {sortField === option.key && (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  )}
                </Pressable>
              ))}
              <Segmented
                left={sortField === "time" ? "Earliest first" : "High to Low"}
                right={sortField === "time" ? "Latest first" : "Low to High"}
                value={sortDir === (sortField === "time" ? "asc" : "desc") ? "left" : "right"}
                onChange={(side) => {
                  const primaryDir: SortDir = sortField === "time" ? "asc" : "desc";
                  const otherDir: SortDir = primaryDir === "asc" ? "desc" : "asc";
                  setSortDir(side === "left" ? primaryDir : otherDir);
                }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function SummaryCell({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.summaryCell}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text
        style={[styles.summaryValue, emphasis && styles.summaryValueEmphasis]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  );
}

function Segmented({
  left,
  right,
  value,
  onChange,
}: {
  left: string;
  right: string;
  value: "left" | "right";
  onChange: (s: "left" | "right") => void;
}) {
  return (
    <View style={styles.segmented}>
      <Pressable
        style={[styles.segHalf, value === "left" && styles.segActive]}
        onPress={() => {
          feedbackTap();
          onChange("left");
        }}
      >
        <Text style={[styles.segText, value === "left" && styles.segTextActive]}>{left}</Text>
      </Pressable>
      <Pressable
        style={[styles.segHalf, value === "right" && styles.segActive]}
        onPress={() => {
          feedbackTap();
          onChange("right");
        }}
      >
        <Text style={[styles.segText, value === "right" && styles.segTextActive]}>{right}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.grey50,
    paddingVertical: 10,
    paddingHorizontal: 6,
    elevation: 2,
  },
  headerBtn: { width: 44, alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.primary, letterSpacing: 0.5 },
  headerSub: { fontSize: 13, fontWeight: "700", color: colors.primary, marginTop: 1 },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 60 },

  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 4,
    marginHorizontal: 10,
    marginTop: 10,
    paddingVertical: 12,
    elevation: 1,
  },
  summaryCell: { flex: 1, alignItems: "center", paddingHorizontal: 6 },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: colors.grey300 },
  summaryLabel: { fontSize: 10, fontWeight: "800", color: colors.grey600, letterSpacing: 0.5 },
  summaryValue: { fontSize: 16, fontWeight: "800", color: colors.grey900, marginTop: 3 },
  summaryValueEmphasis: { color: colors.primary },

  captionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    marginHorizontal: 14,
  },
  caption: { fontSize: 12, fontWeight: "700", color: colors.grey600, letterSpacing: 0.3 },

  listCard: {
    backgroundColor: colors.card,
    marginHorizontal: 10,
    marginTop: 8,
    borderRadius: 4,
    padding: 12,
    elevation: 1,
  },
  listTop: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  listLabel: { fontSize: 15, color: colors.grey800, fontWeight: "600" },
  listValue: { fontSize: 15, color: colors.grey900, fontWeight: "700" },
  listMeta: { fontSize: 12, color: colors.grey600, marginTop: 3, marginBottom: 8 },
  progressTrack: {
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.grey200,
    overflow: "hidden",
    justifyContent: "center",
  },
  progressFill: {
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 22,
  },
  progressText: { color: colors.white, fontSize: 12, fontWeight: "700" },
  progressTextOut: { position: "absolute", left: 10, color: colors.primary, fontSize: 12, fontWeight: "700" },

  fab: {
    position: "absolute",
    right: 18,
    bottom: 22,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
  },

  backdrop: { flex: 1, backgroundColor: "#00000066", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.grey200, borderTopLeftRadius: 4, borderTopRightRadius: 4, paddingBottom: 24 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sheetTitle: { color: colors.white, fontSize: 18, fontWeight: "700", letterSpacing: 0.5 },
  sheetBody: { padding: 12, gap: 8 },
  sortOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 13,
    elevation: 1,
  },
  sortOptionActive: { backgroundColor: colors.blue50 },
  sortOptionText: { fontSize: 14, fontWeight: "600", color: colors.grey800 },
  sortOptionTextActive: { color: colors.primaryDark, fontWeight: "800" },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.white,
    borderRadius: 24,
    padding: 3,
    elevation: 1,
    marginTop: 4,
  },
  segHalf: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: 22 },
  segActive: { backgroundColor: colors.primary },
  segText: { fontSize: 14, fontWeight: "700", color: colors.primary },
  segTextActive: { color: colors.white },
});
