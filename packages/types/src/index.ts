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

export interface ProductVariant {
  id: ID;
  name: string;
  color: string;
  price: Money;
  cost?: Money;
  /** Undefined means this variant is not stock-tracked. */
  stock?: number;
  trackProfit: boolean;
  lowStockAlert: boolean;
  lowStockAt?: number;
  autoUpdateStock: boolean;
  barcodeOn: boolean;
  barcode?: string;
  expiryOn: boolean;
  expiry?: string;
  taxOn: boolean;
  taxPercent?: number;
  taxInclusive?: boolean;
  notesOn: boolean;
  notes?: string;
  modifiersOn: boolean;
  modifierIds: ID[];
  recipeOn: boolean;
  spacesOn: boolean;
  tagsOn: boolean;
  tags?: string;
  compareOn: boolean;
  comparePrice?: Money;
  skuOn: boolean;
  sku?: string;
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
  /** Warn when simple-product stock reaches this quantity. */
  lowStockAt?: number;
  /** Simple products decrement stock on sale unless explicitly disabled. */
  autoUpdateStock?: boolean;
  /** When present, the base product is not directly sellable. */
  variants?: ProductVariant[];
  taxRateBps?: number; // tax rate in basis points (e.g. 750 = 7.5%)
  imageUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Why a tracked product or variant changed quantity. */
export type StockMovementReason =
  | "sale"
  | "adjustment"
  | "initial"
  | "restock"
  | "return"
  | "waste";

/**
 * Append-only inventory operation. The product document stores the materialized
 * balance; this record explains how that balance changed and is the authority
 * used by the Store Durable Object when devices sync concurrently.
 */
export interface StockMovement {
  id: ID;
  productId: ID;
  productName: string;
  variantId?: ID;
  variantName?: string;
  reason: StockMovementReason;
  /** Actual signed change applied, e.g. -2 for a sale or +10 for a delivery. */
  delta: number;
  /** Balance after this operation. Corrected by the server when necessary. */
  resulting: number;
  /** Client-observed balance before the operation. */
  baseStock?: number;
  /** Original requested delta when the server had to clamp/correct `delta`. */
  requestedDelta?: number;
  /** Optional sale-automation setting applied to the same stock target. */
  autoUpdateStock?: boolean;
  /** Event time in milliseconds since epoch. */
  at: number;
  /** Optional receipt, return, or integration reference. */
  ref?: string;
  /** Optional human explanation for a manual movement. */
  note?: string;
  /** Actor snapshot retained even if the staff account later changes. */
  actorId?: ID;
  actorName?: string;
  actorEmail?: string;
  actorRole?: StoreRole;
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
  variantId?: ID;
  variantName?: string;
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

export type StaffRole = "owner" | "manager" | "supervisor" | "cashier";

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
  "returns",
  "stock_movements",
  "product_images",
  "web_orders",
  "audit_log",
  "held_orders",
] as const;

export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

/**
 * An audit trail entry: who did what, when. Append-only and attributed to the
 * signed-in staff member. Synced like any other collection so every device (and
 * the owner's other locations) sees the same history.
 */
export interface AuditEntry {
  id: ID;
  /** Event time, ms since epoch. */
  at: number;
  /** Acting user. */
  actorId: ID;
  actorName: string;
  actorRole: StoreRole;
  /** Machine action key, e.g. "sale.complete", "product.update". */
  action: string;
  /** Entity kind touched, e.g. "receipt", "product", "staff". */
  entity: string;
  entityId?: ID;
  /** Human-readable one-line description shown in the log. */
  summary: string;
}

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
 * A server-authored change returned by pull (including the download half of a
 * push). `serverSeq` is never accepted from clients; it is the store Durable
 * Object's authoritative ordering key for classifying replay rows.
 */
export interface SyncPullChange extends SyncChange {
  serverSeq: number;
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
  changes: SyncPullChange[];
  /** New high-water mark for the device to persist and send next time. */
  cursor: number;
  /**
   * The store's current head sequence, sent on every response so a device can
   * detect that its own cursor points PAST the store's history — which happens
   * when the server's oplog was rebuilt (e.g. after a Durable Object storage
   * reset). Without this, such a device is permanently deaf: it asks for
   * "everything after N" on a server whose head never reaches N again.
   */
  head: number;
}

// ---------------------------------------------------------------------------
// Store registry (control plane)
// ---------------------------------------------------------------------------

// Extensionless so both Metro (mobile) and the Worker bundler resolve it.
import { roleCan, type Permission, type StoreRole } from "./permissions";
export * from "./permissions";
export * from "./web-order";
export * from "./integration";

/** Bump whenever collection visibility semantics change. */
export const SYNC_READ_POLICY_VERSION = 2;

/**
 * Collection-level projection shared by the Worker and every offline device.
 * A collection is readable when the role has any listed permission.
 */
const SYNC_READ_PERMISSIONS = {
  products: ["catalog:read"],
  categories: ["catalog:read"],
  modifiers: ["catalog:read"],
  ingredients: ["catalog:read"],
  tables: ["tables:manage"],
  customers: ["customers:manage"],
  staff: ["staff:manage"],
  receipts: ["receipts:view", "reports:view"],
  returns: ["receipts:view", "reports:view"],
  stock_movements: ["inventory:adjust"],
  product_images: ["catalog:read"],
  web_orders: ["sale:create", "kitchen:view"],
  audit_log: ["audit:view"],
  held_orders: ["sale:create"],
} as const satisfies Record<SyncCollection, readonly Permission[]>;

/** Unknown collection names fail closed. */
export function roleCanReadSyncCollection(
  role: StoreRole | null | undefined,
  collection: string,
): boolean {
  const required = SYNC_READ_PERMISSIONS[collection as SyncCollection];
  return !!required && required.some((permission) => roleCan(role, permission));
}

/** Stable collection order makes the persisted mobile projection deterministic. */
export function readableSyncCollections(role: StoreRole): readonly SyncCollection[] {
  return SYNC_COLLECTIONS.filter((collection) =>
    roleCanReadSyncCollection(role, collection),
  );
}

/** A store the signed-in user belongs to, with their role in it. */
export interface StoreMembership {
  id: ID;
  name: string;
  currency: CurrencyCode;
  role: StoreRole;
}

/**
 * The business profile behind a store: what gets printed on receipts and shown
 * to customers. Editable by the owner in Business Settings.
 */
export interface StoreProfile {
  id: ID;
  name: string;
  currency: CurrencyCode;
  address: string | null;
  phone: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
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
