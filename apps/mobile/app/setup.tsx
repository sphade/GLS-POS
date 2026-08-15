import { useEffect, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";
import { api } from "@/lib/api";
import { signIn, signUp, useSession, authClient } from "@/lib/auth-client";
import { useKeyboardHeight } from "@/lib/use-keyboard-height";
import { SafeAreaView } from "react-native-safe-area-context";
function slugifyOrganizationName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || `store-${Date.now()}`;
}

export default function SetupScreen() {
  const router = useRouter();
  const { data: session } = useSession();
  const { height: keyboardHeight } = useKeyboardHeight();
  const [activeModal, setActiveModal] = useState<"signIn" | "signUp" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyboardSpacerStyle = useAnimatedStyle(() => ({
    height: keyboardHeight.value,
  }));

  useEffect(() => {
    if (session) {
      router.replace("/(tabs)");
    }
  }, [session, router]);

  const closeModal = () => {
    setActiveModal(null);
    setName("");
    setStoreName("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setError(null);
  };

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    if (activeModal === "signUp") {
      if (!name.trim()) {
        setError("Please enter your name.");
        return;
      }
      if (!storeName.trim()) {
        setError("Please enter your store name.");
        return;
      }
      if (!confirmPassword) {
        setError("Please confirm your password.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    setBusy(true);
    setError(null);

    try {
      if (activeModal === "signIn") {
        const { error: signInError } = await signIn.email({
          email: email.trim(),
          password,
        });

        if (signInError) {
          setError(signInError.message || "Unable to sign in.");
          return;
        }
      } else if (activeModal === "signUp") {
        const { error: signUpError } = await signUp.email({
          name: name.trim(),
          email: email.trim(),
          password,
        });

        if (signUpError) {
          setError(signUpError.message || "Unable to create account.");
          return;
        }

        const createOrganizationResult = await api.createOrganization({
          name: storeName.trim(),
          slug: slugifyOrganizationName(storeName),
        });

        if (!createOrganizationResult.ok) {
          setError(
            createOrganizationResult.error.message ||
              "Account created, but organization setup failed. You can create one later.",
          );
          return;
        }
      }
    } catch (err) {
      setError(
        (err as Error)?.message || "Unable to authenticate. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const modalTitle = activeModal === "signIn" ? "Log in" : "Set up";
  const submitLabel = activeModal === "signIn" ? "Sign in" : "Create account";

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.spacer} />
      <Image
        source={require("../assets/images/gls-logo.png")}
        style={styles.logo}
        resizeMode="contain"
      />
      <View style={styles.spacer} />
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => {
            feedbackTap();
            setActiveModal("signUp");
          }}
          android_ripple={{ color: "#FFFFFF22" }}
        >
          <Text style={styles.primaryText}>Set up</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => {
            feedbackTap();
            setActiveModal("signIn");
          }}
          android_ripple={{ color: "#00000010" }}
        >
          <Text style={styles.secondaryText}>Log in</Text>
        </Pressable>
      </View>

      <Modal
        visible={activeModal !== null}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <Pressable style={styles.backdrop} onPress={closeModal}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{modalTitle}</Text>
            {activeModal === "signUp" && (
              <View style={styles.formRow}>
                <Text style={styles.formLabel}>Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Your name"
                  placeholderTextColor={colors.hint}
                  value={name}
                  onChangeText={setName}
                  returnKeyType="next"
                />
              </View>
            )}
            {activeModal === "signUp" && (
              <View style={styles.formRow}>
                <Text style={styles.formLabel}>Store name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Store name"
                  placeholderTextColor={colors.hint}
                  value={storeName}
                  onChangeText={setStoreName}
                  returnKeyType="next"
                />
              </View>
            )}
            <View style={styles.formRow}>
              <Text style={styles.formLabel}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor={colors.hint}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
                returnKeyType="next"
              />
            </View>
            <View style={styles.formRow}>
              <Text style={styles.formLabel}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={colors.hint}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                returnKeyType="next"
                autoCapitalize="none"
              />
            </View>
            {activeModal === "signUp" ? (
              <View style={styles.formRow}>
                <Text style={styles.formLabel}>Confirm Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Confirm password"
                  placeholderTextColor={colors.hint}
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  returnKeyType="next"
                  autoCapitalize="none"
                />
              </View>
            ) : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable
              style={[styles.sheetAction, styles.createButton]}
              onPress={submit}
              disabled={busy}
              android_ripple={{ color: "#00000010" }}
            >
              <Text style={[styles.sheetActionText, styles.createButtonText]}>
                {busy ? "Working…" : submitLabel}
              </Text>
            </Pressable>
            <Pressable
              style={styles.sheetAction}
              onPress={closeModal}
              android_ripple={{ color: "#00000010" }}
            >
              <Text style={[styles.sheetActionText, { color: colors.grey700 }]}>
                Cancel
              </Text>
            </Pressable>
            <Animated.View style={keyboardSpacerStyle} />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.grey200,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  spacer: { flex: 1 },
  logo: { width: 180, height: 180, marginTop: 80 },
  actions: { width: "100%", gap: 12 },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  secondaryButton: {
    backgroundColor: colors.card,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.grey300,
  },
  primaryText: { color: colors.white, fontSize: 16, fontWeight: "700" },
  secondaryText: { color: colors.grey900, fontSize: 16, fontWeight: "700" },
  buttonPressed: { opacity: 0.84 },
  backdrop: {
    flex: 1,
    backgroundColor: "#00000066",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingTop: 18,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.grey900,
    marginBottom: 16,
  },
  formRow: { marginBottom: 10 },
  formLabel: {
    fontSize: 13,
    color: colors.grey700,
    fontWeight: "700",
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.grey100,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: colors.grey900,
    borderWidth: 1,
    borderColor: colors.grey300,
  },
  sheetAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    marginTop: 8,
    marginHorizontal: 0,
  },
  sheetActionText: { fontSize: 15, color: colors.primary, fontWeight: "600" },
  createButtonText: {
    color: colors.white,
    flex: 1,
    textAlign: "center",
    fontWeight: "700",
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: colors.grey100,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.grey700 },
  errorText: {
    color: colors.red500,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 4,
  },
});
