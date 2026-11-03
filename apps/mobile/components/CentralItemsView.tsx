import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { PosHeader } from "@/components/PosHeader";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { syncNow } from "@/lib/sync";
import { feedbackTap } from "@/lib/feedback";
import { formatQty } from "@/lib/stock-units";

/**
 * The Central Store's Items tab: its own ingredients, held in its own Durable
 * Object and synced like any store's catalog. Tapping a row opens the shared
 * ingredient editor (stock, history, adjustments); SEND moves stock to a shop.
 */
export function CentralItemsView() {
  const router = useRouter();
  const { store } = useStore();
  const { can, stores } = useAuth();
  const { ingredients } = useCatalog();
  const canManage = can("inventory:adjust");
  const isOwner = stores.find((s) => s.id === store.id)?.role === "owner";
  const [importing, setImporting] = useState(false);

  // Owner-only, one-off: bring over stock saved by the old central system.
  const importLegacy = () =>
    Alert.alert(
      "Move old central stock?",
      "Copies the balances from the old central stock (and each shop's Stock Room) into the new system. Safe to run twice.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Move it",
          onPress: async () => {
            setImporting(true);
            const res = await api.importLegacyCentralStock(store.id);
            setImporting(false);
            if (!res.ok) {
              Alert.alert("Could not move stock", res.error?.message ?? "Try again when online.");
              return;
            }
            void syncNow(store.id);
            Alert.alert("Done", `${res.data.imported} item(s) moved.`);
          },
        },
      ],
    );

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <PosHeader />
      <EntityListScreen
        embedded
        title="Central stock"
        data={ingredients}
        keyExtractor={(i) => i.id}
        searchOf={(i) => i.name}
        emptyText="No central stock yet. Add rice, flour, oil… then send it to your shops."
        addLabel={canManage ? "New Item" : undefined}
        onAdd={canManage ? () => router.push("/ingredient-editor") : undefined}
        renderRow={(i) => {
          const low = i.lowAt > 0 && i.stock <= i.lowAt;
          return (
            <EntityRow
              initial={i.name.charAt(0).toUpperCase()}
              color={low ? colors.red500 : colors.dkGreen}
              title={i.name}
              subtitle={`${formatQty(i.stock, i.unit)} in stock${low ? " · LOW" : ""}`}
              trailing={
                canManage && i.stock > 0 ? (
                  <Pressable
                    style={styles.send}
                    hitSlop={6}
                    onPress={(e) => {
                      e.stopPropagation();
                      feedbackTap();
                      router.push({ pathname: "/send-to-store", params: { ingredientId: i.id } } as never);
                    }}
                  >
                    <Text style={styles.sendText}>SEND</Text>
                  </Pressable>
                ) : undefined
              }
              onPress={() => router.push({ pathname: "/ingredient-editor", params: { id: i.id } })}
            />
          );
        }}
      />
      {isOwner ? (
        <Pressable style={styles.legacy} disabled={importing} onPress={importLegacy}>
          <Text style={styles.legacyText}>
            {importing ? "Moving old stock…" : "Move stock from the old central system"}
          </Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  send: { backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  sendText: { color: colors.white, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  legacy: { alignItems: "center", paddingVertical: 10 },
  legacyText: { color: colors.grey600, fontSize: 12, textDecorationLine: "underline" },
});

