import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { AuditEntry } from "@gls-pos/types";
import { ROLE_LABELS } from "@gls-pos/types";
import { colors } from "@/constants/theme";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/lib/auth";
import { loadAuditLog } from "@/lib/audit";
import { onSynced } from "@/lib/sync";
import { feedbackTap } from "@/lib/feedback";

const PAGE = 100;

/** Icon per action family, so the log scans quickly. */
function iconFor(action: string): React.ComponentProps<typeof MaterialCommunityIcons>["name"] {
  if (action.startsWith("sale") || action.startsWith("order")) return "cash-register";
  if (action.startsWith("products")) return "package-variant-closed";
  if (action.startsWith("staff")) return "account-tie-outline";
  if (action.startsWith("customers")) return "account-group-outline";
  if (action.startsWith("tables")) return "table-furniture";
  if (action.startsWith("categories") || action.startsWith("modifiers") || action.startsWith("ingredients"))
    return "shape-outline";
  return "history";
}

function timeLabel(at: number): string {
  const d = new Date(at);
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * Activity log: who did what, when. Owner/manager only (also hidden from the
 * drawer for other roles). Reads the synced, append-only `audit_log`, newest
 * first, revealing 100 rows at a time.
 */
export default function AuditScreen() {
  const router = useRouter();
  const { can } = useAuth();
  const allowed = can("audit:view");

  const [entries, setEntries] = useState<AuditEntry[]>(() => (allowed ? loadAuditLog() : []));
  const [limit, setLimit] = useState(PAGE);

  const refresh = useCallback(() => {
    if (allowed) setEntries(loadAuditLog());
  }, [allowed]);

  // Refresh when a sync lands new entries from other tills.
  useEffect(() => (allowed ? onSynced(refresh) : undefined), [allowed, refresh]);

  const visible = useMemo(() => entries.slice(0, limit), [entries, limit]);
  const hasMore = entries.length > limit;

  if (!allowed) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <Header onBack={() => router.back()} />
        <View style={styles.emptyWrap}>
          <EmptyState text="Only owners and managers can view activity" size={120} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <Header onBack={() => router.back()} count={entries.length} />
      <FlatList
        data={visible}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ paddingVertical: 8 }}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <EmptyState text="No activity recorded yet" size={120} />
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <MaterialCommunityIcons name={iconFor(item.action)} size={24} color={colors.primary} style={styles.rowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={styles.summary}>{item.summary}</Text>
              <Text style={styles.meta}>
                {item.actorName} · {ROLE_LABELS[item.actorRole] ?? item.actorRole} · {timeLabel(item.at)}
              </Text>
            </View>
          </View>
        )}
        ListFooterComponent={
          hasMore ? (
            <Pressable
              style={styles.more}
              onPress={() => {
                feedbackTap();
                setLimit((n) => n + PAGE);
              }}
            >
              <Text style={styles.moreText}>Load more</Text>
            </Pressable>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function Header({ onBack, count }: { onBack: () => void; count?: number }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerBtn} hitSlop={8}>
        <Ionicons name="arrow-back" size={24} color={colors.white} />
      </Pressable>
      <Text style={styles.headerTitle}>Activity History</Text>
      <Text style={styles.headerCount}>{count != null ? String(count) : ""}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 10,
  },
  headerBtn: { width: 32, alignItems: "center" },
  headerTitle: { flex: 1, color: colors.white, fontSize: 18, fontWeight: "700" },
  headerCount: { color: "#FFFFFFAA", fontSize: 13, fontWeight: "700" },

  emptyWrap: { alignItems: "center", justifyContent: "center", marginTop: 80 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    marginHorizontal: 10,
    marginBottom: 8,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
    elevation: 1,
  },
  rowIcon: { width: 28, textAlign: "center" },
  summary: { fontSize: 15, color: colors.grey900, fontWeight: "600" },
  meta: { fontSize: 12, color: colors.grey600, marginTop: 3 },

  more: { alignItems: "center", paddingVertical: 16 },
  moreText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
});
