import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { IngredientMovement, IngredientUnit } from "@gls-pos/types";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, confirmDelete, formStyles } from "@/components/form";
import { useCatalog } from "@/lib/catalog";
import { useAuth } from "@/lib/auth";
import { feedbackTap } from "@/lib/feedback";
import { loadDocsByField } from "@/lib/db";
import { DISPLAY_UNIT, UNIT_CHOICES, formatQty, fromBase, toBase } from "@/lib/stock-units";

type AdjustMode = "restock" | "waste" | "count";

const MOVEMENT_LABEL: Record<IngredientMovement["reason"], string> = {
  initial: "Opening stock",
  restock: "Restocked",
  adjustment: "Count corrected",
  waste: "Waste",
  recipe: "Used in sales",
  transfer_out: "Sent",
  transfer_in: "Received",
};

/**
 * One editor for every ingredient, central or branch. Stock is shown, never
 * typed over: every change is a logged movement (restock, waste, or a count
 * correction), so the history always explains the balance.
 */
export default function IngredientEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { ingredients, upsertIngredient, deleteIngredient, adjustIngredient } = useCatalog();
  const { can } = useAuth();
  const canEdit = can("catalog:write");
  const canAdjust = can("inventory:adjust");
  const existing = ingredients.find((i) => i.id === id);
  const fromCentral = !!existing?.sourceIngredientId;

  const [name, setName] = useState(existing?.name ?? "");
  const [unit, setUnit] = useState<IngredientUnit>(existing?.unit ?? "g");
  const [opening, setOpening] = useState("");
  const [lowAt, setLowAt] = useState(existing ? fromBase(existing.lowAt, existing.unit) : "");
  const [touched, setTouched] = useState(false);

  const [mode, setMode] = useState<AdjustMode>("restock");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const history = useMemo(
    () =>
      existing
        ? loadDocsByField<IngredientMovement>("ingredient_movements", "ingredientId", existing.id, {
            field: "at",
            direction: "desc",
          }).slice(0, 30)
        : [],
    // Re-read whenever the cached balance changes.
    [existing?.id, existing?.stock],
  );

  const dirty = name.trim().length > 0 && (touched || name !== existing?.name);
  const shown = DISPLAY_UNIT[unit];

  const adjustBase = toBase(amount, unit);
  const adjustDelta =
    adjustBase === null || !existing
      ? 0
      : mode === "restock"
        ? adjustBase
        : mode === "waste"
          ? -Math.min(adjustBase, existing.stock)
          : adjustBase - existing.stock;

  const save = () => {
    const saved = upsertIngredient({
      id: existing?.id,
      name: name.trim(),
      unit,
      lowAt: toBase(lowAt, unit) ?? 0,
    });
    const openingBase = toBase(opening, unit);
    if (!existing && openingBase && openingBase > 0) {
      adjustIngredient(saved.id, openingBase, "initial");
    }
    feedbackTap();
    router.back();
  };

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title={existing ? "Edit Ingredient" : "Add Ingredient"}
        dirty={dirty}
        onClose={() => router.back()}
        onSave={save}
        onDelete={
          existing && canEdit
            ? () =>
                confirmDelete(`ingredient "${existing.name}"`, () => {
                  deleteIngredient(existing.id);
                  feedbackTap();
                  router.back();
                })
            : undefined
        }
      />

      <ScrollView contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled">
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
          <Text style={styles.sectionLabel}>MEASURED BY</Text>
          {existing ? (
            <Text style={styles.locked}>
              {UNIT_CHOICES.find((c) => c.unit === unit)?.label}. Fixed once created, so past
              history keeps its meaning.
            </Text>
          ) : (
            <View style={styles.chipRow}>
              {UNIT_CHOICES.map((c) => (
                <Pressable
                  key={c.unit}
                  style={[styles.chip, unit === c.unit && styles.chipActive]}
                  onPress={() => {
                    feedbackTap();
                    setUnit(c.unit);
                    setTouched(true);
                  }}
                >
                  <Text style={[styles.chipText, unit === c.unit && { color: colors.white }]}>
                    {c.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {!existing ? (
          <FieldCard
            label={`Opening Stock (${shown})`}
            hint="0"
            value={opening}
            onChangeText={setOpening}
            keyboardType="numeric"
            showTick={false}
          />
        ) : null}
        <FieldCard
          label={`Low Stock Alert (${shown})`}
          hint="0"
          value={lowAt}
          onChangeText={(t) => {
            setLowAt(t);
            setTouched(true);
          }}
          keyboardType="numeric"
          showTick={false}
        />

        {existing ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>IN STOCK</Text>
            <Text style={[styles.balance, existing.stock <= existing.lowAt && { color: colors.red500 }]}>
              {formatQty(existing.stock, existing.unit)}
            </Text>
            {fromCentral ? <Text style={styles.locked}>Supplied by the Central Store.</Text> : null}

            {canAdjust ? (
              <>
                <View style={[styles.chipRow, { marginTop: 14 }]}>
                  {(
                    [
                      ["restock", "Add stock"],
                      ["waste", "Remove (waste)"],
                      ["count", "Set counted amount"],
                    ] as const
                  ).map(([m, label]) => (
                    <Pressable
                      key={m}
                      style={[styles.chip, mode === m && styles.chipActive]}
                      onPress={() => {
                        feedbackTap();
                        setMode(m);
                      }}
                    >
                      <Text style={[styles.chipText, mode === m && { color: colors.white }]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.adjustRow}>
                  <TextInput
                    style={styles.input}
                    value={amount}
                    onChangeText={setAmount}
                    placeholder={`Amount in ${shown}`}
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    style={[styles.input, { flex: 1.4 }]}
                    value={note}
                    onChangeText={setNote}
                    placeholder="Note (optional)"
                    maxLength={240}
                  />
                </View>
                <Pressable
                  disabled={adjustDelta === 0}
                  style={[styles.apply, adjustDelta === 0 && { backgroundColor: colors.grey400 }]}
                  onPress={() => {
                    adjustIngredient(
                      existing.id,
                      adjustDelta,
                      mode === "restock" ? "restock" : mode === "waste" ? "waste" : "adjustment",
                      note,
                    );
                    feedbackTap();
                    setAmount("");
                    setNote("");
                  }}
                >
                  <Text style={styles.applyText}>
                    {adjustDelta === 0
                      ? "Enter an amount"
                      : `${adjustDelta > 0 ? "Add" : "Remove"} ${formatQty(Math.abs(adjustDelta), existing.unit)}`}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}

        {history.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>HISTORY</Text>
            {history.map((m) => (
              <View key={m.id} style={styles.histRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.histTitle}>{MOVEMENT_LABEL[m.reason] ?? m.reason}</Text>
                  <Text style={styles.histSub} numberOfLines={1}>
                    {new Date(m.at).toLocaleString()}
                    {m.actorName ? ` · ${m.actorName}` : ""}
                    {m.note ? ` · ${m.note}` : ""}
                  </Text>
                </View>
                <Text style={[styles.histDelta, { color: m.delta < 0 ? colors.red500 : colors.dkGreen }]}>
                  {m.delta > 0 ? "+" : "−"}
                  {formatQty(Math.abs(m.delta), existing!.unit)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.grey600, letterSpacing: 0.6, marginBottom: 10 },
  locked: { fontSize: 13, color: colors.grey600 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.grey400,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.grey700 },
  balance: { fontSize: 28, fontWeight: "800", color: colors.grey900 },
  adjustRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.grey900,
  },
  apply: {
    marginTop: 12,
    backgroundColor: colors.primaryDark,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  applyText: { color: colors.white, fontSize: 15, fontWeight: "700" },
  histRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 10 },
  histTitle: { fontSize: 14, fontWeight: "600", color: colors.grey900 },
  histSub: { fontSize: 12, color: colors.grey500, marginTop: 2 },
  histDelta: { fontSize: 14, fontWeight: "700" },
});
