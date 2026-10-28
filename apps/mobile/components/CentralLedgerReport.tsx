import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { PosHeader } from "@/components/PosHeader";
import type { CentralAllocation, CentralItem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  centralAllocations,
  centralItems,
  refreshCentralAllocations,
  refreshCentralItems,
  useCentralRevision,
} from "@/lib/central";
import { feedbackTap } from "@/lib/feedback";

const RANGES = ["Today", "This Week", "This Month", "All Time"] as const;
type Range = (typeof RANGES)[number];

function rangeStart(range: Range): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  switch (range) {
    case "Today":
      return d.getTime();
    case "This Week": {
      const w = new Date(d);
      w.setDate(w.getDate() - w.getDay());
      return w.getTime();
    }
    case "This Month":
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    default:
      return 0;
  }
}

function at(at: string | number | null | undefined): number {
  const t = new Date(at ?? 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

type ShopLine = {
  shop: string;
  /** Units that left the centre. */
  sent: number;
  /** Units the shop's own stock was raised by, when it differs. */
  received: number | null;
  receiveUnit: string | null;
  unit: string;
  lastAt: number;
  sends: number;
};

type LedgerRow = {
  item: CentralItem;
  onHand: number;
  /** Everything this item has ever brought in: on hand plus all it ever sent. */
  receivedIn: number;
  sentAll: number;
  sentInRange: number;
  shops: ShopLine[];
};

/**
 * The Central Store's Reports tab.
 *
 * A normal shop reports on sales; the centre has no sales — the owner's job is
 * to see where stock goes. So this is a movement ledger: for every central item,
 * what has come in, what has been sent to each shop, and what is still on hand,
 * with the range filter applied to the "sent" side so a week of deliveries can
 * be checked against what is left.
 *
 * "Received in" is derived (on hand + everything ever sent) rather than stored,
 * which keeps it correct for items created before this screen existed.
 */
export function CentralLedgerReport() {
  const { stores } = useAuth();
  const central = stores.find((s) => s.isCentral);
  const centralId = central?.id;
  const revision = useCentralRevision();

  const [items, setItems] = useState<CentralItem[]>([]);
  const [allocations, setAllocations] = useState<CentralAllocation[]>([]);
  const [range, setRange] = useState<Range>("This Month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!centralId) return;
    setError(null);
    setItems(centralItems(centralId));
    setAllocations(centralAllocations(centralId));
    setLoading(false);

    const [itemsOk, allocationsOk] = await Promise.all([
      refreshCentralItems(centralId),
      refreshCentralAllocations(centralId, { fromStoreId: centralId }),
    ]);
    setItems(centralItems(centralId));
    setAllocations(centralAllocations(centralId));
    if (!itemsOk && !allocationsOk && centralItems(centralId).length === 0) {
      setError("No saved ledger yet. Connect once to load it.");
    }
  }, [centralId]);

  useEffect(() => {
    if (!centralId) return;
    setItems(centralItems(centralId));
    setAllocations(centralAllocations(centralId));
  }, [centralId, revision]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(() => {
    feedbackTap();
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const rows = useMemo<LedgerRow[]>(() => {
    const from = rangeStart(range);
    const byItem = new Map<string, CentralAllocation[]>();
    for (const a of allocations) {
      if (a.status === "cancelled") continue;
      const list = byItem.get(a.globalItemId);
      if (list) list.push(a);
      else byItem.set(a.globalItemId, [a]);
    }

    return items.map((item) => {
      const sends = byItem.get(item.id) ?? [];
      const sentAll = sends.reduce((sum, a) => sum + a.quantity, 0);
      const inWindow = sends.filter((a) => at(a.allocatedAt) >= from);
      const shopMap = new Map<string, ShopLine>();

      for (const a of sends) {
        const key = a.toStoreId;
        const line = shopMap.get(key) ?? {
          shop: a.toStoreName,
          sent: 0,
          received: null,
          receiveUnit: null,
          unit: item.unit,
          lastAt: 0,
          sends: 0,
        };
        line.sent += a.quantity;
        line.sends += 1;
        line.lastAt = Math.max(line.lastAt, at(a.allocatedAt));
        if (a.receiveQuantity != null && a.receiveQuantity !== a.quantity) {
          line.received = (line.received ?? 0) + a.receiveQuantity;
          line.receiveUnit = a.receiveUnit ?? line.receiveUnit;
        }
        shopMap.set(key, line);
      }

      return {
        item,
        onHand: item.totalStock,
        receivedIn: item.totalStock + sentAll,
        sentAll,
        sentInRange: inWindow.reduce((sum, a) => sum + a.quantity, 0),
        shops: [...shopMap.values()].sort((a, b) => b.lastAt - a.lastAt),
      };
    });
  }, [allocations, items, range]);

  const lowCount = rows.filter((r) => r.item.totalStock <= r.item.minStock).length;
  const sendsInRange = allocations.filter(
    (a) => a.status !== "cancelled" && at(a.allocatedAt) >= rangeStart(range),
  ).length;
  const shopsServed = new Set(
    allocations.filter((a) => a.status !== "cancelled").map((a) => a.toStoreId),
  ).size;

  const header = (
    <>
      <View style={styles.rangeRow}>
        {RANGES.map((r) => (
          <Pressable
            key={r}
            style={[styles.rangeChip, range === r && styles.rangeChipActive]}
            onPress={() => {
              feedbackTap();
              setRange(r);
            }}
          >
            <Text style={[styles.rangeText, range === r && styles.rangeTextActive]}>{r}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.summary}>
        <Summary value={String(rows.length)} label="Items tracked" />
        <Summary value={String(sendsInRange)} label={`Sent · ${range}`} />
        <Summary value={String(shopsServed)} label="Shops served" />
        <Summary
          value={String(lowCount)}
          label="Low stock"
          valueColor={lowCount > 0 ? colors.red500 : undefined}
        />
      </View>
    </>
  );

  if (!centralId) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <PosHeader title="Stock Ledger" />
        <View style={styles.blocked}>
          <MaterialCommunityIcons name="crown-outline" size={44} color={colors.grey400} />
          <Text style={styles.blockedTitle}>Central Store not set up</Text>
          <Text style={styles.blockedText}>
            Open the Central Store once to create it. Its stock ledger appears here.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <PosHeader title="Stock Ledger" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
      >
        {header}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} size="large" color={colors.primary} />
        ) : error && rows.length === 0 ? (
          <View style={styles.blocked}>
            <Ionicons name="cloud-offline-outline" size={44} color={colors.grey400} />
            <Text style={styles.blockedTitle}>Could not load the ledger</Text>
            <Text style={styles.blockedText}>{error}</Text>
            <Pressable style={styles.retry} onPress={() => void load()}>
              <Text style={styles.retryText}>TRY AGAIN</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.blocked}>
            <MaterialCommunityIcons name="package-variant" size={44} color={colors.grey400} />
            <Text style={styles.blockedTitle}>Nothing to track yet</Text>
            <Text style={styles.blockedText}>
              Add items to the Central Store — every one of them gets a running ledger here.
            </Text>
          </View>
        ) : (
          rows.map((row) => {
            const low = row.item.totalStock <= row.item.minStock;
            return (
              <View key={row.item.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {row.item.name}
                  </Text>
                  {low ? (
                    <View style={styles.lowPill}>
                      <Text style={styles.lowPillText}>LOW</Text>
                    </View>
                  ) : null}
                </View>

                <Text style={styles.onHand}>
                  {row.onHand} {row.item.unit}
                  <Text style={styles.onHandLabel}> on hand</Text>
                </Text>

                <View style={styles.statsRow}>
                  <Stat label="Received in" value={`${row.receivedIn} ${row.item.unit}`} />
                  <Stat label="Sent out" value={`${row.sentAll} ${row.item.unit}`} />
                  <Stat label={range} value={`${row.sentInRange} ${row.item.unit}`} />
                </View>

                {row.shops.length > 0 ? (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.sectionLabel}>WHERE IT WENT</Text>
                    {row.shops.map((line) => (
                      <View key={line.shop} style={styles.shopRow}>
                        <Text style={styles.shopName} numberOfLines={1}>
                          {line.shop}
                        </Text>
                        <Text style={styles.shopValue}>
                          {line.sent} {line.unit}
                          {line.received != null
                            ? ` → ${line.received} ${line.receiveUnit ?? line.unit}`
                            : ""}
                        </Text>
                      </View>
                    ))}
                  </>
                ) : (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.notSent}>Never sent anywhere yet</Text>
                  </>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Summary({
  value,
  label,
  valueColor,
}: {
  value: string;
  label: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.summaryCell}>
      <Text
        style={[styles.summaryValue, valueColor ? { color: valueColor } : null]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {value}
      </Text>
      <Text style={styles.summaryLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.grey200 },
  scroll: {
    padding: 8,
    paddingBottom: 24,
    width: "100%",
    maxWidth: 1000,
    alignSelf: "center",
  },
  rangeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  rangeChip: {
    backgroundColor: colors.white,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey300,
  },
  rangeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  rangeText: { fontSize: 12.5, fontWeight: "700", color: colors.grey700 },
  rangeTextActive: { color: colors.white },
  summary: {
    flexDirection: "row",
    backgroundColor: colors.white,
    borderRadius: 4,
    paddingVertical: 12,
    marginBottom: 8,
    elevation: 1,
  },
  summaryCell: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  summaryValue: { fontSize: 20, fontWeight: "800", color: colors.primary },
  summaryLabel: { fontSize: 11, color: colors.grey600, textAlign: "center", marginTop: 2 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 4,
    padding: 12,
    marginBottom: 8,
    elevation: 1,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: colors.grey900 },
  lowPill: { backgroundColor: colors.red500, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  lowPillText: { color: colors.white, fontSize: 10, fontWeight: "800" },
  onHand: { fontSize: 22, fontWeight: "800", color: colors.primary, marginTop: 6 },
  onHandLabel: { fontSize: 13, fontWeight: "600", color: colors.grey600 },
  statsRow: { flexDirection: "row", marginTop: 10, gap: 6 },
  statCell: {
    flex: 1,
    backgroundColor: colors.grey100,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  statValue: { fontSize: 14, fontWeight: "800", color: colors.grey900 },
  statLabel: { fontSize: 10.5, color: colors.grey600, marginTop: 2, textAlign: "center" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.grey300, marginTop: 12, marginBottom: 8 },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: colors.grey500, letterSpacing: 0.6, marginBottom: 4 },
  shopRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
  shopName: { flex: 1, fontSize: 14, color: colors.grey800, fontWeight: "600" },
  shopValue: { fontSize: 14, color: colors.grey900, fontWeight: "700" },
  notSent: { fontSize: 13, color: colors.grey500, fontStyle: "italic" },
  blocked: { alignItems: "center", justifyContent: "center", padding: 30, gap: 8, marginTop: 40 },
  blockedTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 10 },
  blockedText: { fontSize: 13.5, color: colors.grey600, textAlign: "center", lineHeight: 20 },
  retry: { marginTop: 12, backgroundColor: colors.primary, borderRadius: 4, paddingHorizontal: 24, paddingVertical: 12 },
  retryText: { color: colors.white, fontWeight: "800", fontSize: 13, letterSpacing: 0.5 },
});
