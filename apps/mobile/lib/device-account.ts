import * as SecureStore from "expo-secure-store";
import { authClient } from "./auth-client";

/**
 * Zero-friction sign-in for the current phase.
 *
 * The POS still authenticates properly against the server — sync, membership and
 * role checks are all unchanged — but instead of asking the user to log in, the
 * app provisions a credential for THIS DEVICE on first launch and reuses it
 * afterwards. That keeps the login screen out of the way while we build, without
 * opening a hole in the API.
 *
 * Why a generated per-device credential rather than one shared demo login:
 * a shared password baked into the app would let anyone with the APK read the
 * store's data. Each install gets its own random credential in the device
 * keychain instead.
 *
 * Set EXPO_PUBLIC_AUTO_AUTH=0 to restore the normal sign-in flow.
 */

export const AUTO_AUTH = process.env.EXPO_PUBLIC_AUTO_AUTH !== "0";

/** Store name used when auto-provisioning the first store. */
const DEFAULT_STORE_NAME = "GLS Kitchen & Bakery";

const EMAIL_KEY = "gls_device_email";
const PASSWORD_KEY = "gls_device_password";

function randomToken(bytes = 18): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

type Credentials = { email: string; password: string };

/** Read this device's credentials, creating them on first launch. */
async function credentials(): Promise<Credentials> {
  const [email, password] = await Promise.all([
    SecureStore.getItemAsync(EMAIL_KEY),
    SecureStore.getItemAsync(PASSWORD_KEY),
  ]);
  if (email && password) return { email, password };

  const fresh: Credentials = {
    // .local keeps these clearly non-deliverable addresses.
    email: `till-${randomToken(6)}@gls.local`,
    password: randomToken(24),
  };
  await Promise.all([
    SecureStore.setItemAsync(EMAIL_KEY, fresh.email),
    SecureStore.setItemAsync(PASSWORD_KEY, fresh.password),
  ]);
  return fresh;
}

/**
 * Ensure there's a valid session, provisioning the device account if needed.
 * Returns true when signed in. Safe to call repeatedly and offline (it simply
 * fails quietly and the POS carries on with local data).
 */
export async function ensureDeviceSession(): Promise<boolean> {
  try {
    const { email, password } = await credentials();

    // Existing account for this device?
    const signIn = await authClient.signIn.email({ email, password });
    if (!signIn.error) return true;

    // First launch on this device — create it.
    const signUp = await authClient.signUp.email({
      email,
      password,
      name: "GLS Till",
    });
    if (!signUp.error) return true;

    console.warn("[auto-auth] could not provision device account:", signUp.error.message);
    return false;
  } catch (e) {
    // Offline or server unreachable: not fatal, the app is offline-first.
    console.warn("[auto-auth] skipped:", (e as Error).message);
    return false;
  }
}

export { DEFAULT_STORE_NAME };
