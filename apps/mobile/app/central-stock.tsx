import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { SwipeTabs } from "@/components/SwipeTabs";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import { api, type CentralAllocation, type CentralItem } from "@/lib/api";
import {
  centralAllocations,
  centralItems,
  centralLastError,
  centralPendingCount,
  refreshCentralAllocations,
  refreshCentralItems,
  useCentralRevision,
} from "@/lib/central";
import { useAuth } from "@/lib/auth";
import { feedbackTap } from "@/lib/feedback";

const TABS = ["STOCK", "TRANSFERS"];

function statusTone(status: CentralAllocation["status"]): string {
  if (status === "fulfilled") return colors.dkGreen;
  if (status === "cancelled") return colors.grey500;
  return colors.lowStock;
}

function statusLabel(status: CentralAllocation["status"]): string {
  if (status === "fulfilled") return "RECEIVED";
  if (status === "cancelled") return "CANCELLED";
  return "IN TRANSIT";
}

/**
 * The central store's home. It owns the bulk stock and every transfer to a
 * branch. The source of a transfer is always this store, never another shop.
 */
export default function CentralStockScreen() {
  const router = useRouter();
  const { stores, refresh } = useAuth();
  const central = stores.find((s) => s.isCentral);
  const canManage = central
    ? central.role === "owner" || central.role === "manager"
    : stores.some((s) => s.role === "owner");
  const centralName = (central?.name ?? "Central Store").toUpperCase();

  const [items, setItems] = useState<CentralItem[]>([]);
  const [allocations, setAllocations] = useState<CentralAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const revision = useCentralRevision();

  const pending = central ? centralPendingCount(central.id) : 0;
  const syncError = central ? centralLastError(central.id) : null;

  const readLocal = useCallback(
    (centralId: string) => {
      setItems(centralItems(centralId));
      setAllocations(centralAllocations(centralId));
    },
    [],
  );

  const load = useCallback(async () => {
    setError(null);

    let centralId = central?.id;
    if (!centralId) {
      const ensured = await api.ensureCentralStore();
      if (!ensured.ok) {
        setError(ensured.error.message);
        setLoading(false);
        return;
      }
      centralId = ensured.data.id;
      await refresh();
    }

    const cachedItems = centralItems(centralId);
    const cachedAllocations = centralAllocations(centralId);
    readLocal(centralId);
    if (cachedItems.length > 0 || cachedAllocations.length > 0) setLoading(false);

    const [itemsOk, allocationsOk] = await Promise.all([
      refreshCentralItems(centralId),
      refreshCentralAllocations(centralId),
    ]);
    readLocal(centralId);

    if (!itemsOk && !allocationsOk && cachedItems.length === 0 && cachedAllocations.length === 0) {
      setError("No saved central stock yet. Connect once to load it.");
    }
    setLoading(false);
  }, [central?.id, readLocal, refresh]);

  useEffect(() => {
    if (central) readLocal(central.id);
  }, [central, readLocal, revision]);

  useFocusEffect(
    useCallback(() => {
      if (canManage) void load();
    }, [canManage, load]),
  );

  const syncMessage =
    syncError ?? (pending > 0 ? `${pending} central change${pending === 1 ? "" : "s"} waiting to sync` : null);

  if (!canManage) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <View style={styles.toolbar}>
          <Pressable onPress={() => router.back()} style={styles.toolbarBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color={colors.primary} />
          </Pressable>
          <Text style={styles.toolbarTitle}>{centralName}</Text>
        </View>
        <View style={styles.blocked}>
          <Ionicons name="lock-closed" size={44} color={colors.grey400} />
          <Text style={styles.blockedTitle}>Central store owners only</Text>
          <Text style={styles.blockedText}>
            Only the owner or manager of the central store can view this stock.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} style={styles.toolbarBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.toolbarTitle}>{centralName}</Text>
        <Pressable
          onPress={() => {
            feedbackTap();
            void load();
          }}
          style={styles.toolbarBtn}
          hitSlop={8}
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

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} size="large" color={colors.primary} />
      ) : error ? (
        <View style={styles.blocked}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.grey400} />
          <Text style={styles.blockedTitle}>Could not load central stock</Text>
          <Text style={styles.blockedText}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => void load()}>
            <Text style={styles.retryText}>TRY AGAIN</Text>
          </Pressable>
        </View>
      ) : (
        <SwipeTabs
          tabs={TABS}
          renderPage={(i) => {
            if (i === 0)
              return (
                <EntityListScreen
                  embedded
                  title="Central stock"
                  data={items}
                  keyExtractor={(item) => item.id}
                  searchOf={(item) => `${item.name} ${item.unit}`}
                  emptyText="No central stock yet"
                  addLabel="New Item"
                  onAdd={() => router.push("/central-item-editor" as never)}
                  renderRow={(item) => {
                    const low = item.totalStock <= item.minStock;
                    return (
                      <EntityRow
                        initial={item.name.charAt(0).toUpperCase()}
                        color={low ? colors.red500 : colors.dkGreen}
                        title={item.name}
                        subtitle={`${item.totalStock} ${item.unit} in stock | alert below ${item.minStock}`}
                        trailing={
                          <View style={styles.rowTrailing}>
                            {low ? (
                              <View style={styles.lowPill}>
                                <Text style={styles.lowPillText}>LOW</Text>
                              </View>
                            ) : null}
                            <Pressable
                              style={styles.sendBtn}
                              hitSlop={6}
                              accessibilityRole="button"
                              accessibilityLabel={`Transfer ${item.name} to a shop`}
                              onPress={(event) => {
                                event.stopPropagation();
                                feedbackTap();
                                router.push({
                                  pathname: "/send-to-store",
                                  params: { globalItemId: item.id },
                                } as never);
                              }}
                            >
                              <Ionicons name="arrow-forward-circle-outline" size={14} color={colors.white} />
                              <Text style={styles.sendText}>TRANSFER</Text>
                            </Pressable>
                          </View>
                        }
                        onPress={() => router.push({ pathname: "/central-item-editor", params: { id: item.id } } as never)}
                      />
                    );
                  }}
                />
              );

            return (
              <EntityListScreen
                embedded
                title="Transfers"
                data={allocations}
                keyExtractor={(a) => a.id}
                searchOf={(a) => `${a.itemName} ${a.toStoreName} ${a.status} ${a.allocatedByName ?? ""}`}
                emptyText="No transfers yet"
                addLabel="New transfer"
                onAdd={() => router.push("/send-to-store" as never)}
                renderRow={(a) => (
                  <EntityRow
                    initial={a.itemName.charAt(0).toUpperCase()}
                    color={statusTone(a.status)}
                    title={`${a.quantity} ${a.itemUnit} ${a.itemName}`}
                    subtitle={`To ${a.toStoreName} | ${statusLabel(a.status)} | by ${a.allocatedByName ?? "staff"} | ${formatDate(a.allocatedAt)}${a.syncError ? ` | ${a.syncError}` : ""}`}
                    trailing={
                      <View style={[styles.statusPill, { backgroundColor: statusTone(a.status) }]}>
                        <Text style={styles.statusPillText}>{statusLabel(a.status)}</Text>
                      </View>
                    }
                  />
                )}
              />
            );
          }}
          onIndexChange={() => feedbackTap()}
        />
      )}
    </SafeAreaView>
  );
}

function formatDate(at: string | number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
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
  toolbarTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.primary, letterSpacing: 0.5 },
  syncBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.lowStock,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  syncBannerText: { flex: 1, color: colors.white, fontSize: 11, fontWeight: "700" },
  lowPill: { backgroundColor: colors.red500, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  lowPillText: { color: colors.white, fontSize: 10, fontWeight: "800" },
  rowTrailing: { flexDirection: "row", alignItems: "center", gap: 8 },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: 3,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  sendText: { color: colors.white, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  statusPill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { color: colors.white, fontSize: 10, fontWeight: "800" },
  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  blockedTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 10 },
  blockedText: { fontSize: 13.5, color: colors.grey600, textAlign: "center", lineHeight: 20 },
  retry: { marginTop: 12, backgroundColor: colors.primary, borderRadius: 4, paddingHorizontal: 24, paddingVertical: 12 },
  retryText: { color: colors.white, fontWeight: "800", fontSize: 13, letterSpacing: 0.5 },
});
