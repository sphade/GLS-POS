/**
 * The rules that decide whether the books stay consistent.
 *
 * These live here, as plain functions with no imports, for one reason: they are
 * the parts that must be *provably* right, and they are the parts a till, a
 * server and a test can all call. Anything with I/O stays in its owner (the
 * store Durable Object or the device database).
 *
 * Money is always integer minor units (kobo). Stock is a number that may be
 * fractional for weighed goods.
 */

/**
 * Apply a signed stock delta to a tracked balance.
 *
 * Two things matter and both have bitten this shop before:
 *
 *  - the balance never goes below zero, so a sale that arrives after the same
 *    item was already sold out does not create negative stock;
 *  - the movement records the delta that was *actually* applied, not the one
 *    the device asked for. Before this, a clamped movement still claimed its
 *    full requested delta, so the ledger and the balance disagreed and the
 *    history could not explain the difference.
 *
 * `precision` is 1000 for weighed goods (three decimals) and 1 for units, so a
 * half-gram of rounding never accumulates into a visible error.
 */
export function applyStockDelta(
  base: number,
  delta: number,
  precision = 1,
): { resulting: number; actualDelta: number } {
  const round = (value: number) => Math.round(value * precision) / precision;
  const resulting = round(Math.max(0, base + delta));
  return { resulting, actualDelta: round(resulting - base) };
}

/**
 * Fields that make a receipt what it is.
 *
 * A device may flip an unpaid bill to paid. It may not change any of these:
 * every one of them is either money that has already been reported, or the
 * identity that ties the report back to the document.
 */
export const RECEIPT_IDENTITY_FIELDS = [
  "id",
  "number",
  "total",
  "currency",
  "itemCount",
  "createdAt",
  "customerName",
  "mode",
  "storeName",
  "storeReference",
  "servedBy",
  "discountTotal",
  "orderDiscount",
  "lines",
  "cashReceived",
] as const;

/**
 * True when a stored receipt may accept this update.
 *
 * Receipts are append-only once stored. Two things are allowed, and nothing
 * else:
 *
 *  - an **idempotent re-send** — the same receipt arriving again after its
 *    acknowledgement was lost. Refusing this would leave a paid sale pending on
 *    a till forever, which is what the reconciliation screen exists to prevent.
 *  - an **unpaid → paid settlement**.
 *
 * Both require every identity field to match except `createdAt`. That one field
 * is deliberately outside the comparison: the server re-dates a sale made on a
 * till with a wrong clock, and a device that lost that response still holds the
 * uncorrected copy. Comparing it would leave such a bill unsettleable forever.
 * The caller must therefore **pin `createdAt` to the stored value** when it
 * applies the update — see `StoreDurableObject.push` — so a settlement can
 * never move money to another trading day.
 */
export function isReceiptUpdateAllowed(previous: unknown, next: unknown): boolean {
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) return false;
  if (!next || typeof next !== "object" || Array.isArray(next)) return false;
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const statusAllowed =
    before.status === after.status ||
    (before.status === "unpaid" && after.status === "paid");
  if (!statusAllowed) return false;
  return RECEIPT_IDENTITY_FIELDS.every(
    (field) =>
      field === "createdAt" ||
      JSON.stringify(before[field]) === JSON.stringify(after[field]),
  );
}

/** One applied movement, as much as the chain check needs to know. */
export type StockStep = {
  id: string;
  /** Balance this movement started from. */
  baseStock?: number;
  /** Balance it left behind. */
  resulting?: number;
  /** When the till said it happened. */
  at?: number;
};

/**
 * Where a stock history stops adding up.
 *
 * Each movement records the balance it started from and the balance it left, so
 * consecutive movements must chain: the next one starts exactly where the last
 * one ended. When it does not, stock moved with no movement to explain it — the
 * "sales and stock don't match" complaint.
 *
 * Neither of the other checks can see this. Every row adds up on its own
 * (`baseStock + delta = resulting`), and the deltas still sum to the balance;
 * the only evidence is the join between one row and the next.
 *
 * `steps` must be in the order the store *applied* them — its own sequence, not
 * the phones' clocks, which can be minutes or days out and are the reason two
 * rows for the same minute can appear in either order.
 */
