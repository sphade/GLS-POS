import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { colors } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { feedbackError, feedbackTap } from "@/lib/feedback";

/**
 * Sign in / sign up gate. The POS is staff software, so there's no social login:
 * an owner creates the store, then invites staff by email from the Staff screen.
 */
export default function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUp = mode === "up";
  const valid =
    email.trim().length > 3 && password.length >= 8 && (!isUp || name.trim().length > 0);

  const submit = async () => {
    if (!valid || busy) return;
    feedbackTap();
    setBusy(true);
    setError(null);
    const res = isUp
      ? await signUp(name.trim(), email.trim(), password)
      : await signIn(email.trim(), password);
    setBusy(false);
    if (!res.ok) {
      feedbackError();
      setError(res.error ?? "Something went wrong");
    }
    // On success the root layout swaps to the app automatically.
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Image
              source={require("../assets/images/gls-logo-full.png")}
              style={styles.logo}
              contentFit="contain"
            />
            <Text style={styles.brandName}>GLS POS</Text>
            <Text style={styles.brandSub}>
              {isUp ? "Create your owner account" : "Sign in to your store"}
            </Text>
          </View>

          <View style={styles.card}>
            {isUp && (
              <Field
                icon="person-outline"
                placeholder="Your name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />
            )}
            <Field
              icon="mail-outline"
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <View style={styles.fieldRow}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.grey600} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={colors.hint}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
                autoCapitalize="none"
              />
              <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={8}>
                <Ionicons
                  name={showPw ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color={colors.grey600}
                />
              </Pressable>
            </View>
            {isUp && <Text style={styles.hint}>At least 8 characters.</Text>}

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={colors.red500} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.cta, (!valid || busy) && { opacity: 0.5 }]}
              onPress={submit}
              disabled={!valid || busy}
            >
              {busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.ctaText}>{isUp ? "CREATE ACCOUNT" : "SIGN IN"}</Text>
              )}
            </Pressable>
          </View>

          <Pressable
            style={styles.switchMode}
            onPress={() => {
              feedbackTap();
              setError(null);
              setMode(isUp ? "in" : "up");
            }}
          >
            <Text style={styles.switchText}>
              {isUp ? "Already have an account? " : "New here? "}
              <Text style={styles.switchLink}>{isUp ? "Sign in" : "Create an owner account"}</Text>
            </Text>
          </Pressable>

          <Text style={styles.footnote}>
            Staff accounts are created by the owner. Ask them to invite your email, then sign in here.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  icon,
  ...props
}: { icon: React.ComponentProps<typeof Ionicons>["name"] } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.fieldRow}>
      <Ionicons name={icon} size={20} color={colors.grey600} />
      <TextInput style={styles.input} placeholderTextColor={colors.hint} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  body: { padding: 20, paddingTop: 40, paddingBottom: 40 },
  brand: { alignItems: "center", marginBottom: 26 },
  logo: { width: 130, height: 130 },
  brandName: { fontSize: 24, fontWeight: "800", color: colors.primary, marginTop: 8, letterSpacing: 0.5 },
  brandSub: { fontSize: 14, color: colors.grey600, marginTop: 4 },

  card: { backgroundColor: colors.card, borderRadius: 6, padding: 16, elevation: 1 },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderColor: colors.grey300,
    paddingVertical: 10,
    marginBottom: 6,
  },
  input: { flex: 1, fontSize: 16, color: colors.grey900, padding: 0 },
  hint: { fontSize: 12, color: colors.grey600, marginTop: 2 },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFEBEE",
    borderRadius: 4,
    padding: 10,
    marginTop: 12,
  },
  errorText: { flex: 1, color: colors.red500, fontSize: 13, fontWeight: "600" },

  cta: {
    height: 50,
    borderRadius: 6,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    elevation: 2,
  },
  ctaText: { color: colors.white, fontSize: 16, fontWeight: "800", letterSpacing: 0.6 },

  switchMode: { alignItems: "center", marginTop: 18 },
  switchText: { fontSize: 14, color: colors.grey700 },
  switchLink: { color: colors.primary, fontWeight: "700" },
  footnote: {
    fontSize: 12,
    color: colors.grey600,
    textAlign: "center",
    marginTop: 26,
    lineHeight: 18,
    paddingHorizontal: 10,
  },
});
