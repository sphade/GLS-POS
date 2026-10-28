import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, PickerCard, formStyles } from "@/components/form";
import { PickerSheet, type PickerOption } from "@/components/PickerSheet";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import {
  centralConversionRates,
  centralReceivedBalance,
  createCentralConversionLocal,
  flushCentralOutbox,
  refreshCentralConversionRates,
  useCentralRevision,
} from "@/lib/central";
import { feedbackTap } from "@/lib/feedback";

/**
 * Turn part of a Stock Room item into menu stock.
 *
 * The owner sets the rate once — how much of the bulk item one menu item uses.
 * From then on the person running the shop only picks the item, the menu
 * product and the quantity; the number of portions is computed automatically
 * and the product's stock is raised for them.
 */
export default function StockRoomConvertScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    globalItemId?: string;
    name?: string;
    unit?: string;
    available?: string;
  }>();
  const { store } = useStore();
  const { stores, user, can } = useAuth();
  const { products } = useCatalog();
  const revision = useCentralRevision();

  const globalItemId = params.globalItemId ?? "";
  const itemName = params.name ?? "Stock";
  const itemUnit = params.unit ?? "";

  const [productId, setProductId] = useState<string | undefined>(undefined);
  const [yieldText, setYieldText] = useState("");
  const [quantity, setQuantity] = useState("");
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<null | {
    title: string;
    options: PickerOption[];
    onPick: (id: string) => void;
  }>(null);

  const available = useMemo(() => {
    void revision;
    return centralReceivedBalance(store.id, globalItemId);
  }, [globalItemId, revision, store.id]);

  const rates = useMemo(() => {
    void revision;
    return centralConversionRates(store.id);
  }, [revision, store.id]);

  useEffect(() => {
    void refreshCentralConversionRates(store.id);
  }, [store.id]);

  // Only simple, stock-tracked products can take converted stock: a parent with
  // variants would misstate what can actually sell.
  const menuProducts = useMemo(
    () =>
      products
        .filter((p) => p.stockQuantity != null && !p.variants?.length)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

  const product = menuProducts.find((p) => p.id === productId);
  const productUnit = product?.unit?.trim() || "portion";

  // The owner thinks in yield: "1 kg of rice makes 5 plates". The stored rate is
  // the inverse (kg per plate), so both views stay consistent.
  const yieldNum = Number(yieldText.replace(",", "."));
  const portionSize = yieldNum > 0 ? 1 / yieldNum : 0;
  const qty = Number.parseInt(quantity, 10);
  const portions =
    yieldNum > 0 && Number.isFinite(qty) ? Math.floor(qty * yieldNum + 1e-9) : 0;
  const valid =
    !!productId &&
    Number.isFinite(qty) &&
    qty >= 1 &&
    qty <= available &&
    yieldNum > 0 &&
    portions >= 1 &&
    !saving;
  const remaining = available - (Number.isFinite(qty) ? qty : 0);

  const pickProduct = (id: string) => {
    setProductId(id);
    const saved = rates.find((r) => r.globalItemId === globalItemId && r.productId === id);
    if (saved && saved.quantityPerPortion > 0) {
      const perUnit = 1 / saved.quantityPerPortion;
      // Trim floating noise: 5, not 5.000000000000001.
      setYieldText(String(Math.round(perUnit * 1000) / 1000));
    } else {
      setYieldText("");
    }
    setPicker(null);
  };

  const setQuick = (fraction: number) => {
    feedbackTap();
    const value = fraction >= 1 ? available : Math.floor(available * fraction);
    setQuantity(String(Math.max(1, value)));
  };

  const submit = () => {
    if (!valid || !product || !productId) return;
    const actor = user ? { id: user.id, name: user.name, email: user.email } : null;
    if (!actor) return;

    setSaving(true);
    const res = createCentralConversionLocal(
      store.id,
      {
        globalItemId,
        itemName,
        itemUnit,
        productId,
        productName: product.name,
        quantity: qty,
        portionSize,
      },
      actor,
    );
    setSaving(false);
    if (!res.ok) {
      Alert.alert("Could not convert", res.error);
      return;
    }

    feedbackTap();
    void flushCentralOutbox(
      store.id,
      actor,
      stores.map((membership) => ({ id: membership.id })),
    );
    Alert.alert(
      "Converted",
      `${portions} ${productUnit}${portions === 1 ? "" : "s"} added to ${product.name}.`,
      [{ text: "OK", onPress: () => router.back() }],
    );
  };

  if (!can("inventory:adjust")) {
    return (
      <SafeAreaView edges={["top"]} style={formStyles.screen}>
        <EditorToolbar title="Convert stock" onClose={() => router.back()} onSave={() => {}} />
        <View style={styles.blocked}>
          <Text style={styles.blockedTitle}>Owners, managers and supervisors only</Text>
          <Text style={styles.blockedText}>Your role cannot convert stock.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!globalItemId) {
    return (
      <SafeAreaView edges={["top"]} style={formStyles.screen}>
        <EditorToolbar title="Convert stock" onClose={() => router.back()} onSave={() => {}} />
        <View style={styles.blocked}>
          <Text style={styles.blockedTitle}>No item selected</Text>
          <Text style={styles.blockedText}>Go back to the Stock Room and tap an item.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title="Convert stock"
        dirty={valid}
        onClose={() => router.back()}
        onSave={() => void submit()}
      />

      <ScrollView contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <MaterialCommunityIcons name="warehouse" size={20} color={colors.white} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroName} numberOfLines={1}>
              {itemName}
            </Text>
            <Text style={styles.heroMeta}>
              {available} {itemUnit} available
            </Text>
          </View>
        </View>

        <PickerCard
          label="ADD TO MENU ITEM *"
          value={product?.name}
          hint={
            menuProducts.length === 0
              ? "Create a stock-tracked menu item first"
              : "The product that receives this stock"
          }
          valid={!!productId}
          onPress={() => {
            feedbackTap();
            if (menuProducts.length === 0) {
              Alert.alert(
                "No menu items",
                "Create a menu item that tracks stock, then come back.",
              );
              return;
            }
            setPicker({
              title: "Menu item",
              options: menuProducts.map((p) => ({
                id: p.id,
                label: p.name,
                hint: `${p.stockQuantity ?? 0} ${p.unit ?? ""}`.trim(),
              })),
              onPick: pickProduct,
            });
          }}
        />

        <FieldCard
          label={`1 ${(itemUnit || "unit").toUpperCase()} MAKES (${productUnit.toUpperCase()}S) *`}
          hint={
            productId
              ? `How many ${productUnit}s one ${itemUnit || "unit"} makes`
              : "Choose a menu item first"
          }
          value={yieldText}
          onChangeText={setYieldText}
          keyboardType="numeric"
          decimals
          showTick={false}
        />

        <FieldCard
          label={`HOW MUCH TO CONVERT (${itemUnit || "units"}) *`}
          hint={available > 0 ? `Up to ${available} available` : "Nothing left to convert"}
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="numeric"
          decimals={false}
          showTick={false}
        />

        {available > 0 ? (
          <View style={styles.quickRow}>
            <QuickChip label="¼" onPress={() => setQuick(0.25)} />
            <QuickChip label="½" onPress={() => setQuick(0.5)} />
            <QuickChip label="All" onPress={() => setQuick(1)} />
          </View>
        ) : null}

        {quantity.trim() !== "" && Number.isFinite(qty) && qty > available ? (
          <Text style={styles.warn}>
            Only {available} {itemUnit} left in the Stock Room.
          </Text>
        ) : null}
        {yieldText.trim() !== "" && (!Number.isFinite(yieldNum) || yieldNum <= 0) ? (
          <Text style={styles.warn}>Enter how many {productUnit}s one {itemUnit || "unit"} makes.</Text>
        ) : null}

        {valid && product ? (
          <View style={styles.result}>
            <Text style={styles.resultLabel}>THIS ADDS</Text>
            <Text style={styles.resultValue} numberOfLines={1} adjustsFontSizeToFit>
              {portions} {productUnit}
              {portions === 1 ? "" : "s"}
            </Text>
            <Text style={styles.resultTo} numberOfLines={1}>
              to {product.name}
            </Text>
            <View style={styles.resultDivider} />
            <Text style={styles.resultLeft}>
              {remaining} {itemUnit} left in the Stock Room
            </Text>
          </View>
        ) : null}

        {saving ? <ActivityIndicator style={{ marginTop: 12 }} color={colors.primary} /> : null}
      </ScrollView>

      <PickerSheet
        visible={!!picker}
        title={picker?.title ?? ""}
        options={picker?.options ?? []}
        onPick={(id) => picker?.onPick(id)}
        onClose={() => setPicker(null)}
      />
    </SafeAreaView>
  );
}

function QuickChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quickChip} onPress={onPress}>
      <Text style={styles.quickChipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.white,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    elevation: 1,
  },
  heroIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: { flex: 1 },
  heroName: { fontSize: 16, fontWeight: "800", color: colors.grey900 },
  heroMeta: { fontSize: 12.5, color: colors.grey600, marginTop: 1 },

  quickRow: { flexDirection: "row", gap: 8, marginTop: -2, marginBottom: 8 },
  quickChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: colors.blue50,
  },
  quickChipText: { fontSize: 12.5, fontWeight: "800", color: colors.primaryDark },

  warn: { color: colors.red500, fontSize: 12, fontWeight: "600", marginBottom: 8, marginLeft: 4 },

  result: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    marginTop: 6,
  },
  resultLabel: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  resultValue: { color: colors.white, fontSize: 30, fontWeight: "800", marginTop: 2 },
  resultTo: { color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: "600", marginTop: 1 },
  resultDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.35)",
    marginVertical: 10,
  },
  resultLeft: { color: colors.white, fontSize: 12, fontWeight: "600" },

  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  blockedTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900 },
  blockedText: { color: colors.grey600, textAlign: "center", lineHeight: 20 },
});
