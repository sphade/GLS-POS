import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, PickerCard, formStyles } from "@/components/form";
import { PickerSheet, type PickerOption } from "@/components/PickerSheet";
import { CENTRAL_UNITS, api, type CentralItem, type StoreProductOption } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { useCatalog } from "@/lib/catalog";
import {
  centralItems,
  createCentralTransferLocal,
  flushCentralOutbox,
  refreshCentralItems,
  useCentralRevision,
} from "@/lib/central";
import { OFFLINE_MODE } from "@/lib/offline";
import { feedbackTap } from "@/lib/feedback";

/**
 * Transfer stock from the central store to one branch. The source is fixed:
 * there is no "from shop" picker, because the centre is the parent of every
 * branch. Stock leaves the centre and lands on the shop's shelf in the same
 * request, so there is nothing for anyone to confirm afterwards.
 *
 * The two sides count differently: a kg leaving the centre may be ten loaves at
 * the shop, so the form asks how much the receiving shop's stock goes up by and
 * remembers the product it matched there.
 */
export default function SendToStoreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ globalItemId?: string }>();
  const { stores, user } = useAuth();
  const { store } = useStore();
  const { products: catalogProducts } = useCatalog();
  const central = stores.find((s) => s.isCentral);
  const destinations = stores.filter((s) => !s.isCentral);
  const revision = useCentralRevision();

  const [items, setItems] = useState<CentralItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [itemId, setItemId] = useState<string | undefined>(params.globalItemId);
  const [toStoreId, setToStoreId] = useState<string | undefined>(undefined);
  const [productId, setProductId] = useState<string | undefined>(undefined);
  const [products, setProducts] = useState<StoreProductOption[]>([]);
  /** The shop `products` was loaded for; guards the name match below. */
  const [productsStoreId, setProductsStoreId] = useState<string | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const [quantity, setQuantity] = useState("");
  /** How much the receiving shop's stock rises by. Empty means "same as sent". */
  const [receiveQty, setReceiveQty] = useState("");
  /** The shop's own unit, e.g. pieces. Defaults to the central item's unit. */
  const [receiveUnitChoice, setReceiveUnitChoice] = useState<string | undefined>(undefined);
  const [notes, setNotes] = useState("");

  const [picker, setPicker] = useState<null | { title: string; options: PickerOption[]; onPick: (id: string) => void }>(null);

  useEffect(() => {
    if (!central) {
      setItems([]);
      setLoading(false);
      return;
    }
    const cached = centralItems(central.id);
    setItems(cached);
    setLoading(false);
    if (params.globalItemId && !cached.some((i) => i.id === params.globalItemId)) {
      setItemId(undefined);
    }
  }, [central?.id, params.globalItemId, revision]);

  useEffect(() => {
    if (!central) return;
    void (async () => {
      await refreshCentralItems(central.id);
      const fresh = centralItems(central.id);
      setItems(fresh);
      setLoading(false);
      if (params.globalItemId && !fresh.some((i) => i.id === params.globalItemId)) {
        setItemId(undefined);
      }
    })();
  }, [central?.id, params.globalItemId]);

  // Destination catalog for the product picker. Best-effort: the send still
  // works without it (the server matches by item name on confirm). When the
  // destination is the active branch its catalog is already local, so the
  // picker still works offline.
  useEffect(() => {
    // Which shop the loaded list belongs to. Without it a fast picker change
    // could match a product from the shop picked a moment before.
    let cancelled = false;

    if (!toStoreId) {
      setProducts([]);
      setProductsStoreId(null);
      setProductId(undefined);
      return () => {
        cancelled = true;
      };
    }

    const localOptions: StoreProductOption[] =
      toStoreId === store.id
        ? catalogProducts.map((product) => ({
            id: product.id,
            name: product.name,
            stock: product.stockQuantity,
            stockState: product.stockQuantity == null ? "untracked" : "tracked",
          }))
        : [];
    setProducts(localOptions);
    setProductsStoreId(toStoreId);
    setProductId((prev) =>
      prev && localOptions.some((option) => option.id === prev) ? prev : undefined,
    );

    if (OFFLINE_MODE) {
      setProductsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setProductsLoading(true);
    void (async () => {
      const res = await api.listStoreProducts(toStoreId);
      if (cancelled) return;
      setProductsLoading(false);
      if (res.ok) {
        setProducts(res.data);
        setProductsStoreId(toStoreId);
        setProductId((prev) =>
          prev && res.data.some((p) => p.id === prev) ? prev : undefined,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [catalogProducts, store.id, toStoreId]);

  const item = items.find((i) => i.id === itemId);
  const toStore = stores.find((s) => s.id === toStoreId);
  const product = products.find((p) => p.id === productId);
  const receiveUnit = receiveUnitChoice ?? item?.unit ?? "units";

  // The shop almost always sells this item under the same name. Match it as
  // soon as the destination list arrives so the transfer is tied to the exact
  // product the shop already has, instead of leaning on a later name match.
  useEffect(() => {
    if (!toStoreId || productsStoreId !== toStoreId) return;
    if (products.length === 0 || !item) return;
    const wanted = item.name.trim().toLowerCase();
    setProductId((prev) => {
      if (prev && products.some((p) => p.id === prev)) return prev;
      return products.find((p) => p.name.trim().toLowerCase() === wanted)?.id;
    });
  }, [item, products, productsStoreId, toStoreId]);

  const qty = Number.parseInt(quantity, 10);
  const validQty = Number.isInteger(qty) && qty >= 1 && !!item && qty <= item.totalStock;
  const receiveNum = receiveQty.trim() === "" ? qty : Number.parseInt(receiveQty, 10);
  const validReceiveQty = Number.isInteger(receiveNum) && receiveNum >= 1;
  const valid = !!item && !!toStoreId && validQty && validReceiveQty && !sending;

  const openPicker = (title: string, options: PickerOption[], onPick: (id: string) => void) => {
    feedbackTap();
    setPicker({ title, options, onPick });
  };

  const closePicker = () => setPicker(null);

  const submit = () => {
    if (!valid || !item || !toStoreId || !central) return;
    const actor = user
      ? { id: user.id, name: user.name, email: user.email }
      : null;
    if (!actor) return;

    setSending(true);
    const res = createCentralTransferLocal(
      central.id,
      central.name,
      {
        globalItemId: item.id,
        toStoreId,
        toStoreName: toStore?.name ?? "Branch",
        productId,
        quantity: qty,
        receiveQuantity: receiveNum,
        receiveUnit,
        notes: notes.trim() || undefined,
      },
      actor,
    );
    setSending(false);
    if (!res.ok) {
      Alert.alert("Could not transfer", res.error);
      return;
    }

    feedbackTap();
    void flushCentralOutbox(
      central.id,
      actor,
      stores.map((membership) => ({ id: membership.id })),
    );
    Alert.alert(
      "Transfer sent",
      `${qty} ${item.unit} ${item.name} left ${central.name} for ${toStore?.name ?? "the shop"}, where ${receiveNum} ${receiveUnit} ${receiveNum === 1 ? "was" : "were"} added to stock.${
        product ? ` It went to "${product.name}".` : ""
      } Nothing has to be confirmed.`,
      [{ text: "OK", onPress: () => router.back() }],
    );
  };

  if (!central) {
    return (
      <SafeAreaView edges={["top"]} style={formStyles.screen}>
        <EditorToolbar title="Transfer" onClose={() => router.back()} onSave={() => {}} />
        <View style={styles.blocked}>
          <MaterialCommunityIcons name="crown-outline" size={44} color={colors.grey400} />
          <Text style={styles.blockedTitle}>Central Store not set up</Text>
          <Text style={styles.blockedText}>
            Open the Central Store once to create it, then transfer stock to your shops.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (destinations.length === 0) {
    return (
      <SafeAreaView edges={["top"]} style={formStyles.screen}>
        <EditorToolbar title="Transfer" onClose={() => router.back()} onSave={() => {}} />
        <View style={styles.blocked}>
          <Text style={styles.blockedTitle}>No branch shops yet</Text>
          <Text style={styles.blockedText}>Create a shop first, then transfer stock from the centre.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title="Transfer"
        dirty={valid}
        onClose={() => router.back()}
        onSave={() => void submit()}
      />

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <ScrollView contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.flowCard}>
            <View style={styles.flowSide}>
              <View style={styles.flowIcon}>
                <MaterialCommunityIcons name="crown-outline" size={20} color={colors.white} />
              </View>
              <Text style={styles.flowLabel}>FROM</Text>
              <Text style={styles.flowName} numberOfLines={1}>
                {central.name}
              </Text>
              <Text style={styles.flowHint}>Central Store</Text>
            </View>

            <Ionicons name="arrow-forward" size={22} color={colors.grey500} />

            <View style={styles.flowSide}>
              <View style={[styles.flowIcon, styles.flowIconBranch]}>
                <MaterialCommunityIcons name="store-outline" size={20} color={colors.primary} />
              </View>
              <Text style={styles.flowLabel}>TO</Text>
              <Text style={styles.flowName} numberOfLines={1}>
                {toStore?.name ?? "Choose shop"}
              </Text>
              <Text style={styles.flowHint}>{toStore ? "Destination" : "Tap below"}</Text>
            </View>
          </View>

          <PickerCard
            label="CENTRAL ITEM *"
            value={item ? `${item.name} (${item.totalStock} ${item.unit})` : undefined}
            hint="Choose what to transfer"
            valid={!!item}
            onPress={() =>
              openPicker(
                "Central item",
                items.map((i) => ({ id: i.id, label: i.name, hint: `${i.totalStock} ${i.unit}` })),
                (id) => {
                  setItemId(id);
                  // The conversion belongs to one item at one shop, so a new
                  // item starts from "same as sent" again.
                  setReceiveQty("");
                  setReceiveUnitChoice(undefined);
                  closePicker();
                },
              )
            }
          />

          <PickerCard
            label="TO SHOP *"
            value={toStore?.name}
            hint="Choose the branch that receives it"
            valid={!!toStoreId}
            onPress={() => {
              if (destinations.length === 0) {
                Alert.alert("No shop", "Create a branch shop first.");
                return;
              }
              openPicker(
                "Receiving shop",
                destinations.map((s) => ({ id: s.id, label: s.name, hint: s.role })),
                (id) => {
                  setToStoreId(id);
                  closePicker();
                },
              );
            }}
          />

          <PickerCard
            label="DESTINATION PRODUCT (OPTIONAL)"
            value={product?.name}
            hint={productsLoading ? "Loading products..." : toStoreId ? "Match by name if empty" : "Pick a shop first"}
            valid={true}
            onPress={() => {
              if (!toStoreId || products.length === 0) {
                Alert.alert(
                  "No product list",
                  "The server will match by item name when the branch confirms. Create a matching product there first.",
                );
                return;
              }
              openPicker(
                "Destination product",
                [{ id: "__none__", label: "Match by name (auto)", hint: "default" }].concat(
                  products.map((p) => ({
                    id: p.id,
                    label: p.name,
                    hint: p.stock === null ? "untracked" : `${p.stock}`,
                  })),
                ),
                (id) => {
                  setProductId(id === "__none__" ? undefined : id);
                  closePicker();
                },
              );
            }}
          />

          <FieldCard
            label={`QUANTITY (${item?.unit ?? "units"}) *`}
            hint={item ? `Up to ${item.totalStock}` : "Choose an item first"}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
            decimals={false}
            showTick={false}
          />
          {item && quantity.trim() !== "" && !validQty && (
            <Text style={styles.warn}>
              Enter a whole number from 1 to {item.totalStock} ({item.unit} available).
            </Text>
          )}

          <FieldCard
            label={`SHOP RECEIVES (${receiveUnit}) *`}
            hint={
              item && quantity.trim() !== ""
                ? `${quantity} ${item.unit} becomes this much on their shelf`
                : "How much stock the shop gains. Leave empty to match the quantity."
            }
            value={receiveQty}
            onChangeText={setReceiveQty}
            keyboardType="numeric"
            decimals={false}
            showTick={false}
          />
          <View style={styles.unitCard}>
            <Text style={styles.unitLabel}>THE SHOP COUNTS IN</Text>
            <View style={styles.chipRow}>
              {CENTRAL_UNITS.map((u) => (
                <Pressable
                  key={u}
                  style={[styles.chip, receiveUnit === u && styles.chipActive]}
                  onPress={() => {
                    feedbackTap();
                    setReceiveUnitChoice(u);
                  }}
                >
                  <Text style={[styles.chipText, receiveUnit === u && { color: colors.white }]}>
                    {u}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {item && quantity.trim() !== "" && validQty && (
            <Text style={styles.rate}>
              {qty} {item.unit} {item.name} → {receiveNum} {receiveUnit} at {toStore?.name ?? "the shop"}
            </Text>
          )}
          {receiveQty.trim() !== "" && !validReceiveQty && (
            <Text style={styles.warn}>Enter a whole number of at least 1.</Text>
          )}

          <FieldCard
            label="Note"
            hint="Optional - e.g. driver, order ref"
            value={notes}
            onChangeText={setNotes}
            showTick={false}
          />

          {sending && <ActivityIndicator style={{ marginTop: 12 }} color={colors.primary} />}
        </ScrollView>
      )}

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
  flowCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E6D3A3",
    padding: 14,
    marginBottom: 14,
    gap: 8,
  },
  flowSide: { flex: 1, alignItems: "center" },
  flowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#B8860B",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  flowIconBranch: { backgroundColor: colors.blue50 },
  flowLabel: { fontSize: 10, fontWeight: "800", color: colors.grey500, letterSpacing: 0.7 },
  flowName: { fontSize: 14, fontWeight: "800", color: colors.grey900, marginTop: 2, maxWidth: 130 },
  flowHint: { fontSize: 11, color: colors.grey500, marginTop: 1 },
  unitCard: { backgroundColor: colors.card, borderRadius: 4, padding: 12, marginBottom: 8, elevation: 1 },
  unitLabel: { fontSize: 12, fontWeight: "700", color: colors.grey600, letterSpacing: 0.6, marginBottom: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: colors.white,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.grey700 },
  rate: { fontSize: 12.5, fontWeight: "700", color: colors.dkGreen, marginBottom: 8, marginLeft: 4 },
  warn: { color: colors.red500, fontSize: 12, fontWeight: "600", marginBottom: 8, marginLeft: 4 },
  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  blockedTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 10 },
  blockedText: { color: colors.grey600, textAlign: "center", lineHeight: 20 },
});
