import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { colors, formatMoney, strings } from "@/constants/theme";
import { useCart } from "@/lib/cart";
import { useCatalog } from "@/lib/catalog";
import { runAtomic } from "@/lib/db";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { feedbackSaleComplete, feedbackTap } from "@/lib/feedback";

/**
 * The till's last screen: confirm the amount and take the money.
 *
 * A cash sale is the overwhelmingly common case, so it is the default and the
 * only visible action — one big CHARGE button, no payment-method grid, no
 * "amount received" form. The cashier already read the total to the customer;
 * asking them to type it back was a second chance to get it wrong.
 *
 * Non-cash sales are rare enough to live behind one small link. They keep the
 * payment mode on the receipt, which the day's payment-mix report relies on.
 */
const OTHER_MODES: {
  key: string;
  label: string;
  hint: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
}[] = [
  { key: "Transfer", label: "Transfer", hint: "Money sent to the account", icon: "bank-transfer" },
  { key: "Card", label: "Card", hint: "Paid on a card terminal", icon: "credit-card-outline" },
  { key: "Credit", label: "Credit", hint: "Customer pays later", icon: "account-clock-outline" },
];

export default function ChargeScreen() {
  const router = useRouter();
  const { total, entries, completeSale } = useCart();
  const { recordSale } = useCatalog();
  const { store } = useStore();
  const { can, user } = useAuth();
  const canSell = can("sale:create");

  const [name, setName] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/counter" as Href);
  };

  if (!canSell) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={goBack} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.white} />
          </Pressable>
          <Text style={styles.headerTitle}>{strings.charge}</Text>
          <View style={styles.headerBtn} />
        </View>
        <Text style={styles.blockedText}>
          Your role isn't allowed to take payment. Ask an owner or manager for access.
        </Text>
      </SafeAreaView>
    );
  }

  const itemCount = Object.values(entries).reduce((sum, entry) => sum + entry.qty, 0);
  const canCharge = total > 0 && !busy;

  /**
   * Writes the receipt, its stock movements, the audit entry and the consumed
   * table ticket in one transaction. `busy` also stops a double tap from
   * banking two receipts for one bill.
   */
  const finish = (mode: string) => {
    if (!canCharge) return;
    setBusy(true);

    const lines = Object.values(entries).map((e) => ({
      productId: e.item.id,
      variantId: e.variant?.id,
      qty: e.qty,
    }));

    const receipt = (() => {
      try {
        return runAtomic(() => {
          const sale = completeSale({
            mode,
            customerName: name.trim() || null,
            status: "paid",
            storeName: store.name,
            storeReference: store.reference,
            servedBy: user?.name ?? "Staff",
          });
          recordSale(lines, sale.id);
          return sale;
        });
      } catch (error) {
        setBusy(false);
        Alert.alert(
          "Sale not saved",
          (error as Error)?.message || "The till could not write this sale. Nothing was charged — try again.",
        );
        return null;
      }
    })();

    if (!receipt) return;

    feedbackSaleComplete();
    setOtherOpen(false);
    router.replace(`/sale-success?id=${receipt.id}` as Href);
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={goBack} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>{strings.charge}</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>TOTAL TO CHARGE</Text>
          <Text style={styles.totalValue} numberOfLines={1} adjustsFontSizeToFit>
            {formatMoney(total, store.currency)}
          </Text>
          <Text style={styles.totalMeta}>
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </Text>
        </View>

        <View style={styles.nameCard}>
          <TextInput
            style={styles.input}
            placeholder="Customer name (optional)"
            placeholderTextColor={colors.hint}
            value={name}
            onChangeText={setName}
            returnKeyType="done"
          />
        </View>

        <Pressable
          style={[styles.charge, !canCharge && { opacity: 0.55 }]}
          onPress={() => finish("Cash")}
          disabled={!canCharge}
          accessibilityRole="button"
          accessibilityLabel={`Charge ${formatMoney(total, store.currency)} as a cash sale`}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={22} color={colors.white} />
              <Text style={styles.chargeText}>
                CHARGE {formatMoney(total, store.currency)}
              </Text>
            </>
          )}
        </Pressable>
        <Text style={styles.confirmHint}>Cash sale · tap once to confirm</Text>

        <Pressable
          style={styles.otherLink}
          hitSlop={10}
          onPress={() => {
            feedbackTap();
            setOtherOpen(true);
          }}
        >
          <Text style={styles.otherLinkText}>Paid another way?</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={otherOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOtherOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOtherOpen(false)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.sheetTitle}>How was it paid?</Text>
            <Text style={styles.sheetHint}>
              The sale is recorded under this method for the payment report.
            </Text>
            {OTHER_MODES.map((option) => (
              <Pressable
                key={option.key}
                style={styles.sheetRow}
                onPress={() => {
                  feedbackTap();
                  finish(option.key);
                }}
              >
                <MaterialCommunityIcons name={option.icon} size={22} color={colors.primary} />
                <View style={styles.sheetRowCopy}>
                  <Text style={styles.sheetRowTitle}>{option.label}</Text>
                  <Text style={styles.sheetRowHint}>{option.hint}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.grey400} />
              </Pressable>
            ))}
            <Pressable style={styles.sheetCancel} onPress={() => setOtherOpen(false)}>
              <Text style={styles.sheetCancelText}>CANCEL</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.grey200 },
  content: {
    paddingHorizontal: 12,
    paddingTop: 18,
    paddingBottom: 24,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  header: {
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  headerBtn: { width: 48, alignItems: "center" },
  headerTitle: { color: colors.white, fontSize: 18, fontWeight: "700" },

  totalCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    paddingVertical: 28,
    paddingHorizontal: 18,
    alignItems: "center",
    elevation: 2,
  },
  totalLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    color: colors.grey600,
  },
  totalValue: {
    fontSize: 46,
    fontWeight: "800",
    color: colors.primaryDark,
    marginTop: 6,
  },
  totalMeta: { fontSize: 13.5, color: colors.grey600, marginTop: 6 },

  nameCard: {
    backgroundColor: colors.card,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 14,
    elevation: 1,
  },
  input: {
    paddingVertical: 10,
    color: colors.grey800,
    fontSize: 15,
  },

  charge: {
    flexDirection: "row",
    gap: 8,
    marginTop: 22,
    minHeight: 64,
    borderRadius: 8,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
  },
  chargeText: { color: colors.white, fontSize: 20, fontWeight: "800", letterSpacing: 0.4 },
  confirmHint: {
    textAlign: "center",
    color: colors.grey600,
    fontSize: 12.5,
    marginTop: 8,
  },

  otherLink: { alignSelf: "center", marginTop: 26, paddingVertical: 6 },
  otherLinkText: {
    color: colors.primary,
    fontSize: 13.5,
    fontWeight: "700",
    textDecorationLine: "underline",
  },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 16,
    paddingBottom: 22,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.grey900 },
  sheetHint: { fontSize: 12.5, color: colors.grey600, marginTop: 4, marginBottom: 12 },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.grey300,
  },
  sheetRowCopy: { flex: 1 },
  sheetRowTitle: { fontSize: 15.5, fontWeight: "700", color: colors.grey900 },
  sheetRowHint: { fontSize: 12.5, color: colors.grey600, marginTop: 1 },
  sheetCancel: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  sheetCancelText: { fontSize: 13.5, fontWeight: "800", color: colors.grey600, letterSpacing: 0.5 },

  blockedText: {
    flex: 1,
    textAlign: "center",
    textAlignVertical: "center",
    paddingHorizontal: 32,
    color: colors.grey600,
    fontSize: 15,
  },
});
