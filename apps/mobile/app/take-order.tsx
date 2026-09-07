import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, formatMoney, LONG_PRESS_MS } from "@/constants/theme";
import { VariantChooser } from "@/components/VariantChooser";
import {
  cartLineKey,
  displayItemName,
  hasVariants,
  itemAvailable,
  itemDisplayPrice,
  useCartActions,
  useCartCount,
  useCartLine,
  useCartLineIds,
  useItemQty,
  type Item,
} from "@/lib/cart";
import { useCatalog } from "@/lib/catalog";
import { useAuth } from "@/lib/auth";
import { feedbackAddItem, feedbackError, feedbackTap } from "@/lib/feedback";
import { stockHintOf } from "@/lib/stock";

const CURRENT_ID = "__current_order__";
const CURRENT_LABEL = "CURRENT ORDER";
const OTHER_ID = "__other__";
const OTHER_LABEL = "OTHER";
const EMPTY_ITEMS: Item[] = [];
const RIPPLE = { color: "#00000010" };

type OrderTab = { id: string; label: string };
type CategoryPage = { id: string; items: Item[] };

/**
 * Order-taking screen reached after picking a table (SELECT CATEGORY). Tabs:
 * CURRENT ORDER first, then one per category. Swipe or tap to switch.
 *
 * On native, the pager mounts only the active page and its immediate neighbours.
 * Web keeps page bodies mounted because its ScrollView lacks reliable momentum
 * completion; every vertical page remains a FlatList, so rows are virtualized.
 *
 * The table parameter is real state, not decoration: opening a table loads
 * its running ticket into the cart, and leaving with items parks them back
 * onto the same ticket (see openTableTicket/saveTableTicket in lib/cart).
 */
