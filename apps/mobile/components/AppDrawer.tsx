import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { Permission } from "@gls-pos/types";
import { colors } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { StoreSwitcherList } from "@/components/StoreSwitcherList";

type Entry = {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  route: string;
  /** Hidden unless the signed-in role holds this permission. */
  needs?: Permission;
};

/**
 * Every entry routes somewhere real. Dead links (Activity History, Receipt
 * Settings, Device Details) were removed — they did nothing when tapped.
 */
const GROUPS: { title: string; entries: Entry[] }[] = [
  {
    title: "MANAGEMENT",
    entries: [
      { label: "VIP Orders (QR)", icon: "qrcode-scan", route: "/online-orders", needs: "sale:create" },
      { label: "Inventory Management", icon: "package-variant-closed", route: "/inventory", needs: "catalog:write" },
      { label: "Table Management", icon: "table-furniture", route: "/tables", needs: "tables:manage" },
      { label: "Customers Management", icon: "account-group-outline", route: "/customers", needs: "customers:manage" },
      { label: "Staff Management", icon: "account-tie-outline", route: "/staff", needs: "staff:manage" },
      { label: "Add Expense", icon: "cash-minus", route: "/expense-categories", needs: "expenses:manage" },
      { label: "Receipts", icon: "receipt", route: "/(tabs)/today", needs: "reports:view" },
      { label: "Returns & Refunds", icon: "cash-refund", route: "/returns", needs: "sale:refund" },
      { label: "Activity History", icon: "history", route: "/audit", needs: "audit:view" },
    ],
  },
  {
    title: "SETTINGS",
    entries: [
      { label: "Business Settings", icon: "store-cog-outline", route: "/business-settings", needs: "settings:manage" },
      { label: "Printer Setup", icon: "printer-outline", route: "/printer-setup" },
      { label: "General Settings", icon: "cog-outline", route: "/settings", needs: "settings:manage" },
    ],
  },
];

const DRAWER_WIDTH = Math.min(340, Dimensions.get("window").width * 0.82);
const DURATION = 220;

/**
 * Side drawer opened from the hamburger in PosHeader.
 *
 * Slides in from the left with its own animation. The previous version used
 * `Modal animationType="slide"`, which on Android animates from the *bottom* —
 * the wrong direction for a side drawer, and the source of the odd motion. We
 * animate translateX and the backdrop opacity by hand, and only unmount once
 * the close animation has finished so it never snaps shut.
 */
export function AppDrawer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const { store } = useStore();
  const { can, canManageBusiness, signOut, stores } = useAuth();
  const canSwitch = stores.length > 1;

  // Keep the modal mounted through the close animation.
  const [mounted, setMounted] = useState(visible);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(translateX, { toValue: 0, duration: DURATION, useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 1, duration: DURATION, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(translateX, { toValue: -DRAWER_WIDTH, duration: DURATION, useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 0, duration: DURATION, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) {
          setMounted(false);
          // Reopening should start collapsed, not on whatever was left expanded.
          setSwitcherOpen(false);
        }
      });
    }
  }, [visible, mounted, translateX, backdrop]);

  const go = (route: string) => {
    feedbackTap();
    onClose();
    router.push(route as never);
  };

  // Render immediately on the opening commit; `mounted` only keeps the modal
  // alive while its close animation finishes.
  if (!visible && !mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.fill}>
        <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
          <Pressable style={styles.fill} onPress={onClose} />
        </Animated.View>

        <Animated.View style={[styles.drawer, { transform: [{ translateX }] }]}>
          <View style={styles.header}>
            <Text style={styles.appName}>GLS-POS</Text>
            {/* Tappable only when there's somewhere to switch to, so a
                single-shop owner isn't given a control that does nothing. */}
            <Pressable
              style={styles.storeRow}
              disabled={!canSwitch}
              accessibilityRole={canSwitch ? "button" : undefined}
              accessibilityLabel={canSwitch ? "Switch shop" : undefined}
              onPress={() => {
                feedbackTap();
                setSwitcherOpen((v) => !v);
              }}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{store.initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.storeName} numberOfLines={1}>
                  {store.name}
                </Text>
                <Text style={styles.storeRef}>{store.reference}</Text>
              </View>
              {canSwitch && (
                <MaterialCommunityIcons
                  name={switcherOpen ? "chevron-up" : "unfold-more-horizontal"}
                  size={22}
                  color={colors.white}
                />
              )}
            </Pressable>
            {/* Anyone with two memberships can switch shop above; only an owner
                can open or reshape one. Both live here because the header's
                switcher is hidden on any tab that shows a title instead. */}
            {canManageBusiness && (
              <View style={styles.ownerActions}>
                <Pressable onPress={() => go("/business-settings")} style={styles.ownerAction}>
                  <MaterialCommunityIcons name="store-cog-outline" size={15} color={colors.white} />
                  <Text style={styles.ownerActionText}>Edit business</Text>
                </Pressable>
                <Pressable onPress={() => go("/create-store")} style={styles.ownerAction}>
                  <MaterialCommunityIcons name="plus-circle-outline" size={15} color={colors.white} />
                  <Text style={styles.ownerActionText}>Add shop</Text>
                </Pressable>
              </View>
            )}
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            {switcherOpen && (
              <View style={styles.switcher}>
                <StoreSwitcherList
                  showTitle={false}
                  // The header above already offers Add shop / Edit business.
                  showOwnerActions={false}
                  onDone={() => {
                    setSwitcherOpen(false);
                    onClose();
                  }}
                />
              </View>
            )}

            {GROUPS.map((g) => {
              const allowed = g.entries.filter((e) => !e.needs || can(e.needs));
              if (allowed.length === 0) return null;
              return (
                <View key={g.title}>
                  <Text style={styles.groupTitle}>{g.title}</Text>
                  {allowed.map((e) => (
                    <Pressable
                      key={e.label}
                      style={styles.row}
                      onPress={() => go(e.route)}
                      android_ripple={{ color: "#00000010" }}
                    >
                      <MaterialCommunityIcons name={e.icon} size={22} color={colors.primary} />
                      <Text style={styles.rowLabel}>{e.label}</Text>
                    </Pressable>
                  ))}
                </View>
              );
            })}

            <View style={styles.divider} />
            <Pressable
              style={styles.row}
              onPress={() => {
                feedbackTap();
                onClose();
                void signOut();
              }}
              android_ripple={{ color: "#00000010" }}
            >
              <MaterialCommunityIcons name="logout" size={22} color={colors.red500} />
              <Text style={[styles.rowLabel, { color: colors.red500 }]}>Logout</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000066" },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: DRAWER_WIDTH,
    backgroundColor: colors.white,
    elevation: 16,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 2, height: 0 },
  },
  header: { backgroundColor: colors.primary, paddingHorizontal: 16, paddingTop: 44, paddingBottom: 16 },
  appName: { color: colors.white, fontSize: 20, fontWeight: "800" },
  storeRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#FFFFFF33",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.white, fontSize: 17, fontWeight: "800" },
  storeName: { color: colors.white, fontSize: 16, fontWeight: "700" },
  storeRef: { color: "#FFFFFFBB", fontSize: 12, marginTop: 2 },
  ownerActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  ownerAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FFFFFF22",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  ownerActionText: { color: colors.white, fontSize: 12, fontWeight: "700" },
  switcher: {
    backgroundColor: colors.grey100,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.grey300,
  },

  groupTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.grey600,
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 13 },
  rowLabel: { flex: 1, fontSize: 15, color: colors.grey800 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.grey300, marginVertical: 8 },
});
