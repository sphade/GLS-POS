import { useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, formatMoney, strings } from "@/constants/theme";
import type { Receipt } from "@/lib/cart";
import { lineNetOf, type ReturnState } from "@/lib/returns";

const modeIcon = (mode: string) => {
  if (mode.includes("Card")) return "credit-card-outline" as const;
  if (mode.includes("UPI")) return "cellphone" as const;
  if (mode === "Credit") return "account-clock-outline" as const;
  return "cash" as const;
};

type ReceiptDisclosureRowProps = {
  receipt: Receipt;
  awaitingUpload?: boolean;
  returned?: { refunded: number; state: ReturnState };
  /** Shows the compact line-item breakdown below the receipt summary. */
  expanded?: boolean;
  /** Expand rows disclose inline; navigate rows open the full receipt directly. */
  behavior: "expand" | "navigate";
  onPress: () => void;
  onLongPress?: () => void;
};

/**
 * Shared receipt summary used by Today and report drill-downs.
 *
 * Today enables the compact disclosure and reserves long press for the full
 * receipt. Report results use the same visual row but open full detail on tap.
 */
export function ReceiptDisclosureRow({
  receipt,
  awaitingUpload = false,
  returned,
  expanded = false,
  behavior,
  onPress,
  onLongPress,
}: ReceiptDisclosureRowProps) {
  const time = new Date(receipt.createdAt);
  // React Native can emit onPress after onLongPress on some platforms. Keep a
  // held receipt from collapsing just before its detail route opens.
  const longPressHandled = useRef(false);

  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.summary, pressed && styles.summaryPressed]}
        android_ripple={{ color: "#00000010" }}
        delayLongPress={450}
        accessibilityRole="button"
        accessibilityLabel={`${receipt.number}, ${formatMoney(receipt.total, receipt.currency)}`}
        accessibilityHint={
          behavior === "expand"
            ? "Tap to show the items. Press and hold to open the full receipt."
            : "Opens the full receipt."
        }
        accessibilityState={behavior === "expand" ? { expanded } : undefined}
        onPressIn={() => {
          longPressHandled.current = false;
        }}
        onLongPress={
          onLongPress
            ? () => {
                longPressHandled.current = true;
                onLongPress();
              }
            : undefined
        }
        onPress={() => {
          if (longPressHandled.current) {
            longPressHandled.current = false;
            return;
          }
          onPress();
        }}
      >
        <MaterialCommunityIcons
          name={modeIcon(receipt.mode)}
          size={28}
          color={colors.grey700}
          style={styles.modeIcon}
        />
        <View style={styles.summaryBody}>
          <View style={styles.topRow}>
            <Text style={styles.number}>{receipt.number}</Text>
            {awaitingUpload && <Ionicons name="sync" size={15} color={colors.red500} />}
            {returned && (
              <View style={styles.returnChip}>
                <Text style={styles.returnChipText}>
                  {returned.state === "full" ? "RETURNED" : "PART. RETURNED"}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.name}>
            {receipt.customerName ?? strings.guest} {strings.by} {receipt.mode}
          </Text>
          <Text style={styles.meta}>
            {receipt.itemCount} Items · {time.toLocaleDateString()} -{" "}
            {time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </Text>
        </View>
        <View style={styles.amountWrap}>
          <Text style={[styles.total, returned?.state === "full" && styles.totalReturned]}>
            {formatMoney(receipt.total, receipt.currency)}
          </Text>
          {returned && returned.refunded > 0 && (
            <Text style={styles.refunded}>
              -{formatMoney(returned.refunded, receipt.currency)}
            </Text>
          )}
          <Ionicons
            name={
              behavior === "navigate"
                ? "chevron-forward"
                : expanded
                  ? "chevron-up"
                  : "chevron-down"
            }
            size={17}
            color={colors.grey500}
          />
        </View>
      </Pressable>

      {behavior === "expand" && expanded && (
        <View style={styles.details}>
          <Text style={styles.detailsTitle}>ITEMS</Text>
          {receipt.lines.map((line, index) => {
            const lineNet = lineNetOf(line);
            const discount = Math.max(0, line.price * line.qty - lineNet);
            return (
              <View key={`${line.productId ?? line.name}:${line.variantId ?? ""}:${index}`} style={styles.lineRow}>
                <View style={styles.lineDescription}>
                  <Text style={styles.lineName}>{line.name}</Text>
                  <Text style={styles.lineMath}>
                    {line.qty} × {formatMoney(line.price, receipt.currency)}
                    {discount > 0 ? ` · -${formatMoney(discount, receipt.currency)}` : ""}
                  </Text>
                </View>
                <Text style={styles.lineTotal}>{formatMoney(lineNet, receipt.currency)}</Text>
              </View>
            );
          })}
          <View style={styles.detailsTotalRow}>
            <Text style={styles.detailsTotalLabel}>RECEIPT TOTAL</Text>
            <Text style={styles.detailsTotal}>{formatMoney(receipt.total, receipt.currency)}</Text>
          </View>
          <Text style={styles.holdHint}>Press and hold the receipt above for full details</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    marginHorizontal: 10,
    marginBottom: 8,
    borderRadius: 4,
    elevation: 1,
    overflow: "hidden",
  },
  summary: { flexDirection: "row", alignItems: "center", minHeight: 72 },
  summaryPressed: { opacity: 0.82 },
  modeIcon: { margin: 10 },
  summaryBody: { flex: 1, paddingVertical: 6 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  number: { fontSize: 16, fontWeight: "700", color: colors.grey900 },
  name: { fontSize: 14, color: colors.grey700, marginTop: 1 },
  meta: { fontSize: 12, color: colors.grey500, marginTop: 1 },
  amountWrap: { alignItems: "flex-end", paddingVertical: 8, paddingRight: 10, gap: 2 },
  total: { fontSize: 18, fontWeight: "700", color: colors.primary },
  totalReturned: { color: colors.grey500, textDecorationLine: "line-through" },
  refunded: { fontSize: 12, fontWeight: "800", color: colors.red500 },
  returnChip: {
    backgroundColor: "#FDECEA",
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 2,
  },
  returnChipText: { fontSize: 9, fontWeight: "800", color: colors.red800, letterSpacing: 0.4 },
  details: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.grey300,
    backgroundColor: colors.grey50,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 9,
  },
  detailsTitle: { fontSize: 10, fontWeight: "800", color: colors.grey600, letterSpacing: 0.6, marginBottom: 4 },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.grey200,
    gap: 10,
  },
  lineDescription: { flex: 1 },
  lineName: { fontSize: 14, fontWeight: "600", color: colors.grey800 },
  lineMath: { fontSize: 12, color: colors.grey600, marginTop: 2 },
  lineTotal: { fontSize: 13, fontWeight: "700", color: colors.grey900, fontVariant: ["tabular-nums"] },
  detailsTotalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 9,
  },
  detailsTotalLabel: { fontSize: 11, fontWeight: "800", color: colors.grey600, letterSpacing: 0.4 },
  detailsTotal: { fontSize: 14, fontWeight: "800", color: colors.primary },
  holdHint: { fontSize: 11, color: colors.grey500, textAlign: "right", marginTop: 7 },
});
