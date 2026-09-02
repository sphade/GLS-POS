import { useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, currencySymbol } from "@/constants/theme";
import { NumberInput } from "@/components/NumberInput";
import { feedbackTap } from "@/lib/feedback";
import type { Item, Variant } from "@/lib/cart";

const SYM = currencySymbol("NGN");

export const VARIANT_ICONS = {
  profit: require("../assets/images/icon_profit.webp"),
  stockTrack: require("../assets/images/icon_stock_track.webp"),
  stockControl: require("../assets/images/icon_stock_control.webp"),
  barcode: require("../assets/images/icon_barcode.webp"),
  expiry: require("../assets/images/icon_expiry.webp"),
  tax: require("../assets/images/icon_tax.png"),
  discount: require("../assets/images/icon_discount.webp"),
  note: require("../assets/images/icon_note.webp"),
  modifiers: require("../assets/images/icon_modifiers.webp"),
  tag: require("../assets/images/icon_tag.png"),
};

/** Square checkbox matching the variant editor's controls. */
export function CheckBox({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      hitSlop={8}
      onPress={() => {
        feedbackTap();
        onChange(!value);
      }}
    >
      <Ionicons
        name={value ? "checkbox" : "square-outline"}
        size={24}
        color={value ? colors.primary : colors.grey500}
      />
    </Pressable>
  );
}

/** Feature row: icon Â· label Â· (?) Â· checkbox, with an optional revealed body. */
function FeatureRow({
  icon,
  label,
  on,
  onToggle,
  children,
}: {
  icon: number;
  label: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.featureCard}>
      <View style={styles.featureHeader}>
        <Image source={icon} style={styles.featureIcon} resizeMode="contain" />
        <Text style={styles.featureLabel}>{label}</Text>
        <Pressable hitSlop={8} onPress={feedbackTap}>
          <Ionicons name="help-circle" size={22} color={colors.primary} />
        </Pressable>
        <CheckBox value={on} onChange={onToggle} />
      </View>
      {on && children ? <View style={styles.featureBody}>{children}</View> : null}
    </View>
  );
}

function Labelled({
  label,
  hint,
  value,
  onChangeText,
  keyboardType,
  decimals = true,
}: {
  label: string;
  hint: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: "numeric" | "default";
  /** Only meaningful with keyboardType="numeric". */
  decimals?: boolean;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.smallLabel}>{label}</Text>
      {keyboardType === "numeric" ? (
        <NumberInput
          style={styles.filledInput}
          value={value}
          onChangeText={onChangeText}
          decimals={decimals}
          placeholder={hint}
          placeholderTextColor={colors.grey500}
        />
      ) : (
        <TextInput
          style={styles.filledInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={hint}
          placeholderTextColor={colors.grey500}
          keyboardType={keyboardType ?? "default"}
        />
      )}
    </View>
  );
}

/**
 * Full-screen variant editor sheet: âœ• Â· DELETE Â· ADD, then the variant's price,
 * stock and the optional feature checkboxes.
 */
