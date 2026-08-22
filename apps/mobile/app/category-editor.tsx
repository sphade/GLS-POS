import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, confirmDelete, formStyles } from "@/components/form";
import { swatches, useCatalog } from "@/lib/catalog";
import { useAuth } from "@/lib/auth";
import { feedbackTap } from "@/lib/feedback";

export default function CategoryEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { categories, upsertCategory, deleteCategory } = useCatalog();
  const { can } = useAuth();
  const canEdit = can("catalog:write");
  const existing = categories.find((c) => c.id === id);

  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState(existing?.color ?? swatches[0]!);

  const dirty = name.trim().length > 0 && (name !== existing?.name || color !== existing?.color);

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title={existing ? "Edit Category" : "Add Category"}
        dirty={dirty}
        onClose={() => router.back()}
        onSave={() => {
          upsertCategory({ id: existing?.id, name: name.trim(), color });
          feedbackTap();
          router.back();
        }}
        onDelete={
          existing && canEdit
            ? () =>
                confirmDelete(`category "${existing.name}"`, () => {
                  deleteCategory(existing.id);
                  feedbackTap();
                  router.back();
                })
            : undefined
        }
      />

      <ScrollView contentContainerStyle={formStyles.body}>
        <FieldCard
          label="Category Name *"
          hint="Ex: Fruits"
          value={name}
          onChangeText={setName}
          valid={name.trim().length > 0}
        />

        <View style={styles.card}>
          <Text style={styles.label}>COLOUR</Text>
          <View style={styles.swatchGrid}>
            {swatches.map((s) => (
              <Pressable
                key={s}
                style={[styles.swatch, { backgroundColor: s }, color === s && styles.swatchActive]}
                onPress={() => {
                  feedbackTap();
                  setColor(s);
                }}
              >
                {color === s && <Ionicons name="checkmark" size={20} color={colors.white} />}
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 4, padding: 12, elevation: 1 },
  label: { fontSize: 12, fontWeight: "700", color: colors.grey600, letterSpacing: 0.6, marginBottom: 10 },
  swatchGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  swatchActive: { borderWidth: 3, borderColor: colors.grey800 },
});
