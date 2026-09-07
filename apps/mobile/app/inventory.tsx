import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { SwipeTabs } from "@/components/SwipeTabs";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import { useCatalog } from "@/lib/catalog";
import { useAuth } from "@/lib/auth";
import { feedbackTap } from "@/lib/feedback";
import { formatStockQuantity, stockSummaryOf } from "@/lib/stock";

const TABS = ["ITEMS", "CATEGORIES", "MODIFIERS", "INGREDIENTS"];

/**
 * Inventory Management hub. Four manage-mode lists behind swipeable tabs, each
 * reusing EntityListScreen + EntityRow so they look identical.
 */
export default function InventoryScreen() {
  const router = useRouter();
  const { products, categories, modifiers, ingredients } = useCatalog();
  const { can } = useAuth();
  const canAdjustStock = can("inventory:adjust");

  /** Category name per id, so an item search can also match its category. */
  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} style={styles.toolbarBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.toolbarTitle}>INVENTORY MANAGEMENT</Text>
      </View>

      <SwipeTabs
        tabs={TABS}
        scrollableTabs
        renderPage={(i) => {
          if (i === 0)
            return (
              <EntityListScreen
                embedded
                title="Items"
                data={products}
                keyExtractor={(p) => p.id}
                // Searching a category name lists everything in it, which is how
                // staff actually look for an item ("all the drinks").
                searchOf={(p) =>
                  `${p.name} ${categoryNameById.get(p.categoryId ?? "") ?? ""} ${
                    p.variants?.map((v) => v.name).join(" ") ?? ""
                  }`
                }
                emptyText="No items yet"
                addLabel="New Item"
                onAdd={() => router.push("/item-editor")}
                renderRow={(p) => {
                  const summary = stockSummaryOf(p);
                  const variantCount = p.variants?.length ?? 0;
                  const tracked = summary.targets.length > 0;
                  /**
                   * The stock number lives in the chip, so the subtitle must not
                   * repeat it — price plus variant count is what the chip can't
                   * say.
                   */
                  const subtitle = variantCount > 0
                    ? `${formatMoney(p.price, p.currency)} · ${variantCount} variant${variantCount === 1 ? "" : "s"}`
                    : formatMoney(p.price, p.currency);
                  return (
                    <EntityRow
                      initial={p.name.charAt(0).toUpperCase()}
                      color={p.categoryColor}
                      title={p.name}
                      subtitle={subtitle}
                      trailing={
                        <StockStat
                          quantity={tracked ? summary.totalQuantity : null}
                          low={summary.low}
                          out={summary.allOut}
                          enabled={canAdjustStock && tracked}
                          onPress={() =>
                            router.push({ pathname: "/update-stock", params: { productId: p.id } })
                          }
                        />
                      }
                      onPress={() => router.push({ pathname: "/item-editor", params: { id: p.id } })}
                    />
                  );
                }}
              />
            );

          if (i === 1)
            return (
              <EntityListScreen
                embedded
                title="Categories"
                data={categories}
                keyExtractor={(c) => c.id}
                searchOf={(c) => c.name}
                emptyText="No categories yet"
                addLabel="New Category"
                onAdd={() => router.push("/category-editor")}
                renderRow={(c) => (
                  <EntityRow
                    initial={c.name.charAt(0).toUpperCase()}
                    color={c.color}
                    title={c.name}
                    subtitle={`${products.filter((p) => p.categoryId === c.id).length} item(s)`}
                    onPress={() => router.push({ pathname: "/category-editor", params: { id: c.id } })}
                  />
                )}
              />
            );

          if (i === 2)
            return (
              <EntityListScreen
                embedded
                title="Modifiers"
                data={modifiers}
                keyExtractor={(m) => m.id}
                searchOf={(m) => `${m.name} ${m.options.map((o) => o.name).join(" ")}`}
                emptyText="No modifier sets yet"
                addLabel="New Modifier Set"
                onAdd={() => router.push("/modifier-editor")}
                renderRow={(m) => (
                  <EntityRow
                    initial={m.name.charAt(0).toUpperCase()}
                    color={colors.primary}
                    title={m.name}
                    subtitle={`${m.options.length} option(s) · ${m.required ? "Required" : "Optional"} · ${
                      m.multiSelect ? "Multi-select" : "Single-select"
                    }`}
                    onPress={() => router.push({ pathname: "/modifier-editor", params: { id: m.id } })}
                  />
                )}
              />
            );

          return (
            <EntityListScreen
              embedded
              title="Ingredients"
              data={ingredients}
              keyExtractor={(g) => g.id}
              searchOf={(g) => `${g.name} ${g.unit}`}
              emptyText="No ingredients yet"
              addLabel="New Ingredient"
              onAdd={() => router.push("/ingredient-editor")}
              renderRow={(g) => {
                const low = g.stock <= g.lowAt;
                return (
                  <EntityRow
                    initial={g.name.charAt(0).toUpperCase()}
                    color={low ? colors.red500 : colors.dkGreen}
                    title={g.name}
                    subtitle={`${g.stock} ${g.unit} in stock · alert below ${g.lowAt}`}
                    trailing={
                      low ? (
                        <View style={styles.lowPill}>
                          <Text style={styles.lowPillText}>LOW</Text>
                        </View>
                      ) : undefined
                    }
                    onPress={() => router.push({ pathname: "/ingredient-editor", params: { id: g.id } })}
                  />
                );
              }}
            />
          );
        }}
        onIndexChange={() => feedbackTap()}
      />
    </SafeAreaView>
  );
}

