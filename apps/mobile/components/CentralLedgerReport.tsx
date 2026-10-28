import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { PosHeader } from "@/components/PosHeader";
import type { CentralAllocation, CentralItem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  centralAllocations,
  centralItems,
  centralLastError,
  centralPendingCount,
  refreshCentralAllocations,
  refreshCentralItems,
  useCentralRevision,
} from "@/lib/central";
import { feedbackTap } from "@/lib/feedback";
import { useResponsive } from "@/lib/responsive";

const RANGES = ["Today", "This Week", "This Month", "All Time"] as const;
type Range = (typeof RANGES)[number];

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type StockStatus = "out" | "low" | "ok";

const DAY = 86_400_000;

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

/** "Today 14:32", "Yesterday 09:10", "12 Aug" — scannable at a glance. */
function whenLabel(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / DAY);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function statusOf(item: CentralItem): StockStatus {
  if (item.totalStock <= 0) return "out";
  if (item.totalStock <= item.minStock) return "low";
  return "ok";
}

type StockRow = {
  item: CentralItem;
  status: StockStatus;
  /** Units sent in the selected period, in this item's own unit. */
  sentInRange: number;
  /** Units ever sent, in this item's own unit. */
  sentAll: number;
  lastSentAt: number;
};

type ShopRow = {
  id: string;
  name: string;
  deliveries: number;
  itemCount: number;
  lastAt: number;
};

/**
 * The Central Store's Reports tab — the owner's at-a-glance control room.
 *
 * A shop reports on sales; the centre has no sales. The owner's questions are
 * different: what is about to run out, where did stock go, what is still on the
 * shelf, and did everything sync. This screen answers those in that order, so
 * the first thing on the page is always something to act on, not a wall of
 * numbers. The range filter only affects movement ("sent", "deliveries",
 * "shops served"); stock on hand is always the live balance.
 */
