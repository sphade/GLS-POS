import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { StockTransfer } from "@gls-pos/types";
import { colors } from "@/constants/theme";
import { PosHeader } from "@/components/PosHeader";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { loadAll, onLocalWrite } from "@/lib/db";
import { onSynced } from "@/lib/sync";
import { formatQty } from "@/lib/stock-units";

function formatDate(at: number): string {
  const d = new Date(at);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/** Every transfer this store sent (Central) or received (branch), newest first. */
function useTransfers(storeId: string): StockTransfer[] {
  const read = () =>
    loadAll<StockTransfer>("stock_transfers").sort((a, b) => b.sentAt - a.sentAt);
  const [rows, setRows] = useState<StockTransfer[]>(read);
  useEffect(() => {
    setRows(read());
    const offSync = onSynced(({ pulledIds }) => {
      if ((pulledIds.get("stock_transfers") ?? []).length) setRows(read());
    });
    const offWrite = onLocalWrite(() => setRows(read()));
    return () => {
      offSync();
      offWrite();
    };
  }, [storeId]);
  return rows;
}

/**
 * Transfers tab. The Central Store sees what it sent and can send more; a
 * branch sees what it received. Rows are written by the server and arrive by
 * normal sync, so the list works offline once loaded.
 *
 * "Sending" means the centre has deducted the stock and the branch has not
 * acknowledged it yet (usually a second or two; longer if the branch's server
 * copy was briefly unreachable, in which case the centre retries on its own).
 */
export default function TransfersScreen() {
  const router = useRouter();
  const { store } = useStore();
  const { can } = useAuth();
  const rows = useTransfers(store.id);
  const canSend = store.isCentral && can("inventory:adjust");

  if (!can("inventory:adjust")) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <PosHeader />
        <View style={styles.blocked}>
          <MaterialCommunityIcons name="lock-outline" size={44} color={colors.grey400} />
          <Text style={styles.blockedTitle}>Managers only</Text>
          <Text style={styles.blockedText}>Ask an owner or manager to view stock transfers.</Text>
          <Pressable style={styles.retry} onPress={() => router.replace("/(tabs)" as never)}>
            <Text style={styles.retryText}>BACK TO ITEMS</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <PosHeader />
      <EntityListScreen
        embedded
        title={store.isCentral ? "Sent to shops" : "Received from the Central Store"}
        data={rows}
        keyExtractor={(t) => t.id}
        searchOf={(t) => `${t.ingredientName} ${t.toStoreName} ${t.fromStoreName} ${t.actorName}`}
        emptyText={
          store.isCentral
            ? "Nothing sent yet. Tap Send to move stock to a shop."
            : "No deliveries from the Central Store yet."
        }
        addLabel={canSend ? "Send" : undefined}
        onAdd={canSend ? () => router.push("/send-to-store" as never) : undefined}
        renderRow={(t) => {
          const received = t.status === "received";
          const tone = received ? colors.dkGreen : colors.lowStock;
          const other = t.direction === "out" ? `To ${t.toStoreName}` : `From ${t.fromStoreName}`;
          return (
            <EntityRow
              initial={t.ingredientName.charAt(0).toUpperCase()}
              color={tone}
              title={`${formatQty(t.quantity, t.unit)} ${t.ingredientName}`}
              subtitle={`${other} · ${t.actorName} · ${formatDate(t.sentAt)}${t.note ? ` · ${t.note}` : ""}`}
              trailing={
                <View style={[styles.statusPill, { backgroundColor: tone }]}>
                  <Text style={styles.statusPillText}>{received ? "RECEIVED" : "SENDING"}</Text>
                </View>
              }
              onPress={() =>
                router.push({ pathname: "/ingredient-editor", params: { id: t.ingredientId } } as never)
              }
            />
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  statusPill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { color: colors.white, fontSize: 10, fontWeight: "800" },
  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  blockedTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 10 },
  blockedText: { fontSize: 13.5, color: colors.grey600, textAlign: "center", lineHeight: 20 },
  retry: { marginTop: 12, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  retryText: { color: colors.white, fontWeight: "800", fontSize: 13, letterSpacing: 0.5 },
});
