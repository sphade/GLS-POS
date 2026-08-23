import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ProductVariant, WebOrder } from "@gls-pos/types";
import { formatMoney } from "@/constants/theme";
import { loadAll, put as dbPut, softDelete } from "./db";
import { logAudit } from "./audit";
import { onSynced } from "./sync";

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

/**
 * A parked bill: the cart snapshotted so a table can keep ordering (or a
 * customer can pay later) without finalising a receipt. Shown on the Counter
 * under NEW ORDER; resuming loads it back into the cart to charge and print.
 */
export type HeldOrder = {
  id: string;
  /** Customer/table name shown in the open-bills list. */
  label: string;
  note?: string;
  entries: CartEntry[];
  itemCount: number;
  total: number;
  currency: string;
  createdAt: number;
};

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

  /** Open/held bills, newest first. */
  heldOrders: HeldOrder[];
  /**
   * Park the current cart as an open bill under `label`, then clear the cart.
   * Pass `existingId` to update a bill in place (editing) instead of making a
   * new one.
   */
  holdOrder: (label: string, note?: string, existingId?: string) => void;
  /** Load a held bill back into the cart and remove it from the open list. */
  resumeHeldOrder: (id: string) => void;
  /** Discard a held bill without paying. */
  discardHeldOrder: (id: string) => void;

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

/**
 * A second, deliberately-thin cart context for hot paths like the item grid.
 *
 * The full CartContext value changes on every add/remove, so any screen that
 * consumes it re-renders on every tap. The catalog grid only needs stable
 * actions plus a way to read one product's quantity, so it uses this instead:
 * `add`/`remove`/`clear` never change identity, and `subscribe`/`getQtyOf`/
 * `getCount` drive fine-grained `useSyncExternalStore` reads so a tap
 * re-renders only the one tile whose quantity changed — not the whole screen.
 */
type CartFast = {
  add: (item: Item, variant?: Variant) => void;
  remove: (lineId: string) => void;
  clear: () => void;
  subscribeToProduct: (productId: string, cb: () => void) => () => void;
  subscribeToCount: (cb: () => void) => () => void;
  getQtyOf: (productId: string) => number;
  getCount: () => number;
};

