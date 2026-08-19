import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { Permission } from "@gls-pos/types";
import { colors } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { AUTO_AUTH } from "@/lib/device-account";

type Entry = {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  route?: string;
  /** Hidden unless the signed-in role holds this permission. */
  needs?: Permission;
};

const GROUPS: { title: string; entries: Entry[] }[] = [
  {
    title: "MANAGEMENT",
    entries: [
      { label: "VIP Orders (QR)", icon: "qrcode-scan", route: "/online-orders", needs: "sale:create" },
      { label: "Inventory Management", icon: "package-variant-closed", route: "/inventory", needs: "catalog:write" },
      { label: "Table Management", icon: "table-furniture", route: "/tables", needs: "tables:manage" },
      { label: "Customers Management", icon: "account-group-outline", route: "/customers", needs: "customers:manage" },
      { label: "Staff Management", icon: "account-tie-outline", route: "/staff", needs: "staff:manage" },
      { label: "Add Expense", icon: "cash-minus", route: "/expense-categories", needs: "expenses:manage" },
      { label: "Receipts", icon: "receipt", route: "/(tabs)/today", needs: "reports:view" },
      { label: "Activity History", icon: "history", needs: "reports:view" },
    ],
  },
  {
    title: "SETTINGS",
    entries: [
      { label: "Receipt Settings", icon: "script-text-outline", needs: "settings:manage" },
      { label: "Business Settings", icon: "store-cog-outline", needs: "settings:manage" },
      { label: "Printer Setup", icon: "printer-outline", route: "/printer-setup" },
      { label: "General settings", icon: "cog-outline", route: "/settings", needs: "settings:manage" },
      { label: "Device Details", icon: "cellphone-cog" },
    ],
  },
];

/** Side drawer opened from the hamburger in PosHeader. */
export function AppDrawer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const { store } = useStore();
  const { can, signOut } = useAuth();

  const go = (route?: string) => {
    feedbackTap();
    onClose();
    if (route) router.push(route as never);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.drawer} onPress={(e) => e.stopPropagation()}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.appName}>GLS-POS</Text>
            <View style={styles.storeRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{store.initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.storeName} numberOfLines={1}>
                  {store.name}
                </Text>
                <Text style={styles.storeRef}>{store.reference}</Text>
              </View>
            </View>
            <Pressable onPress={() => go()} style={styles.editBusiness}>
              <Text style={styles.editBusinessText}>Edit Business</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            {GROUPS.map((g) => {
              // Only show what this role is allowed to reach.
              const allowed = g.entries.filter((e) => !e.needs || can(e.needs));
              if (allowed.length === 0) return null;
              return (
                <View key={g.title}>
                  <Text style={styles.groupTitle}>{g.title}</Text>
                  {allowed.map((e) => (
                    <Pressable
                      key={e.label}
                      style={styles.row}
                      onPress={() => go(e.route)}
                      android_ripple={{ color: "#00000010" }}
                    >
                      <MaterialCommunityIcons name={e.icon} size={22} color={colors.primary} />
                      <Text style={styles.rowLabel}>{e.label}</Text>
                    </Pressable>
                  ))}
                </View>
              );
            })}

            {/* Hidden while the device signs itself in — logging out would just
                strand the user on a screen they can't get past. */}
            {!AUTO_AUTH && (
              <>
                <View style={styles.divider} />
                <Pressable
                  style={styles.row}
                  onPress={() => {
                    feedbackTap();
                    onClose();
                    void signOut();
                  }}
                  android_ripple={{ color: "#00000010" }}
                >
                  <MaterialCommunityIcons name="logout" size={22} color={colors.red500} />
                  <Text style={[styles.rowLabel, { color: colors.red500 }]}>Logout</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#00000066", flexDirection: "row" },
  drawer: { width: "82%", maxWidth: 340, backgroundColor: colors.white },
  header: { backgroundColor: colors.primary, paddingHorizontal: 16, paddingTop: 44, paddingBottom: 16 },
  appName: { color: colors.white, fontSize: 20, fontWeight: "800" },
  storeRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#FFFFFF33",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.white, fontSize: 17, fontWeight: "800" },
  storeName: { color: colors.white, fontSize: 16, fontWeight: "700" },
  storeRef: { color: "#FFFFFFBB", fontSize: 12, marginTop: 2 },
  editBusiness: { marginTop: 12 },
  editBusinessText: { color: colors.white, fontSize: 13, fontWeight: "700", textDecorationLine: "underline" },

  groupTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.grey600,
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 13 },
  rowLabel: { flex: 1, fontSize: 15, color: colors.grey800 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.grey300, marginVertical: 8 },
});
