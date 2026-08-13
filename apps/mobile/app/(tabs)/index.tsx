import { useMemo, useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  UIManager,
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
import { feedbackAddItem, feedbackError, feedbackTap } from "@/lib/feedback";

const NEW_ITEM_ID = "__new_item__";
const GAP = 6;
const PAD = 6;
/** Items with no category fall into this trailing group. */
const UNCATEGORISED = "UNCATEGORISED";

/** Sentinel for the "ALL" filter chip. */
const ALL = "__all__";

// Collapsing animates on Android too (no-op on iOS, which animates natively).
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** One rendered line of the grid (a single item when in list mode). */
type GridRow = { key: string; items: Item[] };
type ItemSection = {
  /** Stable key: the category id, or the UNCATEGORISED sentinel. */
  id: string;
  title: string;
  color?: string;
  total: number;
  collapsed: boolean;
  data: GridRow[];
};

/** Split a list into rows of `size` for grid rendering inside a SectionList. */
function chunk(items: Item[], size: number): GridRow[] {
  const rows: GridRow[] = [];
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    rows.push({ key: slice.map((s) => s.id).join("_"), items: slice });
  }
  return rows;
}

export default function ItemsScreen() {
  const router = useRouter();
  const { add, remove, qtyOf, count } = useCart();
  const { products, categories } = useCatalog();
  const [query, setQuery] = useState("");
  const [isGrid, setIsGrid] = useState(true);
  /** Which category is being viewed; ALL shows every group. */
  const [activeCat, setActiveCat] = useState<string>(ALL);
  /** Section ids the user has collapsed. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { width } = useWindowDimensions();

  const cols = isGrid ? (width > 700 ? 5 : 3) : 1;
  const cardWidth = (width - PAD * 2 - GAP * (cols - 1)) / cols;

  const toggleCollapse = (id: string) => {
    feedbackTap();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  /** Item counts per category, for the filter chips (unaffected by search). */
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    const known = new Set(categories.map((c) => c.id));
    for (const p of products) {
      const key = p.categoryId && known.has(p.categoryId) ? p.categoryId : UNCATEGORISED;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [products, categories]);

  /**
   * Group the catalog into one section per category (in category order), with
   * any uncategorised items last. Selecting a chip narrows to that one group;
   * empty groups are hidden, so searching collapses the view to just the
   * matches. A collapsed section keeps its header but renders no rows. The
   * "NEW ITEM" tile trails the whole list as a headerless section.
   */
  const sections = useMemo<ItemSection[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (i: Item) => (q ? i.name.toLowerCase().includes(q) : true);

    const build = (id: string, title: string, items: Item[], color?: string): ItemSection => {
      const isCollapsed = collapsed.has(id);
      return {
        id,
        title,
        color,
        total: items.length,
        collapsed: isCollapsed,
        data: isCollapsed ? [] : chunk(items, cols),
      };
    };

    const grouped: ItemSection[] = [];
    for (const c of categories) {
      if (activeCat !== ALL && activeCat !== c.id) continue;
      const items = products.filter((i) => i.categoryId === c.id && match(i));
      if (items.length === 0) continue;
      grouped.push(build(c.id, c.name.toUpperCase(), items, c.color));
    }

    if (activeCat === ALL || activeCat === UNCATEGORISED) {
      const known = new Set(categories.map((c) => c.id));
      const loose = products.filter((i) => (!i.categoryId || !known.has(i.categoryId)) && match(i));
      if (loose.length > 0) grouped.push(build(UNCATEGORISED, UNCATEGORISED, loose));
    }

    grouped.push({
      id: NEW_ITEM_ID,
      title: "",
      total: 0,
      collapsed: false,
      data: [{ key: NEW_ITEM_ID, items: [{ id: NEW_ITEM_ID } as Item] }],
    });

    return grouped;
  }, [query, products, categories, cols, activeCat, collapsed]);

  /** Add every item in a group to the cart in one tap. */
  const addSection = (section: ItemSection) => {
    const items = section.data.flatMap((r) => r.items).filter((i) => i.stockQuantity !== 0);
    if (items.length === 0) {
      feedbackError();
      return;
    }
    feedbackAddItem();
    items.forEach(add);
  };

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
        <PosSearchBar value={query} onChangeText={setQuery} onScan={() => router.push("/scanner")} />
      </SafeAreaView>

      {/* Category filter chips — tap one to view just that category. */}
      <View style={styles.chipBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipBarContent}
        >
          <Chip
            label="ALL"
            count={products.length}
            active={activeCat === ALL}
            onPress={() => {
              feedbackTap();
              setActiveCat(ALL);
            }}
          />
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={c.name.toUpperCase()}
              count={counts.get(c.id) ?? 0}
              color={c.color}
              active={activeCat === c.id}
              onPress={() => {
                feedbackTap();
                setActiveCat((prev) => (prev === c.id ? ALL : c.id));
              }}
            />
          ))}
          {(counts.get(UNCATEGORISED) ?? 0) > 0 && (
            <Chip
              label={UNCATEGORISED}
              count={counts.get(UNCATEGORISED) ?? 0}
              active={activeCat === UNCATEGORISED}
              onPress={() => {
                feedbackTap();
                setActiveCat((prev) => (prev === UNCATEGORISED ? ALL : UNCATEGORISED));
              }}
            />
          )}
        </ScrollView>
      </View>

      <SectionList
        key={`cols-${cols}`}
        sections={sections}
        keyExtractor={(row) => row.key}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.gridContent}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <View style={styles.sectionHeader}>
              {/* Tap the title area to collapse/expand the group. */}
              <Pressable
                style={styles.sectionTitleArea}
                onPress={() => toggleCollapse(section.id)}
                android_ripple={{ color: "#00000010" }}
              >
                <Ionicons
                  name={section.collapsed ? "chevron-forward" : "chevron-down"}
                  size={16}
                  color={colors.grey600}
                />
                <View
                  style={[styles.sectionDot, { backgroundColor: section.color ?? colors.grey400 }]}
                />
                <Text style={styles.sectionTitle} numberOfLines={1}>
                  {section.title}
                </Text>
                <Text style={styles.sectionCount}>{section.total}</Text>
              </Pressable>

              {/* Add every item in this group to the cart. */}
              {!section.collapsed && (
                <Pressable
                  style={styles.addAllBtn}
                  onPress={() => addSection(section)}
                  android_ripple={{ color: "#FFFFFF33" }}
                >
                  <Ionicons name="add" size={14} color={colors.white} />
                  <Text style={styles.addAllText}>ADD ALL</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
        renderItem={({ item: row }) => (
          <View style={[styles.gridRow, cols === 1 && { flexDirection: "column", gap: 0 }]}>
            {row.items.map((item) =>
              item.id === NEW_ITEM_ID ? (
                <Pressable
                  key={item.id}
                  style={[styles.card, styles.newItemCard, cols > 1 ? { width: cardWidth } : undefined]}
                  onPress={() => router.push("/item-editor")}
                  android_ripple={{ color: "#00000010" }}
                >
                  <View style={styles.newItemPlus}>
                    <Ionicons name="add" size={26} color={colors.white} />
                  </View>
                  <Text style={styles.newItemText}>{strings.newItem.toUpperCase()}</Text>
                </Pressable>
              ) : isGrid ? (
                <ProductCard
                  key={item.id}
                  item={item}
                  width={cardWidth}
                  qty={qtyOf(item.id)}
                  onPress={() => onAdd(item)}
                  onLongPress={() => onRemove(item)}
                />
              ) : (
                <ProductRow
                  key={item.id}
                  item={item}
                  qty={qtyOf(item.id)}
                  onPress={() => onAdd(item)}
                  onLongPress={() => onRemove(item)}
                />
              ),
            )}
            {/* Keep the last row aligned to the grid when it isn't full. */}
            {cols > 1 &&
              row.items.length < cols &&
              Array.from({ length: cols - row.items.length }).map((_, i) => (
                <View key={`spacer_${i}`} style={{ width: cardWidth }} />
              ))}
          </View>
        )}
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

/** Category filter pill. Active state fills with the category's own colour. */
function Chip({
  label,
  count,
  color,
  active,
  onPress,
}: {
  label: string;
  count: number;
  color?: string;
  active: boolean;
  onPress: () => void;
}) {
  const fill = color ?? colors.primary;
  return (
    <Pressable
      style={[styles.chip, active && { backgroundColor: fill, borderColor: fill }]}
      onPress={onPress}
      android_ripple={{ color: "#00000010" }}
    >
      {!active && color && <View style={[styles.chipDot, { backgroundColor: color }]} />}
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.chipCount, active && styles.chipCountActive]}>
        <Text style={[styles.chipCountText, active && styles.chipTextActive]}>{count}</Text>
      </View>
    </Pressable>
  );
}

