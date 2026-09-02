import type { Receipt, ReceiptLine } from "./cart";

/**
 * Returns (refunds / credit notes) — types and money rules, with no React and
 * no runtime dependencies, so the print/share layer can use them without
 * dragging in providers.
 *
 * A return is its own append-only document that references the sale it reverses.
 * The original receipt is never rewritten, for three reasons:
 *
 *  1. It was printed and possibly shared as a PDF — it's a historical record.
 *  2. Partial returns accumulate: 2 of 5 units today, 1 more tomorrow.
 *  3. Sync is last-write-wins per document. Two tills editing the same receipt
 *     would silently drop one refund; two separate return documents both
 *     survive the merge.
 *
 * Everything a receipt screen needs about returns is therefore *derived* from
 * that receipt's returns (see `remainingByLine`, `returnStateOf`) rather than
 * denormalised onto the receipt.
 */

export type ReturnReason = "damaged" | "wrong_item" | "changed_mind" | "expired" | "other";

export const RETURN_REASONS: { key: ReturnReason; label: string }[] = [
  { key: "damaged", label: "Damaged / spoiled" },
  { key: "wrong_item", label: "Wrong item" },
  { key: "changed_mind", label: "Customer changed mind" },
  { key: "expired", label: "Expired" },
  { key: "other", label: "Other" },
];

/**
 * Reasons where the goods physically come back but must not go on the shelf, so
 * the restock toggles start OFF. The cashier can still override per line.
 */
export const NON_RESTOCK_REASONS: readonly ReturnReason[] = ["damaged", "expired"];

/** How the money went back to the customer. */
export type RefundMethod = "Cash" | "Transfer" | "Card reversal" | "Store credit" | "No refund";

export const REFUND_METHODS: readonly RefundMethod[] = [
  "Cash",
  "Transfer",
  "Card reversal",
  "Store credit",
  "No refund",
];

export type ReturnLine = {
  /**
   * Index into the original receipt's `lines`.
   *
   * Line identity is positional, not by product: `ReceiptLine.productId` is
   * optional (receipts raised from VIP web orders may not carry one), so
   * matching on product would break on exactly the receipts that matter most.
   */
  lineIndex: number;
  productId?: string;
  variantId?: string;
  variantName?: string;
  name: string;
  qty: number;
  /** Unit price copied from the original receipt line (integer minor units). */
  price: number;
  /**
   * Pre-tax value actually refunded for these units, after the discounts the
   * original sale carried. Absent on credit notes raised before discounts
   * existed, where `price × qty` was the refunded value.
   */
  net?: number;
  /** True when the units go back on the shelf; false = written off. */
  restock: boolean;
};

/** Pre-tax value refunded for one credit-note line. */
export function returnLineNetOf(line: ReturnLine): number {
  return line.net ?? line.price * line.qty;
}

export type SaleReturn = {
  id: string;
  /** Printable credit-note number, e.g. "R#1001". */
  number: string;
  receiptId: string;
  /** Denormalised so the credit note prints without loading the receipt. */
  receiptNumber: string;
  lines: ReturnLine[];
  itemCount: number;
  /** All money is integer minor units (kobo). */
  subtotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  reason: ReturnReason;
  note?: string;
  method: RefundMethod;
  createdAt: number;
  /** Snapshot of where/who, so a reprint is always accurate. */
  storeName: string;
  storeReference?: string;
  servedBy: string;
  synced: boolean;
};

/** A return that moved no money — an unpaid receipt being cancelled. */
export const isVoidReturn = (ret: SaleReturn): boolean => ret.method === "No refund";

/**
 * What a receipt line actually contributed to the pre-tax total.
 *
 * Discounted sales store `netTotal`; receipts raised before discounts existed
 * don't, and for those `price × qty` *is* the net by definition. Refunds are
 * always computed from this, never from the list price, so a 20%-off sale can
 * never be refunded at full value.
 */
export function lineNetOf(line: ReceiptLine): number {
  return line.netTotal ?? line.price * line.qty;
}

/** Pre-tax value of the receipt, after every discount. */
export function receiptNetOf(receipt: Receipt): number {
  return receipt.lines.reduce((sum, line) => sum + lineNetOf(line), 0);
}

/**
 * Pre-tax value of `qty` units of a line.
 *
 * Scaled from the line's net so discounts carry through proportionally. Integer
 * rounding here is deliberate and safe: the return that clears the last unit
 * absorbs whatever remainder is left (see `quoteReturn`).
 */
export function lineNetForQty(line: ReceiptLine, qty: number): number {
  if (line.qty <= 0 || qty <= 0) return 0;
  const net = lineNetOf(line);
  if (qty >= line.qty) return net;
  return Math.round((net * qty) / line.qty);
}

/** @deprecated Kept for older callers; prefer `receiptNetOf`. */
export function receiptSubtotalOf(receipt: Receipt): number {
  return receiptNetOf(receipt);
}

/**
 * Tax charged on the receipt.
 *
 * Receipts store only `total` and their lines — there is no per-line tax — so
 * tax is what's left once the discounted net is taken off the total.
 */
export function receiptTaxOf(receipt: Receipt): number {
  return Math.max(0, receipt.total - receiptNetOf(receipt));
}

