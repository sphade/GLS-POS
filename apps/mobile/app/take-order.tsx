import { useMemo, useRef, useState } from "react";
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
  cartLineKey,
  hasVariants,
  itemAvailable,
  itemDisplayPrice,
  useCart,
  type Item,
} from "@/lib/cart";
import { useCatalog } from "@/lib/catalog";
import { feedbackAddItem, feedbackError, feedbackTap } from "@/lib/feedback";

const CURRENT = "CURRENT ORDER";

/**
 * Order-taking screen reached after picking a table (SELECT CATEGORY).
 * Tabs: CURRENT ORDER first, then one per category. Swipe or tap to switch.
 * Tapping a row adds one; the trailing "x N" shows the running quantity.
 */
export default function TakeOrderScreen() {
  const router = useRouter();
  const { table } = useLocalSearchParams<{ table?: string }>();
  const { add, remove, qtyOf, count } = useCart();
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
    const inOrder = products.filter((i) => qtyOf(i.id) > 0 && match(i));
    const byCategory = categories.map((c) => products.filter((i) => i.categoryId === c.id && match(i)));
    return [inOrder, ...byCategory];
  }, [query, qtyOf, products, categories]);

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

  const onAdd = (item: Item) => {
    if (!itemAvailable(item)) {
      feedbackError();
      return;
    }
    if (hasVariants(item)) {
      feedbackTap();
      setChooser(item);
      return;
    }
    feedbackAddItem();
    add(item);
  };

  const onRemove = (item: Item) => {
    if (qtyOf(item.id) === 0) return;
    feedbackTap();
    if (hasVariants(item)) {
      setChooser(item);
      return;
    }
    remove(cartLineKey(item.id));
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      {/* Toolbar */}
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} style={styles.toolbarBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </Pressable>

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
            <Text style={styles.title}>SELECT CATEGORY</Text>
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
        {pages.map((items, i) => (
          <View key={tabs[i]} style={{ width }}>
            {items.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="basket-outline" size={54} color={colors.grey400} />
                <Text style={styles.emptyText}>
                  {i === 0 ? "No items in this order yet" : "No items in this category"}
                </Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 8, paddingBottom: 90 }}>
                {items.map((item) => {
                  const qty = qtyOf(item.id);
                  const available = itemAvailable(item);
                  const displayPrice = itemDisplayPrice(item);
                  return (
                    <Pressable
                      key={item.id}
                      style={[styles.itemRow, !available && styles.itemRowUnavailable]}
                      onPress={() => onAdd(item)}
                      onLongPress={() => onRemove(item)}
                      android_ripple={{ color: "#00000010" }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        <Text style={styles.itemPrice}>
                          {hasVariants(item) ? "From " : ""}{formatMoney(displayPrice, item.currency)}
                          {!available ? " · Out of stock" : ""}
                        </Text>
                      </View>
                      <Text style={[styles.itemQty, qty > 0 && { color: colors.primary }]}>x {qty}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        ))}
      </ScrollView>

      <VariantChooser item={chooser} visible={!!chooser} onClose={() => setChooser(null)} />

      {/* Review order */}
      <Pressable
        style={[styles.reviewBtn, count === 0 && { opacity: 0.5 }]}
        disabled={count === 0}
        onPress={() => {
          feedbackTap();
          router.push("/counter");
        }}
      >
        <Text style={styles.reviewText}>REVIEW ORDER</Text>
      </Pressable>
    </SafeAreaView>
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

