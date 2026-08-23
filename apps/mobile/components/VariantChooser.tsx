import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, formatMoney } from "@/constants/theme";
import { ItemImage } from "@/components/ItemImage";
import { feedbackAddItem, feedbackError, feedbackTap } from "@/lib/feedback";
import { cartLineKey, useCart, variantAvailable, type Item, type Variant } from "@/lib/cart";

/**
 * Variant picker for an item sold in more than one size/option.
 *
 * Styled to match the rest of the POS: green app bar, caps title, white cards
 * on the grey sheet. Every row carries the same plus/minus stepper used on the
 * Counter, so one sheet both adds and removes and the running quantity is
 * always visible — no separate "add mode" to reason about.
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
  const { entries, add, remove } = useCart();

  const variants = item?.variants ?? [];
  if (!item || variants.length === 0) return null;

  const qtyOfVariant = (variant: Variant) => entries[cartLineKey(item.id, variant.id)]?.qty ?? 0;
  const selected = variants.reduce((sum, variant) => sum + qtyOfVariant(variant), 0);
  const selectedTotal = variants.reduce(
    (sum, variant) => sum + qtyOfVariant(variant) * variant.price,
    0,
  );

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
              <Text style={styles.itemHint}>Pick the option you're selling</Text>
            </View>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {variants.map((variant) => {
              const qty = qtyOfVariant(variant);
              const available = variantAvailable(variant);
              const atMax = variant.stock != null && qty >= variant.stock;
              const lineId = cartLineKey(item.id, variant.id);

              return (
                <View key={variant.id} style={[styles.card, !available && styles.cardOut]}>
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
                          remove(lineId);
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
                          add(item, variant);
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
            })}
          </ScrollView>

          <View style={styles.footer}>
            <View style={{ flex: 1 }}>
              <Text style={styles.footerLabel}>
                {selected} item{selected === 1 ? "" : "s"} selected
              </Text>
              <Text style={styles.footerTotal}>{formatMoney(selectedTotal, item.currency)}</Text>
            </View>
            <Pressable style={styles.done} onPress={onClose} android_ripple={{ color: "#FFFFFF22" }}>
              <Text style={styles.doneText}>DONE</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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
