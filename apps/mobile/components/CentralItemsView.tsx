import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { PosHeader } from "@/components/PosHeader";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import type { CentralItem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  centralItems,
  centralLastError,
  centralPendingCount,
  refreshCentralItems,
  useCentralRevision,
} from "@/lib/central";
import { feedbackTap } from "@/lib/feedback";

/**
 * The Central Store's "Items" tab.
 *
 * This is the parent stock list: every item the owner has added to the centre,
 * live balance included, with a TRANSFER action per row because sending stock to
 * a shop is the only thing that ever happens to these items. The central store is
 * a shop you switch into, so its stock lives in the normal tab bar rather than a
 * parallel hub screen.
 */
export function CentralItemsView() {
  const router = useRouter();
  const { stores } = useAuth();
  const central = stores.find((s) => s.isCentral);
  const canManage = central
    ? central.role === "owner" || central.role === "manager"
    : false;

  const [items, setItems] = useState<CentralItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const revision = useCentralRevision();

  const centralId = central?.id;
  const pending = centralId ? centralPendingCount(centralId) : 0;
  const syncError = centralId ? centralLastError(centralId) : null;

  const load = useCallback(async () => {
    if (!centralId) return;
    setError(null);

    const cached = centralItems(centralId);
    setItems(cached);
    if (cached.length > 0) setLoading(false);

    const ok = await refreshCentralItems(centralId);
    setItems(centralItems(centralId));
    if (!ok && cached.length === 0) {
      setError("No saved central stock yet. Connect once to load it.");
    }
    setLoading(false);
  }, [centralId]);

  useEffect(() => {
    if (centralId) setItems(centralItems(centralId));
  }, [centralId, revision]);

  useEffect(() => {
    if (centralId && canManage) void load();
  }, [centralId, canManage, load]);

  if (!central || !canManage) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <PosHeader />
        <View style={styles.blocked}>
          <Ionicons name="lock-closed" size={44} color={colors.grey400} />
          <Text style={styles.blockedTitle}>Central store owners only</Text>
          <Text style={styles.blockedText}>
            Only the owner or manager of the central store can see its stock.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const syncMessage =
    syncError ?? (pending > 0 ? `${pending} central change${pending === 1 ? "" : "s"} waiting to sync` : null);

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <PosHeader />
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
        <EntityListScreen
          embedded
          title="Central items"
          data={items}
          keyExtractor={(item) => item.id}
          searchOf={(item) => `${item.name} ${item.unit}`}
          emptyText="No items yet. Add the first one, then transfer it to a shop."
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
                      style={styles.adjustBtn}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`Add or remove ${item.name} stock`}
                      onPress={(event) => {
                        event.stopPropagation();
                        feedbackTap();
                        router.push({
                          pathname: "/central-adjust-stock",
                          params: { id: item.id },
                        } as never);
                      }}
                    >
                      <Text style={styles.adjustBtnText}>±</Text>
                    </Pressable>
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
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
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
  adjustBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.white,
  },
  adjustBtnText: { color: colors.primary, fontSize: 17, fontWeight: "800", lineHeight: 20 },
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
  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  blockedTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 10 },
  blockedText: { fontSize: 13.5, color: colors.grey600, textAlign: "center", lineHeight: 20 },
  retry: { marginTop: 12, backgroundColor: colors.primary, borderRadius: 4, paddingHorizontal: 24, paddingVertical: 12 },
  retryText: { color: colors.white, fontWeight: "800", fontSize: 13, letterSpacing: 0.5 },
});
