import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
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
import { colors, formatMoney, LONG_PRESS_MS, strings } from "@/constants/theme";
import { PosHeader, PosSearchBar } from "@/components/PosHeader";
import { VariantChooser } from "@/components/VariantChooser";
import {
  cartLineKey,
  hasVariants,
  itemAvailable,
  itemDisplayPrice,
  useCartActions,
  useCartCount,
  useItemQty,
  type Item,
} from "@/lib/cart";
import { useCatalog } from "@/lib/catalog";
import { useAuth } from "@/lib/auth";
import { useServerRefresh } from "@/lib/sync";
import { useStore } from "@/lib/store";
import { ItemImage } from "@/components/ItemImage";
import { EmptyState } from "@/components/EmptyState";
import { warmImageCache } from "@/lib/image-store";
import { metaGet, metaSet } from "@/lib/db";
import { feedbackAddItem, feedbackError, feedbackTap } from "@/lib/feedback";

const NEW_ITEM_ID = "__new_item__";

/**
 * Grid-vs-list choice, remembered on the device.
 *
 * Lives in the `meta` table rather than component state so it survives leaving
 * the tab and restarting the app. `meta` is not a synced collection, so this
 * stays a local display preference and never travels to other tills.
 */
const LAYOUT_KEY = "items_layout";
const GAP = 6;
const PAD = 6;
/** Items with no category fall into this trailing group. */
const UNCATEGORISED = "UNCATEGORISED";

/** Sentinel for the "ALL" filter chip. */
const ALL = "__all__";

/** Hoisted so a press handler isn't handed a fresh object on every render. */
const RIPPLE = { color: "#00000010" };
const EMPTY_ITEMS: Item[] = [];
const EMPTY_ROWS: GridRow[] = [];
/** Stable, so the trailing "new item" tile's cell never remounts. */
const NEW_ITEM_ROWS: GridRow[] = [{ key: NEW_ITEM_ID, items: [{ id: NEW_ITEM_ID } as Item] }];

// Collapsing animates on Android too (no-op on iOS, which animates natively).
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** One rendered line of the grid (a single item when in list mode). */
type GridRow = { key: string; items: Item[] };

/**
 * A category's items after search + filtering, before any layout work.
 *
 * Kept separate from the laid-out section so that collapsing a category — or
 * flipping grid/list — doesn't have to redo the filtering, and so the arrays
 * below keep their identity for the memoised children that read them.
 */
type CatalogGroup = {
  /** Stable key: the category id, or the UNCATEGORISED sentinel. */
  id: string;
  title: string;
  color?: string;
  /** Every item in this group, kept even when collapsed (for the select-all box). */
  items: Item[];
  /**
   * Items the select-all box can act on: simple, in-stock products. Variant
   * products need an explicit choice, so they're never bulk-added. Computed once
   * here rather than per header render.
   */
  sellable: Item[];
};

