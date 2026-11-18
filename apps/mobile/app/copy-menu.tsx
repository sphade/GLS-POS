import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { centeredForm } from "@/lib/responsive";
import { api, type CopyCatalogResult } from "@/lib/api";
import { useStore } from "@/lib/store";
import { pullNow } from "@/lib/sync";
import { feedbackTap } from "@/lib/feedback";

/**
 * Copy another shop's menu into this one.
 *
 * Written for opening a new branch: re-typing a whole menu (and every variant
 * and modifier group) is an hour of work and a source of pricing mistakes. The
 * copy only adds what this shop does not already have - ids are kept, so an
 * item that is already here keeps its own price, and running it again changes
 * nothing. It deliberately does not copy stock, because a branch's shelves are
 * its own.
 */
export default function CopyMenuScreen() {
  const router = useRouter();
  const { store, stores } = useStore();

  const others = stores.filter((s) => s.id !== store.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CopyCatalogResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const source = others.find((s) => s.id === selected) ?? null;

  const run = async () => {
    if (!source || busy) return;
    feedbackTap();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.copyCatalog(store.id, source.id);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setResult(res.data);
      // The copy was written server-side; pull it into this device so the Items
      // screen shows the new menu without waiting for the next poll.
      void pullNow(store.id, false, true, true);
    } catch (e) {
      setError((e as Error)?.message ?? "The copy failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Copy Menu</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={[{ padding: 10, paddingBottom: 32 }, centeredForm]}>
        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={18} color={colors.grey700} />
          <Text style={styles.noteText}>
            Categories, items, variants and modifier groups are copied into{" "}
            <Text style={styles.noteStrong}>{store.name}</Text>. Stock quantities are not copied —
            set them in this shop afterwards. Items this shop already has are left untouched, so
            your own prices are never overwritten.
          </Text>
        </View>

        <Text style={styles.groupTitle}>Copy from</Text>
        <View style={styles.card}>
          {others.length === 0 ? (
            <Text style={styles.empty}>You don't have another shop to copy from.</Text>
          ) : (
            others.map((s) => {
              const on = s.id === selected;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => {
                    feedbackTap();
                    setSelected(s.id);
                    setResult(null);
                    setError(null);
                  }}
                  style={styles.row}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Ionicons
                    name={on ? "radio-button-on" : "radio-button-off"}
                    size={22}
                    color={on ? colors.primary : colors.grey400}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{s.name}</Text>
                    <Text style={styles.rowHint}>
                      {s.isCentral ? "Central store" : s.role}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {result ? (
          <View style={styles.okBox}>
            <Ionicons name="checkmark-circle" size={20} color={colors.primaryDark} />
            <Text style={styles.okText}>
              Menu copied into {store.name}: {result.products} item
              {result.products === 1 ? "" : "s"}, {result.categories} categor
              {result.categories === 1 ? "y" : "ies"} and {result.modifiers} modifier group
              {result.modifiers === 1 ? "" : "s"}.
              {result.skipped > 0
                ? ` ${result.skipped} item${result.skipped === 1 ? " was" : "s were"} already here and left unchanged.`
                : ""}
              {result.refused > 0
                ? ` ${result.refused} row${result.refused === 1 ? "" : "s"} were skipped — your role cannot write them.`
                : ""}
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => void run()}
          disabled={!source || busy}
          style={[styles.button, (!source || busy) && styles.buttonOff]}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Ionicons name="copy-outline" size={18} color={colors.white} />
          )}
          <Text style={styles.buttonText}>
            {busy ? "COPYING…" : source ? `COPY FROM ${source.name.toUpperCase()}` : "SELECT A SHOP"}
          </Text>
        </Pressable>

        {busy ? (
          <Text style={styles.busyHint}>
            Writing the menu into {store.name}. Large menus can take a minute — keep this screen
            open.
          </Text>
        ) : null}
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

  note: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.grey100,
    borderRadius: 4,
    padding: 12,
    marginTop: 6,
  },
  noteText: { flex: 1, fontSize: 12.5, color: colors.grey700, lineHeight: 18 },
  noteStrong: { fontWeight: "700", color: colors.grey900 },

  groupTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.grey600,
    marginTop: 16,
    marginBottom: 6,
    marginLeft: 4,
  },
  card: { backgroundColor: colors.card, borderRadius: 4, elevation: 1, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey200,
  },
  rowLabel: { fontSize: 15, color: colors.grey800, fontWeight: "600" },
  rowHint: { fontSize: 12, color: colors.grey600, marginTop: 2, textTransform: "capitalize" },
  empty: { padding: 14, fontSize: 13, color: colors.grey600 },

  errorBox: {
    marginTop: 14,
    backgroundColor: "#FDECEA",
    borderRadius: 4,
    padding: 12,
  },
  errorText: { color: colors.red500, fontSize: 13, lineHeight: 18 },

  okBox: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    backgroundColor: "#EAF6EC",
    borderRadius: 4,
    padding: 12,
  },
  okText: { flex: 1, color: colors.grey800, fontSize: 13, lineHeight: 18 },

  button: {
    marginTop: 18,
    backgroundColor: colors.primary,
    borderRadius: 6,
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonOff: { backgroundColor: colors.grey400 },
  buttonText: { color: colors.white, fontWeight: "800", fontSize: 13, letterSpacing: 0.6 },

  busyHint: {
    marginTop: 10,
    fontSize: 12,
    color: colors.grey600,
    textAlign: "center",
    lineHeight: 17,
  },
});
