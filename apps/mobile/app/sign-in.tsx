import { useRef, useState } from "react";
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
  const [focus, setFocus] = useState<"user" | "pass" | null>(null);
  const passRef = useRef<TextInput>(null);
  const valid = username.trim().length >= 3 && password.length >= 6;

  const submit = async () => {
    if (!valid || busy) return;
    feedbackTap(); setBusy(true); setError(null);
    const res = await signIn(username.trim(), password);
    setBusy(false);
    if (!res.ok) { feedbackError(); setError(res.error ?? "That username or password isn't right."); }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Image source={require("../assets/images/gls-logo.png")} style={styles.logo} contentFit="contain" />
            <Text style={styles.title}>Sign in</Text>
            <Text style={styles.subtitle}>Use the username and password your owner gave you.</Text>
          </View>

          <Text style={styles.label}>Username</Text>
          <View style={[styles.field, focus === "user" && styles.fieldFocus]}>
            <Ionicons name="person-outline" size={20} color={focus === "user" ? colors.primaryDark : colors.grey500} />
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={(v) => { setUsername(v); setError(null); }}
              placeholder="e.g. tunde"
              placeholderTextColor={colors.grey400}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              returnKeyType="next"
              onFocus={() => setFocus("user")}
              onBlur={() => setFocus(null)}
              onSubmitEditing={() => passRef.current?.focus()}
            />
          </View>

          <Text style={styles.label}>Password</Text>
          <View style={[styles.field, focus === "pass" && styles.fieldFocus]}>
            <Ionicons name="lock-closed-outline" size={20} color={focus === "pass" ? colors.primaryDark : colors.grey500} />
            <TextInput
              ref={passRef}
              style={styles.input}
              value={password}
              onChangeText={(v) => { setPassword(v); setError(null); }}
              placeholder="At least 6 characters"
              placeholderTextColor={colors.grey400}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              textContentType="password"
              returnKeyType="go"
              onFocus={() => setFocus("pass")}
              onBlur={() => setFocus(null)}
              onSubmitEditing={() => void submit()}
            />
            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={12} accessibilityLabel={showPassword ? "Hide password" : "Show password"}>
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={colors.grey500} />
            </Pressable>
          </View>

          {error ? (
            <View style={styles.error}>
              <Ionicons name="alert-circle" size={18} color={colors.red800} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [styles.button, (!valid || busy) && styles.buttonOff, pressed && valid && { opacity: 0.85 }]}
            disabled={!valid || busy}
            onPress={() => void submit()}
          >
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Sign in</Text>}
          </Pressable>

          <Text style={styles.help}>Forgot your login? Ask the owner to reset it from Staff.</Text>
        </ScrollView>
        <Text style={styles.footer}>GLS POS</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  body: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 32, maxWidth: 460, width: "100%", alignSelf: "center" },
  brand: { alignItems: "flex-start", marginBottom: 28 },
  logo: { width: 64, height: 72, marginBottom: 22 },
  title: { fontSize: 30, fontWeight: "800", color: colors.grey900, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: colors.grey600, lineHeight: 21, marginTop: 6 },
  label: { fontSize: 13, fontWeight: "700", color: colors.grey800, marginBottom: 7 },
  field: {
    height: 54, borderWidth: 1.5, borderColor: colors.grey300, borderRadius: 12, backgroundColor: colors.grey50,
    flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, marginBottom: 16,
  },
  fieldFocus: { borderColor: colors.primary, backgroundColor: colors.white },
  input: { flex: 1, fontSize: 16, color: colors.grey900, paddingVertical: 0 },
  error: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, backgroundColor: "#FDECEA", borderRadius: 10, marginBottom: 16 },
  errorText: { flex: 1, color: colors.red800, fontSize: 13.5, lineHeight: 18 },
  button: { height: 54, borderRadius: 12, backgroundColor: colors.primaryDark, alignItems: "center", justifyContent: "center", marginTop: 4 },
  buttonOff: { backgroundColor: colors.grey300 },
  buttonText: { color: colors.white, fontWeight: "800", fontSize: 16 },
  help: { color: colors.grey500, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 18 },
  footer: { textAlign: "center", color: colors.grey400, fontSize: 12, fontWeight: "700", letterSpacing: 1.5, paddingBottom: 12 },
});
