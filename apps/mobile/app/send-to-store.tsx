import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, PickerCard, formStyles } from "@/components/form";
import { PickerSheet, type PickerOption } from "@/components/PickerSheet";
import { api, type CentralItem, type StoreProductOption } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { feedbackTap } from "@/lib/feedback";

/**
 * Send-to-store picker: choose a central item, the sending and receiving
 * branches, the destination product (optional — the server matches by name
 * when omitted), and a whole-number quantity.
 */
export default function SendToStoreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ globalItemId?: string }>();
  const { stores, activeStore } = useAuth();
  const senderStores = useMemo(
    () => stores.filter((s) => s.role === "owner" || s.role === "manager"),
    [stores],
  );

  const [items, setItems] = useState<CentralItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [itemId, setItemId] = useState<string | undefined>(params.globalItemId);
  const [fromStoreId, setFromStoreId] = useState<string | undefined>(
    senderStores.find((s) => s.id === activeStore?.id)?.id ?? senderStores[0]?.id,
  );
  const [toStoreId, setToStoreId] = useState<string | undefined>(undefined);
  const [productId, setProductId] = useState<string | undefined>(undefined);
  const [products, setProducts] = useState<StoreProductOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");

  const [picker, setPicker] = useState<null | { title: string; options: PickerOption[]; onPick: (id: string) => void }>(null);

  useEffect(() => {
    void (async () => {
      const res = await api.listCentralItems();
      setLoading(false);
      if (!res.ok) {
        Alert.alert("Could not load central stock", res.error.message);
        return;
      }
      setItems(res.data);
      if (params.globalItemId && !res.data.some((i) => i.id === params.globalItemId)) {
        setItemId(undefined);
      }
    })();
  }, [params.globalItemId]);

  // Destination catalog for the product picker. Best-effort: the send still
  // works without it (the server matches by item name on confirm).
  useEffect(() => {
    if (!toStoreId) {
      setProducts([]);
      setProductId(undefined);
      return;
    }
    setProductsLoading(true);
    void (async () => {
      const res = await api.listStoreProducts(toStoreId);
      setProductsLoading(false);
      if (res.ok) {
        setProducts(res.data);
        setProductId((prev) => (prev && res.data.some((p) => p.id === prev) ? prev : undefined));
      } else {
        setProducts([]);
      }
    })();
  }, [toStoreId]);

  const item = items.find((i) => i.id === itemId);
  const fromStore = stores.find((s) => s.id === fromStoreId);
  const toStore = stores.find((s) => s.id === toStoreId);
  const product = products.find((p) => p.id === productId);

  const qty = Number.parseInt(quantity, 10);
  const validQty =
    Number.isInteger(qty) && qty >= 1 && !!item && qty <= item.totalStock;
  const valid =
    !!item && !!fromStoreId && !!toStoreId && fromStoreId !== toStoreId && validQty && !sending;

  const openPicker = (title: string, options: PickerOption[], onPick: (id: string) => void) => {
    feedbackTap();
    setPicker({ title, options, onPick });
  };

  const closePicker = () => setPicker(null);

  const submit = async () => {
    if (!valid || !item || !fromStoreId || !toStoreId) return;
    setSending(true);
    const res = await api.createAllocation({
      globalItemId: item.id,
      fromStoreId,
      toStoreId,
      productId,
      quantity: qty,
      notes: notes.trim() || undefined,
    });
    setSending(false);
    if (!res.ok) {
      Alert.alert("Could not send", res.error.message);
      return;
    }
    feedbackTap();
    Alert.alert("Sent", `${qty} ${item.unit} ${item.name} sent to ${toStore?.name ?? "store"}. They confirm it on arrival.`, [
      { text: "OK", onPress: () => router.back() },
    ]);
  };

  if (senderStores.length === 0) {
    return (
      <SafeAreaView edges={["top"]} style={formStyles.screen}>
        <EditorToolbar title="Send to store" onClose={() => router.back()} onSave={() => {}} />
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Only owners and managers can send stock.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title="Send to store"
        dirty={valid}
        onClose={() => router.back()}
        onSave={() => void submit()}
      />

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <ScrollView contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled">
          <PickerCard
            label="CENTRAL ITEM *"
            value={item ? `${item.name} (${item.totalStock} ${item.unit})` : undefined}
            hint="Choose what to send"
            valid={!!item}
            onPress={() =>
              openPicker(
                "Central item",
                items.map((i) => ({ id: i.id, label: i.name, hint: `${i.totalStock} ${i.unit}` })),
                (id) => {
                  setItemId(id);
                  closePicker();
                },
              )
            }
          />

          <PickerCard
            label="FROM (SENDING STORE) *"
            value={fromStore?.name}
            hint="Choose the hub store"
            valid={!!fromStoreId}
            onPress={() =>
              openPicker(
                "Sending store",
                senderStores.map((s) => ({ id: s.id, label: s.name, hint: s.role })),
                (id) => {
                  setFromStoreId(id);
                  if (id === toStoreId) setToStoreId(undefined);
                  closePicker();
                },
              )
            }
          />

          <PickerCard
            label="TO (RECEIVING STORE) *"
            value={toStore?.name}
            hint="Choose the branch"
            valid={!!toStoreId && fromStoreId !== toStoreId}
            onPress={() => {
              const options = stores
                .filter((s) => s.id !== fromStoreId)
                .map((s) => ({ id: s.id, label: s.name, hint: s.role }));
              if (options.length === 0) {
                Alert.alert("No other store", "You need access to at least two stores to send stock.");
                return;
              }
              openPicker("Receiving store", options, (id) => {
                setToStoreId(id);
                closePicker();
              });
            }}
          />
          {fromStoreId && toStoreId && fromStoreId === toStoreId && (
            <Text style={styles.warn}>Sending and receiving stores must differ.</Text>
          )}

          <PickerCard
            label="DESTINATION PRODUCT (OPTIONAL)"
            value={product?.name}
            hint={productsLoading ? "Loading products…" : toStoreId ? "Match by name if empty" : "Pick a store first"}
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
            label="Note"
            hint="Optional — e.g. order ref, driver"
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
  warn: { color: colors.red500, fontSize: 12, fontWeight: "600", marginBottom: 8, marginLeft: 4 },
  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30 },
  blockedText: { color: colors.grey600, textAlign: "center" },
});
