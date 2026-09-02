import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { getSyncActivity, subscribeSyncActivity } from "@/lib/sync";

/**
 * Thin strip pinned to the top of the app, above every screen:
 *  - the first real sync after opening the store: green "SYNCING…" with a
 *    spinner, so the initial catch-up is visible
 *  - after a failed full sync: red strip with the real reason (tap to dismiss;
 *    it also clears itself on the next successful sync)
 *
 * Only that first catch-up is announced. Once staff have seen the app fetch its
 * data, every later sync runs silently in the background — a strip that keeps
 * reappearing all shift reads as something being wrong when nothing is.
 * Failures are still surfaced, because a till that isn't uploading receipts is
 * something staff need to know about.
 */
export function SyncStatusBar() {
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState(false);
  const [showBusy, setShowBusy] = useState(false);
  const activity = useSyncExternalStore(subscribeSyncActivity, getSyncActivity);
  /** Set once the strip has actually been shown, which retires it for good. */
  const announced = useRef(false);

  // The engine fires many sub-second jobs (heartbeat pulls, tab-switch deltas).
  // Showing the bar for those reads as "perpetually syncing", so it only
  // surfaces when work persists past 1.5s — and only the first time. Quick syncs
  // clear the timer before it fires, so they never use up that one appearance.
  useEffect(() => {
    if (!activity.busy) {
      setShowBusy(false);
      return;
    }
    if (announced.current) return;
    const t = setTimeout(() => {
      announced.current = true;
      setShowBusy(true);
    }, 1500);
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
