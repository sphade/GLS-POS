import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, PickerCard, formStyles } from "@/components/form";
import { PickerSheet, type PickerOption } from "@/components/PickerSheet";
import type { CentralItem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  centralItems,
  createCentralTransferLocal,
  flushCentralOutbox,
  refreshCentralItems,
  useCentralRevision,
} from "@/lib/central";
import { feedbackTap } from "@/lib/feedback";

/**
 * Transfer stock from the central store to one branch.
 *
 * The form asks only three things: which central item, which shop, and how
 * much. There is no destination product picker and no unit conversion: 80 kg of
 * beans sent is 80 kg of beans received. The delivery is recorded in the shop's
 * own Stock Room, not in its menu, so the branch does not need a matching
 * product for the transfer to work.
 */
export default function SendToStoreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ globalItemId?: string }>();
  const { stores, user } = useAuth();
  const central = stores.find((s) => s.isCentral);
  const destinations = stores.filter((s) => !s.isCentral);
  const revision = useCentralRevision();

  const [items, setItems] = useState<CentralItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [itemId, setItemId] = useState<string | undefined>(params.globalItemId);
  const [toStoreId, setToStoreId] = useState<string | undefined>(undefined);
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");

  const [picker, setPicker] = useState<null | {
    title: string;
    options: PickerOption[];
    onPick: (id: string) => void;
  }>(null);

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

  const item = items.find((i) => i.id === itemId);
  const toStore = stores.find((s) => s.id === toStoreId);

  const qty = Number.parseInt(quantity, 10);
  const validQty = Number.isInteger(qty) && qty >= 1 && !!item && qty <= item.totalStock;
  const valid = !!item && !!toStoreId && validQty && !sending;

  const openPicker = (title: string, options: PickerOption[], onPick: (id: string) => void) => {
    feedbackTap();
    setPicker({ title, options, onPick });
  };

  const closePicker = () => setPicker(null);

  const submit = () => {
    if (!valid || !item || !toStoreId || !central) return;
    const actor = user ? { id: user.id, name: user.name, email: user.email } : null;
    if (!actor) return;

    setSending(true);
    const res = createCentralTransferLocal(
      central.id,
      central.name,
      {
        globalItemId: item.id,
        toStoreId,
        toStoreName: toStore?.name ?? "Branch",
        quantity: qty,
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
      `${qty} ${item.unit} ${item.name} is now in ${toStore?.name ?? "the shop"}'s Stock Room.`,
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

          <FieldCard
            label={`QUANTITY (${item?.unit ?? "units"}) *`}
            hint={item ? `Up to ${item.totalStock} available` : "Choose an item first"}
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
  warn: { color: colors.red500, fontSize: 12, fontWeight: "600", marginBottom: 8, marginLeft: 4 },
  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  blockedTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 10 },
  blockedText: { color: colors.grey600, textAlign: "center", lineHeight: 20 },
});
