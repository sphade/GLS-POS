import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney, strings } from "@/constants/theme";
import { PosHeader, PosSearchBar } from "@/components/PosHeader";
import { useCart, type Item } from "@/lib/cart";
import { useCatalog } from "@/lib/catalog";
import { usePermission } from "@/lib/permissions";
import { feedbackAddItem, feedbackError, feedbackTap } from "@/lib/feedback";

const NEW_ITEM_ID = "__new_item__";
const GAP = 6;
const PAD = 6;

export default function ItemsScreen() {
  const router = useRouter();
  const { add, remove, qtyOf, count } = useCart();
  const { products } = useCatalog();
  const { can } = usePermission();
  const [query, setQuery] = useState("");
  const [isGrid, setIsGrid] = useState(true);
  const { width } = useWindowDimensions();

  const cols = isGrid ? (width > 700 ? 5 : 3) : 1;
  const cardWidth = (width - PAD * 2 - GAP * (cols - 1)) / cols;
  const canCreateItems = can("inventoryItems", "create");

  const data = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? products.filter((i) => i.name.toLowerCase().includes(q))
      : products;
    return canCreateItems
      ? [...filtered, { id: NEW_ITEM_ID } as Item]
      : filtered;
  }, [query, products, canCreateItems]);

  const onAdd = (item: Item) => {
    if (item.stockQuantity === 0) {
      feedbackError();
      return;
    }
    feedbackAddItem();
    add(item);
  };

  /** Long-press removes one from the cart (no-op if none). */
  const onRemove = (item: Item) => {
    if (qtyOf(item.id) === 0) return;
    feedbackTap();
    remove(item.id);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.headerRegion}>
        <PosHeader
          title={strings.items}
          showLayoutSwitch
          isGrid={isGrid}
          showAddCustomer
          onLayoutSwitch={() => setIsGrid((v) => !v)}
        />
        <PosSearchBar
          value={query}
          onChangeText={setQuery}
          onScan={() => router.push("/scanner")}
        />
      </SafeAreaView>

      <FlatList
        key={`cols-${cols}`}
        data={data}
        keyExtractor={(i) => i.id}
        numColumns={cols}
        columnWrapperStyle={
          cols > 1 ? { gap: GAP, paddingHorizontal: PAD } : undefined
        }
        contentContainerStyle={[
          styles.gridContent,
          cols === 1 && { paddingHorizontal: PAD },
        ]}
        renderItem={({ item }) => {
          if (item.id === NEW_ITEM_ID) {
            return (
              <Pressable
                style={[
                  styles.card,
                  styles.newItemCard,
                  cols > 1 ? { width: cardWidth } : undefined,
                ]}
                onPress={() => router.push("/item-editor")}
                android_ripple={{ color: "#00000010" }}
              >
                <View style={styles.newItemPlus}>
                  <Ionicons name="add" size={26} color={colors.white} />
                </View>
                <Text style={styles.newItemText}>
                  {strings.newItem.toUpperCase()}
                </Text>
              </Pressable>
            );
          }
          return isGrid ? (
            <ProductCard
              item={item}
              width={cardWidth}
              qty={qtyOf(item.id)}
              onPress={() => onAdd(item)}
              onLongPress={() => onRemove(item)}
            />
          ) : (
            <ProductRow
              item={item}
              qty={qtyOf(item.id)}
              onPress={() => onAdd(item)}
              onLongPress={() => onRemove(item)}
            />
          );
        }}
      />

      {count > 0 && (
        <Pressable
          style={styles.goToCounter}
          onPress={() => {
            feedbackTap();
            router.navigate("/counter");
          }}
        >
          <Text style={styles.goToCounterText}>{strings.goToCounter}</Text>
          <View style={styles.goBadge}>
            <Text style={styles.goBadgeText}>{count}</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}

function Avatar({ item, size }: { item: Item; size: number }) {
  const low =
    item.stockQuantity !== null &&
    item.stockQuantity > 0 &&
    item.stockQuantity <= 3;
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: item.categoryColor ?? colors.red500,
        },
      ]}
    >
      {low && <View style={styles.lowDot} />}
    </View>
  );
}

