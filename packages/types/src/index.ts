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
  /** Ingredients used per one unit sold. Deducted by the server on each sale. */
  recipe?: RecipeLine[];
  taxRateBps?: number; // tax rate in basis points (e.g. 750 = 7.5%)
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
  | "waste"
  /** Input product consumed by a production run. */
  | "production_out"
  /** Output product created by a production run. */
  | "production_in";

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
// Ingredients & central stock
// ---------------------------------------------------------------------------

/**
 * Base units for raw stock. Quantities are always whole numbers in these units
 * (2.5 kg is stored as 2500 g), so no stock figure is ever a float.
 */
export type IngredientUnit = "g" | "ml" | "pcs";

export const INGREDIENT_UNITS: readonly IngredientUnit[] = ["g", "ml", "pcs"];

/**
 * A raw stock item held by one store: rice, flour, oil, cups. Lives in that
 * store's Durable Object. The central store and every branch use the same shape.
 * `stock` is materialized by the server from `ingredient_movements` only.
 */
export interface Ingredient {
  id: ID;
  name: string;
  unit: IngredientUnit;
  /** Whole base units on hand. Server-authoritative. */
  stock: number;
  /** Alert when stock is at or below this many base units. */
  lowAt: number;
  /** Optional display pack, e.g. "Bag" of 50000 g. Display only. */
  packName?: string;
  packSize?: number;
  /** For a branch copy created by a transfer: the central ingredient it mirrors. */
  sourceIngredientId?: ID;
  sourceStoreId?: ID;
  /** Hidden from lists but kept so history still resolves. Never hard-deleted. */
  archived?: boolean;
}

/** One ingredient used by a recipe, in the ingredient's base unit. */
export interface RecipeLine {
  ingredientId: ID;
  /** Whole base units consumed per one unit sold/made. */
  qty: number;
}

export type IngredientMovementReason =
  | "initial"
  | "restock"
  | "adjustment"
  | "waste"
  /** Consumed by a sale or a production batch through a recipe. */
  | "recipe"
  /** Server-only: left the central store in a transfer. */
  | "transfer_out"
  /** Server-only: arrived at a branch from a transfer. */
  | "transfer_in";

/** Append-only ingredient ledger entry. Same contract as `StockMovement`. */
export interface IngredientMovement {
  id: ID;
  ingredientId: ID;
  ingredientName: string;
  reason: IngredientMovementReason;
  /** Whole base units. Negative removes stock. */
  delta: number;
  resulting: number;
  baseStock?: number;
  requestedDelta?: number;
  at: number;
  /** Receipt id, transfer id, or batch id. */
  ref?: string;
  note?: string;
  actorId?: ID;
  actorName?: string;
  actorEmail?: string;
  actorRole?: StoreRole;
}

export type StockTransferStatus = "sent" | "received";

/**
 * A movement of one ingredient from the central store to a branch. Both stores
 * hold a copy (server-authored, read-only to devices): `direction` says which
 * side this copy belongs to.
 */
