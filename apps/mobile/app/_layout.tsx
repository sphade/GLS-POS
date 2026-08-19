import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { CartProvider } from "@/lib/cart";
import { CatalogProvider } from "@/lib/catalog";
import { StoreProvider, useStore } from "@/lib/store";
import { WebOrdersProvider } from "@/lib/web-orders";
import { setActiveStore } from "@/lib/db";
import { NewOrderBanner } from "@/components/NewOrderBanner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { colors } from "@/constants/theme";

const MODAL = { presentation: "modal" } as const;

/**
 * Providers wrap the *whole* navigator, not just the signed-in branch.
 *
 * expo-router renders whichever route the URL points at regardless of which
 * <Stack.Screen> children are declared, so conditionally rendering a smaller
 * tree would let (tabs) mount without CartProvider/CatalogProvider and crash.
 * Access control is therefore a redirect (see AuthGate), not a different tree.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StoreProvider>
            <StoreScopedData />
          </StoreProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Binds the data layer to the selected store.
 *
 * Each store (branch) has its own local SQLite file, so the active database
 * must be selected BEFORE the data providers read from it — hence the
 * synchronous `setActiveStore` in the render body rather than an effect.
 *
 * `key={store.id}` remounts the providers when the user switches branch, which
 * discards the previous branch's in-memory state and re-reads from that
 * branch's database. Without it, Poka's catalog would linger in Ikeja's till.
 */
function StoreScopedData() {
  const { store } = useStore();
  setActiveStore(store.id);

  return (
    <CatalogProvider key={`catalog-${store.id}`}>
      <CartProvider key={`cart-${store.id}`}>
        <WebOrdersProvider key={`orders-${store.id}`}>
          <StatusBar style="light" backgroundColor={colors.primaryDark} />
          <AuthGate>
            <RootStack />
          </AuthGate>
          {/* Floats above every screen so staff never miss an order. */}
          <NewOrderBanner />
        </WebOrdersProvider>
      </CartProvider>
    </CatalogProvider>
  );
}

/**
 * Sends the user where they belong:
 *  - signed out            → /sign-in
 *  - signed in, no store   → /create-store
 *  - signed in with a store→ out of the auth screens and into the POS
 *
 * Renders a spinner until the session has been resolved so we never redirect
 * on a half-known state.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, signedIn, stores } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const root = segments[0];
    const onSignIn = root === "sign-in";
    const onCreateStore = root === "create-store";

    if (!signedIn) {
      if (!onSignIn) router.replace("/sign-in");
      return;
    }
    if (stores.length === 0) {
      if (!onCreateStore) router.replace("/create-store");
      return;
    }
    if (onSignIn || onCreateStore) router.replace("/(tabs)");
  }, [ready, signedIn, stores.length, segments, router]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.screenBg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <>{children}</>;
}

/** Every route in the app. Declared once so navigation always has a host. */
function RootStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />

      {/* Auth */}
      <Stack.Screen name="sign-in" options={{ gestureEnabled: false }} />
      <Stack.Screen name="create-store" options={{ gestureEnabled: false }} />

      {/* Sale flow */}
      <Stack.Screen name="select-table" options={MODAL} />
      <Stack.Screen name="take-order" options={MODAL} />
      <Stack.Screen name="charge" options={MODAL} />
      <Stack.Screen name="cash-payment" options={MODAL} />
      <Stack.Screen name="receipt/[id]" options={MODAL} />
      <Stack.Screen name="scanner" options={MODAL} />

      {/* Catalog management */}
      <Stack.Screen name="inventory" options={MODAL} />
      <Stack.Screen name="item-editor" options={MODAL} />
      <Stack.Screen name="category-editor" options={MODAL} />
      <Stack.Screen name="modifier-editor" options={MODAL} />
      <Stack.Screen name="ingredient-editor" options={MODAL} />

      {/* Business */}
      <Stack.Screen name="tables" options={MODAL} />
      <Stack.Screen name="table-editor" options={MODAL} />
      <Stack.Screen name="customers" options={MODAL} />
      <Stack.Screen name="customer-editor" options={MODAL} />
      <Stack.Screen name="staff" options={MODAL} />
      <Stack.Screen name="staff-editor" options={MODAL} />
      <Stack.Screen name="expense-categories" options={MODAL} />
      <Stack.Screen name="add-entry" options={MODAL} />
      <Stack.Screen
        name="sale-success"
        options={{ presentation: "fullScreenModal", gestureEnabled: false }}
      />
      <Stack.Screen name="settings" options={MODAL} />
      <Stack.Screen name="printer-setup" options={MODAL} />
      <Stack.Screen name="online-orders" options={MODAL} />
      <Stack.Screen name="table-qr" options={MODAL} />
      <Stack.Screen name="report/[type]" options={MODAL} />
    </Stack>
  );
}
