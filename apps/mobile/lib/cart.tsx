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
import { loadAll, metaGet, metaSet, put as dbPut, softDelete } from "./db";
import { computeTotals, type Discount, type PricedLine } from "./discount-model";
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
  /**
   * The line's own discount in minor units, for the printed itemisation.
   * Absent on receipts raised before discounts existed.
   */
  discount?: number;
  /** The line's share of an order-level discount, in minor units. */
  orderDiscountShare?: number;
  /**
   * What this line actually contributed to the pre-tax total, after every
   * discount. Returns refund from this, so a discounted sale can never be
   * refunded at list price. Absent on older receipts, where `price × qty` is
   * the correct net by definition.
   */
  netTotal?: number;
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
  /** Every discount on this sale (line + order), in minor units. */
  discountTotal?: number;
  /** The order-level discount as entered, so the slip can say "10% off". */
  orderDiscount?: Discount;
  cashReceived?: number;
  /** Snapshot of who/where sold it, so a reprint is always accurate. */
  storeName: string;
  storeReference?: string;
  servedBy: string;
  /** Set when an unpaid receipt is later settled. */
  paidAt?: number;
};

export type CartEntry = {
  lineId: string;
  item: Item;
  variant?: Variant;
  qty: number;
  /** Line-level discount, if a manager gave one. */
  discount?: Discount;
};

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
  /** Order-level discount parked with the bill, so resuming restores it. */
  orderDiscount?: Discount;
  /**
   * Set while the bill is loaded in the active cart. The record is kept (not
   * deleted) until the cart is charged, held again, or cleared — so killing
   * the app mid-edit never loses an open ticket.
   */
  resumedAt?: number;
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

  /** Discounts (owner/manager only — the UI gates on `discount:apply`). */
  orderDiscount: Discount | null;
  setLineDiscount: (lineId: string, discount: Discount | null) => void;
  setOrderDiscount: (discount: Discount | null) => void;

  /** Open/held bills, newest first. */
  heldOrders: HeldOrder[];
  /**
   * Park the current cart as an open bill under `label`, then clear the cart.
   * Pass `existingId` to update a bill in place (editing) instead of making a
   * new one.
   */
  holdOrder: (label: string, note?: string, existingId?: string) => void;
  /** Load a held bill back into the cart. The bill stays parked (marked
   *  resumed) until the cart is charged, re-held, or cleared. */
  resumeHeldOrder: (id: string) => void;
  /** Discard a held bill without paying. */
  discardHeldOrder: (id: string) => void;

  /** Mark an unpaid receipt as settled (money received after the fact). */
  settleReceipt: (id: string) => void;

  // --- Dine-in table tickets ----------------------------------------------
  /** Open (or reopen) a table's running ticket as the active cart. */
  openTableTicket: (tableLabel: string) => void;
  /** Park the active cart back onto its table ticket and empty the cart. */
  saveTableTicket: () => void;
  /** Leave the table: discard its ticket if one is open, then empty the cart. */
  abandonTableTicket: () => void;

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
export type CartSummary = {
  count: number;
  /** Undiscounted value of the bill. */
  gross: number;
  lineDiscountTotal: number;
  orderDiscountTotal: number;
  /** line + order discounts. */
  discountTotal: number;
  /** Pre-tax value after discounts — what tax is charged on. */
  subtotal: number;
  taxTotal: number;
  total: number;
};

/** Unit price actually charged for a line (variant overrides the item). */
const unitPriceOf = (entry: CartEntry): number => entry.variant?.price ?? entry.item.price;

/**
 * Tax rate for a line in basis points. A variant carries its own percent and
 * only charges tax when `taxOn`; a simple item uses `taxRateBps`.
 */
const taxRateBpsOf = (entry: CartEntry): number =>
  entry.variant
    ? entry.variant.taxOn
      ? Math.round((entry.variant.taxPercent ?? 0) * 100)
      : 0
    : (entry.item.taxRateBps ?? 0);

/** Cart entries in the shape the discount engine prices. */
function pricedLinesOf(entries: Record<string, CartEntry>): PricedLine[] {
  return Object.values(entries).map((entry) => ({
    id: entry.lineId,
    unitPrice: unitPriceOf(entry),
    qty: entry.qty,
    taxRateBps: taxRateBpsOf(entry),
    discount: entry.discount,
  }));
}

/**
 * Price the cart. Discounts come off first and tax is charged on what's left,
 * so `subtotal` is the discounted pre-tax figure — which is what `total`,
 * receipts and the Charge button have always meant.
 */
