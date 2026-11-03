import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";

/**
 * Sends staff to the screen a push notification is about.
 *
 * The server puts a `kind` (and often a `storeId`) in every payload. Without
 * this component a tapped notification just opened the app wherever it was
 * left; a "low stock" alert for the centre would land on a branch's till.
 *
 * Two entry points matter:
 *  - the listener, for taps while the app is already running;
 *  - `getLastNotificationResponseAsync`, for a tap that cold-started the app.
 *
 * Both funnel through the same handler, and identifiers are remembered so the
 * cold-start read and the live listener cannot navigate twice for one tap.
 */

/** Survives the store-keyed provider remount, so a switch can't replay a tap. */
const handled = new Set<string>();
const MAX_REMEMBERED = 50;

function routeFor(data: Record<string, unknown>): string | null {
  const kind = typeof data.kind === "string" ? data.kind : "";
  switch (kind) {
    case "web_order":
      return "/online-orders";
    case "transfer_in":
      return "/transfers";
    case "stock_arrived":
    case "conversion_done":
      return "/inventory";
    case "central_low_stock": {
      const itemId = typeof data.itemId === "string" ? data.itemId : null;
      return itemId ? `/ingredient-editor?id=${encodeURIComponent(itemId)}` : "/(tabs)";
    }
    default:
      return null;
  }
}

export function NotificationRouter() {
  const router = useRouter();
  const { user } = useAuth();
  const { store, stores, setStoreId } = useStore();

  useEffect(() => {
    // Nothing to route to until someone is signed in; the cold-start response
    // is left uncleared so this effect can pick it up once auth settles.
    if (!user) return;

    let cancelled = false;

    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response || cancelled) return;

      const id = response.notification.request.identifier;
      if (handled.has(id)) return;
      if (handled.size >= MAX_REMEMBERED) handled.clear();
      handled.add(id);

      const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
      const target = routeFor(data);
      // Clear it either way: an unknown payload has still been consumed, and
      // leaving it would re-open the app's last screen on every cold start.
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      if (!target) return;

      const targetStoreId = typeof data.storeId === "string" ? data.storeId : null;
      const canSwitch =
        !!targetStoreId &&
        targetStoreId !== store.id &&
        stores.some((candidate) => candidate.id === targetStoreId);

      if (!canSwitch) {
        router.push(target as never);
        return;
      }

      // Switching store re-keys the data providers, which remounts the
      // navigator. Push on the next tick so the destination lands on the new
      // store's tree instead of being wiped by that remount.
      setStoreId(targetStoreId);
      setTimeout(() => router.push(target as never), 150);
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [router, setStoreId, store.id, stores, user]);

  return null;
}
