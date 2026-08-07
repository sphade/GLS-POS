import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import { useCatalog } from "@/lib/catalog";

export default function CustomersScreen() {
  const router = useRouter();
  const { customers } = useCatalog();

  return (
    <EntityListScreen
      title="All Customers"
      data={customers}
      keyExtractor={(c) => c.id}
      searchOf={(c) => `${c.name} ${c.phone ?? ""}`}
      emptyText="No customers yet"
      addLabel="Add Customer"
      onAdd={() => router.push("/customer-editor")}
      renderRow={(c) => (
        <EntityRow
          initial={c.name.charAt(0).toUpperCase()}
          color={c.due > 0 ? colors.red500 : colors.primary}
          title={c.name}
          subtitle={c.phone ?? c.email ?? "No contact"}
          trailing={
            c.due > 0 ? (
              <View style={styles.duePill}>
                <Text style={styles.dueText}>{formatMoney(c.due, "NGN")} due</Text>
              </View>
            ) : undefined
          }
          onPress={() => router.push({ pathname: "/customer-editor", params: { id: c.id } })}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  duePill: { backgroundColor: colors.red500, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  dueText: { color: colors.white, fontSize: 10, fontWeight: "800" },
});
