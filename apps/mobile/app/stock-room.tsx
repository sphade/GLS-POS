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
import { useFocusEffect, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import {
  centralAllocations,
  centralConversions,
  centralLastError,
  centralPendingCount,
  flushCentralOutbox,
  refreshCentralAllocations,
  refreshCentralConversionRates,
  refreshCentralConversions,
  useCentralRevision,
} from "@/lib/central";
import { useStore } from "@/lib/store";
import { useResponsive } from "@/lib/responsive";
import { feedbackTap } from "@/lib/feedback";

const DAY = 86_400_000;

function at(value: string | number | null | undefined): number {
  const t = new Date(value ?? 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** "Today", "Yesterday", "12 Aug" — compact enough for a card subtitle. */
function dayLabel(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

type RoomItem = {
  id: string;
  name: string;
  unit: string;
  available: number;
  received: number;
  converted: number;
  lastAt: number;
};

/**
 * The branch's Stock Room.
 *
 * Stock sent from the Central Store lands here automatically — there is nothing
 * to confirm. It is deliberately kept out of the shop's menu: the person in
 * charge taps an item to turn part of it into real menu stock, using the rate
 * the owner set once.
 */
export default function StockRoomScreen() {
  const router = useRouter();
  const { store } = useStore();
  const { stores, can, user } = useAuth();
  const { width, contentWidth, gutter } = useResponsive();
  const revision = useCentralRevision();

  const isCentral = !!store.isCentral;
  const canView = can("inventory:adjust");
  const pending = centralPendingCount(store.id);
  const syncError = centralLastError(store.id);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    if (isCentral || !canView) {
      setLoading(false);
      return;
    }
    setError(null);
    const ok = await refreshCentralAllocations(store.id, { toStoreId: store.id });
    await refreshCentralConversions(store.id);
    await refreshCentralConversionRates(store.id);
    if (!ok) {
      const hasCache = centralAllocations(store.id).some((a) => a.toStoreId === store.id);
      if (!hasCache) setError("No saved stock yet. Connect once to load it.");
    }
    setLoading(false);
  }, [canView, isCentral, store.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    setReload((n) => n + 1);
  }, [revision, store.id]);

  const onRefresh = useCallback(() => {
    feedbackTap();
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const items = useMemo<RoomItem[]>(() => {
    // Recompute on every local change: deliveries and conversions both move
    // this number, and the page must never show stale stock.
    void reload;
    const deliveries = centralAllocations(store.id).filter(
      (a) => a.toStoreId === store.id && a.status === "fulfilled",
    );
    const conversions = centralConversions(store.id).filter((c) => !c.failed);

    const map = new Map<string, RoomItem>();
    for (const a of deliveries) {
      const line =
        map.get(a.globalItemId) ??
        {
          id: a.globalItemId,
          name: a.itemName || "Stock",
          unit: a.itemUnit || a.receiveUnit || "",
          available: 0,
          received: 0,
          converted: 0,
          lastAt: 0,
        };
      line.received += a.quantity;
      line.available += a.quantity;
      line.lastAt = Math.max(line.lastAt, at(a.allocatedAt));
      map.set(a.globalItemId, line);
    }
    for (const c of conversions) {
      const line = map.get(c.globalItemId);
      if (!line) continue;
      line.converted += c.bulkQuantityUsed;
      line.available -= c.bulkQuantityUsed;
    }

    return [...map.values()]
      .filter((line) => line.received > 0)
      .sort((a, b) => b.available - a.available || a.name.localeCompare(b.name));
  }, [reload, store.id]);

  const totals = useMemo(() => {
    const lastAt = items.reduce((max, line) => Math.max(max, line.lastAt), 0);
    return { count: items.length, lastAt };
  }, [items]);

  const columns = width >= 960 ? 2 : 1;
  const gap = 10;
  const usable = Math.min(contentWidth, 1000) - gutter * 2;
  const cardWidth = columns === 1 ? usable : (usable - gap) / 2;

  const syncMessage =
    syncError ?? (pending > 0 ? `${pending} change${pending === 1 ? "" : "s"} waiting to sync` : null);

  const blocked = (icon: "crown-outline" | "lock-outline", title: string, text: string) => (
    <View style={styles.blocked}>
      <MaterialCommunityIcons name={icon} size={42} color={colors.grey400} />
      <Text style={styles.blockedTitle}>{title}</Text>
      <Text style={styles.blockedText}>{text}</Text>
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} style={styles.toolbarBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.toolbarTitle}>STOCK ROOM</Text>
        <Pressable
          onPress={() => {
            feedbackTap();
            void load();
          }}
          style={styles.toolbarBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Refresh stock room"
        >
          <Ionicons name="refresh" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {syncMessage ? (
        <View style={styles.syncBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color={colors.white} />
          <Text style={styles.syncBannerText} numberOfLines={2}>
            {syncMessage}
          </Text>
        </View>
      ) : null}

      {isCentral ? (
        blocked(
          "crown-outline",
          "The Central Store has no Stock Room",
          "Open a branch to see the stock it received.",
        )
      ) : !canView ? (
        blocked(
          "lock-outline",
          "Owners, managers and supervisors only",
          "Your role cannot view or convert stock.",
        )
      ) : loading && items.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 60 }} size="large" color={colors.primary} />
      ) : error && items.length === 0 ? (
        <View style={styles.blocked}>
          <Ionicons name="cloud-offline-outline" size={42} color={colors.grey400} />
          <Text style={styles.blockedTitle}>Could not load stock</Text>
          <Text style={styles.blockedText}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => void load()}>
            <Text style={styles.retryText}>TRY AGAIN</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingHorizontal: gutter, maxWidth: Math.min(contentWidth, 1000) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
            />
          }
        >
          <View style={styles.summary}>
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue}>{totals.count}</Text>
              <Text style={styles.summaryLabel}>items</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
                {dayLabel(totals.lastAt)}
              </Text>
              <Text style={styles.summaryLabel}>last delivery</Text>
            </View>
          </View>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MaterialCommunityIcons name="warehouse" size={30} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyText}>
                Stock sent from the Central Store appears here automatically.
              </Text>
            </View>
          ) : (
            <View style={[styles.grid, { gap }]}>
              {items.map((line) => (
                <Pressable
                  key={line.id}
                  style={({ pressed }) => [
                    styles.card,
                    { width: cardWidth },
                    pressed && styles.cardPressed,
                  ]}
                  onPress={() => {
                    feedbackTap();
                    router.push({
                      pathname: "/stock-room-convert",
                      params: {
                        globalItemId: line.id,
                        name: line.name,
                        unit: line.unit,
                        available: String(line.available),
                      },
                    } as never);
                  }}
                >
                  <View style={styles.cardTop}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {line.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.cardCopy}>
                      <Text style={styles.cardName} numberOfLines={1}>
                        {line.name}
                      </Text>
                      <Text style={styles.cardMeta} numberOfLines={1}>
                        {line.converted > 0
                          ? `${line.converted} ${line.unit} converted`
                          : `Received ${dayLabel(line.lastAt)}`}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.grey400} />
                  </View>

                  <View style={styles.cardBottom}>
                    <View>
                      <Text style={styles.cardQty} numberOfLines={1} adjustsFontSizeToFit>
                        {line.available}
                        <Text style={styles.cardUnit}> {line.unit}</Text>
                      </Text>
                      <Text style={styles.cardQtyLabel}>available</Text>
                    </View>
                    {line.available > 0 ? (
                      <View style={styles.convertPill}>
                        <MaterialCommunityIcons
                          name="swap-horizontal"
                          size={14}
                          color={colors.white}
                        />
                        <Text style={styles.convertPillText}>CONVERT</Text>
                      </View>
                    ) : (
                      <View style={styles.donePill}>
                        <Text style={styles.donePillText}>ALL USED</Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.grey50,
    height: 56,
    paddingHorizontal: 4,
    elevation: 2,
  },
  toolbarBtn: { width: 44, alignItems: "center" },
  toolbarTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: colors.primary,
    letterSpacing: 0.5,
  },
  syncBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.lowStock,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  syncBannerText: { flex: 1, color: colors.white, fontSize: 11, fontWeight: "700" },

  scroll: {
    width: "100%",
    alignSelf: "center",
    paddingTop: 10,
    paddingBottom: 28,
  },

  summary: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 12,
    elevation: 1,
  },
  summaryCell: { flex: 1, alignItems: "center", paddingHorizontal: 8 },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: colors.grey300,
  },
  summaryValue: { fontSize: 20, fontWeight: "800", color: colors.grey900 },
  summaryLabel: { fontSize: 11, color: colors.grey600, marginTop: 1 },

  grid: { flexDirection: "row", flexWrap: "wrap" },

  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    elevation: 1,
    borderWidth: 1,
    borderColor: "transparent",
  },
  cardPressed: { borderColor: colors.primary, opacity: 0.95 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.blue50,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primaryDark, fontSize: 16, fontWeight: "800" },
  cardCopy: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: "800", color: colors.grey900 },
  cardMeta: { fontSize: 11.5, color: colors.grey600, marginTop: 2 },

  cardBottom: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 14,
  },
  cardQty: { fontSize: 26, fontWeight: "800", color: colors.grey900 },
  cardUnit: { fontSize: 14, fontWeight: "700", color: colors.grey500 },
  cardQtyLabel: { fontSize: 11, color: colors.grey600, marginTop: -2 },

  convertPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  convertPillText: { color: colors.white, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.4 },
  donePill: {
    backgroundColor: colors.grey100,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  donePillText: { color: colors.grey500, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.4 },

  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 30, gap: 6 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.blue50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900 },
  emptyText: { fontSize: 13, color: colors.grey600, textAlign: "center", lineHeight: 19 },

  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  blockedTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 8 },
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
