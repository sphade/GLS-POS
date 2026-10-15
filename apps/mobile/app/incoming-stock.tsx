import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import { api, type CentralAllocation } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { feedbackTap } from "@/lib/feedback";

function statusTone(status: CentralAllocation["status"]): string {
  if (status === "fulfilled") return colors.dkGreen;
  if (status === "cancelled") return colors.grey500;
  return colors.red500;
}

function formatDate(at: string | number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * Incoming-stock view for one branch: every central delivery sent here, with
 * confirm-on-arrival for owners/managers. Confirming raises this store's own
 * stock (synced to every till) and lowers central stock.
 */
export default function IncomingStockScreen() {
  const router = useRouter();
  const { store } = useStore();
  const { stores, activeStore } = useAuth();

  // Role in THIS store (the switcher may lag the auth snapshot by a frame).
  const membership = stores.find((s) => s.id === store.id) ?? activeStore;
  const myRole = membership && membership.id === store.id ? membership.role : null;
  const canConfirm = myRole === "owner" || myRole === "manager";

  const [rows, setRows] = useState<CentralAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.listAllocations({ toStoreId: store.id });
    if (res.ok) setRows(res.data);
    else setError(res.error.message);
    setLoading(false);
  }, [store.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const confirm = (allocation: CentralAllocation) => {
    if (!canConfirm || acting) return;
    Alert.alert(
      "Confirm receipt?",
      `${allocation.quantity} ${allocation.itemUnit} ${allocation.itemName} from ${allocation.fromStoreName} will be added to this store's stock.`,
      [
        { text: "Not yet", style: "cancel" },
        {
          text: "CONFIRM",
          onPress: () => {
            setActing(allocation.id);
            void (async () => {
              const res = await api.fulfillAllocation(allocation.id);
              setActing(null);
              if (!res.ok) {
                Alert.alert("Could not confirm", res.error.message);
                return;
              }
              feedbackTap();
              void load();
            })();
          },
        },
      ],
    );
  };

  const cancel = (allocation: CentralAllocation) => {
    if (!canConfirm || acting) return;
    Alert.alert("Cancel this delivery?", "The centre keeps the stock. This can't be undone.", [
      { text: "Keep", style: "cancel" },
      {
        text: "Cancel delivery",
        style: "destructive",
        onPress: () => {
          setActing(allocation.id);
          void (async () => {
            const res = await api.cancelAllocation(allocation.id);
            setActing(null);
            if (!res.ok) {
              Alert.alert("Could not cancel", res.error.message);
              return;
            }
            feedbackTap();
            void load();
          })();
        },
      },
    ]);
  };

  const openActions = (allocation: CentralAllocation) => {
    if (allocation.status !== "pending" || !canConfirm) return;
    feedbackTap();
    Alert.alert(
      `${allocation.quantity} ${allocation.itemUnit} ${allocation.itemName}`,
      `From ${allocation.fromStoreName} · sent by ${allocation.allocatedByName ?? "staff"} · ${formatDate(allocation.allocatedAt)}${allocation.notes ? `\n${allocation.notes}` : ""}`,
      [
        { text: "Close", style: "cancel" },
        { text: "Cancel", style: "destructive", onPress: () => cancel(allocation) },
        { text: "CONFIRM", onPress: () => confirm(allocation) },
      ],
    );
  };

  const body = () => {
    if (loading) return <ActivityIndicator style={{ marginTop: 60 }} size="large" color={colors.primary} />;
    if (error) {
      return (
        <View style={styles.blocked}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.grey400} />
          <Text style={styles.blockedTitle}>Could not load deliveries</Text>
          <Text style={styles.blockedText}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => void load()}>
            <Text style={styles.retryText}>TRY AGAIN</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <EntityListScreen
        embedded
        title="Incoming stock"
        data={rows}
        keyExtractor={(a) => a.id}
        searchOf={(a) => `${a.itemName} ${a.fromStoreName} ${a.status} ${a.allocatedByName ?? ""}`}
        emptyText="No deliveries yet"
        renderRow={(a) => {
          const pending = a.status === "pending";
          return (
            <EntityRow
              initial={a.itemName.charAt(0).toUpperCase()}
              color={statusTone(a.status)}
              title={`${a.quantity} ${a.itemUnit} ${a.itemName}`}
              subtitle={`From ${a.fromStoreName} · by ${a.allocatedByName ?? "staff"} · ${formatDate(a.allocatedAt)}${a.status === "fulfilled" ? ` · confirmed by ${a.fulfilledByName ?? "staff"}` : ""}`}
              trailing={
                pending && canConfirm ? (
                  <Pressable
                    style={[styles.confirm, acting === a.id && { opacity: 0.5 }]}
                    disabled={acting === a.id}
                    onPress={(e) => {
                      e.stopPropagation();
                      feedbackTap();
                      confirm(a);
                    }}
                  >
                    <Text style={styles.confirmText}>{acting === a.id ? "…" : "CONFIRM"}</Text>
                  </Pressable>
                ) : (
                  <View style={[styles.statusPill, { backgroundColor: statusTone(a.status) }]}>
                    <Text style={styles.statusPillText}>{a.status.toUpperCase()}</Text>
                  </View>
                )
              }
              onPress={() => openActions(a)}
            />
          );
        }}
      />
    );
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} style={styles.toolbarBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.toolbarTitle}>INCOMING STOCK</Text>
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
      <View style={{ flex: 1 }}>{body()}</View>
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
  toolbarTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.primary, letterSpacing: 0.5 },
  confirm: { backgroundColor: colors.dkGreen, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  confirmText: { color: colors.white, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  statusPill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { color: colors.white, fontSize: 10, fontWeight: "800" },
  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  blockedTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 10 },
  blockedText: { fontSize: 13.5, color: colors.grey600, textAlign: "center", lineHeight: 20 },
  retry: { marginTop: 12, backgroundColor: colors.primary, borderRadius: 4, paddingHorizontal: 24, paddingVertical: 12 },
  retryText: { color: colors.white, fontWeight: "800", fontSize: 13, letterSpacing: 0.5 },
});
