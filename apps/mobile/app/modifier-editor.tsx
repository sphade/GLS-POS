import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, currencySymbol } from "@/constants/theme";
import { EditorToolbar, FieldCard, ToggleRow, confirmDelete, formStyles } from "@/components/form";
import { useCatalog, type ModifierOption } from "@/lib/catalog";
import { useAuth } from "@/lib/auth";
import { feedbackTap } from "@/lib/feedback";

const SYM = currencySymbol("NGN");

export default function ModifierEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { modifiers, upsertModifier, deleteModifier } = useCatalog();
  const { can } = useAuth();
  const canEdit = can("catalog:write");
  const existing = modifiers.find((m) => m.id === id);

  const [name, setName] = useState(existing?.name ?? "");
  const [required, setRequired] = useState(existing?.required ?? false);
  const [multiSelect, setMultiSelect] = useState(existing?.multiSelect ?? true);
  const [options, setOptions] = useState<ModifierOption[]>(existing?.options ?? []);
  const [touched, setTouched] = useState(false);

  const dirty = name.trim().length > 0 && (touched || name !== existing?.name);

  const updateOption = (i: number, patch: Partial<ModifierOption>) => {
    setTouched(true);
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title={existing ? "Edit Modifier Set" : "Add Modifier Set"}
        dirty={dirty}
        onClose={() => router.back()}
        onSave={() => {
          upsertModifier({ id: existing?.id, name: name.trim(), required, multiSelect, options });
          feedbackTap();
          router.back();
        }}
        onDelete={
          existing && canEdit
            ? () =>
                confirmDelete(`modifier set "${existing.name}"`, () => {
                  deleteModifier(existing.id);
                  feedbackTap();
                  router.back();
                })
            : undefined
        }
      />

      <ScrollView contentContainerStyle={formStyles.body}>
        <FieldCard
          label="Modifier Set Name *"
          hint="Ex: Add-ons"
          value={name}
          onChangeText={(t) => {
            setName(t);
            setTouched(true);
          }}
          valid={name.trim().length > 0}
        />

        <View style={styles.card}>
          <ToggleRow
            label="Required (customer must choose)"
            value={required}
            onValueChange={(v) => {
              setRequired(v);
              setTouched(true);
            }}
          />
          <ToggleRow
            label="Allow multiple selections"
            value={multiSelect}
            onValueChange={(v) => {
              setMultiSelect(v);
              setTouched(true);
            }}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>OPTIONS</Text>

          {options.length === 0 && <Text style={styles.emptyText}>No options yet. Add one below.</Text>}

          {options.map((o, i) => (
            <View key={o.id} style={styles.optionRow}>
              <TextInput
                style={styles.optionName}
                value={o.name}
                onChangeText={(t) => updateOption(i, { name: t })}
                placeholder="Option name"
                placeholderTextColor={colors.hint}
              />
              <View style={styles.priceWrap}>
                <Text style={styles.priceSym}>{SYM}</Text>
                <TextInput
                  style={styles.optionPrice}
                  value={o.price ? String(o.price / 100) : ""}
                  onChangeText={(t) => updateOption(i, { price: Math.round((parseFloat(t) || 0) * 100) })}
                  placeholder="0"
                  placeholderTextColor={colors.hint}
                  keyboardType="numeric"
                />
              </View>
              <Pressable
                onPress={() => {
                  feedbackTap();
                  setTouched(true);
                  setOptions((prev) => prev.filter((_, idx) => idx !== i));
                }}
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={20} color={colors.red500} />
              </Pressable>
            </View>
          ))}

          <Pressable
            style={styles.addOption}
            onPress={() => {
              feedbackTap();
              setTouched(true);
              setOptions((prev) => [...prev, { id: `o_${Date.now()}`, name: "", price: 0 }]);
            }}
          >
            <Ionicons name="add" size={20} color={colors.primary} />
            <Text style={styles.addOptionText}>ADD OPTION</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 4, padding: 12, marginBottom: 8, elevation: 1 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.grey600, letterSpacing: 0.6, marginBottom: 8 },
  emptyText: { color: colors.grey500, fontSize: 14, paddingVertical: 6 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey200,
  },
  optionName: { flex: 1, fontSize: 15, color: colors.grey900, padding: 0 },
  priceWrap: { flexDirection: "row", alignItems: "center", gap: 2 },
  priceSym: { fontSize: 14, color: colors.grey600 },
  optionPrice: { width: 70, fontSize: 15, color: colors.grey900, textAlign: "right", padding: 0 },
  addOption: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 12 },
  addOptionText: { color: colors.primary, fontWeight: "700", fontSize: 14, letterSpacing: 0.4 },
});
