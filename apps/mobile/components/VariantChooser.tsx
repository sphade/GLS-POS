import { memo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, formatMoney } from "@/constants/theme";
import { ProductAvatar } from "@/components/product-avatar";
import { feedbackAddItem, feedbackError, feedbackTap } from "@/lib/feedback";
import {
  cartLineKey,
  useCartActions,
  useCartLine,
  variantAvailable,
  type Item,
  type Variant,
} from "@/lib/cart";

/**
 * Variant picker for an item sold in more than one size/option.
 *
 * A bottom sheet: grab handle, item header, one card per variant, and a single
 * full-width confirm button carrying the running count and total. Every row
 * that is in the cart shows a stepper, so any variant can be sold in any
 * quantity. "Choose one" items keep radio semantics (picking an option clears
 * the others) but the chosen option still gets a stepper.
 *
 * Rows subscribe per-variant-line, so a tap re-renders only the touched row
 * and the footer.
 */
export function VariantChooser({
  item,
  visible,
  onClose,
}: {
  item: Item | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { add, remove, getLine } = useCartActions();

  const variants = item?.variants ?? [];
  if (!item || variants.length === 0) return null;

  const chooseOne = !!item.chooseOne;

  /** Radio behaviour: drop other options of this item, select the tapped one. */
  const chooseOnly = (variant: Variant) => {
    for (const other of variants) {
      if (other.id === variant.id) continue;
      const otherLine = cartLineKey(item.id, other.id);
      for (let left = getLine(otherLine)?.qty ?? 0; left > 0; left -= 1) {
        remove(otherLine);
      }
    }
    const mine = cartLineKey(item.id, variant.id);
    if ((getLine(mine)?.qty ?? 0) === 0) add(item, variant);
    feedbackAddItem();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <ProductAvatar
              name={item.name}
              size={48}
              color={item.categoryColor ?? colors.primary}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.itemHint}>
                {chooseOne ? "Choose one option, then set the quantity" : "Set a quantity for each option"}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color={colors.grey900} />
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {variants.map((variant) => (
              <VariantRow
                key={variant.id}
                item={item}
                variant={variant}
                chooseOne={chooseOne}
                onChoose={() => chooseOnly(variant)}
                onAdd={() => add(item, variant)}
                onRemove={() => remove(cartLineKey(item.id, variant.id))}
              />
            ))}
          </ScrollView>

          <VariantFooter key={item.id} item={item} onDone={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** One variant row; re-renders only when its own line changes. */
const VariantRow = memo(function VariantRow({
  item,
  variant,
  chooseOne,
  onChoose,
  onAdd,
  onRemove,
}: {
  item: Item;
  variant: Variant;
  chooseOne: boolean;
  onChoose: () => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const entry = useCartLine(cartLineKey(item.id, variant.id));
  const qty = entry?.qty ?? 0;
  const available = variantAvailable(variant);
  const atMax = variant.stock != null && qty >= variant.stock;
  const selected = qty > 0;

  const stockText = !available
    ? "Sold out"
    : variant.stock == null
      ? null
      : `${variant.stock} left`;

  // Tapping the card body: choose-one selects it; otherwise adds one when empty.
  const onCardPress = () => {
    if (!available) return;
    if (chooseOne) onChoose();
    else if (!selected) {
      onAdd();
      feedbackAddItem();
    }
  };

  return (
    <Pressable
      style={[styles.card, selected && styles.cardSelected, !available && styles.cardOut]}
      disabled={!available || (selected && !chooseOne)}
      onPress={onCardPress}
      accessibilityRole={chooseOne ? "radio" : "button"}
      accessibilityState={{ selected, disabled: !available }}
      android_ripple={{ color: "#00000010" }}
    >
      <View style={[styles.dot, { backgroundColor: variant.color || colors.primary }]} />

      <View style={{ flex: 1 }}>
        <Text style={styles.variantName} numberOfLines={2}>
          {variant.name}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.variantPrice}>{formatMoney(variant.price, item.currency)}</Text>
          {stockText ? (
            <Text style={[styles.variantStock, !available && styles.variantStockOut]}>
              · {stockText}
            </Text>
          ) : null}
        </View>
      </View>

      {!available ? null : selected ? (
        <View style={styles.stepper}>
          <Pressable
            style={styles.stepBtn}
            hitSlop={6}
            accessibilityLabel={`Remove one ${variant.name}`}
            onPress={() => {
              feedbackTap();
              onRemove();
            }}
          >
            <Ionicons name={qty === 1 ? "trash-outline" : "remove"} size={18} color={colors.grey900} />
          </Pressable>
          <Text style={styles.qty}>{qty}</Text>
          <Pressable
            style={[styles.stepBtn, styles.stepBtnPlus, atMax && styles.stepDisabled]}
            hitSlop={6}
            accessibilityLabel={`Add one ${variant.name}`}
            onPress={() => {
              if (atMax) {
                feedbackError();
                return;
              }
              onAdd();
              feedbackAddItem();
            }}
          >
            <Ionicons name="add" size={18} color={colors.white} />
          </Pressable>
        </View>
      ) : chooseOne ? (
        <Ionicons name="radio-button-off" size={24} color={colors.grey400} />
      ) : (
        <View style={styles.addPill}>
          <Ionicons name="add" size={18} color={colors.primary} />
          <Text style={styles.addPillText}>Add</Text>
        </View>
      )}
    </Pressable>
  );
});

/** Confirm button with running count + total; subscribes to every variant's line. */
function VariantFooter({ item, onDone }: { item: Item; onDone: () => void }) {
  const variants = item.variants ?? [];
  const lineIds = variants.map((v) => cartLineKey(item.id, v.id));
  const entries = lineIds.map((lineId) => useCartLine(lineId));
  const count = entries.reduce((sum, e) => sum + (e?.qty ?? 0), 0);
  const total = entries.reduce((sum, e, i) => sum + (e?.qty ?? 0) * variants[i]!.price, 0);

  return (
    <View style={styles.footer}>
      <Pressable
        style={[styles.done, count === 0 && styles.doneEmpty]}
        onPress={onDone}
        android_ripple={{ color: "#FFFFFF22" }}
      >
        <Text style={[styles.doneText, count === 0 && styles.doneTextEmpty]}>
          {count === 0 ? "Close" : `Done · ${count} item${count === 1 ? "" : "s"}`}
        </Text>
        {count > 0 ? (
          <Text style={styles.doneTotal}>{formatMoney(total, item.currency)}</Text>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" },
  sheet: {
    maxHeight: "85%",
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: "hidden",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.grey300,
    marginTop: 8,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey300,
  },
  itemName: { fontSize: 18, fontWeight: "700", color: colors.grey900 },
  itemHint: { fontSize: 13, color: colors.grey600, marginTop: 2 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.screenBg,
  },

  list: { maxHeight: 420 },
  listContent: { padding: 12, gap: 8 },

  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.grey300,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cardSelected: { borderColor: colors.primary },
  cardOut: { opacity: 0.5 },
  dot: { width: 10, height: 10, borderRadius: 5 },

  variantName: { fontSize: 16, fontWeight: "600", color: colors.grey900 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 3, gap: 4 },
  variantPrice: { fontSize: 14, fontWeight: "700", color: colors.primary },
  variantStock: { fontSize: 12, color: colors.grey600 },
  variantStockOut: { color: colors.outOfStock, fontWeight: "700" },

  stepper: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.screenBg,
  },
  stepBtnPlus: { backgroundColor: colors.primary },
  stepDisabled: { backgroundColor: colors.grey400 },
  qty: { minWidth: 26, textAlign: "center", fontSize: 17, fontWeight: "800", color: colors.grey900 },

  addPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingHorizontal: 12,
    height: 34,
  },
  addPillText: { color: colors.primary, fontSize: 14, fontWeight: "700" },

  footer: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey300,
  },
  done: {
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
  },
  doneEmpty: { backgroundColor: colors.screenBg, justifyContent: "center" },
  doneText: { color: colors.white, fontSize: 16, fontWeight: "700" },
  doneTextEmpty: { color: colors.grey900 },
  doneTotal: { color: colors.white, fontSize: 16, fontWeight: "800" },
});
