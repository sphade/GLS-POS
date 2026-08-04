import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import {
  feedbackTap,
  isHapticsEnabled,
  isSoundEnabled,
  playSound,
  setHapticsEnabled,
  setSoundEnabled,
} from "@/lib/feedback";

const GROUPS: { title: string; rows: { label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"] }[] }[] = [
  {
    title: "Management",
    rows: [
      { label: "Inventory Management", icon: "package-variant-closed" },
      { label: "Add Expense", icon: "cash-minus" },
      { label: "Receipts", icon: "receipt" },
      { label: "Customers Management", icon: "account-group-outline" },
      { label: "Staff Management", icon: "account-tie-outline" },
      { label: "Table Management", icon: "table-furniture" },
      { label: "Activity History", icon: "history" },
    ],
  },
  {
    title: "Settings",
    rows: [
      { label: "Language", icon: "translate" },
      { label: "Weighing Machine", icon: "scale-balance" },
      { label: "Receipt Settings", icon: "script-text-outline" },
      { label: "Business Settings", icon: "store-cog-outline" },
      { label: "General settings", icon: "cog-outline" },
      { label: "Printer Setup", icon: "printer-outline" },
      { label: "Device Details", icon: "cellphone-cog" },
    ],
  },
];

export default function SettingsScreen() {
  const router = useRouter();
  const [sound, setSound] = useState(isSoundEnabled());
  const [haptics, setHaptics] = useState(isHapticsEnabled());

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 10, paddingBottom: 24 }}>
        <Text style={styles.groupTitle}>Feedback</Text>
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <MaterialCommunityIcons name="volume-high" size={24} color={colors.primary} />
            <Text style={styles.rowLabel}>Sound effects</Text>
            <Switch
              value={sound}
              onValueChange={(v) => {
                setSound(v);
                setSoundEnabled(v);
                if (v) playSound("beep");
              }}
              trackColor={{ true: colors.primary + "88", false: colors.grey400 }}
              thumbColor={sound ? colors.primary : colors.grey100}
            />
          </View>
          <View style={styles.toggleRow}>
            <MaterialCommunityIcons name="vibrate" size={24} color={colors.primary} />
            <Text style={styles.rowLabel}>Vibration</Text>
            <Switch
              value={haptics}
              onValueChange={(v) => {
                setHaptics(v);
                setHapticsEnabled(v);
                if (v) feedbackTap();
              }}
              trackColor={{ true: colors.primary + "88", false: colors.grey400 }}
              thumbColor={haptics ? colors.primary : colors.grey100}
            />
          </View>
        </View>

        {GROUPS.map((g) => (
          <View key={g.title}>
            <Text style={styles.groupTitle}>{g.title}</Text>
            <View style={styles.card}>
              {g.rows.map((r) => (
                <Pressable key={r.label} style={styles.row} onPress={feedbackTap} android_ripple={{ color: "#00000010" }}>
                  <MaterialCommunityIcons name={r.icon} size={24} color={colors.primary} />
                  <Text style={styles.rowLabel}>{r.label}</Text>
                  <Ionicons name="chevron-forward" size={20} color={colors.grey400} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Pressable style={styles.logout} onPress={feedbackTap}>
          <MaterialCommunityIcons name="logout" size={22} color={colors.red500} />
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  header: {
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  headerBtn: { width: 48, alignItems: "center" },
  headerTitle: { color: colors.white, fontSize: 18, fontWeight: "700" },
  groupTitle: { fontSize: 13, fontWeight: "800", color: colors.grey600, marginTop: 14, marginBottom: 6, marginLeft: 4 },
  card: { backgroundColor: colors.card, borderRadius: 4, elevation: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.grey200 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 8 },
  rowLabel: { flex: 1, fontSize: 15, color: colors.grey800 },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 20, padding: 14 },
  logoutText: { color: colors.red500, fontWeight: "700", fontSize: 15 },
});
