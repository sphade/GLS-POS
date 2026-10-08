import { InteractionManager, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import type { Permission } from "@gls-pos/types";
import { colors } from "@/constants/theme";
import { useCartCount } from "@/lib/cart";
import { quietPull } from "@/lib/sync";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { feedbackTap } from "@/lib/feedback";

/**
 * Custom bottom tab bar for GLS-POS.
 * Updated for improved visual hierarchy and better touch feedback.
 */
type TabMeta = {
  label: string;
  needs?: Permission;
  render: (color: string) => React.ReactNode;
};

const TABS: Record<string, TabMeta> = {
  reports: {
    label: "Reports",
    needs: "reports:view",
    render: (c) => <MaterialCommunityIcons name="chart-bar" size={24} color={c} />,
  },
  today: {
    label: "Today",
    needs: "receipts:view",
    render: (c) => <MaterialCommunityIcons name="calendar-today" size={24} color={c} />,
  },
  counter: {
    label: "Counter",
    render: (c) => <MaterialCommunityIcons name="cash-register" size={24} color={c} />,
  },
  index: {
    label: "Items",
    render: (c) => <MaterialCommunityIcons name="format-list-bulleted" size={24} color={c} />,
  },
  more: {
    label: "More",
    render: (c) => <Ionicons name="grid" size={22} color={c} />,
  },
};

function CounterBadge() {
  const count = useCartCount();
  if (count === 0) return null;
  
  const badgeSize = count >= 10 ? 20 : 18;
  const fontSize = count >= 10 ? 10 : 11;
  
  return (
    <View style={[styles.badge, { width: badgeSize, height: badgeSize }]}>
      <Text style={[styles.badgeText, { fontSize }]} numberOfLines={1}>
        {count > 99 ? "99+" : String(count)}
      </Text>
    </View>
  );
}

export function PosTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { store } = useStore();
  const { can } = useAuth();

  return (
    <View style={[styles.bar, { height: 64 + insets.bottom }]}>
      {state.routes.map((route, index) => {
        const meta = TABS[route.name];
        if (!meta) return null;
        if (meta.needs && !can(meta.needs)) return null;

        const focused = state.index === index;
        const isFocused = focused;
        
        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={meta.label}
            android_ripple={{ color: isFocused ? "#4CAF5022" : "#4CAF5011", borderless: false }}
            onPress={() => {
              feedbackTap();
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name as never);
              }
              InteractionManager.runAfterInteractions(() => quietPull(store.id));
            }}
            style={styles.tabContainer}
          >
            <View
              style={[
                styles.tab,
                {
                  backgroundColor: isFocused ? colors.primary : "transparent",
                  marginBottom: insets.bottom + 8,
                },
              ]}
            >
              <View style={styles.iconWrap}>
                {meta.render(isFocused ? colors.white : colors.primary)}
                {route.name === "counter" && <CounterBadge />}
              </View>
              <Text style={[styles.label, { color: isFocused ? colors.white : colors.grey600 }]}>
                {meta.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.screenBg,
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: 8,
    paddingRight: 8,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
  },
  tabContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  tab: {
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  iconWrap: { position: "relative" },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.red500,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: "700" },
  label: { fontSize: 11, fontWeight: "500", marginTop: 4, includeFontPadding: false },
});
