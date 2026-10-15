import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, confirmDelete, formStyles } from "@/components/form";
import { api, CENTRAL_UNITS, type CentralItem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { feedbackTap } from "@/lib/feedback";

/**
 * Central stock item editor: name, unit, whole-number balances and an
 * optional note. Money/quantities stay integers (base units, e.g. kg) — the
 * server refuses anything else.
 */
export default function CentralItemEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { stores } = useAuth();
  const canSend = stores.some((s) => s.role === "owner" || s.role === "manager");

  const [existing, setExisting] = useState<CentralItem | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [unit, setUnit] = useState<string>("kg");
  const [totalStock, setTotalStock] = useState("");
  const [minStock, setMinStock] = useState("5");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const res = await api.listCentralItems();
      setLoading(false);
      if (!res.ok) {
        Alert.alert("Could not load item", res.error.message);
        return;
      }
      const found = res.data.find((i) => i.id === id) ?? null;
      setExisting(found);
      if (found) {
        setName(found.name);
        setUnit(found.unit);
        setTotalStock(String(found.totalStock));
        setMinStock(String(found.minStock));
        setDescription(found.description ?? "");
      }
    })();
  }, [id]);

  if (!canSend) {
    return (
      <SafeAreaView edges={["top"]} style={formStyles.screen}>
        <EditorToolbar title="Central item" onClose={() => router.back()} onSave={() => {}} />
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Only owners and managers can edit central stock.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const total = Number.parseInt(totalStock, 10);
  const min = Number.parseInt(minStock, 10);
  const validTotal = totalStock.trim() === "" || (Number.isInteger(total) && total >= 0);
  const validMin = minStock.trim() === "" || (Number.isInteger(min) && min >= 0);
  const dirty = name.trim().length > 0 && touched && validTotal && validMin && !saving;

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    const body = {
      name: name.trim(),
      unit,
      totalStock: totalStock.trim() === "" ? 0 : total,
      minStock: minStock.trim() === "" ? 0 : min,
      description: description.trim() || undefined,
    };
    const res = existing
      ? await api.updateCentralItem(existing.id, body)
      : await api.createCentralItem(body);
    setSaving(false);
    if (!res.ok) {
      Alert.alert("Could not save", res.error.message);
      return;
    }
    feedbackTap();
    router.back();
  };

  const remove = () => {
    if (!existing) return;
    confirmDelete(`central item "${existing.name}"`, async () => {
      const res = await api.deleteCentralItem(existing.id);
      if (!res.ok) {
        Alert.alert("Could not delete", res.error.message);
        return;
      }
      feedbackTap();
      router.back();
    });
  };

  if (loading) {
    return (
      <SafeAreaView edges={["top"]} style={formStyles.screen}>
        <EditorToolbar title="Central item" onClose={() => router.back()} onSave={() => {}} />
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title={existing ? "Edit Central Item" : "Add Central Item"}
        dirty={dirty}
        onClose={() => router.back()}
        onSave={() => void save()}
        onDelete={existing ? remove : undefined}
      />

      <ScrollView contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled">
        <FieldCard
          label="Item Name *"
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
            {CENTRAL_UNITS.map((u) => (
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
          label={`Total Stock (${unit}) *`}
          hint="0"
          value={totalStock}
          onChangeText={(t) => {
            setTotalStock(t);
            setTouched(true);
          }}
          keyboardType="numeric"
          decimals={false}
          showTick={false}
        />
        {!validTotal && <Text style={styles.warn}>Enter a whole number, 0 or more.</Text>}
        <FieldCard
          label={`Low Stock Alert (${unit})`}
          hint="5"
          value={minStock}
          onChangeText={(t) => {
            setMinStock(t);
            setTouched(true);
          }}
          keyboardType="numeric"
          decimals={false}
          showTick={false}
        />
        {!validMin && <Text style={styles.warn}>Enter a whole number, 0 or more.</Text>}
        <FieldCard
          label="Note"
          hint="Optional — e.g. 50kg bags from Mile 12"
          value={description}
          onChangeText={(t) => {
            setDescription(t);
            setTouched(true);
          }}
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
  warn: { color: colors.red500, fontSize: 12, fontWeight: "600", marginBottom: 8, marginLeft: 4 },
  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30 },
  blockedText: { color: colors.grey600, textAlign: "center" },
});
