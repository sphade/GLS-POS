import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, PickerCard, formStyles } from "@/components/form";
import { PickerSheet, type PickerOption } from "@/components/PickerSheet";
import { api, type ProductionRule, type StoreProductOption } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { feedbackTap } from "@/lib/feedback";

/**
 * Owner-facing recipe editor: how many units of one branch product are used up
 * to make how many units of another (e.g. 1 Rice -> 5 Jollof rice).
 *
 * This is configuration, not a hard batch constraint. The run screen starts
 * from these numbers and lets the cook correct them, which is how yield drift
 * gets noticed.
 */
export default function ProductionRuleEditorScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { activeStore, can } = useAuth();
  const isCentral = activeStore?.isCentral;
  const canManage = can("inventory:adjust");

  const [products, setProducts] = useState<StoreProductOption[]>([]);
  const [existing, setExisting] = useState<ProductionRule | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [inputProductId, setInputProductId] = useState<string | undefined>();
  const [outputProductId, setOutputProductId] = useState<string | undefined>();
  const [inputQty, setInputQty] = useState("1");
  const [outputQty, setOutputQty] = useState("1");

  const [picker, setPicker] = useState<null | {
    title: string;
    options: PickerOption[];
    onPick: (id: string) => void;
  }>(null);

  useEffect(() => {
    if (!activeStore) {
      setLoading(false);
      return;
    }
    void (async () => {
      const [productsRes, rulesRes] = await Promise.all([
        api.listStoreProducts(activeStore.id),
        api.listProductionRules(activeStore.id),
      ]);
      setLoading(false);

      if (!productsRes.ok) {
        Alert.alert("Could not load products", productsRes.error.message);
        return;
      }
      setProducts(productsRes.data);

      if (!params.id) return;
      const rule = rulesRes.ok ? rulesRes.data.find((r) => r.id === params.id) : undefined;
      if (!rule) {
        Alert.alert("Rule not found", "It may have been deleted on another device.", [
          { text: "OK", onPress: () => router.back() },
        ]);
        return;
      }
      setExisting(rule);
      setInputProductId(rule.inputProductId);
      setOutputProductId(rule.outputProductId);
      setInputQty(String(rule.inputQty));
      setOutputQty(String(rule.outputQty));
    })();
  }, [activeStore, params.id, router]);

  /** Production can only move tracked stock, so untracked products are hidden. */
  const tracked = useMemo(() => products.filter((p) => p.stock !== null), [products]);
  const input = tracked.find((p) => p.id === inputProductId);
  const output = tracked.find((p) => p.id === outputProductId);

  const used = Number.parseInt(inputQty, 10);
  const made = Number.parseInt(outputQty, 10);
  const valid =
    !!input &&
    !!output &&
    input.id !== output.id &&
    Number.isInteger(used) &&
    used >= 1 &&
    Number.isInteger(made) &&
    made >= 1 &&
    !saving;

  const openPicker = (title: string, options: PickerOption[], onPick: (id: string) => void) => {
    feedbackTap();
    setPicker({ title, options, onPick });
  };

  const closePicker = () => setPicker(null);

  const pickOptions = (excludeId: string | undefined): PickerOption[] =>
    tracked
      .filter((p) => p.id !== excludeId)
      .map((p) => ({ id: p.id, label: p.name, hint: `${p.stock ?? 0} in stock` }));

  const save = async () => {
    if (!activeStore || !valid || !input || !output) return;
    setSaving(true);
    const res = await api.saveProductionRule({
      storeId: activeStore.id,
      inputProductId: input.id,
      outputProductId: output.id,
      inputQty: used,
      outputQty: made,
    });
    setSaving(false);
    if (!res.ok) {
      Alert.alert("Could not save rule", res.error.message);
      return;
    }
    // Changing the pair creates a new rule; drop the old one so the list does
    // not keep two versions of the same recipe.
    if (existing && existing.id !== res.data.id) {
      await api.deleteProductionRule(existing.id, activeStore.id);
    }
    feedbackTap();
    router.back();
  };

  const remove = () => {
    if (!existing || !activeStore) return;
    Alert.alert("Delete rule?", "Products and their stock are not affected.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const res = await api.deleteProductionRule(existing.id, activeStore.id);
          if (!res.ok) {
            Alert.alert("Could not delete", res.error.message);
            return;
          }
          router.back();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView edges={["top"]} style={formStyles.screen}>
        <EditorToolbar title="Production rule" onClose={() => router.back()} onSave={() => {}} />
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title={existing ? "Edit rule" : "New rule"}
        dirty={valid}
        onClose={() => router.back()}
        onSave={() => void save()}
        onDelete={existing ? remove : undefined}
      />

      <ScrollView contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled">
        {products.length > 0 && tracked.length === 0 && (
          <Text style={styles.warn}>
            No product here has stock tracking turned on. Turn it on in Inventory first.
          </Text>
        )}

        <PickerCard
          label="PRODUCT USED *"
          value={input?.name}
          hint="What gets used up (e.g. Rice)"
          valid={!!input}
          onPress={() =>
            openPicker("Product used", pickOptions(outputProductId), (id) => {
              setInputProductId(id);
              closePicker();
            })
          }
        />

        <FieldCard
          label="QUANTITY USED *"
          hint="Whole units used by one batch"
          value={inputQty}
          onChangeText={setInputQty}
          keyboardType="numeric"
          decimals={false}
          showTick={false}
        />

        <PickerCard
          label="PRODUCT MADE *"
          value={output?.name}
          hint="What comes out (e.g. Jollof rice)"
          valid={!!output}
          onPress={() =>
            openPicker("Product made", pickOptions(inputProductId), (id) => {
              setOutputProductId(id);
              closePicker();
            })
          }
        />

        <FieldCard
          label="QUANTITY MADE *"
          hint="Whole units produced by one batch"
          value={outputQty}
          onChangeText={setOutputQty}
          keyboardType="numeric"
          decimals={false}
          showTick={false}
        />

        <View style={styles.preview}>
          <Text style={styles.previewLabel}>RECIPE</Text>
          <Text style={styles.previewText}>
            {used >= 1 ? used : "?"} × {input?.name ?? "…"} → {made >= 1 ? made : "?"} ×{" "}
            {output?.name ?? "…"}
          </Text>
          <Text style={styles.previewHint}>
            This is the starting point for each run. Whoever produces records what was actually
            used and made, so real yield can differ from the recipe.
          </Text>
        </View>

        {saving && <ActivityIndicator style={{ marginTop: 12 }} color={colors.primary} />}
      </ScrollView>

      <PickerSheet
        visible={!!picker}
        title={picker?.title ?? ""}
        options={picker?.options ?? []}
        onPick={(id) => picker?.onPick(id)}
        onClose={closePicker}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  warn: {
    color: colors.red500,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
    marginLeft: 4,
  },
  preview: {
    backgroundColor: colors.card,
    borderRadius: 4,
    padding: 14,
    marginTop: 4,
    marginBottom: 8,
    elevation: 1,
  },
  previewLabel: { fontSize: 12, fontWeight: "600", color: colors.grey600, marginBottom: 6 },
  previewText: { fontSize: 17, fontWeight: "800", color: colors.grey900 },
  previewHint: { fontSize: 12.5, color: colors.grey600, lineHeight: 18, marginTop: 8 },
});
