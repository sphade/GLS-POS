import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";

export default function BusinessSettingsScreen() {
  const router = useRouter();
  const { store } = useStore();
  const { role, refresh } = useAuth();
  const [form, setForm] = useState({ name: "", currency: "NGN", address: "", phone: "", receiptHeader: "", receiptFooter: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { void (async () => {
    const res = await api.getBusiness(store.id);
    if (res.ok) setForm({ name: res.data.name, currency: res.data.currency, address: res.data.address ?? "", phone: res.data.phone ?? "", receiptHeader: res.data.receiptHeader ?? "", receiptFooter: res.data.receiptFooter ?? "" });
    else Alert.alert("Could not load business", res.error.message);
    setLoading(false);
  })(); }, [store.id]);

  const field = (key: keyof typeof form, value: string) => setForm((p) => ({ ...p, [key]: value }));
  const save = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    const res = await api.updateBusiness(store.id, form);
    setSaving(false);
    if (!res.ok) return Alert.alert("Could not save", res.error.message);
    await refresh();
    Alert.alert("Saved", "Business settings updated.");
  };

  if (role !== "owner") return <SafeAreaView style={styles.root}><Header onBack={() => router.back()} /><View style={styles.center}><Ionicons name="lock-closed" size={42} color={colors.grey400} /><Text style={styles.muted}>Only the owner can edit business settings.</Text></View></SafeAreaView>;

  return <SafeAreaView style={styles.root}><Header onBack={() => router.back()} />
    {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} /> : <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text style={styles.section}>BUSINESS DETAILS</Text>
      <Card>
        <Field label="Business name" value={form.name} onChangeText={(v) => field("name", v)} />
        <Field label="Address" value={form.address} onChangeText={(v) => field("address", v)} multiline />
        <Field label="Phone" value={form.phone} onChangeText={(v) => field("phone", v)} keyboardType="phone-pad" />
        <Field label="Currency code" value={form.currency} onChangeText={(v) => field("currency", v.toUpperCase().slice(0, 3))} autoCapitalize="characters" />
      </Card>
      <Text style={styles.section}>RECEIPT</Text>
      <Card>
        <Field label="Header" value={form.receiptHeader} onChangeText={(v) => field("receiptHeader", v)} placeholder="Optional tagline or registration number" />
        <Field label="Footer" value={form.receiptFooter} onChangeText={(v) => field("receiptFooter", v)} placeholder="Thank you, come again" />
      </Card>
      <Pressable style={[styles.save, saving && { opacity: .55 }]} disabled={saving} onPress={() => void save()}>
        {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>SAVE BUSINESS</Text>}
      </Pressable>
      <Pressable style={styles.accountLink} onPress={() => router.push("/account-settings" as never)}>
        <Ionicons name="key-outline" size={20} color={colors.primary} /><Text style={styles.accountText}>Change my username or password</Text>
      </Pressable>
    </ScrollView>}
  </SafeAreaView>;
}

function Header({ onBack }: { onBack: () => void }) { return <View style={styles.header}><Pressable onPress={onBack} hitSlop={8}><Ionicons name="arrow-back" size={24} color={colors.primary} /></Pressable><Text style={styles.title}>BUSINESS SETTINGS</Text></View>; }
function Card({ children }: { children: React.ReactNode }) { return <View style={styles.card}>{children}</View>; }
function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={[styles.input, props.multiline && { minHeight: 54 }]} placeholderTextColor={colors.hint} {...props} /></View>; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  header: { height: 56, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 16, elevation: 2 },
  title: { fontSize: 17, fontWeight: "800", color: colors.primary },
  body: { padding: 12, paddingBottom: 40 }, section: { fontSize: 12, fontWeight: "800", color: colors.grey600, margin: 10 },
  card: { backgroundColor: colors.white, borderRadius: 7, paddingHorizontal: 14, elevation: 1 },
  field: { paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.grey300 },
  label: { fontSize: 12, fontWeight: "700", color: colors.grey600, marginBottom: 5 },
  input: { fontSize: 16, color: colors.grey900, padding: 0 },
  save: { height: 50, borderRadius: 6, backgroundColor: colors.green, alignItems: "center", justifyContent: "center", marginTop: 20 },
  saveText: { color: colors.white, fontSize: 15, fontWeight: "800" },
  accountLink: { height: 52, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  accountText: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 30 }, muted: { color: colors.grey600, textAlign: "center" },
});