/**
 * The stock figure, and the way into the update-stock screen.
 *
 * A healthy item is plain text, not a badge: boxing every row's number turns a
 * long list into visual noise and makes the one item that's actually running out
 * no easier to spot. Only LOW and OUT get a filled pill, so the exceptions are
 * what catch the eye.
 *
 * Deliberately no edit icon. The figure itself is the tap target, and the row
 * already carries a chevron for the item editor — a second edit glyph beside it
 * only invites tapping the wrong one.
 */
function StockStat({
  quantity,
  low,
  out,
  enabled,
  onPress,
}: {
  /** null = this item does not track stock. */
  quantity: number | null;
  low: boolean;
  out: boolean;
  enabled: boolean;
  onPress: () => void;
}) {
  if (quantity === null) {
    return <Text style={styles.statUntracked}>Not tracked</Text>;
  }

  const flagged = out || low;
  const tone = out ? colors.red800 : low ? colors.red500 : colors.grey900;

  return (
    <Pressable
      style={styles.statWrap}
      disabled={!enabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Update stock. ${formatStockQuantity(quantity)} in stock`}
      onPress={(event) => {
        event.stopPropagation();
        feedbackTap();
        onPress();
      }}
    >
      <Text style={[styles.statValue, { color: tone }]}>{formatStockQuantity(quantity)}</Text>
      {flagged ? (
        <View style={[styles.statPill, { backgroundColor: out ? colors.red800 : colors.red500 }]}>
          <Text style={styles.statPillText}>{out ? "OUT" : "LOW"}</Text>
        </View>
      ) : (
        <Text style={styles.statCaption}>in stock</Text>
      )}
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
  toolbarBtn: { width: 44, alignItems: "center" },
  toolbarTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.primary, letterSpacing: 0.5 },
  statWrap: { alignItems: "flex-end", minWidth: 46, paddingRight: 6, paddingVertical: 2 },
  statValue: { fontSize: 18, fontWeight: "800" },
  statCaption: { fontSize: 10, color: colors.grey500, marginTop: 1 },
  statPill: { borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1, marginTop: 2 },
  statPillText: { fontSize: 9, fontWeight: "800", color: colors.white, letterSpacing: 0.5 },
  statUntracked: { fontSize: 11, color: colors.grey500, paddingRight: 6 },
  lowPill: { backgroundColor: colors.red500, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  lowPillText: { color: colors.white, fontSize: 10, fontWeight: "800" },
});
