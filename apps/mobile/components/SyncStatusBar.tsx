import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { getSyncActivity, subscribeSyncActivity, syncNowDetailed } from "@/lib/sync";

/**
 * Thin strip under the app header, on every screen that has one:
 *  - the first real sync after opening the store: green "SYNCING…" with a
 *    spinner, so the initial catch-up is visible
 *  - after a failed full sync: red strip with the real reason (tap to dismiss;
 *    it also clears itself on the next successful sync)
 *  - while local work is still waiting to upload: amber "N CHANGES NOT SENT",
 *    tappable to flush now
 *
 * That last one is the important one. A manager can add stock, see the new
 * number on his own phone, and have no way to learn that the other tills do not
 * have it yet. Showing the queue turns an invisible failure into something the
 * person holding the phone can act on — connect, wait, or stop assuming it
 * replicated.
 *
 * It sits in normal flow rather than floating over the header: an overlay would
 * cover the store name and hamburger, and the header is already busy enough.
 *
 * The first catch-up is announced once. Later syncs stay silent: a strip that
 * kept reappearing all shift reads as something being wrong when nothing is.
 */
export function SyncStatusBar() {
  const [dismissed, setDismissed] = useState(false);
  const [showBusy, setShowBusy] = useState(false);
  const activity = useSyncExternalStore(subscribeSyncActivity, getSyncActivity);
  /** Set once the strip has actually been shown, which retires it for good. */
  const announced = useRef(false);
  /** Re-render once a minute so "last sync" ages on screen. */
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

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

  // A first download can take minutes on a real store. It stays visible for the
  // whole replay and reports progress, because "SYNCING…" alone looks stuck.
  // It is shown even between pages: the engine goes idle for 250ms after each
  // one, and a strip that vanished and reappeared every page read as a glitch.
  const progress = activity.replayProgress;
  const catchingUp = progress !== null;

  if (catchingUp || (activity.busy && showBusy)) {
    return (
      <View style={[styles.strip, styles.busy]}>
        <ActivityIndicator size="small" color={colors.white} />
        <Text style={styles.text}>
          {catchingUp ? `CATCHING UP ${Math.round((progress ?? 0) * 100)}%` : "SYNCING…"}
        </Text>
      </View>
    );
  }

  if (activity.error && !dismissed) {
    return (
      <View style={[styles.strip, styles.error]}>
        <Pressable
          style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, justifyContent: "center" }}
          onPress={() => {
            if (activity.storeId) void syncNowDetailed(activity.storeId);
          }}
        >
          <Ionicons name="cloud-offline-outline" size={14} color={colors.white} />
          <Text style={[styles.text, { flexShrink: 1 }]} numberOfLines={1}>
            {activity.error.toUpperCase()} · TAP TO RETRY
          </Text>
        </Pressable>
        <Pressable onPress={() => setDismissed(true)} hitSlop={8}>
          <Ionicons name="close" size={14} color={colors.white} />
        </Pressable>
      </View>
    );
  }

  if (activity.pending > 0) {
    const count = activity.pending;
    const age = activity.lastSyncedAt !== null ? Date.now() - activity.lastSyncedAt : null;
    return (
      <Pressable
        style={[styles.strip, styles.pending]}
        onPress={() => {
          if (activity.storeId) void syncNowDetailed(activity.storeId);
        }}
      >
        <Ionicons name="cloud-upload-outline" size={14} color={colors.white} />
        <Text style={styles.text} numberOfLines={1}>
          {count} CHANGE{count === 1 ? "" : "S"} NOT SENT
          {age !== null && age >= 60_000 ? ` · LAST SYNC ${formatAge(age)}` : ""}
        </Text>
      </Pressable>
    );
  }

  return null;
}

/** Compact age for the strip: "4m", "2h", "3d". */
function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 26,
    paddingHorizontal: 12,
  },
  busy: { backgroundColor: "#0E7A3C" },
  error: { backgroundColor: colors.red500 },
  // Dark amber keeps white text readable; the brand yellow does not.
  pending: { backgroundColor: "#B45309" },
  text: { color: colors.white, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
});
