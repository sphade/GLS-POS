import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { EntityListScreen, EntityRow } from "@/components/EntityListScreen";
import { api, type ProductionRule, type StoreProductOption } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { feedbackTap } from "@/lib/feedback";

/**
 * Production hub: the owner's yield rules for this branch, and the way to run
 * one. Example rule: "1 Rice makes 5 Jollof rice".
 *
 * Rules are only defaults. Tapping PRODUCE opens the run screen, where the cook
 * records what was actually used and made, so real yield calibrates the recipe.
 */
export default function ProductionScreen() {
  const router = useRouter();
  const { activeStore, can } = useAuth();
  const canProduce = can("inventory:adjust");

  const [rules, setRules] = useState<ProductionRule[]>([]);
  const [products, setProducts] = useState<StoreProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeStore) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [rulesRes, productsRes] = await Promise.all([
      api.listProductionRules(activeStore.id),
      api.listStoreProducts(activeStore.id),
    ]);
    if (!rulesRes.ok) {
      setError(rulesRes.error.message);
      setLoading(false);
      return;
    }
    setRules(rulesRes.data);
    // Without the catalog the rows lose their names; say so rather than
    // rendering blank arrows.
    setProducts(productsRes.ok ? productsRes.data : []);
    if (!productsRes.ok) setError(productsRes.error.message);
    setLoading(false);
  }, [activeStore]);

  useFocusEffect(
    useCallback(() => {
      if (canProduce) void load();
    }, [canProduce, load]),
  );

  if (!canProduce) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <View style={styles.toolbar}>
          <Pressable onPress={() => router.back()} style={styles.toolbarBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color={colors.primary} />
          </Pressable>
          <Text style={styles.toolbarTitle}>PRODUCTION</Text>
        </View>
        <View style={styles.blocked}>
          <Ionicons name="lock-closed" size={44} color={colors.grey400} />
          <Text style={styles.blockedTitle}>Managers only</Text>
          <Text style={styles.blockedText}>Ask your manager to set up production for this shop.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <ActivityIndicator style={{ marginTop: 60 }} size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <View style={styles.toolbar}>
          <Pressable onPress={() => router.back()} style={styles.toolbarBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color={colors.primary} />
          </Pressable>
          <Text style={styles.toolbarTitle}>PRODUCTION</Text>
          <Pressable onPress={() => void load()} style={styles.toolbarBtn} hitSlop={8}>
            <Ionicons name="refresh" size={22} color={colors.primary} />
          </Pressable>
        </View>
        <View style={styles.blocked}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.grey400} />
          <Text style={styles.blockedTitle}>Could not load production</Text>
          <Text style={styles.blockedText}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => void load()}>
            <Text style={styles.retryText}>TRY AGAIN</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <EntityListScreen
      title="Production"
      data={rules}
      keyExtractor={(rule) => rule.id}
      searchOf={(rule) => {
        const input = products.find((p) => p.id === rule.inputProductId);
        const output = products.find((p) => p.id === rule.outputProductId);
        return `${input?.name ?? ""} ${output?.name ?? ""}`;
      }}
      emptyText="No production rules yet"
      addLabel="New rule"
      onAdd={() => router.push("/production-rule-editor" as never)}
      renderRow={(rule) => {
        const input = products.find((p) => p.id === rule.inputProductId);
        const output = products.find((p) => p.id === rule.outputProductId);
        const inputName = input?.name ?? "Unknown product";
        const outputName = output?.name ?? "Unknown product";
        return (
          <EntityRow
            initial={outputName.charAt(0).toUpperCase()}
            color={colors.primary}
            title={`${inputName} → ${outputName}`}
            subtitle={`${rule.inputQty} ${inputName} makes ${rule.outputQty} ${outputName}${
              input?.stock === null || input?.stock === undefined ? "" : ` · ${input.stock} in stock`
            }`}
            trailing={
              <Pressable
                style={styles.produceBtn}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Produce ${outputName} from ${inputName}`}
                onPress={(event) => {
                  event.stopPropagation();
                  feedbackTap();
                  router.push({
                    pathname: "/production-run",
                    params: { ruleId: rule.id },
                  } as never);
                }}
              >
                <Ionicons name="flask-outline" size={13} color={colors.white} />
                <Text style={styles.produceText}>PRODUCE</Text>
              </Pressable>
            }
            onPress={() =>
              router.push({
                pathname: "/production-rule-editor",
                params: { id: rule.id },
              } as never)
            }
          />
        );
      }}
    />
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
  toolbarTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.primary, letterSpacing: 0.5 },
  produceBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.green,
    borderRadius: 3,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  produceText: { color: colors.white, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  blocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 8 },
  blockedTitle: { fontSize: 17, fontWeight: "800", color: colors.grey900, marginTop: 10 },
  blockedText: { fontSize: 13.5, color: colors.grey600, textAlign: "center", lineHeight: 20 },
  retry: { marginTop: 12, backgroundColor: colors.primary, borderRadius: 4, paddingHorizontal: 24, paddingVertical: 12 },
  retryText: { color: colors.white, fontWeight: "800", fontSize: 13, letterSpacing: 0.5 },
});
