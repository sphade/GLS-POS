import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { WebOrder } from "@gls-pos/types";
import { seedReceipts } from "./seed-receipts";
import { loadAll, put as dbPut, seedOnce } from "./db";

/**
 * How an item is sold:
 *  - "unit"     â†’ whole units only (1, 2, 3 â€¦). `unit` is a free label e.g. "plate".
 *  - "fraction" â†’ loose/weighed. Quantity may be fractional and converts to a
 *                 sub-unit at `unitRatio` (e.g. 1 Kg = 1000 Gm, so 0.25 â†’ 250 Gm).
 */
export type SellBy = "unit" | "fraction";

export type Measure = {
  /** Major unit priced against, e.g. "Kg". */
  unit: string;
  /** Sub unit shown when a fractional quantity is entered, e.g. "Gm". */
  subUnit: string;
  /** How many sub-units make one major unit, e.g. 1000. */
  ratio: number;
};

export const MEASURES: Measure[] = [
  { unit: "Kg", subUnit: "Gm", ratio: 1000 },
  { unit: "Ltr", subUnit: "Ml", ratio: 1000 },
  { unit: "Mtr", subUnit: "Cm", ratio: 100 },
  { unit: "Dozen", subUnit: "Pcs", ratio: 12 },
];

/** 0.25 with Kg/Gm/1000 â†’ "250 Gm". Whole values stay in the major unit. */
export function formatFractionalQty(qty: number, measure: Measure): string {
  if (Number.isInteger(qty)) return `${qty} ${measure.unit}`;
  const sub = Math.round(qty * measure.ratio);
  return `${sub} ${measure.subUnit}`;
}

/** One sellable variation of an item (e.g. 500gm, Blue, 1kg). */
export type Variant = {
  id: string;
  name: string;
  color: string;
  /** integer minor units */
  price: number;
  cost?: number;
  stock?: number;
  trackProfit: boolean;
  lowStockAlert: boolean;
  lowStockAt?: number;
  autoUpdateStock: boolean;
  barcodeOn: boolean;
  barcode?: string;
  expiryOn: boolean;
  expiry?: string;
  taxOn: boolean;
  taxPercent?: number;
  taxInclusive?: boolean;
  notesOn: boolean;
  notes?: string;
  modifiersOn: boolean;
  modifierIds: string[];
  recipeOn: boolean;
  spacesOn: boolean;
  tagsOn: boolean;
  tags?: string;
  compareOn: boolean;
  comparePrice?: number;
  skuOn: boolean;
  sku?: string;
};

export type Item = {
  id: string;
  name: string;
  /** integer minor units (cents) â€” price per unit, or per major unit when fractional */
  price: number;
  currency: string;
  /** null = not stock-tracked */
  stockQuantity: number | null;
  /** Warn/flag when stock drops to or below this (only when tracked). */
  lowStockAt?: number;
  /**
   * True when a photo exists for this item. The bytes live in the separate
   * `product_images` collection (see lib/image-store.ts) — never on this
   * document, so reading the catalog stays fast.
   */
  hasImage?: boolean;
  /** Remote source URL used once to hydrate the local image; display fallback. */
  imageUrl?: string;
  /** Free-text label when sellBy === "unit" (e.g. "plate", "cup"). */
  unit?: string;
  sellBy?: SellBy;
  /** Set when sellBy === "fraction". */
  measure?: Measure;
  categoryId?: string;
  categoryColor?: string;
  taxRateBps?: number;
  /** Populated in Advance mode. Empty = simple single-price item. */
  variants?: Variant[];
};

export function newVariant(color: string): Variant {
  return {
    id: `var_${Date.now()}_${Math.round(Math.random() * 1e4)}`,
    name: "",
    color,
    price: 0,
    trackProfit: false,
    lowStockAlert: false,
    autoUpdateStock: true,
    barcodeOn: false,
    expiryOn: false,
    taxOn: false,
    notesOn: false,
    modifiersOn: false,
    modifierIds: [],
    recipeOn: false,
    spacesOn: false,
    tagsOn: false,
    compareOn: false,
    skuOn: false,
  };
}

