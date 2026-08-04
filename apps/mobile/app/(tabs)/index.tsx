import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney, layout, strings } from "@/constants/theme";
import { useCart, type Item } from "@/lib/cart";
import { categories, mockItems } from "@/lib/mock-items";
import { feedbackAddItem, feedbackError, feedbackTap } from "@/lib/feedback";

const NEW_ITEM_ID = "__new_item__";
const GAP = 8;
const PAD = 8;

export default function ItemsScreen() {
  const router = useRouter();
  const { add, qtyOf, count } = useCart();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [isGrid, setIsGrid] = useState(true);
  const { width } = useWindowDimensions();

  const cols = isGrid ? (width > 700 ? 5 : layout.gridCols) : 1;
  const cardWidth = (width - PAD * 2 - GAP * (cols - 1)) / cols;

  const data = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = mockItems;
    if (categoryId) out = out.filter((i) => i.categoryId === categoryId);
    if (q) out = out.filter((i) => i.name.toLowerCase().includes(q));
    return [...out, { id: NEW_ITEM_ID } as Item];
  }, [query, categoryId]);

  const onAdd = (item: Item) => {
    if (item.stockQuantity === 0) {
      feedbackError();
      return;
    }
    feedbackAddItem();
    add(item);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.headerRegion}>
        <View style={styles.headerRow}>
          <Pressable style={styles.storeSelector} onPress={feedbackTap}>
            <Text style={styles.storeName}>GLS-POS</Text>
            <Ionicons name="chevron-down" size={18} color={colors.white} />
          </Pressable>
          <View style={styles.headerActions}>
            <Ionicons name="cloud-done-outline" size={22} color={colors.white} style={styles.hIcon} />
            <Pressable
              onPress={() => {
                feedbackTap();
                setIsGrid((v) => !v);
              }}
            >
              <MaterialCommunityIcons
                name={isGrid ? "view-grid-outline" : "view-list-outline"}
                size={22}
                color={colors.white}
                style={styles.hIcon}
              />
            </Pressable>
            <Ionicons name="help-circle-outline" size={22} color={colors.white} style={styles.hIcon} />
            <View>
              <Ionicons name="notifications-outline" size={22} color={colors.white} style={styles.hIcon} />
              <View style={styles.notifDot} />
            </View>
          </View>
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.hint} />
            <TextInput
              style={styles.searchInput}
              placeholder={strings.searchHint}
              placeholderTextColor={colors.hint}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery("")}>
                <Ionicons name="close-circle" size={18} color={colors.hint} />
              </Pressable>
            )}
          </View>
          <Pressable style={styles.scanButton} onPress={() => router.push("/scanner")}>
            <Ionicons name="barcode-outline" size={24} color={colors.white} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsRow}
        contentContainerStyle={styles.chipsContent}
      >
        <Chip label="All" active={categoryId === null} onPress={() => setCategoryId(null)} />
        {categories.map((c) => (
          <Chip
            key={c.id}
            label={c.name}
            color={c.color}
            active={categoryId === c.id}
            onPress={() => setCategoryId(c.id)}
          />
        ))}
      </ScrollView>

      <FlatList
        key={`cols-${cols}`}
        data={data}
        keyExtractor={(i) => i.id}
        numColumns={cols}
        columnWrapperStyle={cols > 1 ? { gap: GAP, paddingHorizontal: PAD } : undefined}
        contentContainerStyle={[styles.gridContent, cols === 1 && { paddingHorizontal: PAD }]}
        renderItem={({ item }) => {
          if (item.id === NEW_ITEM_ID) {
            return (
              <Pressable
                style={[styles.card, styles.newItemCard, cols > 1 ? { width: cardWidth } : undefined]}
                onPress={() => router.push("/item-editor")}
              >
                <Ionicons name="add-circle-outline" size={30} color={colors.primary} />
                <Text style={styles.newItemText}>{strings.newItem}</Text>
              </Pressable>
            );
          }
          return isGrid ? (
            <ProductCard item={item} width={cardWidth} qty={qtyOf(item.id)} onPress={() => onAdd(item)} />
          ) : (
            <ProductRow item={item} qty={qtyOf(item.id)} onPress={() => onAdd(item)} />
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

function Chip({
  label,
  color,
  active,
  onPress,
}: {
  label: string;
  color?: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.chip, active && { backgroundColor: color ?? colors.primary, borderColor: color ?? colors.primary }]}
      onPress={() => {
        feedbackTap();
        onPress();
      }}
    >
      <Text style={[styles.chipText, active && { color: colors.white }]}>{label}</Text>
    </Pressable>
  );
}

function StockBadges({ item }: { item: Item }) {
  const out = item.stockQuantity === 0;
  const low = item.stockQuantity !== null && item.stockQuantity > 0 && item.stockQuantity <= 3;
  return (
    <>
      {low && <View style={styles.lowDot} />}
      {out && (
        <View style={styles.oosPill}>
          <Text style={styles.oosText}>{strings.outOfStock}</Text>
        </View>
      )}
    </>
  );
}

function ProductCard({ item, width, qty, onPress }: { item: Item; width: number; qty: number; onPress: () => void }) {
  return (
    <Pressable style={[styles.card, { width }]} onPress={onPress} android_ripple={{ color: "#00000010" }}>
      <View style={[styles.imageArea, { backgroundColor: (item.categoryColor ?? colors.primary) + "22" }]}>
        <Text style={[styles.imageLetter, { color: item.categoryColor ?? colors.primary }]}>
          {item.name.charAt(0).toUpperCase()}
        </Text>
        <StockBadges item={item} />
        {qty > 0 && (
          <View style={styles.qtyOverlay}>
            <Text style={styles.qtyOverlayText}>{qty}</Text>
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {item.name}
      </Text>
      <View style={styles.priceRow}>
        <Text style={styles.price}>{formatMoney(item.price, item.currency)}</Text>
        {item.unit ? (
          <View style={styles.unitButton}>
            <Text style={styles.unitText}>{item.unit}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function ProductRow({ item, qty, onPress }: { item: Item; qty: number; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress} android_ripple={{ color: "#00000010" }}>
      <View style={[styles.rowThumb, { backgroundColor: (item.categoryColor ?? colors.primary) + "22" }]}>
        <Text style={[styles.imageLetter, { fontSize: 20, color: item.categoryColor ?? colors.primary }]}>
          {item.name.charAt(0).toUpperCase()}
        </Text>
        <StockBadges item={item} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.price}>{formatMoney(item.price, item.currency)}</Text>
      </View>
      {qty > 0 && (
        <View style={[styles.qtyOverlay, { position: "relative", top: 0, right: 0 }]}>
          <Text style={styles.qtyOverlayText}>{qty}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  headerRegion: { backgroundColor: colors.primary },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  storeSelector: { flexDirection: "row", alignItems: "center", gap: 4 },
  storeName: { color: colors.white, fontSize: 18, fontWeight: "700" },
  headerActions: { flexDirection: "row", alignItems: "center" },
  hIcon: { marginLeft: 14 },
  notifDot: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.red500,
  },
  searchRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 10, gap: 8 },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingHorizontal: 10,
    height: 40,
    gap: 6,
  },
  searchInput: { flex: 1, color: colors.textTitle, fontSize: 15, padding: 0 },
  scanButton: {
    width: 44,
    height: 40,
    borderRadius: 6,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
  },
  chipsRow: { maxHeight: 48, backgroundColor: colors.grey200 },
  chipsContent: { paddingHorizontal: 8, paddingVertical: 8, gap: 8, alignItems: "center" },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.grey400,
    backgroundColor: colors.white,
  },
  chipText: { fontSize: 13, color: colors.textSecondary, fontWeight: "600" },
  gridContent: { paddingTop: GAP, paddingBottom: 96 },
  card: {
    backgroundColor: colors.card,
    borderRadius: layout.cardRadius,
    padding: 8,
    marginBottom: GAP,
    elevation: layout.cardElevation,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: layout.cardRadius,
    padding: 10,
    marginBottom: GAP,
    elevation: 1,
  },
  rowThumb: { width: 44, height: 44, borderRadius: 4, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  imageArea: {
    height: layout.imageArea,
    borderRadius: 3,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 6,
  },
  imageLetter: { fontSize: 30, fontWeight: "800" },
  lowDot: { position: "absolute", top: 4, left: 4, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.lowStock },
  oosPill: {
    position: "absolute",
    bottom: 4,
    backgroundColor: colors.outOfStock,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
  },
  oosText: { color: colors.white, fontSize: 9, fontWeight: "700" },
  qtyOverlay: {
    position: "absolute",
    top: 6,
    right: 6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyOverlayText: { color: colors.white, fontSize: 12, fontWeight: "800" },
  title: { fontSize: 14, color: colors.textTitle, fontWeight: "500" },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  price: { fontSize: 15, color: colors.primary, fontWeight: "700" },
  unitButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  unitText: { fontSize: 11, color: colors.primary, fontWeight: "600" },
  newItemCard: {
    height: layout.imageArea + 56,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.primary,
    gap: 6,
  },
  newItemText: { color: colors.primary, fontWeight: "600" },
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
