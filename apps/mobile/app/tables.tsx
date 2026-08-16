import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import { useCatalog } from "@/lib/catalog";
import { feedbackTap } from "@/lib/feedback";

/**
 * Table Management — manage-mode counterpart of the Select Table picker.
 * Each row also opens that table's VIP QR code, since guests scan a code that
 * is specific to their table.
 */
export default function TablesScreen() {
  const router = useRouter();
  const { tables } = useCatalog();

  return (
    <EntityListScreen
      title="Table Management"
      data={tables}
      keyExtractor={(t) => t.id}
      searchOf={(t) => `${t.name} ${t.section}`}
      emptyText="No tables yet"
      addLabel="Add Table"
      onAdd={() => router.push("/table-editor")}
      renderRow={(t) => (
        <EntityRow
          initial={String(t.seats)}
          color={colors.primary}
          title={t.name}
          subtitle={`${t.section} · ${t.seats} seats${t.reference ? ` · #${t.reference}` : ""}`}
          trailing={
            <Pressable
              style={styles.qrBtn}
              hitSlop={8}
              onPress={() => {
                feedbackTap();
                router.push({ pathname: "/table-qr", params: { id: t.id } });
              }}
            >
              <MaterialCommunityIcons name="qrcode" size={18} color={colors.white} />
              <Text style={styles.qrText}>QR</Text>
            </Pressable>
          }
          onPress={() => router.push({ pathname: "/table-editor", params: { id: t.id } })}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  qrBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  qrText: { color: colors.white, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
});