export function CentralLedgerReport() {
  const router = useRouter();
  const { stores } = useAuth();
  const { isCompact, isExpanded, contentWidth, gutter } = useResponsive();
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
      setError("No saved stock yet. Connect once to load it.");
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

  const pending = centralId ? centralPendingCount(centralId) : 0;
  const syncError = centralId ? centralLastError(centralId) : null;

  const from = useMemo(() => rangeStart(range), [range]);

  /** Cancelled transfers never happened as deliveries; keep them out of totals. */
  const active = useMemo(
    () => allocations.filter((a) => a.status !== "cancelled"),
    [allocations],
  );

  const inRange = useMemo(
    () =>
      active
        .filter((a) => at(a.allocatedAt) >= from)
        .sort((a, b) => at(b.allocatedAt) - at(a.allocatedAt)),
    [active, from],
  );

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );

  const stockRows = useMemo<StockRow[]>(() => {
    const sent = new Map<string, { all: number; inRange: number; lastAt: number }>();
    for (const a of active) {
      const line = sent.get(a.globalItemId) ?? { all: 0, inRange: 0, lastAt: 0 };
      line.all += a.quantity;
      if (at(a.allocatedAt) >= from) line.inRange += a.quantity;
      line.lastAt = Math.max(line.lastAt, at(a.allocatedAt));
      sent.set(a.globalItemId, line);
    }

    const rank: Record<StockStatus, number> = { out: 0, low: 1, ok: 2 };
    return items
      .map((item) => {
        const line = sent.get(item.id);
        return {
          item,
          status: statusOf(item),
          sentInRange: line?.inRange ?? 0,
          sentAll: line?.all ?? 0,
          lastSentAt: line?.lastAt ?? 0,
        };
      })
      .sort((a, b) => {
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        if (a.status !== "ok" && a.item.totalStock !== b.item.totalStock) {
          return a.item.totalStock - b.item.totalStock;
        }
        return a.item.name.localeCompare(b.item.name);
      });
  }, [active, from, items]);

  const outCount = stockRows.filter((r) => r.status === "out").length;
  const lowCount = stockRows.filter((r) => r.status === "low").length;
  const attention = stockRows.filter((r) => r.status !== "ok").slice(0, 4);

  const shopRows = useMemo<ShopRow[]>(() => {
    const map = new Map<
      string,
      { id: string; name: string; deliveries: number; items: Set<string>; lastAt: number }
    >();
    for (const a of inRange) {
      const line =
        map.get(a.toStoreId) ??
        {
          id: a.toStoreId,
          name: a.toStoreName || "A shop",
          deliveries: 0,
          items: new Set<string>(),
          lastAt: 0,
        };
      line.deliveries += 1;
      line.items.add(a.globalItemId);
      line.lastAt = Math.max(line.lastAt, at(a.allocatedAt));
      map.set(a.toStoreId, line);
    }
    return [...map.values()]
      .map((line) => ({
        id: line.id,
        name: line.name,
        deliveries: line.deliveries,
        itemCount: line.items.size,
        lastAt: line.lastAt,
      }))
      .sort((a, b) => b.deliveries - a.deliveries || b.lastAt - a.lastAt);
  }, [inRange]);

  const recent = inRange.slice(0, 5);
  const itemsMoved = new Set(inRange.map((a) => a.globalItemId)).size;
  const shopsServed = shopRows.length;
  const maxDeliveries = shopRows[0]?.deliveries ?? 1;
  const rangeWord = range === "All Time" ? "all time" : range.toLowerCase();

  const openItem = (id: string) => {
    feedbackTap();
    router.push({ pathname: "/central-item-editor", params: { id } } as never);
  };

  const openTransfer = (globalItemId?: string) => {
    feedbackTap();
    router.push({
      pathname: "/send-to-store",
      params: globalItemId ? { globalItemId } : {},
    } as never);
  };

  const rangeChips = (
    <View style={styles.rangeRow}>
      {RANGES.map((r) => (
        <Pressable
          key={r}
          style={[styles.rangeChip, range === r && styles.rangeChipActive]}
          onPress={() => {
            feedbackTap();
            setRange(r);
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: range === r }}
        >
          <Text style={[styles.rangeText, range === r && styles.rangeTextActive]}>{r}</Text>
        </Pressable>
      ))}
    </View>
  );

  const hero = (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <View style={styles.heroIcon}>
          <Ionicons name="business" size={20} color={colors.white} />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.heroTitle}>Central stock at a glance</Text>
          <Text style={styles.heroText}>
            Restock what is running out, see where stock went, and check what is left.
          </Text>
        </View>
      </View>
      <View style={styles.heroActions}>
        <Pressable
          style={styles.primaryBtn}
          onPress={() => openTransfer()}
          accessibilityRole="button"
          accessibilityLabel="Send stock to a shop"
        >
          <Ionicons name="paper-plane" size={14} color={colors.white} />
          <Text style={styles.primaryBtnText}>SEND STOCK</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryBtn}
          onPress={() => {
            feedbackTap();
            router.push("/central-item-editor" as never);
          }}
          accessibilityRole="button"
          accessibilityLabel="Add a central item"
        >
          <Ionicons name="add" size={15} color={colors.primaryDark} />
          <Text style={styles.secondaryBtnText}>ADD ITEM</Text>
        </Pressable>
      </View>
    </View>
  );

  if (!centralId) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <PosHeader />
        <View style={styles.blocked}>
          <Ionicons name="business-outline" size={44} color={colors.grey400} />
          <Text style={styles.blockedTitle}>Central Store not set up</Text>
          <Text style={styles.blockedText}>
            Open the Central Store once to create it. Its stock dashboard appears here.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const kpiCols = isCompact ? 2 : 4;

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <PosHeader />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: gutter,
            maxWidth: Math.min(contentWidth, 1100),
          },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
      >
        {hero}
        {rangeChips}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} size="large" color={colors.primary} />
        ) : error && items.length === 0 ? (
          <View style={styles.blocked}>
            <Ionicons name="cloud-offline-outline" size={44} color={colors.grey400} />
            <Text style={styles.blockedTitle}>Could not load central stock</Text>
            <Text style={styles.blockedText}>{error}</Text>
            <Pressable style={styles.retry} onPress={() => void load()}>
              <Text style={styles.retryText}>TRY AGAIN</Text>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.blocked}>
            <Ionicons name="cube-outline" size={44} color={colors.grey400} />
            <Text style={styles.blockedTitle}>Nothing to track yet</Text>
            <Text style={styles.blockedText}>
              Add the items you keep at the centre. Each one gets a live balance and a transfer
              history here.
            </Text>
            <Pressable
              style={styles.retry}
              onPress={() => {
                feedbackTap();
                router.push("/central-item-editor" as never);
              }}
            >
              <Text style={styles.retryText}>ADD FIRST ITEM</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* 1. What needs a decision now. */}
            <View style={styles.sectionHead}>
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>Needs attention</Text>
                <Text style={styles.sectionHint}>
                  Stock at or below its alert level, plus anything not synced yet.
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.attentionStats}>
                <AttentionStat
                  value={outCount}
                  label="Out of stock"
                  tone={outCount > 0 ? colors.red500 : colors.grey900}
                />
                <View style={styles.attentionDivider} />
                <AttentionStat
                  value={lowCount}
                  label="Running low"
                  tone={lowCount > 0 ? colors.lowStock : colors.grey900}
                />
                <View style={styles.attentionDivider} />
                <AttentionStat
                  value={pending}
                  label="Unsynced"
                  tone={pending > 0 ? colors.lowStock : colors.grey900}
                />
              </View>

              {syncError ? (
                <View style={styles.syncRow}>
                  <Ionicons name="cloud-offline-outline" size={14} color={colors.red800} />
                  <Text style={styles.syncText} numberOfLines={2}>
                    {syncError}
                  </Text>
                </View>
              ) : pending > 0 ? (
                <View style={styles.syncRowPending}>
                  <Ionicons name="cloud-upload-outline" size={14} color={colors.grey800} />
                  <Text style={styles.syncPendingText} numberOfLines={2}>
                    {plural(pending, "change")} saved on this device, waiting to sync.
                  </Text>
                </View>
              ) : null}

              {attention.length === 0 ? (
                <View style={styles.allGood}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.dkGreen} />
                  <Text style={styles.allGoodText}>
                    {pending > 0
                      ? "No stock alerts. Changes will sync when you are back online."
                      : "Nothing needs restocking right now."}
                  </Text>
                </View>
              ) : (
                <>
                  {attention.map((row) => (
                    <Pressable
                      key={row.item.id}
                      style={styles.attentionRow}
                      onPress={() => openItem(row.item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${row.item.name}`}
                    >
                      <View
                        style={[
                          styles.statusDot,
                          {
                            backgroundColor:
                              row.status === "out" ? colors.red500 : colors.lowStock,
                          },
                        ]}
                      />
                      <View style={styles.attentionCopy}>
                        <View style={styles.attentionNameRow}>
                          <Text style={styles.attentionName} numberOfLines={1}>
                            {row.item.name}
                          </Text>
                          <StatusPill status={row.status} />
                        </View>
                        <Text style={styles.attentionMeta} numberOfLines={1}>
                          {row.item.totalStock <= 0
                            ? "None left"
                            : `${row.item.totalStock} ${row.item.unit} left`}
                          {row.item.minStock > 0
                            ? ` · alert below ${row.item.minStock} ${row.item.unit}`
                            : ""}
                        </Text>
                      </View>
                      <Pressable
                        style={styles.transferBtn}
                        hitSlop={6}
                        onPress={(event) => {
                          event.stopPropagation();
                          openTransfer(row.item.id);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Transfer ${row.item.name} to a shop`}
                      >
                        <Ionicons name="arrow-forward" size={13} color={colors.white} />
                        <Text style={styles.transferBtnText}>TRANSFER</Text>
                      </Pressable>
                    </Pressable>
                  ))}
                  {outCount + lowCount > attention.length ? (
                    <Text style={styles.moreNote}>
                      Showing the {attention.length} most urgent of {outCount + lowCount}.
                    </Text>
                  ) : null}
                </>
              )}
            </View>

            {/* 2. Unit-safe counts, so mixed kg/pieces are never added together. */}
            <View style={styles.kpiGrid}>
              <Kpi
                icon="cube-outline"
                value={String(items.length)}
                label="Items tracked"
                basis={kpiCols}
              />
              <Kpi
                icon="paper-plane-outline"
                value={String(inRange.length)}
                label={`Deliveries · ${range}`}
                basis={kpiCols}
              />
              <Kpi
                icon="swap-horizontal-outline"
                value={String(itemsMoved)}
                label={`Items moved · ${range}`}
                basis={kpiCols}
              />
              <Kpi
                icon="storefront-outline"
                value={String(shopsServed)}
                label={`Shops served · ${range}`}
                basis={kpiCols}
              />
            </View>

            {/* 3. Where the stock went, by shop. */}
            <View style={styles.sectionHead}>
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>Where stock went</Text>
                <Text style={styles.sectionHint}>
                  {inRange.length === 0
                    ? `No deliveries in ${rangeWord}.`
                    : `${plural(inRange.length, "delivery", "deliveries")} in ${rangeWord}, by shop.`}
                </Text>
              </View>
              {shopRows.length > 0 ? (
                <Pressable
                  style={styles.linkBtn}
                  onPress={() => {
                    feedbackTap();
                    router.push("/(tabs)/transfers" as never);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.linkBtnText}>ALL TRANSFERS</Text>
                  <Ionicons name="chevron-forward" size={13} color={colors.primaryDark} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.card}>
              {shopRows.length === 0 ? (
                <View style={styles.emptyInline}>
                  <Ionicons name="trail-sign-outline" size={24} color={colors.grey400} />
                  <Text style={styles.emptyInlineText}>
                    Nothing has left the centre in this period.
                  </Text>
                  <Pressable style={styles.emptyInlineBtn} onPress={() => openTransfer()}>
                    <Text style={styles.emptyInlineBtnText}>SEND STOCK</Text>
                  </Pressable>
                </View>
              ) : (
                shopRows.map((shop, index) => (
                  <View
                    key={shop.id}
                    style={[styles.shopRow, index > 0 && styles.rowBorder]}
                  >
                    <View style={styles.shopTop}>
                      <Text style={styles.shopName} numberOfLines={1}>
                        {shop.name}
                      </Text>
                      <Text style={styles.shopLast}>{whenLabel(shop.lastAt)}</Text>
                    </View>
                    <Text style={styles.shopMeta}>
                      {plural(shop.deliveries, "delivery", "deliveries")} ·{" "}
                      {plural(shop.itemCount, "item")}
                    </Text>
                    <View style={styles.shopTrack}>
                      <View
                        style={[
                          styles.shopFill,
                          { width: `${Math.max(6, (shop.deliveries / maxDeliveries) * 100)}%` },
                        ]}
                      />
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* 4. Live shelf balance, most urgent first. */}
            <View style={styles.sectionHead}>
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>Stock on hand</Text>
                <Text style={styles.sectionHint}>
                  Live balance now — not filtered by the date range. Bar fills to twice the alert
                  level.
                </Text>
              </View>
              <Pressable
                style={styles.linkBtn}
                onPress={() => {
                  feedbackTap();
                  router.push("/central-item-editor" as never);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.linkBtnText}>ADD ITEM</Text>
                <Ionicons name="add" size={14} color={colors.primaryDark} />
              </Pressable>
            </View>

            <View style={styles.card}>
              {stockRows.map((row, index) => {
                const { item } = row;
                const pct =
                  item.minStock > 0
                    ? Math.max(0, Math.min(1, item.totalStock / (item.minStock * 2)))
                    : item.totalStock > 0
                      ? 1
                      : 0;
                return (
                  <Pressable
                    key={item.id}
                    style={[styles.stockRow, index > 0 && styles.rowBorder]}
                    onPress={() => openItem(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${item.name}, ${item.totalStock} ${item.unit} on hand`}
                  >
                    <View style={styles.stockTop}>
                      <Text style={styles.stockName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <StatusPill status={row.status} />
                      <Pressable
                        style={styles.stockSend}
                        hitSlop={6}
                        onPress={(event) => {
                          event.stopPropagation();
                          openTransfer(item.id);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Transfer ${item.name} to a shop`}
                      >
                        <Ionicons name="paper-plane-outline" size={14} color={colors.primaryDark} />
                      </Pressable>
                    </View>

                    <View style={styles.stockNumbers}>
                      <Text style={styles.stockQty}>
                        {item.totalStock}
                        <Text style={styles.stockUnit}> {item.unit}</Text>
                      </Text>
                      <Text style={styles.stockSent} numberOfLines={1}>
                        {row.sentInRange > 0
                          ? `sent ${row.sentInRange} ${item.unit} · ${rangeWord}`
                          : `nothing sent · ${rangeWord}`}
                      </Text>
                    </View>

                    {item.minStock > 0 ? (
                      <View style={styles.barRow}>
                        <View style={styles.barTrack}>
                          <View
                            style={[
                              styles.barFill,
                              {
                                width: `${pct * 100}%`,
                                backgroundColor:
                                  row.status === "out"
                                    ? colors.red500
                                    : row.status === "low"
                                      ? colors.lowStock
                                      : colors.primary,
                              },
                            ]}
                          />
                        </View>
                        <Text style={styles.barLabel}>alert {item.minStock}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            {/* 5. Latest movement, with a way to the full ledger. */}
            <View style={styles.sectionHead}>
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>Recent deliveries</Text>
                <Text style={styles.sectionHint}>
                  {recent.length === 0
                    ? `Nothing delivered in ${rangeWord}.`
                    : `The last ${recent.length} in ${rangeWord}.`}
                </Text>
              </View>
              <Pressable
                style={styles.linkBtn}
                onPress={() => {
                  feedbackTap();
                  router.push("/(tabs)/transfers" as never);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.linkBtnText}>VIEW ALL</Text>
                <Ionicons name="chevron-forward" size={13} color={colors.primaryDark} />
              </Pressable>
            </View>

            <View style={styles.card}>
              {recent.length === 0 ? (
                <View style={styles.emptyInline}>
                  <Ionicons name="time-outline" size={24} color={colors.grey400} />
                  <Text style={styles.emptyInlineText}>
                    Deliveries you send will show up here.
                  </Text>
                </View>
              ) : (
                recent.map((a, index) => {
                  const item = itemById.get(a.globalItemId);
                  const name = a.itemName ?? item?.name ?? "Deleted item";
                  const unit = a.itemUnit ?? item?.unit ?? "";
                  return (
                    <View
                      key={a.id}
                      style={[styles.deliveryRow, index > 0 && styles.rowBorder]}
                    >
                      <View style={styles.deliveryIcon}>
                        <Ionicons
                          name="arrow-forward"
                          size={14}
                          color={colors.primaryDark}
                        />
                      </View>
                      <View style={styles.deliveryCopy}>
                        <Text style={styles.deliveryName} numberOfLines={1}>
                          {name}
                        </Text>
                        <Text style={styles.deliveryMeta} numberOfLines={1}>
                          {a.toStoreName} · {whenLabel(at(a.allocatedAt))}
                        </Text>
                      </View>
                      <View style={styles.deliveryRight}>
                        <Text style={styles.deliveryQty} numberOfLines={1}>
                          {a.quantity} {unit}
                        </Text>
                        <Text
                          style={[
                            styles.deliveryStatus,
                            { color: a.status === "fulfilled" ? colors.dkGreen : colors.lowStock },
                          ]}
                        >
                          {a.status === "fulfilled" ? "RECEIVED" : "SENDING"}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            <Text style={styles.footnote}>
              Stock on hand is live; the date range only changes deliveries and “sent” totals.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusPill({ status }: { status: StockStatus }) {
  const tone =
    status === "out" ? colors.red500 : status === "low" ? colors.lowStock : colors.primary;
  return (
    <View style={[styles.pill, { backgroundColor: tone }]}>
      <Text style={styles.pillText}>
        {status === "out" ? "OUT" : status === "low" ? "LOW" : "OK"}
      </Text>
    </View>
  );
}

function AttentionStat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <View style={styles.attentionStat}>
      <Text style={[styles.attentionStatValue, { color: tone }]}>{value}</Text>
      <Text style={styles.attentionStatLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Kpi({
  icon,
  value,
  label,
  basis,
}: {
  icon: IoniconName;
  value: string;
  label: string;
  basis: number;
}) {
  return (
    <View
      style={[
        styles.kpiCell,
        { flexBasis: basis === 2 ? "45%" : "21%" },
      ]}
    >
      <Ionicons name={icon} size={15} color={colors.grey500} />
      <Text
        style={styles.kpiValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
      <Text style={styles.kpiLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.grey200 },
  scroll: {
    width: "100%",
    alignSelf: "center",
    paddingTop: 10,
    paddingBottom: 28,
  },

  hero: {
    backgroundColor: colors.white,
    borderRadius: 6,
    padding: 14,
    marginBottom: 10,
    elevation: 1,
  },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  heroIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: { flex: 1 },
  heroTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900 },
  heroText: {
    fontSize: 12.5,
    color: colors.grey600,
    lineHeight: 18,
    marginTop: 2,
  },
  heroActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
  },
  primaryBtnText: { color: colors.white, fontSize: 11.5, fontWeight: "800", letterSpacing: 0.5 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    backgroundColor: colors.white,
  },
  secondaryBtnText: { color: colors.primaryDark, fontSize: 11.5, fontWeight: "800", letterSpacing: 0.5 },

  rangeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
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

  sectionHead: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginTop: 16,
    marginBottom: 8,
  },
  sectionCopy: { flex: 1 },
  sectionTitle: { fontSize: 15.5, fontWeight: "800", color: colors.grey900 },
  sectionHint: { fontSize: 11.5, color: colors.grey600, marginTop: 2, lineHeight: 16 },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: -2,
  },
  linkBtnText: { fontSize: 10.5, fontWeight: "800", color: colors.primaryDark, letterSpacing: 0.4 },

  card: {
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    elevation: 1,
  },

  attentionStats: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  attentionStat: { flex: 1, alignItems: "center" },
  attentionStatValue: { fontSize: 24, fontWeight: "800" },
  attentionStatLabel: {
    fontSize: 10.5,
    color: colors.grey600,
    fontWeight: "600",
    marginTop: 1,
    textAlign: "center",
  },
  attentionDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: colors.grey300,
  },
  syncRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FDECEA",
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  syncText: { flex: 1, fontSize: 11.5, color: colors.red800, fontWeight: "600" },
  syncRowPending: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFF4E5",
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  syncPendingText: { flex: 1, fontSize: 11.5, color: colors.grey800, fontWeight: "600" },
  allGood: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingBottom: 14,
  },
  allGoodText: { flex: 1, fontSize: 12.5, color: colors.grey700, lineHeight: 18 },

  attentionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.grey300,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  attentionCopy: { flex: 1 },
  attentionNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  attentionName: { flexShrink: 1, fontSize: 14, fontWeight: "700", color: colors.grey900 },
  attentionMeta: { fontSize: 11.5, color: colors.grey600, marginTop: 2 },
  transferBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: 3,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  transferBtnText: { color: colors.white, fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4 },
  moreNote: {
    fontSize: 11,
    color: colors.grey500,
    fontStyle: "italic",
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.grey300,
  },

  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  kpiCell: {
    flexGrow: 1,
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 10,
    elevation: 1,
  },
  kpiValue: { fontSize: 22, fontWeight: "800", color: colors.grey900, marginTop: 4 },
  kpiLabel: { fontSize: 10.5, color: colors.grey600, marginTop: 1, lineHeight: 14 },

  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.grey300 },
  shopRow: { paddingVertical: 11 },
  shopTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  shopName: { flex: 1, fontSize: 14.5, fontWeight: "700", color: colors.grey900 },
  shopLast: { fontSize: 11, color: colors.grey500, fontWeight: "600" },
  shopMeta: { fontSize: 11.5, color: colors.grey600, marginTop: 2 },
  shopTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.grey200,
    marginTop: 8,
    overflow: "hidden",
  },
  shopFill: { height: 5, borderRadius: 3, backgroundColor: colors.primary },

  stockRow: { paddingVertical: 11 },
  stockTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  stockName: { flex: 1, fontSize: 14.5, fontWeight: "700", color: colors.grey900 },
  stockSend: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.grey100,
    alignItems: "center",
    justifyContent: "center",
  },
  stockNumbers: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 4,
  },
  stockQty: { fontSize: 20, fontWeight: "800", color: colors.grey900 },
  stockUnit: { fontSize: 12, fontWeight: "600", color: colors.grey600 },
  stockSent: { flexShrink: 1, fontSize: 11, color: colors.grey500, textAlign: "right" },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.grey200,
    overflow: "hidden",
  },
  barFill: { height: 6, borderRadius: 3 },
  barLabel: { fontSize: 10.5, color: colors.grey500, fontWeight: "600" },

  pill: { borderRadius: 9, paddingHorizontal: 7, paddingVertical: 2 },
  pillText: { color: colors.white, fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },

  deliveryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  deliveryIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.blue50,
    alignItems: "center",
    justifyContent: "center",
  },
  deliveryCopy: { flex: 1 },
  deliveryName: { fontSize: 13.5, fontWeight: "700", color: colors.grey900 },
  deliveryMeta: { fontSize: 11.5, color: colors.grey600, marginTop: 1 },
  deliveryRight: { alignItems: "flex-end" },
  deliveryQty: { fontSize: 13, fontWeight: "800", color: colors.grey900 },
  deliveryStatus: { fontSize: 9, fontWeight: "800", letterSpacing: 0.4, marginTop: 2 },

  emptyInline: { alignItems: "center", gap: 6, paddingVertical: 18 },
  emptyInlineText: {
    fontSize: 12.5,
    color: colors.grey600,
    textAlign: "center",
    lineHeight: 18,
  },
  emptyInlineBtn: {
    marginTop: 4,
    backgroundColor: colors.primary,
    borderRadius: 4,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  emptyInlineBtnText: { color: colors.white, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },

  footnote: {
    fontSize: 11,
    color: colors.grey500,
    textAlign: "center",
    marginTop: 18,
    lineHeight: 16,
  },

  blocked: { alignItems: "center", justifyContent: "center", padding: 30, gap: 8, marginTop: 40 },
  blockedTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 10 },
  blockedText: { fontSize: 13.5, color: colors.grey600, textAlign: "center", lineHeight: 20 },
  retry: {
    marginTop: 12,
    backgroundColor: colors.primary,
    borderRadius: 4,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryText: { color: colors.white, fontWeight: "800", fontSize: 13, letterSpacing: 0.5 },
});
