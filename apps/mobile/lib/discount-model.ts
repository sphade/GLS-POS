/**
 * Discounts — types and money rules, with no React and no runtime dependencies
 * so the cart, the printers and the returns engine can all share one authority.
 *
 * Two levels, both optional and stackable:
 *  - line  → applied to one cart line ("10% off this pizza")
 *  - order → applied to the whole bill ("₦500 off", "5% staff discount")
 *
 * Discount comes off the net, and tax is then charged on what the customer
 * actually pays. Because GLS-POS taxes each line at its own rate, an order-level
 * discount must be split back across the lines before tax can be computed — a
 * bill mixing a 7.5% item with a 0% item cannot be taxed correctly otherwise.
 * That split is integer-exact (see `prorate`), so the shares always add up to
 * the discount, never a kobo more or less.
 */

export type DiscountType = "percent" | "fixed";

export type Discount = {
  type: DiscountType;
  /**
   * `percent` → basis points, so 10% is 1000 and everything stays integer.
   * `fixed`   → integer minor units (kobo).
   */
  value: number;
  /** Why it was given. Kept for the audit trail and printed on the slip. */
  reason?: string;
};

/** 10% → 1000 bps. Clamped to a sane range. */
export const percentToBps = (percent: number): number =>
  Math.max(0, Math.min(10_000, Math.round(percent * 100)));

/** 1000 bps → 10. */
export const bpsToPercent = (bps: number): number => Math.round(bps) / 100;

/** How a discount reads on screen and on a printed slip. */
export function discountLabel(discount: Discount): string {
  return discount.type === "percent" ? `${bpsToPercent(discount.value)}%` : "Fixed";
}

/**
 * What a discount is worth against `base`.
 *
 * Always clamped to `[0, base]`: a discount can never exceed what's being
 * discounted, so a line or a bill can never go negative.
 */
export function discountAmount(discount: Discount | null | undefined, base: number): number {
  if (!discount || base <= 0) return 0;
  const raw =
    discount.type === "percent"
      ? Math.round((base * Math.max(0, discount.value)) / 10_000)
      : Math.max(0, Math.round(discount.value));
  return Math.max(0, Math.min(base, raw));
}

/**
 * Split `total` across `weights` so the parts sum to exactly `total` and no
 * part exceeds its own weight.
 *
 * Largest-remainder: floor every share, then hand out the leftover units to the
 * biggest fractional parts first. Used to push an order-level discount back
 * onto the lines it came from.
 */
export function prorate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + Math.max(0, weight), 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);

  const capped = Math.min(total, sum);
  const shares = weights.map((weight) => Math.floor((capped * Math.max(0, weight)) / sum));
  let remainder = capped - shares.reduce((acc, share) => acc + share, 0);

  const byFraction = weights
    .map((weight, index) => ({
      index,
      fraction: (capped * Math.max(0, weight)) % sum,
    }))
    .sort((a, b) => b.fraction - a.fraction);

  for (const { index } of byFraction) {
    if (remainder <= 0) break;
    if ((shares[index] ?? 0) < Math.max(0, weights[index] ?? 0)) {
      shares[index] = (shares[index] ?? 0) + 1;
      remainder -= 1;
    }
  }
  return shares;
}

/** One priced line, independent of how the cart stores it. */
export type PricedLine = {
  /** Stable identity — a cart line id, or a receipt line index as a string. */
  id: string;
  unitPrice: number;
  qty: number;
  taxRateBps: number;
  discount?: Discount | null;
};

export type LineBreakdown = {
  id: string;
  /** unitPrice × qty, before any discount. */
  gross: number;
  /** This line's own discount. */
  lineDiscount: number;
  /** gross − lineDiscount. */
  net: number;
  /** This line's share of the order-level discount. */
  orderDiscountShare: number;
  /** What tax is charged on: net − orderDiscountShare. */
  taxable: number;
  tax: number;
  /** taxable + tax. */
  total: number;
};

export type Totals = {
  count: number;
  /** Σ gross — the undiscounted value of the bill. */
  gross: number;
  lineDiscountTotal: number;
  orderDiscountTotal: number;
  /** lineDiscountTotal + orderDiscountTotal. */
  discountTotal: number;
  /** Σ taxable — the pre-tax value actually being charged. */
  subtotal: number;
  taxTotal: number;
  /** subtotal + taxTotal. */
  total: number;
  lines: LineBreakdown[];
};

export const EMPTY_TOTALS: Totals = {
  count: 0,
  gross: 0,
  lineDiscountTotal: 0,
  orderDiscountTotal: 0,
  discountTotal: 0,
  subtotal: 0,
  taxTotal: 0,
  total: 0,
  lines: [],
};

/**
 * Price a whole bill: line discounts first, then the order discount prorated
 * across what's left, then tax per line on the discounted base.
 */
export function computeTotals(
  lines: readonly PricedLine[],
  orderDiscount?: Discount | null,
): Totals {
  if (lines.length === 0) {
    // Still honour a fixed order discount of 0 — an empty bill is simply free.
    return EMPTY_TOTALS;
  }

  let count = 0;
  let gross = 0;
  let lineDiscountTotal = 0;

  const staged = lines.map((line) => {
    const lineGross = Math.max(0, line.unitPrice * line.qty);
    const lineDiscount = discountAmount(line.discount, lineGross);
    const net = lineGross - lineDiscount;
    count += line.qty;
    gross += lineGross;
    lineDiscountTotal += lineDiscount;
    return { line, gross: lineGross, lineDiscount, net };
  });

  const netSum = staged.reduce((acc, entry) => acc + entry.net, 0);
  const orderDiscountTotal = discountAmount(orderDiscount, netSum);
  const shares = prorate(
    orderDiscountTotal,
    staged.map((entry) => entry.net),
  );

  let subtotal = 0;
  let taxTotal = 0;
  const breakdown: LineBreakdown[] = staged.map((entry, index) => {
    const orderDiscountShare = shares[index] ?? 0;
    const taxable = Math.max(0, entry.net - orderDiscountShare);
    const tax = Math.round((taxable * Math.max(0, entry.line.taxRateBps)) / 10_000);
    subtotal += taxable;
    taxTotal += tax;
    return {
      id: entry.line.id,
      gross: entry.gross,
      lineDiscount: entry.lineDiscount,
      net: entry.net,
      orderDiscountShare,
      taxable,
      tax,
      total: taxable + tax,
    };
  });

  return {
    count,
    gross,
    lineDiscountTotal,
    orderDiscountTotal,
    discountTotal: lineDiscountTotal + orderDiscountTotal,
    subtotal,
    taxTotal,
    total: subtotal + taxTotal,
    lines: breakdown,
  };
}

/** Preset percentages offered in the discount sheet. */
export const DISCOUNT_PRESETS_BPS: readonly number[] = [500, 1000, 1500, 2000, 5000];
