import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { CartProvider, useCartActions } from "@/lib/cart";
import { CatalogProvider, useCatalog } from "@/lib/catalog";
import { StoreProvider, useStore } from "@/lib/store";
import { WebOrdersProvider } from "@/lib/web-orders";
import { setActiveStore } from "@/lib/db";
import { NewOrderBanner } from "@/components/NewOrderBanner";
import { GlobalRefreshButton } from "@/components/GlobalRefreshButton";
import { AuthProvider, useAuth } from "@/lib/auth";
import { initAudio } from "@/lib/feedback";
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
  /**
   * Icon fonts are loaded before anything renders.
   *
   * @expo/vector-icons draws glyphs from a TTF that expo-font fetches at
   * runtime, per family, when the first icon of that family mounts. Painting the
   * UI before that finished meant the tab bar and header appeared with empty
   * gaps and the icons popped in a moment later — worst on a cold start. Both
   * families the app uses are preloaded here, so the first frame of real UI
   * already has its icons.
   */
  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
    ...MaterialCommunityIcons.font,
  });

  // Configure the audio session and warm every sound once, at launch, so the
  // first alert (a VIP order) isn't the thing that has to load the audio stack.
  useEffect(() => {
    void initAudio();
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.screenBg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

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
 * Feeds the live catalog into the cart's stock/price resolution.
 *
 * Cart lines embed an item snapshot when created, so without this a line added
 * before a stock edit (or price change) kept enforcing the old numbers forever.
 * With the catalog registered, every add() resolves against current data.
 */
function CartCatalogBridge() {
  const { products } = useCatalog();
  const { registerCatalog } = useCartActions();

  useEffect(() => {
    registerCatalog(products);
  }, [products, registerCatalog]);

  return null;
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
          <CartCatalogBridge />
          <StatusBar style="light" backgroundColor={colors.primaryDark} />
          <AuthGate>
            <RootStack />
          </AuthGate>
          {/* Floats above every screen so staff never miss an order. */}
          <NewOrderBanner />
          {/* Manual pull from any route when staff want fresh server data now. */}
          <GlobalRefreshButton />
        </WebOrdersProvider>
      </CartProvider>
    </CatalogProvider>
  );
}

/**
 * Sends the user where they belong:
 *  - signed out                     → /sign-in
 *  - signed in, confirmed no store  → /create-store
 *  - signed in with a store         → out of the auth screens and into the POS
 *
 * "Confirmed" matters. A cashier's memberships arrive a moment after their
 * session does, and routing on that gap flashed "Create your store" at staff
 * who already belong to a restaurant. So we hold on the splash spinner until
 * the store list is known, and when it can't be fetched (offline) we let them
 * into the POS on cached data rather than demanding they create a store.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, signedIn, stores, storesStatus, canManageBusiness } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const settling = signedIn && storesStatus === "pending";

  useEffect(() => {
    if (!ready || settling) return;
    const root = segments[0];
    const onSignIn = root === "sign-in";
    const onCreateStore = root === "create-store";

    if (!signedIn) {
      if (!onSignIn) router.replace("/sign-in");
      return;
    }
    // Only send someone to create a store when the server actually told us they
    // have none.
    if (stores.length === 0 && storesStatus === "ok") {
      if (!onCreateStore) router.replace("/create-store");
      return;
    }
    // Existing owners may deliberately stay on this screen to open another
    // location. Staff who deep-link here are sent back to the POS.
    if (onCreateStore && !canManageBusiness) {
      router.replace("/(tabs)");
      return;
    }
    if (onSignIn) router.replace("/(tabs)");
  }, [ready, settling, signedIn, stores.length, storesStatus, canManageBusiness, segments, router]);

  if (!ready || settling) {
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
      <Stack.Screen name="business-settings" options={MODAL} />
      <Stack.Screen name="account-settings" options={MODAL} />
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