/**
 * Whether the money has actually arrived. Most GLS sales are card/transfer, so
 * the receipt is printed first and the customer pays against it — those start
 * as "unpaid" and are settled afterwards.
 */
export type PaymentStatus = "paid" | "unpaid";

export type Receipt = {
  id: string;
  number: string;
  customerName: string | null;
  mode: string;
  status: PaymentStatus;
  itemCount: number;
  total: number;
  currency: string;
  createdAt: number;
  synced: boolean;
  lines: { name: string; qty: number; price: number }[];
  cashReceived?: number;
  /** Snapshot of who/where sold it, so a reprint is always accurate. */
  storeName: string;
  storeReference?: string;
  servedBy: string;
  /** Set when an unpaid receipt is later settled. */
  paidAt?: number;
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
  completeSale: (input: {
    mode: string;
    customerName: string | null;
    cashReceived?: number;
    /** Defaults to "paid"; card/transfer flows pass "unpaid". */
    status?: PaymentStatus;
    storeName: string;
    storeReference?: string;
    servedBy: string;
  }) => Receipt;
  /** Settle an unpaid receipt once the transfer/card payment lands. */
  markPaid: (id: string, mode?: string) => void;
  /**
   * Raise a receipt for a VIP web order. Bypasses the cart entirely — the order
   * was already priced server-side — and starts unpaid, since the guest pays
   * against the printed slip.
   */
  billWebOrder: (input: {
    order: WebOrder;
    storeName: string;
    storeReference?: string;
    servedBy: string;
  }) => Receipt;
};

const CartContext = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, CartEntry>>({});
  // Receipts persist in SQLite (offline-first). Seeded once for the demo.
  const [receipts, setReceipts] = useState<Receipt[]>(() => {
    seedOnce("receipts_seeded", () => seedReceipts().forEach((r) => dbPut("receipts", r, false)));
    return loadAll<Receipt>("receipts").sort((a, b) => b.createdAt - a.createdAt);
  });

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
      completeSale: ({ mode, customerName, cashReceived, status, storeName, storeReference, servedBy }) => {
        const now = Date.now();
        const settled = status ?? "paid";
        const receipt: Receipt = {
          id: `rcpt_${now}`,
          number: `#${1000 + receipts.length + 1}`,
          customerName,
          mode,
          status: settled,
          itemCount: list.reduce((s, e) => s + e.qty, 0),
          total: subtotal + taxTotal,
          currency: list[0]?.item.currency ?? "NGN",
          createdAt: now,
          synced: false,
          lines: list.map((e) => ({ name: e.item.name, qty: e.qty, price: e.item.price })),
          cashReceived,
          storeName,
          storeReference,
          servedBy,
          paidAt: settled === "paid" ? now : undefined,
        };
        dbPut("receipts", receipt);
        setReceipts((prev) => [receipt, ...prev]);
        setEntries({});
        return receipt;
      },

      billWebOrder: ({ order, storeName, storeReference, servedBy }) => {
        const now = Date.now();
        const receipt: Receipt = {
          id: `rcpt_${now}`,
          number: order.code,
          customerName: order.guestName ?? null,
          mode: "Unpaid",
          status: "unpaid",
          itemCount: order.lines.reduce((s, l) => s + l.quantity, 0),
          total: order.total,
          currency: order.currency,
          createdAt: now,
          synced: false,
          lines: order.lines.map((l) => ({
            name: l.name,
            qty: l.quantity,
            price: l.unitPrice,
          })),
          storeName,
          storeReference,
          servedBy,
        };
        dbPut("receipts", receipt);
        setReceipts((prev) => [receipt, ...prev]);
        return receipt;
      },

      markPaid: (id, mode) => {
        setReceipts((prev) =>
          prev.map((r) => {
            if (r.id !== id || r.status === "paid") return r;
            const updated: Receipt = {
              ...r,
              status: "paid",
              paidAt: Date.now(),
              mode: mode ?? r.mode,
            };
            dbPut("receipts", updated);
            return updated;
          }),
        );
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

