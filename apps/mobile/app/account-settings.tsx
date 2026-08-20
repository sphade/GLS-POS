import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { authClient } from "@/lib/auth-client";
import { useAuth } from "@/lib/auth";

type Result = { error?: { message?: string } | null };
type AccountClient = {
  updateUser: (body: { username: string; displayUsername: string }) => Promise<Result>;
  changePassword: (body: { currentPassword: string; newPassword: string; revokeOtherSessions: boolean }) => Promise<Result>;
};

export default function AccountSettingsScreen() {
  const router = useRouter();
  const { user, role, refresh } = useAuth();
  const [username, setUsername] = useState(user?.username ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<"username" | "password" | null>(null);
  const client = authClient as unknown as AccountClient;

  const saveUsername = async () => {
    const handle = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(handle)) return Alert.alert("Invalid username", "Use 3–32 letters, numbers, dots, dashes or underscores.");
    setBusy("username");
    const res = await client.updateUser({ username: handle, displayUsername: handle });
    setBusy(null);
    if (res.error) return Alert.alert("Could not change username", res.error.message ?? "Try another username.");
    await refresh(); Alert.alert("Username changed", `You now sign in as ${handle}.`);
  };

  const savePassword = async () => {
    if (newPassword.length < 6) return Alert.alert("Password too short", "Use at least 6 characters.");
    if (newPassword !== confirm) return Alert.alert("Passwords don't match");
    setBusy("password");
    const res = await client.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    setBusy(null);
    if (res.error) return Alert.alert("Could not change password", res.error.message ?? "Check your current password.");
    setCurrentPassword(""); setNewPassword(""); setConfirm(""); Alert.alert("Password changed", "Other signed-in devices were logged out.");
  };

  return <SafeAreaView style={styles.root}><View style={styles.header}><Pressable onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.primary} /></Pressable><Text style={styles.title}>LOGIN & SECURITY</Text></View>
    {role !== "owner" ? <View style={styles.center}><Ionicons name="lock-closed" size={42} color={colors.grey400} /><Text style={styles.muted}>Only the owner can change the owner login.</Text></View> : <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text style={styles.note}>These are your personal owner credentials. Changing them does not affect staff accounts.</Text>
      <Text style={styles.section}>USERNAME</Text><View style={styles.card}>
        <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} />
        <Pressable style={styles.button} disabled={!!busy} onPress={() => void saveUsername()}>{busy === "username" ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>UPDATE USERNAME</Text>}</Pressable>
      </View>
      <Text style={styles.section}>PASSWORD</Text><View style={styles.card}>
        <Field label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
        <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry />
        <Pressable style={styles.button} disabled={!!busy} onPress={() => void savePassword()}>{busy === "password" ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>CHANGE PASSWORD</Text>}</Pressable>
      </View>
    </ScrollView>}
  </SafeAreaView>;
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} placeholderTextColor={colors.hint} {...props} /></View>; }
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  header: { height: 56, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 16, elevation: 2 },
  title: { fontSize: 17, fontWeight: "800", color: colors.primary }, body: { padding: 14, paddingBottom: 40 },
  note: { fontSize: 13, color: colors.grey600, lineHeight: 19, marginBottom: 10 },
  section: { fontSize: 12, fontWeight: "800", color: colors.grey600, margin: 10 },
  card: { backgroundColor: colors.white, borderRadius: 7, padding: 14, elevation: 1 },
  field: { marginBottom: 14 }, label: { fontSize: 12, fontWeight: "700", color: colors.grey600, marginBottom: 5 },
  input: { fontSize: 16, color: colors.grey900, borderBottomWidth: 1, borderColor: colors.grey300, paddingVertical: 8 },
  button: { height: 48, backgroundColor: colors.green, borderRadius: 6, alignItems: "center", justifyContent: "center", marginTop: 4 },
  buttonText: { color: colors.white, fontSize: 14, fontWeight: "800" }, center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }, muted: { color: colors.grey600 },
});