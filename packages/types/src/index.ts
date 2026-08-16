/**
 * GLS-POS shared domain types.
 *
 * The model is intentionally *channel-agnostic*: every sale, whether it comes
 * from in-store checkout, phone, or a delivery marketplace, becomes an `Order`
 * against the same catalog and inventory. This mirrors how real POS systems
 * (Square, Toast) treat the POS as the single source of truth and marketplaces
 * as just another `OrderChannel`.
 */

export type ID = string;

/** ISO 4217 currency code, e.g. "USD", "NGN", "EUR". */
export type CurrencyCode = string;

/** Monetary amounts are stored as integer minor units (e.g. cents) to avoid float errors. */
export type Money = number;

// ---------------------------------------------------------------------------
// Catalog & inventory
// ---------------------------------------------------------------------------

export interface Category {
  id: ID;
  storeId: ID;
  name: string;
  color?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: ID;
  storeId: ID;
  categoryId?: ID;
  name: string;
  sku?: string;
  barcode?: string;
  price: Money;
  cost?: Money;
  currency: CurrencyCode;
  /** null = not stock-tracked (Zobaze-style "sell without stock"). */
  stockQuantity: number | null;
  taxRateBps?: number; // tax rate in basis points (e.g. 750 = 7.5%)
  imageUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Orders (channel-agnostic)
// ---------------------------------------------------------------------------

export type OrderChannel = "in_store" | "phone" | "delivery" | "online";

export type OrderStatus =
  | "open"
  | "completed"
  | "refunded"
  | "cancelled";

export type PaymentMethod = "cash" | "card" | "wallet" | "transfer" | "other";

export interface OrderItem {
  id: ID;
  productId?: ID;
  name: string;
  unitPrice: Money;
  quantity: number;
  taxRateBps?: number;
  /** line total in minor units, after quantity, before order-level discounts. */
  lineTotal: Money;
}

export interface Payment {
  id: ID;
  method: PaymentMethod;
  amount: Money;
  reference?: string;
  createdAt: string;
}

export interface Order {
  id: ID;
  storeId: ID;
  channel: OrderChannel;
  status: OrderStatus;
  items: OrderItem[];
  payments: Payment[];
  currency: CurrencyCode;
  subtotal: Money;
  taxTotal: Money;
  discountTotal: Money;
  grandTotal: Money;
  customerId?: ID;
  staffId?: ID;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type StaffRole = "owner" | "manager" | "cashier";

export interface Staff {
  id: ID;
  storeId: ID;
  name: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: ID;
  storeId: ID;
  name: string;
  phone?: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Store {
  id: ID;
  name: string;
  currency: CurrencyCode;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Offline-first sync protocol
// ---------------------------------------------------------------------------

/**
 * The set of per-store collections that sync between the device's local SQLite
 * and the store's Durable Object. Kept as opaque JSON documents on the wire so
 * the sync engine never needs to know each collection's exact shape.
 */
export const SYNC_COLLECTIONS = [
  "products",
  "categories",
  "modifiers",
  "ingredients",
  "tables",
  "customers",
  "staff",
  "receipts",
  "stock_movements",
] as const;

export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

/**
 * A single document change moving in either direction. `updatedAt` is the
 * client wall-clock (ms) used as the last-write-wins clock; `deleted` carries
 * tombstones so removals propagate.
 */
export interface SyncChange {
  collection: SyncCollection;
  id: ID;
  data: unknown;
  updatedAt: number;
  deleted: boolean;
}

/**
 * Push request: the device's current high-water `cursor` (the largest server
 * sequence it has already pulled) plus every locally-dirty change. The response
 * doubles as a pull, returning everything the store has seen since `cursor`.
 */
export interface SyncPushRequest {
  cursor: number;
  changes: SyncChange[];
}

export interface SyncPullResponse {
  /** Changes the store recorded with a sequence greater than the request cursor. */
  changes: SyncChange[];
  /** New high-water mark for the device to persist and send next time. */
  cursor: number;
}

// ---------------------------------------------------------------------------
// Store registry (control plane)
// ---------------------------------------------------------------------------

import type { StoreRole } from "./permissions.js";
export * from "./permissions.js";

/** A store the signed-in user belongs to, with their role in it. */
export interface StoreMembership {
  id: ID;
  name: string;
  currency: CurrencyCode;
  role: StoreRole;
}

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export interface ApiError {
  code: string;
  message: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };
