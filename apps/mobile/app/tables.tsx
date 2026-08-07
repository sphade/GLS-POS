import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import { useCatalog } from "@/lib/catalog";

/** Table Management — manage-mode counterpart of the Select Table picker. */
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
          onPress={() => router.push({ pathname: "/table-editor", params: { id: t.id } })}
        />
      )}
    />
  );
}
