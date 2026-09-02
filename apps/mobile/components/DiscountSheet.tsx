import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, currencySymbol, formatMoney } from "@/constants/theme";
import {
  DISCOUNT_PRESETS_BPS,
  bpsToPercent,
  discountAmount,
  percentToBps,
  type Discount,
  type DiscountType,
} from "@/lib/discount-model";
import { feedbackError, feedbackTap } from "@/lib/feedback";

/**
 * Bottom sheet for giving a discount, used for both a single line and the whole
 * bill. It never lets the value exceed what's being discounted, so a till can't
 * produce a negative total, and it always shows the resulting amount in money so
 * the person applying it sees exactly what the customer saves.
 */
export function DiscountSheet({
  visible,
  title,
  subtitle,
  base,
  currency,
  current,
  onClose,
  onApply,
}: {
  visible: boolean;
  title: string;
  /** e.g. the item name, or "5 items". */
  subtitle?: string;
  /** The amount being discounted, in minor units. */
  base: number;
  currency: string;
  /** Existing discount, when editing one. */
  current?: Discount | null;
  onClose: () => void;
  /** Called with the new discount, or null to remove it. */
  onApply: (discount: Discount | null) => void;
}) {
  const [type, setType] = useState<DiscountType>(current?.type ?? "percent");
  const [text, setText] = useState("");
  const [reason, setReason] = useState(current?.reason ?? "");

  // Re-seed whenever the sheet opens, so it always reflects what's applied now
  // rather than whatever was typed the last time it was used.
  useEffect(() => {
    if (!visible) return;
    setType(current?.type ?? "percent");
    setReason(current?.reason ?? "");
    if (!current) {
      setText("");
      return;
    }
    setText(
      current.type === "percent"
        ? String(bpsToPercent(current.value))
        : String(current.value / 100),
    );
  }, [visible, current]);

  const parsed = Number.parseFloat(text.replace(",", ".")) || 0;
  const draft: Discount | null =
    parsed > 0
      ? {
          type,
          value: type === "percent" ? percentToBps(parsed) : Math.round(parsed * 100),
          reason: reason.trim() || undefined,
        }
      : null;

  const amount = discountAmount(draft, base);
  const remaining = Math.max(0, base - amount);
  /** Typed more than the bill is worth: allowed, but say so and cap it. */
  const capped =
    draft !== null &&
    (draft.type === "fixed" ? draft.value > base : percentToBps(parsed) > 10_000);

  const apply = () => {
    if (!draft) {
      feedbackError();
      return;
    }
    feedbackTap();
    onApply(draft);
    onClose();
  };

  const removeDiscount = () => {
    feedbackTap();
    onApply(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.appBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.appBarTitle}>{title}</Text>
              {subtitle ? <Text style={styles.appBarSub}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.white} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.typeRow}>
              <TypeTab
                label="Percent %"
                active={type === "percent"}
                onPress={() => {
                  feedbackTap();
                  setType("percent");
                  setText("");
                }}
              />
              <TypeTab
                label={`Amount ${currencySymbol(currency)}`}
                active={type === "fixed"}
                onPress={() => {
                  feedbackTap();
                  setType("fixed");
                  setText("");
                }}
              />
            </View>

            <View style={styles.inputRow}>
              <Text style={styles.inputPrefix}>
                {type === "percent" ? "%" : currencySymbol(currency)}
              </Text>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder="0"
                placeholderTextColor={colors.grey500}
                keyboardType="decimal-pad"
                autoFocus
              />
            </View>

            {type === "percent" && (
              <View style={styles.presetRow}>
                {DISCOUNT_PRESETS_BPS.map((bps) => (
                  <Pressable
                    key={bps}
                    style={styles.preset}
                    onPress={() => {
                      feedbackTap();
                      setText(String(bpsToPercent(bps)));
                    }}
                  >
                    <Text style={styles.presetText}>{bpsToPercent(bps)}%</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <View style={styles.previewCard}>
              <PreviewRow label="Before discount" value={formatMoney(base, currency)} />
              <PreviewRow
                label="Discount"
                value={`-${formatMoney(amount, currency)}`}
                emphasis="discount"
              />
              <View style={styles.previewDivider} />
              <PreviewRow label="After discount" value={formatMoney(remaining, currency)} bold />
            </View>

            {capped && (
              <Text style={styles.cappedNote}>
                Capped at {formatMoney(base, currency)} — a discount can't exceed the amount being
                discounted.
              </Text>
            )}

            <Text style={styles.label}>REASON (OPTIONAL)</Text>
            <TextInput
              style={styles.reasonInput}
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. staff meal, regular customer"
              placeholderTextColor={colors.grey500}
              maxLength={80}
            />
          </ScrollView>

          <View style={styles.footer}>
            {current ? (
              <Pressable style={styles.remove} onPress={removeDiscount}>
                <Text style={styles.removeText}>REMOVE</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.apply, !draft && styles.applyDisabled]}
              disabled={!draft}
              onPress={apply}
              android_ripple={{ color: "#FFFFFF22" }}
            >
              <Text style={styles.applyText}>
                {draft ? `APPLY -${formatMoney(amount, currency)}` : "ENTER A DISCOUNT"}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TypeTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.typeTab, active && styles.typeTabActive]} onPress={onPress}>
      <Text style={[styles.typeTabText, active && styles.typeTabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function PreviewRow({
  label,
  value,
  bold,
  emphasis,
}: {
  label: string;
  value: string;
  bold?: boolean;
  emphasis?: "discount";
}) {
  return (
    <View style={styles.previewRow}>
      <Text style={[styles.previewLabel, bold && styles.previewBoldLabel]}>{label}</Text>
      <Text
        style={[
          styles.previewValue,
          emphasis === "discount" && styles.previewDiscount,
          bold && styles.previewBoldValue,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#00000066", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.screenBg,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    maxHeight: "88%",
    overflow: "hidden",
  },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  appBarTitle: { color: colors.white, fontSize: 17, fontWeight: "800", letterSpacing: 0.3 },
  appBarSub: { color: "#FFFFFFCC", fontSize: 12, marginTop: 2 },

  body: { padding: 12, paddingBottom: 4 },
  typeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  typeTab: {
    flex: 1,
    height: 44,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.grey400,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  typeTabActive: { borderColor: colors.primary, backgroundColor: colors.blue50 },
  typeTabText: { fontSize: 14, fontWeight: "700", color: colors.grey700 },
  typeTabTextActive: { color: colors.primaryDark, fontWeight: "800" },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.grey300,
    paddingHorizontal: 14,
    height: 60,
    gap: 8,
  },
  inputPrefix: { fontSize: 22, fontWeight: "800", color: colors.grey600 },
  input: { flex: 1, fontSize: 26, fontWeight: "800", color: colors.grey900, padding: 0 },

  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  preset: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: colors.white,
  },
  presetText: { color: colors.primary, fontWeight: "800", fontSize: 13 },

  previewCard: {
    backgroundColor: colors.white,
    borderRadius: 6,
    padding: 12,
    marginTop: 14,
    elevation: 1,
  },
  previewRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, gap: 12 },
  previewLabel: { fontSize: 13, color: colors.grey600 },
  previewValue: { fontSize: 13, color: colors.grey800, fontWeight: "600" },
  previewDiscount: { color: colors.red500, fontWeight: "800" },
  previewBoldLabel: { fontSize: 15, fontWeight: "800", color: colors.grey900 },
  previewBoldValue: { fontSize: 17, fontWeight: "800", color: colors.primary },
  previewDivider: { height: 1, backgroundColor: colors.grey300, marginVertical: 6 },

  cappedNote: { marginTop: 8, fontSize: 12, color: colors.red800, fontWeight: "600", lineHeight: 17 },

  label: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.grey600,
    letterSpacing: 0.7,
    marginTop: 16,
    marginBottom: 6,
    marginLeft: 2,
  },
  reasonInput: {
    backgroundColor: colors.white,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.grey300,
    paddingHorizontal: 12,
    height: 46,
    fontSize: 14,
    color: colors.grey900,
  },

  footer: { flexDirection: "row", gap: 8, padding: 12, backgroundColor: colors.screenBg },
  remove: {
    height: 52,
    paddingHorizontal: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.red500,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  removeText: { color: colors.red500, fontWeight: "800", fontSize: 15, letterSpacing: 0.4 },
  apply: {
    flex: 1,
    height: 52,
    borderRadius: 6,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  applyDisabled: { backgroundColor: colors.grey400, elevation: 0 },
  applyText: { color: colors.white, fontWeight: "800", fontSize: 16, letterSpacing: 0.4 },
});
