import { useState } from "react";
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney, strings } from "@/constants/theme";
import { PosHeader } from "@/components/PosHeader";
import { displayItemName, useCart } from "@/lib/cart";
import { feedbackAddItem, feedbackError, feedbackTap } from "@/lib/feedback";

/**
 * Counter (billing) tab. With an empty cart it shows the NEW ORDER /
 * ADD NEW EXPENSE actions and the table-order count; once items are added it
 * becomes the running bill with a Charge button.
 */
export default function CounterScreen() {
  const router = useRouter();
  const { entries, subtotal, taxTotal, total, add, remove, count, clear, heldOrders, holdOrder, resumeHeldOrder, discardHeldOrder } =
    useCart();
  const list = Object.values(entries);

  /** Name prompt for parking the current cart as an open bill. */
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdName, setHoldName] = useState("");
  /** The open bill currently loaded for editing (so KEEP re-saves it as-is). */
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);

  // A cleared/emptied cart is no longer editing a specific bill.
  if (list.length === 0 && editing) setEditing(null);

  const confirmHold = () => {
    holdOrder(holdName);
    setHoldName("");
    setHoldOpen(false);
    feedbackTap();
  };

  /** Re-park the bill being edited under its original name, no prompt. */
  const keepEditing = () => {
    if (!editing) return;
    feedbackTap();
    holdOrder(editing.label, undefined, editing.id);
    setEditing(null);
  };

  const onResume = (id: string) => {
    if (list.length > 0) {
      feedbackError();
      Alert.alert("Finish the current order first", "Charge or clear the open cart before resuming another bill.");
      return;
    }
    const bill = heldOrders.find((h) => h.id === id);
    feedbackTap();
    resumeHeldOrder(id);
    if (bill) setEditing({ id: bill.id, label: bill.label });
  };

  const onDiscard = (id: string, label: string) => {
    Alert.alert(`Discard "${label}"?`, "This open bill will be removed without charging.", [
      { text: "Cancel", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => discardHeldOrder(id) },
    ]);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.headerRegion}>
        <PosHeader />
      </SafeAreaView>

      {list.length === 0 ? (
        <ScrollView contentContainerStyle={{ padding: 8 }}>
          <Pressable
            style={styles.actionCard}
            onPress={() => {
              feedbackTap();
              router.navigate("/(tabs)");
            }}
            android_ripple={{ color: "#00000010" }}
          >
            <View style={styles.plusCircle}>
              <Ionicons name="add" size={26} color={colors.white} />
            </View>
            <Text style={styles.actionTitle}>NEW ORDER</Text>
          </Pressable>

          <Pressable
            style={styles.expenseCard}
            onPress={() => {
              feedbackTap();
              router.push("/expense-categories");
            }}
            android_ripple={{ color: "#00000010" }}
          >
            <MaterialCommunityIcons name="hand-coin" size={26} color={colors.green} />
            <Text style={styles.expenseTitle}>ADD NEW EXPENSE</Text>
          </Pressable>

          {heldOrders.length > 0 && (
            <>
              <Text style={styles.openBillsTitle}>OPEN BILLS ({heldOrders.length})</Text>
              {heldOrders.map((bill) => (
                <Pressable
                  key={bill.id}
                  style={styles.billCard}
                  onPress={() => onResume(bill.id)}
                  onLongPress={() => onDiscard(bill.id, bill.label)}
                  android_ripple={{ color: "#00000010" }}
                >
                  <View style={styles.billIcon}>
                    <MaterialCommunityIcons name="clipboard-text-clock-outline" size={24} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.billName} numberOfLines={1}>
                      {bill.label}
                    </Text>
                    <Text style={styles.billMeta}>
                      {bill.itemCount} item{bill.itemCount === 1 ? "" : "s"} ·{" "}
                      {new Date(bill.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </Text>
                  </View>
                  <Text style={styles.billTotal}>{formatMoney(bill.total, bill.currency)}</Text>
                </Pressable>
              ))}
              <Text style={styles.openBillsHint}>Tap to resume &amp; charge · long-press to discard</Text>
            </>
          )}
        </ScrollView>
      ) : (
        <>
          <View style={styles.billHeader}>
            <Text style={styles.billHeaderText}>
              {editing ? `Editing: ${editing.label}` : `${count} item(s)`}
            </Text>
            <Pressable
              onPress={() => {
                feedbackTap();
                clear();
                setEditing(null);
              }}
            >
              <Text style={styles.clear}>CLEAR</Text>
            </Pressable>
          </View>

          <FlatList
            data={list}
            keyExtractor={(entry) => entry.lineId}
            contentContainerStyle={{ padding: 8, paddingBottom: 8 }}
            renderItem={({ item: entry }) => {
              const unitPrice = entry.variant?.price ?? entry.item.price;
              return (
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>
                      {displayItemName(entry.item.name, entry.variant?.name)}
                    </Text>
                    <Text style={styles.unitPrice}>{formatMoney(unitPrice, entry.item.currency)}</Text>
                  </View>
                  <View style={styles.stepper}>
                    <Pressable
                      style={[styles.stepBtn, styles.stepMinus]}
                      onPress={() => {
                        feedbackTap();
                        remove(entry.lineId);
                      }}
                    >
                      <Ionicons name="remove" size={22} color={colors.white} />
                    </Pressable>
                    <Text style={styles.qty}>{entry.qty}</Text>
                    <Pressable
                      style={[styles.stepBtn, styles.stepPlus]}
                      onPress={() => {
                        feedbackAddItem();
                        add(entry.item, entry.variant);
                      }}
                    >
                      <Ionicons name="add" size={22} color={colors.white} />
                    </Pressable>
                  </View>
                  <Text style={styles.lineTotal}>
                    {formatMoney(unitPrice * entry.qty, entry.item.currency)}
                  </Text>
                </View>
              );
            }}
          />

          <View style={styles.totalsCard}>
            <TotalRow label={strings.subtotal} value={formatMoney(subtotal)} />
            {taxTotal > 0 && <TotalRow label="Tax" value={formatMoney(taxTotal)} />}
            <View style={styles.divider} />
            <TotalRow label={strings.grandTotal} value={formatMoney(total)} bold />
          </View>

          <View style={styles.actionRow}>
            <Pressable
              style={styles.hold}
              onPress={() => {
                if (editing) {
                  keepEditing();
                } else {
                  feedbackTap();
                  setHoldOpen(true);
                }
              }}
            >
              <MaterialCommunityIcons
                name={editing ? "content-save-outline" : "clock-outline"}
                size={20}
                color={colors.primary}
              />
              <Text style={styles.holdText}>{editing ? "KEEP BILL" : "HOLD"}</Text>
            </Pressable>
            <Pressable
              style={styles.charge}
              onPress={() => {
                feedbackTap();
                router.push("/charge");
              }}
            >
              <Text style={styles.chargeText}>
                {strings.charge} {formatMoney(total)}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      {/* Name prompt for parking the cart as an open bill. */}
      <Modal visible={holdOpen} transparent animationType="fade" onRequestClose={() => setHoldOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setHoldOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Hold this bill</Text>
            <Text style={styles.modalHint}>Give it a name so you can find it to charge later.</Text>
            <TextInput
              style={styles.modalInput}
              value={holdName}
              onChangeText={setHoldName}
              placeholder="e.g. Table 4, John, Blue cap"
              placeholderTextColor={colors.grey500}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={confirmHold}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setHoldOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSave} onPress={confirmHold}>
                <Text style={styles.modalSaveText}>Hold bill</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, bold && styles.totalBold]}>{label}</Text>
      <Text style={[styles.totalValue, bold && styles.totalBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  headerRegion: { backgroundColor: colors.primary },

  actionCard: {
    backgroundColor: colors.card,
    borderRadius: 3,
    paddingVertical: 26,
    alignItems: "center",
    marginBottom: 8,
    elevation: 1,
  },
  plusCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: { fontSize: 18, fontWeight: "700", color: colors.grey900, marginTop: 18 },

  expenseCard: {
    backgroundColor: colors.card,
    borderRadius: 3,
    paddingVertical: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginBottom: 16,
    elevation: 1,
  },
  expenseTitle: { fontSize: 17, fontWeight: "600", color: colors.grey900 },

  openBillsTitle: { fontSize: 12, fontWeight: "800", color: colors.grey600, letterSpacing: 0.6, marginLeft: 4, marginBottom: 8 },
  openBillsHint: { fontSize: 12, color: colors.grey500, textAlign: "center", marginTop: 6 },
  billCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 4,
    padding: 12,
    marginBottom: 8,
    elevation: 1,
  },
  billIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.blue50,
    alignItems: "center",
    justifyContent: "center",
  },
  billName: { fontSize: 16, fontWeight: "700", color: colors.grey900 },
  billMeta: { fontSize: 12, color: colors.grey600, marginTop: 2 },
  billTotal: { fontSize: 16, fontWeight: "800", color: colors.primary },

  billHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  billHeaderText: { fontSize: 14, color: colors.grey600, fontWeight: "600" },
  clear: { color: colors.red500, fontWeight: "700", fontSize: 13 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 3,
    padding: 12,
    marginBottom: 8,
    gap: 10,
    elevation: 1,
  },
  name: { fontSize: 15, color: colors.grey900, fontWeight: "600" },
  unitPrice: { fontSize: 13, color: colors.grey600, marginTop: 2 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepBtn: {
    width: 38,
    height: 38,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    elevation: 1,
  },
  stepMinus: { backgroundColor: colors.actionRemove },
  stepPlus: { backgroundColor: colors.actionAdd },
  qty: { minWidth: 24, textAlign: "center", fontSize: 16, fontWeight: "800", color: colors.grey900 },
  lineTotal: { width: 78, textAlign: "right", fontWeight: "700", color: colors.grey900 },

  totalsCard: { backgroundColor: colors.card, margin: 8, marginTop: 0, borderRadius: 3, padding: 12, elevation: 1 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { color: colors.grey600, fontSize: 14 },
  totalValue: { color: colors.grey800, fontSize: 14, fontWeight: "600" },
  totalBold: { fontSize: 17, fontWeight: "800", color: colors.primary },
  divider: { height: 1, backgroundColor: colors.grey300, marginVertical: 6 },

  actionRow: { flexDirection: "row", gap: 8, margin: 8, marginTop: 0 },
  hold: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 4,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.primary,
    elevation: 1,
  },
  holdText: { color: colors.primary, fontSize: 16, fontWeight: "800", letterSpacing: 0.5 },
  charge: {
    flex: 1,
    height: 52,
    borderRadius: 4,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
  },
  chargeText: { color: colors.white, fontSize: 18, fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: "#00000066", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 380, backgroundColor: colors.white, borderRadius: 10, padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: "800", color: colors.grey900 },
  modalHint: { fontSize: 13, color: colors.grey600, marginTop: 4, marginBottom: 14 },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.grey900,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  modalCancel: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8 },
  modalCancelText: { color: colors.grey700, fontSize: 15, fontWeight: "700" },
  modalSave: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 8, backgroundColor: colors.primary },
  modalSaveText: { color: colors.white, fontSize: 15, fontWeight: "800" },
});
