import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { colors } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { feedbackError, feedbackTap } from "@/lib/feedback";

/**
 * Staff-facing sign-in only. Account and store creation deliberately do not
 * live here: owners create staff inside the POS and open additional shops from
 * the owner-only store switcher.
 */
export default function SignInScreen() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = username.trim().length >= 3 && password.length >= 6;

  const submit = async () => {
    if (!valid || busy) return;
    feedbackTap(); setBusy(true); setError(null);
    const res = await signIn(username.trim(), password);
    setBusy(false);
    if (!res.ok) { feedbackError(); setError(res.error ?? "That username or password isn't right."); }
  };

  return <SafeAreaView style={styles.root}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <View style={styles.brand}>
        <View style={styles.logoWrap}><Image source={require("../assets/images/gls-logo.png")} style={styles.logo} contentFit="contain" /></View>
        <Text style={styles.brandName}>GLS POS</Text>
        <Text style={styles.tagline}>Your restaurant, ready for business</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.welcome}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in with the username your owner gave you.</Text>
        <View style={styles.field}>
          <Ionicons name="person-outline" size={21} color={colors.grey600} />
          <TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="Username" placeholderTextColor={colors.hint} autoCapitalize="none" autoCorrect={false} textContentType="username" />
        </View>
        <View style={styles.field}>
          <Ionicons name="lock-closed-outline" size={21} color={colors.grey600} />
          <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={colors.hint} secureTextEntry={!showPassword} autoCapitalize="none" textContentType="password" onSubmitEditing={() => void submit()} />
          <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10}><Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={21} color={colors.grey600} /></Pressable>
        </View>
        {error ? <View style={styles.error}><Ionicons name="alert-circle" size={17} color={colors.red500} /><Text style={styles.errorText}>{error}</Text></View> : null}
        <Pressable style={[styles.signIn, (!valid || busy) && { opacity: .5 }]} disabled={!valid || busy} onPress={() => void submit()}>
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.signInText}>SIGN IN</Text>}
        </Pressable>
      </View>
      <View style={styles.help}><Ionicons name="information-circle-outline" size={18} color={colors.grey500} /><Text style={styles.helpText}>Forgot your login? Ask the restaurant owner to reset it from Staff Management.</Text></View>
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  body: { flexGrow: 1, justifyContent: "center", padding: 22, paddingVertical: 42 },
  brand: { alignItems: "center", marginBottom: 26 },
  logoWrap: { width: 104, height: 104, borderRadius: 24, backgroundColor: colors.white, padding: 14, elevation: 6 },
  logo: { width: "100%", height: "100%" }, brandName: { color: colors.white, fontSize: 28, fontWeight: "900", letterSpacing: 1.2, marginTop: 15 },
  tagline: { color: "#FFFFFFCC", fontSize: 14, marginTop: 4 },
  card: { backgroundColor: colors.white, borderRadius: 14, padding: 20, elevation: 7 },
  welcome: { fontSize: 23, fontWeight: "800", color: colors.grey900 }, subtitle: { fontSize: 13, color: colors.grey600, lineHeight: 19, marginTop: 4, marginBottom: 18 },
  field: { minHeight: 54, borderWidth: 1, borderColor: colors.grey300, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 13, marginBottom: 12 },
  input: { flex: 1, fontSize: 16, color: colors.grey900, paddingVertical: 12 },
  error: { flexDirection: "row", alignItems: "center", gap: 7, padding: 10, backgroundColor: "#FFEBEE", borderRadius: 7, marginBottom: 12 },
  errorText: { flex: 1, color: colors.red500, fontSize: 13 },
  signIn: { height: 52, borderRadius: 8, backgroundColor: colors.green, alignItems: "center", justifyContent: "center", marginTop: 4 },
  signInText: { color: colors.white, fontWeight: "900", fontSize: 16, letterSpacing: .8 },
  help: { flexDirection: "row", gap: 7, alignItems: "flex-start", marginTop: 18, paddingHorizontal: 8 }, helpText: { flex: 1, color: "#FFFFFFCC", fontSize: 12, lineHeight: 18, textAlign: "center" },
});