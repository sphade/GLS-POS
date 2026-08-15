import Constants from "expo-constants";
import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { expoClient } from "@better-auth/expo/client";
import { adminClient } from "better-auth/client/plugins";
import * as SecureStore from "expo-secure-store";
/**
 * better-auth client for the mobile app. The Expo plugin persists the session
 * cookie in the device secure store and handles the deep-link callback
 * (scheme "glspos", matching app.json + the server's trustedOrigins).
 *
 * Defaults to the deployed Worker so a physical device works with no setup.
 * Override with EXPO_PUBLIC_API_URL to target local `wrangler dev` (use your
 * machine's LAN IP on a real device — localhost only resolves on web/simulator).
 *
 * Requires `config.resolver.unstable_enablePackageExports = true` in
 * metro.config.js so Metro can resolve better-auth's subpath exports.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://gls-pos-server.nwabuisichike70.workers.dev";

// The Expo plugin's inferred type doesn't line up with BetterAuthClientPlugin
// across the current better-auth versions (a known deep-generic mismatch in the
// fetch types). The runtime shape is correct, so we assert it here.
const expoPlugin = expoClient({
  scheme: "glspos",
  storagePrefix: "glspos",
  storage: SecureStore,
}) as BetterAuthClientPlugin;

export const authClient = createAuthClient({
  scheme: "glspos",
  storagePrefix: "glspos",
  storage: SecureStore,
  baseURL: API_URL,
  plugins: [expoPlugin, adminClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;

/**
 * The stored session cookie, for attaching to hand-rolled fetches (the sync
 * endpoint). Returns "" when signed out, which makes the sync engine no-op
 * gracefully so the app keeps working offline.
 *
 * `getCookie` is contributed by the Expo plugin at runtime; typed here since
 * plugin action inference is bypassed above.
 */
export function authCookie(): string {
  const client = authClient as unknown as {
    getCookie?: () => string | undefined;
  };
  return client.getCookie?.() ?? "";
}
