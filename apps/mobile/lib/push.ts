import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { API_URL, authCookie } from "./auth-client";

/**
 * Expo push notifications, so staff are alerted to a VIP order even when the
 * app is closed or the phone is locked.
 *
 * The in-app chime (lib/feedback) and the realtime WebSocket cover the app-open
 * case; this is the fallback for a phone in someone's pocket.
 *
 * Requires an EAS project id (app.json → expo.extra.eas.projectId). Without it
 * Expo can't issue a token, so registration is skipped and the app carries on
 * with the other two alert paths.
 */

/** Show an alert even when the app is foregrounded. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
}

/** Android needs an explicit high-importance channel to make sound on the lock screen. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("vip-orders", {
    name: "VIP orders",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 200, 250],
    lightColor: "#5AA02C",
    sound: "default",
  });
}

/**
 * Ask permission, get the Expo token, and register it against the active store.
 * Returns the token, or null when unavailable (simulator, denied, no project id).
 */
export async function registerForPush(storeId: string): Promise<string | null> {
  try {
    // Push tokens are not issued to simulators/emulators.
    if (!Device.isDevice) return null;

    const id = projectId();
    if (!id) {
      console.warn("[push] no EAS projectId — skipping push registration");
      return null;
    }

    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    if (!token) return null;

    const cookie = authCookie();
    if (!cookie) return null; // not signed in yet; caller retries later

    const res = await fetch(`${API_URL}/api/push/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "x-store-id": storeId },
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    if (!res.ok) return null;
    return token;
  } catch (e) {
    console.warn("[push] registration failed:", (e as Error).message);
    return null;
  }
}

/** Stop alerts for this device (called on sign-out). */
export async function unregisterPush(): Promise<void> {
  try {
    const id = projectId();
    if (!id || !Device.isDevice) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    const cookie = authCookie();
    if (!token || !cookie) return;
    await fetch(`${API_URL}/api/push/unregister`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ token }),
    });
  } catch {
    /* best effort */
  }
}

/** Ask the server to send this store's devices a test alert. */
export async function sendTestPush(storeId: string): Promise<number> {
  const cookie = authCookie();
  if (!cookie) return 0;
  const res = await fetch(`${API_URL}/api/push/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "x-store-id": storeId },
  });
  const body = (await res.json()) as { ok: boolean; data?: { sent: number } };
  return body.ok ? (body.data?.sent ?? 0) : 0;
}
