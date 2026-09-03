import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";
import { DatePickerSheet } from "@/components/DatePickerSheet";

const DAY = 86_400_000;

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const dayLabel = (ms: number) => {
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${day} ${month} ${d.getFullYear()}`;
};

/**
 * Pick a start and an end date.
 *
 * Both ends stay on screen the entire time, which is the whole point. An earlier
 * version asked for them as two bare calendars back to back, and on Android —
 * where the OS dialog leaves no room for a caller's title — the second one was
 * indistinguishable from the first simply reopening. Here the sheet is the
 * source of truth: you always see which field you're setting and what the other
 * one already holds, on both platforms, with no hidden step.
 *
 * Both dates are inclusive start-of-day. The caller decides how to bound its
 * query from them.
 */
export function DateRangeSheet({
  visible,
  initialFrom,
  initialTo,
  maximumDate,
  onCancel,
  onApply,
}: {
  visible: boolean;
  initialFrom: number;
  initialTo: number;
  maximumDate?: Date;
  onCancel: () => void;
  onApply: (from: number, to: number) => void;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  /** Which field's calendar is open, if any. */
  const [field, setField] = useState<"from" | "to" | null>(null);

  useEffect(() => {
    if (visible) {
      setFrom(initialFrom);
      setTo(initialTo);
      setField(null);
    }
  }, [visible, initialFrom, initialTo]);

  if (!visible) return null;

  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const spanDays = Math.round((hi - lo) / DAY) + 1;

  const Row = ({ label, value, which }: { label: string; value: number; which: "from" | "to" }) => (
    <Pressable
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${dayLabel(value)}. Tap to change.`}
      onPress={() => {
        feedbackTap();
        setField(which);
      }}
      android_ripple={{ color: "#00000010" }}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{dayLabel(value)}</Text>
      <MaterialCommunityIcons name="calendar-edit" size={19} color={colors.primary} />
    </Pressable>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title}>DATE RANGE</Text>

          <Row label="From" value={from} which="from" />
          <View style={styles.divider} />
          <Row label="To" value={to} which="to" />

          <Text style={styles.span}>
            {spanDays === 1 ? "1 day" : `${spanDays} days`}
          </Text>

          <View style={styles.actions}>
            <Pressable
              style={styles.cancelBtn}
              onPress={() => {
                feedbackTap();
                onCancel();
              }}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.applyBtn}
              onPress={() => {
                feedbackTap();
                onApply(lo, hi);
              }}
            >
              <Text style={styles.applyText}>Apply</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>

      <DatePickerSheet
        visible={field !== null}
        title={field === "from" ? "Start date" : "End date"}
        value={new Date(field === "to" ? to : from)}
        maximumDate={maximumDate}
        // Only the end is constrained. Moving the start past the end is handled
        // below by dragging the end along, which is less annoying than refusing
        // the tap.
        minimumDate={field === "to" ? new Date(from) : undefined}
        onCancel={() => setField(null)}
        onConfirm={(date) => {
          const day = startOfDay(date.getTime());
          if (field === "from") {
            setFrom(day);
            if (day > to) setTo(day);
          } else {
            setTo(day);
          }
          setField(null);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#00000066", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingTop: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.grey600,
    letterSpacing: 0.8,
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 15,
  },
  rowLabel: { width: 48, fontSize: 14, fontWeight: "700", color: colors.grey600 },
  rowValue: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.grey900 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.grey300,
    marginLeft: 18,
  },
  span: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.grey500,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  actions: { flexDirection: "row", gap: 12, paddingHorizontal: 18, paddingTop: 18 },
  cancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey400,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontSize: 15, fontWeight: "700", color: colors.grey700 },
  applyBtn: {
    flex: 1,
    height: 46,
    borderRadius: 6,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  applyText: { fontSize: 15, fontWeight: "800", color: colors.white },
});
