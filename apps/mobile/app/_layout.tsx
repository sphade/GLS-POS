import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { CartProvider } from "@/lib/cart";
import { CatalogProvider } from "@/lib/catalog";
import { StoreProvider } from "@/lib/store";
import { AuthProvider, useAuth } from "@/lib/auth";
import { colors } from "@/constants/theme";

const MODAL = { presentation: "modal" } as const;

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" backgroundColor={colors.primaryDark} />
          <Gate />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Decides what the user sees before the POS mounts:
 *  - not signed in  → sign-in screen
 *  - no store yet   → first-store setup
 *  - otherwise      → the app, with catalog/cart providers
 *
 * Keeping the providers below the gate means the POS only ever mounts with a
 * known user + store, so screens can rely on both.
 */
function Gate() {
  const { ready, signedIn, stores } = useAuth();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.screenBg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!signedIn) {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="sign-in" />
      </Stack>
    );
  }

  if (stores.length === 0) {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="create-store" />
      </Stack>
    );
  }

  return (
    <StoreProvider>
      <CatalogProvider>
        <CartProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />

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
            <Stack.Screen name="report/[type]" options={MODAL} />
          </Stack>
        </CartProvider>
      </CatalogProvider>
    </StoreProvider>
  );
}
