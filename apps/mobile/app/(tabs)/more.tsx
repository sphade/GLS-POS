import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { PosHeader } from "@/components/PosHeader";
import { useCatalog } from "@/lib/catalog";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { OFFLINE_MODE } from "@/lib/offline";
import { useStore } from "@/lib/store";
import { useWebOrders } from "@/lib/web-orders";
import { feedbackTap } from "@/lib/feedback";
import type { Permission } from "@gls-pos/types";

const CURRENCY = "NGN";

type Card = {
  key: string;
  /** Big value line on top (single line, autoshrinks). */
  value: string;
  /** Grey title below â€” always reserves 2 lines, which is what keeps every card the same height. */
  title: string;
  valueColor?: string;
  isNew?: boolean;
  route?: string;
  /** When set, the card is only shown to roles holding this permission. */
  needs?: Permission;
};

/**
 * More tab: 2-column grid of stat cards (mirrors MoreBaseFragment /
 * item_more_base.xml â€” value 23sp on top, title 16sp / 2 lines below,
 * optional green "New" badge pinned to the top-right corner).
 */
export default function MoreScreen() {
  const router = useRouter();
  const { products, customers } = useCatalog();
  const { can } = useAuth();
  const { store } = useStore();
  const { pendingCount } = useWebOrders();

  // Staff accounts live in the control plane (API), not the synced local
  // catalog — the old `staff.length` here always showed 0.
  const [staffCount, setStaffCount] = useState<number | null>(null);
  useEffect(() => {
    if (OFFLINE_MODE || !can("staff:manage")) return;
    let cancelled = false;
    void api
      .listMembers(store.id)
      .then((res) => {
        if (!cancelled && res.ok) setStaffCount(res.data.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [store.id, can]);

  const lowStock = products.filter((i) => i.stockQuantity !== null && i.stockQuantity <= 3).length;
  // Real stock valuation at selling price. (No fabricated "cost price" estimate.)
  const stockSell = products.reduce((s, i) => s + (i.stockQuantity ?? 0) * i.price, 0);

  const allCards: Card[] = [
    {
      key: "vip",
      value: String(pendingCount),
      title: "VIP Orders\n(from QR code)",
      valueColor: pendingCount > 0 ? colors.red500 : undefined,
      route: "/online-orders",
      needs: "sale:create",
    },
    { key: "items", value: String(products.length), title: "Items", route: "/inventory", needs: "catalog:write" },
    {
      key: "lowStocks",
      value: String(lowStock),
      title: "Low Stocks",
      valueColor: lowStock > 0 ? colors.red500 : undefined,
      route: "/inventory",
      needs: "inventory:adjust",
    },
    {
      key: "stockValue",
      value: formatMoney(stockSell, CURRENCY),
      title: "Stock Value\n(selling price)",
      route: "/inventory",
      needs: "reports:view",
    },
    { key: "customers", value: String(customers.length), title: "Customers", route: "/customers", needs: "customers:manage" },
    { key: "staff", value: staffCount === null ? "—" : String(staffCount), title: "Staff", route: "/staff", needs: "staff:manage" },
    { key: "expense", value: "Expenses", title: "Record & View", route: "/expense-categories", needs: "expenses:manage" },
    { key: "audit", value: "Activity", title: "Who did what", route: "/audit", needs: "audit:view" },
    { key: "settings", value: "Settings", title: "Business & Preferences", route: "/settings", needs: "settings:manage" },
  ];

  // Staff only see what their role allows. The server enforces the same matrix.
  const cards = allCards.filter((c) => !c.needs || can(c.needs));

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <PosHeader />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {cards.map((c) => (
            <Pressable
              key={c.key}
              style={styles.card}
              onPress={() => {
                feedbackTap();
                if (c.route) router.push(c.route as never);
              }}
              android_ripple={{ color: "#00000010" }}
            >
              {c.isNew && (
                <View style={styles.newBadge}>
                  <Text style={styles.newBadgeText}>New</Text>
                </View>
              )}
              <Text
                style={[styles.value, c.valueColor ? { color: c.valueColor } : null]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.52}
              >
                {c.value}
              </Text>
              <Text style={styles.title} numberOfLines={2}>
                {c.title}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.grey200 },

  scroll: { padding: 8, paddingBottom: 20 },

  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 },
  card: {
    width: "49%",
    backgroundColor: colors.white,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingTop: 16,
    paddingBottom: 12,
    alignItems: "center",
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  /** 23sp, bold, primary â€” single line (item_more_base.xml value). */
  value: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "700",
    color: colors.primary,
    textAlign: "center",
    width: "100%",
  },
  /** 16sp, regular, grey600 â€” exactly 2 lines reserved (keeps card heights uniform). */
  title: {
    fontSize: 16,
    lineHeight: 21,
    height: 42,
    fontWeight: "400",
    color: colors.grey600,
    textAlign: "center",
    marginTop: 8,
  },
  newBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: "#2E9E4F",
    borderTopRightRadius: 4,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  newBadgeText: { color: colors.white, fontSize: 12, fontWeight: "600" },
});