/** Units already returned per receipt line index. */
export function returnedByLine(receipt: Receipt, priorReturns: readonly SaleReturn[]): number[] {
  const returned = new Array<number>(receipt.lines.length).fill(0);
  for (const ret of priorReturns) {
    for (const line of ret.lines) {
      if (line.lineIndex < 0 || line.lineIndex >= returned.length) continue;
      returned[line.lineIndex] = (returned[line.lineIndex] ?? 0) + line.qty;
    }
  }
  return returned;
}

/** Units of each receipt line that can still be returned. */
export function remainingByLine(receipt: Receipt, priorReturns: readonly SaleReturn[]): number[] {
  const returned = returnedByLine(receipt, priorReturns);
  return receipt.lines.map((line, index) => Math.max(0, line.qty - (returned[index] ?? 0)));
}

/** Money already refunded against a receipt. */
export function refundedTotalOf(priorReturns: readonly SaleReturn[]): number {
  return priorReturns.reduce((sum, ret) => sum + ret.total, 0);
}

export type ReturnState = "none" | "partial" | "full";

export function returnStateOf(receipt: Receipt, priorReturns: readonly SaleReturn[]): ReturnState {
  if (priorReturns.length === 0) return "none";
  const remaining = remainingByLine(receipt, priorReturns);
  return remaining.every((qty) => qty === 0) ? "full" : "partial";
}

/**
 * True when the returns on record add up to more than was sold.
 *
 * Two tills that were both offline can each refund the same receipt. The local
 * cap only sees what that device knows, so after a sync the collision has to be
 * visible to a manager rather than silently wrong.
 */
export function isOverReturned(receipt: Receipt, priorReturns: readonly SaleReturn[]): boolean {
  const returned = returnedByLine(receipt, priorReturns);
  if (receipt.lines.some((line, index) => (returned[index] ?? 0) > line.qty)) return true;
  return refundedTotalOf(priorReturns) > receipt.total;
}

export type ReturnSelection = { lineIndex: number; qty: number };

export type ReturnQuote = {
  itemCount: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  /** True when this return clears the last returnable unit on the receipt. */
  final: boolean;
};

const EMPTY_QUOTE: ReturnQuote = {
  itemCount: 0,
  subtotal: 0,
  taxTotal: 0,
  total: 0,
  final: false,
};

/**
 * What a set of selected lines is worth as a refund.
 *
 * Values come from the original receipt's *discounted* line net, never from the
 * product today, so neither a later menu price change nor a discount given at
 * the till can distort an old refund — a 20%-off sale refunds 20% less. Tax is
 * refunded pro-rata by value; the return that clears the last unit absorbs the
 * rounding remainder so a receipt refunded across several partial returns gives
 * back exactly what was charged — never a kobo more or less.
 */
export function quoteReturn(
  receipt: Receipt,
  selections: readonly ReturnSelection[],
  priorReturns: readonly SaleReturn[],
): ReturnQuote {
  const remaining = remainingByLine(receipt, priorReturns);

  let itemCount = 0;
  let selectedSubtotal = 0;
  const selectedByLine = new Array<number>(receipt.lines.length).fill(0);

  for (const selection of selections) {
    const line = receipt.lines[selection.lineIndex];
    if (!line) continue;
    const cap = remaining[selection.lineIndex] ?? 0;
    const already = selectedByLine[selection.lineIndex] ?? 0;
    const qty = Math.min(Math.max(0, Math.trunc(selection.qty)), Math.max(0, cap - already));
    if (qty <= 0) continue;
    selectedByLine[selection.lineIndex] = already + qty;
    itemCount += qty;
  }

  // Value each line once, from its post-discount net, using the *total* qty
  // selected for it — scaling per selection would round more than once.
  for (const [index, qty] of selectedByLine.entries()) {
    const line = receipt.lines[index];
    if (!line || qty <= 0) continue;
    selectedSubtotal += lineNetForQty(line, qty);
  }

  if (itemCount === 0) return EMPTY_QUOTE;

  const priorSubtotal = priorReturns.reduce((sum, ret) => sum + ret.subtotal, 0);
  const priorTax = priorReturns.reduce((sum, ret) => sum + ret.taxTotal, 0);
  const priorTotal = refundedTotalOf(priorReturns);
  const refundable = Math.max(0, receipt.total - priorTotal);

  const final = remaining.every((qty, index) => qty - (selectedByLine[index] ?? 0) === 0);

  if (final) {
    // Absorb any pro-rata rounding drift left by earlier partial returns.
    const subtotal = Math.max(0, receiptNetOf(receipt) - priorSubtotal);
    const taxTotal = Math.max(0, receiptTaxOf(receipt) - priorTax);
    return { itemCount, subtotal, taxTotal, total: Math.min(refundable, subtotal + taxTotal), final };
  }

  const receiptNet = receiptNetOf(receipt);
  const taxTotal =
    receiptNet > 0 ? Math.round((receiptTaxOf(receipt) * selectedSubtotal) / receiptNet) : 0;
  return {
    itemCount,
    subtotal: selectedSubtotal,
    taxTotal,
    total: Math.min(refundable, selectedSubtotal + taxTotal),
    final,
  };
}

/** Human label for a reason key. */
export function reasonLabel(reason: ReturnReason): string {
  return RETURN_REASONS.find((r) => r.key === reason)?.label ?? "Other";
}
