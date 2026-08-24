import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { useCatalog } from "@/lib/catalog";
import { useCart, useCartActions } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import { feedbackError, feedbackTap } from "@/lib/feedback";

/** Table picker shown when starting a new dine-in order (sale mode). */
export default function SelectTableScreen() {
  const router = useRouter();
  const { tables, sections } = useCatalog();
  const { heldOrders } = useCart();
  const { openTableTicket } = useCartActions();
  const { can } = useAuth();
  const canSell = can("sale:create");
  const allSections = ["DEFAULT ALL", ...sections.filter((s) => s !== "DEFAULT ALL")];
  const [section, setSection] = useState(allSections[0]!);

  const visible = section === "DEFAULT ALL" ? tables : tables.filter((t) => t.section === section);

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.toolbarTitle}>SELECT TABLE</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.sectionScroll}
        contentContainerStyle={styles.sectionRow}
      >
        {allSections.map((s) => (
          <Pressable
            key={s}
            style={[styles.sectionChip, section === s && styles.sectionChipActive]}
            onPress={() => {
              feedbackTap();
              setSection(s);
            }}
          >
            <Text style={[styles.sectionText, section === s && { color: colors.white }]}>{s}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.grid}>
        {visible.map((t) => {
          // A table's running ticket is the held order saved under its name.
          const ticket = heldOrders.find((h) => h.label === t.name);
          return (
            <Pressable
              key={t.id}
              style={styles.tableCard}
              onPress={() => {
                if (!canSell) {
                  feedbackError();
                  return;
                }
                feedbackTap();
                // Load this table's ticket into the active cart (or start one).
                openTableTicket(t.name);
                router.push({ pathname: "/take-order", params: { table: t.name } });
              }}
              android_ripple={{ color: "#00000010" }}
            >
              <View style={styles.tableHeader}>
                <Text style={styles.tableName}>{t.name}</Text>
              </View>
              <View style={styles.tableBody}>
                <Text
                  style={[styles.tableStatus, ticket && { color: colors.primary, fontWeight: "700" }]}
                >
                  {ticket ? `OCCUPIED · ${formatMoney(ticket.total, ticket.currency)}` : "EMPTY"}
                </Text>
                <Text style={styles.tableRef}>{t.reference ?? `${t.seats} seats`}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.grey50,
    height: 56,
    paddingHorizontal: 8,
    gap: 8,
    elevation: 2,
  },
  backBtn: { width: 40, alignItems: "center" },
  toolbarTitle: { fontSize: 18, fontWeight: "700", color: colors.primary, letterSpacing: 0.5 },

  sectionScroll: { flexGrow: 0 },
  sectionRow: { padding: 8, gap: 8, alignItems: "center" },
  sectionChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 3, backgroundColor: colors.white },
  sectionChipActive: { backgroundColor: colors.primary },
  sectionText: { fontSize: 13, fontWeight: "700", color: colors.primary },

  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8, gap: 8 },
  tableCard: {
    width: 216,
    backgroundColor: colors.white,
    borderRadius: 2,
    overflow: "hidden",
    elevation: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey300,
  },
  tableHeader: { backgroundColor: colors.grey200, paddingHorizontal: 12, paddingVertical: 14 },
  tableName: { fontSize: 16, fontWeight: "700", color: colors.grey900 },
  tableBody: { paddingHorizontal: 12, paddingVertical: 10 },
  tableStatus: { fontSize: 13, color: colors.grey600, fontWeight: "500" },
  tableRef: { fontSize: 14, color: colors.grey600, marginTop: 4 },
});
