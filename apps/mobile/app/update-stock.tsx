import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { StockMovement } from "@gls-pos/types";
import { NumberInput } from "@/components/NumberInput";
import { CheckBox } from "@/components/VariantEditor";
import { colors, formatMoney } from "@/constants/theme";
import { loadStockMovements, useCatalog } from "@/lib/catalog";
import { useAuth } from "@/lib/auth";
import { feedbackTap } from "@/lib/feedback";
import { onSynced } from "@/lib/sync";
import { formatStockQuantity, retailValueOf, stockTargetsOf } from "@/lib/stock";

type Mode = "add" | "remove";

/** Timeline reveals a page at a time; a busy item accumulates thousands of rows. */
const TIMELINE_PAGE = 10;

const REASON: Record<StockMovement["reason"], { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  sale: { label: "Sold", icon: "cart-outline" },
  adjustment: { label: "Removed", icon: "remove-circle-outline" },
  initial: { label: "Opening stock", icon: "flag-outline" },
  restock: { label: "Added", icon: "add-circle-outline" },
  return: { label: "Returned", icon: "return-down-back-outline" },
  waste: { label: "Waste", icon: "trash-outline" },
};

export default function UpdateStockScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ productId?: string; variantId?: string }>();
  const { products, adjustStock } = useCatalog();
  const { can } = useAuth();
  const canAdjust = can("inventory:adjust");

  const product = products.find((candidate) => candidate.id === params.productId);
  const targets = useMemo(() => (product ? stockTargetsOf(product) : []), [product]);
  const requestedVariant = params.variantId;

  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(
    () => targets.find((t) => t.variantId === requestedVariant)?.variantId ?? targets[0]?.variantId,
  );
  const [mode, setMode] = useState<Mode>("add");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [autoUpdateStock, setAutoUpdateStock] = useState(true);
  const [saved, setSaved] = useState(false);

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [movementTotal, setMovementTotal] = useState(0);
  const [limit, setLimit] = useState(TIMELINE_PAGE);
  const submitting = useRef(false);

  const missingVariant =
    !!requestedVariant && !targets.some((t) => t.variantId === requestedVariant);
  const target = missingVariant
    ? undefined
    : targets.find((t) => t.variantId === selectedVariantId) ?? targets[0];

  // Mirror the authoritative sale-automation setting for whichever target is up.
  useEffect(() => {
    if (target) setAutoUpdateStock(target.autoUpdateStock);
  }, [target?.variantId, target?.autoUpdateStock]);

  // Reads one page from SQLite (never the whole log), and refreshes when this
  // device actually receives movement rows from another till.
  const loadTimeline = useCallback(() => {
    if (!product || !target) {
      setMovements([]);
      setMovementTotal(0);
      return;
    }
    const page = loadStockMovements(product.id, target.variantId, { limit, offset: 0 });
    setMovements(page.rows);
    setMovementTotal(page.total);
  }, [product?.id, target?.variantId, limit]);

  useEffect(() => {
    loadTimeline();
    return onSynced(({ pulledCollections }) => {
      if (pulledCollections.has("stock_movements")) loadTimeline();
    });
  }, [loadTimeline]);

  const loadMore = useCallback(() => {
    feedbackTap();
    setLimit((current) => current + TIMELINE_PAGE);
  }, []);

  const fractional = product?.sellBy === "fraction";
  const entered = Number.parseFloat(quantity);
  const validQuantity = Number.isFinite(entered) && entered > 0;

  // Only arithmetic per keystroke: the untouched targets' value is memoised.
  const otherTargetsValue = useMemo(
    () =>
      targets
        .filter((candidate) => candidate.variantId !== target?.variantId)
        .reduce((sum, candidate) => sum + retailValueOf(candidate.quantity, candidate.price), 0),
    [targets, target?.variantId],
  );

  const tooMuch = !!target && mode === "remove" && validQuantity && entered > target.quantity;
  const updatedStock = target
    ? validQuantity
      ? Math.max(0, target.quantity + (mode === "add" ? entered : -entered))
      : target.quantity
    : 0;
  const stockValue = target ? otherTargetsValue + retailValueOf(updatedStock, target.price) : 0;
  const canSubmit = canAdjust && !!product && !!target && validQuantity && !tooMuch;
  const tone = mode === "add" ? colors.actionAdd : colors.actionRemove;

  const pickTarget = (variantId?: string) => {
    feedbackTap();
    setSelectedVariantId(variantId);
    setQuantity("");
    setNote("");
    setSaved(false);
    setLimit(TIMELINE_PAGE); // each target has its own history
  };

  const submit = () => {
    if (!canSubmit || !product || !target || submitting.current) return;
    submitting.current = true;
    const result = adjustStock({
      productId: product.id,
      variantId: target.variantId,
      direction: mode,
      quantity: entered,
      note,
      autoUpdateStock,
    });
    if (!result.ok) {
      submitting.current = false;
      Alert.alert("Stock not updated", result.error);
      return;
    }
    feedbackTap();
    setQuantity("");
    setNote("");
    setSaved(true);
    loadTimeline();
    requestAnimationFrame(() => {
      submitting.current = false;
    });
  };

  if (!canAdjust || !product || !target) {
    const [title, body] = !canAdjust
      ? ["Permission required", "Your role cannot adjust inventory."]
      : !product
        ? ["Item not found", "This item may have been deleted on another device."]
        : missingVariant
          ? ["Variant not found", "That variant was removed or no longer tracks stock."]
          : ["Stock tracking is off", "Turn on stock tracking for this item first."];
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <View style={styles.toolbar}>
          <Pressable onPress={() => router.back()} style={styles.toolbarIcon} hitSlop={8}>
            <Ionicons name="close" size={26} color={colors.grey900} />
          </Pressable>
          <Text style={styles.toolbarTitle}>UPDATE STOCKS</Text>
        </View>
        <View style={styles.blocked}>
          <MaterialCommunityIcons name="package-variant-closed" size={52} color={colors.grey400} />
          <Text style={styles.blockedTitle}>{title}</Text>
          <Text style={styles.blockedText}>{body}</Text>
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
        <Text style={styles.toolbarTitle}>UPDATE STOCKS</Text>
        {/* Coloured by direction: removing stock is hard to reverse, so the
            commit never looks like a routine green save. */}
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
          <Text style={styles.itemName} numberOfLines={1}>
            {product.name}
          </Text>

          {targets.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {targets.map((candidate) => {
                const active = candidate.variantId === target.variantId;
                return (
                  <Pressable
                    key={candidate.variantId ?? "simple"}
                    style={[styles.chip, active && styles.chipOn]}
                    onPress={() => pickTarget(candidate.variantId)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextOn]}>
                      {candidate.name}
                    </Text>
                    <Text style={[styles.chipStock, active && styles.chipTextOn]}>
                      {formatStockQuantity(candidate.quantity)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {/* Direction */}
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
                REMOVE STOCK (-)
              </Text>
            </Pressable>
          </View>

          {/* Before / after */}
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Current Stock</Text>
              <Text style={styles.statValue}>{formatStockQuantity(target.quantity)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Updated Stock</Text>
              <Text style={[styles.statValue, { color: tone }]}>
                {validQuantity ? formatStockQuantity(updatedStock) : "-"}
              </Text>
              <Text style={styles.statWorth}>{formatMoney(stockValue, product.currency)}</Text>
            </View>
          </View>

          {/* Quantity */}
          <View style={styles.inputCard}>
            <Ionicons name={mode === "add" ? "add" : "remove"} size={26} color={tone} />
            <NumberInput
              style={styles.qtyInput}
              value={quantity}
              onChangeText={(value) => {
                setQuantity(value);
                setSaved(false);
              }}
              decimals={fractional}
              placeholder="Enter Stock Value"
              placeholderTextColor={colors.grey500}
            />
          </View>

          {tooMuch ? (
            <View style={styles.warn}>
              <Ionicons name="alert-circle" size={15} color={colors.red800} />
              <Text style={styles.warnText}>
                Only {formatStockQuantity(target.quantity)} available to remove.
              </Text>
            </View>
          ) : null}

          {/* Note */}
          <View style={styles.inputCard}>
            <TextInput
              style={styles.note}
              value={note}
              onChangeText={setNote}
              placeholder="Remarks or Notes"
              placeholderTextColor={colors.grey500}
              multiline
              maxLength={240}
              textAlignVertical="top"
            />
          </View>

          {/* Sale automation */}
          <View style={styles.checkCard}>
            <CheckBox value={autoUpdateStock} onChange={(value) => {
              setAutoUpdateStock(value);
              setSaved(false);
            }} />
            <Text style={styles.checkLabel}>Auto-update stock on item sales</Text>
          </View>

          {saved ? (
            <View style={styles.savedRow}>
              <Ionicons name="checkmark-circle" size={16} color={colors.dkGreen} />
              <Text style={styles.savedText}>Stock updated</Text>
            </View>
          ) : null}

          <Timeline movements={movements} total={movementTotal} onLoadMore={loadMore} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Isolated from the form on purpose: typing a quantity changes only the cards
 * above, so these rows never re-render while the number is being edited.
 */
const Timeline = memo(function Timeline({
  movements,
  total,
  onLoadMore,
}: {
  movements: StockMovement[];
  total: number;
  onLoadMore: () => void;
}) {
  const remaining = total - movements.length;
  return (
    <View style={styles.timeline}>
      <View style={styles.timelineHead}>
        <Text style={styles.timelineTitle}>HISTORY</Text>
        {total > 0 ? (
          <Text style={styles.timelineMeta}>
            {remaining > 0 ? `${movements.length} of ${total}` : total}
          </Text>
        ) : null}
      </View>

      {movements.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No stock changes yet</Text>
        </View>
      ) : (
        <View style={styles.card}>
          {movements.map((movement, index) => (
            <MovementRow
              key={movement.id}
              movement={movement}
              last={index === movements.length - 1}
            />
          ))}
        </View>
      )}

      {remaining > 0 ? (
        <Pressable style={styles.more} onPress={onLoadMore}>
          <Text style={styles.moreText}>LOAD MORE</Text>
          <Ionicons name="chevron-down" size={15} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
});

const MovementRow = memo(function MovementRow({
  movement,
  last,
}: {
  movement: StockMovement;
  last: boolean;
}) {
  const up = movement.delta > 0;
  const rowTone = up ? colors.actionAdd : colors.actionRemove;
  const meta = REASON[movement.reason] ?? { label: "Updated", icon: "ellipse-outline" as const };
  const who = movement.actorName ?? (movement.ref?.startsWith("api:") ? "Integration" : "System");
  const when = new Date(movement.at);

  return (
    <View style={[styles.row, last && { borderBottomWidth: 0 }]}>
      <View style={[styles.rowIcon, { backgroundColor: up ? "#E8F5E9" : "#FDECEA" }]}>
        <Ionicons name={meta.icon} size={17} color={rowTone} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle}>
            {formatStockQuantity(Math.abs(movement.delta))} {meta.label}
          </Text>
          <Text style={[styles.rowDelta, { color: rowTone }]}>
            {up ? "+" : "−"}
            {formatStockQuantity(Math.abs(movement.delta))}
          </Text>
        </View>
        {movement.ref ? <Text style={styles.rowRef}>From {movement.ref}</Text> : null}
        <Text style={styles.rowMeta}>
          {who} · {when.toLocaleDateString()} ·{" "}
          {when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </Text>
        {movement.note ? <Text style={styles.rowNote}>{movement.note}</Text> : null}
      </View>
      <Text style={styles.rowAfter}>={formatStockQuantity(movement.resulting)}</Text>
    </View>
  );
});

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

  body: { padding: 8, paddingBottom: 40 },
  itemName: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.grey700,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },

  chipRow: { gap: 8, paddingBottom: 8, paddingRight: 2 },
  chip: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 7,
    elevation: 1,
  },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.grey800 },
  chipStock: { fontSize: 11, color: colors.grey600, marginTop: 1 },
  chipTextOn: { color: colors.white },

  modeRow: { flexDirection: "row", gap: 3 },
  modeHalf: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderRadius: 4,
    paddingVertical: 17,
    elevation: 1,
  },
  modeAddOn: { backgroundColor: colors.actionAdd },
  modeRemoveOn: { backgroundColor: colors.actionRemove },
  modeText: { fontSize: 15, fontWeight: "800", letterSpacing: 0.3 },
  modeTextOn: { color: colors.white },
  modeAddOff: { color: colors.actionAdd },
  modeRemoveOff: { color: colors.actionRemove },

  statRow: { flexDirection: "row", gap: 3, marginTop: 8 },
  statCard: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 4,
    paddingVertical: 16,
    elevation: 1,
  },
  statLabel: { fontSize: 14, color: colors.grey700 },
  statValue: { fontSize: 21, fontWeight: "800", color: colors.grey900, marginTop: 8 },
  statWorth: { fontSize: 11, color: colors.grey500, marginTop: 3 },

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
    fontSize: 16,
    fontWeight: "700",
    color: colors.grey900,
    textAlign: "center",
    padding: 0,
  },
  note: { flex: 1, minHeight: 22, fontSize: 16, color: colors.grey900, padding: 0 },

  checkCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 18,
    marginTop: 8,
    elevation: 1,
  },
  checkLabel: { flex: 1, fontSize: 15, color: colors.grey800 },

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

  savedRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingTop: 12 },
  savedText: { color: colors.dkGreen, fontSize: 13, fontWeight: "700" },

  card: { backgroundColor: colors.white, borderRadius: 8, paddingHorizontal: 12, elevation: 1 },

  timeline: { marginTop: 24 },
  timelineHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  timelineTitle: { fontSize: 11.5, fontWeight: "800", color: colors.grey600, letterSpacing: 1 },
  timelineMeta: { fontSize: 11.5, color: colors.grey600, fontWeight: "600" },

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
  rowDelta: { fontSize: 14.5, fontWeight: "900" },
  rowRef: { fontSize: 11.5, color: colors.grey700, marginTop: 2 },
  rowMeta: { fontSize: 11.5, color: colors.grey600, marginTop: 2 },
  rowNote: { fontSize: 12, color: colors.grey700, marginTop: 4, fontStyle: "italic" },
  rowAfter: { fontSize: 13, fontWeight: "700", color: colors.grey500, minWidth: 34, textAlign: "right" },

  more: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: colors.white,
    borderRadius: 8,
    paddingVertical: 13,
    marginTop: 8,
  },
  moreText: { color: colors.primary, fontSize: 12.5, fontWeight: "800", letterSpacing: 0.6 },

  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30 },
  blockedTitle: { fontSize: 18, fontWeight: "800", color: colors.grey900, marginTop: 14 },
  blockedText: { fontSize: 13.5, color: colors.grey600, textAlign: "center", lineHeight: 20, marginTop: 6 },
});
