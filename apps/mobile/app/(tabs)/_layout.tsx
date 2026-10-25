import { Tabs } from "expo-router";
import { PosTabBar } from "@/components/PosTabBar";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";

/**
 * 5-tab bottom navigation: Reports | Today | Counter | Items | More.
 * "Items" is the default home. Rendering is delegated to PosTabBar so the
 * active tab can be filled edge-to-edge with primary green.
 *
 * The Central Store is a parent warehouse, not a shop that rings up sales, so
 * its bar swaps Counter for Transfers: Reports | Today | Transfers | Items |
 * More. Its Items tab lists the central stock rather than a POS catalog.
 *
 * The two money tabs are gated separately. `reports:view` is the business's
 * aggregate figures for owners and managers; `receipts:view` also gives
 * supervisors the day's individual sales so they can look one up or reprint it.
 * A cashier or waiter gets neither. The server enforces the same matrix, so this
 * is only for a clean UI — and note PosTabBar applies these gates too, since a
 * custom tab bar renders from the navigator's routes and would otherwise ignore
 * `href: null`.
 */
export default function TabsLayout() {
  const { can } = useAuth();
  const { store } = useStore();
  const isCentral = !!store.isCentral;
  const seesReports = can("reports:view");
  const seesReceipts = can("receipts:view");

  return (
    <Tabs
      initialRouteName="index"
      backBehavior="initialRoute"
      tabBar={(props) => <PosTabBar {...props} />}
      screenOptions={{ headerShown: false, freezeOnBlur: true }}
    >
      <Tabs.Screen
        name="reports"
        options={{ title: "Reports", href: seesReports ? undefined : null }}
      />
      <Tabs.Screen
        name="today"
        options={{ title: "Today", href: seesReceipts ? undefined : null }}
      />
      <Tabs.Screen name="counter" options={{ title: "Counter", href: isCentral ? null : undefined }} />
      <Tabs.Screen name="transfers" options={{ title: "Transfers", href: isCentral ? undefined : null }} />
      <Tabs.Screen name="index" options={{ title: "Items" }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />
    </Tabs>
  );
}
