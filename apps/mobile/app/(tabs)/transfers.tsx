import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { PosHeader } from "@/components/PosHeader";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import type { CentralAllocation } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import {
  centralAllocations,
  centralLastError,
  centralPendingCount,
  refreshCentralAllocations,
  useCentralRevision,
} from "@/lib/central";

/**
 * A transfer leaves the centre and is received by the shop in the same request,
 * so there is no "confirm" step and nothing sits in transit: a row is either
 * queued on this device (SENT) or already on the shop's shelf (RECEIVED).
 */
function statusTone(status: CentralAllocation["status"]): string {
  if (status === "fulfilled") return colors.dkGreen;
  if (status === "cancelled") return colors.red500;
  return colors.lowStock;
}

function statusLabel(status: CentralAllocation["status"]): string {
  if (status === "fulfilled") return "RECEIVED";
  if (status === "cancelled") return "CANCELLED";
  return "SENT";
}

function formatDate(at: string | number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/** How much the receiving shop's stock rose, when it differs from what left. */
function receivedText(a: CentralAllocation): string {
  if (a.receiveQuantity == null || a.receiveQuantity === a.quantity) return "";
  return ` → ${a.receiveQuantity} ${a.receiveUnit ?? a.itemUnit}`;
}

/**
 * The Central Store's "Transfers" tab: every send this centre has made, newest
 * first, with a shortcut to send more. Branches never appear here — this list is
 * the centre's own outgoing ledger, so the old confusion where a shop's sends
 * showed up as central "incoming deliveries" cannot happen.
 */
export default function TransfersScreen() {
  const router = useRouter();
  const { store } = useStore();
  const { stores } = useAuth();
  const central = stores.find((s) => s.isCentral);
  const revision = useCentralRevision();

  const centralId = central?.id;
  const isCentralStore = !!store.isCentral && !!centralId;
  // Same gate as the Items tab: viewing and sending central stock is the
  // owner's or manager's job, not a cashier's.
  const canManage = central
    ? central.role === "owner" || central.role === "manager"
    : false;
  const pending = isCentralStore ? centralPendingCount(centralId!) : 0;
  const syncError = isCentralStore ? centralLastError(centralId!) : null;

  const [rows, setRows] = useState<CentralAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!centralId) return;
    setError(null);
    const cached = centralAllocations(centralId);
    setRows(cached);
    if (cached.length > 0) setLoading(false);

    const ok = await refreshCentralAllocations(centralId, { fromStoreId: centralId });
    setRows(centralAllocations(centralId));
    if (!ok && cached.length === 0) {
      setError("No saved transfers yet. Connect once to load them.");
    }
    setLoading(false);
  }, [centralId]);

  useEffect(() => {
    if (centralId) setRows(centralAllocations(centralId));
  }, [centralId, revision]);

  useEffect(() => {
    if (isCentralStore) void load();
    else setLoading(false);
  }, [isCentralStore, load]);

  if (!isCentralStore || !canManage) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <PosHeader />
        <View style={styles.blocked}>
          <MaterialCommunityIcons name="crown-outline" size={44} color={colors.grey400} />
          <Text style={styles.blockedTitle}>
            {canManage ? "Transfers live in the Central Store" : "Central store owners only"}
          </Text>
          <Text style={styles.blockedText}>
            {canManage
              ? "Switch to the Central Store from the shop picker to send stock to your shops."
              : "Only the owner or manager of the central store can send or view transfers."}
          </Text>
          <Pressable style={styles.retry} onPress={() => router.replace("/(tabs)" as never)}>
            <Text style={styles.retryText}>BACK TO ITEMS</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const syncMessage =
    syncError ?? (pending > 0 ? `${pending} transfer${pending === 1 ? "" : "s"} waiting to sync` : null);

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
          <Text style={styles.blockedTitle}>Could not load transfers</Text>
          <Text style={styles.blockedText}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => void load()}>
            <Text style={styles.retryText}>TRY AGAIN</Text>
          </Pressable>
        </View>
      ) : (
        <EntityListScreen
          embedded
          title="Transfers"
          data={rows}
          keyExtractor={(a) => a.id}
          searchOf={(a) => `${a.itemName} ${a.toStoreName} ${a.status} ${a.allocatedByName ?? ""}`}
          emptyText="Nothing sent yet. Tap Send to move stock from the centre to a shop."
          addLabel="Send"
          onAdd={() => router.push("/send-to-store" as never)}
          renderRow={(a) => (
            <EntityRow
              initial={a.itemName.charAt(0).toUpperCase()}
              color={statusTone(a.status)}
              title={`${a.quantity} ${a.itemUnit} ${a.itemName}${receivedText(a)}`}
              subtitle={`To ${a.toStoreName} | ${statusLabel(a.status)} | by ${a.allocatedByName ?? "staff"} | ${formatDate(a.allocatedAt)}${a.notes ? ` | ${a.notes}` : ""}${a.syncError ? ` | ${a.syncError}` : ""}`}
              trailing={
                <View style={[styles.statusPill, { backgroundColor: statusTone(a.status) }]}>
                  <Text style={styles.statusPillText}>{statusLabel(a.status)}</Text>
                </View>
              }
            />
          )}
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
  statusPill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { color: colors.white, fontSize: 10, fontWeight: "800" },
  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  blockedTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 10 },
  blockedText: { fontSize: 13.5, color: colors.grey600, textAlign: "center", lineHeight: 20 },
  retry: { marginTop: 12, backgroundColor: colors.primary, borderRadius: 4, paddingHorizontal: 24, paddingVertical: 12 },
  retryText: { color: colors.white, fontWeight: "800", fontSize: 13, letterSpacing: 0.5 },
});
