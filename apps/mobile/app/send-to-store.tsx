import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, PickerCard, formStyles } from "@/components/form";
import { PickerSheet, type PickerOption } from "@/components/PickerSheet";
import { api } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import { syncNow } from "@/lib/sync";
import { uid } from "@/lib/ids";
import { feedbackTap } from "@/lib/feedback";
import { DISPLAY_UNIT, formatQty, toBase } from "@/lib/stock-units";

/**
 * Send stock from the Central Store to one branch.
 *
 * Runs inside the Central Store, so the item list is simply this store's
 * ingredients. The server deducts the centre and credits the branch through
 * the two stores' Durable Objects; the branch gets the item under the same name
 * and unit, created on first delivery. Sending needs a connection because it
 * moves stock between two stores; the transfer id is minted here, so tapping
 * Send again after a dropped response can never send twice.
 */
export default function SendToStoreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ ingredientId?: string }>();
  const { store } = useStore();
  const { ingredients } = useCatalog();

  const [branches, setBranches] = useState<{ id: string; name: string }[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // One id per attempt: reused on retry, replaced after a success.
  const [transferId, setTransferId] = useState(() => uid("tx"));

  const [itemId, setItemId] = useState<string | undefined>(params.ingredientId);
  const [toStoreId, setToStoreId] = useState<string | undefined>(undefined);
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");

  const [picker, setPicker] = useState<null | {
    title: string;
    options: PickerOption[];
    onPick: (id: string) => void;
  }>(null);

  useEffect(() => {
    if (!store.isCentral) return;
    void (async () => {
      const res = await api.listTransferBranches(store.id);
      if (res.ok) setBranches(res.data);
      else setLoadError("Connect to the internet to load your shops.");
    })();
  }, [store.id, store.isCentral]);

  const item = ingredients.find((i) => i.id === itemId);
  const toStore = branches?.find((s) => s.id === toStoreId);

  const qty = item ? toBase(quantity, item.unit) : null;
  const validQty = !!item && qty !== null && qty >= 1 && qty <= item.stock;
  const valid = !!item && !!toStoreId && validQty && !sending;

  const openPicker = (title: string, options: PickerOption[], onPick: (id: string) => void) => {
    feedbackTap();
    setPicker({ title, options, onPick });
  };
  const closePicker = () => setPicker(null);

  const submit = async () => {
    if (!valid || !item || !toStoreId || qty === null) return;
    setSending(true);
    const res = await api.sendTransfer(store.id, {
      id: transferId,
      ingredientId: item.id,
      toStoreId,
      quantity: qty,
      note: notes.trim() || undefined,
    });
    setSending(false);
    if (!res.ok) {
      Alert.alert(
        "Could not send",
        res.error?.message ?? "Check your connection and try again. Nothing was sent twice.",
      );
      return;
    }
    feedbackTap();
    setTransferId(uid("tx"));
    // Pull the new balance and the transfer row straight away.
    void syncNow(store.id);
    Alert.alert(
      "Stock sent",
      `${formatQty(qty, item.unit)} of ${item.name} sent to ${toStore?.name ?? "the shop"}.`,
      [{ text: "OK", onPress: () => router.back() }],
    );
  };

  const blocked = (title: string, text: string) => (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar title="Send stock" onClose={() => router.back()} onSave={() => {}} />
      <View style={styles.blocked}>
        <MaterialCommunityIcons name="crown-outline" size={44} color={colors.grey400} />
        <Text style={styles.blockedTitle}>{title}</Text>
        <Text style={styles.blockedText}>{text}</Text>
      </View>
    </SafeAreaView>
  );

  if (!store.isCentral) {
    return blocked(
      "Switch to the Central Store",
      "Stock is sent from the Central Store. Pick it from the shop switcher first.",
    );
  }
  if (loadError) return blocked("Offline", loadError);
  if (branches && branches.length === 0) {
    return blocked("No branch shops yet", "Create a shop first, then send it stock from the centre.");
  }

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title="Send stock"
        dirty={valid}
        onClose={() => router.back()}
        onSave={() => void submit()}
      />

      {!branches ? (
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
                {store.name}
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
            label="ITEM *"
            value={item ? `${item.name} (${formatQty(item.stock, item.unit)})` : undefined}
            hint="Choose what to send"
            valid={!!item}
            onPress={() =>
              openPicker(
                "Central stock",
                ingredients
                  .filter((i) => i.stock > 0)
                  .map((i) => ({ id: i.id, label: i.name, hint: formatQty(i.stock, i.unit) })),
                (id) => {
                  setItemId(id);
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
            onPress={() =>
              openPicker(
                "Receiving shop",
                branches.map((s) => ({ id: s.id, label: s.name })),
                (id) => {
                  setToStoreId(id);
                  closePicker();
                },
              )
            }
          />

          <FieldCard
            label={`QUANTITY (${item ? DISPLAY_UNIT[item.unit] : "units"}) *`}
            hint={item ? `Up to ${formatQty(item.stock, item.unit)}` : "Choose an item first"}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
            showTick={false}
          />
          {item && quantity.trim() !== "" && !validQty ? (
            <Text style={styles.warn}>
              Enter an amount up to {formatQty(item.stock, item.unit)}.
            </Text>
          ) : null}

          <FieldCard
            label="Note"
            hint="Optional - e.g. driver, order ref"
            value={notes}
            onChangeText={setNotes}
            showTick={false}
          />

          {sending ? <ActivityIndicator style={{ marginTop: 12 }} color={colors.primary} /> : null}
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
  warn: { color: colors.red500, fontSize: 12, fontWeight: "600", marginBottom: 8, marginLeft: 4 },
  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  blockedTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 10 },
  blockedText: { color: colors.grey600, textAlign: "center", lineHeight: 20 },
});
