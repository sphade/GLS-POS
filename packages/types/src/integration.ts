/**
 * Public integration API (v1) — the contract external systems code against.
 *
 * Aimed at delivery apps, marketplaces and dashboards that need to read the
 * menu, know what's in stock, react when something sells out, and push a small
 * amount of data back (stock adjustments, incoming orders).
 *
 * Deliberately a *separate, stable surface* from the internal sync protocol:
 * sync can change shape as the app evolves, this cannot.
 */

/** Capabilities an API key can be granted. Least privilege by default. */
export type ApiScope =
  | "catalog:read"
  | "stock:read"
  | "stock:write"
  | "orders:read"
  | "orders:write"
  | "events:read";

export const ALL_API_SCOPES: readonly ApiScope[] = [
  "catalog:read",
  "stock:read",
  "stock:write",
  "orders:read",
  "orders:write",
  "events:read",
];

/** Stock state, pre-computed so integrators don't reimplement the rules. */
export type StockState = "in_stock" | "low_stock" | "out_of_stock" | "untracked";

export interface ApiProduct {
  id: string;
  name: string;
  /** Integer minor units (kobo). */
  price: number;
  currency: string;
  categoryId?: string;
  categoryName?: string;
  sku?: string;
  barcode?: string;
  /** null when the item isn't stock-tracked. */
  stock: number | null;
  /** Threshold at or below which `low_stock` is reported. */
  lowStockAt?: number;
  stockState: StockState;
  /** Convenience: false when out of stock. */
  available: boolean;
  updatedAt: number;
}

export interface ApiCategory {
  id: string;
  name: string;
  productCount: number;
}

/** Compact stock row, for integrators that only sync availability. */
export interface ApiStockLevel {
  productId: string;
  name: string;
  stock: number | null;
  stockState: StockState;
  available: boolean;
}

/** A stock change requested by an external system. */
export interface ApiStockAdjustment {
  productId: string;
  /** Signed change, e.g. -2 sold elsewhere, +10 delivery received. */
  delta?: number;
  /** Absolute set; used when `delta` is absent. */
  stock?: number;
  reason?: "restock" | "adjustment" | "sale" | "waste";
  note?: string;
}

// ---------------------------------------------------------------------------
// Events (polled or delivered by webhook)
// ---------------------------------------------------------------------------

export type ApiEventType =
  | "product.created"
  | "product.updated"
  | "product.deleted"
  | "stock.changed"
  | "stock.low"
  | "stock.out"
  | "stock.replenished"
  | "order.created"
  | "order.updated";

export interface ApiEvent<T = unknown> {
  /** Monotonic per-store sequence — use as the polling cursor. */
  seq: number;
  type: ApiEventType;
  occurredAt: number;
  storeId: string;
  data: T;
}

/** Payload for the stock.* family. */
export interface StockEventData {
  productId: string;
  name: string;
  stock: number | null;
  previousStock: number | null;
  lowStockAt?: number;
  stockState: StockState;
}

export interface ApiEventPage {
  events: ApiEvent[];
  /** Pass back as `?since=` to continue. */
  cursor: number;
  hasMore: boolean;
}

/** Standard paginated envelope for list endpoints. */
export interface ApiPage<T> {
  data: T[];
  cursor: number;
  hasMore: boolean;
}
