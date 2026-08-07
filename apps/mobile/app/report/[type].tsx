import { useMemo, useRef, useState } from "react";
import {
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { BarChart, type Bar } from "@/components/BarChart";
import { EmptyState } from "@/components/EmptyState";
import { useCart, type Receipt } from "@/lib/cart";
import { feedbackTap } from "@/lib/feedback";

const CURRENCY = "NGN";
const PERIODS = ["hourly", "weekly", "monthly"] as const;
type Period = (typeof PERIODS)[number];
type SortField = "total" | "count";
type SortDir = "desc" | "asc";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hourLabel(h: number) {
  const s = h % 12 === 0 ? 12 : h % 12;
  const e = (h + 1) % 12 === 0 ? 12 : (h + 1) % 12;
  const ap = h < 12 ? "am" : "pm";
  const ap2 = h + 1 < 12 || h + 1 === 24 ? "am" : "pm";
  return `${s}:00${ap} - ${e}:00${ap2}`;
}

type Bucket = { label: string; total: number; count: number };

function bucketize(receipts: Receipt[], period: Period, sortField: SortField, sortDir: SortDir): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of receipts) {
    const d = new Date(r.createdAt);
    const label =
      period === "hourly" ? hourLabel(d.getHours()) : period === "weekly" ? WEEKDAYS[d.getDay()]! : MONTHS[d.getMonth()]!;
    const b = map.get(label) ?? { label, total: 0, count: 0 };
    b.total += r.total;
    b.count += 1;
    map.set(label, b);
  }
  const arr = [...map.values()];
  arr.sort((a, b) => {
    const va = sortField === "total" ? a.total : a.count;
    const vb = sortField === "total" ? b.total : b.count;
    return sortDir === "desc" ? vb - va : va - vb;
  });
  return arr;
}

export default function ReportDetailScreen() {
  const router = useRouter();
  const { type = "revenue", title = "Revenue" } = useLocalSearchParams<{ type?: string; title?: string }>();
  const { receipts } = useCart();
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);

  const [period, setPeriod] = useState<Period>("hourly");
  const [sortField, setSortField] = useState<SortField>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [sortOpen, setSortOpen] = useState(false);

  const isCount = type === "salesCount";
  const fmt = (n: number) => (isCount ? String(n) : formatMoney(n, CURRENCY));

  const pages = useMemo(
    () => PERIODS.map((p) => bucketize(receipts, p, sortField, sortDir)),
    [receipts, sortField, sortDir],
  );

  /** Swipe → update the active tab. */
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    const next = PERIODS[Math.max(0, Math.min(PERIODS.length - 1, idx))]!;
    if (next !== period) {
      setPeriod(next);
      feedbackTap();
    }
  };

  /** Tap → scroll the pager to that page. */
  const goToPeriod = (p: Period) => {
    feedbackTap();
    setPeriod(p);
    pagerRef.current?.scrollTo({ x: PERIODS.indexOf(p) * width, animated: true });
  };

  const subtitle = `YESTERDAY : ${new Date()
    .toLocaleDateString("en-US", { day: "2-digit", month: "short" })
    .toUpperCase()}`;

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
        <Pressable onPress={feedbackTap} style={styles.headerBtn} hitSlop={8}>
          <Ionicons name="share-social" size={22} color={colors.primary} />
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {PERIODS.map((p) => (
          <Pressable key={p} style={styles.tab} onPress={() => goToPeriod(p)}>
            <Text style={[styles.tabText, period === p && styles.tabTextActive]}>{p.toUpperCase()}</Text>
            {period === p && <View style={styles.indicator} />}
          </Pressable>
        ))}
      </View>

      {/* Swipeable pages */}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {pages.map((buckets, i) => (
          <View key={PERIODS[i]} style={{ width }}>
            {buckets.length === 0 ? (
              <View style={styles.emptyWrap}>
                <EmptyState text="No data for this period" size={120} />
              </View>
            ) : (
              <PeriodPage buckets={buckets} isCount={isCount} fmt={fmt} />
            )}
          </View>
        ))}
      </ScrollView>

      {/* Sort FAB */}
      <Pressable
        style={styles.fab}
        onPress={() => {
          feedbackTap();
          setSortOpen(true);
        }}
      >
        <MaterialCommunityIcons name="sort" size={24} color={colors.white} />
      </Pressable>

      {/* Sort sheet */}
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
              <Segmented
                left="By receipt count"
                right="By total"
                value={sortField === "count" ? "left" : "right"}
                onChange={(s) => setSortField(s === "left" ? "count" : "total")}
              />
              <Segmented
                left="High to Low"
                right="Low to High"
                value={sortDir === "desc" ? "left" : "right"}
                onChange={(s) => setSortDir(s === "left" ? "desc" : "asc")}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function PeriodPage({
  buckets,
  isCount,
  fmt,
}: {
  buckets: Bucket[];
  isCount: boolean;
  fmt: (n: number) => string;
}) {
  const max = Math.max(...buckets.map((b) => (isCount ? b.count : b.total)), 1);
  const chartData: Bar[] = buckets.map((b) => ({ label: b.label, value: isCount ? b.count : b.total }));

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 90 }}>
      <BarChart data={chartData} formatValue={fmt} />
      {buckets.map((b, i) => {
        const value = isCount ? b.count : b.total;
        const pct = Math.round((value / max) * 100);
        return (
          <View key={i} style={styles.listCard}>
            <View style={styles.listTop}>
              <Text style={styles.listLabel}>{b.label}</Text>
              <Text style={styles.listValue}>{fmt(value)}</Text>
            </View>
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

  tabs: { flexDirection: "row", backgroundColor: colors.grey50 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", height: 44 },
  tabText: { fontSize: 14, fontWeight: "600", color: colors.grey600, letterSpacing: 0.4 },
  tabTextActive: { color: colors.grey900, fontWeight: "700" },
  indicator: { position: "absolute", bottom: 0, left: 16, right: 16, height: 3, backgroundColor: colors.primary },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 60 },

  listCard: { backgroundColor: colors.card, marginHorizontal: 10, marginTop: 8, borderRadius: 4, padding: 12, elevation: 1 },
  listTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  listLabel: { fontSize: 15, color: colors.grey800, fontWeight: "500" },
  listValue: { fontSize: 15, color: colors.grey900, fontWeight: "700" },
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
  sheetBody: { padding: 12, gap: 12 },
  segmented: { flexDirection: "row", backgroundColor: colors.white, borderRadius: 24, padding: 3, elevation: 1 },
  segHalf: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: 22 },
  segActive: { backgroundColor: colors.primary },
  segText: { fontSize: 14, fontWeight: "700", color: colors.primary },
  segTextActive: { color: colors.white },
});
