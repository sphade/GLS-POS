import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { ProductVariant, WebOrder } from "@gls-pos/types";
import { loadAll, put as dbPut } from "./db";

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

/** One sellable variation of an item (e.g. Regular, Large, 500gm). */
export type Variant = ProductVariant;

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

export const hasVariants = (item: Item): boolean => !!item.variants?.length;
export const variantAvailable = (variant: Variant): boolean => variant.stock == null || variant.stock > 0;
export const itemAvailable = (item: Item): boolean =>
  hasVariants(item) ? item.variants!.some(variantAvailable) : item.stockQuantity !== 0;
export const itemDisplayPrice = (item: Item): number =>
  hasVariants(item) ? Math.min(...item.variants!.map((variant) => variant.price)) : item.price;
export const cartLineKey = (productId: string, variantId?: string): string =>
  variantId ? `${productId}:${variantId}` : productId;
export const displayItemName = (name: string, variantName?: string): string =>
  variantName ? `${name} — ${variantName}` : name;

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

export type ReceiptLine = {
  productId?: string;
  variantId?: string;
  variantName?: string;
  name: string;
  qty: number;
  price: number;
};

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
  lines: ReceiptLine[];
  cashReceived?: number;
  /** Snapshot of who/where sold it, so a reprint is always accurate. */
  storeName: string;
  storeReference?: string;
  servedBy: string;
  /** Set when an unpaid receipt is later settled. */
  paidAt?: number;
};

export type CartEntry = { lineId: string; item: Item; variant?: Variant; qty: number };

type CartState = {
  entries: Record<string, CartEntry>;
  count: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  add: (item: Item, variant?: Variant) => void;
  /** Remove one unit by cart line key, not just product id. */
  remove: (lineId: string) => void;
  /** Total quantity across all variants of a product. */
  qtyOf: (productId: string) => number;
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
  // Receipts are real sales only — no demo seeding. An earlier version seeded 17
  // fake receipts (some flagged unsynced on purpose), which made the Receipts
  // screen and its "not synced" warning show information that wasn't true.
  const [receipts, setReceipts] = useState<Receipt[]>(() =>
    loadAll<Receipt>("receipts").sort((a, b) => b.createdAt - a.createdAt),
  );

  const value = useMemo<CartState>(() => {
    const list = Object.values(entries);
    const priceOf = (entry: CartEntry) => entry.variant?.price ?? entry.item.price;
    const taxRateOf = (entry: CartEntry) =>
      entry.variant?.taxOn
        ? Math.round((entry.variant.taxPercent ?? 0) * 100)
        : (entry.item.taxRateBps ?? 0);
    const subtotal = list.reduce((sum, entry) => sum + entry.qty * priceOf(entry), 0);
    const taxTotal = list.reduce(
      (sum, entry) => sum + Math.round((entry.qty * priceOf(entry) * taxRateOf(entry)) / 10000),
      0,
    );
    return {
      entries,
      count: list.reduce((sum, entry) => sum + entry.qty, 0),
      subtotal,
      taxTotal,
      total: subtotal + taxTotal,
      qtyOf: (productId) =>
        list.reduce((sum, entry) => sum + (entry.item.id === productId ? entry.qty : 0), 0),
      add: (item, variant) => {
        if (hasVariants(item) && !variant) return;
        if (variant && !item.variants?.some((candidate) => candidate.id === variant.id)) return;
        const lineId = cartLineKey(item.id, variant?.id);
        setEntries((prev) => {
          const quantity = prev[lineId]?.qty ?? 0;
          const stock = variant ? variant.stock : item.stockQuantity;
          if (stock != null && quantity >= stock) return prev;
          return {
            ...prev,
            [lineId]: { lineId, item, variant, qty: quantity + 1 },
          };
        });
      },
      remove: (lineId) =>
        setEntries((prev) => {
          const existing = prev[lineId];
          if (!existing) return prev;
          if (existing.qty <= 1) {
            const next = { ...prev };
            delete next[lineId];
            return next;
          }
          return { ...prev, [lineId]: { ...existing, qty: existing.qty - 1 } };
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
          lines: list.map((entry) => ({
            productId: entry.item.id,
            variantId: entry.variant?.id,
            variantName: entry.variant?.name,
            name: displayItemName(entry.item.name, entry.variant?.name),
            qty: entry.qty,
            price: priceOf(entry),
          })),
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
          lines: order.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            variantName: line.variantName,
            name: displayItemName(line.name, line.variantName),
            qty: line.quantity,
            price: line.unitPrice,
          })),
          storeName,
          storeReference,
          servedBy,
        };
        dbPut("receipts", receipt);
        setReceipts((prev) => [receipt, ...prev]);
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

