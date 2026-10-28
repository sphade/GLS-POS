import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useLocalSearchParams, useRouter } from "expo-router";
import { NumberInput } from "@/components/NumberInput";
import { colors } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import {
  adjustCentralStockLocal,
  centralItem,
  centralStockMovements,
  flushCentralOutbox,
  refreshCentralStockMovements,
  useCentralRevision,
} from "@/lib/central";
import { feedbackTap } from "@/lib/feedback";

type Mode = "add" | "remove";

/** One tap fills the quantity with the common delivery sizes. */
const QUICK = [1, 5, 10, 50] as const;

/**
 * Add or remove central stock the same way a menu item is adjusted.
 *
 * The owner almost never knows the new total — they know what arrived ("50 more
 * bags") or what left ("20 kg spoilt"). This screen takes that amount, shows the
 * balance before and after, and writes a ledger row so the change is explainable
 * later. Direct total editing stays on the editor for corrections.
 */
export default function CentralAdjustStockScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { stores, user } = useAuth();
  const revision = useCentralRevision();

  const central = stores.find((s) => s.isCentral);
  const canManage = central
    ? central.role === "owner" || central.role === "manager"
    : stores.some((s) => s.role === "owner");

  const [mode, setMode] = useState<Mode>("add");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);

  const item = useMemo(() => {
    // Recomputed on every local write so the header never shows a stale total.
    void revision;
    return central && id ? centralItem(central.id, id) : null;
  }, [central, id, revision]);

  const history = useMemo(() => {
    void revision;
    return central && id ? centralStockMovements(central.id, id) : [];
  }, [central, id, revision]);

  const loadHistory = useCallback(async () => {
    if (!central || !id) return;
    await refreshCentralStockMovements(central.id, id);
  }, [central, id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const entered = Number.parseInt(quantity, 10);
  const validQuantity = Number.isInteger(entered) && entered > 0;
  const delta = mode === "add" ? entered : -entered;
  const base = item?.totalStock ?? 0;
  const next = validQuantity ? Math.max(0, base + delta) : base;
  const tooMuch = !!item && mode === "remove" && validQuantity && entered > base;
  const canSubmit = !!item && !!central && !!user && validQuantity && !tooMuch;
  const tone = mode === "add" ? colors.actionAdd : colors.actionRemove;

  const submit = () => {
    if (!canSubmit || !item || !central || !user) return;

    const result = adjustCentralStockLocal(
      central.id,
      { itemId: item.id, delta, note },
      { id: user.id, name: user.name, email: user.email },
    );
    if (!result.ok) {
      Alert.alert("Stock not updated", result.error);
      return;
    }

    feedbackTap();
    void flushCentralOutbox(
      central.id,
      { id: user.id, name: user.name, email: user.email },
      stores.map((membership) => ({ id: membership.id })),
    );
    setQuantity("");
    setNote("");
    setSaved(true);
  };

  if (!canManage || !central) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <View style={styles.toolbar}>
          <Pressable onPress={() => router.back()} style={styles.toolbarIcon} hitSlop={8}>
            <Ionicons name="close" size={26} color={colors.grey900} />
          </Pressable>
          <Text style={styles.toolbarTitle}>ADJUST STOCK</Text>
        </View>
        <View style={styles.blocked}>
          <Ionicons name="lock-closed" size={48} color={colors.grey400} />
          <Text style={styles.blockedTitle}>Owners and managers only</Text>
          <Text style={styles.blockedText}>
            Only the owner or manager of the central store can change its stock.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!item) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <View style={styles.toolbar}>
          <Pressable onPress={() => router.back()} style={styles.toolbarIcon} hitSlop={8}>
            <Ionicons name="close" size={26} color={colors.grey900} />
          </Pressable>
          <Text style={styles.toolbarTitle}>ADJUST STOCK</Text>
        </View>
        <View style={styles.blocked}>
          <Ionicons name="cube-outline" size={48} color={colors.grey400} />
          <Text style={styles.blockedTitle}>Item not found</Text>
          <Text style={styles.blockedText}>
            It may have been deleted. Reopen Central Items to pick another.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} style={styles.toolbarIcon} hitSlop={8}>
          <Ionicons name="close" size={26} color={colors.grey900} />
        </Pressable>
        <Text style={styles.toolbarTitle}>ADJUST STOCK</Text>
        <Pressable
          style={[styles.commit, { backgroundColor: tone }, !canSubmit && styles.commitOff]}
          disabled={!canSubmit}
          onPress={submit}
        >
          <Text style={styles.commitText}>UPDATE</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.itemCard}>
            <View style={styles.itemAvatar}>
              <Text style={styles.itemAvatarText}>{item.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.itemMeta}>
                {base} {item.unit} in stock
              </Text>
            </View>
          </View>

          <View style={styles.modeRow}>
            <Pressable
              style={[styles.modeHalf, mode === "add" && styles.modeAddOn]}
              onPress={() => {
                feedbackTap();
                setMode("add");
                setSaved(false);
              }}
            >
              <Text style={[styles.modeText, mode === "add" ? styles.modeTextOn : styles.modeAddOff]}>
                ADD STOCK (+)
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modeHalf, mode === "remove" && styles.modeRemoveOn]}
              onPress={() => {
                feedbackTap();
                setMode("remove");
                setSaved(false);
              }}
            >
              <Text
                style={[styles.modeText, mode === "remove" ? styles.modeTextOn : styles.modeRemoveOff]}
              >
                REMOVE STOCK (−)
              </Text>
            </Pressable>
          </View>

          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Current</Text>
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
                {base} <Text style={styles.statUnit}>{item.unit}</Text>
              </Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>After update</Text>
              <Text
                style={[styles.statValue, { color: validQuantity ? tone : colors.grey400 }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {validQuantity ? next : "—"}{" "}
                <Text style={styles.statUnit}>{validQuantity ? item.unit : ""}</Text>
              </Text>
            </View>
          </View>

          <View style={styles.inputCard}>
            <Ionicons name={mode === "add" ? "add" : "remove"} size={28} color={tone} />
            <NumberInput
              style={styles.qtyInput}
              value={quantity}
              onChangeText={(value) => {
                setQuantity(value);
                setSaved(false);
              }}
              decimals={false}
              placeholder={`Amount in ${item.unit}`}
              placeholderTextColor={colors.grey500}
            />
          </View>

          <View style={styles.quickRow}>
            {QUICK.map((amount) => (
              <Pressable
                key={amount}
                style={styles.quickChip}
                onPress={() => {
                  feedbackTap();
                  setQuantity(String(amount));
                  setSaved(false);
                }}
              >
                <Text style={styles.quickChipText}>
                  {mode === "add" ? "+" : "−"}
                  {amount}
                </Text>
              </Pressable>
            ))}
          </View>

          {tooMuch ? (
            <View style={styles.warn}>
              <Ionicons name="alert-circle" size={15} color={colors.red800} />
              <Text style={styles.warnText}>
                Only {base} {item.unit} available to remove.
              </Text>
            </View>
          ) : null}

          <View style={styles.inputCard}>
            <TextInput
              style={styles.note}
              value={note}
              onChangeText={(value) => {
                setNote(value);
                setSaved(false);
              }}
              placeholder="Why? e.g. 50kg bags from Mile 12"
              placeholderTextColor={colors.grey500}
              multiline
              maxLength={240}
              textAlignVertical="top"
            />
          </View>

          {saved ? (
            <View style={styles.savedRow}>
              <Ionicons name="checkmark-circle" size={16} color={colors.dkGreen} />
              <Text style={styles.savedText}>Stock updated</Text>
            </View>
          ) : null}

          <View style={styles.timeline}>
            <Text style={styles.timelineTitle}>HISTORY</Text>
            {history.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No stock changes yet</Text>
              </View>
            ) : (
              <View style={styles.card}>
                {history.map((movement, index) => {
                  const up = movement.delta > 0;
                  const rowTone = up ? colors.actionAdd : colors.actionRemove;
                  const when = new Date(movement.at);
                  return (
                    <View
                      key={movement.id}
                      style={[styles.row, index === history.length - 1 && { borderBottomWidth: 0 }]}
                    >
                      <View
                        style={[
                          styles.rowIcon,
                          { backgroundColor: up ? "#E8F5E9" : "#FDECEA" },
                        ]}
                      >
                        <Ionicons
                          name={up ? "add-circle-outline" : "remove-circle-outline"}
                          size={18}
                          color={rowTone}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.rowTop}>
                          <Text style={styles.rowTitle}>{up ? "Added" : "Removed"}</Text>
                          <Text style={[styles.rowDelta, { color: rowTone }]}>
                            {up ? "+" : "−"}
                            {Math.abs(movement.delta)} {item.unit}
                          </Text>
                        </View>
                        <Text style={styles.rowMeta}>
                          {movement.actorName ?? "Unknown"} · {when.toLocaleDateString()} ·{" "}
                          {when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </Text>
                        {movement.note ? <Text style={styles.rowNote}>{movement.note}</Text> : null}
                      </View>
                      <Text style={styles.rowAfter}>
                        ={movement.resulting}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },

  toolbar: {
    height: 58,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    paddingRight: 8,
    elevation: 2,
  },
  toolbarIcon: { width: 48, alignItems: "center", justifyContent: "center" },
  toolbarTitle: {
    flex: 1,
    color: colors.primary,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  commit: { borderRadius: 4, paddingHorizontal: 24, paddingVertical: 11 },
  commitOff: { backgroundColor: colors.grey400 },
  commitText: { color: colors.white, fontSize: 14, fontWeight: "800", letterSpacing: 0.6 },

  body: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    padding: 8,
    paddingBottom: 40,
  },

  itemCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.white,
    borderRadius: 4,
    padding: 12,
    marginBottom: 8,
    elevation: 1,
  },
  itemAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.blue50,
    alignItems: "center",
    justifyContent: "center",
  },
  itemAvatarText: { color: colors.primaryDark, fontSize: 16, fontWeight: "800" },
  itemName: { fontSize: 16, fontWeight: "800", color: colors.grey900 },
  itemMeta: { fontSize: 12.5, color: colors.grey600, marginTop: 2 },

  modeRow: { flexDirection: "row", gap: 3 },
  modeHalf: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderRadius: 4,
    paddingVertical: 16,
    elevation: 1,
  },
  modeAddOn: { backgroundColor: colors.actionAdd },
  modeRemoveOn: { backgroundColor: colors.actionRemove },
  modeText: { fontSize: 14, fontWeight: "800", letterSpacing: 0.3 },
  modeTextOn: { color: colors.white },
  modeAddOff: { color: colors.actionAdd },
  modeRemoveOff: { color: colors.actionRemove },

  statRow: { flexDirection: "row", gap: 3, marginTop: 8 },
  statCard: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 4,
    paddingVertical: 14,
    paddingHorizontal: 8,
    elevation: 1,
  },
  statLabel: { fontSize: 12.5, color: colors.grey700 },
  statValue: { fontSize: 22, fontWeight: "800", color: colors.grey900, marginTop: 6 },
  statUnit: { fontSize: 13, fontWeight: "700", color: colors.grey500 },

  inputCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.white,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 18,
    marginTop: 8,
    elevation: 1,
  },
  qtyInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: "800",
    color: colors.grey900,
    textAlign: "center",
    padding: 0,
  },
  note: { flex: 1, minHeight: 22, fontSize: 16, color: colors.grey900, padding: 0 },

  quickRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  quickChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 4,
    backgroundColor: colors.blue50,
  },
  quickChipText: { fontSize: 13, fontWeight: "800", color: colors.primaryDark },

  warn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FDECEA",
    borderRadius: 4,
    padding: 10,
    marginTop: 8,
  },
  warnText: { color: colors.red800, fontSize: 12, fontWeight: "600" },

  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingTop: 12,
  },
  savedText: { color: colors.dkGreen, fontSize: 13, fontWeight: "700" },

  timeline: { marginTop: 22 },
  timelineTitle: {
    fontSize: 11.5,
    fontWeight: "800",
    color: colors.grey600,
    letterSpacing: 1,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  card: { backgroundColor: colors.white, borderRadius: 8, paddingHorizontal: 12, elevation: 1 },
  empty: { alignItems: "center", backgroundColor: colors.white, borderRadius: 8, padding: 24 },
  emptyText: { color: colors.grey500, fontSize: 13 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey200,
  },
  rowIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.grey900 },
  rowDelta: { fontSize: 14, fontWeight: "900" },
  rowMeta: { fontSize: 11.5, color: colors.grey600, marginTop: 2 },
  rowNote: { fontSize: 12, color: colors.grey700, marginTop: 4, fontStyle: "italic" },
  rowAfter: { fontSize: 13, fontWeight: "700", color: colors.grey500, minWidth: 34, textAlign: "right" },

  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  blockedTitle: { fontSize: 18, fontWeight: "800", color: colors.grey900, marginTop: 14 },
  blockedText: { fontSize: 13.5, color: colors.grey600, textAlign: "center", lineHeight: 20 },
});
