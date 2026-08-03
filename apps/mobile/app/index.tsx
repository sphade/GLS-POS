import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Product } from "@gls-pos/types";
import { api } from "@/lib/api";

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listProducts().then((res) => {
      if (res.ok) setProducts(res.data);
      else setError(res.error.message);
      setLoading(false);
    });
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <Text style={styles.heading}>Catalog</Text>
      {loading && <ActivityIndicator style={{ marginTop: 24 }} />}
      {error && <Text style={styles.error}>Could not reach server: {error}</Text>}
      {!loading && !error && products.length === 0 && (
        <Text style={styles.empty}>No products yet. Add some via the API.</Text>
      )}
      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.price}>
              {item.currency} {(item.price / 100).toFixed(2)}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  heading: { fontSize: 22, fontWeight: "700", padding: 16, color: "#0f172a" },
  error: { color: "#dc2626", paddingHorizontal: 16 },
  empty: { color: "#64748b", paddingHorizontal: 16 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  name: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  price: { fontSize: 16, fontWeight: "700", color: "#2563eb" },
});
