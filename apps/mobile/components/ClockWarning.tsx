import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CLOCK_WARN_MS, clockOffsetMs, subscribeClock } from "@/lib/clock";

/** Nigeria (WAT) is UTC+1 all year. getTimezoneOffset() returns -60 there. */
const STORE_TZ_OFFSET_MIN = -60;

/**
 * One-line warning under the app bar when this till's date/time or time zone
 * is wrong. Sales are still dated correctly (lib/clock.ts corrects them), but
 * the device clock should be fixed so receipts print the right time.
 */
export function ClockWarning() {
  const [offset, setOffset] = useState(clockOffsetMs);
  useEffect(() => subscribeClock(() => setOffset(clockOffsetMs())), []);

  const wrongTime = Math.abs(offset) >= CLOCK_WARN_MS;
  const wrongZone = new Date().getTimezoneOffset() !== STORE_TZ_OFFSET_MIN;
  if (!wrongTime && !wrongZone) return null;

  const mins = Math.round(Math.abs(offset) / 60_000);
  const amount = mins >= 120 ? `${Math.round(mins / 60)} hours` : `${mins} min`;
  const message = wrongTime
    ? `This device's clock is ${amount} ${offset > 0 ? "behind" : "ahead"}. Fix it in Settings ▸ Date & time.`
    : "This device's time zone isn't Lagos (WAT). Set it in Settings ▸ Date & time.";

  return (
    <View style={styles.bar} accessibilityRole="alert">
      <Ionicons name="time-outline" size={14} color="#7A1F1F" />
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FDECEA",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  text: { flex: 1, color: "#7A1F1F", fontSize: 12, fontWeight: "600" },
});
