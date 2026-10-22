import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, formStyles } from "@/components/form";
import { api, type ProductionRule, type StoreProductOption } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { feedbackTap } from "@/lib/feedback";

/**
 * Record one production batch.
 *
 * The rule prefills the quantities, but both are editable: a cook may use more
 * rice than planned or get fewer plates than the recipe promises. What is
 * recorded here is what actually moved, which keeps stock honest and gives the
 * owner the data to calibrate the recipe afterwards.
 */
export default function ProductionRunScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ ruleId?: string }>();
  const { activeStore } = useAuth();

  const [rule, setRule] = useState<ProductionRule | null>(null);
  const [products, setProducts] = useState<StoreProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [used, setUsed] = useState("");
  const [made, setMade] = useState("");
  const [note, setNote] = useState("");

  /**
   * One idempotency key per attempt. If the phone times out after the server
   * committed, retrying with this key returns `duplicate` instead of producing
   * a second batch.
   */
  const ref = useRef<string | null>(null);
  /** Once the cook edits the output, stop recomputing it from the input. */
  const madeTouched = useRef(false);

  useEffect(() => {
    if (!activeStore) {
      setLoading(false);
      return;
    }
    void (async () => {
      const [rulesRes, productsRes] = await Promise.all([
        api.listProductionRules(activeStore.id),
        api.listStoreProducts(activeStore.id),
      ]);
      setLoading(false);

      if (!rulesRes.ok) {
        Alert.alert("Could not load production", rulesRes.error.message);
        return;
      }
      if (!productsRes.ok) {
        Alert.alert("Could not load products", productsRes.error.message, [
          { text: "OK", onPress: () => router.back() },
        ]);
        return;
      }
      const found = rulesRes.data.find((r) => r.id === params.ruleId);
      if (!found) {
        Alert.alert("Rule not found", "It may have been deleted on another device.", [
          { text: "OK", onPress: () => router.back() },
        ]);
        return;
      }
      setRule(found);
      setProducts(productsRes.data);
      setUsed(String(found.inputQty));
      setMade(String(found.outputQty));
    })();
  }, [activeStore, params.ruleId, router]);

  const input = products.find((p) => p.id === rule?.inputProductId);
  const output = products.find((p) => p.id === rule?.outputProductId);

  const usedN = Number.parseInt(used, 10);
  const madeN = Number.parseInt(made, 10);
  const expected =
    rule && Number.isInteger(usedN) && usedN > 0
      ? Math.max(1, Math.round((usedN * rule.outputQty) / rule.inputQty))
      : 0;
  const available = input?.stock ?? 0;

  const valid =
    !!rule &&
    Number.isInteger(usedN) &&
    usedN >= 1 &&
    usedN <= available &&
    Number.isInteger(madeN) &&
    madeN >= 1 &&
    !saving;

  const changeUsed = (text: string) => {
    setUsed(text);
    if (madeTouched.current || !rule) return;
    const next = Number.parseInt(text, 10);
    if (Number.isInteger(next) && next > 0) {
      setMade(String(Math.max(1, Math.round((next * rule.outputQty) / rule.inputQty))));
    }
  };

  const submit = async () => {
    if (!activeStore || !rule || !valid) return;
    if (!ref.current) {
      ref.current = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }
    setSaving(true);
    const res = await api.produce({
      storeId: activeStore.id,
      ruleId: rule.id,
      inputQty: usedN,
      outputQty: madeN,
      ref: ref.current,
      note: note.trim() || undefined,
    });
    setSaving(false);

    if (!res.ok) {
      Alert.alert(
        "Could not record production",
        `${res.error.message}\n\nIf this was a timeout, try again — the same batch won't be counted twice.`,
      );
      return;
    }

    feedbackTap();
    if (res.data.duplicate) {
      Alert.alert("Already recorded", "This batch was saved earlier, so nothing was changed.", [
        { text: "OK", onPress: () => router.back() },
      ]);
      return;
    }

    Alert.alert(
      "Production recorded",
      `${usedN} ${res.data.inputName} used\n${madeN} ${res.data.outputName} added.\n\n` +
        `${res.data.inputName}: ${res.data.inputStock} left\n` +
        `${res.data.outputName}: ${res.data.outputStock} in stock.`,
      [{ text: "OK", onPress: () => router.back() }],
    );
  };

  if (loading) {
    return (
      <SafeAreaView edges={["top"]} style={formStyles.screen}>
        <EditorToolbar title="Record production" onClose={() => router.back()} onSave={() => {}} />
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title="Record production"
        dirty={valid}
        onClose={() => router.back()}
        onSave={() => void submit()}
      />

      <ScrollView contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>RECIPE</Text>
          <Text style={styles.summaryText}>
            {rule?.inputQty ?? "?"} × {input?.name ?? "…"} → {rule?.outputQty ?? "?"} ×{" "}
            {output?.name ?? "…"}
          </Text>
          <Text style={styles.summaryHint}>
            {input?.name ?? "Input"}: {available} in stock
            {output?.name ? ` · ${output.name}: ${output.stock ?? 0} in stock` : ""}
          </Text>
        </View>

        <FieldCard
          label={`USED — ${input?.name ?? "PRODUCT"} *`}
          hint={`In stock: ${available}. Whole units.`}
          value={used}
          onChangeText={changeUsed}
          keyboardType="numeric"
          decimals={false}
          showTick={false}
        />
        {Number.isInteger(usedN) && usedN > available && (
          <Text style={styles.warn}>
            Only {available} {input?.name ?? "units"} in stock. Restock before producing this
            batch.
          </Text>
        )}

        <FieldCard
          label={`MADE — ${output?.name ?? "PRODUCT"} *`}
          hint={
            expected > 0
              ? `Recipe expects about ${expected}. Correct it if the yield differs.`
              : "Whole units produced"
          }
          value={made}
          onChangeText={(text) => {
            madeTouched.current = true;
            setMade(text);
          }}
          keyboardType="numeric"
          decimals={false}
          showTick={false}
        />

        <FieldCard
          label="Note"
          hint="Optional — batch, shift or staff note"
          value={note}
          onChangeText={setNote}
          showTick={false}
        />

        {saving && <ActivityIndicator style={{ marginTop: 12 }} color={colors.primary} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  summary: {
    backgroundColor: colors.card,
    borderRadius: 4,
    padding: 14,
    marginBottom: 8,
    elevation: 1,
  },
  summaryLabel: { fontSize: 12, fontWeight: "600", color: colors.grey600, marginBottom: 6 },
  summaryText: { fontSize: 17, fontWeight: "800", color: colors.grey900 },
  summaryHint: { fontSize: 12.5, color: colors.grey600, marginTop: 8 },
  warn: {
    color: colors.red500,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
    marginLeft: 4,
  },
});
