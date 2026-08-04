import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";

export type ListRow = { label: string; value?: string; icon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"] };

/**
 * Shared scaffold for the secondary screens reached from the More tab and the
 * drawer: primary-blue toolbar with back arrow, optional FAB, and a card list.
 */
export function SimpleScreen({
  title,
  rows,
  emptyText,
  fabLabel,
  onFab,
}: {
  title: string;
  rows?: ListRow[];
  emptyText?: string;
  fabLabel?: string;
  onFab?: () => void;
}) {
  const router = useRouter();
  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 10, paddingBottom: 90 }}>
        {rows && rows.length > 0 ? (
          rows.map((r, i) => (
            <Pressable key={i} style={styles.row} onPress={feedbackTap} android_ripple={{ color: "#00000010" }}>
              {r.icon && <MaterialCommunityIcons name={r.icon} size={24} color={colors.primary} />}
              <Text style={styles.rowLabel}>{r.label}</Text>
              {r.value ? <Text style={styles.rowValue}>{r.value}</Text> : null}
              <Ionicons name="chevron-forward" size={20} color={colors.grey400} />
            </Pressable>
          ))
        ) : (
          <View style={styles.emptyWrap}>
            <MaterialCommunityIcons name="tray-remove" size={64} color={colors.grey400} />
            <Text style={styles.empty}>{emptyText ?? "Nothing here yet."}</Text>
          </View>
        )}
      </ScrollView>

      {fabLabel && (
        <Pressable
          style={styles.fab}
          onPress={() => {
            feedbackTap();
            onFab?.();
          }}
        >
          <Ionicons name="add" size={22} color={colors.white} />
          <Text style={styles.fabText}>{fabLabel}</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  header: {
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  headerBtn: { width: 48, alignItems: "center" },
  headerTitle: { color: colors.white, fontSize: 18, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 4,
    padding: 14,
    marginBottom: 8,
    elevation: 1,
  },
  rowLabel: { flex: 1, fontSize: 15, color: colors.grey800, fontWeight: "500" },
  rowValue: { fontSize: 15, color: colors.primary, fontWeight: "700" },
  emptyWrap: { alignItems: "center", justifyContent: "center", marginTop: 80, gap: 12 },
  empty: { color: colors.grey600, fontSize: 15, textAlign: "center" },
  fab: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 14,
    height: 50,
    borderRadius: 6,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    elevation: 4,
  },
  fabText: { color: colors.white, fontSize: 16, fontWeight: "700" },
});
