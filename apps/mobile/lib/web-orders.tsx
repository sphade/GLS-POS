import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { WebOrder, WebOrderStatus } from "@gls-pos/types";
import { loadAll, put as dbPut } from "./db";

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
};

const OPEN: WebOrderStatus[] = ["received", "preparing", "ready"];

const WebOrdersContext = createContext<WebOrdersState | null>(null);

export function WebOrdersProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<WebOrder[]>(() => loadAll<WebOrder>("web_orders"));

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
      reload: () => setOrders(loadAll<WebOrder>("web_orders")),
    };
  }, [orders]);

  return <WebOrdersContext.Provider value={value}>{children}</WebOrdersContext.Provider>;
}

export function useWebOrders(): WebOrdersState {
  const ctx = useContext(WebOrdersContext);
  if (!ctx) throw new Error("useWebOrders must be used within a WebOrdersProvider");
  return ctx;
}
