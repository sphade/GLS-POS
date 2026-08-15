import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import { useCatalog } from "@/lib/catalog";
import { useSession } from "@/lib/auth-client";

export default function StaffScreen() {
  const router = useRouter();
  const { staff } = useCatalog();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  return (
    <EntityListScreen
      title="Staff and Partners"
      data={staff}
      keyExtractor={(s) => s.id}
      searchOf={(s) => s.name}
      emptyText="No staff yet"
      addLabel="Add Staff"
      onAdd={() => router.push("/staff-editor")}
      renderRow={(s) => (
        <EntityRow
          initial={s.name?.charAt(0).toUpperCase() ?? "?"}
          color={colors.primary}
          title={s.name ?? "Unknown"}
          subtitle={
            currentUserId === s.id ? "You (Me)" : (s.email ?? "No email")
          }
          trailing={
            currentUserId === s.id ? (
              <View style={styles.meBadge}>
                <Text style={styles.meBadgeText}>ME</Text>
              </View>
            ) : (
              <View style={styles.rolePill}>
                <Text style={styles.roleText}>
                  {(s.role ?? "").toUpperCase()}
                </Text>
              </View>
            )
          }
          onPress={() =>
            router.push({ pathname: "/staff-editor", params: { id: s.id } })
          }
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  rolePill: {
    backgroundColor: colors.dkGreen,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  roleText: { color: colors.white, fontSize: 10, fontWeight: "800" },
  meBadge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  meBadgeText: { color: colors.white, fontSize: 10, fontWeight: "800" },
});
