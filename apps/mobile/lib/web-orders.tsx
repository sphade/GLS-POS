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
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import type { WebOrder, WebOrderStatus } from "@gls-pos/types";
import {
  loadDocsByField,
  loadDocsInRange,
  loadOne,
  loadRecentDocs,
  mergeById,
  put as dbPut,
} from "./db";
import { onSynced, pullNow, SYNC_ENABLED } from "./sync";
import { useStore } from "./store";

/**
 * VIP web orders that arrived from the guest ordering site.
 *
 * Every row remains in local SQLite and syncs normally. React retains every
 * open order (operational work must never disappear) plus a small recent
 * completed window; older completed orders are queried from SQLite on demand.
 */

const OPEN: readonly WebOrderStatus[] = ["received", "preparing", "ready"];
export const WEB_ORDER_LIVE_HISTORY_LIMIT = 100;

const isOpen = (order: WebOrder): boolean => OPEN.includes(order.status);
const newestFirst = (a: WebOrder, b: WebOrder) =>
  b.createdAt - a.createdAt || b.id.localeCompare(a.id);

/** Completed and open orders in a half-open historical range. */
export function loadWebOrdersInRange(from: number, to: number): WebOrder[] {
  return loadDocsInRange<WebOrder>("web_orders", "createdAt", from, to);
}

/** One bounded newest-first web-order page from the complete local history. */
export function loadRecentWebOrders(
  limit = WEB_ORDER_LIVE_HISTORY_LIMIT,
  offset = 0,
): WebOrder[] {
  return loadRecentDocs<WebOrder>("web_orders", "createdAt", limit, offset);
}

function loadOpenWebOrders(): WebOrder[] {
  const byId = new Map<string, WebOrder>();
  for (const status of OPEN) {
    for (const order of loadDocsByField<WebOrder>("web_orders", "status", status, {
      field: "createdAt",
      direction: "desc",
    })) {
      byId.set(order.id, order);
    }
  }
  return [...byId.values()].sort(newestFirst);
}

/** Keep every open order, but only the newest completed history in React. */
function boundLiveOrders(rows: readonly WebOrder[]): WebOrder[] {
  const byId = new Map(rows.map((order) => [order.id, order]));
  const unique = [...byId.values()];
  const open = unique.filter(isOpen);
  const completed = unique
    .filter((order) => !isOpen(order))
    .sort(newestFirst)
    .slice(0, WEB_ORDER_LIVE_HISTORY_LIMIT);
  return [...open, ...completed].sort(newestFirst);
}

function loadLiveOrders(): WebOrder[] {
  return boundLiveOrders([...loadOpenWebOrders(), ...loadRecentWebOrders()]);
}

type WebOrdersState = {
  /** Every open order plus a bounded recent completed window. */
  orders: WebOrder[];
  /** Orders still needing attention, newest first. */
  active: WebOrder[];
  /** Count for the tab badge. */
  pendingCount: number;
  /** Advances for local writes and pulled rows, including rows outside the window. */
  webOrderRevision: number;
  setStatus: (id: string, status: WebOrderStatus) => void;
  /** Link a web order to the receipt raised for it. */
  attachReceipt: (id: string, receiptId: string) => void;
  /** Pull server orders now; collection-scoped sync notification reloads rows. */
  reload: () => void;
  /** Oldest unacknowledged arrival is shown first; later orders queue behind it. */
  arrival: WebOrder | null;
  /** Dismiss only the currently-visible arrival, then surface the next one. */
  dismissArrival: () => void;
};

const WebOrdersContext = createContext<WebOrdersState | null>(null);

