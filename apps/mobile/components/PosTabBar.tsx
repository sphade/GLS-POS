import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { colors } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";

/**
 * Custom bottom tab bar. React Navigation's `tabBarActiveBackgroundColor` only
 * tints the inner item box (leaving white gaps), so we render each tab as one
 * full-height pressable and paint the active cell edge-to-edge in primary blue —
 * including the bottom safe-area strip.
 */
type TabMeta = {
  label: string;
  render: (color: string) => React.ReactNode;
};

const TABS: Record<string, TabMeta> = {
  reports: {
    label: "Reports",
    render: (c) => <MaterialCommunityIcons name="chart-box" size={24} color={c} />,
  },
  today: {
    label: "Today",
    render: (c) => <MaterialCommunityIcons name="cash-multiple" size={24} color={c} />,
  },
  counter: {
    label: "Counter",
    render: (c) => <MaterialCommunityIcons name="cash-register" size={24} color={c} />,
  },
  index: {
    label: "Items",
    render: (c) => <MaterialCommunityIcons name="format-list-bulleted-square" size={24} color={c} />,
  },
  more: {
    label: "More",
    render: (c) => <Ionicons name="grid" size={22} color={c} />,
  },
};

export function PosTabBar({ state, navigation, descriptors }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { height: 58 + insets.bottom }]}>
      {state.routes.map((route, index) => {
        const meta = TABS[route.name];
        if (!meta) return null;

        const focused = state.index === index;
        const tint = focused ? colors.white : colors.primary;
        const badge = descriptors[route.key]?.options.tabBarBadge;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={meta.label}
            android_ripple={{ color: focused ? "#FFFFFF22" : "#4169E122", borderless: false }}
            onPress={() => {
              feedbackTap();
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name as never);
              }
            }}
            style={[
              styles.tab,
              { backgroundColor: focused ? colors.primary : colors.white, paddingBottom: insets.bottom },
            ]}
          >
            <View style={styles.iconWrap}>
              {meta.render(tint)}
              {badge != null && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{String(badge)}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
              {meta.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.white,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: -2 },
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
    overflow: "hidden",
  },
  iconWrap: { position: "relative" },
  badge: {
    position: "absolute",
    top: -5,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: "#2E9E4F",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: "700" },
  label: { fontSize: 12, fontWeight: "600", marginTop: 3, includeFontPadding: false },
});