type ItemSection = CatalogGroup & {
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

/** Element-wise identity — catalog objects are stable between renders. */
function sameItems(a: readonly Item[], b: readonly Item[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export default function ItemsScreen() {
  const router = useRouter();
  // Fast context only: stable actions + non-reactive readers. The screen must
  // NOT subscribe to cart changes, or every tap re-renders the whole grid.
  const { add, remove, getQtyOf } = useCartActions();
  const { products, categories } = useCatalog();
  const { can } = useAuth();
  const canEditCatalog = can("catalog:write");
  const canSell = can("sale:create");
  const { store } = useStore();
  const { refreshing, onRefresh } = useServerRefresh(store.id);
  const [query, setQuery] = useState("");
  /**
   * Filtering runs against the deferred value, so a keystroke paints the new
   * character straight away and the far heavier regroup-and-re-chunk of the
   * whole catalog happens in a lower-priority pass behind it. On a slow phone
   * this is the difference between a search box that types and one that fights.
   */
  const deferredQuery = useDeferredValue(query);
  // Read synchronously on first render (expo-sqlite is sync), so the saved
  // layout is correct on the very first paint with no flicker from grid to list.
  const [isGrid, setIsGrid] = useState(() => metaGet(LAYOUT_KEY) !== "list");
  /** Item whose variant sheet is open. The sheet both adds and removes. */
  const [chooser, setChooser] = useState<Item | null>(null);
  /** Which category is being viewed; ALL shows every group. */
  const [activeCat, setActiveCat] = useState<string>(ALL);
  /** Section ids the user has collapsed. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { width } = useWindowDimensions();

  const cols = isGrid ? (width > 700 ? 5 : 3) : 1;
  const cardWidth = (width - PAD * 2 - GAP * (cols - 1)) / cols;

  /** Persist alongside the state change, so the choice outlives the screen. */
  const toggleLayout = useCallback(() => {
    const next = !isGrid;
    setIsGrid(next);
    metaSet(LAYOUT_KEY, next ? "grid" : "list");
  }, [isGrid]);

  const toggleCollapse = useCallback((id: string) => {
    feedbackTap();
    // Explicit and short: the easeInEaseOut preset runs 300ms, long enough on
    // slow hardware to read as the app hesitating rather than animating.
    LayoutAnimation.configureNext({
      duration: 160,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
    });
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  /** Chips: "All" clears, tapping the active category also clears. */
  const selectCat = useCallback((id: string) => {
    feedbackTap();
    setActiveCat((prev) => (id !== ALL && prev === id ? ALL : id));
  }, []);

  const openNewItem = useCallback(() => router.push("/item-editor"), [router]);
  const openScanner = useCallback(() => router.push("/scanner"), [router]);
  const closeChooser = useCallback(() => setChooser(null), []);
  const goToCounter = useCallback(() => {
    feedbackTap();
    router.navigate("/counter");
  }, [router]);

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
   * Stage 1 — group the catalog into one group per category (in category order),
   * with any uncategorised items last. Selecting a chip narrows to that one
   * group; empty groups are hidden, so searching collapses the view to just the
   * matches. Deliberately independent of `cols` and `collapsed`, so neither
   * re-runs the filtering.
   */
  const groups = useMemo<CatalogGroup[]>(() => {
    const q = deferredQuery.trim().toLowerCase();
    const match = (i: Item) => (q ? i.name.toLowerCase().includes(q) : true);

    const build = (id: string, title: string, items: Item[], color?: string): CatalogGroup => ({
      id,
      title,
      color,
      items,
      sellable: items.filter((item) => !hasVariants(item) && itemAvailable(item)),
    });

    const grouped: CatalogGroup[] = [];
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

    return grouped;
  }, [deferredQuery, products, categories, activeCat]);

  /**
   * Rows are cached per group, keyed by the group's id and the current column
   * count. SectionList identifies a cell by the row object it was given, so
   * handing it a freshly-chunked row remounted every visible card — which meant
   * collapsing one category, or a search that only touched one group, repainted
   * the entire grid. Cached rows make those changes local.
   */
  const rowCache = useRef(new Map<string, { items: readonly Item[]; cols: number; rows: GridRow[] }>());

  /**
   * Stage 2 — lay the groups out. A collapsed section keeps its header but
   * renders no rows. The "NEW ITEM" tile trails the whole list as a headerless
   * section.
   */
  const sections = useMemo<ItemSection[]>(() => {
    const laidOut = groups.map<ItemSection>((group) => {
      const cached = rowCache.current.get(group.id);
      let rows: GridRow[];
      if (cached && cached.cols === cols && sameItems(cached.items, group.items)) {
        rows = cached.rows;
      } else {
        rows = chunk(group.items, cols);
        rowCache.current.set(group.id, { items: group.items, cols, rows });
      }
      const isCollapsed = collapsed.has(group.id);
      return {
        ...group,
        total: group.items.length,
        collapsed: isCollapsed,
        data: isCollapsed ? EMPTY_ROWS : rows,
      };
    });

    // Only roles that can edit the menu get the "new item" tile.
    if (canEditCatalog) {
      laidOut.push({
        id: NEW_ITEM_ID,
        title: "",
        total: 0,
        collapsed: false,
        items: EMPTY_ITEMS,
        sellable: EMPTY_ITEMS,
        data: NEW_ITEM_ROWS,
      });
    }

    return laidOut;
  }, [groups, cols, collapsed, canEditCatalog]);

  /**
   * Materialise image files in the background once the screen has painted, so
   * scrolling never blocks on a file write. Runs after the first frame.
   */
  useEffect(() => {
    const ids = products.filter((p) => p.hasImage).map((p) => p.id);
    if (ids.length === 0) return;
    const t = setTimeout(() => void warmImageCache(ids), 400);
    return () => clearTimeout(t);
  }, [products]);

  /**
   * Checkbox toggle: add one of each simple item, or clear them all out. Takes
   * the already-computed sellable list so this handler keeps a stable identity
   * across renders (the section objects do not).
   */
  const toggleSection = useCallback(
    (sellable: Item[]) => {
      if (!canSell || sellable.length === 0) {
        feedbackError();
        return;
      }
      const allAdded = sellable.every((item) => getQtyOf(item.id) > 0);
      if (allAdded) {
        sellable.forEach((item) => {
          for (let n = getQtyOf(item.id); n > 0; n--) remove(cartLineKey(item.id));
        });
      } else {
        sellable.forEach((item) => add(item));
      }
      feedbackAddItem();
    },
    [add, canSell, getQtyOf, remove],
  );

  /**
   * Tap handlers take the item as an argument rather than closing over it.
   *
   * That's what makes `memo` on the cards work: an inline `onPress={() =>
   * onAdd(item)}` is a new function on every parent render, so every visible
   * card re-rendered whenever anything on this screen changed — typing in
   * search, switching category, opening the variant sheet.
   */
  const onAdd = useCallback(
    (item: Item) => {
      if (!canSell || !itemAvailable(item)) {
        feedbackError();
        return;
      }
      if (hasVariants(item)) {
        feedbackTap();
        setChooser(item);
        return;
      }
      add(item);
      feedbackAddItem();
    },
    [add, canSell],
  );

  /** Long-press removes one simple item, or reopens the variant sheet. */
  const onRemove = useCallback(
    (item: Item) => {
      if (!canSell || getQtyOf(item.id) === 0) return;
      feedbackTap();
      if (hasVariants(item)) {
        setChooser(item);
        return;
      }
      remove(cartLineKey(item.id));
    },
    [canSell, getQtyOf, remove],
  );

  // Stable list callbacks. A new `renderItem` identity makes VirtualizedList
  // re-render every mounted cell, which would undo the work above.
  const keyExtractor = useCallback((row: GridRow) => row.key, []);

  const renderSectionHeader = useCallback(
    ({ section }: { section: ItemSection }) =>
      section.title ? (
        <SectionHeader
          section={section}
          onToggleCollapse={toggleCollapse}
          onToggleSection={toggleSection}
        />
      ) : null,
    [toggleCollapse, toggleSection],
  );

  const renderItem = useCallback(
    ({ item: row }: { item: GridRow }) => (
      <View style={[styles.gridRow, cols === 1 && styles.listRow]}>
        {row.items.map((item) =>
          item.id === NEW_ITEM_ID ? (
            <Pressable
              key={item.id}
              style={[styles.card, styles.newItemCard, cols > 1 ? { width: cardWidth } : undefined]}
              onPress={openNewItem}
              android_ripple={RIPPLE}
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
              onPress={onAdd}
              onLongPress={onRemove}
            />
          ) : (
            <ProductRow key={item.id} item={item} onPress={onAdd} onLongPress={onRemove} />
          ),
        )}
        {/* Keep the last row aligned to the grid when it isn't full. */}
        {cols > 1 &&
          row.items.length < cols &&
          Array.from({ length: cols - row.items.length }).map((_, i) => (
            <View key={`spacer_${i}`} style={{ width: cardWidth }} />
          ))}
      </View>
    ),
    [cardWidth, cols, isGrid, onAdd, onRemove, openNewItem],
  );

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.headerRegion}>
        <PosHeader
          title={strings.items}
          showLayoutSwitch
          isGrid={isGrid}
          onLayoutSwitch={toggleLayout}
        />
        <PosSearchBar value={query} onChangeText={setQuery} onScan={openScanner} />
      </SafeAreaView>

      {/* Category filter chips — tap one to view just that category. */}
      <View style={styles.chipBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipBarContent}
        >
          <CategoryTab id={ALL} label="All" active={activeCat === ALL} onPress={selectCat} />
          {categories.map((c) => (
            <CategoryTab
              key={c.id}
              id={c.id}
              label={c.name}
              color={c.color}
              active={activeCat === c.id}
              onPress={selectCat}
            />
          ))}
          {(counts.get(UNCATEGORISED) ?? 0) > 0 && (
            <CategoryTab
              id={UNCATEGORISED}
              label="Other"
              active={activeCat === UNCATEGORISED}
              onPress={selectCat}
            />
          )}
        </ScrollView>
      </View>

      <SectionList
        key={`cols-${cols}`}
        sections={sections}
        keyExtractor={keyExtractor}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.gridContent}
        // Windowing: render a screenful first, then fill in while scrolling.
        // NOTE: removeClippedSubviews is deliberately OFF. On Android it
        // detaches nested subviews and blanks out row content (both the image
        // and the name/price) in a grid built from nested flex rows.
        removeClippedSubviews={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={11}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={{ paddingTop: 80 }}>
            <EmptyState
              text={
                canEditCatalog
                  ? "No items yet.\nCreate your first item below, or pull down to sync."
                  : "No items yet.\nPull down to sync, or ask an owner to add the menu."
              }
              size={120}
            />
          </View>
        }
        renderSectionHeader={renderSectionHeader}
        renderItem={renderItem}
      />

      <GoToCounterBar onPress={goToCounter} />

      <VariantChooser item={chooser} visible={!!chooser} onClose={closeChooser} />
    </View>
  );
}

/**
 * Category filter as an underlined text tab, matching how food apps (foodpanda,
 * Keeta, Wolt) present menu categories: plain label, bold + underlined when
 * active. The underline picks up the category's own colour when it has one.
 */
const CategoryTab = memo(function CategoryTab({
  id,
  label,
  color,
  active,
  onPress,
}: {
  id: string;
  label: string;
  color?: string;
  active: boolean;
  onPress: (id: string) => void;
}) {
  return (
    <Pressable style={styles.catTab} onPress={() => onPress(id)} android_ripple={CHIP_RIPPLE}>
      <Text style={[styles.catTabText, active && styles.catTabTextActive]} numberOfLines={1}>
        {label}
      </Text>
      {active && <View style={[styles.catTabIndicator, { backgroundColor: color ?? colors.primary }]} />}
    </Pressable>
  );
});

const CHIP_RIPPLE = { color: "#00000008" };

/**
 * Category band above each group. The whole white strip toggles
 * collapse/expand; the checkbox is a nested Pressable so tapping it doesn't also
 * collapse. Memoised because it re-renders on every section rebuild otherwise.
 */
const SectionHeader = memo(function SectionHeader({
  section,
  onToggleCollapse,
  onToggleSection,
}: {
  section: ItemSection;
  onToggleCollapse: (id: string) => void;
  onToggleSection: (sellable: Item[]) => void;
}) {
  return (
    <Pressable
      style={styles.sectionHeader}
      onPress={() => onToggleCollapse(section.id)}
      android_ripple={RIPPLE}
    >
      <View style={styles.sectionTitleArea}>
        <Ionicons
          name={section.collapsed ? "chevron-forward" : "chevron-down"}
          size={18}
          color={colors.grey700}
        />
        <Text style={styles.sectionTitle} numberOfLines={1}>
          {section.title}
        </Text>
        <Text style={styles.sectionCount}>({section.total})</Text>
      </View>

      {/* Adds one of each item in this category, or clears them. Variant items
          are left out — they need an explicit choice. */}
      {section.sellable.length > 0 && (
        <SectionSelectAll items={section.sellable} onToggle={onToggleSection} />
      )}
    </Pressable>
  );
});

function Avatar({ item, size }: { item: Item; size: number }) {
  const threshold = item.lowStockAt ?? 3;
  const low = item.stockQuantity !== null && item.stockQuantity > 0 && item.stockQuantity <= threshold;
  return (
    <View style={{ width: size, height: size }}>
      <ItemImage
        productId={item.id}
        name={item.name}
        size={size}
        color={item.categoryColor ?? colors.red500}
        hasImage={!!item.hasImage}
        remoteUrl={item.imageUrl}
      />
      {low && <View style={styles.lowDot} />}
    </View>
  );
}

/**
 * Select-all checkbox for a category. Subscribes to just its own items'
 * quantities, so its checked state stays live without the whole Items screen
 * re-rendering on every cart change.
 */
const SectionSelectAll = memo(function SectionSelectAll({
  items,
  onToggle,
}: {
  items: Item[];
  onToggle: (items: Item[]) => void;
}) {
  const { subscribeToProduct, getQtyOf } = useCartActions();
  const productIds = useMemo(() => items.map((item) => item.id), [items]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribers = productIds.map((productId) =>
        subscribeToProduct(productId, listener),
      );
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    },
    [productIds, subscribeToProduct],
  );
  const getSnapshot = useCallback(
    () => productIds.length > 0 && productIds.every((productId) => getQtyOf(productId) > 0),
    [productIds, getQtyOf],
  );
  const allAdded = useSyncExternalStore(subscribe, getSnapshot);
  return (
    <Pressable
      style={styles.sectionCheck}
      hitSlop={8}
      onPress={() => onToggle(items)}
      android_ripple={CHECK_RIPPLE}
    >
      <Ionicons
        name={allAdded ? "checkbox" : "square-outline"}
        size={24}
        color={allAdded ? colors.primary : colors.grey500}
      />
    </Pressable>
  );
});

const CHECK_RIPPLE = { color: "#00000010", borderless: true };

/**
 * The floating "Go To Counter" bar. Subscribes to the cart count on its own so
 * a tap doesn't re-render the item grid above it.
 */
function GoToCounterBar({ onPress }: { onPress: () => void }) {
  const count = useCartCount();
  if (count === 0) return null;
  return (
    <Pressable style={styles.goToCounter} onPress={onPress}>
      <Text style={styles.goToCounterText}>{strings.goToCounter}</Text>
      <View style={styles.goBadge}>
        <Text style={styles.goBadgeText}>{count}</Text>
      </View>
    </Pressable>
  );
}

/**
 * Memoised so adding one item to the cart doesn't re-render (and re-decode the
 * image of) every other tile in the grid.
 */
const ProductCard = memo(function ProductCard({
  item,
  width,
  onPress,
  onLongPress,
}: {
  item: Item;
  width: number;
  /** Takes the item, so the parent can hand down one stable function. */
  onPress: (item: Item) => void;
  onLongPress: (item: Item) => void;
}) {
  // Subscribes to just this product's quantity, so a tap re-renders only the
  // tile that changed rather than the whole grid.
  const qty = useItemQty(item.id);
  const circle = Math.min(width - 28, 78);
  const out = !itemAvailable(item);
  const displayPrice = itemDisplayPrice(item);
  // Band spans the full card width but only the image area's height (+ padding).
  const bandHeight = circle + 20;
  return (
    <Pressable
      style={[styles.card, { width }]}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      delayLongPress={LONG_PRESS_MS}
      android_ripple={RIPPLE}
    >
      <View style={[styles.imageZone, { width: circle, height: circle }]}>
        <Avatar item={item} size={circle} />
      </View>

      {/* Deliberately unclamped: supplier names like "MOBIL SUPER 3000 X1 5W-40
          GSP 4X5L NG" are unreadable truncated, and the row container stretches
          its cards to the tallest, so wrapping can't stagger the grid. */}
      <Text style={styles.title}>{item.name}</Text>
      <Text style={styles.price} numberOfLines={1}>
        {hasVariants(item) ? "From " : ""}{formatMoney(displayPrice, item.currency)}
      </Text>

      {/* Full-width band over the image area only — leaves name/price clear */}
      {out && (
        <View pointerEvents="none" style={[styles.oosBand, { height: bandHeight }]}>
          <View style={styles.oosLabel}>
            <Text style={styles.oosLabelText}>OUT OF STOCK</Text>
          </View>
        </View>
      )}
      {qty > 0 && !out && (
        <View pointerEvents="none" style={[styles.countBand, { height: bandHeight }]}>
          <Text style={styles.countText}>x{qty}</Text>
        </View>
      )}
    </Pressable>
  );
});

const ProductRow = memo(function ProductRow({
  item,
  onPress,
  onLongPress,
}: {
  item: Item;
  onPress: (item: Item) => void;
  onLongPress: (item: Item) => void;
}) {
  const qty = useItemQty(item.id);
  const out = !itemAvailable(item);
  const displayPrice = itemDisplayPrice(item);
  return (
    <Pressable
      style={styles.row}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      delayLongPress={LONG_PRESS_MS}
      android_ripple={RIPPLE}
    >
      <View style={styles.rowThumb}>
        <Avatar item={item} size={46} />
        {out && (
          <View pointerEvents="none" style={[styles.oosZone, { borderRadius: 6 }]}>
            <Text style={styles.oosThumbText}>OOS</Text>
          </View>
        )}
        {qty > 0 && !out && (
          <View pointerEvents="none" style={[styles.countZone, { borderRadius: 6 }]}>
            <Text style={styles.countThumbText}>x{qty}</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { textAlign: "left", marginTop: 0 }]}>
          {item.name}
        </Text>
        <Text style={[styles.price, { textAlign: "left", marginTop: 2 }]}>
          {hasVariants(item) ? "From " : ""}{formatMoney(displayPrice, item.currency)}
        </Text>
      </View>
      {out && <Text style={styles.rowOosText}>Out of stock</Text>}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  headerRegion: { backgroundColor: colors.primary },

  gridContent: { paddingTop: GAP, paddingBottom: 96 },
  /** One line of grid cards (or a single row in list mode). */
  gridRow: { flexDirection: "row", gap: GAP, paddingHorizontal: PAD },
  /** List mode has one item per line, so the row stacks instead of spanning. */
  listRow: { flexDirection: "column", gap: 0 },

  /** Horizontal category tab bar, sits directly under the search row. */
  chipBar: { backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.grey200 },
  chipBarContent: { paddingHorizontal: PAD + 2, alignItems: "flex-end" },
  catTab: { height: 46, paddingHorizontal: 14, justifyContent: "center", alignItems: "center" },
  catTabText: { fontSize: 14, fontWeight: "600", letterSpacing: 0.2, color: colors.grey500 },
  catTabTextActive: { color: colors.grey900, fontWeight: "800" },
  catTabIndicator: {
    position: "absolute",
    bottom: 0,
    left: 10,
    right: 10,
    height: 3,
    borderRadius: 2,
  },

  /** Caps category title above each group, per the app's section-title style. */
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.white,
    paddingHorizontal: PAD + 10,
    paddingVertical: 16,
    marginTop: 8,
    marginBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey200,
  },
  sectionTitleArea: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  sectionTitle: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
    color: colors.grey900,
  },
  sectionCount: { fontSize: 13, fontWeight: "600", color: colors.grey500, marginLeft: 2 },
  sectionCheck: { paddingLeft: 8, paddingVertical: 2 },

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
  avatarInitial: { color: colors.white, fontWeight: "800" },
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
  /**
   * Shared by the grid card and the list row. Eased down from 15/700 because the
   * name now wraps instead of truncating: at the old size and weight a
   * three-line name dominated the card and read as shouting.
   */
  title: {
    fontSize: 14,
    color: colors.grey900,
    fontWeight: "600",
    // Without this, wrapped lines sit too close to be comfortably scannable.
    lineHeight: 18,
    marginTop: 10,
    textAlign: "center",
  },
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

