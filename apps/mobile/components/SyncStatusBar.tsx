import { useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { getSyncActivity, subscribeSyncActivity } from "@/lib/sync";

/**
 * Thin strip pinned to the top of the app, above every screen:
 *  - while any sync/pull is in flight: green "SYNCING…" with a spinner
 *  - after a failed full sync: red strip with the real reason (tap to dismiss;
 *    it also clears itself on the next successful sync)
 *
 * This makes background revalidation visible — staff can see the app is
 * pulling fresh data instead of wondering whether it happened.
 */
export function SyncStatusBar() {
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState(false);
  const [showBusy, setShowBusy] = useState(false);
  const activity = useSyncExternalStore(subscribeSyncActivity, getSyncActivity);

  // The engine fires many sub-second jobs (heartbeat pulls, tab-switch
  // deltas). Showing the bar for those reads as "perpetually syncing".
  // Only surface it when work persists past 700ms — i.e., real transfers.
  useEffect(() => {
    if (!activity.busy) {
      setShowBusy(false);
      return;
    }
    const t = setTimeout(() => setShowBusy(true), 700);
    return () => clearTimeout(t);
  }, [activity.busy]);

  // A new error re-shows the bar.
  useEffect(() => {
    setDismissed(false);
  }, [activity.error]);

  if (activity.busy && showBusy) {
    return (
      <View style={[styles.strip, styles.busy, { top: insets.top }]}>
        <ActivityIndicator size="small" color={colors.white} />
        <Text style={styles.text}>SYNCING…</Text>
      </View>
    );
  }

  if (!activity.error || dismissed) return null;

  return (
    <Pressable
      style={[styles.strip, styles.error, { top: insets.top }]}
      onPress={() => setDismissed(true)}
    >
      <Ionicons name="cloud-offline-outline" size={14} color={colors.white} />
      <Text style={[styles.text, { flexShrink: 1 }]} numberOfLines={1}>
        {activity.error.toUpperCase()}
      </Text>
      <Ionicons name="close" size={14} color={colors.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 26,
    paddingHorizontal: 12,
    zIndex: 900,
    elevation: 10,
  },
  busy: { backgroundColor: "#0E7A3C" },
  error: { backgroundColor: colors.red500 },
  text: { color: colors.white, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
});
