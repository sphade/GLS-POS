import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, formStyles } from "@/components/form";
import { useCatalog } from "@/lib/catalog";
import { feedbackTap } from "@/lib/feedback";

const UNITS = ["kg", "g", "ltr", "ml", "pcs", "pack", "crate"];

export default function IngredientEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { ingredients, upsertIngredient, deleteIngredient } = useCatalog();
  const existing = ingredients.find((i) => i.id === id);

  const [name, setName] = useState(existing?.name ?? "");
  const [unit, setUnit] = useState(existing?.unit ?? "kg");
  const [stock, setStock] = useState(existing ? String(existing.stock) : "");
  const [lowAt, setLowAt] = useState(existing ? String(existing.lowAt) : "5");
  const [touched, setTouched] = useState(false);

  const dirty = name.trim().length > 0 && (touched || name !== existing?.name);

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title={existing ? "Edit Ingredient" : "Add Ingredient"}
        dirty={dirty}
        onClose={() => router.back()}
        onSave={() => {
          upsertIngredient({
            id: existing?.id,
            name: name.trim(),
            unit,
            stock: parseFloat(stock) || 0,
            lowAt: parseFloat(lowAt) || 0,
          });
          feedbackTap();
          router.back();
        }}
        onDelete={
          existing
            ? () => {
                deleteIngredient(existing.id);
                feedbackTap();
                router.back();
              }
            : undefined
        }
      />

      <ScrollView contentContainerStyle={formStyles.body}>
        <FieldCard
          label="Ingredient Name *"
          hint="Ex: Rice"
          value={name}
          onChangeText={(t) => {
            setName(t);
            setTouched(true);
          }}
          valid={name.trim().length > 0}
        />

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>UNIT OF MEASURE</Text>
          <View style={styles.chipRow}>
            {UNITS.map((u) => (
              <Pressable
                key={u}
                style={[styles.chip, unit === u && styles.chipActive]}
                onPress={() => {
                  feedbackTap();
                  setUnit(u);
                  setTouched(true);
                }}
              >
                <Text style={[styles.chipText, unit === u && { color: colors.white }]}>{u}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <FieldCard
          label={`Stock Available (${unit})`}
          hint="0"
          value={stock}
          onChangeText={(t) => {
            setStock(t);
            setTouched(true);
          }}
          keyboardType="numeric"
          showTick={false}
        />
        <FieldCard
          label={`Low Stock Alert (${unit})`}
          hint="5"
          value={lowAt}
          onChangeText={(t) => {
            setLowAt(t);
            setTouched(true);
          }}
          keyboardType="numeric"
          showTick={false}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 4, padding: 12, marginBottom: 8, elevation: 1 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.grey600, letterSpacing: 0.6, marginBottom: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.grey400,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.grey700 },
});
