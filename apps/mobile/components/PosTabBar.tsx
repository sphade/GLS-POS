import { InteractionManager, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import type { Permission } from "@gls-pos/types";
import { colors } from "@/constants/theme";
import { useCartCount } from "@/lib/cart";
import { quietPull } from "@/lib/sync";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { useResponsive } from "@/lib/responsive";
import { feedbackTap } from "@/lib/feedback";

/**
 * Bottom navigation. White bar with a hairline top border; the active tab gets
 * a soft green pill behind a filled icon and a bold green label, inactive tabs
 * use outline icons in grey (Material 3 navigation-bar pattern).
 *
 * The safe-area inset is applied ONCE, as bottom padding on the bar. It used to
 * be added again as a margin on every tab, which pushed the icons up and
 * clipped the labels on phones with a gesture bar.
 */
type IconName = keyof typeof Ionicons.glyphMap;
type TabMeta = {
  label: string;
  needs?: Permission;
  icon: IconName;
  iconActive: IconName;
  /** Only the Central Store gets this tab. */
  centralOnly?: boolean;
  /** Hidden while the Central Store is active — it never rings up sales. */
  branchOnly?: boolean;
};

const TABS: Record<string, TabMeta> = {
  reports: { label: "Reports", needs: "reports:view", icon: "bar-chart-outline", iconActive: "bar-chart" },
  today: { label: "Today", needs: "receipts:view", icon: "receipt-outline", iconActive: "receipt" },
  counter: { label: "Counter", icon: "cart-outline", iconActive: "cart", branchOnly: true },
  transfers: {
    label: "Transfers",
    icon: "swap-horizontal-outline",
    iconActive: "swap-horizontal",
    centralOnly: true,
  },
  index: { label: "Items", icon: "grid-outline", iconActive: "grid" },
  more: { label: "More", icon: "menu-outline", iconActive: "menu" },
};

const BAR_HEIGHT = 64;

function CounterBadge() {
  const count = useCartCount();
  if (count === 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText} numberOfLines={1}>
        {count > 99 ? "99+" : String(count)}
      </Text>
    </View>
  );
}

export function PosTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { store } = useStore();
  const { can } = useAuth();
  const { isExpanded } = useResponsive();

  // A 1280px-wide till with five tabs spread across the whole bottom edge puts
  // a tab under each corner of the screen. Keep the bar full-bleed (it is the
  // safe-area owner) but centre its contents in a comfortable rail.
  const barHeight = isExpanded ? 72 : BAR_HEIGHT;
  const iconSize = isExpanded ? 25 : 22;
  const labelSize = isExpanded ? 12.5 : 11.5;

  return (
    <View style={[styles.bar, { height: barHeight + insets.bottom, paddingBottom: insets.bottom }]}>
      <View style={styles.inner}>
        {state.routes.map((route, index) => {
          const meta = TABS[route.name];
          if (!meta) return null;
          // `href: null` only hides a tab from the router's linking config; a
          // custom tab bar still receives every route, so the bar filters too.
          if (meta.centralOnly && !store.isCentral) return null;
          if (meta.branchOnly && store.isCentral) return null;
          if (meta.needs && !can(meta.needs)) return null;
          const focused = state.index === index;

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={meta.label}
              style={styles.tab}
              onPress={() => {
                feedbackTap();
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name as never);
                if (store?.id) InteractionManager.runAfterInteractions(() => quietPull(store.id));
              }}
            >
              <View
                style={[
                  styles.pill,
                  isExpanded && styles.pillWide,
                  focused && styles.pillActive,
                ]}
              >
                <Ionicons
                  name={focused ? meta.iconActive : meta.icon}
                  size={iconSize}
                  color={focused ? colors.primaryDark : colors.grey600}
                />
                {route.name === "counter" && <CounterBadge />}
              </View>
              <Text
                style={[styles.label, { fontSize: labelSize }, focused && styles.labelActive]}
                numberOfLines={1}
              >
                {meta.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.grey300,
    justifyContent: "center",
  },
  inner: {
    flexDirection: "row",
    flex: 1,
    width: "100%",
    maxWidth: 880,
    alignSelf: "center",
    paddingHorizontal: 4,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  pill: {
    width: 56,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  pillWide: { width: 64, height: 34, borderRadius: 17 },
  pillActive: { backgroundColor: "#E3F2E4" },
  label: { fontSize: 11.5, fontWeight: "600", color: colors.grey600, includeFontPadding: false },
  labelActive: { color: colors.primaryDark, fontWeight: "800" },
  badge: {
    position: "absolute",
    top: -2,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.red500,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: "800", includeFontPadding: false },
});