export interface StockTransfer {
  id: ID;
  direction: "out" | "in";
  status: StockTransferStatus;
  fromStoreId: ID;
  fromStoreName: string;
  toStoreId: ID;
  toStoreName: string;
  /** Ingredient id in THIS store (central item for "out", branch copy for "in"). */
  ingredientId: ID;
  ingredientName: string;
  unit: IngredientUnit;
  quantity: number;
  note?: string;
  sentAt: number;
  receivedAt?: number;
  actorId: ID;
  actorName: string;
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
  "ingredient_movements",
  "stock_transfers",
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

/**
 * Wire protocol version a device speaks, sent as `x-sync-protocol`.
 *
 * v1 pushes are all-or-nothing: if the caller's role may not write any one row,
 * the whole request is refused with 403. That was safe but brittle. A device
 * whose role was narrowed while it held unsent privileged edits (a manager's
 * catalog change, then demoted to cashier) had those rows refused forever, and
 * because the refusal covered the entire batch, the completed sales sitting
 * alongside them could never upload either.
 *
 * v2 keeps the same authorization rules but reports them per row: the store
 * applies everything the role may write and names the rest in `deniedIds`. The
 * device keeps exactly those rows pending and stops resending them blindly, so a
 * refused catalog edit can never hold a paid sale hostage.
 *
 * The header is absent on older builds, which therefore keep v1 semantics
 * unchanged — deploying the server does not require the fleet to update first.
 */
export const SYNC_PROTOCOL_VERSION = 2;

/** Identifies one row the store refused to apply, so the device can retain it. */
export interface SyncDeniedChange {
  collection: SyncCollection;
  id: ID;
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

/**
 * The download half of a push, plus the rows this role was not allowed to write.
 *
 * `deniedIds` is only populated for protocol v2 callers. It is empty on a normal
 * sale: the device already filters obviously-unauthorized rows before uploading,
 * so a non-empty list means the store found something only it could judge.
 */
export interface SyncPushResponse extends SyncPullResponse {
  deniedIds: SyncDeniedChange[];
}

/**
 * The store checking itself.
 *
 * Every check here is one that used to be a throwaway script run by hand after
 * a complaint ("stock is wrong", "a bill is missing", "two people sold the same
 * table"). Making it a first-class read means the system can say "this is
 * wrong" before a cashier does. Read-only: nothing in it changes a document.
 */
export interface ReconciliationReport {
  generatedAt: number;
  /** The store's head sequence when the check ran. */
  head: number;
  counts: {
    products: number;
    movements: number;
    receipts: number;
    returns: number;
    heldOrders: number;
    auditEntries: number;
  };
  /** Movements whose stored base + delta does not equal the resulting balance. */
  arithmeticBreaks: {
    id: string;
    productName: string;
    base?: number;
    delta: number;
    resulting: number;
  }[];
  /** Tracked balances that disagree with the sum of their movements. */
  balanceMismatches: {
    productId: string;
    name: string;
    variantId?: string;
    balance: number;
    ledger: number;
  }[];
  /** Movements pointing at a product the store no longer has. */
  orphanMovements: { id: string; productId: string; productName: string }[];
  /** Receipts that should have moved stock but have no movement at all. */
  receiptsWithoutMovements: {
    id: string;
    number: string;
    total: number;
    createdAt: number;
  }[];
  /** Two live tickets claiming the same table. */
  duplicateTableTickets: { tableId: string; ids: string[] }[];
  /** Tickets marked resumed long ago — a bill opened and never closed. */
  staleTickets: { id: string; label: string; total: number; resumedAt: number }[];
  /** Whether every check passed, for a one-line status. */
  ok: boolean;
}

/**
 * One trading day, frozen.
 *
 * Computed once by the store from its own receipts and returns, then kept
 * forever. Re-closing a day returns the first copy untouched: a report that the
 * manager has already read must not be allowed to change because a till
 * uploaded a late sale hours afterwards. The late sale is not lost — it shows
 * in the live figures for the day, and the difference is the drift between
 * them.
 */
export interface DayClose {
  /** Local calendar day, "YYYY-MM-DD", as the closing till saw it. */
  day: string;
  closedAt: number;
  closedById: ID;
  closedByName: string;
  /** Unix ms bounds the close used, [from, to). */
  from: number;
  to: number;
  /** All money is integer minor units. */
  gross: number;
  discounts: number;
  refunds: number;
  /** gross - refunds. */
  net: number;
  salesCount: number;
  returnCount: number;
  itemCount: number;
  byMode: { mode: string; total: number; count: number }[];
  firstSaleAt: number | null;
  lastSaleAt: number | null;
}

/** The result of asking to close a day. */
export interface DayCloseResult {
  close: DayClose;
  /** True when this day was already closed and the stored copy was returned. */
  alreadyClosed: boolean;
}

/**
 * A closed day plus what the books say now.
 *
 * `drift` is the money that arrived after the close (`live.net - net`). It is
 * the honest answer to "why doesn't yesterday match the report?": either
 * nothing was late and it is zero, or a till uploaded an offline sale and the
 * owner can see exactly how much.
 */
export interface DayCloseSummary extends DayClose {
  live: {
    gross: number;
    discounts: number;
    refunds: number;
    net: number;
    salesCount: number;
    returnCount: number;
    itemCount: number;
    byMode: { mode: string; total: number; count: number }[];
    firstSaleAt: number | null;
    lastSaleAt: number | null;
  };
  drift: number;
}

// ---------------------------------------------------------------------------
// Store registry (control plane)
// ---------------------------------------------------------------------------

// Extensionless so both Metro (mobile) and the Worker bundler resolve it.
import { roleCan, type Permission, type StoreRole } from "./permissions";
export * from "./permissions";
export * from "./web-order";
export * from "./integration";
export * from "./channels";
export * from "./invariants";

/** Bump whenever collection visibility semantics change. */
export const SYNC_READ_POLICY_VERSION = 3;

/** Cost/profit inputs are restricted even when the selling catalog is readable. */
export function roleCanReadProductCosts(role: StoreRole | null | undefined): boolean {
  return (
    roleCan(role, "catalog:write") ||
    roleCan(role, "inventory:adjust") ||
    roleCan(role, "reports:view")
  );
}

/**
 * Whether a local change is safe to queue for this role without server state.
 * `conditional` is reserved for seller product writes: only the Store DO can
 * compare them with its authoritative document and prove they are stock-only.
 */
export type SyncWriteDisposition = "allowed" | "conditional" | "denied";

const SYNC_WRITE_PERMISSIONS = {
  categories: "catalog:write",
  modifiers: "catalog:write",
  ingredients: "catalog:write",
  tables: "tables:manage",
  customers: "customers:manage",
  staff: "staff:manage",
  receipts: "sale:create",
  // Refunds are owner-only in the app. A refund an older build still lets
  // staff give is accepted (the cash already left the drawer, refusing it
  // would hide that) and flagged by the Store DO. See flagUnauthorizedRefund.
  returns: "sale:create",
  product_images: "catalog:write",
  web_orders: "sale:create",
  audit_log: "catalog:read",
  held_orders: "sale:create",
} as const satisfies Record<
  Exclude<SyncCollection, "products" | "stock_movements" | "ingredient_movements" | "stock_transfers">,
  Permission
>;

/** True when a receipt document carries any line or order discount. */
export function syncReceiptHasDiscount(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const receipt = data as {
    discountTotal?: unknown;
    orderDiscount?: unknown;
    lines?: { discount?: unknown; orderDiscountShare?: unknown }[];
  };
  if (typeof receipt.discountTotal === "number" && receipt.discountTotal > 0) return true;
  // An order discount only reprices the sale when it is actually worth something.
  // Treating the mere presence of the object as a discount meant a cashier who
  // opened the discount sheet and backed out could have the finished receipt
  // refused on sync, with nothing discounted anywhere on the bill to explain it.
  if (
    receipt.orderDiscount &&
    typeof receipt.orderDiscount === "object" &&
    !Array.isArray(receipt.orderDiscount)
  ) {
    const value = (receipt.orderDiscount as { value?: unknown }).value;
    if (typeof value !== "number" || !Number.isFinite(value)) return true;
    if (value > 0) return true;
  }
  return (
    Array.isArray(receipt.lines) &&
    receipt.lines.some(
      (line) =>
        (typeof line?.discount === "number" && line.discount > 0) ||
        (typeof line?.orderDiscountShare === "number" && line.orderDiscountShare > 0),
    )
  );
}

/**
 * Who may log an ingredient movement. Transfers are server-only, a recipe
 * deduction rides with a sale, and everything else is a stock adjustment.
 */
function syncIngredientMovementPermission(change: SyncChange): Permission | null {
  if (change.deleted || !change.data || typeof change.data !== "object") return null;
  const m = change.data as { id?: unknown; reason?: unknown; delta?: unknown };
  if (m.id !== change.id || typeof m.delta !== "number" || !Number.isInteger(m.delta) || m.delta === 0) {
    return null;
  }
  switch (m.reason) {
    case "recipe":
      return m.delta < 0 ? "sale:create" : null;
    case "waste":
      return m.delta < 0 ? "inventory:adjust" : null;
    case "initial":
    case "restock":
      return m.delta > 0 ? "inventory:adjust" : null;
    case "adjustment":
      return "inventory:adjust";
    default:
      // transfer_in / transfer_out are server-only; unknown reasons fail closed.
      return null;
  }
}

function syncMovementPermission(change: SyncChange): Permission | null {
  if (change.deleted || !change.data || typeof change.data !== "object") return null;
  const movement = change.data as { id?: unknown; reason?: unknown; delta?: unknown };
  if (
    movement.id !== change.id ||
    typeof movement.delta !== "number" ||
    !Number.isFinite(movement.delta) ||
    movement.delta === 0
  ) {
    return null;
  }

  if (movement.reason === "sale") {
    return movement.delta <= 0 ? "sale:create" : null;
  }
  if (movement.reason === "return") {
    // Same as the refund document itself: accepted, then flagged if the role
    // may not refund. Only ever adds back what a refund returned.
    return movement.delta >= 0 ? "sale:create" : null;
  }
  if (movement.reason === "waste") {
    return movement.delta <= 0 ? "inventory:adjust" : null;
  }
  if (movement.reason === "production_out" || movement.reason === "production_in") {
    return "inventory:adjust";
  }
  if (
    movement.reason === "adjustment" ||
    movement.reason === "initial" ||
    movement.reason === "restock"
  ) {
    return movement.reason === "adjustment" || movement.delta >= 0
      ? "inventory:adjust"
      : null;
  }
  return null;
}

/**
 * Whether a role may write a collection at all, ignoring row-level rules.
 *
 * Coarser than `syncWriteDisposition` on purpose: this answers "could this role
 * ever publish anything here", which is what pending-work indicators need before
 * they promise a user that syncing will clear a queue.
 */
export function roleCanWriteSyncCollection(
  role: StoreRole | null | undefined,
  collection: SyncCollection,
): boolean {
  if (collection === "products") {
    return roleCan(role, "catalog:write") || roleCan(role, "sale:create");
  }
  if (collection === "stock_transfers") return false;
  if (collection === "ingredient_movements") {
    return roleCan(role, "inventory:adjust") || roleCan(role, "sale:create");
  }
  if (collection === "stock_movements") {
    return (
      roleCan(role, "sale:create") ||
      roleCan(role, "sale:refund") ||
      roleCan(role, "inventory:adjust")
    );
  }
  return roleCan(role, SYNC_WRITE_PERMISSIONS[collection]);
}

/** Shared fail-closed preflight; the Store DO still performs final authorization. */
export function syncWriteDisposition(
  role: StoreRole | null | undefined,
  change: SyncChange,
): SyncWriteDisposition {
  if (change.collection === "products") {
    if (roleCan(role, "catalog:write")) return "allowed";
    return !change.deleted && roleCan(role, "sale:create") ? "conditional" : "denied";
  }

  if (change.collection === "stock_movements") {
    const required = syncMovementPermission(change);
    return required && roleCan(role, required) ? "allowed" : "denied";
  }

  // Transfers are written only by the server, inside the two stores' Durable
  // Objects. No device may create or edit one.
  if (change.collection === "stock_transfers") return "denied";

  if (change.collection === "ingredient_movements") {
    const required = syncIngredientMovementPermission(change);
    return required && roleCan(role, required) ? "allowed" : "denied";
  }

  const required = SYNC_WRITE_PERMISSIONS[change.collection];
  if (!roleCan(role, required)) return "denied";
  // A discounted receipt from a role without `discount:apply` is deliberately
  // NOT refused. By the time it syncs the guest has paid and the slip is
  // printed; refusing it would strand the sale on the till and drop it from
  // the books. Discounts are blocked in the app instead, and the Store DO
  // flags any that still arrive (older builds) in the activity history.
  return "allowed";
}

/**
 * Money-document integrity.
 *
 * Totals are computed on the device, so the store has to assume the arithmetic
 * on an incoming receipt or credit note could be wrong — through a bug, a
 * partially-written document, or someone editing the payload to shrink a bill.
 * Role permissions alone do not cover this: a cashier legitimately holds
 * `sale:create`, and `discount:apply` only guards documents that *declare* a
 * discount. Without an arithmetic check, the same cashier could simply write a
 * smaller line net and total with no discount field at all and be inside their
 * permissions.
 *
 * These checks therefore verify a document against itself: every line's net must
 * be exactly its gross minus the discounts it declares, the totals must be the
 * sum of the lines, and no money may be negative. Reducing a bill now requires
 * declaring a discount, which requires `discount:apply`.
 *
 * What is deliberately *not* checked is the catalog price. Re-pricing an
 * incoming sale against the store's current menu would reject the exact sales
 * that matter most: a till that was offline when a price changed sold at the
 * price it knew, the customer paid that amount, and the receipt is already
 * printed. The snapshot on the document is the truth of what was charged.
 *
 * Tolerance exists because fractional quantities (0.25 Kg) make `price × qty`
 * non-integer, so line values are not always whole minor units.
 */
const MONEY_EPSILON = 0.01;

const isMoneyAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Absent optional money fields read as zero; present ones must be valid. */
function optionalMoney(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  return isMoneyAmount(value) ? value : null;
}

const nearlyEqual = (a: number, b: number): boolean => Math.abs(a - b) <= MONEY_EPSILON;

type MoneyLine = {
  qty?: unknown;
  price?: unknown;
  discount?: unknown;
  orderDiscountShare?: unknown;
  netTotal?: unknown;
  net?: unknown;
};

function moneyLinesOf(data: unknown): MoneyLine[] | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const lines = (data as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return null;
  return lines.every(
    (line) => !!line && typeof line === "object" && !Array.isArray(line),
  )
    ? (lines as MoneyLine[])
    : null;
}

/**
 * Whether a receipt's or credit note's own numbers add up.
 *
 * Unknown collections and tombstones are not money documents and are left to the
 * caller. Legacy documents that predate discounts omit the discount and net
 * fields entirely, and stay valid: an absent net simply is not cross-checked.
 */
export function syncMoneyDocumentIsConsistent(
  collection: SyncCollection,
  data: unknown,
): boolean {
  if (collection !== "receipts" && collection !== "returns") return true;

  const lines = moneyLinesOf(data);
  if (!lines) return false;
  const document = data as {
    itemCount?: unknown;
    total?: unknown;
    subtotal?: unknown;
    taxTotal?: unknown;
    discountTotal?: unknown;
    cashReceived?: unknown;
  };

  if (!isMoneyAmount(document.total)) return false;
  if (optionalMoney(document.discountTotal) === null) return false;
  if (optionalMoney(document.cashReceived) === null) return false;

  let quantity = 0;
  let netSum = 0;
  let netKnownForEveryLine = true;

  for (const line of lines) {
    const qty = line.qty;
    if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) return false;
    if (!isMoneyAmount(line.price)) return false;

    const lineDiscount = optionalMoney(line.discount);
    const orderShare = optionalMoney(line.orderDiscountShare);
    if (lineDiscount === null || orderShare === null) return false;

    const gross = line.price * qty;
    // Discounts may consume a line entirely, and rounding can nominally overshoot
    // it by a hundredth of a unit, but they can never exceed it meaningfully.
    if (lineDiscount + orderShare > gross + 1) return false;

    // `netTotal` on a receipt line and `net` on a credit-note line are the same
    // idea: the pre-tax value actually charged or refunded for those units.
    const declaredNet = collection === "receipts" ? line.netTotal : line.net;
    if (declaredNet === undefined || declaredNet === null) {
      netKnownForEveryLine = false;
      netSum += gross;
    } else {
      if (!isMoneyAmount(declaredNet)) return false;
      if (declaredNet > gross + MONEY_EPSILON) return false;
      // The only way to owe less than gross is to declare the discount, which
      // `syncWriteDisposition` then gates behind `discount:apply`.
      //
      // Clamped at zero to match how the till prices a line: prorating an order
      // discount rounds, and the line that absorbs the remainder can end up
      // nominally below zero. It bills zero, and refusing that would reject a
      // legitimate, already-paid sale.
      const expectedNet = Math.max(0, gross - lineDiscount - orderShare);
      if (!nearlyEqual(declaredNet, expectedNet)) return false;
      netSum += declaredNet;
    }

    quantity += qty;
  }

