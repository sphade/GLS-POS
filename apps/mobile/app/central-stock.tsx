import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { SwipeTabs } from "@/components/SwipeTabs";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import { api, type CentralAllocation, type CentralItem } from "@/lib/api";
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!central) {
      const ensured = await api.ensureCentralStore();
      if (!ensured.ok) {
        setError(ensured.error.message);
        setLoading(false);
        return;
      }
      await refresh();
    }

    const [itemsRes, allocRes] = await Promise.all([api.listCentralItems(), api.listAllocations()]);
    if (!itemsRes.ok) {
      setError(itemsRes.error.message);
      setLoading(false);
      return;
    }
    setItems(itemsRes.data);
    // A failed allocation list shouldn't hide the stock itself; the SENT tab
    // shows its own message when empty.
    setAllocations(allocRes.ok ? allocRes.data : []);
    if (!allocRes.ok) setError((prev) => prev ?? null);
    setLoading(false);
  }, [central, refresh]);

  useFocusEffect(
    useCallback(() => {
      if (canManage) void load();
    }, [canManage, load]),
  );

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
                    subtitle={`To ${a.toStoreName} | ${statusLabel(a.status)} | by ${a.allocatedByName ?? "staff"} | ${formatDate(a.allocatedAt)}`}
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
