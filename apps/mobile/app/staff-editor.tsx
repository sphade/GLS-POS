import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, ToggleRow, confirmDelete, formStyles } from "@/components/form";
import { useCatalog } from "@/lib/catalog";
import { useAuth } from "@/lib/auth";
import { feedbackTap } from "@/lib/feedback";

const ROLES = ["Owner", "Manager", "Cashier", "Waiter", "Kitchen"];

/** Permissions shown per role — mirrors the staff permission matrix. */
const PERMISSIONS: Record<string, string[]> = {
  Owner: ["Everything"],
  Manager: ["Sell", "Refunds", "Discounts", "Reports", "Inventory", "Staff"],
  // No discounts and no refunds: both reprice or reverse money, and both are
  // enforced server-side, so promising them here would be a lie.
  Cashier: ["Sell", "Customers", "Tables"],
  Waiter: ["Sell", "Tables"],
  Kitchen: ["Kitchen display"],
};

export default function StaffEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { staff, upsertStaff, deleteStaff } = useCatalog();
  const { can } = useAuth();
  const canEdit = can("staff:manage");
  const existing = staff.find((s) => s.id === id);

  const [name, setName] = useState(existing?.name ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [role, setRole] = useState(existing?.role ?? "Cashier");
  const [active, setActive] = useState(existing?.active ?? true);
  const [touched, setTouched] = useState(false);

  const dirty = name.trim().length > 0 && (touched || name !== existing?.name);

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title={existing ? "Edit Staff" : "Add Staff"}
        dirty={dirty}
        onClose={() => router.back()}
        onSave={() => {
          upsertStaff({ id: existing?.id, name: name.trim(), phone: phone.trim() || undefined, role, active });
          feedbackTap();
          router.back();
        }}
        onDelete={
          existing && canEdit
            ? () =>
                confirmDelete(`staff member "${existing.name}"`, () => {
                  deleteStaff(existing.id);
                  feedbackTap();
                  router.back();
                })
            : undefined
        }
      />

      <ScrollView contentContainerStyle={formStyles.body}>
        <FieldCard
          label="Staff Name *"
          hint="Ex: Tunde A."
          value={name}
          onChangeText={(t) => {
            setName(t);
            setTouched(true);
          }}
          valid={name.trim().length > 0}
        />
        <FieldCard
          label="Mobile Number"
          hint="+234 801 000 0000"
          value={phone}
          onChangeText={(t) => {
            setPhone(t);
            setTouched(true);
          }}
          keyboardType="phone-pad"
          showTick={false}
        />

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>ROLE</Text>
          <View style={styles.chipRow}>
            {ROLES.map((r) => (
              <Pressable
                key={r}
                style={[styles.chip, role === r && styles.chipActive]}
                onPress={() => {
                  feedbackTap();
                  setRole(r);
                  setTouched(true);
                }}
              >
                <Text style={[styles.chipText, role === r && { color: colors.white }]}>{r}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { marginTop: 16 }]}>PERMISSIONS</Text>
          {(PERMISSIONS[role] ?? []).map((p) => (
            <Text key={p} style={styles.permission}>
              • {p}
            </Text>
          ))}
        </View>

        <View style={styles.card}>
          <ToggleRow
            label="Active (can sign in)"
            value={active}
            onValueChange={(v) => {
              setActive(v);
              setTouched(true);
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 4, padding: 12, marginBottom: 8, elevation: 1 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.grey600, letterSpacing: 0.6, marginBottom: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.grey400 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.grey700 },
  permission: { fontSize: 14, color: colors.grey700, marginTop: 4 },
});
