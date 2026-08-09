import { type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";

/** Toolbar used by every editor: âœ• Â· TITLE Â· optional actions Â· SAVE. */
export function EditorToolbar({
  title,
  dirty,
  onClose,
  onSave,
  onDelete,
  onFavourite,
}: {
  title: string;
  dirty?: boolean;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onFavourite?: () => void;
}) {
  return (
    <View style={styles.toolbar}>
      <Pressable onPress={onClose} style={styles.toolbarBtn} hitSlop={8}>
        <Ionicons name="close" size={26} color={colors.primary} />
      </Pressable>
      <Text style={styles.toolbarTitle} numberOfLines={1}>
        {title.toUpperCase()}
      </Text>
      {onDelete && (
        <Pressable onPress={onDelete} style={styles.deleteBtn}>
          <Text style={styles.deleteText}>DELETE</Text>
        </Pressable>
      )}
      {onFavourite && (
        <Pressable onPress={onFavourite} style={styles.toolbarBtn} hitSlop={8}>
          <Ionicons name="heart-outline" size={24} color={colors.green} />
        </Pressable>
      )}
      <Pressable style={[styles.saveBtn, !dirty && { opacity: 0.45 }]} disabled={!dirty} onPress={onSave}>
        <Text style={styles.saveText}>SAVE</Text>
      </Pressable>
    </View>
  );
}

/** Labelled text field in a white card, with the validity tick. */
export function FieldCard({
  label,
  hint,
  value,
  onChangeText,
  keyboardType,
  valid,
  showTick = true,
}: {
  label: string;
  hint: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: "numeric" | "default" | "phone-pad" | "email-address";
  valid?: boolean;
  showTick?: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.fieldRow}>
        {showTick && (
          <Ionicons name="checkmark-circle" size={22} color={valid ? colors.primary : colors.grey400} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput
            style={styles.fieldInput}
            value={value}
            onChangeText={onChangeText}
            placeholder={hint}
            placeholderTextColor={colors.hint}
            keyboardType={keyboardType ?? "default"}
          />
        </View>
      </View>
    </View>
  );
}

/** Card that opens a picker â€” shows the chosen value with a caret. */
export function PickerCard({
  label,
  value,
  hint,
  valid,
  swatch,
  onPress,
}: {
  label: string;
  value?: string;
  hint: string;
  valid?: boolean;
  swatch?: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.card} onPress={onPress} android_ripple={{ color: "#00000010" }}>
      <View style={styles.fieldRow}>
        <Ionicons name="checkmark-circle" size={22} color={valid ? colors.primary : colors.grey400} />
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <View style={styles.pickerValueRow}>
            {swatch && <View style={[styles.swatch, { backgroundColor: swatch }]} />}
            <Text style={[styles.fieldValue, !value && { color: colors.hint }]}>{value ?? hint}</Text>
          </View>
        </View>
        <Ionicons name="chevron-down" size={22} color={colors.primary} />
      </View>
    </Pressable>
  );
}

/** Label + switch row. */
export function ToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={(v) => {
          feedbackTap();
          onValueChange(v);
        }}
        trackColor={{ true: colors.primary + "88", false: colors.grey400 }}
        thumbColor={value ? colors.primary : colors.grey100}
      />
    </View>
  );
}

/** Collapsible feature card: icon Â· label Â· help Â· switch, body when enabled. */
export function FeatureCard({
  icon,
  imageIcon,
  label,
  on,
  onToggle,
  children,
}: {
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  imageIcon?: number;
  label: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.featureHeader}>
        {imageIcon ? (
          <Image source={imageIcon} style={styles.featureIcon} resizeMode="contain" />
        ) : icon ? (
          <MaterialCommunityIcons name={icon} size={24} color={colors.primary} />
        ) : null}
        <Text style={styles.featureLabel}>{label}</Text>
        <Ionicons name="help-circle-outline" size={18} color={colors.grey500} />
        <Switch
          value={on}
          onValueChange={(v) => {
            feedbackTap();
            onToggle(v);
          }}
          trackColor={{ true: colors.primary + "88", false: colors.grey400 }}
          thumbColor={on ? colors.primary : colors.grey100}
        />
      </View>
      {on && <View style={styles.featureBody}>{children}</View>}
    </View>
  );
}

/** Segmented two-way control (Simple/Advance, Expense/Incomeâ€¦). */
export function Segmented({
  left,
  right,
  value,
  onChange,
}: {
  left: string;
  right: string;
  value: "left" | "right";
  onChange: (s: "left" | "right") => void;
}) {
  return (
    <View style={styles.segmented}>
      <Pressable
        style={[styles.segHalf, value === "left" && styles.segActive]}
        onPress={() => {
          feedbackTap();
          onChange("left");
        }}
      >
        <Text style={[styles.segText, value === "left" && styles.segTextActive]}>{left}</Text>
      </Pressable>
      <Pressable
        style={[styles.segHalf, value === "right" && styles.segActive]}
        onPress={() => {
          feedbackTap();
          onChange("right");
        }}
      >
        <Text style={[styles.segText, value === "right" && styles.segTextActive]}>{right}</Text>
      </Pressable>
    </View>
  );
}

export const formStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenBg },
  body: { padding: 8, paddingBottom: 40 },
});

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.grey100,
    paddingVertical: 8,
    paddingRight: 8,
    gap: 4,
    elevation: 4,
  },
  toolbarBtn: { width: 44, alignItems: "center" },
  toolbarTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.primary, letterSpacing: 0.5 },
  deleteBtn: { borderWidth: 1, borderColor: colors.red500, borderRadius: 3, paddingHorizontal: 12, paddingVertical: 8 },
  deleteText: { color: colors.red500, fontWeight: "700", fontSize: 13 },
  saveBtn: { backgroundColor: colors.green, borderRadius: 3, paddingHorizontal: 20, paddingVertical: 10 },
  saveText: { color: colors.white, fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },

  card: { backgroundColor: colors.card, borderRadius: 4, padding: 12, marginBottom: 8, elevation: 1 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.grey600 },
  fieldInput: { fontSize: 16, fontWeight: "700", color: colors.grey800, padding: 0, marginTop: 2 },
  fieldValue: { fontSize: 16, fontWeight: "700", color: colors.grey800, marginTop: 2 },
  pickerValueRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  swatch: { width: 16, height: 16, borderRadius: 8, marginTop: 2 },

  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  toggleLabel: { flex: 1, fontSize: 14, color: colors.grey700 },

  featureHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureIcon: { width: 26, height: 26 },
  featureLabel: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.grey800 },
  featureBody: { marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.grey300, paddingTop: 6 },

  segmented: { flexDirection: "row", backgroundColor: colors.card, borderRadius: 4, overflow: "hidden", marginBottom: 8, elevation: 2 },
  segHalf: { flex: 1, paddingVertical: 12, alignItems: "center" },
  segActive: { backgroundColor: colors.primary },
  segText: { fontSize: 16, fontWeight: "700", color: colors.primary },
  segTextActive: { color: colors.white },
});

