import { useEffect, useRef } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { displayItemName } from "@/lib/cart";
import { useWebOrders } from "@/lib/web-orders";
import { feedbackTap, startVipOrderAlarm, stopVipOrderAlarm } from "@/lib/feedback";

/**
 * Blocking alert for a newly arrived VIP (table QR) order.
 *
 * Shown only to the roles that receive VIP orders (see `receivesVipOrders`).
 * It never auto-dismisses: staff open the order or put it off explicitly. The
 * provider queues simultaneous arrivals, so acknowledging one shows the next.
 */
export function NewOrderBanner() {
  const { arrival, dismissArrival, active } = useWebOrders();
  const router = useRouter();
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!arrival) {
      stopVipOrderAlarm();
      return;
    }
    startVipOrderAlarm();
    // The bell swings while the alarm sounds, so the screen reads as "ringing"
    // even with the phone on silent.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1, duration: 90, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(ring, { toValue: -1, duration: 180, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(ring, { toValue: 0, duration: 90, easing: Easing.linear, useNativeDriver: true }),
        Animated.delay(700),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      stopVipOrderAlarm();
    };
  }, [arrival?.id]);

  if (!arrival) return null;

  const itemCount = arrival.lines.reduce((n, l) => n + l.quantity, 0);
  const waiting = Math.max(0, active.filter((o) => o.status === "received").length - 1);

  const dismiss = () => {
    feedbackTap();
    stopVipOrderAlarm();
    dismissArrival();
  };
  const attend = () => {
    feedbackTap();
    stopVipOrderAlarm();
    dismissArrival();
    router.push("/online-orders");
  };

  const rotate = ring.interpolate({ inputRange: [-1, 1], outputRange: ["-18deg", "18deg"] });

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <SafeAreaView style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.hero}>
            <Animated.View style={[styles.bell, { transform: [{ rotate }] }]}>
              <MaterialCommunityIcons name="bell-ring" size={30} color={colors.primaryDark} />
            </Animated.View>
            <Text style={styles.kicker}>NEW VIP ORDER</Text>
            <Text style={styles.table} numberOfLines={1}>
              {arrival.tableName}
            </Text>
            <View style={styles.metaRow}>
              <View style={styles.codeChip}>
                <Text style={styles.codeText}>{arrival.code}</Text>
              </View>
              <Text style={styles.metaText}>
                {arrival.guestName ? arrival.guestName : "Guest"} · {itemCount} item{itemCount === 1 ? "" : "s"}
              </Text>
            </View>
          </View>

          <ScrollView style={styles.items} contentContainerStyle={styles.itemsBody}>
            {arrival.lines.map((line, i) => (
              <View key={`${line.productId}-${i}`} style={styles.line}>
                <View style={styles.qtyBadge}>
                  <Text style={styles.qtyText}>{line.quantity}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{displayItemName(line.name, line.variantName)}</Text>
                  {line.note ? <Text style={styles.itemNote}>{line.note}</Text> : null}
                </View>
                <Text style={styles.price}>{formatMoney(line.lineTotal, arrival.currency)}</Text>
              </View>
            ))}
            {arrival.note ? (
              <View style={styles.note}>
                <MaterialCommunityIcons name="chef-hat" size={16} color={colors.primaryDark} />
                <Text style={styles.noteText}>{arrival.note}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.total}>{formatMoney(arrival.total, arrival.currency)}</Text>
            </View>
            <Pressable style={styles.attend} onPress={attend} android_ripple={{ color: "#FFFFFF22" }}>
              <MaterialCommunityIcons name="silverware-fork-knife" size={20} color={colors.white} />
              <Text style={styles.attendText}>Open order</Text>
            </Pressable>
            <Pressable style={styles.dismiss} onPress={dismiss} hitSlop={6}>
              <Text style={styles.dismissText}>Later</Text>
            </Pressable>
            <Text style={styles.hint}>
              {waiting > 0
                ? `${waiting} more new order${waiting === 1 ? "" : "s"} waiting`
                : "It stays in VIP Orders until it's done."}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000000CC", justifyContent: "center", padding: 18 },
  card: { maxHeight: "92%", backgroundColor: colors.white, borderRadius: 24, overflow: "hidden", elevation: 24 },
  hero: { backgroundColor: colors.primaryDark, alignItems: "center", paddingTop: 24, paddingBottom: 20, paddingHorizontal: 20 },
  bell: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: { color: "#FFFFFFB3", fontSize: 12, fontWeight: "800", letterSpacing: 1.6, marginTop: 14 },
  table: { color: colors.white, fontSize: 28, fontWeight: "900", marginTop: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  codeChip: { backgroundColor: "#FFFFFF26", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
  codeText: { color: colors.white, fontSize: 13, fontWeight: "800", letterSpacing: 0.6 },
  metaText: { color: "#FFFFFFCC", fontSize: 13, fontWeight: "600" },
  items: { maxHeight: 260 },
  itemsBody: { paddingHorizontal: 18, paddingVertical: 10 },
  line: { flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 9 },
  qtyBadge: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    paddingHorizontal: 6,
    backgroundColor: colors.grey100,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyText: { fontSize: 14, fontWeight: "900", color: colors.primaryDark },
  itemName: { fontSize: 15, fontWeight: "700", color: colors.grey900 },
  itemNote: { fontSize: 12, color: colors.grey600, marginTop: 2 },
  price: { fontSize: 14, fontWeight: "700", color: colors.grey700 },
  note: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    backgroundColor: colors.grey50,
    borderRadius: 12,
    padding: 11,
    marginTop: 8,
  },
  noteText: { flex: 1, color: colors.grey800, fontSize: 13, lineHeight: 18 },
  footer: { paddingHorizontal: 18, paddingBottom: 16, borderTopWidth: 1, borderTopColor: colors.grey100 },
  totalRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingVertical: 14 },
  totalLabel: { color: colors.grey600, fontSize: 14, fontWeight: "700" },
  total: { color: colors.grey900, fontSize: 24, fontWeight: "900" },
  attend: {
    height: 54,
    borderRadius: 14,
    backgroundColor: colors.primaryDark,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  attendText: { color: colors.white, fontSize: 16, fontWeight: "800" },
  dismiss: { height: 46, alignItems: "center", justifyContent: "center" },
  dismissText: { color: colors.grey700, fontSize: 15, fontWeight: "700" },
  hint: { color: colors.grey500, fontSize: 12, textAlign: "center" },
});