  if (
    typeof document.itemCount === "number" &&
    Number.isFinite(document.itemCount) &&
    !nearlyEqual(document.itemCount, quantity)
  ) {
    return false;
  }

  if (collection === "returns") {
    // Credit notes carry their own subtotal and tax, so their total is exact.
    if (!isMoneyAmount(document.subtotal) || !isMoneyAmount(document.taxTotal)) {
      return false;
    }
    if (!nearlyEqual(document.subtotal, netSum)) return false;
    return nearlyEqual(document.total, document.subtotal + document.taxTotal);
  }

  // A receipt records no per-line tax, so its total cannot be reproduced
  // exactly. Tax can only ever add to the pre-tax value it is charged on, so a
  // total below the sum of the line nets is arithmetically impossible.
  return !netKnownForEveryLine || document.total >= netSum - MONEY_EPSILON;
}

/**
 * Collection-level projection shared by the Worker and every offline device.
 * A collection is readable when the role has any listed permission.
 */
const SYNC_READ_PERMISSIONS = {
  products: ["catalog:read"],
  categories: ["catalog:read"],
  modifiers: ["catalog:read"],
  ingredients: ["catalog:write", "inventory:adjust"],
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
  ingredient_movements: ["inventory:adjust"],
  stock_transfers: ["inventory:adjust"],
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
  /** True for the owner's parent/central store. */
  isCentral?: boolean;
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
