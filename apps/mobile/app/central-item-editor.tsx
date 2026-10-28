import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, confirmDelete, formStyles } from "@/components/form";
import { CENTRAL_UNITS, type CentralItem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  centralItem,
  deleteCentralItemLocal,
  refreshCentralItems,
  saveCentralItemLocal,
} from "@/lib/central";
import { feedbackTap } from "@/lib/feedback";

/**
 * Central stock item editor: name, unit, whole-number balances and an
 * optional note. Money/quantities stay integers (base units, e.g. kg) — the
 * server refuses anything else.
 */
export default function CentralItemEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { stores, user } = useAuth();
  const central = stores.find((s) => s.isCentral);
  const canManage = central
    ? central.role === "owner" || central.role === "manager"
    : stores.some((s) => s.role === "owner");

  const [existing, setExisting] = useState<CentralItem | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  const [name, setName] = useState("");
  const [unit, setUnit] = useState<string>("kg");
  const [totalStock, setTotalStock] = useState("");
  const [minStock, setMinStock] = useState("5");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!id || !central) {
      setLoading(false);
      return;
    }

    const apply = (found: CentralItem | null) => {
      setExisting(found);
      setMissing(!found);
      if (found) {
        setName(found.name);
        setUnit(found.unit);
        setTotalStock(String(found.totalStock));
        setMinStock(String(found.minStock));
        setDescription(found.description ?? "");
      }
    };

    const cached = centralItem(central.id, id);
    apply(cached);
    setLoading(false);
    if (cached) return;

    void (async () => {
      await refreshCentralItems(central.id);
      apply(centralItem(central.id, id));
      setLoading(false);
    })();
  }, [central?.id, id]);

  // Coming back from Add/Remove, the cached item has the new balance; refresh
  // the header so the editor never shows the old total.
  useFocusEffect(
    useCallback(() => {
      if (!central || !id) return;
      const cached = centralItem(central.id, id);
      if (cached) setExisting(cached);
    }, [central, id]),
  );

  if (!canManage) {
    return (
      <SafeAreaView edges={["top"]} style={formStyles.screen}>
        <EditorToolbar title="Central item" onClose={() => router.back()} onSave={() => {}} />
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>
            Only the central store owner or manager can edit this stock.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!central) {
    return (
      <SafeAreaView edges={["top"]} style={formStyles.screen}>
        <EditorToolbar title="Central item" onClose={() => router.back()} onSave={() => {}} />
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>
            Open the Central Store once to set it up, then add stock items here.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const total = Number.parseInt(totalStock, 10);
  const min = Number.parseInt(minStock, 10);
  // An existing item's balance only moves through Add/Remove, so the editor
  // never overwrites it with a typed total.
  const validTotal =
    !!existing || totalStock.trim() === "" || (Number.isInteger(total) && total >= 0);
  const validMin = minStock.trim() === "" || (Number.isInteger(min) && min >= 0);
  const dirty = name.trim().length > 0 && touched && validTotal && validMin && !saving;

  const save = () => {
    if (!dirty || !central || !user) return;
    setSaving(true);
    const saved = saveCentralItemLocal(
      central.id,
      {
        id: existing?.id,
        name: name.trim(),
        unit,
        totalStock: existing ? existing.totalStock : totalStock.trim() === "" ? 0 : total,
        minStock: minStock.trim() === "" ? 0 : min,
        description: description.trim() || undefined,
      },
      { id: user.id, name: user.name, email: user.email },
    );
    setSaving(false);
    if (!saved) {
      Alert.alert("Could not save", "This item is no longer on this device.");
      return;
    }
    feedbackTap();
    router.back();
  };

  const remove = () => {
    if (!existing || !central || !user) return;
    confirmDelete(`central item "${existing.name}"`, () => {
      deleteCentralItemLocal(central.id, existing.id, {
        id: user.id,
        name: user.name,
        email: user.email,
      });
      feedbackTap();
      router.back();
    });
  };

  if (missing) {
    return (
      <SafeAreaView edges={["top"]} style={formStyles.screen}>
        <EditorToolbar title="Central item" onClose={() => router.back()} onSave={() => {}} />
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>
            This item is not saved on this device. Reconnect and reopen it from Central Items.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

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

        {existing ? (
          <Pressable
            style={styles.stockCard}
            onPress={() => {
              feedbackTap();
              router.push({
                pathname: "/central-adjust-stock",
                params: { id: existing.id },
              } as never);
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.stockLabel}>CURRENT STOCK</Text>
              <Text style={styles.stockValue} numberOfLines={1} adjustsFontSizeToFit>
                {existing.totalStock} <Text style={styles.stockUnit}>{unit}</Text>
              </Text>
            </View>
            <View style={styles.stockBtn}>
              <Ionicons name="add-circle-outline" size={16} color={colors.white} />
              <Text style={styles.stockBtnText}>ADD / REMOVE</Text>
            </View>
          </Pressable>
        ) : (
          <>
            <FieldCard
              label={`Opening Stock (${unit})`}
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
          </>
        )}
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
  stockCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 4,
    padding: 14,
    marginBottom: 8,
    elevation: 1,
  },
  stockLabel: { fontSize: 11, fontWeight: "800", color: colors.grey600, letterSpacing: 0.6 },
  stockValue: { fontSize: 26, fontWeight: "800", color: colors.grey900, marginTop: 2 },
  stockUnit: { fontSize: 14, fontWeight: "700", color: colors.grey500 },
  stockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.primary,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  stockBtnText: { color: colors.white, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.5 },
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
