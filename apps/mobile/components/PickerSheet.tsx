import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { fuzzyMatches } from "@/lib/search";

export type PickerOption = { id: string; label: string; hint?: string };

/**
 * Bottom-sheet chooser shared by every picker that can hold a long list.
 *
 * A search box sits above the rows: scrolling hundreds of products is not a
 * realistic way to find one, and typing a few letters (or a half-remembered
 * fragment) is. Filtering is fuzzy, so "jolof" still finds "Jollof rice".
 */
export function PickerSheet({
  visible,
  title,
  options,
  onPick,
  onClose,
  emptyText = "Nothing to choose",
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  onPick: (id: string) => void;
  onClose: () => void;
  emptyText?: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => fuzzyMatches(`${option.label} ${option.hint ?? ""}`, q));
  }, [options, query]);

  const close = () => {
    setQuery("");
    onClose();
  };

  const pick = (id: string) => {
    setQuery("");
    onPick(id);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{title.toUpperCase()}</Text>
            <Pressable onPress={close} hitSlop={8}>
              <Ionicons name="close" size={24} color={colors.primary} />
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={18} color={colors.grey500} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search…"
              placeholderTextColor={colors.grey500}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery("")} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.grey500} />
              </Pressable>
            )}
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(o) => o.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: option }) => (
              <Pressable
                style={styles.option}
                onPress={() => pick(option.id)}
                android_ripple={{ color: "#00000010" }}
              >
                <Text style={styles.optionLabel}>{option.label}</Text>
                {!!option.hint && <Text style={styles.optionHint}>{option.hint}</Text>}
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={[styles.optionHint, { paddingVertical: 18 }]}>
                {query.trim() ? `No matches for "${query.trim()}"` : emptyText}
              </Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#00000066", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    maxHeight: "70%",
    paddingBottom: 20,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  sheetTitle: { fontSize: 15, fontWeight: "800", color: colors.primary, letterSpacing: 0.5 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 10,
    height: 42,
    borderRadius: 4,
    backgroundColor: colors.grey100,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey300,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.grey900, padding: 0 },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey300,
  },
  optionLabel: { fontSize: 15, fontWeight: "600", color: colors.grey900 },
  optionHint: { fontSize: 12, color: colors.grey500, marginTop: 2, paddingHorizontal: 16 },
});