function calculateCartSummary(
  entries: Record<string, CartEntry>,
  orderDiscount: Discount | null,
): CartSummary {
  const totals = computeTotals(pricedLinesOf(entries), orderDiscount);
  return {
    count: totals.count,
    gross: totals.gross,
    lineDiscountTotal: totals.lineDiscountTotal,
    orderDiscountTotal: totals.orderDiscountTotal,
    discountTotal: totals.discountTotal,
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
  };
}

function sameLineIds(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length === next.length && previous.every((id, index) => id === next[index]);
}

/** Whether any figure a totals subscriber renders has moved. */
function summaryDiffers(a: CartSummary, b: CartSummary): boolean {
  return (
    a.count !== b.count ||
    a.gross !== b.gross ||
    a.lineDiscountTotal !== b.lineDiscountTotal ||
    a.orderDiscountTotal !== b.orderDiscountTotal ||
    a.discountTotal !== b.discountTotal ||
    a.subtotal !== b.subtotal ||
    a.taxTotal !== b.taxTotal ||
    a.total !== b.total
  );
}

type CartFast = {
  add: (item: Item, variant?: Variant) => void;
  remove: (lineId: string) => void;
  clear: () => void;
  /**
   * Give the cart the live catalog so taps resolve stock/price against current
   * data, not the snapshot frozen into a line when it was first added.
   */
  registerCatalog: (products: Item[]) => void;
  /** Dine-in table ticket lifecycle (stable identities, ref-backed). */
  openTableTicket: (tableLabel: string) => void;
  saveTableTicket: () => void;
  abandonTableTicket: () => void;
  /** Set or clear one line's discount. Pass null to remove it. */
  setLineDiscount: (lineId: string, discount: Discount | null) => void;
  /** Set or clear the whole-bill discount. Pass null to remove it. */
  setOrderDiscount: (discount: Discount | null) => void;
  getOrderDiscount: () => Discount | null;
  subscribeToProduct: (productId: string, cb: () => void) => () => void;
  subscribeToCount: (cb: () => void) => () => void;
  subscribeToLine: (lineId: string, cb: () => void) => () => void;
  subscribeToLineIds: (cb: () => void) => () => void;
  subscribeToSummary: (cb: () => void) => () => void;
  getQtyOf: (productId: string) => number;
  getCount: () => number;
  getLine: (lineId: string) => CartEntry | undefined;
  getLineIds: () => readonly string[];
  getSummary: () => CartSummary;
};

