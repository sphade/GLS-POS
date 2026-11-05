import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { RecipeLine } from "@gls-pos/types";
import { colors } from "@/constants/theme";
import { FeatureCard } from "@/components/form";
import { PickerSheet } from "@/components/PickerSheet";
import { useCatalog } from "@/lib/catalog";
import { feedbackTap } from "@/lib/feedback";
import { formatQty } from "@/lib/stock-units";

/**
 * The ingredients one unit of a menu item uses, e.g. 250 g rice + 20 ml oil
 * per plate. The server takes these out of the shop's ingredient stock on every
 * sale, so the Stock Room and the till can never disagree. Amounts are typed in
 * the base unit (g, ml, pcs) because portions are small numbers.
 */
export function RecipeCard({
  recipe,
  onChange,
}: {
  recipe: RecipeLine[];
  onChange: (next: RecipeLine[]) => void;
}) {
  const { ingredients } = useCatalog();
  const [open, setOpen] = useState(recipe.length > 0);
  const [picking, setPicking] = useState(false);
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const available = ingredients.filter((i) => !recipe.some((r) => r.ingredientId === i.id));

  return (
    <FeatureCard
      icon="flask-outline"
      label="Recipe (uses ingredients)"
      on={open}
      onToggle={(next) => {
        setOpen(next);
        if (!next) onChange([]);
      }}
    >
      {recipe.map((line, index) => {
        const ing = byId.get(line.ingredientId);
        return (
          <View key={line.ingredientId} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{ing?.name ?? "Removed ingredient"}</Text>
              {ing ? <Text style={styles.sub}>{formatQty(ing.stock, ing.unit)} in stock</Text> : null}
            </View>
            <TextInput
              style={styles.qty}
              keyboardType="number-pad"
              value={line.qty ? String(line.qty) : ""}
              placeholder="0"
              onChangeText={(t) => {
                const qty = Math.max(0, Math.round(Number(t.replace(/[^0-9]/g, "")) || 0));
                onChange(recipe.map((r, i) => (i === index ? { ...r, qty } : r)));
              }}
            />
            <Text style={styles.unit}>{ing?.unit ?? ""}</Text>
            <Pressable
              hitSlop={8}
              onPress={() => {
                feedbackTap();
                onChange(recipe.filter((_, i) => i !== index));
              }}
            >
              <Ionicons name="close-circle" size={22} color={colors.grey500} />
            </Pressable>
          </View>
        );
      })}

      {ingredients.length === 0 ? (
        <Text style={styles.hint}>Add ingredients under Inventory ▸ Ingredients first.</Text>
      ) : available.length > 0 ? (
        <Pressable
          style={styles.add}
          onPress={() => {
            feedbackTap();
            setPicking(true);
          }}
        >
          <Ionicons name="add" size={18} color={colors.primary} />
          <Text style={styles.addText}>Add ingredient</Text>
        </Pressable>
      ) : null}
      <Text style={styles.hint}>Amounts are per one item sold. Stock goes down with every sale.</Text>

      <PickerSheet
        visible={picking}
        title="Ingredient"
        options={available.map((i) => ({ id: i.id, label: i.name, hint: formatQty(i.stock, i.unit) }))}
        onPick={(id) => {
          onChange([...recipe, { ingredientId: id, qty: 0 }]);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </FeatureCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  name: { fontSize: 14, fontWeight: "600", color: colors.grey900 },
  sub: { fontSize: 11, color: colors.grey500, marginTop: 1 },
  qty: {
    width: 72,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 15,
    textAlign: "right",
    color: colors.grey900,
  },
  unit: { width: 28, fontSize: 13, color: colors.grey600 },
  add: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 10 },
  addText: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  hint: { fontSize: 12, color: colors.grey500, marginTop: 4 },
});
