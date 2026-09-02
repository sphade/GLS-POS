import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { colors } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";

/**
 * Pick a single date.
 *
 * The two platforms disagree about what a date picker is: Android shows its own
 * modal dialog, iOS renders an inline calendar that needs a container and its
 * own confirm button. This wraps both so callers just get a date back.
 */
export function DatePickerSheet({
  visible,
  value,
  title,
  minimumDate,
  maximumDate,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  value: Date;
  title: string;
  minimumDate?: Date;
  maximumDate?: Date;
  onCancel: () => void;
  onConfirm: (date: Date) => void;
}) {
  /** iOS edits a copy until Done is pressed; Android confirms on selection. */
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  if (!visible) return null;

  if (Platform.OS !== "ios") {
    return (
      <DateTimePicker
        value={value}
        mode="date"
        display="calendar"
        minimumDate={minimumDate}
        maximumDate={maximumDate}
        onChange={(event: DateTimePickerEvent, date?: Date) => {
          if (event.type === "dismissed" || !date) {
            onCancel();
            return;
          }
          onConfirm(date);
        }}
      />
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.header}>
            <Pressable
              hitSlop={8}
              onPress={() => {
                feedbackTap();
                onCancel();
              }}
            >
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.title}>{title}</Text>
            <Pressable
              hitSlop={8}
              onPress={() => {
                feedbackTap();
                onConfirm(draft);
              }}
            >
              <Text style={styles.done}>Done</Text>
            </Pressable>
          </View>
          <DateTimePicker
            value={draft}
            mode="date"
            display="inline"
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onChange={(_event, date) => {
              if (date) setDraft(date);
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#00000066", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.grey300,
  },
  title: { fontSize: 15, fontWeight: "800", color: colors.grey900 },
  cancel: { fontSize: 15, fontWeight: "600", color: colors.grey600 },
  done: { fontSize: 15, fontWeight: "800", color: colors.primary },
});