const CartFastContext = createContext<CartFast | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, CartEntry>>({});
  const [orderDiscount, setOrderDiscountState] = useState<Discount | null>(null);

  // --- Synchronous fine-grained quantity store ----------------------------
  // React state remains the source rendered by checkout/report screens, while
  // these snapshots advance synchronously for hot-path taps. Consumers can
  // subscribe to one product, one variant-safe line, the line structure, or
  // totals without waking the rest of the cart UI.
  const entriesRef = useRef(entries);
  const orderDiscountRef = useRef<Discount | null>(orderDiscount);
  const lineIdsRef = useRef<readonly string[]>(Object.keys(entries));
  const summaryRef = useRef<CartSummary>(calculateCartSummary(entries, orderDiscount));
  const productListeners = useRef(new Map<string, Set<() => void>>());
  const lineListeners = useRef(new Map<string, Set<() => void>>());
  const countListeners = useRef(new Set<() => void>());
  const lineIdsListeners = useRef(new Set<() => void>());
  const summaryListeners = useRef(new Set<() => void>());
  /** Live catalog lookup, refreshed by `registerCatalog` from CatalogProvider. */
  const catalogRef = useRef(new Map<string, Item>());

  const getQtyOf = useCallback(
    (productId: string) =>
      Object.values(entriesRef.current).reduce(
        (sum, entry) => (entry.item.id === productId ? sum + entry.qty : sum),
        0,
      ),
    [],
  );
  const getCount = useCallback(() => summaryRef.current.count, []);
  const getLine = useCallback((lineId: string) => entriesRef.current[lineId], []);
  const getLineIds = useCallback(() => lineIdsRef.current, []);
  const getSummary = useCallback(() => summaryRef.current, []);
  const getOrderDiscount = useCallback(() => orderDiscountRef.current, []);

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
  const subscribeToLine = useCallback((lineId: string, cb: () => void) => {
    let listeners = lineListeners.current.get(lineId);
    if (!listeners) {
      listeners = new Set();
      lineListeners.current.set(lineId, listeners);
    }
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
      if (listeners.size === 0) lineListeners.current.delete(lineId);
    };
  }, []);
  const subscribeToCount = useCallback((cb: () => void) => {
    countListeners.current.add(cb);
    return () => countListeners.current.delete(cb);
  }, []);
  const subscribeToLineIds = useCallback((cb: () => void) => {
    lineIdsListeners.current.add(cb);
    return () => lineIdsListeners.current.delete(cb);
  }, []);
  const subscribeToSummary = useCallback((cb: () => void) => {
    summaryListeners.current.add(cb);
    return () => summaryListeners.current.delete(cb);
  }, []);

  const notifyChangedEntries = useCallback(
    (previous: Record<string, CartEntry>, next: Record<string, CartEntry>) => {
      const previousQty = new Map<string, number>();
      const nextQty = new Map<string, number>();

      for (const entry of Object.values(previous)) {
        previousQty.set(entry.item.id, (previousQty.get(entry.item.id) ?? 0) + entry.qty);
      }
      for (const entry of Object.values(next)) {
        nextQty.set(entry.item.id, (nextQty.get(entry.item.id) ?? 0) + entry.qty);
      }

      const productIds = new Set([...previousQty.keys(), ...nextQty.keys()]);
      for (const productId of productIds) {
        if ((previousQty.get(productId) ?? 0) === (nextQty.get(productId) ?? 0)) continue;
        productListeners.current.get(productId)?.forEach((listener) => listener());
      }

      const lineIds = new Set([...Object.keys(previous), ...Object.keys(next)]);
      for (const lineId of lineIds) {
        if (previous[lineId] === next[lineId]) continue;
        lineListeners.current.get(lineId)?.forEach((listener) => listener());
      }
    },
    [],
  );

  /**
   * Commit a new cart state — lines and/or the order-level discount — updating
   * the synchronous snapshots first, then React state, then only the listeners
   * whose slice actually changed.
   */
  const publish = useCallback(
    (next: Record<string, CartEntry>, nextOrderDiscount: Discount | null) => {
      const previous = entriesRef.current;
      const previousOrderDiscount = orderDiscountRef.current;
      if (next === previous && nextOrderDiscount === previousOrderDiscount) return;

      const previousLineIds = lineIdsRef.current;
      const nextLineIds = Object.keys(next);
      const lineIdsChanged = !sameLineIds(previousLineIds, nextLineIds);
      const previousSummary = summaryRef.current;
      const nextSummary = calculateCartSummary(next, nextOrderDiscount);
      const summaryChanged = summaryDiffers(previousSummary, nextSummary);

      entriesRef.current = next;
      orderDiscountRef.current = nextOrderDiscount;
      if (lineIdsChanged) lineIdsRef.current = nextLineIds;
      if (summaryChanged) summaryRef.current = nextSummary;
      if (next !== previous) setEntries(next);
      if (nextOrderDiscount !== previousOrderDiscount) setOrderDiscountState(nextOrderDiscount);

      notifyChangedEntries(previous, next);
      if (lineIdsChanged) lineIdsListeners.current.forEach((listener) => listener());
      if (previousSummary.count !== nextSummary.count) {
        countListeners.current.forEach((listener) => listener());
      }
      if (summaryChanged) summaryListeners.current.forEach((listener) => listener());
    },
    [notifyChangedEntries],
  );

  /**
   * Replace the cart lines, keeping the current order discount unless one is
   * given explicitly. Pass `null` when the bill itself is going away (charged,
   * cleared, parked) so the next sale never inherits someone else's discount.
   */
  const replaceEntries = useCallback(
    (next: Record<string, CartEntry>, nextOrderDiscount?: Discount | null) =>
      publish(next, nextOrderDiscount === undefined ? orderDiscountRef.current : nextOrderDiscount),
    [publish],
  );

  const setLineDiscount = useCallback(
    (lineId: string, discount: Discount | null) => {
      const previous = entriesRef.current;
      const existing = previous[lineId];
      if (!existing) return;
      if ((existing.discount ?? null) === discount) return;
      const nextEntry: CartEntry = { ...existing };
      if (discount) nextEntry.discount = discount;
      else delete nextEntry.discount;
      replaceEntries({ ...previous, [lineId]: nextEntry });
    },
    [replaceEntries],
  );

  const setOrderDiscount = useCallback(
    (discount: Discount | null) => publish(entriesRef.current, discount),
    [publish],
  );

  // --- Stable actions (identity never changes) ----------------------------
  const registerCatalog = useCallback((products: Item[]) => {
    catalogRef.current = new Map(products.map((p) => [p.id, p]));
  }, []);

  const add = useCallback(
    (item: Item, variant?: Variant) => {
      if (hasVariants(item) && !variant) return;
      // Prefer the live catalog copy so limits use current stock.
      const live = catalogRef.current.get(item.id);
      const effective = live ?? item;
      const selectedVariant = variant
        ? effective.variants?.find((candidate) => candidate.id === variant.id)
        : undefined;
      if (variant && !selectedVariant) return;

      const lineId = cartLineKey(effective.id, selectedVariant?.id);
      const previous = entriesRef.current;
      const quantity = previous[lineId]?.qty ?? 0;
      const stock = selectedVariant ? selectedVariant.stock : effective.stockQuantity;
      if (stock != null && quantity + 1 > stock) return;

      replaceEntries({
        ...previous,
        [lineId]: { lineId, item: effective, variant: selectedVariant, qty: quantity + 1 },
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

  const clear = useCallback(() => {
    // Charging, clearing, or re-holding consumes the ticket that was resumed
    // into this cart — otherwise an open bill would linger forever after its
    // items were sold.
    const res = resumedHeldIdRef.current;
    if (res) {
      softDelete("held_orders", res);
      setHeldOrders((prev) => prev.filter((h) => h.id !== res));
      resumedHeldIdRef.current = null;
      tableTagRef.current = null;
    }
    // The bill is gone, so its discount goes with it.
    replaceEntries({}, null);
  }, [replaceEntries]);

  // --- Dine-in table tickets (stable identities) ---------------------------
  /** Load (or start) a table's running ticket as the active cart. */
  const openTableTicket = useCallback(
    (label: string) => {
      const existing = heldOrdersRef.current.find((h) => h.label === label);
      if (existing) {
        const marked: HeldOrder = { ...existing, resumedAt: Date.now() };
        dbPut("held_orders", marked);
        setHeldOrders((prev) => prev.map((h) => (h.id === existing.id ? marked : h)));
        const next: Record<string, CartEntry> = {};
        marked.entries.forEach((e) => {
          next[e.lineId] = e;
        });
        replaceEntries(next, marked.orderDiscount ?? null);
        resumedHeldIdRef.current = existing.id;
      } else {
        replaceEntries({}, null);
        resumedHeldIdRef.current = null;
      }
      tableTagRef.current = label;
    },
    [replaceEntries],
  );

  /**
   * Park the active cart back onto its table ticket and empty the cart. Called
   * when leaving a table with items still on it. An emptied-out ticket is
   * discarded instead — a table with nothing on it is free.
   */
  const saveTableTicket = useCallback(() => {
    const label = tableTagRef.current;
    const list = Object.values(entriesRef.current);
    const res = resumedHeldIdRef.current;

    if (!label || list.length === 0) {
      if (res) {
        softDelete("held_orders", res);
        setHeldOrders((prev) => prev.filter((h) => h.id !== res));
      }
      resumedHeldIdRef.current = null;
      tableTagRef.current = null;
      replaceEntries({}, null);
      return;
    }

    const now = Date.now();
    const prior = res ? heldOrdersRef.current.find((h) => h.id === res) : undefined;
    const parkedDiscount = orderDiscountRef.current;
    const held: HeldOrder = {
      id: res ?? `held_${now}_${Math.round(Math.random() * 1e4)}`,
      label,
      note: prior?.note,
      entries: list,
      itemCount: list.reduce((s, e) => s + e.qty, 0),
      total: summaryRef.current.total,
      currency: list[0]?.item.currency ?? "NGN",
      createdAt: prior?.createdAt ?? now,
      ...(parkedDiscount ? { orderDiscount: parkedDiscount } : {}),
    };
    dbPut("held_orders", held);
    setHeldOrders((prev) => [held, ...prev.filter((h) => h.id !== held.id)]);
    resumedHeldIdRef.current = null;
    tableTagRef.current = null;
    replaceEntries({}, null);
  }, [replaceEntries]);

  /** Leave the table for good: discard any open ticket and empty the cart. */
  const abandonTableTicket = useCallback(() => {
    const res = resumedHeldIdRef.current;
    if (res) {
      softDelete("held_orders", res);
      setHeldOrders((prev) => prev.filter((h) => h.id !== res));
    }
    resumedHeldIdRef.current = null;
    tableTagRef.current = null;
    replaceEntries({}, null);
  }, [replaceEntries]);

  const fast = useMemo<CartFast>(
    () => ({
      add,
      remove,
      clear,
      registerCatalog,
      openTableTicket,
      saveTableTicket,
      abandonTableTicket,
      setLineDiscount,
      setOrderDiscount,
      getOrderDiscount,
      subscribeToProduct,
      subscribeToCount,
      subscribeToLine,
      subscribeToLineIds,
      subscribeToSummary,
      getQtyOf,
      getCount,
      getLine,
      getLineIds,
      getSummary,
    }),
    [
      add,
      remove,
      clear,
      registerCatalog,
      openTableTicket,
      saveTableTicket,
      abandonTableTicket,
      setLineDiscount,
      setOrderDiscount,
      getOrderDiscount,
      subscribeToProduct,
      subscribeToCount,
      subscribeToLine,
      subscribeToLineIds,
      subscribeToSummary,
      getQtyOf,
      getCount,
      getLine,
      getLineIds,
      getSummary,
    ],
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

  // Latest held orders + the ticket currently loaded in the cart, readable
  // from stable callbacks (table tickets) without re-creating them.
  const heldOrdersRef = useRef(heldOrders);
  const resumedHeldIdRef = useRef<string | null>(null);
  const tableTagRef = useRef<string | null>(null);
  useEffect(() => {
    heldOrdersRef.current = heldOrders;
  }, [heldOrders]);

  // Open bills can be created on another till, so refresh after each sync.
  useEffect(() => {
    return onSynced(() => {
      setHeldOrders(loadAll<HeldOrder>("held_orders").sort((a, b) => b.createdAt - a.createdAt));
      setReceipts(loadAll<Receipt>("receipts").sort((a, b) => b.createdAt - a.createdAt));
    });
  }, []);

  const value = useMemo<CartState>(() => {
    const list = Object.values(entries);
    const priceOf = unitPriceOf;
    // Price the bill once: the aggregate feeds the totals, and the per-line
    // breakdown lets a receipt record exactly what each line paid.
    const totals = computeTotals(pricedLinesOf(entries), orderDiscount);
    const { count, subtotal, taxTotal, total, discountTotal } = totals;
    const breakdown = new Map(totals.lines.map((line) => [line.id, line]));
    return {
      entries,
      count,
      subtotal,
      taxTotal,
      total,
      orderDiscount,
      setLineDiscount,
      setOrderDiscount,
      qtyOf: (productId) =>
        list.reduce((sum, entry) => sum + (entry.item.id === productId ? entry.qty : 0), 0),
      add,
      remove,
      clear,
      openTableTicket,
      saveTableTicket,
      abandonTableTicket,

      heldOrders,
      holdOrder: (label, note, existingId) => {
        if (list.length === 0) return;
        const now = Date.now();
        // Editing the resumed bill consumes it; otherwise clear() below
        // auto-consumes whatever else was resumed (its items moved here).
        if (existingId && existingId === resumedHeldIdRef.current) {
          resumedHeldIdRef.current = null;
        }
        tableTagRef.current = null;
        const held: HeldOrder = {
          id: existingId ?? `held_${now}_${Math.round(Math.random() * 1e4)}`,
          label: label.trim() || "Open bill",
          note,
          entries: list,
          itemCount: list.reduce((s, e) => s + e.qty, 0),
          total,
          currency: list[0]?.item.currency ?? "NGN",
          createdAt: now,
          ...(orderDiscount ? { orderDiscount } : {}),
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
        // Mark resumed but KEEP the record until the cart is charged, re-held
        // or cleared — killing the app mid-edit no longer loses the ticket.
        const marked: HeldOrder = { ...held, resumedAt: Date.now() };
        dbPut("held_orders", marked);
        setHeldOrders((prev) => prev.map((h) => (h.id === id ? marked : h)));
        const next: Record<string, CartEntry> = {};
        marked.entries.forEach((e) => {
          next[e.lineId] = e;
        });
        replaceEntries(next, marked.orderDiscount ?? null);
        resumedHeldIdRef.current = id;
        tableTagRef.current = null;
      },
      discardHeldOrder: (id) => {
        if (resumedHeldIdRef.current === id) {
          resumedHeldIdRef.current = null;
          tableTagRef.current = null;
        }
        softDelete("held_orders", id);
        setHeldOrders((prev) => prev.filter((h) => h.id !== id));
      },

      settleReceipt: (id) => {
        const receipt = receipts.find((r) => r.id === id);
        if (!receipt || receipt.status === "paid") return;
        const settled: Receipt = {
          ...receipt,
          status: "paid",
          paidAt: Date.now(),
        };
        dbPut("receipts", settled);
        setReceipts((prev) => prev.map((r) => (r.id === id ? settled : r)));
        logAudit({
          action: "receipt.settle",
          entity: "receipt",
          entityId: id,
          summary: `Settled ${receipt.number} · ${formatMoney(receipt.total, receipt.currency)}`,
        });
      },

      receipts,
      completeSale: ({ mode, customerName, cashReceived, status, storeName, storeReference, servedBy }) => {
        const now = Date.now();
        const settled = status ?? "paid";
        /**
         * Invoice number: a per-device tag (1-9, chosen once per install)
         * prefixes a local sequence. Two tills can therefore never print the
         * same number for different sales — the old `1000 + length` scheme
         * collided as soon as two devices' receipt lists merged via sync.
         */
        const tagKey = "receipt_tag";
        let tag = Number(metaGet(tagKey) ?? "") || 0;
        if (tag < 1 || tag > 9) {
          tag = 1 + Math.floor(Math.random() * 9);
          metaSet(tagKey, String(tag));
        }
        const receipt: Receipt = {
          id: `rcpt_${now}`,
          number: `#${tag}${1000 + receipts.length + 1}`,
          customerName,
          mode,
          status: settled,
          itemCount: list.reduce((s, e) => s + e.qty, 0),
          total,
          currency: list[0]?.item.currency ?? "NGN",
          createdAt: now,
          synced: false,
          lines: list.map((entry) => {
            const line = breakdown.get(entry.lineId);
            return {
              productId: entry.item.id,
              variantId: entry.variant?.id,
              variantName: entry.variant?.name,
              name: displayItemName(entry.item.name, entry.variant?.name),
              qty: entry.qty,
              price: priceOf(entry),
              // Snapshot what this line actually paid. Returns refund from
              // `netTotal`, so a discounted sale can't be refunded at list price.
              ...(line && line.lineDiscount > 0 ? { discount: line.lineDiscount } : {}),
              ...(line && line.orderDiscountShare > 0
                ? { orderDiscountShare: line.orderDiscountShare }
                : {}),
              ...(line ? { netTotal: line.taxable } : {}),
            };
          }),
          ...(discountTotal > 0 ? { discountTotal } : {}),
          ...(orderDiscount ? { orderDiscount } : {}),
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
          summary:
            `Sale ${receipt.number} · ${receipt.itemCount} item${receipt.itemCount === 1 ? "" : "s"} · ${mode} · ${formatMoney(receipt.total, receipt.currency)}` +
            // Discounts are the classic till-fraud vector, so every discounted
            // sale names the amount and the reason in the audit trail.
            (discountTotal > 0
              ? ` · discount ${formatMoney(discountTotal, receipt.currency)}${orderDiscount?.reason ? ` (${orderDiscount.reason})` : ""}`
              : ""),
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
  }, [
    entries,
    orderDiscount,
    receipts,
    heldOrders,
    add,
    remove,
    clear,
    replaceEntries,
    setLineDiscount,
    setOrderDiscount,
    openTableTicket,
    saveTableTicket,
    abandonTableTicket,
  ]);

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

/** Subscribe only when cart lines are added, removed, cleared, or resumed. */
export function useCartLineIds(): readonly string[] {
  const ctx = useCartActions();
  return useSyncExternalStore(ctx.subscribeToLineIds, ctx.getLineIds);
}

/** Subscribe to one variant-safe cart line, not the entire cart. */
export function useCartLine(lineId: string): CartEntry | undefined {
  const ctx = useCartActions();
  const subscribe = useCallback(
    (listener: () => void) => ctx.subscribeToLine(lineId, listener),
    [ctx, lineId],
  );
  const getSnapshot = useCallback(() => ctx.getLine(lineId), [ctx, lineId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Subscribe to cached integer-money totals without rebuilding the cart list. */
export function useCartSummary(): CartSummary {
  const ctx = useCartActions();
  return useSyncExternalStore(ctx.subscribeToSummary, ctx.getSummary);
}

