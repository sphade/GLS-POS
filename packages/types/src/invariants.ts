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
 * Both require every identity field to be identical. A changed total, line
 * list, discount, number or timestamp is refused: that is a rewrite of money
 * that has already been reported, and it is indistinguishable, in the data,
 * from a sale that was never recorded.
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
    (field) => JSON.stringify(before[field]) === JSON.stringify(after[field]),
  );
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