function ProductCard({
  item,
  width,
  qty,
  onPress,
  onLongPress,
}: {
  item: Item;
  width: number;
  qty: number;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const circle = Math.min(width - 28, 78);
  const out = item.stockQuantity === 0;
  // Band spans the full card width but only the image area's height (+ padding).
  const bandHeight = circle + 20;
  return (
    <Pressable
      style={[styles.card, { width }]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={250}
      android_ripple={{ color: "#00000010" }}
    >
      <View style={[styles.imageZone, { width: circle, height: circle }]}>
        <Avatar item={item} size={circle} />
      </View>

      <Text style={styles.title} numberOfLines={1}>
        {item.name}
      </Text>
      <Text style={styles.price} numberOfLines={1}>
        {formatMoney(item.price, item.currency)}
      </Text>

      {/* Full-width band over the image area only — leaves name/price clear */}
      {out && (
        <View style={[styles.oosBand, { height: bandHeight }]}>
          <View style={styles.oosLabel}>
            <Text style={styles.oosLabelText}>OUT OF STOCK</Text>
          </View>
        </View>
      )}
      {qty > 0 && !out && (
        <View style={[styles.countBand, { height: bandHeight }]}>
          <Text style={styles.countText}>x{qty}</Text>
        </View>
      )}
    </Pressable>
  );
}

function ProductRow({
  item,
  qty,
  onPress,
  onLongPress,
}: {
  item: Item;
  qty: number;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const out = item.stockQuantity === 0;
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={250}
      android_ripple={{ color: "#00000010" }}
    >
      <View style={styles.rowThumb}>
        <Avatar item={item} size={46} />
        {out && (
          <View style={[styles.oosZone, { borderRadius: 6 }]}>
            <Text style={styles.oosThumbText}>OOS</Text>
          </View>
        )}
        {qty > 0 && !out && (
          <View style={[styles.countZone, { borderRadius: 6 }]}>
            <Text style={styles.countThumbText}>x{qty}</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[styles.title, { textAlign: "left", marginTop: 0 }]}
          numberOfLines={1}
        >
          {item.name}
        </Text>
        <Text style={[styles.price, { textAlign: "left", marginTop: 2 }]}>
          {formatMoney(item.price, item.currency)}
        </Text>
      </View>
      {out && <Text style={styles.rowOosText}>Out of stock</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  headerRegion: { backgroundColor: colors.primary },

  gridContent: { paddingTop: GAP, paddingBottom: 96 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingTop: 12,
    paddingBottom: 10,
    marginBottom: GAP,
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 3,
    padding: 10,
    marginBottom: GAP,
    elevation: 1,
  },
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  lowDot: {
    position: "absolute",
    top: 4,
    left: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.white,
  },

  /** Square zone that holds the circular avatar; overlays fill it. */
  imageZone: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  rowThumb: { width: 46, height: 46, position: "relative" },

  /** Out-of-stock: scrim over the whole zone + a clear red label. */
  oosZone: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  oosLabel: {
    backgroundColor: colors.outOfStock,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    transform: [{ rotate: "-8deg" }],
  },
  oosLabelText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  oosThumbText: { color: colors.white, fontSize: 10, fontWeight: "800" },
  rowOosText: { color: colors.outOfStock, fontSize: 12, fontWeight: "700" },

  /** In-cart count over the thumbnail (list mode). */
  countZone: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(139,195,74,0.60)",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: {
    color: colors.white,
    fontSize: 30,
    fontWeight: "800",
    textShadowColor: "#00000055",
    textShadowRadius: 3,
  },
  countThumbText: { color: colors.white, fontSize: 15, fontWeight: "800" },

  /** Grid overlays: full card width, image-height only, pinned to the top. */
  oosBand: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  countBand: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(90,160,44,0.82)",
    alignItems: "center",
    justifyContent: "center",
  },

  qtyOverlay: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyOverlayText: { color: colors.white, fontSize: 11, fontWeight: "800" },
  title: {
    fontSize: 15,
    color: colors.grey900,
    fontWeight: "700",
    marginTop: 10,
    textAlign: "center",
  },
  price: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: "500",
    marginTop: 6,
    textAlign: "center",
  },

  newItemCard: { justifyContent: "center" },
  newItemPlus: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  newItemText: {
    color: colors.primary,
    fontWeight: "600",
    fontSize: 15,
    marginTop: 12,
    marginBottom: 8,
  },

  goToCounter: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    height: 48,
    borderRadius: 6,
    backgroundColor: colors.green,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    elevation: 4,
  },
  goToCounterText: { color: colors.white, fontSize: 16, fontWeight: "700" },
  goBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: "#FFFFFF44",
    alignItems: "center",
    justifyContent: "center",
  },
  goBadgeText: { color: colors.white, fontWeight: "800" },
});