export function WebOrdersProvider({ children }: { children: ReactNode }) {
  const { store } = useStore();
  const [orders, setOrders] = useState<WebOrder[]>(loadLiveOrders);
  const [arrivals, setArrivals] = useState<WebOrder[]>([]);
  const [webOrderRevision, setWebOrderRevision] = useState(0);
  /** Ids seen at least once, so we only alert for genuinely new active orders. */
  const seen = useRef<Set<string>>(new Set(orders.map((order) => order.id)));

  /** Merge only rows named by sync; never re-read the whole append-only table. */
  const refresh = useCallback((ids: readonly string[], announceArrivals = true) => {
    if (ids.length === 0) return;
    const uniqueIds = [...new Set(ids)];
    const incoming = uniqueIds
      .map((id) => loadOne<WebOrder>("web_orders", id))
      .filter((order): order is WebOrder => order !== null);
    const unseen = announceArrivals
      ? incoming
          .filter((order) => !seen.current.has(order.id) && order.status === "received")
          .sort((a, b) => a.createdAt - b.createdAt)
      : [];
    incoming.forEach((order) => seen.current.add(order.id));

    setOrders((current) =>
      boundLiveOrders(mergeById(current, "web_orders", uniqueIds, (row) => row.createdAt)),
    );
    setWebOrderRevision((revision) => revision + 1);

    if (unseen.length > 0) {
      // Never overwrite one order with another. Restaurant bursts are common;
      // staff must acknowledge each order in arrival order.
      setArrivals((current) => {
        const queued = new Set(current.map((order) => order.id));
        return [...current, ...unseen.filter((order) => !queued.has(order.id))];
      });
    }
  }, []);

  /** The screen refresh button performs a real server pull. */
  const reload = useCallback(() => {
    void pullNow(store.id, false, true, true);
  }, [store.id]);

  useEffect(
    () =>
      onSynced(({ storeId, source, pulledIds }) => {
        if (storeId !== store.id) return;
        const ids = pulledIds.get("web_orders");
        if (ids?.length) refresh(ids, source !== "backfill");
      }),
    [refresh, store.id],
  );

  /**
   * Pull inbound changes every four seconds. The sync engine owns the only
   * cursor-zero replay, so this safety poll can never start a duplicate history
   * pass or suppress updates for the other providers.
   */
  useEffect(() => {
    if (!SYNC_ENABLED) return;

    const timer = setInterval(() => {
      if (AppState.currentState !== "active") return;
      void pullNow(store.id);
    }, 4000);
    return () => clearInterval(timer);
  }, [store.id]);

  /**
   * A push notification arriving while the app is backgrounded doesn't run our
   * sync, so pull immediately when one lands or is tapped.
   */
  useEffect(() => {
    if (!SYNC_ENABLED) return;

    const pullLatest = () => {
      // Pull-only delivery cannot be blocked by an unrelated denied local edit.
      void pullNow(store.id);
    };
    const received = Notifications.addNotificationReceivedListener(pullLatest);
    const tapped = Notifications.addNotificationResponseReceivedListener(pullLatest);
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [store.id]);

  const value = useMemo<WebOrdersState>(() => {
    const write = (id: string, patch: Partial<WebOrder>) => {
      const current = orders.find((order) => order.id === id) ?? loadOne<WebOrder>("web_orders", id);
      if (!current) return;
      const next = { ...current, ...patch, updatedAt: Date.now() };
      dbPut("web_orders", next); // dirty -> syncs to other devices
      setOrders((rows) => boundLiveOrders([next, ...rows.filter((order) => order.id !== id)]));
      setWebOrderRevision((revision) => revision + 1);
    };

    const active = orders.filter(isOpen);
    return {
      orders,
      active,
      pendingCount: active.filter((order) => order.status === "received").length,
      webOrderRevision,
      setStatus: (id, status) => write(id, { status }),
      attachReceipt: (id, receiptId) => write(id, { receiptId, status: "served" }),
      reload,
      arrival: arrivals[0] ?? null,
      dismissArrival: () => setArrivals((current) => current.slice(1)),
    };
  }, [orders, arrivals, reload, webOrderRevision]);

  return <WebOrdersContext.Provider value={value}>{children}</WebOrdersContext.Provider>;
}

export function useWebOrders(): WebOrdersState {
  const ctx = useContext(WebOrdersContext);
  if (!ctx) throw new Error("useWebOrders must be used within a WebOrdersProvider");
  return ctx;
}
