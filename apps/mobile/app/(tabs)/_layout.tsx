import { Tabs } from "expo-router";
import { PosTabBar } from "@/components/PosTabBar";
import { useCart } from "@/lib/cart";

/**
 * 5-tab bottom navigation: Reports | Today | Counter | Items | More.
 * "Items" is the default home. Rendering is delegated to PosTabBar so the
 * active tab can be filled edge-to-edge with primary blue.
 */
export default function TabsLayout() {
  const { count } = useCart();

  return (
    <Tabs
      initialRouteName="index"
      tabBar={(props) => <PosTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="reports" options={{ title: "Reports" }} />
      <Tabs.Screen name="today" options={{ title: "Today" }} />
      <Tabs.Screen
        name="counter"
        options={{ title: "Counter", tabBarBadge: count > 0 ? count : undefined }}
      />
      <Tabs.Screen name="index" options={{ title: "Items" }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />
    </Tabs>
  );
}
