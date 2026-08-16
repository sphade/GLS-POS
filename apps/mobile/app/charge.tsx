import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { colors, formatMoney, strings } from "@/constants/theme";
import { useCart } from "@/lib/cart";
import { useCatalog } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { feedbackSaleComplete, feedbackTap } from "@/lib/feedback";

/**
 * Payment methods. Cash is settled on the spot; Card and Transfer are settled
 * *after* the customer gets the receipt (they pay against it), so those create
 * an unpaid receipt that's marked paid once the money lands.
 */
const MODES: { key: string; label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; settlesNow: boolean }[] = [
  { key: "Cash", label: "Cash", icon: "cash", settlesNow: true },
  { key: "Card", label: "Card", icon: "credit-card-outline", settlesNow: false },
  { key: "Transfer", label: "Transfer", icon: "bank-transfer", settlesNow: false },
  { key: "Credit", label: "Credit\n(pay later)", icon: "account-clock-outline", settlesNow: false },
];

export default function ChargeScreen() {
  const router = useRouter();
  const { total, entries, completeSale } = useCart();
  const { recordSale } = useCatalog();
  const { store } = useStore();
  const { user } = useAuth();
  const [mode, setMode] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  const selectedMode = MODES.find((m) => m.key === mode);

  const onCharge = () => {
    if (!mode) return;
    if (mode === "Cash") {
      router.push("/cash-payment");
      return;
    }
    feedbackSaleComplete();
    // Snapshot cart lines before completeSale clears them, then decrement stock.
    const lines = Object.values(entries).map((e) => ({ productId: e.item.id, qty: e.qty }));
    const receipt = completeSale({
      mode,
      customerName: name.trim() || null,
      // Card/transfer/credit: the customer pays after getting the receipt.
      status: "unpaid",
      storeName: store.name,
      storeReference: store.reference,
      servedBy: user?.name ?? "Staff",
    });
    recordSale(lines, receipt.id);
    router.replace(`/sale-success?id=${receipt.id}` as Href);
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>{strings.charge}</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Text style={styles.sectionTitle}>{strings.customerDetailsOptional.toUpperCase()}</Text>
        <View style={styles.card}>
          <View style={styles.phoneRow}>
            <TextInput style={styles.codeInput} value="+234" editable={false} />
            <TextInput
              style={styles.input}
              placeholder="Mobile Number"
              placeholderTextColor={colors.hint}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
            <Pressable style={styles.findBtn} onPress={feedbackTap}>
              <Ionicons name="search" size={20} color={colors.white} />
            </Pressable>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Customer name"
            placeholderTextColor={colors.hint}
            value={name}
            onChangeText={setName}
          />
          {showMore && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={colors.hint}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                style={styles.input}
                placeholder="Address"
                placeholderTextColor={colors.hint}
                value={address}
                onChangeText={setAddress}
              />
            </>
          )}
          <Pressable
            style={styles.moreToggle}
            onPress={() => {
              feedbackTap();
              setShowMore((v) => !v);
            }}
          >
            <Ionicons name={showMore ? "chevron-up" : "chevron-down"} size={22} color={colors.primary} />
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>{strings.selectPaymentMode}</Text>
        <View style={styles.card}>
          <View style={styles.modeGrid}>
            {MODES.map((m) => (
              <Pressable
                key={m.key}
                style={[styles.modeTile, mode === m.key && styles.modeTileActive]}
                onPress={() => {
                  feedbackTap();
                  setMode(m.key);
                }}
              >
                <MaterialCommunityIcons
                  name={m.icon}
                  size={30}
                  color={mode === m.key ? colors.white : colors.grey700}
                />
                <Text style={[styles.modeText, mode === m.key && { color: colors.white }]}>
                  {m.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Make the pay-after-receipt behaviour explicit before charging. */}
          {selectedMode && !selectedMode.settlesNow && (
            <View style={styles.unpaidNote}>
              <MaterialCommunityIcons name="information-outline" size={18} color={colors.primary} />
              <Text style={styles.unpaidNoteText}>
                Receipt prints as NOT PAID. Give it to the customer, then mark it paid once the{" "}
                {selectedMode.key.toLowerCase()} comes through.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {mode && (
        <Pressable style={styles.charge} onPress={onCharge}>
          <Text style={styles.chargeText}>
            {selectedMode?.settlesNow ? strings.charge : "PRINT RECEIPT"} {formatMoney(total, "NGN")}
          </Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.grey200 },
  header: {
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  headerBtn: { width: 48, alignItems: "center" },
  headerTitle: { color: colors.white, fontSize: 18, fontWeight: "700" },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.primary,
    textAlign: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  card: { backgroundColor: colors.card, marginHorizontal: 6, borderRadius: 4, padding: 10, elevation: 1 },
  phoneRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  codeInput: {
    width: 54,
    borderBottomWidth: 1,
    borderColor: colors.grey400,
    textAlign: "center",
    color: colors.grey800,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    borderBottomWidth: 1,
    borderColor: colors.grey400,
    paddingVertical: 8,
    color: colors.grey800,
    marginTop: 4,
  },
  findBtn: { backgroundColor: colors.primary, padding: 10, borderRadius: 3, elevation: 3 },
  moreToggle: { alignItems: "center", paddingTop: 6 },
  modeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "space-between" },
  modeTile: {
    width: "31%",
    backgroundColor: colors.grey200,
    borderRadius: 4,
    paddingVertical: 14,
    alignItems: "center",
    gap: 6,
    elevation: 1,
  },
  modeTileActive: { backgroundColor: colors.primary },
  modeText: { fontSize: 13, fontWeight: "700", color: colors.grey700, textAlign: "center" },
  unpaidNote: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.blue50,
    borderRadius: 4,
    padding: 10,
    marginTop: 10,
  },
  unpaidNoteText: { flex: 1, fontSize: 12, color: colors.primary, lineHeight: 17 },
  charge: {
    margin: 10,
    height: 52,
    borderRadius: 6,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
  },
  chargeText: { color: colors.white, fontSize: 18, fontWeight: "700" },
});
