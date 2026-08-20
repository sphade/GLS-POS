import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { pullNow, syncNow } from "@/lib/sync";
import { feedbackError, feedbackTap } from "@/lib/feedback";

/**
 * One refresh control for the entire signed-in app.
 *
 * It sits above the tab bar and modal screens, so staff can force a pull from
 * any route without hunting for a screen-specific refresh gesture. Successful
 * sync emits the normal `onSynced` event, causing catalog, orders, receipts and
 * other local providers to reload from SQLite.
 */
export function GlobalRefreshButton() {
  const { signedIn, refresh: refreshAccount } = useAuth();
  const { store } = useStore();
  const [busy, setBusy] = useState(false);

  if (!signedIn || store.id === "store_unknown" || store.id === "bootstrap") return null;

  const run = async () => {
    if (busy) return;
    feedbackTap();
    setBusy(true);
    try {
      // Pull first so incoming orders are never blocked by an unrelated dirty
      // local record; then run the normal bidirectional sync.
      const pulled = await pullNow(store.id);
      const pushed = await syncNow(store.id);
      await refreshAccount();
      if (pulled < 0 && pushed < 0) {
        feedbackError();
        Alert.alert("Could not refresh", "Check your internet connection and sign-in, then try again.");
      }
    } catch {
      feedbackError();
      Alert.alert("Could not refresh", "Check your internet connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return <Pressable accessibilityRole="button" accessibilityLabel="Refresh app data" style={({ pressed }) => [styles.button, pressed && { opacity: .8 }]} onPress={() => void run()} disabled={busy}>
    {busy ? <ActivityIndicator size="small" color={colors.white} /> : <Ionicons name="refresh" size={24} color={colors.white} />}
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { position: "absolute", right: 14, bottom: 82, zIndex: 800, width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", elevation: 8, shadowColor: "#000", shadowOpacity: .25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
});