export default function TakeOrderScreen() {
  const router = useRouter();
  const { table } = useLocalSearchParams<{ table?: string }>();
  const { products, categories } = useCatalog();
  const { can } = useAuth();
  const canSell = can("sale:create");
  const { add, remove, getQtyOf } = useCartActions();
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);

  const knownCategoryIds = useMemo(
    () => new Set(categories.map((category) => category.id)),
    [categories],
  );
  const hasOtherProducts = useMemo(
    () => products.some((item) => !item.categoryId || !knownCategoryIds.has(item.categoryId)),
    [products, knownCategoryIds],
  );

  // Catalog data normally loads synchronously from local SQLite. A fresh device
  // may mount before its first pull, so the page-count effect below also handles
  // the empty-to-populated transition.
  const initialPage = categories.length > 0 || hasOtherProducts ? 1 : 0;
  const [index, setIndex] = useState(initialPage);
  const initialOffset = useRef({ x: initialPage * width, y: 0 });
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  /** Item whose variant sheet is open. The sheet both adds and removes. */
  const [chooser, setChooser] = useState<Item | null>(null);

  const tabs = useMemo<OrderTab[]>(
    () => [
      { id: CURRENT_ID, label: CURRENT_LABEL },
      ...categories.map((category) => ({
        id: category.id,
        label: category.name.toUpperCase(),
      })),
      ...(hasOtherProducts ? [{ id: OTHER_ID, label: OTHER_LABEL }] : []),
    ],
    [categories, hasOtherProducts],
  );

  /**
   * Group in one catalog pass. The old code filtered the entire products array
   * once per category and also prepended an unlabelled ALL-products page. That
   * both multiplied the work and shifted every tab onto the wrong page.
   */
  const pages = useMemo<CategoryPage[]>(() => {
    const q = deferredQuery.trim().toLowerCase();
    const grouped = new Map(categories.map((category) => [category.id, [] as Item[]]));
    const other: Item[] = [];

    for (const item of products) {
      if (q && !item.name.toLowerCase().includes(q)) continue;
      const categoryItems = item.categoryId ? grouped.get(item.categoryId) : undefined;
      if (categoryItems) categoryItems.push(item);
      else other.push(item);
    }

    const result = categories.map((category) => ({
      id: category.id,
      items: grouped.get(category.id) ?? EMPTY_ITEMS,
    }));
    if (hasOtherProducts) result.push({ id: OTHER_ID, items: other });
    return result;
  }, [deferredQuery, products, categories, hasOtherProducts]);

  /** Number of sellable pages on the previous catalog update. */
  const previousPageCount = useRef(pages.length);
  /** Imperative pager state used by event handlers and catalog/width alignment. */
  const currentPage = useRef(index);
  /** Prevents late catalog arrival from overriding an explicit Current Order choice. */
  const pagerInteracted = useRef(false);
  const alignmentFrame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const mountAllPagerPages = Platform.OS === "web";

  const cancelPagerAlignment = useCallback(() => {
    if (alignmentFrame.current === null) return;
    cancelAnimationFrame(alignmentFrame.current);
    alignmentFrame.current = null;
  }, []);

  const alignPager = useCallback(
    (target: number) => {
      cancelPagerAlignment();
      alignmentFrame.current = requestAnimationFrame(() => {
        alignmentFrame.current = null;
        pagerRef.current?.scrollTo({ x: target * width, animated: false });
      });
    },
    [cancelPagerAlignment, width],
  );

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

  /** Long-press removes a simple item or reopens a variant item's chooser. */
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

  const onRemoveLine = useCallback(
    (lineId: string) => {
      if (!canSell) return;
      feedbackTap();
      remove(lineId);
    },
    [canSell, remove],
  );

  const closeChooser = useCallback(() => setChooser(null), []);
  const goBack = useCallback(() => router.back(), [router]);

  const onPagerDragStart = useCallback(() => {
    pagerInteracted.current = true;
    cancelPagerAlignment();
  }, [cancelPagerAlignment]);

  const onMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      pagerInteracted.current = true;
      cancelPagerAlignment();
      const raw = Math.round(event.nativeEvent.contentOffset.x / width);
      const next = Math.max(0, Math.min(tabs.length - 1, raw));
      if (next !== currentPage.current) {
        currentPage.current = next;
        setIndex(next);
        feedbackTap();
      }
    },
    [cancelPagerAlignment, tabs.length, width],
  );

  const goTo = useCallback(
    (requested: number) => {
      pagerInteracted.current = true;
      const target = Math.max(0, Math.min(tabs.length - 1, requested));
      feedbackTap();
      const current = currentPage.current;
      if (target === current) return;

      const adjacent = Math.abs(target - current) === 1;
      currentPage.current = target;
      setIndex(target);
      if (adjacent) {
        // The neighbour is already mounted, so the swipe animation is safe.
        cancelPagerAlignment();
        pagerRef.current?.scrollTo({ x: target * width, animated: true });
      } else {
        // Mount the distant native target first. Web keeps all bodies mounted.
        alignPager(target);
      }
    },
    [alignPager, cancelPagerAlignment, tabs.length, width],
  );

  // Catalog-count and width changes share one cancellable alignment. A fresh
  // install selects the first sellable page only if the user has not explicitly
  // chosen Current Order while the catalog was still empty.
  useEffect(() => {
    const previous = previousPageCount.current;
    previousPageCount.current = pages.length;

    const current = currentPage.current;
    const last = pages.length; // Current Order is index 0.
    const shouldSelectFirst =
      previous === 0 &&
      pages.length > 0 &&
      current === 0 &&
      !pagerInteracted.current;
    const target = shouldSelectFirst ? 1 : Math.min(current, last);

    if (target !== current) {
      currentPage.current = target;
      setIndex(target);
    }
    alignPager(target);

    return cancelPagerAlignment;
  }, [alignPager, cancelPagerAlignment, pages.length]);

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      {/* Toolbar */}
      <View style={styles.toolbar}>
        <LeaveTableButton table={table} onBack={goBack} />

        {searching ? (
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search items"
            placeholderTextColor={colors.grey500}
            autoFocus
          />
        ) : (
          <Pressable style={styles.titleWrap} onPress={() => goTo(index)}>
            <Text style={styles.title}>{table ? table.toUpperCase() : "SELECT CATEGORY"}</Text>
            <Ionicons name="caret-down" size={14} color={colors.primary} />
          </Pressable>
        )}

        <Pressable
          onPress={() => goTo(index + 1)}
          style={styles.toolbarBtn}
          hitSlop={8}
          disabled={index >= tabs.length - 1}
        >
          <Ionicons
            name="chevron-forward"
            size={22}
            color={index >= tabs.length - 1 ? colors.grey400 : colors.primary}
          />
        </Pressable>
        <Pressable
          onPress={() => {
            feedbackTap();
            setSearching((value) => !value);
            setQuery("");
          }}
          style={styles.toolbarBtn}
          hitSlop={8}
        >
          <Ionicons name={searching ? "close" : "search"} size={22} color={colors.primary} />
        </Pressable>
      </View>

      {/* Category tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsRow}
        contentContainerStyle={styles.tabsContent}
      >
        {tabs.map((tab, tabIndex) => (
          <Pressable key={tab.id} style={styles.tab} onPress={() => goTo(tabIndex)}>
            <Text style={[styles.tabText, index === tabIndex && styles.tabTextActive]}>
              {tab.label}
            </Text>
            {index === tabIndex && <View style={styles.indicator} />}
          </Pressable>
        ))}
      </ScrollView>

      {/* Swipeable pages. Native constructs only the active page and neighbours;
          web keeps every body mounted because its ScrollView does not reliably
          report momentum completion or enforce one-page momentum. Each body is
          still a virtualized FlatList. */}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        disableIntervalMomentum
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={onPagerDragStart}
        onMomentumScrollEnd={onMomentumEnd}
        contentOffset={initialOffset.current}
        style={styles.pager}
      >
        <View style={[styles.page, { width }]}>
          {mountAllPagerPages || index <= 1 ? (
            <CurrentOrderPage onAdd={onAdd} onRemoveLine={onRemoveLine} />
          ) : null}
        </View>

        {pages.map((page, pageIndex) => {
          const pagerIndex = pageIndex + 1;
          return (
            <View key={page.id} style={[styles.page, { width }]}>
              {mountAllPagerPages || Math.abs(pagerIndex - index) <= 1 ? (
                <CatalogPage items={page.items} onAdd={onAdd} onRemove={onRemove} />
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <VariantChooser item={chooser} visible={!!chooser} onClose={closeChooser} />

      {/* Review order */}
      <ReviewBar />
    </SafeAreaView>
  );
}

/** A virtualized category page; only viewport rows are mounted/subscribed. */
const CatalogPage = memo(function CatalogPage({
  items,
  onAdd,
  onRemove,
}: {
  items: Item[];
  onAdd: (item: Item) => void;
  onRemove: (item: Item) => void;
}) {
  const renderItem = useCallback(
    ({ item }: { item: Item }) => (
      <CatalogRow item={item} onAdd={onAdd} onRemove={onRemove} />
    ),
    [onAdd, onRemove],
  );

  return (
    <FlatList
      style={styles.pageList}
      data={items}
      keyExtractor={itemKey}
      renderItem={renderItem}
      contentContainerStyle={styles.pageContent}
      ListEmptyComponent={CatalogEmpty}
      keyboardShouldPersistTaps="handled"
      removeClippedSubviews
      initialNumToRender={10}
      maxToRenderPerBatch={8}
      updateCellsBatchingPeriod={40}
      windowSize={7}
    />
  );
});

const itemKey = (item: Item) => item.id;
const lineKey = (lineId: string) => lineId;

function CatalogEmpty() {
  return (
    <View style={styles.emptyWrap}>
      <Ionicons name="basket-outline" size={54} color={colors.grey400} />
      <Text style={styles.emptyText}>No items in this category</Text>
    </View>
  );
}

const CatalogRow = memo(function CatalogRow({
  item,
  onAdd,
  onRemove,
}: {
  item: Item;
  onAdd: (item: Item) => void;
  onRemove: (item: Item) => void;
}) {
  const qty = useItemQty(item.id);
  const available = itemAvailable(item);
  const displayPrice = itemDisplayPrice(item);
  const stock = stockHintOf(item);

  return (
    <Pressable
      style={[styles.itemRow, !available && styles.itemRowUnavailable]}
      onPress={() => onAdd(item)}
      onLongPress={() => onRemove(item)}
      delayLongPress={LONG_PRESS_MS}
      android_ripple={RIPPLE}
    >
      <View style={styles.itemMain}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemPrice}>
          {hasVariants(item) ? "From " : ""}
          {formatMoney(displayPrice, item.currency)}
          {!available ? " · Out of stock" : ""}
        </Text>
        {stock && (
          <Text style={[styles.itemStock, stock.low && styles.itemStockLow]} numberOfLines={1}>
            {stock.label}
          </Text>
        )}
      </View>
      <Text style={[styles.itemQty, qty > 0 && styles.itemQtyActive]}>x {qty}</Text>
    </Pressable>
  );
});

/** The CURRENT ORDER page: one virtualized live row per cart line. */
function CurrentOrderPage({
  onAdd,
  onRemoveLine,
}: {
  onAdd: (item: Item) => void;
  onRemoveLine: (lineId: string) => void;
}) {
  const lineIds = useCartLineIds();
  const data = useMemo(() => [...lineIds], [lineIds]);
  const renderItem = useCallback(
    ({ item: lineId }: { item: string }) => (
      <OrderLineRow lineId={lineId} onAdd={onAdd} onRemoveLine={onRemoveLine} />
    ),
    [onAdd, onRemoveLine],
  );

  return (
    <FlatList
      style={styles.pageList}
      data={data}
      keyExtractor={lineKey}
      renderItem={renderItem}
      contentContainerStyle={styles.pageContent}
      ListEmptyComponent={CurrentOrderEmpty}
      removeClippedSubviews
      initialNumToRender={10}
      maxToRenderPerBatch={8}
      updateCellsBatchingPeriod={40}
      windowSize={7}
    />
  );
}

function CurrentOrderEmpty() {
  return (
    <View style={styles.emptyWrap}>
      <Ionicons name="basket-outline" size={54} color={colors.grey400} />
      <Text style={styles.emptyText}>No items in this order yet</Text>
    </View>
  );
}

const OrderLineRow = memo(function OrderLineRow({
  lineId,
  onAdd,
  onRemoveLine,
}: {
  lineId: string;
  onAdd: (item: Item) => void;
  onRemoveLine: (lineId: string) => void;
}) {
  const entry = useCartLine(lineId);
  if (!entry) return null;

  return (
    <Pressable
      style={styles.itemRow}
      onPress={() => onAdd(entry.item)}
      onLongPress={() => onRemoveLine(lineId)}
      delayLongPress={LONG_PRESS_MS}
      android_ripple={RIPPLE}
    >
      <View style={styles.itemMain}>
        <Text style={styles.itemName}>{displayItemName(entry.item.name, entry.variant?.name)}</Text>
        <Text style={styles.itemPrice}>
          {formatMoney((entry.variant?.price ?? entry.item.price) * entry.qty, entry.item.currency)}
        </Text>
      </View>
      <Text style={[styles.itemQty, styles.itemQtyActive]}>x {entry.qty}</Text>
    </Pressable>
  );
});

/**
 * Toolbar back button that parks the table ticket on the way out. It reads the
 * count only when pressed, rather than re-rendering on every item tap.
 */
function LeaveTableButton({
  table,
  onBack,
}: {
  table?: string;
  onBack: () => void;
}) {
  const { getCount, saveTableTicket, abandonTableTicket } = useCartActions();

  const leave = () => {
    feedbackTap();
    if (table) {
      if (getCount() > 0) saveTableTicket();
      else abandonTableTicket();
    }
    onBack();
  };

  return (
    <Pressable onPress={leave} style={styles.toolbarBtn} hitSlop={8}>
      <Ionicons name="arrow-back" size={24} color={colors.primary} />
    </Pressable>
  );
}

/** Review bar; subscribes to the count so taps elsewhere don't rerender it. */
function ReviewBar() {
  const router = useRouter();
  const { can } = useAuth();
  const count = useCartCount();
  const canSell = can("sale:create");

  if (!canSell) {
    return (
      <View style={[styles.reviewBtn, styles.reviewDisabled]}>
        <Text style={[styles.reviewText, styles.reviewDisabledText]}>
          SALES NOT ENABLED FOR YOUR ROLE
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      style={[styles.reviewBtn, count === 0 && styles.reviewEmpty]}
      disabled={count === 0}
      onPress={() => {
        feedbackTap();
        router.push("/counter");
      }}
    >
      <Text style={styles.reviewText}>REVIEW ORDER{count > 0 ? ` (${count})` : ""}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },

  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.grey50,
    height: 56,
    paddingHorizontal: 4,
    elevation: 2,
  },
  toolbarBtn: { width: 40, alignItems: "center" },
  titleWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 18, fontWeight: "700", color: colors.primary, letterSpacing: 0.5 },
  searchInput: { flex: 1, fontSize: 16, color: colors.grey900, paddingHorizontal: 8 },

  tabsRow: { maxHeight: 46, backgroundColor: colors.white },
  tabsContent: { alignItems: "stretch" },
  tab: { paddingHorizontal: 18, height: 46, alignItems: "center", justifyContent: "center" },
  tabText: { fontSize: 14, fontWeight: "600", color: colors.grey500, letterSpacing: 0.3 },
  tabTextActive: { color: colors.grey900, fontWeight: "700" },
  indicator: {
    position: "absolute",
    bottom: 0,
    left: 10,
    right: 10,
    height: 3,
    backgroundColor: colors.primary,
  },

  pager: { flex: 1 },
  page: { flex: 1 },
  pageList: { flex: 1 },
  pageContent: { padding: 8, paddingBottom: 90, flexGrow: 1 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingBottom: 80 },
  emptyText: { color: colors.grey600, fontSize: 15 },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 3,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
    elevation: 1,
  },
  itemRowUnavailable: { opacity: 0.55 },
  itemMain: { flex: 1 },
  itemName: { fontSize: 17, color: colors.grey900, fontWeight: "500" },
  itemPrice: { fontSize: 14, color: colors.grey600, marginTop: 4 },
  /** Quieter than the name and price — a glance-check, not a headline. */
  itemStock: { fontSize: 11, fontWeight: "600", color: colors.grey500, marginTop: 3 },
  itemStockLow: { color: colors.lowStock, fontWeight: "800" },
  itemQty: { fontSize: 18, fontWeight: "700", color: colors.grey700 },
  itemQtyActive: { color: colors.primary },

  reviewBtn: {
    backgroundColor: colors.green,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  reviewDisabled: { backgroundColor: colors.grey300 },
  reviewDisabledText: { color: colors.grey600 },
  reviewEmpty: { opacity: 0.5 },
  reviewText: { color: colors.white, fontSize: 17, fontWeight: "700", letterSpacing: 0.5 },
});
