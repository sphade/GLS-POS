import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, formatMoney } from "@/constants/theme";
import { ItemImage } from "@/components/ItemImage";
import { feedbackError, feedbackTap } from "@/lib/feedback";
import { variantAvailable, type Item, type Variant } from "@/lib/cart";

export function VariantChooser({
  item,
  visible,
  actionLabel = "ADD",
  onClose,
  onSelect,
}: {
  item: Item | null;
  visible: boolean;
  actionLabel?: "ADD" | "REMOVE";
  onClose: () => void;
  onSelect: (variant: Variant) => void;
}) {
  if (!item) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <ItemImage
              productId={item.id}
              name={item.name}
              size={58}
              color={item.categoryColor ?? colors.primary}
              hasImage={!!item.hasImage}
              remoteUrl={item.imageUrl}
            />
            <View style={styles.heading}>
              <Text style={styles.kicker}>CHOOSE A VARIANT</Text>
              <Text style={styles.title}>{item.name}</Text>
              <Text style={styles.help}>The base item is not sold separately.</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={25} color={colors.grey700} />
            </Pressable>
          </View>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {item.variants?.map((variant) => {
              const available = variantAvailable(variant);
              return (
                <Pressable
                  key={variant.id}
                  style={[styles.row, !available && styles.disabled]}
                  disabled={!available}
                  onPress={() => {
                    if (!available) {
                      feedbackError();
                      return;
                    }
                    feedbackTap();
                    onSelect(variant);
                  }}
                >
                  <View style={[styles.swatch, { backgroundColor: variant.color || item.categoryColor || colors.primary }]} />
                  <View style={styles.details}>
                    <Text style={styles.name}>{variant.name}</Text>
                    <Text style={styles.stock}>
                      {variant.stock == null ? "Stock not tracked" : available ? `${variant.stock} available` : "Out of stock"}
                    </Text>
                  </View>
                  <Text style={styles.price}>{formatMoney(variant.price, item.currency)}</Text>
                  <View style={styles.action}>
                    <Text style={styles.actionText}>{actionLabel}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000077" },
  sheet: { maxHeight: "78%", backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24 },
  handle: { width: 42, height: 4, borderRadius: 2, backgroundColor: colors.grey300, alignSelf: "center", marginTop: 9 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.grey300 },
  heading: { flex: 1 },
  kicker: { color: colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1.1 },
  title: { color: colors.grey900, fontSize: 21, fontWeight: "800", marginTop: 2 },
  help: { color: colors.grey600, fontSize: 12, marginTop: 3 },
  list: { maxHeight: 430 },
  listContent: { padding: 12, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: colors.grey50, borderRadius: 10, borderWidth: 1, borderColor: colors.grey200, padding: 12 },
  disabled: { opacity: 0.45 },
  swatch: { width: 13, height: 42, borderRadius: 7 },
  details: { flex: 1 },
  name: { color: colors.grey900, fontSize: 16, fontWeight: "700" },
  stock: { color: colors.grey600, fontSize: 12, marginTop: 3 },
  price: { color: colors.primary, fontSize: 15, fontWeight: "800" },
  action: { minWidth: 50, borderRadius: 14, backgroundColor: colors.green, paddingHorizontal: 9, paddingVertical: 6, alignItems: "center" },
  actionText: { color: colors.white, fontSize: 10, fontWeight: "800" },
});