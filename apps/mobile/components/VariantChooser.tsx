import { memo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, formatMoney } from "@/constants/theme";
import { ItemImage } from "@/components/ItemImage";
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
 * Styled to match the rest of the POS: green app bar, caps title, white cards
 * on the grey sheet. Every row carries the same plus/minus stepper used on the
 * Counter, so one sheet both adds and removes and the running quantity is
 * always visible — no separate "add mode" to reason about.
 *
 * Like the Items grid, this sheet subscribes per-variant-line instead of to
 * the whole cart: a tap re-renders only the touched row and the footer.
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

  /**
   * Radio behaviour: whatever else was picked for this item is dropped, the
   * tapped option becomes the selection, and the sheet closes. `remove` takes
   * one unit at a time, so a line is cleared by repeating — normally a single
   * call, but an item switched to choose-one after a cart was built could carry
   * more.
   */
  const chooseOnly = (variant: Variant) => {
    for (const other of variants) {
      if (other.id === variant.id) continue;
      const otherLine = cartLineKey(item.id, other.id);
      for (let left = getLine(otherLine)?.qty ?? 0; left > 0; left -= 1) {
        remove(otherLine);
      }
    }
    // Re-tapping the current selection just confirms it; don't stack a second.
    const mine = cartLineKey(item.id, variant.id);
    if ((getLine(mine)?.qty ?? 0) === 0) add(item, variant);
    feedbackAddItem();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          {/* App bar, same green as every other editor sheet. */}
          <View style={styles.appBar}>
            <Text style={styles.appBarTitle}>SELECT VARIANT</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.white} />
            </Pressable>
          </View>

          <View style={styles.itemStrip}>
            <ItemImage
              productId={item.id}
              name={item.name}
              size={44}
              color={item.categoryColor ?? colors.primary}
              hasImage={!!item.hasImage}
              remoteUrl={item.imageUrl}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.itemHint}>
                {chooseOne ? "Pick one" : "Pick the option you're selling"}
              </Text>
            </View>
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

          <View style={styles.footer}>
            <VariantFooter key={item.id} item={item} />
            <Pressable style={styles.done} onPress={onClose} android_ripple={{ color: "#FFFFFF22" }}>
              <Text style={styles.doneText}>DONE</Text>
            </Pressable>
          </View>
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

  if (chooseOne) {
    const selected = qty > 0;
    return (
      <Pressable
        style={[styles.card, !available && styles.cardOut]}
        disabled={!available}
        accessibilityRole="radio"
        accessibilityState={{ selected, disabled: !available }}
        onPress={onChoose}
        android_ripple={{ color: "#00000010" }}
      >
        <View style={[styles.swatch, { backgroundColor: variant.color || colors.primary }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.variantName} numberOfLines={2}>
            {variant.name}
          </Text>
          <Text style={styles.variantPrice}>{formatMoney(variant.price, item.currency)}</Text>
        </View>
        {available ? (
          <Ionicons
            name={selected ? "radio-button-on" : "radio-button-off"}
            size={26}
            color={selected ? colors.primary : colors.grey400}
          />
        ) : (
          <View style={styles.oosTag}>
            <Text style={styles.oosTagText}>SOLD OUT</Text>
          </View>
        )}
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, !available && styles.cardOut]}>
      <View style={[styles.swatch, { backgroundColor: variant.color || colors.primary }]} />

      <View style={{ flex: 1 }}>
        <Text style={styles.variantName} numberOfLines={1}>
          {variant.name}
        </Text>
        <Text style={styles.variantPrice}>{formatMoney(variant.price, item.currency)}</Text>
        <Text style={[styles.variantStock, !available && styles.variantStockOut]}>
          {!available
            ? "OUT OF STOCK"
            : variant.stock == null
              ? "Stock not tracked"
              : `${variant.stock} in stock`}
        </Text>
      </View>

      {/* Same stepper as the Counter: minus, live qty, plus. */}
      {available ? (
        <View style={styles.stepper}>
          <Pressable
            style={[styles.stepBtn, styles.stepMinus, qty === 0 && styles.stepDisabled]}
            disabled={qty === 0}
            onPress={() => {
              feedbackTap();
              onRemove();
            }}
          >
            <Ionicons name="remove" size={21} color={colors.white} />
          </Pressable>

          <Text style={[styles.qty, qty > 0 && { color: colors.primary }]}>{qty}</Text>

          <Pressable
            style={[styles.stepBtn, styles.stepPlus, atMax && styles.stepDisabled]}
            disabled={atMax}
            onPress={() => {
              if (atMax) {
                feedbackError();
                return;
              }
              onAdd();
              feedbackAddItem();
            }}
          >
            <Ionicons name="add" size={21} color={colors.white} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.oosTag}>
          <Text style={styles.oosTagText}>SOLD OUT</Text>
        </View>
      )}
    </View>
  );
});