export function stockChainGaps(steps: readonly StockStep[]): {
  movementId: string;
  expected: number;
  actual: number;
  gap: number;
  at: number;
}[] {
  const gaps: {
    movementId: string;
    expected: number;
    actual: number;
    gap: number;
    at: number;
  }[] = [];
  let previous: number | undefined;

  for (const step of steps) {
    const base = typeof step.baseStock === "number" && Number.isFinite(step.baseStock)
      ? step.baseStock
      : undefined;
    const result = typeof step.resulting === "number" && Number.isFinite(step.resulting)
      ? step.resulting
      : undefined;

    if (base !== undefined && previous !== undefined && Math.abs(base - previous) > 1e-6) {
      gaps.push({
        movementId: step.id,
        expected: previous,
        actual: base,
        gap: Math.round((base - previous) * 1000) / 1000,
        at: typeof step.at === "number" && Number.isFinite(step.at) ? step.at : 0,
      });
    }

    // A row with no recorded result leaves nothing to compare the next row
    // against: start a fresh segment rather than invent a break.
    previous = result;
  }

  return gaps;
}

/** One unsent local stock movement awaiting upload to the store. */
export type PendingStockDelta = {
  productId: string;
  variantId?: string;
  delta: number;
};

/**
 * Overlay unsent local stock movements onto a server-authoritative product.
 *
 * When a background pull arrives while this till still has unuploaded restocks
 * or sales (`stock_movements.dirty = 1`), writing the server's older balance
 * straight to SQLite makes the staff member's just-added stock appear to vanish
 * — causing them to re-enter the restock and double-count it once both uploads
 * land. Re-applying pending local deltas on top of the server's balance keeps
 * the screen truthful; the moment those movements are acknowledged (`dirty = 0`),
 * the overlay becomes empty and every till converges on the exact server number.
 */
export function overlayPendingStock<
  T extends {
    id: string;
    sellBy?: string;
    stockQuantity?: number | null;
    variants?: Array<{ id: string; stock?: number | null } & Record<string, unknown>>;
  },
>(product: T, pending: readonly PendingStockDelta[]): T {
  const relevant = pending.filter(
    (m) => m.productId === product.id && Number.isFinite(m.delta) && m.delta !== 0,
  );
  if (relevant.length === 0) return product;

  const precision = product.sellBy === "fraction" ? 1000 : 1;
  let stockQuantity = product.stockQuantity;
  let variants = product.variants ? product.variants.map((v) => ({ ...v })) : undefined;
  let changed = false;

  for (const m of relevant) {
    if (m.variantId) {
      if (!variants) continue;
      const target = variants.find((v) => v.id === m.variantId);
      if (!target || typeof target.stock !== "number") continue;
      const next = applyStockDelta(target.stock, m.delta, precision).resulting;
      if (next !== target.stock) {
        target.stock = next;
        changed = true;
      }
    } else if (typeof stockQuantity === "number") {
      const next = applyStockDelta(stockQuantity, m.delta, precision).resulting;
      if (next !== stockQuantity) {
        stockQuantity = next;
        changed = true;
      }
    }
  }

  if (!changed) return product;
  return {
    ...product,
    stockQuantity,
    ...(variants ? { variants } : {}),
  };
}

/** The ownership half of an open table ticket. */
export type TicketLease = {
  claimedBy?: string;
  claimedUntil?: number;
};

/**
 * Who may edit a table's open bill right now.
 *
 * - `"free"`   — nobody is holding it (or the lease expired)
 * - `"mine"`   — this till already holds it and may keep working
 * - `"leased"` — another till holds a live lease
 *
 * A lease exists because two tills on one table each save their own copy of the
 * bill, and one set of items always disappears. It expires, so a flat battery
 * or a crashed app frees the table in minutes instead of locking it for the
 * evening.
 */
export function ticketClaimState(
  ticket: TicketLease | null | undefined,
  deviceId: string,
  now: number,
): "free" | "mine" | "leased" {
  const holder = ticket?.claimedBy;
  if (typeof holder !== "string" || !holder) return "free";
  if (holder === deviceId) return "mine";
  const until = ticket?.claimedUntil;
  if (typeof until !== "number" || !Number.isFinite(until)) return "free";
  return until > now ? "leased" : "free";
}
