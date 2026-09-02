import { useState, type ReactNode } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EmptyState } from "@/components/EmptyState";
import { feedbackTap } from "@/lib/feedback";

/**
 * Manage-mode list scaffold: toolbar with back + search, rows, and an "add" FAB.
 * Used by every Inventory / Customers / Staff / Tables list so they stay
 * visually identical.
 */
export function EntityListScreen<T>({
  title,
  data,
  keyExtractor,
  searchOf,
  renderRow,
  emptyText,
  addLabel,
  onAdd,
  embedded = false,
}: {
  title: string;
  data: T[];
  keyExtractor: (item: T) => string;
  /** Text used for the search filter. */
  searchOf: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  emptyText: string;
  addLabel?: string;
  onAdd?: () => void;
  /** When true, renders without its own toolbar/SafeArea (inside a tab pager). */
  embedded?: boolean;
}) {
  const router = useRouter();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = q ? data.filter((d) => searchOf(d).toLowerCase().includes(q)) : data;

  const body = (
    <>
      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 8, paddingBottom: 96 }}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <EmptyState text={q ? `No results for "${query}"` : emptyText} size={120} />
          </View>
        }
        renderItem={({ item }) => <>{renderRow(item)}</>}
      />

      {addLabel && (
        <Pressable
          style={styles.fab}
          onPress={() => {
            feedbackTap();
            onAdd?.();
          }}
        >
          <Ionicons name="add" size={22} color={colors.white} />
          <Text style={styles.fabText}>{addLabel}</Text>
        </Pressable>
      )}
    </>
  );

  /**
   * Embedded lists (the Inventory tabs) have no toolbar of their own, so the
   * search box lives above the rows instead of behind a toggle. Each tab keeps
   * its own query — swiping from Items to Categories shouldn't carry a stale
   * filter across.
   */
  if (embedded) {
    return (
      <View style={{ flex: 1 }}>
        <View style={styles.embeddedSearchRow}>
          <View style={styles.embeddedSearchBox}>
            <Ionicons name="search" size={18} color={colors.grey600} />
            <TextInput
              style={styles.embeddedSearchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={`Search ${title.toLowerCase()}`}
              placeholderTextColor={colors.grey500}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 && (
              <Pressable
                hitSlop={8}
                onPress={() => {
                  feedbackTap();
                  setQuery("");
                }}
              >
                <Ionicons name="close-circle" size={18} color={colors.grey500} />
              </Pressable>
            )}
          </View>
          {q.length > 0 && (
            <Text style={styles.resultCount}>
              {filtered.length} of {data.length}
            </Text>
          )}
        </View>
        {body}
      </View>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} style={styles.toolbarBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </Pressable>
        {searching ? (
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${title.toLowerCase()}`}
            placeholderTextColor={colors.grey500}
            autoFocus
          />
        ) : (
          <Text style={styles.toolbarTitle} numberOfLines={1}>
            {title.toUpperCase()}
          </Text>
        )}
        <Pressable
          onPress={() => {
            feedbackTap();
            setSearching((v) => !v);
            setQuery("");
          }}
          style={styles.toolbarBtn}
          hitSlop={8}
        >
          <Ionicons name={searching ? "close" : "search"} size={22} color={colors.primary} />
        </Pressable>
      </View>
      {body}
    </SafeAreaView>
  );
}

/** Standard row card: leading circle/swatch, title + subtitle, trailing content. */
export function EntityRow({
  initial,
  color,
  title,
  subtitle,
  trailing,
  onPress,
}: {
  initial?: string;
  color?: string;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress} android_ripple={{ color: "#00000010" }}>
      {initial !== undefined && (
        <View style={[styles.circle, { backgroundColor: color ?? colors.primary }]}>
          <Text style={styles.circleText}>{initial}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      <Ionicons name="chevron-forward" size={20} color={colors.grey400} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.grey50,
    height: 56,
    paddingHorizontal: 4,
    elevation: 2,
  },
  toolbarBtn: { width: 44, alignItems: "center" },
  toolbarTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.primary, letterSpacing: 0.5 },
  searchInput: { flex: 1, fontSize: 16, color: colors.grey900, paddingHorizontal: 8 },

  embeddedSearchRow: { paddingHorizontal: 8, paddingTop: 8 },
  embeddedSearchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 44,
    elevation: 1,
  },
  embeddedSearchInput: { flex: 1, fontSize: 15, color: colors.grey900, padding: 0 },
  resultCount: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.grey600,
    marginTop: 6,
    marginLeft: 4,
    letterSpacing: 0.3,
  },

  emptyWrap: { marginTop: 60, alignItems: "center" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
    elevation: 1,
  },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  circleText: { color: colors.white, fontSize: 18, fontWeight: "700" },
  rowTitle: { fontSize: 16, color: colors.grey900, fontWeight: "600" },
  rowSubtitle: { fontSize: 13, color: colors.grey600, marginTop: 3 },

  fab: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 14,
    height: 50,
    borderRadius: 4,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    elevation: 5,
  },
  fabText: { color: colors.white, fontSize: 16, fontWeight: "700" },
});
