import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { SwipeTabs } from "@/components/SwipeTabs";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import { useCatalog } from "@/lib/catalog";
import { feedbackTap } from "@/lib/feedback";

const TABS = ["ITEMS", "CATEGORIES", "MODIFIERS", "INGREDIENTS"];

/**
 * Inventory Management hub. Four manage-mode lists behind swipeable tabs, each
 * reusing EntityListScreen + EntityRow so they look identical.
 */
export default function InventoryScreen() {
  const router = useRouter();
  const { products, categories, modifiers, ingredients } = useCatalog();

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
                searchOf={(p) => p.name}
                emptyText="No items yet"
                addLabel="New Item"
                onAdd={() => router.push("/item-editor")}
                renderRow={(p) => {
                  const tracked = p.stockQuantity !== null;
                  const low = tracked && p.stockQuantity! <= (p.lowStockAt ?? 3);
                  const out = tracked && p.stockQuantity === 0;
                  return (
                    <EntityRow
                      initial={p.name.charAt(0).toUpperCase()}
                      color={p.categoryColor}
                      title={p.name}
                      subtitle={`${formatMoney(p.price, p.currency)}${
                        tracked ? ` · stock ${p.stockQuantity}` : " · no stock tracking"
                      }`}
                      trailing={
                        out ? (
                          <View style={[styles.lowPill, { backgroundColor: colors.grey600 }]}>
                            <Text style={styles.lowPillText}>OUT</Text>
                          </View>
                        ) : low ? (
                          <View style={styles.lowPill}>
                            <Text style={styles.lowPillText}>LOW</Text>
                          </View>
                        ) : undefined
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
                searchOf={(m) => m.name}
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
              searchOf={(g) => g.name}
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
  lowPill: { backgroundColor: colors.red500, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  lowPillText: { color: colors.white, fontSize: 10, fontWeight: "800" },
});
