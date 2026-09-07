import type { Item, Variant } from "./cart";

/** One independently tracked balance: either a simple item or one variant. */
export type StockTarget = {
  variantId?: string;
  name: string;
  quantity: number;
  price: number;
  autoUpdateStock: boolean;
  low: boolean;
  out: boolean;
};

/** Tracked balances only; untracked variants are deliberately excluded. */
export function stockTargetsOf(item: Item): StockTarget[] {
  if (item.variants?.length) {
    return item.variants.flatMap((variant: Variant) => {
      if (variant.stock == null) return [];
      const threshold = variant.lowStockAt ?? 3;
      return [
        {
          variantId: variant.id,
          name: variant.name,
          quantity: variant.stock,
          price: variant.price,
          autoUpdateStock: variant.autoUpdateStock,
          low: variant.lowStockAlert && variant.stock <= threshold,
          out: variant.stock <= 0,
        },
      ];
    });
  }

  if (item.stockQuantity == null) return [];
  return [
    {
      name: item.name,
      quantity: item.stockQuantity,
      price: item.price,
      autoUpdateStock: item.autoUpdateStock !== false,
      low: item.stockQuantity <= (item.lowStockAt ?? 3),
      out: item.stockQuantity <= 0,
    },
  ];
}

export type StockSummary = {
  targets: StockTarget[];
  totalQuantity: number;
  allOut: boolean;
  low: boolean;
  retailValue: number;
};

/** Product-level summary used by Inventory without pretending variants are untracked. */
export function stockSummaryOf(item: Item): StockSummary {
  const targets = stockTargetsOf(item);
  return {
    targets,
    totalQuantity: targets.reduce((sum, target) => sum + target.quantity, 0),
    allOut: targets.length > 0 && targets.every((target) => target.out),
    low: targets.some((target) => target.low || target.out),
    // Selling-price valuation. Each variant uses its own price; money remains
    // an integer number of minor units even when stock itself is fractional.
    retailValue: targets.reduce(
      (sum, target) => sum + Math.round(Math.max(0, target.quantity) * target.price),
      0,
    ),
  };
}

/** Avoid floating-point tails while preserving fractional Kg/Ltr quantities. */
export function formatStockQuantity(quantity: number): string {
  return String(Math.round(quantity * 1000) / 1000);
}

/** The tiny "12 left" caption shown on sale-mode item cards. */
export type StockHint = {
  label: string;
  /** At or under the low-stock threshold, so the caption can warn. */
  low: boolean;
};

/**
 * Remaining stock for an item card, or null when there's nothing honest to say.
 *
 * An untracked item has no balance to report, and an out-of-stock one is
 * already labelled OUT OF STOCK — repeating it as "0 left" would just be noise.
 * Variant items report the total of their *tracked* variants, matching how
 * Inventory counts them.
 */
export function stockHintOf(item: Item): StockHint | null {
  const { targets, totalQuantity, low } = stockSummaryOf(item);
  if (targets.length === 0 || totalQuantity <= 0) return null;
  return { label: `${formatStockQuantity(totalQuantity)} left`, low };
}

export function retailValueOf(quantity: number, price: number): number {
  return Math.round(Math.max(0, quantity) * price);
}
