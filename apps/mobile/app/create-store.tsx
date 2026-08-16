import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { feedbackError, feedbackTap } from "@/lib/feedback";

/**
 * Shown when a signed-in user belongs to no store yet. Creating one makes them
 * its owner; from there they can invite staff and assign roles.
 */
export default function CreateStoreScreen() {
  const { createStore, signOut, user } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (name.trim().length === 0 || busy) return;
    feedbackTap();
    setBusy(true);
    setError(null);
    const res = await createStore(name.trim());
    setBusy(false);
    if (!res.ok) {
      feedbackError();
      setError(res.error ?? "Could not create the store");
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <View style={styles.icon}>
          <Ionicons name="storefront-outline" size={34} color={colors.white} />
        </View>
        <Text style={styles.title}>Set up your store</Text>
        <Text style={styles.sub}>
          You're signed in as {user?.email}. Name your restaurant to get started — you'll be the owner.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Store name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. GLS Kitchen & Bakery"
            placeholderTextColor={colors.hint}
            value={name}
            onChangeText={setName}
            autoFocus
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            style={[styles.cta, (name.trim().length === 0 || busy) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={name.trim().length === 0 || busy}
          >
            {busy ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.ctaText}>CREATE STORE</Text>
            )}
          </Pressable>
        </View>

        <Pressable style={styles.signOut} onPress={() => void signOut()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  body: { flex: 1, padding: 20, paddingTop: 48, alignItems: "center" },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
  },
  title: { fontSize: 22, fontWeight: "800", color: colors.primary, marginTop: 14 },
  sub: { fontSize: 14, color: colors.grey700, textAlign: "center", marginTop: 8, lineHeight: 20 },
  card: {
    alignSelf: "stretch",
    backgroundColor: colors.card,
    borderRadius: 6,
    padding: 16,
    marginTop: 24,
    elevation: 1,
  },
  label: { fontSize: 12, fontWeight: "800", color: colors.grey600, letterSpacing: 0.6 },
  input: {
    fontSize: 17,
    color: colors.grey900,
    borderBottomWidth: 1,
    borderColor: colors.grey300,
    paddingVertical: 10,
    marginTop: 6,
  },
  error: { color: colors.red500, fontSize: 13, fontWeight: "600", marginTop: 10 },
  cta: {
    height: 50,
    borderRadius: 6,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  ctaText: { color: colors.white, fontSize: 16, fontWeight: "800", letterSpacing: 0.6 },
  signOut: { marginTop: 24, padding: 10 },
  signOutText: { color: colors.grey600, fontWeight: "700" },
});
