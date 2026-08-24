import { memo, useMemo, useRef, useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
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
import { colors, formatMoney } from "@/constants/theme";
import { VariantChooser } from "@/components/VariantChooser";
import {
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

const CURRENT = "CURRENT ORDER";

/**
 * Order-taking screen reached after picking a table (SELECT CATEGORY). Tabs:
 * CURRENT ORDER first, then one per category. Swipe or tap to switch.
 *
 * Like the Items grid and Counter, this screen never subscribes to the whole
 * cart: each row tracks its own quantity, the CURRENT ORDER page tracks the
 * line list, and the review bar tracks the count — so a tap re-renders only
 * what changed.
 *
 * The table parameter is real state, not decoration: opening a table loads
 * its running ticket into the cart, and leaving with items parks them back
 * onto the same ticket (see openTableTicket/saveTableTicket in lib/cart).
 */
export default function TakeOrderScreen() {
  const router = useRouter();
  const { table } = useLocalSearchParams<{ table?: string }>();
  const { products, categories } = useCatalog();
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);

  const [index, setIndex] = useState(1); // start on the first category
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  /** Item whose variant sheet is open. The sheet both adds and removes. */
  const [chooser, setChooser] = useState<Item | null>(null);

  const tabs = useMemo(() => [CURRENT, ...categories.map((c) => c.name.toUpperCase())], [categories]);

  const pages = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (i: Item) => (q ? i.name.toLowerCase().includes(q) : true);
    const byCategory = categories.map((c) => products.filter((i) => i.categoryId === c.id && match(i)));
    return [products.filter(match), ...byCategory];
  }, [query, products, categories]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) {
      setIndex(i);
      feedbackTap();
    }
  };

  const goTo = (i: number) => {
    feedbackTap();
    setIndex(i);
    pagerRef.current?.scrollTo({ x: i * width, animated: true });
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      {/* Toolbar */}
      <View style={styles.toolbar}>
        <LeaveTableButton table={table} onBack={() => router.back()} />

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

        <Pressable onPress={() => goTo(Math.min(tabs.length - 1, index + 1))} style={styles.toolbarBtn} hitSlop={8}>
          <Ionicons name="chevron-forward" size={22} color={colors.primary} />
        </Pressable>
        <Pressable
          onPress={() => {
            feedbackTap();
            setSearching((v) => !v);
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
        {tabs.map((t, i) => (
          <Pressable key={t} style={styles.tab} onPress={() => goTo(i)}>
            <Text style={[styles.tabText, index === i && styles.tabTextActive]}>{t}</Text>
            {index === i && <View style={styles.indicator} />}
          </Pressable>
        ))}
      </ScrollView>

      {/* Swipeable pages */}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        contentOffset={{ x: width, y: 0 }}
        style={{ flex: 1 }}
      >
        <View style={{ width }}>
          <CurrentOrderPage onChoose={setChooser} />
        </View>
        {pages.map((items, i) => (
          <View key={tabs[i + 1]} style={{ width }}>
            {items.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="basket-outline" size={54} color={colors.grey400} />
                <Text style={styles.emptyText}>No items in this category</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 8, paddingBottom: 90 }}>
                {items.map((item) => (
                  <CatalogRow key={item.id} item={item} onChoose={setChooser} />
                ))}
              </ScrollView>
            )}
          </View>
        ))}
      </ScrollView>

      <VariantChooser item={chooser} visible={!!chooser} onClose={() => setChooser(null)} />

      {/* Review order */}
      <ReviewBar />
    </SafeAreaView>
  );
}

/** Add-to-cart with variant routing; every caller shares the permission gate. */
function useAddToCart(onChoose: (item: Item) => void) {
  const { can } = useAuth();
  const canSell = can("sale:create");
  const { add } = useCartActions();

  return (item: Item) => {
    if (!canSell) {
      feedbackError();
      return;
    }
    if (!itemAvailable(item)) {
      feedbackError();
      return;
    }
    if (hasVariants(item)) {
      feedbackTap();
      onChoose(item);
      return;
    }
    feedbackAddItem();
    add(item);
  };
}