/** Running total for the sheet; subscribes to every variant's line. */
function VariantFooter({ item }: { item: Item }) {
  const variants = item.variants ?? [];
  const lineIds = variants.map((v) => cartLineKey(item.id, v.id));
  // Re-render on any of this item's lines changing.
  const entries = lineIds.map((lineId) => useCartLine(lineId));
  const selected = entries.reduce((sum, e) => sum + (e?.qty ?? 0), 0);
  const selectedTotal = entries.reduce(
    (sum, e, i) => sum + (e?.qty ?? 0) * variants[i]!.price,
    0,
  );

  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.footerLabel}>
        {selected} item{selected === 1 ? "" : "s"} selected
      </Text>
      <Text style={styles.footerTotal}>{formatMoney(selectedTotal, item.currency)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" },
  sheet: {
    maxHeight: "82%",
    backgroundColor: colors.screenBg,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    overflow: "hidden",
  },

  appBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  appBarTitle: { color: colors.white, fontSize: 16, fontWeight: "700", letterSpacing: 0.5 },

  itemStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  itemName: { fontSize: 17, fontWeight: "700", color: colors.grey900 },
  itemHint: { fontSize: 12, color: colors.grey600, marginTop: 2 },

  list: { maxHeight: 400 },
  listContent: { padding: 8, paddingBottom: 4 },

  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 3,
    padding: 10,
    marginBottom: 8,
    elevation: 1,
  },
  cardOut: { opacity: 0.55 },
  swatch: { width: 8, alignSelf: "stretch", minHeight: 46, borderRadius: 4 },

  variantName: { fontSize: 16, fontWeight: "600", color: colors.grey900 },
  variantPrice: { fontSize: 15, fontWeight: "700", color: colors.primary, marginTop: 3 },
  variantStock: { fontSize: 11, color: colors.grey600, marginTop: 3 },
  variantStockOut: { color: colors.outOfStock, fontWeight: "800" },

  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    elevation: 1,
  },
  stepMinus: { backgroundColor: colors.actionRemove },
  stepPlus: { backgroundColor: colors.actionAdd },
  stepDisabled: { backgroundColor: colors.grey400, elevation: 0 },
  qty: { minWidth: 22, textAlign: "center", fontSize: 17, fontWeight: "800", color: colors.grey900 },

  oosTag: { backgroundColor: colors.outOfStock, borderRadius: 3, paddingHorizontal: 9, paddingVertical: 6 },
  oosTagText: { color: colors.white, fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey300,
  },
  footerLabel: { fontSize: 12, color: colors.grey600, fontWeight: "600" },
  footerTotal: { fontSize: 18, fontWeight: "800", color: colors.grey900, marginTop: 2 },
  done: {
    minWidth: 128,
    height: 46,
    borderRadius: 4,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  doneText: { color: colors.white, fontSize: 16, fontWeight: "700", letterSpacing: 0.5 },
});
