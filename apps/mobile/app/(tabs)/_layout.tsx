import { Tabs } from "expo-router";
import { PosTabBar } from "@/components/PosTabBar";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth";

/**
 * 5-tab bottom navigation: Reports | Today | Counter | Items | More.
 * "Items" is the default home. Rendering is delegated to PosTabBar so the
 * active tab can be filled edge-to-edge with primary green.
 *
 * Tabs that reveal money (Reports, Today) are hidden from roles without
 * `reports:view` — a cashier or waiter shouldn't see takings. The server
 * enforces the same rules, so hiding here is purely for a clean UI.
 */
export default function TabsLayout() {
  const { count } = useCart();
  const { can } = useAuth();
  const seesReports = can("reports:view");

  return (
    <Tabs
      initialRouteName="index"
      tabBar={(props) => <PosTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen
        name="reports"
        options={{ title: "Reports", href: seesReports ? undefined : null }}
      />
      <Tabs.Screen name="today" options={{ title: "Today", href: seesReports ? undefined : null }} />
      <Tabs.Screen
        name="counter"
        options={{ title: "Counter", tabBarBadge: count > 0 ? count : undefined }}
      />
      <Tabs.Screen name="index" options={{ title: "Items" }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />
    </Tabs>
  );
}
