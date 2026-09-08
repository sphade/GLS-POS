import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { EmptyState } from "@/components/EmptyState";
import { ReceiptDisclosureRow } from "@/components/ReceiptDisclosureRow";
import { useCart, type Receipt } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import { feedbackTap } from "@/lib/feedback";

const CURRENCY = "NGN";
const NO_REASON = "No reason given";

/** The order-level reason, or the fallback when a till gave one without typing why. */
function reasonOf(receipt: Receipt): string {
  const reason = receipt.orderDiscount?.reason?.trim();
  return reason && reason.length > 0 ? reason : NO_REASON;
}

/** Discount as a share of what the bill would have been before it. */
function shareOf(receipt: Receipt): number {
  const discount = receipt.discountTotal ?? 0;
  const gross = receipt.total + discount;
  return gross > 0 ? Math.round((discount * 1000) / gross) / 10 : 0;
}

type Group = { key: string; label: string; amount: number; count: number };

/**
 * Every giveaway in the period, grouped by why.
 *
 * Discounts are the classic till-fraud vector, so the useful question is not
 * "how much" — the overview already says that — but *who* gave it away, *why*,
 * and *how often*. That's what this answers, and why it exists as its own
 * screen rather than another revenue chart.
 */
export default function DiscountsScreen() {
  const router = useRouter();
  const { from, to, label } = useLocalSearchParams<{
    from?: string;
    to?: string;
    label?: string;
  }>();
  const { can } = useAuth();
  const { receipts: allReceipts } = useCart();

  const [groupBy, setGroupBy] = useState<"reason" | "staff">("reason");
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);

  const bounds = useMemo(
    () => ({ lo: from ? Number(from) : 0, hi: to ? Number(to) : Date.now() + 1 }),
    [from, to],
  );

  /** Only discounted sales, newest first, inside the range drilled in from. */
  const discounted = useMemo(
    () =>
      allReceipts
        .filter(
          (receipt) =>
            (receipt.discountTotal ?? 0) > 0 &&
            receipt.createdAt >= bounds.lo &&
            receipt.createdAt < bounds.hi,
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    [allReceipts, bounds],
  );

  const totals = useMemo(() => {
    const given = discounted.reduce((sum, r) => sum + (r.discountTotal ?? 0), 0);
    const sold = discounted.reduce((sum, r) => sum + r.total, 0);
    const biggest = discounted.reduce(
      (worst, r) => ((r.discountTotal ?? 0) > (worst?.discountTotal ?? 0) ? r : worst),
      undefined as Receipt | undefined,
    );
    return {
      given,
      count: discounted.length,
      // Share of what those bills would have come to before the reduction.
      share: given + sold > 0 ? Math.round((given * 1000) / (given + sold)) / 10 : 0,
      biggest,
    };
  }, [discounted]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const receipt of discounted) {
      // `servedBy` is always set but can be an empty snapshot on old receipts.
      const key = groupBy === "reason" ? reasonOf(receipt) : receipt.servedBy || "Unknown";
      const group = map.get(key) ?? { key, label: key, amount: 0, count: 0 };
      group.amount += receipt.discountTotal ?? 0;
      group.count += 1;
      map.set(key, group);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [discounted, groupBy]);

  const subtitle = (label ?? "All time").toUpperCase();

  const header = (
    <View>
      <View style={styles.summaryCard}>
        <View style={styles.summaryMain}>
          <Text style={styles.summaryLabel}>GIVEN AWAY</Text>
          <Text style={styles.summaryValue}>-{formatMoney(totals.given, CURRENCY)}</Text>
          <Text style={styles.summaryMeta}>
            {totals.share}% of what those {totals.count} sale{totals.count === 1 ? "" : "s"} would
            have been
          </Text>
        </View>
      </View>

      {totals.biggest ? (
        <Pressable
          style={styles.biggestCard}
          onPress={() => {
            feedbackTap();
            router.push({ pathname: "/receipt/[id]", params: { id: totals.biggest!.id } });
          }}
        >
          <MaterialCommunityIcons name="alert-decagram-outline" size={20} color={colors.red800} />
          <View style={{ flex: 1 }}>
            <Text style={styles.biggestLabel}>Largest single discount</Text>
            <Text style={styles.biggestMeta}>
              {totals.biggest.number} · {shareOf(totals.biggest)}% off ·{" "}
              {totals.biggest.servedBy || "Unknown"}
            </Text>
          </View>
          <Text style={styles.biggestValue}>
            -{formatMoney(totals.biggest.discountTotal ?? 0, CURRENCY)}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.tabs}>
        <GroupTab
          label="BY REASON"
          active={groupBy === "reason"}
          onPress={() => {
            feedbackTap();
            setGroupBy("reason");
          }}
        />
        <GroupTab
          label="BY STAFF"
          active={groupBy === "staff"}
          onPress={() => {
            feedbackTap();
            setGroupBy("staff");
          }}
        />
      </View>

      {groups.map((group) => {
        const pct = totals.given > 0 ? Math.round((group.amount / totals.given) * 100) : 0;
        return (
          <View key={group.key} style={styles.groupCard}>
            <View style={styles.groupTop}>
              <Text style={styles.groupLabel} numberOfLines={1}>
                {group.label}
              </Text>
              <Text style={styles.groupValue}>-{formatMoney(group.amount, CURRENCY)}</Text>
            </View>
            <Text style={styles.groupMeta}>
              {group.count} sale{group.count === 1 ? "" : "s"} · {pct}% of all discounts
            </Text>
            <View style={styles.track}>
              {pct > 0 ? <View style={[styles.fill, { width: `${pct}%` }]} /> : null}
            </View>
          </View>
        );
      })}

      <Text style={styles.listHeading}>DISCOUNTED SALES</Text>
      <Text style={styles.listHint}>Tap to show items · hold to open the receipt</Text>
    </View>
  );

  /** Same gate as the overview: this route is reachable by deep link too. */
  if (!can("reports:view")) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <Header subtitle={subtitle} onClose={() => router.back()} />
        <View style={styles.denied}>
          <Ionicons name="lock-closed-outline" size={46} color={colors.grey400} />
          <Text style={styles.deniedText}>You don&apos;t have permission to view reports.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <Header subtitle={subtitle} onClose={() => router.back()} />
      {discounted.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState text="No discounts given in this period" size={120} />
        </View>
      ) : (
        <FlatList
          data={discounted}
          keyExtractor={(receipt) => receipt.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: 8, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <View>
              <ReceiptDisclosureRow
                receipt={item}
                behavior="expand"
                expanded={expandedReceiptId === item.id}
                onPress={() => {
                  feedbackTap();
                  setExpandedReceiptId((current) => (current === item.id ? null : item.id));
                }}
                onLongPress={() => {
                  feedbackTap();
                  router.push({ pathname: "/receipt/[id]", params: { id: item.id } });
                }}
              />
              {/* Why it was given sits with the sale, not buried in the receipt. */}
              <View style={styles.reasonRow}>
                <MaterialCommunityIcons name="tag-off-outline" size={13} color={colors.red800} />
                <Text style={styles.reasonText} numberOfLines={1}>
                  -{formatMoney(item.discountTotal ?? 0, CURRENCY)} · {shareOf(item)}% ·{" "}
                  {reasonOf(item)}
                </Text>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Header({ subtitle, onClose }: { subtitle: string; onClose: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onClose} style={styles.headerBtn} hitSlop={8}>
        <Ionicons name="close" size={26} color={colors.primary} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>DISCOUNTS GIVEN</Text>
        <Text style={styles.headerSub}>{subtitle}</Text>
      </View>
      <View style={styles.headerBtn} />
    </View>
  );
}

function GroupTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    height: 58,
    elevation: 2,
  },
  headerBtn: { width: 48, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16, fontWeight: "800", color: colors.primary, letterSpacing: 0.5 },
  headerSub: { fontSize: 11, color: colors.grey600, marginTop: 1, letterSpacing: 0.4 },

  denied: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 32 },
  deniedText: { fontSize: 15, color: colors.grey600, textAlign: "center" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  summaryCard: {
    backgroundColor: colors.white,
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
    elevation: 1,
  },
  summaryMain: { alignItems: "center" },
  summaryLabel: { fontSize: 11, fontWeight: "800", color: colors.grey600, letterSpacing: 1 },
  summaryValue: { fontSize: 32, fontWeight: "900", color: colors.red800, marginTop: 6 },
  summaryMeta: { fontSize: 12, color: colors.grey600, marginTop: 6, textAlign: "center" },

  biggestCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FDECEA",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  biggestLabel: { fontSize: 13, fontWeight: "700", color: colors.grey900 },
  biggestMeta: { fontSize: 11, color: colors.grey700, marginTop: 2 },
  biggestValue: { fontSize: 15, fontWeight: "800", color: colors.red800 },

  tabs: { flexDirection: "row", gap: 8, marginBottom: 8 },
  tab: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingVertical: 11,
    elevation: 1,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 12, fontWeight: "800", color: colors.grey600, letterSpacing: 0.6 },
  tabTextActive: { color: colors.white },

  groupCard: {
    backgroundColor: colors.white,
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
    elevation: 1,
  },
  groupTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  groupLabel: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.grey900 },
  groupValue: { fontSize: 14, fontWeight: "800", color: colors.red800 },
  groupMeta: { fontSize: 11.5, color: colors.grey600, marginTop: 3 },
  track: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.grey200,
    marginTop: 8,
    overflow: "hidden",
  },
  fill: { height: 5, borderRadius: 3, backgroundColor: colors.red500 },

  listHeading: {
    fontSize: 11.5,
    fontWeight: "800",
    color: colors.grey600,
    letterSpacing: 1,
    marginTop: 18,
    paddingHorizontal: 4,
  },
  listHint: { fontSize: 11, color: colors.grey600, marginTop: 2, marginBottom: 8, paddingHorizontal: 4 },

  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingBottom: 8,
    marginTop: -4,
  },
  reasonText: { flex: 1, fontSize: 11.5, color: colors.red800, fontWeight: "600" },
});
