import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ChannelLink, ChannelLinkView, ChannelStatus } from "@gls-pos/types";
import { colors } from "@/constants/theme";
import { PickerSheet } from "@/components/PickerSheet";
import { RequirePermission } from "@/components/RequirePermission";
import { api } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import { feedbackTap } from "@/lib/feedback";

const CHANNEL = "azumi";

function ago(t?: number) {
  if (!t) return "never";
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`;
}

/**
 * Owner screen: connect this shop to Azumi Deliveries and link menu items.
 * Once linked, the server keeps each Azumi item in or out of stock to match
 * GLS POS after every sale or stock change, so Azumi customers can't order
 * something the kitchen has run out of.
 */
function DeliveryAppsScreen() {
  const router = useRouter();
  const { store } = useStore();
  const { products } = useCatalog();
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [view, setView] = useState<ChannelLinkView | null>(null);
  const [links, setLinks] = useState<ChannelLink[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const res = await api.channelStatuses(store.id);
    const s = res.ok ? (res.data.find((c) => c.channel === CHANNEL) ?? null) : null;
    setStatus(s);
    if (s?.connected) {
      const v = await api.channelLinks(store.id, CHANNEL);
      if (v.ok) {
        setView(v.data);
        setLinks(v.data.links);
        setDirty(false);
      }
    }
  }, [store.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const productName = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const linkFor = (ref: string) => links.find((l) => l.ref === ref);

  const run = async (label: string, fn: () => Promise<{ ok: boolean; error?: { message?: string } }>, done?: string) => {
    feedbackTap();
    setBusy(label);
    const res = await fn();
    setBusy(null);
    if (!res.ok) {
      Alert.alert("Azumi", res.error?.message ?? "Something went wrong. Check the connection and try again.");
      return false;
    }
    if (done) Alert.alert("Azumi", done);
    await load();
    return true;
  };

  const connect = () =>
    run("connect", () => api.connectChannel(store.id, CHANNEL, apiKey.trim()), "Connected to Azumi.").then((ok) => {
      if (ok) setApiKey("");
    });

  const disconnect = () =>
    Alert.alert("Disconnect Azumi?", "Azumi stock will stop following GLS POS. Your links are kept.", [
      { text: "Keep connected", style: "cancel" },
      { text: "Disconnect", style: "destructive", onPress: () => void run("disconnect", () => api.disconnectChannel(store.id, CHANNEL)) },
    ]);

  const autoLink = async () => {
    feedbackTap();
    setBusy("auto");
    const res = await api.autoLinkChannel(store.id, CHANNEL);
    setBusy(null);
    if (!res.ok) return Alert.alert("Azumi", res.error?.message ?? "Couldn't load the Azumi menu.");
    Alert.alert(
      "Matched by name",
      `${res.data.added} new link${res.data.added === 1 ? "" : "s"}. ${res.data.unmatched} Azumi item${
        res.data.unmatched === 1 ? "" : "s"
      } still need linking by hand.`,
    );
    await load();
  };

  const setLink = (ref: string, kind: "item" | "option" | undefined, productId: string | null) => {
    setLinks((prev) => [
      ...prev.filter((l) => l.ref !== ref),
      ...(productId ? [{ productId, ref, kind }] : []),
    ]);
    setDirty(true);
  };

  const pickedItem = view?.menu.find((m) => m.ref === picking);

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} style={styles.toolbarBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.grey900} />
        </Pressable>
        <Text style={styles.toolbarTitle}>Delivery apps</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.logo}>
              <MaterialCommunityIcons name="moped" size={22} color={colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Azumi Deliveries</Text>
              <Text style={styles.sub}>
                {status?.connected
                  ? `Connected${status.remoteName ? ` as ${status.remoteName}` : ""} · last update ${ago(status.lastSyncAt)}`
                  : "Not connected"}
              </Text>
            </View>
          </View>

          {status?.lastError ? <Text style={styles.error}>{status.lastError}</Text> : null}

          {status && !status.connected ? (
            <>
              <Text style={styles.help}>
                In the Azumi vendor dashboard, open Integrations, create a key, and paste it here.
              </Text>
              <TextInput
                style={styles.input}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="Azumi integration key"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <Pressable
                style={[styles.primary, apiKey.trim().length < 8 && styles.disabled]}
                disabled={apiKey.trim().length < 8 || !!busy}
                onPress={() => void connect()}
              >
                <Text style={styles.primaryText}>{busy === "connect" ? "Connecting…" : "Connect"}</Text>
              </Pressable>
            </>
          ) : null}

          {status?.connected ? (
            <View style={styles.actions}>
              <Pressable style={styles.secondary} disabled={!!busy} onPress={() => void autoLink()}>
                <Text style={styles.secondaryText}>{busy === "auto" ? "Matching…" : "Match by name"}</Text>
              </Pressable>
              <Pressable
                style={styles.secondary}
                disabled={!!busy}
                onPress={() => void run("sync", () => api.syncChannels(store.id), "Azumi stock updated.")}
              >
                <Text style={styles.secondaryText}>{busy === "sync" ? "Syncing…" : "Sync now"}</Text>
              </Pressable>
              <Pressable style={styles.secondary} disabled={!!busy} onPress={disconnect}>
                <Text style={[styles.secondaryText, { color: colors.red500 }]}>Disconnect</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {status === null ? <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} /> : null}

        {view ? (
          <>
            <Text style={styles.section}>
              AZUMI MENU · {links.length} of {view.menu.length} linked
            </Text>
            <Text style={styles.help}>
              Link each Azumi item to the GLS POS item it is. Linked items go out of stock on Azumi the moment they
              run out here, and come back when you restock.
            </Text>
            <View style={styles.card}>
              {view.menu.map((m) => {
                const link = linkFor(m.ref);
                return (
                  <Pressable
                    key={m.ref}
                    style={styles.itemRow}
                    onPress={() => {
                      feedbackTap();
                      setPicking(m.ref);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName} numberOfLines={1}>
                        {m.name}
                        {m.kind === "option" ? "  (add-on)" : ""}
                      </Text>
                      <Text style={[styles.sub, !link && { color: colors.red500 }]} numberOfLines={1}>
                        {link ? `→ ${productName.get(link.productId) ?? "Removed item"}` : "Not linked"}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.grey500} />
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </ScrollView>

      {dirty ? (
        <View style={styles.footer}>
          <Pressable
            style={styles.primary}
            disabled={!!busy}
            onPress={() =>
              void run("save", () => api.saveChannelLinks(store.id, CHANNEL, links), "Links saved and Azumi stock updated.")
            }
          >
            <Text style={styles.primaryText}>{busy === "save" ? "Saving…" : "Save links"}</Text>
          </Pressable>
        </View>
      ) : null}

      <PickerSheet
        visible={!!picking}
        title={pickedItem ? `Link “${pickedItem.name}”` : "Link"}
        options={[
          { id: "__none__", label: "Not linked" },
          ...products.map((p) => ({ id: p.id, label: p.name })),
        ]}
        onPick={(id) => {
          if (pickedItem) setLink(pickedItem.ref, pickedItem.kind, id === "__none__" ? null : id);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </SafeAreaView>
  );
}

export default function DeliveryAppsRoute() {
  return (
    <RequirePermission permission="settings:manage">
      <DeliveryAppsScreen />
    </RequirePermission>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    height: 56,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey100,
  },
  toolbarBtn: { width: 44, alignItems: "center" },
  toolbarTitle: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.grey900 },
  body: { padding: 12, paddingBottom: 100 },
  card: { backgroundColor: colors.white, borderRadius: 16, padding: 14, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo: { width: 42, height: 42, borderRadius: 12, backgroundColor: "#FF4500", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "800", color: colors.grey900 },
  sub: { fontSize: 12, color: colors.grey600, marginTop: 2 },
  error: { marginTop: 10, color: colors.red500, fontSize: 12 },
  help: { fontSize: 13, color: colors.grey600, lineHeight: 18, marginTop: 10, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.grey900,
    marginTop: 6,
  },
  primary: { height: 48, borderRadius: 14, backgroundColor: colors.primaryDark, alignItems: "center", justifyContent: "center", marginTop: 12 },
  primaryText: { color: colors.white, fontSize: 15, fontWeight: "800" },
  disabled: { backgroundColor: colors.grey400 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  secondary: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.grey100 },
  secondaryText: { fontSize: 13, fontWeight: "700", color: colors.grey900 },
  section: { fontSize: 12, fontWeight: "700", color: colors.grey600, letterSpacing: 0.6, marginTop: 6, marginLeft: 4 },
  itemRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.grey100 },
  itemName: { fontSize: 14, fontWeight: "700", color: colors.grey900 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.grey100 },
});