function Avatar({ item, size }: { item: Item; size: number }) {
  const low = item.stockQuantity !== null && item.stockQuantity > 0 && item.stockQuantity <= 3;
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: item.categoryColor ?? colors.red500 },
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
        <Text style={[styles.title, { textAlign: "left", marginTop: 0 }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.price, { textAlign: "left", marginTop: 2 }]}>{formatMoney(item.price, item.currency)}</Text>
      </View>
      {out && <Text style={styles.rowOosText}>Out of stock</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  headerRegion: { backgroundColor: colors.primary },

  gridContent: { paddingTop: GAP, paddingBottom: 96 },
  /** One line of grid cards (or a single row in list mode). */
  gridRow: { flexDirection: "row", gap: GAP, paddingHorizontal: PAD },

  /** Horizontal category filter bar, sits directly under the search row. */
  chipBar: { backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.grey300 },
  chipBarContent: { paddingHorizontal: PAD + 4, paddingVertical: 9, gap: 7 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: colors.white,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4, color: colors.grey700 },
  chipTextActive: { color: colors.white },
  chipCount: {
    minWidth: 18,
    paddingHorizontal: 4,
    height: 17,
    borderRadius: 9,
    backgroundColor: colors.grey200,
    alignItems: "center",
    justifyContent: "center",
  },
  chipCountActive: { backgroundColor: "#FFFFFF33" },
  chipCountText: { fontSize: 10, fontWeight: "800", color: colors.grey700 },

  /** Caps category title above each group, per the app's section-title style. */
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: PAD + 4,
    paddingTop: 14,
    paddingBottom: 7,
  },
  sectionTitleArea: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 2 },
  sectionDot: { width: 9, height: 9, borderRadius: 5 },
  sectionTitle: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: colors.grey600,
  },
  sectionCount: { fontSize: 12, fontWeight: "700", color: colors.grey500 },
  addAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 13,
    backgroundColor: colors.green,
  },
  addAllText: { color: colors.white, fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },

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
  avatar: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  lowDot: { position: "absolute", top: 4, left: 4, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.white },

  /** Square zone that holds the circular avatar; overlays fill it. */
  imageZone: { alignItems: "center", justifyContent: "center", position: "relative" },
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
  oosLabelText: { color: colors.white, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
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
  countText: { color: colors.white, fontSize: 30, fontWeight: "800", textShadowColor: "#00000055", textShadowRadius: 3 },
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
  title: { fontSize: 15, color: colors.grey900, fontWeight: "700", marginTop: 10, textAlign: "center" },
  price: { fontSize: 15, color: colors.primary, fontWeight: "500", marginTop: 6, textAlign: "center" },

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
  newItemText: { color: colors.primary, fontWeight: "600", fontSize: 15, marginTop: 12, marginBottom: 8 },

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

