import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Item = {
  id: string;
  name: string;
  /** integer minor units (cents) */
  price: number;
  currency: string;
  /** null = not stock-tracked */
  stockQuantity: number | null;
  unit?: string;
  categoryId?: string;
  categoryColor?: string;
  taxRateBps?: number;
};

export type Receipt = {
  id: string;
  number: string;
  customerName: string | null;
  mode: string;
  itemCount: number;
  total: number;
  currency: string;
  createdAt: number;
  synced: boolean;
  lines: { name: string; qty: number; price: number }[];
  cashReceived?: number;
};

type CartEntry = { item: Item; qty: number };

type CartState = {
  entries: Record<string, CartEntry>;
  count: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  add: (item: Item) => void;
  remove: (id: string) => void;
  qtyOf: (id: string) => number;
  clear: () => void;
  receipts: Receipt[];
  completeSale: (input: { mode: string; customerName: string | null; cashReceived?: number }) => Receipt;
};

const CartContext = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, CartEntry>>({});
  const [receipts, setReceipts] = useState<Receipt[]>([]);

  const value = useMemo<CartState>(() => {
    const list = Object.values(entries);
    const subtotal = list.reduce((s, e) => s + e.qty * e.item.price, 0);
    const taxTotal = list.reduce(
      (s, e) => s + Math.round((e.qty * e.item.price * (e.item.taxRateBps ?? 0)) / 10000),
      0,
    );
    return {
      entries,
      count: list.reduce((s, e) => s + e.qty, 0),
      subtotal,
      taxTotal,
      total: subtotal + taxTotal,
      qtyOf: (id) => entries[id]?.qty ?? 0,
      add: (item) =>
        setEntries((prev) => ({
          ...prev,
          [item.id]: { item, qty: (prev[item.id]?.qty ?? 0) + 1 },
        })),
      remove: (id) =>
        setEntries((prev) => {
          const existing = prev[id];
          if (!existing) return prev;
          if (existing.qty <= 1) {
            const next = { ...prev };
            delete next[id];
            return next;
          }
          return { ...prev, [id]: { ...existing, qty: existing.qty - 1 } };
        }),
      clear: () => setEntries({}),
      receipts,
      completeSale: ({ mode, customerName, cashReceived }) => {
        const receipt: Receipt = {
          id: `rcpt_${Date.now()}`,
          number: `#${1000 + receipts.length + 1}`,
          customerName,
          mode,
          itemCount: list.reduce((s, e) => s + e.qty, 0),
          total: subtotal + taxTotal,
          currency: list[0]?.item.currency ?? "USD",
          createdAt: Date.now(),
          synced: Math.random() > 0.25,
          lines: list.map((e) => ({ name: e.item.name, qty: e.qty, price: e.item.price })),
          cashReceived,
        };
        setReceipts((prev) => [receipt, ...prev]);
        setEntries({});
        return receipt;
      },
    };
  }, [entries, receipts]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
