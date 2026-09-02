import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, strings } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";
import { useStore } from "@/lib/store";
import { AppDrawer } from "@/components/AppDrawer";
import { StoreSwitcherList } from "@/components/StoreSwitcherList";

/**
 * Shared primary-blue app bar (content_home_base.xml). Shows either the store
 * switcher dropdown (Counter/More) or a plain title (Items), plus optional
 * trailing actions.
 */
export function PosHeader({
  title,
  showLayoutSwitch = false,
  isGrid = true,
  showAddCustomer = false,
  onLayoutSwitch,
  onAddCustomer,
}: {
  /** When set, replaces the store dropdown with a static title. */
  title?: string;
  showLayoutSwitch?: boolean;
  isGrid?: boolean;
  showAddCustomer?: boolean;
  onLayoutSwitch?: () => void;
  onAddCustomer?: () => void;
}) {
  const { store } = useStore();
  const [open, setOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <AppDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Open navigation menu"
          accessibilityRole="button"
          style={styles.hamburger}
          hitSlop={14}
          onPress={() => {
            setDrawerOpen(true);
            feedbackTap();
          }}
        >
          <Ionicons name="menu" size={26} color={colors.white} />
        </Pressable>

        {title ? (
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        ) : (
          <Pressable
            style={styles.storeSelector}
            onPress={() => {
              feedbackTap();
              setOpen(true);
            }}
          >
            <Text style={styles.storeName} numberOfLines={1}>
              {store.name}
            </Text>
            <Ionicons name="caret-down" size={14} color={colors.white} />
          </Pressable>
        )}

        {showLayoutSwitch && (
          <Pressable
            style={styles.iconBtn}
            hitSlop={8}
            onPress={() => {
              feedbackTap();
              onLayoutSwitch?.();
            }}
          >
            <MaterialCommunityIcons
              name={isGrid ? "view-grid-outline" : "view-list-outline"}
              size={23}
              color={colors.white}
            />
          </Pressable>
        )}

        {showAddCustomer && (
          <Pressable
            style={styles.iconBtn}
            hitSlop={8}
            onPress={() => {
              feedbackTap();
              onAddCustomer?.();
            }}
          >
            <Ionicons name="person-add" size={22} color={colors.white} />
          </Pressable>
        )}

      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <StoreSwitcherList onDone={() => setOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/** Primary-blue search row with the barcode button (content_home_base.xml). */
export function PosSearchBar({
  value,
  onChangeText,
  onScan,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onScan?: () => void;
}) {
  return (
    <View style={styles.searchRow}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={20} color={colors.grey600} />
        <TextInput
          style={styles.searchInput}
          placeholder={strings.searchHint}
          placeholderTextColor={colors.grey500}
          value={value}
          onChangeText={onChangeText}
          returnKeyType="search"
        />
        {value.length > 0 && (
          <Pressable onPress={() => onChangeText("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.grey500} />
          </Pressable>
        )}
      </View>
      {onScan && (
        <Pressable
          style={styles.scanButton}
          onPress={() => {
            feedbackTap();
            onScan();
          }}
        >
          <MaterialCommunityIcons name="barcode-scan" size={26} color={colors.white} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 10,
  },
  hamburger: { paddingRight: 4 },
  title: { flex: 1, color: colors.white, fontSize: 19, fontWeight: "600" },
  storeSelector: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  storeName: { color: colors.white, fontSize: 19, fontWeight: "600", flexShrink: 1 },
  iconBtn: { paddingHorizontal: 2 },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingBottom: 12,
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 48,
    gap: 8,
  },
  searchInput: { flex: 1, color: colors.grey800, fontSize: 17, padding: 0 },
  scanButton: {
    width: 52,
    height: 48,
    borderRadius: 6,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
  },

  backdrop: { flex: 1, backgroundColor: "#00000066", justifyContent: "flex-start", paddingTop: 70, paddingHorizontal: 12 },
  sheet: { backgroundColor: colors.white, borderRadius: 6, paddingVertical: 8, elevation: 8 },
});

