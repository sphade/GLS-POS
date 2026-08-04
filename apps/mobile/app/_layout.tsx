import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { CartProvider } from "@/lib/cart";
import { colors } from "@/constants/theme";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <CartProvider>
          <StatusBar style="light" backgroundColor={colors.primaryDark} />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="charge" options={{ presentation: "modal" }} />
            <Stack.Screen name="cash-payment" options={{ presentation: "modal" }} />
            <Stack.Screen name="scanner" options={{ presentation: "modal" }} />
            <Stack.Screen name="item-editor" options={{ presentation: "modal" }} />
          </Stack>
        </CartProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
