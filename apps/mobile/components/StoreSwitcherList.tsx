import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { useCartActions } from "@/lib/cart";

/**
 * The list of shops this user can switch between.
 *
 * Container-agnostic on purpose: the header drops it into a dropdown sheet, the
 * side drawer renders it inline. One implementation means the switch guard below
 * can't be present in one place and missing in the other.
 */
export function StoreSwitcherList({
  showTitle = true,
  showOwnerActions = true,
  onDone,
}: {
  showTitle?: boolean;
  /** The drawer already offers these in its header, so it opts out. */
  showOwnerActions?: boolean;
  onDone: () => void;
}) {
  const { store, stores, setStoreId } = useStore();
  const { canManageBusiness } = useAuth();
  const { getCount } = useCartActions();
  const router = useRouter();
  const pathname = usePathname();

  /**
   * Switching shop remounts the data providers, which throws away the open
   * cart — it lives in memory, not in the store's database. Held orders and
   * table tickets are saved and survive, a walk-in cart mid-ring-up does not,
   * so that case gets a confirmation instead of silently losing the sale.
   */
  const select = (id: string) => {
    feedbackTap();
    if (id === store.id) {
      onDone();
      return;
    }
    const count = getCount();
    if (count > 0) {
      Alert.alert(
        "Clear the open sale?",
        `There ${count === 1 ? "is" : "are"} ${count} item${count === 1 ? "" : "s"} in the cart. Switching shop clears it. Hold the order first if you want to keep it.`,
        [
          { text: "Stay here", style: "cancel" },
          {
            text: "Switch anyway",
            style: "destructive",
            onPress: () => {
              setStoreId(id);
              onDone();
              if (pathname === "/central-stock") router.replace("/");
            },
          },
        ],
      );
      return;
    }
    setStoreId(id);
    onDone();
    if (pathname === "/central-stock") router.replace("/");
  };

  const goTo = (route: string) => {
    feedbackTap();
    onDone();
    router.push(route as never);
  };

  return (
    <>
      {showTitle && <Text style={styles.title}>SWITCH SHOP</Text>}

      {[...stores]
        .sort((a, b) => Number(!!b.isCentral) - Number(!!a.isCentral))
        .map((s) => {
          const active = !s.isCentral && s.id === store.id;
          return (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={s.isCentral ? "Open Central Store" : `Switch to ${s.name}`}
              style={[styles.row, s.isCentral && styles.centralRow]}
              onPress={() => {
                if (s.isCentral) {
                  feedbackTap();
                  onDone();
                  router.push("/central-stock" as never);
                  return;
                }
                select(s.id);
              }}
              android_ripple={{ color: "#00000010" }}
            >
              <View
                style={[
                  styles.avatar,
                  active && { backgroundColor: colors.primary },
                  s.isCentral && styles.centralAvatar,
                ]}
              >
                {s.isCentral ? (
                  <MaterialCommunityIcons name="crown-outline" size={21} color={colors.white} />
                ) : (
                  <Text style={[styles.avatarText, active && { color: colors.white }]}>
                    {s.initials}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.rowName,
                    active && { color: colors.primary, fontWeight: "700" },
                    s.isCentral && { fontWeight: "800" },
                  ]}
                  numberOfLines={1}
                >
                  {s.name}
                </Text>
                <View style={styles.subRow}>
                  {s.isCentral ? (
                    <View style={styles.centralBadge}>
                      <Text style={styles.centralBadgeText}>CENTRAL</Text>
                    </View>
                  ) : null}
                  <Text style={styles.rowRef}>{s.reference}</Text>
                </View>
              </View>
              {s.isCentral ? (
                <Ionicons name="chevron-forward" size={20} color={colors.grey500} />
              ) : active ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              ) : null}
            </Pressable>
          );
        })}

      {/* Opening or editing a business is the owner's job. A cashier or waiter
          only switches between the shops they've been added to. */}
      {showOwnerActions && canManageBusiness && (
        <>
          <View style={styles.divider} />
          <Pressable
            style={styles.action}
            onPress={() => goTo("/create-store")}
            android_ripple={{ color: "#00000010" }}
          >
            <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
            <Text style={styles.actionText}>Create Shop</Text>
          </Pressable>
          <Pressable
            style={styles.action}
            onPress={() => goTo("/business-settings")}
            android_ripple={{ color: "#00000010" }}
          >
            <MaterialCommunityIcons name="store-cog-outline" size={22} color={colors.primary} />
            <Text style={styles.actionText}>Edit Business</Text>
          </Pressable>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.grey600,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.grey200,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 15, fontWeight: "800", color: colors.grey700 },
  centralRow: { backgroundColor: "#FFF8E1" },
  centralAvatar: { backgroundColor: "#B8860B" },
  centralBadge: {
    backgroundColor: "#B8860B",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginRight: 6,
  },
  centralBadgeText: { color: colors.white, fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },
  subRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  rowName: { fontSize: 16, color: colors.grey800, fontWeight: "500" },
  rowRef: { fontSize: 12, color: colors.grey500 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.grey300, marginVertical: 6 },
  action: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  actionText: { fontSize: 15, color: colors.primary, fontWeight: "600" },
});
