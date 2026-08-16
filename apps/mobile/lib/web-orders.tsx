import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Notifications from "expo-notifications";
import type { WebOrder, WebOrderStatus } from "@gls-pos/types";
import { loadAll, put as dbPut } from "./db";
import { onSynced } from "./sync";
import { feedbackNewOrder } from "./feedback";

/**
 * VIP web orders that arrived from the guest ordering site.
 *
 * They're created server-side in the store's Durable Object and arrive here via
 * the normal sync, so this provider just reads the local `web_orders`
 * collection and lets staff advance them. Writing back marks the row dirty, so
 * the status change syncs to every other device.
 */

type WebOrdersState = {
  orders: WebOrder[];
  /** Orders still needing attention, newest first. */
  active: WebOrder[];
  /** Count for the tab badge. */
  pendingCount: number;
  setStatus: (id: string, status: WebOrderStatus) => void;
  /** Link a web order to the receipt raised for it. */
  attachReceipt: (id: string, receiptId: string) => void;
  reload: () => void;
  /** Newly-arrived order awaiting acknowledgement, for the alert banner. */
  arrival: WebOrder | null;
  dismissArrival: () => void;
};

const OPEN: WebOrderStatus[] = ["received", "preparing", "ready"];

const WebOrdersContext = createContext<WebOrdersState | null>(null);

export function WebOrdersProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<WebOrder[]>(() => loadAll<WebOrder>("web_orders"));
  const [arrival, setArrival] = useState<WebOrder | null>(null);
  /** Ids seen at least once, so we only alert for genuinely new orders. */
  const seen = useRef<Set<string>>(new Set(loadAll<WebOrder>("web_orders").map((o) => o.id)));

  /**
   * Re-read after every sync and alert on anything new.
   *
   * Runs off the sync callback rather than a timer so it fires the moment new
   * data lands — including when the WebSocket triggers an immediate sync.
   */
  const refresh = useCallback(() => {
    const fresh = loadAll<WebOrder>("web_orders");
    setOrders(fresh);

    const unseen = fresh.filter((o) => !seen.current.has(o.id) && o.status === "received");
    fresh.forEach((o) => seen.current.add(o.id));
    if (unseen.length > 0) {
      const newest = unseen.sort((a, b) => b.createdAt - a.createdAt)[0]!;
      feedbackNewOrder();
      setArrival(newest);
    }
  }, []);

  useEffect(() => onSynced(refresh), [refresh]);

  /**
   * A push notification arriving while the app is backgrounded doesn't run our
   * sync, so pull immediately when one lands or is tapped.
   */
  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => refresh());
    const tapped = Notifications.addNotificationResponseReceivedListener(() => refresh());
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [refresh]);

  const value = useMemo<WebOrdersState>(() => {
    const byNewest = [...orders].sort((a, b) => b.createdAt - a.createdAt);

    const write = (id: string, patch: Partial<WebOrder>) => {
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id !== id) return o;
          const next = { ...o, ...patch, updatedAt: Date.now() };
          dbPut("web_orders", next); // dirty -> syncs to other devices
          return next;
        }),
      );
    };

    return {
      orders: byNewest,
      active: byNewest.filter((o) => OPEN.includes(o.status)),
      pendingCount: byNewest.filter((o) => o.status === "received").length,
      setStatus: (id, status) => write(id, { status }),
      attachReceipt: (id, receiptId) => write(id, { receiptId, status: "served" }),
      reload: refresh,
      arrival,
      dismissArrival: () => setArrival(null),
    };
  }, [orders, arrival, refresh]);

  return <WebOrdersContext.Provider value={value}>{children}</WebOrdersContext.Provider>;
}

export function useWebOrders(): WebOrdersState {
  const ctx = useContext(WebOrdersContext);
  if (!ctx) throw new Error("useWebOrders must be used within a WebOrdersProvider");
  return ctx;
}