export function VariantEditor({
  visible,
  variant,
  sellByFraction,
  measureUnit,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  variant: Variant | null;
  sellByFraction?: boolean;
  measureUnit?: string;
  onClose: () => void;
  onSave: (v: Variant) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<Variant | null>(variant);

  // Re-seed when a different variant is opened.
  if (visible && variant && draft?.id !== variant.id) setDraft(variant);
  if (!visible || !draft) return null;

  const set = <K extends keyof Variant>(key: K, value: Variant[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const num = (v?: number) => (v ? String(v / 100) : "");
  const toMinor = (t: string) => Math.round((parseFloat(t) || 0) * 100);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={["top"]} style={styles.root}>
        <View style={styles.toolbar}>
          <Pressable onPress={onClose} style={styles.toolbarBtn} hitSlop={8}>
            <Ionicons name="close" size={26} color={colors.primary} />
          </Pressable>
          <View style={{ flex: 1 }} />
          {onDelete && (
            <Pressable style={styles.deleteBtn} onPress={onDelete}>
              <Text style={styles.deleteText}>DELETE</Text>
            </Pressable>
          )}
          <Pressable
            style={styles.addBtn}
            onPress={() => {
              const name = draft.name.trim();
              if (!name) {
                Alert.alert("Variant name required", "Give this option a name such as Regular, Large, or 500g.");
                return;
              }
              if (!Number.isInteger(draft.price) || draft.price <= 0) {
                Alert.alert("Valid price required", "Enter a selling price greater than zero.");
                return;
              }
              onSave({ ...draft, name });
            }}
          >
            <Text style={styles.addText}>ADD</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 8, paddingBottom: 40 }}>
          {/* Name + avatar */}
          <View style={styles.card}>
            <View style={styles.nameRow}>
              <Pressable style={[styles.avatar, { backgroundColor: draft.color }]} onPress={feedbackTap}>
                <View style={styles.avatarBadge}>
                  <Ionicons name="pencil" size={12} color={colors.primary} />
                </View>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.smallLabel}>Variant Name</Text>
                <TextInput
                  style={styles.filledInput}
                  value={draft.name}
                  onChangeText={(t) => set("name", t)}
                  placeholder={sellByFraction ? "Ex 500gm, 1kg, 1ltr" : "Ex 500gm, Blue, 1kg, 1ltr"}
                  placeholderTextColor={colors.grey500}
                />
              </View>
            </View>
          </View>

          {/* Price + profit */}
          <View style={styles.card}>
            <View style={styles.splitRow}>
              <Labelled
                label={`Selling Price *${sellByFraction && measureUnit ? ` (per ${measureUnit})` : ""}`}
                hint="0.00"
                value={num(draft.price)}
                onChangeText={(t) => set("price", toMinor(t))}
                keyboardType="numeric"
              />
              <View style={styles.checkCol}>
                <Text style={styles.smallLabel}>Track Profit?</Text>
                <CheckBox value={draft.trackProfit} onChange={(v) => set("trackProfit", v)} />
              </View>
            </View>
            {draft.trackProfit && (
              <View style={{ marginTop: 10 }}>
                <Labelled
                  label="Cost Price"
                  hint="0.00"
                  value={num(draft.cost)}
                  onChangeText={(t) => set("cost", toMinor(t))}
                  keyboardType="numeric"
                />
              </View>
            )}
          </View>

          {/* Stock */}
          <View style={styles.card}>
            <View style={styles.splitRow}>
              <Labelled
                label={`Stock Available${sellByFraction && measureUnit ? ` (${measureUnit})` : ""}`}
                hint="0"
                value={draft.stock != null ? String(draft.stock) : ""}
                onChangeText={(t) => set("stock", parseFloat(t) || 0)}
                keyboardType="numeric"
                decimals={sellByFraction}
              />
              <View style={styles.checkCol}>
                <Text style={styles.smallLabel}>Low stock alerts?</Text>
                <CheckBox value={draft.lowStockAlert} onChange={(v) => set("lowStockAlert", v)} />
              </View>
            </View>
            {draft.lowStockAlert && (
              <View style={{ marginTop: 10 }}>
                <Labelled
                  label="Low Stock Alert"
                  hint="5"
                  value={draft.lowStockAt != null ? String(draft.lowStockAt) : ""}
                  onChangeText={(t) => set("lowStockAt", parseFloat(t) || 0)}
                  keyboardType="numeric"
                  decimals={sellByFraction}
                />
              </View>
            )}
            <View style={styles.inlineCheckRow}>
              <Image source={VARIANT_ICONS.stockTrack} style={styles.featureIcon} resizeMode="contain" />
              <CheckBox value={draft.autoUpdateStock} onChange={(v) => set("autoUpdateStock", v)} />
              <Text style={styles.inlineCheckLabel}>Auto-update stock on item sales</Text>
            </View>
          </View>

          <FeatureRow icon={VARIANT_ICONS.barcode} label="Barcode?" on={draft.barcodeOn} onToggle={(v) => set("barcodeOn", v)}>
            <Labelled label="Barcode" hint="xxxxxxxx" value={draft.barcode ?? ""} onChangeText={(t) => set("barcode", t)} />
          </FeatureRow>

          <FeatureRow icon={VARIANT_ICONS.expiry} label="Track Expiry?" on={draft.expiryOn} onToggle={(v) => set("expiryOn", v)}>
            <Labelled label="Expiry Date" hint="DD/MM/YYYY" value={draft.expiry ?? ""} onChangeText={(t) => set("expiry", t)} />
          </FeatureRow>

          <FeatureRow icon={VARIANT_ICONS.tax} label="Add Tax" on={draft.taxOn} onToggle={(v) => set("taxOn", v)}>
            <Labelled
              label="Enter Tax (%)"
              hint="0"
              value={draft.taxPercent != null ? String(draft.taxPercent) : ""}
              onChangeText={(t) => set("taxPercent", parseFloat(t) || 0)}
              keyboardType="numeric"
            />
            <View style={styles.inlineCheckRow}>
              <CheckBox value={!!draft.taxInclusive} onChange={(v) => set("taxInclusive", v)} />
              <Text style={styles.inlineCheckLabel}>Inclusive of Tax ?</Text>
            </View>
          </FeatureRow>

          <FeatureRow icon={VARIANT_ICONS.note} label="Internal Notes" on={draft.notesOn} onToggle={(v) => set("notesOn", v)}>
            <Labelled label="Internal Notes" hint="-" value={draft.notes ?? ""} onChangeText={(t) => set("notes", t)} />
          </FeatureRow>

          <FeatureRow
            icon={VARIANT_ICONS.modifiers}
            label="Modifiers"
            on={draft.modifiersOn}
            onToggle={(v) => set("modifiersOn", v)}
          >
            <Text style={styles.hintText}>Manage modifier sets from Inventory Management.</Text>
          </FeatureRow>

          <FeatureRow icon={VARIANT_ICONS.modifiers} label="Recipe" on={draft.recipeOn} onToggle={(v) => set("recipeOn", v)}>
            <Text style={styles.hintText}>Tap manage to set the recipe ingredients.</Text>
          </FeatureRow>

          <FeatureRow icon={VARIANT_ICONS.tag} label="Your Spaces" on={draft.spacesOn} onToggle={(v) => set("spacesOn", v)}>
            <Text style={styles.hintText}>Visible to all spaces.</Text>
          </FeatureRow>

          <FeatureRow icon={VARIANT_ICONS.tag} label="Tags" on={draft.tagsOn} onToggle={(v) => set("tagsOn", v)}>
            <Labelled label="Tags" hint="-" value={draft.tags ?? ""} onChangeText={(t) => set("tags", t)} />
          </FeatureRow>

          <FeatureRow
            icon={VARIANT_ICONS.discount}
            label="Add Compare Price / MRP"
            on={draft.compareOn}
            onToggle={(v) => set("compareOn", v)}
          >
            <Labelled
              label="Compare (or) Display Price"
              hint="0.00"
              value={num(draft.comparePrice)}
              onChangeText={(t) => set("comparePrice", toMinor(t))}
              keyboardType="numeric"
            />
          </FeatureRow>

          <FeatureRow icon={VARIANT_ICONS.tag} label="SKU" on={draft.skuOn} onToggle={(v) => set("skuOn", v)}>
            <Labelled label="SKU" hint="-" value={draft.sku ?? ""} onChangeText={(t) => set("sku", t)} />
          </FeatureRow>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.grey50,
    paddingVertical: 8,
    paddingRight: 8,
    gap: 8,
    elevation: 3,
  },
  toolbarBtn: { width: 44, alignItems: "center" },
  deleteBtn: { backgroundColor: "#EF3E36", borderRadius: 3, paddingHorizontal: 18, paddingVertical: 10 },
  deleteText: { color: colors.white, fontWeight: "700", fontSize: 14, letterSpacing: 0.5 },
  addBtn: { backgroundColor: colors.green, borderRadius: 3, paddingHorizontal: 24, paddingVertical: 10 },
  addText: { color: colors.white, fontWeight: "700", fontSize: 14, letterSpacing: 0.5 },

  card: { backgroundColor: colors.card, borderRadius: 3, padding: 12, marginBottom: 8, elevation: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  avatarBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },

  smallLabel: { fontSize: 12, color: colors.grey600, marginBottom: 4 },
  filledInput: {
    backgroundColor: colors.grey100,
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.grey900,
  },
  splitRow: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  checkCol: { alignItems: "flex-start", gap: 4 },

  inlineCheckRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  inlineCheckLabel: { flex: 1, fontSize: 14, color: colors.grey800 },

  featureCard: { backgroundColor: colors.card, borderRadius: 3, paddingHorizontal: 12, paddingVertical: 14, marginBottom: 8, elevation: 1 },
  featureHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  featureIcon: { width: 24, height: 24 },
  featureLabel: { flex: 1, fontSize: 16, color: colors.grey900 },
  featureBody: { marginTop: 12, gap: 8 },
  hintText: { fontSize: 13, color: colors.grey600 },
});