const CatalogRow = memo(function CatalogRow({
  item,
  onChoose,
}: {
  item: Item;
  onChoose: (item: Item) => void;
}) {
  const qty = useItemQty(item.id);
  const { can } = useAuth();
  const canSell = can("sale:create");
  const { remove } = useCartActions();
  const addToCart = useAddToCart(onChoose);

  const available = itemAvailable(item);
  const displayPrice = itemDisplayPrice(item);

  const onRemove = () => {
    if (!canSell || !available || qty === 0 || hasVariants(item)) return;
    feedbackTap();
    remove(`${item.id}`);
  };

  return (
    <Pressable
      style={[styles.itemRow, !available && styles.itemRowUnavailable]}
      onPress={() => addToCart(item)}
      onLongPress={onRemove}
      android_ripple={{ color: "#00000010" }}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemPrice}>
          {hasVariants(item) ? "From " : ""}
          {formatMoney(displayPrice, item.currency)}
          {!available ? " · Out of stock" : ""}
        </Text>
      </View>
      <Text style={[styles.itemQty, qty > 0 && { color: colors.primary }]}>x {qty}</Text>
    </Pressable>
  );
});

/** The CURRENT ORDER page: one live row per cart line. */
function CurrentOrderPage({ onChoose }: { onChoose: (item: Item) => void }) {
  const lineIds = useCartLineIds();

  if (lineIds.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Ionicons name="basket-outline" size={54} color={colors.grey400} />
        <Text style={styles.emptyText}>No items in this order yet</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 8, paddingBottom: 90 }}>
      {lineIds.map((lineId) => (
        <OrderLineRow key={lineId} lineId={lineId} onChoose={onChoose} />
      ))}
    </ScrollView>
  );
}

const OrderLineRow = memo(function OrderLineRow({
  lineId,
  onChoose,
}: {
  lineId: string;
  onChoose: (item: Item) => void;
}) {
  const entry = useCartLine(lineId);
  const addToCart = useAddToCart(onChoose);
  const { can } = useAuth();
  const canSell = can("sale:create");
  const { remove } = useCartActions();

  if (!entry) return null;

  return (
    <Pressable
      style={styles.itemRow}
      onPress={() => addToCart(entry.item)}
      onLongPress={canSell ? () => remove(lineId) : undefined}
      delayLongPress={250}
      android_ripple={{ color: "#00000010" }}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.itemName}>{displayItemName(entry.item.name, entry.variant?.name)}</Text>
        <Text style={styles.itemPrice}>
          {formatMoney((entry.variant?.price ?? entry.item.price) * entry.qty, entry.item.currency)}
        </Text>
      </View>
      <Text style={[styles.itemQty, { color: colors.primary }]}>x {entry.qty}</Text>
    </Pressable>
  );
});

/**
 * Toolbar back button that parks the table ticket on the way out: items stay
 * on the table's running bill; an emptied bill frees the table. Without a
 * table (deep link) it simply goes back and leaves the cart alone.
 */
function LeaveTableButton({
  table,
  onBack,
}: {
  table?: string;
  onBack: () => void;
}) {
  const count = useCartCount();
  const { saveTableTicket, abandonTableTicket } = useCartActions();

  const leave = () => {
    feedbackTap();
    if (table) {
      if (count > 0) saveTableTicket();
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
      <View style={[styles.reviewBtn, { backgroundColor: colors.grey300 }]}>
        <Text style={[styles.reviewText, { color: colors.grey600 }]}>SALES NOT ENABLED FOR YOUR ROLE</Text>
      </View>
    );
  }

  return (
    <Pressable
      style={[styles.reviewBtn, count === 0 && { opacity: 0.5 }]}
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
  indicator: { position: "absolute", bottom: 0, left: 10, right: 10, height: 3, backgroundColor: colors.primary },

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
  itemName: { fontSize: 17, color: colors.grey900, fontWeight: "500" },
  itemPrice: { fontSize: 14, color: colors.grey600, marginTop: 4 },
  itemQty: { fontSize: 18, fontWeight: "700", color: colors.grey700 },

  reviewBtn: {
    backgroundColor: colors.green,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  reviewText: { color: colors.white, fontSize: 17, fontWeight: "700", letterSpacing: 0.5 },
});
