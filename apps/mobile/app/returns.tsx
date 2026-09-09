import { useDeferredValue, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { EmptyState } from "@/components/EmptyState";
import {
  isVoidReturn,
  loadRecentReturns,
  reasonLabel,
  RETURN_REASONS,
  useReturns,
  type SaleReturn,
} from "@/lib/returns";
import { countDocs, searchDocs, sumDocs } from "@/lib/db";
import { feedbackTap } from "@/lib/feedback";

const PAGE = 100;

/**
 * Return history is paged from local SQLite. The provider keeps only a small
 * recent window, while managers can still browse and search every offline
 * credit note without putting the whole append-only history into React.
 */
export default function ReturnsScreen() {
  const router = useRouter();
  const { returnRevision } = useReturns();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const deferredQuery = useDeferredValue(query.trim());

  const queried = useMemo(() => {
    if (!deferredQuery) return loadRecentReturns(limit + 1);

    const page = { limit: limit + 1, offset: 0 };
    const order = { field: "createdAt", direction: "desc" as const };
    const direct = searchDocs<SaleReturn>(
      "returns",
      ["number", "receiptNumber", "servedBy", "method", "reason"],
      deferredQuery,
      order,
      page,
    );
    const normalized = deferredQuery.toLowerCase();
    const labelled = RETURN_REASONS
      .filter((reason) => reason.label.toLowerCase().includes(normalized))
      .flatMap((reason) =>
        searchDocs<SaleReturn>("returns", ["reason"], reason.key, order, page),
      );
    const byId = new Map([...direct, ...labelled].map((ret) => [ret.id, ret]));
    return [...byId.values()]
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .slice(0, limit + 1);
  }, [deferredQuery, limit, returnRevision]);
  const hasMore = queried.length > limit;
  const returns = queried.slice(0, limit);

  // Keep all-history summary figures accurate with tiny SQL aggregates rather
  // than deriving them from whichever page happens to be visible.
  const totalCount = useMemo(() => countDocs("returns"), [returnRevision]);
  const refundedTotal = useMemo(
    () => sumDocs("returns", "total", [{ field: "method", value: "No refund", operator: "neq" }]),
    [returnRevision],
  );
  const currency = returns[0]?.currency ?? "NGN";

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Returns</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={19} color={colors.grey600} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={(next) => {
              setQuery(next);
              setLimit(PAGE);
            }}
            placeholder="Credit note, receipt, staff…"
            placeholderTextColor={colors.grey500}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable
              hitSlop={8}
              onPress={() => {
                setQuery("");
                setLimit(PAGE);
              }}
            >
              <Ionicons name="close-circle" size={18} color={colors.grey500} />
            </Pressable>
          )}
        </View>
      </View>

      {totalCount > 0 && (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            {totalCount} return{totalCount === 1 ? "" : "s"}
          </Text>
          <Text style={styles.summaryAmount}>{formatMoney(refundedTotal, currency)} refunded</Text>
        </View>
      )}

      {returns.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            text={
              totalCount === 0
                ? "No returns yet. Open a receipt and tap RETURN to refund an item."
                : "No returns match that search."
            }
          />
        </View>
      ) : (
        <FlatList
          data={returns}
          keyExtractor={(ret) => ret.id}
          contentContainerStyle={{ padding: 8, paddingBottom: 24 }}
          renderItem={({ item }) => (
            <ReturnRow
              ret={item}
              onPress={() => {
                feedbackTap();
                router.push(`/return-receipt/${item.id}` as Href);
              }}
            />
          )}
          ListFooterComponent={
            hasMore ? (
              <Pressable
                style={styles.more}
                onPress={() => {
                  feedbackTap();
                  setLimit((current) => current + PAGE);
                }}
              >
                <Text style={styles.moreText}>Load more</Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

function ReturnRow({ ret, onPress }: { ret: SaleReturn; onPress: () => void }) {
  const voided = isVoidReturn(ret);
  const time = new Date(ret.createdAt);
  return (
    <Pressable style={styles.row} onPress={onPress} android_ripple={{ color: "#00000010" }}>
      <View style={styles.rowIcon}>
        <MaterialCommunityIcons
          name={voided ? "cancel" : "cash-refund"}
          size={22}
          color={colors.red500}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {ret.number} · against {ret.receiptNumber}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {ret.itemCount} item{ret.itemCount === 1 ? "" : "s"} · {reasonLabel(ret.reason)} ·{" "}
          {time.toLocaleDateString()} {time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </Text>
        <Text style={styles.rowStaff} numberOfLines={1}>
          {voided ? "Voided" : ret.method} · by {ret.servedBy}
        </Text>
      </View>
      <Text style={styles.rowAmount}>
        {voided ? "—" : `-${formatMoney(ret.total, ret.currency)}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  header: { backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  headerBtn: { width: 48, alignItems: "center" },
  headerTitle: { flex: 1, color: colors.white, fontSize: 19, fontWeight: "700" },

  searchRow: { backgroundColor: colors.primary, paddingHorizontal: 10, paddingBottom: 12 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 46,
    gap: 8,
  },
  searchInput: { flex: 1, color: colors.grey800, fontSize: 16, padding: 0 },

  summaryBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.grey300,
  },
  summaryText: { fontSize: 13, color: colors.grey600, fontWeight: "600" },
  summaryAmount: { fontSize: 13, color: colors.red500, fontWeight: "800" },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 4,
    padding: 12,
    marginBottom: 8,
    elevation: 1,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FDECEA",
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: 14, fontWeight: "700", color: colors.grey900 },
  rowMeta: { fontSize: 12, color: colors.grey600, marginTop: 2 },
  rowStaff: { fontSize: 11, color: colors.grey500, marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: "800", color: colors.red500 },
  more: { alignItems: "center", paddingVertical: 16 },
  moreText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
});
