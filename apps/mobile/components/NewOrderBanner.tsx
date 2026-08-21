import { useEffect } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { useWebOrders } from "@/lib/web-orders";
import { feedbackTap, startVipOrderAlarm, stopVipOrderAlarm } from "@/lib/feedback";

/**
 * Blocking in-app alert for a newly-arrived VIP/table order.
 *
 * It never auto-dismisses: staff must explicitly dismiss it or open the VIP
 * workflow. The provider queues simultaneous arrivals, so acknowledging this
 * order immediately surfaces the next one instead of losing it.
 */
export function NewOrderBanner() {
  const { arrival, dismissArrival } = useWebOrders();
  const router = useRouter();

  useEffect(() => {
    if (!arrival) { stopVipOrderAlarm(); return; }
    startVipOrderAlarm();
    return stopVipOrderAlarm;
  }, [arrival?.id]);

  if (!arrival) return null;

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

  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
    <SafeAreaView style={styles.backdrop}>
      <View style={styles.card}>
        <View style={styles.alarmRow}>
          <View style={styles.bell}><MaterialCommunityIcons name="bell-ring" size={30} color={colors.white} /></View>
          <View style={{ flex: 1 }}><Text style={styles.kicker}>NEW VIP ORDER</Text><Text style={styles.code}>{arrival.code}</Text></View>
          <View style={styles.live}><View style={styles.dot} /><Text style={styles.liveText}>LIVE</Text></View>
        </View>

        <Text style={styles.table}>{arrival.tableName}</Text>
        <Text style={styles.guest}>{arrival.guestName ? `Guest: ${arrival.guestName}` : "Guest table order"}</Text>

        <ScrollView style={styles.items} contentContainerStyle={{ paddingVertical: 5 }}>
          {arrival.lines.map((line, i) => <View key={`${line.productId}-${i}`} style={styles.line}>
            <Text style={styles.qty}>{line.quantity}×</Text>
            <View style={{ flex: 1 }}><Text style={styles.itemName}>{line.variantName ? `${line.name} — ${line.variantName}` : line.name}</Text>{line.note ? <Text style={styles.itemNote}>{line.note}</Text> : null}</View>
            <Text style={styles.price}>{formatMoney(line.lineTotal, arrival.currency)}</Text>
          </View>)}
        </ScrollView>
        {arrival.note ? <View style={styles.note}><Ionicons name="chatbubble-ellipses-outline" size={17} color={colors.grey700} /><Text style={styles.noteText}>{arrival.note}</Text></View> : null}
        <View style={styles.totalRow}><Text style={styles.totalLabel}>{arrival.lines.length} ITEM{arrival.lines.length === 1 ? "" : "S"}</Text><Text style={styles.total}>{formatMoney(arrival.total, arrival.currency)}</Text></View>

        <Pressable style={styles.attend} onPress={attend} android_ripple={{ color: "#FFFFFF22" }}>
          <MaterialCommunityIcons name="silverware-fork-knife" size={21} color={colors.white} /><Text style={styles.attendText}>ATTEND TO ORDER</Text>
        </Pressable>
        <Pressable style={styles.dismiss} onPress={dismiss}><Text style={styles.dismissText}>DISMISS FOR NOW</Text></Pressable>
        <Text style={styles.hint}>Dismissed orders stay in VIP Orders until completed.</Text>
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000000D9", justifyContent: "center", padding: 18 },
  card: { maxHeight: "92%", backgroundColor: colors.white, borderRadius: 16, overflow: "hidden", padding: 18, elevation: 24 },
  alarmRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  bell: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.red500, alignItems: "center", justifyContent: "center" },
  kicker: { color: colors.red500, fontSize: 13, fontWeight: "900", letterSpacing: 1.3 },
  code: { color: colors.grey900, fontSize: 24, fontWeight: "900", marginTop: 1 },
  live: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FFEBEE", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.red500 }, liveText: { color: colors.red500, fontSize: 10, fontWeight: "900" },
  table: { fontSize: 22, fontWeight: "800", color: colors.primary, marginTop: 18 }, guest: { fontSize: 13, color: colors.grey600, marginTop: 2 },
  items: { maxHeight: 245, marginTop: 13, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.grey300 },
  line: { flexDirection: "row", gap: 9, alignItems: "flex-start", paddingVertical: 10 }, qty: { width: 30, fontSize: 16, fontWeight: "900", color: colors.primary },
  itemName: { fontSize: 15, fontWeight: "700", color: colors.grey900 }, itemNote: { fontSize: 12, color: colors.grey600, marginTop: 2 }, price: { fontSize: 14, fontWeight: "800", color: colors.grey900 },
  note: { flexDirection: "row", gap: 7, backgroundColor: colors.grey50, borderRadius: 7, padding: 10, marginTop: 10 }, noteText: { flex: 1, color: colors.grey700, fontSize: 13 },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 }, totalLabel: { color: colors.grey600, fontSize: 12, fontWeight: "800" }, total: { color: colors.primary, fontSize: 23, fontWeight: "900" },
  attend: { height: 54, borderRadius: 8, backgroundColor: colors.green, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: 16 }, attendText: { color: colors.white, fontSize: 16, fontWeight: "900", letterSpacing: .6 },
  dismiss: { height: 46, alignItems: "center", justifyContent: "center" }, dismissText: { color: colors.grey700, fontSize: 13, fontWeight: "800" },
  hint: { color: colors.grey500, fontSize: 11, textAlign: "center" },
});