import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { useWebOrders } from "@/lib/web-orders";
import { feedbackTap } from "@/lib/feedback";

/**
 * Slide-down alert shown when a VIP order arrives while the app is open.
 *
 * Sits above everything so staff notice it whatever screen they're on. Tapping
 * it opens the VIP Orders list. Auto-hides after 12s so it never blocks the till.
 */
export function NewOrderBanner() {
  const { arrival, dismissArrival } = useWebOrders();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const slide = useRef(new Animated.Value(-220)).current;

  useEffect(() => {
    if (!arrival) return;

    Animated.timing(slide, {
      toValue: 0,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => {
      Animated.timing(slide, {
        toValue: -220,
        duration: 260,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => dismissArrival());
    }, 12000);

    return () => clearTimeout(timer);
  }, [arrival, slide, dismissArrival]);

  if (!arrival) return null;

  const open = () => {
    feedbackTap();
    dismissArrival();
    router.push("/online-orders");
  };

  return (
    <Animated.View
      style={[
        styles.wrap,
        { paddingTop: insets.top + 10, transform: [{ translateY: slide }] },
      ]}
      pointerEvents="box-none"
    >
      <Pressable style={styles.card} onPress={open} android_ripple={{ color: "#FFFFFF22" }}>
        <View style={styles.icon}>
          <MaterialCommunityIcons name="bell-ring" size={22} color={colors.white} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>NEW VIP ORDER · {arrival.code}</Text>
          <Text style={styles.title} numberOfLines={1}>
            {arrival.tableName} · {arrival.lines.length} item
            {arrival.lines.length === 1 ? "" : "s"} · {formatMoney(arrival.total, arrival.currency)}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {arrival.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ")}
          </Text>
        </View>

        <Pressable
          hitSlop={10}
          onPress={() => {
            feedbackTap();
            dismissArrival();
          }}
          style={styles.close}
        >
          <Ionicons name="close" size={18} color="#FFFFFFAA" />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 999, paddingHorizontal: 10 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#1C1E16",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#C9A227",
    padding: 12,
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: { color: "#E4C767", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: "#F4F1E8", fontSize: 15, fontWeight: "700", marginTop: 2 },
  sub: { color: "#9A9787", fontSize: 12, marginTop: 2 },
  close: { padding: 4 },
});
