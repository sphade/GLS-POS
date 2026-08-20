import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, formStyles } from "@/components/form";
import { useCatalog } from "@/lib/catalog";
import { feedbackTap } from "@/lib/feedback";
import { useStore } from "@/lib/store";
import { syncNowDetailed } from "@/lib/sync";

const SEATS = [2, 4, 6, 8, 10];

export default function TableEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { tables, sections, upsertTable, deleteTable } = useCatalog();
  const { store } = useStore();
  const existing = tables.find((t) => t.id === id);

  const [name, setName] = useState(existing?.name ?? "");
  const [section, setSection] = useState(existing?.section ?? sections[0] ?? "DEFAULT ALL");
  const [seats, setSeats] = useState(existing?.seats ?? 4);
  const [reference, setReference] = useState(existing?.reference ?? "");
  const [touched, setTouched] = useState(false);

  const dirty = name.trim().length > 0 && (touched || name !== existing?.name);

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title={existing ? "Edit Table" : "Add Table"}
        dirty={dirty}
        onClose={() => router.back()}
        onSave={() => {
          upsertTable({ id: existing?.id, name: name.trim(), section, seats, reference: reference.trim() || undefined });
          // The public QR page reads from the store Durable Object, not this
          // phone's local SQLite. Push now instead of waiting for the 20s poll.
          void syncNowDetailed(store.id, ["tables"]);
          feedbackTap();
          router.back();
        }}
        onDelete={
          existing
            ? () => {
                deleteTable(existing.id);
                void syncNowDetailed(store.id, ["tables"]);
                feedbackTap();
                router.back();
              }
            : undefined
        }
      />

      <ScrollView contentContainerStyle={formStyles.body}>
        <FieldCard
          label="Table Name *"
          hint="Ex: TABLE - GLS 2"
          value={name}
          onChangeText={(t) => {
            setName(t);
            setTouched(true);
          }}
          valid={name.trim().length > 0}
        />

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>SECTION</Text>
          <View style={styles.chipRow}>
            {[...new Set([...sections, "DEFAULT ALL", "VIP", "OUTDOOR"])].map((s) => (
              <Pressable
                key={s}
                style={[styles.chip, section === s && styles.chipActive]}
                onPress={() => {
                  feedbackTap();
                  setSection(s);
                  setTouched(true);
                }}
              >
                <Text style={[styles.chipText, section === s && { color: colors.white }]}>{s}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { marginTop: 16 }]}>SEATS</Text>
          <View style={styles.chipRow}>
            {SEATS.map((n) => (
              <Pressable
                key={n}
                style={[styles.chip, seats === n && styles.chipActive]}
                onPress={() => {
                  feedbackTap();
                  setSeats(n);
                  setTouched(true);
                }}
              >
                <Text style={[styles.chipText, seats === n && { color: colors.white }]}>{n}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <FieldCard
          label="Reference / Number"
          hint="234"
          value={reference}
          onChangeText={(t) => {
            setReference(t);
            setTouched(true);
          }}
          keyboardType="numeric"
          showTick={false}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 4, padding: 12, marginBottom: 8, elevation: 1 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.grey600, letterSpacing: 0.6, marginBottom: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.grey400 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.grey700 },
});