const CartFastContext = createContext<CartFast | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, CartEntry>>({});

  // --- Synchronous fine-grained quantity store ----------------------------
  // React state remains the source rendered by checkout/report screens, while
  // this ref is advanced synchronously for hot-path item taps. That means ten
  // rapid presses read ten successive quantities instead of waiting for a
  // React commit before the tile can observe the new count.
  const entriesRef = useRef(entries);
  const productListeners = useRef(new Map<string, Set<() => void>>());
  const countListeners = useRef(new Set<() => void>());

  const getQtyOf = useCallback(
    (productId: string) =>
      Object.values(entriesRef.current).reduce(
        (sum, entry) => (entry.item.id === productId ? sum + entry.qty : sum),
        0,
      ),
    [],
  );
  const getCount = useCallback(
    () => Object.values(entriesRef.current).reduce((sum, entry) => sum + entry.qty, 0),
    [],
  );

  const subscribeToProduct = useCallback((productId: string, cb: () => void) => {
    let listeners = productListeners.current.get(productId);
    if (!listeners) {
      listeners = new Set();
      productListeners.current.set(productId, listeners);
    }
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
      if (listeners.size === 0) productListeners.current.delete(productId);
    };
  }, []);
  const subscribeToCount = useCallback((cb: () => void) => {
    countListeners.current.add(cb);
    return () => countListeners.current.delete(cb);
  }, []);

  const notifyDifference = useCallback(
    (previous: Record<string, CartEntry>, next: Record<string, CartEntry>) => {
      const previousQty = new Map<string, number>();
      const nextQty = new Map<string, number>();
      let previousCount = 0;
      let nextCount = 0;

      for (const entry of Object.values(previous)) {
        previousQty.set(entry.item.id, (previousQty.get(entry.item.id) ?? 0) + entry.qty);
        previousCount += entry.qty;
      }
      for (const entry of Object.values(next)) {
        nextQty.set(entry.item.id, (nextQty.get(entry.item.id) ?? 0) + entry.qty);
        nextCount += entry.qty;
      }

      const productIds = new Set([...previousQty.keys(), ...nextQty.keys()]);
      for (const productId of productIds) {
        if ((previousQty.get(productId) ?? 0) === (nextQty.get(productId) ?? 0)) continue;
        productListeners.current.get(productId)?.forEach((listener) => listener());
      }
      if (previousCount !== nextCount) {
        countListeners.current.forEach((listener) => listener());
      }
    },
    [],
  );

  const replaceEntries = useCallback(
    (next: Record<string, CartEntry>) => {
      const previous = entriesRef.current;
      if (next === previous) return;
      entriesRef.current = next;
      setEntries(next);
      notifyDifference(previous, next);
    },
    [notifyDifference],
  );

  // --- Stable actions (identity never changes) ----------------------------
  const add = useCallback(
    (item: Item, variant?: Variant) => {
      if (hasVariants(item) && !variant) return;
      const selectedVariant = variant
        ? item.variants?.find((candidate) => candidate.id === variant.id)
        : undefined;
      if (variant && !selectedVariant) return;

      const lineId = cartLineKey(item.id, selectedVariant?.id);
      const previous = entriesRef.current;
      const quantity = previous[lineId]?.qty ?? 0;
      const stock = selectedVariant ? selectedVariant.stock : item.stockQuantity;
      if (stock != null && quantity + 1 > stock) return;

      replaceEntries({
        ...previous,
        [lineId]: { lineId, item, variant: selectedVariant, qty: quantity + 1 },
      });
    },
    [replaceEntries],
  );

  const remove = useCallback(
    (lineId: string) => {
      const previous = entriesRef.current;
      const existing = previous[lineId];
      if (!existing) return;

      if (existing.qty <= 1) {
        const next = { ...previous };
        delete next[lineId];
        replaceEntries(next);
        return;
      }
      replaceEntries({ ...previous, [lineId]: { ...existing, qty: existing.qty - 1 } });
    },
    [replaceEntries],
  );

  const clear = useCallback(() => replaceEntries({}), [replaceEntries]);

  const fast = useMemo<CartFast>(
    () => ({ add, remove, clear, subscribeToProduct, subscribeToCount, getQtyOf, getCount }),
    [add, remove, clear, subscribeToProduct, subscribeToCount, getQtyOf, getCount],
  );
  // Receipts persist in SQLite (offline-first). Seeded once for the demo.
  // Receipts are real sales only — no demo seeding. An earlier version seeded 17
  // fake receipts (some flagged unsynced on purpose), which made the Receipts
  // screen and its "not synced" warning show information that wasn't true.
  const [receipts, setReceipts] = useState<Receipt[]>(() =>
    loadAll<Receipt>("receipts").sort((a, b) => b.createdAt - a.createdAt),
  );
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>(() =>
    loadAll<HeldOrder>("held_orders").sort((a, b) => b.createdAt - a.createdAt),
  );

  // Open bills can be created on another till, so refresh after each sync.
  useEffect(() => {
    return onSynced(() => {
      setHeldOrders(loadAll<HeldOrder>("held_orders").sort((a, b) => b.createdAt - a.createdAt));
      setReceipts(loadAll<Receipt>("receipts").sort((a, b) => b.createdAt - a.createdAt));
    });
  }, []);

  const value = useMemo<CartState>(() => {
    const list = Object.values(entries);
    const priceOf = (entry: CartEntry) => entry.variant?.price ?? entry.item.price;
    const taxRateOf = (entry: CartEntry) =>
      entry.variant
        ? entry.variant.taxOn
          ? Math.round((entry.variant.taxPercent ?? 0) * 100)
          : 0
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
      add,
      remove,
      clear,

      heldOrders,
      holdOrder: (label, note, existingId) => {
        if (list.length === 0) return;
        const now = Date.now();
        const held: HeldOrder = {
          id: existingId ?? `held_${now}_${Math.round(Math.random() * 1e4)}`,
          label: label.trim() || "Open bill",
          note,
          entries: list,
          itemCount: list.reduce((s, e) => s + e.qty, 0),
          total: subtotal + taxTotal,
          currency: list[0]?.item.currency ?? "NGN",
          createdAt: now,
        };
        dbPut("held_orders", held);
        // Replace in place when updating, otherwise prepend.
        setHeldOrders((prev) => [held, ...prev.filter((h) => h.id !== held.id)]);
        clear();
        logAudit({
          action: existingId ? "bill.update" : "bill.hold",
          entity: "held_order",
          entityId: held.id,
          summary: `${existingId ? "Updated" : "Held"} bill "${held.label}" · ${formatMoney(held.total, held.currency)}`,
        });
      },
      resumeHeldOrder: (id) => {
        const held = heldOrders.find((h) => h.id === id);
        if (!held) return;
        const next: Record<string, CartEntry> = {};
        held.entries.forEach((e) => {
          next[e.lineId] = e;
        });
        replaceEntries(next);
        softDelete("held_orders", id);
        setHeldOrders((prev) => prev.filter((h) => h.id !== id));
      },
      discardHeldOrder: (id) => {
        softDelete("held_orders", id);
        setHeldOrders((prev) => prev.filter((h) => h.id !== id));
      },

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
        clear();
        logAudit({
          action: "sale.complete",
          entity: "receipt",
          entityId: receipt.id,
          summary: `Sale ${receipt.number} · ${receipt.itemCount} item${receipt.itemCount === 1 ? "" : "s"} · ${mode} · ${formatMoney(receipt.total, receipt.currency)}`,
        });
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
        logAudit({
          action: "order.bill",
          entity: "receipt",
          entityId: receipt.id,
          summary: `Billed VIP order ${order.code} · ${formatMoney(order.total, order.currency)}`,
        });
        return receipt;
      },

    };
  }, [entries, receipts, heldOrders, add, remove, clear, replaceEntries]);

  return (
    <CartContext.Provider value={value}>
      <CartFastContext.Provider value={fast}>{children}</CartFastContext.Provider>
    </CartContext.Provider>
  );
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}

/** Stable cart actions + non-reactive readers, for hot paths like the grid. */
export function useCartActions(): CartFast {
  const ctx = useContext(CartFastContext);
  if (!ctx) throw new Error("useCartActions must be used within a CartProvider");
  return ctx;
}

/** Subscribe to just one product's total quantity (sums its variants). */
export function useItemQty(productId: string): number {
  const ctx = useCartActions();
  const subscribe = useCallback(
    (cb: () => void) => ctx.subscribeToProduct(productId, cb),
    [ctx, productId],
  );
  const getSnapshot = useCallback(() => ctx.getQtyOf(productId), [ctx, productId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Subscribe to the cart's total item count. */
export function useCartCount(): number {
  const ctx = useCartActions();
  return useSyncExternalStore(ctx.subscribeToCount, ctx.getCount);
}

