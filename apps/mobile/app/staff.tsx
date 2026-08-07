import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import { useCatalog } from "@/lib/catalog";

export default function StaffScreen() {
  const router = useRouter();
  const { staff } = useCatalog();

  return (
    <EntityListScreen
      title="Staff and Partners"
      data={staff}
      keyExtractor={(s) => s.id}
      searchOf={(s) => `${s.name} ${s.role}`}
      emptyText="No staff yet"
      addLabel="Add Staff"
      onAdd={() => router.push("/staff-editor")}
      renderRow={(s) => (
        <EntityRow
          initial={s.name.charAt(0).toUpperCase()}
          color={s.active ? colors.primary : colors.grey400}
          title={s.name}
          subtitle={s.phone ?? "No contact"}
          trailing={
            <View style={[styles.rolePill, !s.active && { backgroundColor: colors.grey400 }]}>
              <Text style={styles.roleText}>{s.active ? s.role.toUpperCase() : "INACTIVE"}</Text>
            </View>
          }
          onPress={() => router.push({ pathname: "/staff-editor", params: { id: s.id } })}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  rolePill: { backgroundColor: colors.dkGreen, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  roleText: { color: colors.white, fontSize: 10, fontWeight: "800" },
});
