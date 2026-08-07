import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, strings } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";
import { useStore } from "@/lib/store";
import { AppDrawer } from "@/components/AppDrawer";

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
  showShare = false,
  onLayoutSwitch,
  onAddCustomer,
  onShare,
  onChat,
}: {
  /** When set, replaces the store dropdown with a static title. */
  title?: string;
  showLayoutSwitch?: boolean;
  isGrid?: boolean;
  showAddCustomer?: boolean;
  showShare?: boolean;
  onLayoutSwitch?: () => void;
  onAddCustomer?: () => void;
  onShare?: () => void;
  onChat?: () => void;
}) {
  const { store, stores, setStoreId } = useStore();
  const [open, setOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <AppDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <View style={styles.header}>
        <Pressable
          style={styles.hamburger}
          hitSlop={8}
          onPress={() => {
            feedbackTap();
            setDrawerOpen(true);
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

        {showShare && (
          <Pressable
            style={styles.iconBtn}
            hitSlop={8}
            onPress={() => {
              feedbackTap();
              onShare?.();
            }}
          >
            <Ionicons name="share-social" size={22} color={colors.white} />
          </Pressable>
        )}

        <Pressable
          style={styles.chatBtn}
          hitSlop={8}
          onPress={() => {
            feedbackTap();
            onChat?.();
          }}
        >
          <MaterialCommunityIcons name="message-text" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>SWITCH SHOP</Text>
            {stores.map((s) => {
              const active = s.id === store.id;
              return (
                <Pressable
                  key={s.id}
                  style={styles.storeRow}
                  onPress={() => {
                    feedbackTap();
                    setStoreId(s.id);
                    setOpen(false);
                  }}
                  android_ripple={{ color: "#00000010" }}
                >
                  <View style={[styles.avatar, active && { backgroundColor: colors.primary }]}>
                    <Text style={[styles.avatarText, active && { color: colors.white }]}>{s.initials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowName, active && { color: colors.primary, fontWeight: "700" }]}>
                      {s.name}
                    </Text>
                    {s.reference ? <Text style={styles.rowRef}>{s.reference}</Text> : null}
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                </Pressable>
              );
            })}
            <View style={styles.sheetDivider} />
            <Pressable style={styles.sheetAction} onPress={feedbackTap} android_ripple={{ color: "#00000010" }}>
              <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
              <Text style={styles.sheetActionText}>Create Shop</Text>
            </Pressable>
            <Pressable style={styles.sheetAction} onPress={feedbackTap} android_ripple={{ color: "#00000010" }}>
              <MaterialCommunityIcons name="store-cog-outline" size={22} color={colors.primary} />
              <Text style={styles.sheetActionText}>Edit Business</Text>
            </Pressable>
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
      <Pressable
        style={styles.scanButton}
        onPress={() => {
          feedbackTap();
          onScan?.();
        }}
      >
        <MaterialCommunityIcons name="barcode-scan" size={26} color={colors.white} />
      </Pressable>
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
  chatBtn: {
    width: 34,
    height: 30,
    borderRadius: 5,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },

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
  sheetTitle: { fontSize: 12, fontWeight: "800", color: colors.grey600, paddingHorizontal: 16, paddingVertical: 8 },
  storeRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.grey200,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 15, fontWeight: "800", color: colors.grey700 },
  rowName: { fontSize: 16, color: colors.grey800, fontWeight: "500" },
  rowRef: { fontSize: 12, color: colors.grey500, marginTop: 2 },
  sheetDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.grey300, marginVertical: 6 },
  sheetAction: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  sheetActionText: { fontSize: 15, color: colors.primary, fontWeight: "600" },
});

