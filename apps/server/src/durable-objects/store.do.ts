/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type {
  ApiCategory,
  ApiProduct,
  ApiStockAdjustment,
  Ingredient,
  IngredientMovement,
  RecipeLine,
  StockTransfer,
  PlaceWebOrderRequest,
  PublicMenu,
  StockMovement,
  StockState,
  StoreRole,
  SyncChange,
  SyncCollection,
  SyncDeniedChange,
  SyncPullChange,
  SyncPullResponse,
  SyncPushRequest,
  WebOrder,
  WebOrderLine,
  WebOrderStatus,
} from "@gls-pos/types";
import {
  readableSyncCollections,
  roleCan,
  roleCanReadProductCosts,
  syncMoneyDocumentIsConsistent,
  syncReceiptHasDiscount,
  syncWriteDisposition,
} from "@gls-pos/types";
import type { Env } from "../env.js";
import * as schema from "./schema.js";
import migrations from "./migrations/migrations.js";
import {
  SERVER_ONLY_REASONS,
  applyDelta,
  currentStock,
  ingredientMovementOf,
  sanitizeIngredient,
} from "./ingredients.js";

/**
 * Undelivered outgoing transfers. Not a sync collection, so no role can read it
 * and it never reaches a device.
 */
const TRANSFER_OUTBOX = "_transfer_outbox";

/** Public VIP endpoint throttle: at most N orders per table per window. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_ORDERS = 5;

/**
 * Guest (VIP) prices carry a markup over the counter price.
 *
 * Table service costs more than the counter: someone carries the food, sets the
 * table and cleans up after. The markup is applied in one place, used by BOTH
 * the guest menu and the order that comes back from it, so the price on the
 * guest's screen is exactly the price the receipt is billed at. Applying it to
 * only one of those would let a guest be shown one total and charged another.
 *
 * In basis points so the percentage can be changed without floating-point
 * fiddling: 5000 = +50%.
 */
const VIP_MARKUP_BPS = 5000;

/** Counter price -> guest price, rounded to the nearest whole naira. */
function guestPrice(counterPrice: number): number {
  const marked = (counterPrice * (10_000 + VIP_MARKUP_BPS)) / 10_000;
  return Math.round(marked / 100) * 100;
}

/**
 * Collections that record trading activity, as opposed to the ones that
 * describe the shop. Clearing these hands a store over with no history while
 * its menu, categories, tables and photos stay exactly as they are.
 *
 * `stock_movements` belongs here, and including it is safe: a product's current
 * stock is materialised onto the product document itself (see
 * `applyMovementDelta`, which writes the new total back after every movement),
 * so dropping the log erases the record of how stock reached its current level
 * without changing what the app reports as being on the shelf.
 */
const SALES_COLLECTIONS = [
  "receipts",
  "returns",
  "stock_movements",
  "web_orders",
  "audit_log",
  "held_orders",
] as const;

/**
 * Device wall clocks are the LWW tiebreaker, so a clock running minutes fast
 * could otherwise pin a stale document ahead of every correct device until
 * real time caught up. Anything dated further than this in the future is
 * clamped to now + skew.
 */
const CLOCK_SKEW_MS = 2 * 60_000;

/**
 * Re-date a sale or refund stamped by a till whose clock is wrong.
 *
 * A sale's `createdAt` decides which day it counts on in every report, and it
 * comes from the device. A till with a wrong date (flat clock battery, set by
 * hand) therefore put today's sales on tomorrow. Two corrections:
 *
 *  1. The device reports its time on upload (`skew`). If it is off by more
 *     than CLOCK_SKEW_MS, the same error is taken out of the sale's times.
 *  2. Nothing can have been sold in the future. A time still ahead of the
 *     server (older builds send no device time) is pulled back to now.
 *
 * The device's original time is kept in `deviceCreatedAt`. A sale corrected
 * once keeps its corrected time on every later upload (e.g. when it's settled).
 */
function correctSaleTime(
  incoming: unknown,
  storedJson: string | undefined,
  now: number,
  skew: number | undefined,
): unknown {
  if (!incoming || typeof incoming !== "object") return incoming;
  const doc = { ...(incoming as Record<string, unknown>) };
  const created = doc.createdAt;
  if (typeof created !== "number" || !Number.isFinite(created)) return incoming;

  const stored = storedJson ? (JSON.parse(storedJson) as Record<string, unknown>) : null;
  if (stored && typeof stored.deviceCreatedAt === "number" && typeof stored.createdAt === "number") {
    // Already corrected on first upload: keep that answer.
    doc.createdAt = stored.createdAt;
    doc.deviceCreatedAt = stored.deviceCreatedAt;
    if (typeof stored.clockSkewMs === "number") doc.clockSkewMs = stored.clockSkewMs;
    if (typeof doc.paidAt === "number" && doc.paidAt !== stored.paidAt && typeof stored.clockSkewMs === "number") {
      doc.paidAt = Math.min(doc.paidAt + stored.clockSkewMs, now);
    }
    return doc;
  }
  if (stored) return incoming; // first stored without correction: leave history alone

  let shift = skew !== undefined && Math.abs(skew) > CLOCK_SKEW_MS ? Math.round(skew) : 0;
  if (created + shift > now + CLOCK_SKEW_MS) shift = now - created;
  if (shift === 0) return incoming;

  doc.deviceCreatedAt = created;
  doc.clockSkewMs = shift;
  doc.createdAt = created + shift;
  if (typeof doc.paidAt === "number") doc.paidAt = Math.min(doc.paidAt + shift, now);
  return doc;
}

/**
 * Per-response page budget for sync deltas.
 *
 * A first sync used to return the store's ENTIRE history — including every
 * product photo (30–80KB of base64 each) — in one multi-megabyte JSON reply.
 * Phones aborted at their request timeout, retried, and timed out forever:
 * sales never uploaded and nothing reached other tills. Responses are now
 * capped by row count and encoded size; the cursor advances to the last row
 * sent, so devices make incremental progress every cycle instead of failing
 * as a block.
 *
 * The cap is a balance, not a hard limit. 100 rows made a first download of a
 * long-running store take ~1,400 round trips (tens of minutes), so the budget
 * is 500 rows / 768KB — still comfortably inside the client's 15s timeout on
 * mobile data, and ~5x fewer round trips. Photos stay excluded from sync pulls
 * (see `changesSincePage`), so the byte cap is not dominated by images.
 */
const PULL_MAX_ROWS = 500;
const PULL_MAX_BYTES = 768 * 1024;

/** The product fields the server cares about; the doc may carry more. */
type StoredProduct = {
  id: string;
  name: string;
  price: number;
  cost?: number;
  currency?: string;
  categoryId?: string;
  sku?: string;
  barcode?: string;
  stockQuantity: number | null;
  lowStockAt?: number;
  autoUpdateStock?: boolean;
  sellBy?: "unit" | "fraction";
  variants?: {
    id: string;
    name: string;
    /** Integer minor units. */
    price: number;
    cost?: number;
    /** Undefined/null means stock is not tracked for this variant. */
    stock?: number | null;
    autoUpdateStock?: boolean;
  }[];
};

/** Before/after of a stock change, used to emit the right events. */
export type StockTransition = {
  productId: string;
  name: string;
  previousStock: number | null;
  stock: number | null;
  lowStockAt?: number;
  stockState: StockState;
};

/**
 * Single definition of stock state, so the POS, the VIP page and the public API
 * never disagree about what "low" means. Default threshold matches the app (3).
 */
export function stockStateOf(p: {
  stockQuantity?: number | null;
  lowStockAt?: number;
}): StockState {
  const stock = p.stockQuantity;
  if (stock === null || stock === undefined) return "untracked";
  if (stock <= 0) return "out_of_stock";
  return stock <= (p.lowStockAt ?? 3) ? "low_stock" : "in_stock";
}

const MOVEMENT_REASONS = new Set<StockMovement["reason"]>([
  "sale",
  "adjustment",
  "initial",
  "restock",
  "return",
  "waste",
]);

/** Runtime guard for the otherwise opaque sync document boundary. */
function stockMovementOf(value: unknown): StockMovement | null {
  if (!value || typeof value !== "object") return null;
  const movement = value as Partial<StockMovement>;
  if (
    typeof movement.id !== "string" ||
    !movement.id ||
    typeof movement.productId !== "string" ||
    !movement.productId ||
    typeof movement.productName !== "string" ||
    !movement.productName ||
    !MOVEMENT_REASONS.has(movement.reason as StockMovement["reason"]) ||
    typeof movement.delta !== "number" ||
    !Number.isFinite(movement.delta) ||
    typeof movement.resulting !== "number" ||
    !Number.isFinite(movement.resulting) ||
    movement.resulting < 0 ||
    typeof movement.at !== "number" ||
    !Number.isFinite(movement.at) ||
    (movement.variantId !== undefined && typeof movement.variantId !== "string") ||
    (movement.variantName !== undefined && typeof movement.variantName !== "string") ||
    (movement.baseStock !== undefined &&
      (typeof movement.baseStock !== "number" || !Number.isFinite(movement.baseStock))) ||
    (movement.requestedDelta !== undefined &&
      (typeof movement.requestedDelta !== "number" || !Number.isFinite(movement.requestedDelta))) ||
    (movement.ref !== undefined && typeof movement.ref !== "string") ||
    (movement.actorId !== undefined && typeof movement.actorId !== "string") ||
    (movement.actorName !== undefined && typeof movement.actorName !== "string") ||
    (movement.actorEmail !== undefined && typeof movement.actorEmail !== "string") ||
    (movement.actorRole !== undefined && typeof movement.actorRole !== "string") ||
    (movement.autoUpdateStock !== undefined && typeof movement.autoUpdateStock !== "boolean") ||
    (movement.note !== undefined &&
      (typeof movement.note !== "string" || movement.note.length > 240))
  ) {
    return null;
  }

  // System reasons have fixed directions. A seller cannot increase inventory by
  // labelling a positive operation as a sale; a refund cannot remove stock.
  if (movement.reason === "sale" && movement.delta > 0) return null;
  if (["initial", "restock", "return"].includes(movement.reason!) && movement.delta < 0) return null;
  if (movement.reason === "waste" && movement.delta > 0) return null;
  return movement as StockMovement;
}

/** Existing movement rows are immutable, except server-corrected balance fields. */
function isMovementRetry(storedJson: string, incoming: StockMovement): boolean {
  const stored = stockMovementOf(JSON.parse(storedJson));
  if (!stored) return false;
  if (stored.id.startsWith("mov_initial_") && incoming.id === stored.id) {
    return (
      stored.reason === "initial" &&
      incoming.reason === "initial" &&
      stored.productId === incoming.productId &&
      stored.variantId === incoming.variantId &&
      (stored.requestedDelta ?? stored.delta) ===
        (incoming.requestedDelta ?? incoming.delta)
    );
  }
  return (
    stored.id === incoming.id &&
    stored.productId === incoming.productId &&
    stored.productName === incoming.productName &&
    stored.variantId === incoming.variantId &&
    stored.variantName === incoming.variantName &&
    stored.reason === incoming.reason &&
    stored.at === incoming.at &&
    (stored.requestedDelta ?? stored.delta) === (incoming.requestedDelta ?? incoming.delta) &&
    stored.note === incoming.note &&
    stored.ref === incoming.ref &&
    stored.autoUpdateStock === incoming.autoUpdateStock
  );
}

type DocumentRow = typeof schema.documents.$inferSelect;

/** Remove protected root/variant cost values from a product-shaped snapshot. */
function stripProductCosts(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const projected = { ...(value as Record<string, unknown>) };
  delete projected.cost;
  if (Array.isArray(projected.variants)) {
    projected.variants = projected.variants.map((variant) => {
      if (!variant || typeof variant !== "object" || Array.isArray(variant)) return variant;
      const visible = { ...(variant as Record<string, unknown>) };
      delete visible.cost;
      return visible;
    });
  }
  return projected;
}

/** Strip protected cost values before a product document crosses the sync boundary. */
function projectProductForRole(value: unknown, role: StoreRole): unknown {
  return roleCanReadProductCosts(role) ? value : stripProductCosts(value);
}

/** Held bills embed product snapshots but never need back-office cost values. */
function stripHeldOrderCosts(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const held = { ...(value as Record<string, unknown>) };
  if (!Array.isArray(held.entries)) return held;
  held.entries = held.entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const projected = { ...(entry as Record<string, unknown>) };
    if ("item" in projected) projected.item = stripProductCosts(projected.item);
    if ("variant" in projected) projected.variant = stripProductCosts(projected.variant);
    return projected;
  });
  return held;
}

/**
 * A seller receives products without cost values but still sends stock-only
 * product revisions. Restore those protected fields from the authoritative
 * document so a restricted write can never erase or replace them.
 */
function preserveProductCosts(storedJson: string | undefined, incoming: unknown): unknown {
  if (!storedJson || !incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return incoming;
  }

  const stored = JSON.parse(storedJson) as Record<string, unknown>;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return incoming;

  const next = { ...(incoming as Record<string, unknown>) };
  if (Object.prototype.hasOwnProperty.call(stored, "cost")) next.cost = stored.cost;
  else delete next.cost;

  if (Array.isArray(next.variants) && Array.isArray(stored.variants)) {
    const storedById = new Map<string, Record<string, unknown>>();
    for (const variant of stored.variants) {
      if (!variant || typeof variant !== "object" || Array.isArray(variant)) continue;
      const record = variant as Record<string, unknown>;
      if (typeof record.id === "string") storedById.set(record.id, record);
    }
    next.variants = next.variants.map((variant) => {
      if (!variant || typeof variant !== "object" || Array.isArray(variant)) return variant;
      const visible = { ...(variant as Record<string, unknown>) };
      const current = typeof visible.id === "string" ? storedById.get(visible.id) : undefined;
      if (current && Object.prototype.hasOwnProperty.call(current, "cost")) {
        visible.cost = current.cost;
      } else {
        delete visible.cost;
      }
      return visible;
    });
  }

  return next;
}

const stockDidNotIncrease = (before: unknown, after: unknown): boolean => {
  if (JSON.stringify(before) === JSON.stringify(after)) return true;
  return typeof before === "number" && typeof after === "number" && after <= before;
};

/** Variant arrays may differ only by one or more downward `stock` changes. */
function variantStockDecrementOnly(prev: unknown, next: unknown): boolean {
  if (JSON.stringify(prev) === JSON.stringify(next)) return true;
  if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return false;

  return prev.every((before, index) => {
    const after = next[index];
    if (!before || typeof before !== "object" || !after || typeof after !== "object") return false;
    const a = before as Record<string, unknown>;
    const b = after as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (key === "stock" || key === "cost") continue;
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
    }
    return stockDidNotIncrease(a.stock, b.stock);
  });
}

/**
 * Selling has to decrement stock, which means a cashier must be able to write
 * to `products` — but only simple/variant stock, and only downward. Product and
 * variant identity, names, prices, ordering, and every other field must match.
 */
function isStockDecrementOnly(prev: unknown, next: unknown): boolean {
  if (!prev || typeof prev !== "object" || !next || typeof next !== "object") return false;
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key === "stockQuantity" || key === "variants" || key === "cost") continue;
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  }

  return (
    stockDidNotIncrease(a.stockQuantity, b.stockQuantity) &&
    variantStockDecrementOnly(a.variants, b.variants)
  );
}

/**
 * Result of a push. Authorisation failures are returned rather than thrown:
 * exceptions lose their type across the DO RPC boundary, so a plain result
 * keeps the 403 distinguishable from a genuine 500.
 */
export type StockActor = {
  id: string;
  name: string;
  email?: string;
};

export type PushResult = {
  /**
   * Collections the caller's role may not write, for protocol v1 callers whose
   * pushes are all-or-nothing. Empty means the push applied.
   *
   * Always empty for v2 (`partial`) callers: they get `deniedIds` instead and
   * every authorized row is still applied.
   */
  denied: string[];
  /** Exact rows that were refused. Only populated for `partial` pushes. */
  deniedIds: SyncDeniedChange[];
  changes: SyncPullChange[];
  cursor: number;
  /** The store's head sequence, so devices can detect a rebuilt oplog. */
  head: number;
};

/** Per-request behaviour negotiated from the caller's `x-sync-protocol`. */
export type PushOptions = {
  /**
   * Apply every authorized row and report the refused ones, instead of refusing
   * the entire request. See `SYNC_PROTOCOL_VERSION`.
   */
  partial?: boolean;
  /**
   * Internal bulk writers (catalog copies between stores) only need the write
   * half. Skipping the download half stops them returning a page of the store's
   * entire history that nobody reads.
   */
  skipPull?: boolean;
  /**
   * Server time minus the device's time at upload, when the device reported
   * it. Used to re-date sales stamped by a till with a wrong clock.
   */
  deviceClockSkewMs?: number;
};

/** DB row → role-projected wire change (parse stored JSON only after authorization). */
function toChange(row: DocumentRow, role: StoreRole): SyncPullChange {
  const stored = JSON.parse(row.data) as unknown;
  const data =
    row.collection === "products"
      ? projectProductForRole(stored, role)
      : row.collection === "held_orders"
        ? stripHeldOrderCosts(stored)
        : stored;
  return {
    collection: row.collection as SyncChange["collection"],
    id: row.id,
    data,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
    serverSeq: row.serverSeq,
  };
}

/**
 * One Durable Object per store. It owns that store's live operational data
 * (catalog, inventory, tables, orders, receipts) in embedded SQLite and acts as
 * the authoritative mirror for every offline-first device in the restaurant.
 *
 * Single-threaded execution makes the sync merge race-free without explicit
 * locking. Migrations run once at startup inside blockConcurrencyWhile so
 * queries never hit an unmigrated database.
 *
 * The Worker reaches this through the typed `push` / `pull` RPC methods below.
 */
export class StoreDurableObject extends DurableObject<Env> {
  private readonly db: DrizzleSqliteDODatabase<typeof schema>;
  /** tableId -> recent web-order timestamps, for the public-endpoint throttle. */
  private readonly orderRate = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema, logger: false });
    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
    });
  }

  // --- Sync -----------------------------------------------------------------

  /**
   * The store's high-water mark, derived from the rows themselves.
   *
   * This deliberately replaces the old `sync_meta` counter: a counter written
   * *after* the rows could fall behind if a push ever died mid-way, leaving
   * stranded seqs that the next push would reuse — devices pulling in order
   * would then silently miss rows. Reading MAX(server_seq) (indexed) makes the
   * number self-healing by construction.
   */
  private currentSeq(): number {
    const [row] = this.db
      .select({ max: sql<number>`coalesce(max(${schema.documents.serverSeq}), 0)` })
      .from(schema.documents)
      .all();
    return row?.max ?? 0;
  }

  /**
   * Role-readable changes after `cursor`, oldest first, capped to one page.
   *
   * Authorization is part of the SQL predicate rather than a post-query loop:
   * hidden receipt/audit history therefore consumes neither row slots nor
   * client round-trips. When the final readable page is exhausted, the cursor
   * jumps over any hidden tail to the global head without exposing its data.
   */
  private changesSincePage(
    cursor: number,
    role: StoreRole,
    options?: { includeProductImages?: boolean },
  ): { changes: SyncPullChange[]; cursor: number } {
    const includeImages = options?.includeProductImages === true;
    const readable = readableSyncCollections(role).filter(
      (collection) => includeImages || collection !== "product_images",
    );
    const head = this.currentSeq();

    // Preserve an ahead cursor so the client can detect an oplog rebuild from
    // `cursor > head` and deliberately restart its replay from zero.
    if (cursor > head) return { changes: [], cursor };
    if (cursor === head || readable.length === 0) return { changes: [], cursor: head };

    const rows = this.db
      .select()
      .from(schema.documents)
      .where(
        and(
          gt(schema.documents.serverSeq, cursor),
          inArray(schema.documents.collection, readable),
        ),
      )
      .orderBy(schema.documents.serverSeq)
      .limit(PULL_MAX_ROWS)
      .all();

    const page = this.fitPage(rows);
    let nextCursor = page.length > 0 ? page[page.length - 1]!.serverSeq : cursor;

    // A short, fully-consumed filtered page proves there are no more readable
    // rows. Skip the hidden suffix in one step instead of returning empty pages.
    if (page.length === rows.length && rows.length < PULL_MAX_ROWS) {
      nextCursor = head;
    }

    return { changes: page.map((row) => toChange(row, role)), cursor: nextCursor };
  }

  /**
   * Trim a page of rows to the response budget, always returning at least one
   * row so a single oversized document cannot stall the cursor.
   */
  private fitPage(rows: DocumentRow[]): DocumentRow[] {
    let bytes = 0;
    const page: DocumentRow[] = [];
    for (const row of rows) {
      const rowBytes = row.data.length + 96;
      if (page.length > 0 && bytes + rowBytes > PULL_MAX_BYTES) break;
      page.push(row);
      bytes += rowBytes;
      // Always make progress even if one permitted document exceeds the budget.
      if (rowBytes > PULL_MAX_BYTES) break;
    }
    return page;
  }

  /**
   * Collections that describe the shop rather than record its trading.
   *
   * A till needs these before it can open: the menu, categories, tables, staff,
   * customers and modifier groups. The complement — receipts, returns, stock
   * movements, web orders, audit log, held orders — grows without bound and is
   * what made a first sync take many minutes.
   */
  private referenceCollections(role: StoreRole): SyncCollection[] {
    return readableSyncCollections(role).filter(
      (collection) =>
        collection !== "product_images" &&
        !(SALES_COLLECTIONS as readonly string[]).includes(collection),
    );
  }

  /** High-water mark across only the given collections. */
  private referenceHead(collections: readonly SyncCollection[]): number {
    const [row] = this.db
      .select({ max: sql<number>`coalesce(max(${schema.documents.serverSeq}), 0)` })
      .from(schema.documents)
      .where(inArray(schema.documents.collection, collections))
      .all();
    return row?.max ?? 0;
  }

  /**
   * Trading collections that belong to the current shift: sales, credit notes,
   * held orders and online orders. `stock_movements` and `audit_log` are
   * history views rather than shift data, so the newest-first pass skips them
   * and leaves them to the ascending replay — otherwise ten thousand rows would
   * cover a few hours of log instead of days of sales.
   */
  private recentCollections(role: StoreRole): SyncCollection[] {
    const wanted: readonly string[] = ["receipts", "returns", "held_orders", "web_orders"];
    return readableSyncCollections(role).filter((collection) => wanted.includes(collection));
  }

  /**
   * First-sync recent-trading page, NEWEST first.
   *
   * The normal replay walks the store oldest-first, which is correct for a
   * cursor but wrong for a till that has just been installed: today's receipts
   * carry the highest sequence numbers, so they arrived dead last — after
   * minutes of downloading history. A new till therefore showed no sales at all
   * while it caught up, which reads as "my data is gone".
   *
   * This pass walks backwards from the head over the trading collections so the
   * current shift's sales land first. It is bounded by the caller and purely an
   * accelerator: the ascending replay still delivers everything afterwards.
   *
   * `before` is an exclusive upper bound; 0 means "start at the head".
   */
  async pullRecent(before: number, role: StoreRole): Promise<SyncPullResponse> {
    const collections = this.recentCollections(role);
    const head = this.currentSeq();
    const upper = before > 0 ? Math.min(before, head + 1) : head + 1;
    if (collections.length === 0 || upper <= 1) {
      return { changes: [], cursor: 0, head };
    }

    const rows = this.db
      .select()
      .from(schema.documents)
      .where(
        and(
          lt(schema.documents.serverSeq, upper),
          inArray(schema.documents.collection, collections),
        ),
      )
      .orderBy(desc(schema.documents.serverSeq))
      .limit(PULL_MAX_ROWS)
      .all();

    const page = this.fitPage(rows);
    // `cursor` is the next (lower) bound. Zero means the caller has reached the
    // start of the trading history.
    const next = page.length > 0 ? page[page.length - 1]!.serverSeq : 0;
    return { changes: page.map((row) => toChange(row, role)), cursor: next, head };
  }

  /**
   * First-sync reference page: the shop's current description, paged by
   * `server_seq`, with no jump to the global head.
   *
   * This exists because a brand-new till used to replay the whole store in
   * sequence order. On a long-running shop that meant the menu arrived
   * interleaved with years of receipts, and an item added this morning — which
   * carries a high sequence — only appeared near the very end. Staff read that
   * as "my items are missing", which is indistinguishable from the wrong
   * database. Loading the reference set first makes the till usable in seconds
   * while the trading history continues to stream in behind it.
   *
   * The device keeps its own cursor for this pass, so the normal replay still
   * runs from zero afterwards and remains the single source of truth.
   */
  async pullReference(cursor: number, role: StoreRole): Promise<SyncPullResponse> {
    const collections = this.referenceCollections(role);
    if (collections.length === 0) return { changes: [], cursor, head: 0 };

    const head = this.referenceHead(collections);
    // An ahead cursor means this store's oplog was rebuilt; the device restarts
    // this pass from zero rather than waiting for a cursor that will never come.
    if (cursor > head) return { changes: [], cursor, head };
    if (cursor === head) return { changes: [], cursor: head, head };

    const rows = this.db
      .select()
      .from(schema.documents)
      .where(
        and(
          gt(schema.documents.serverSeq, cursor),
          inArray(schema.documents.collection, collections),
        ),
      )
      .orderBy(schema.documents.serverSeq)
      .limit(PULL_MAX_ROWS)
      .all();

    const page = this.fitPage(rows);
    const nextCursor = page.length > 0 ? page[page.length - 1]!.serverSeq : cursor;
    return { changes: page.map((row) => toChange(row, role)), cursor: nextCursor, head };
  }

  /**
   * Pull only: return one page of everything the store has seen since the
   * device's cursor. Used for a first full download (paged) and periodic
   * catch-up.
   */
  async pull(cursor: number, role: StoreRole): Promise<SyncPullResponse> {
    const page = this.changesSincePage(cursor, role);
    return { changes: page.changes, cursor: page.cursor, head: this.currentSeq() };
  }

  /**
   * Push the device's dirty changes, then return everything since its cursor
   * (so one round-trip both uploads and downloads).
   *
   * Conflicts resolve last-write-wins on `updatedAt`: an incoming change is
   * dropped only if the stored version is strictly newer. Each accepted write
   * gets the next monotonic `server_seq` so other devices pull it in order.
   */
  async push(
    request: SyncPushRequest,
    role: StoreRole,
    actor?: StockActor,
    options?: PushOptions,
  ): Promise<PushResult> {
    // Authorise everything up front so a rejected push applies nothing. The DO
    // is single-threaded, so no other write can interleave between the checks
    // and the writes below.
    const partial = options?.partial === true;
    const stored = new Map<string, { updatedAt: number; data: string } | undefined>();
    const denied: string[] = [];
    const deniedIds: SyncDeniedChange[] = [];
    const deniedKeys = new Set<string>();
    const incomingMovementIds = new Set<string>();

    const refuse = (change: SyncChange) => {
      denied.push(change.collection);
      const key = `${change.collection}/${change.id}`;
      if (deniedKeys.has(key)) return;
      deniedKeys.add(key);
      deniedIds.push({ collection: change.collection, id: change.id });
    };

    for (const change of request.changes) {
      if (change.collection === "stock_movements" || change.collection === "ingredient_movements") {
        const key = `${change.collection}/${change.id}`;
        if (incomingMovementIds.has(key)) {
          refuse(change);
          continue;
        }
        incomingMovementIds.add(key);
      }
      const key = `${change.collection}/${change.id}`;
      const [existing] = this.db
        .select({ updatedAt: schema.documents.updatedAt, data: schema.documents.data })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.collection, change.collection),
            eq(schema.documents.id, change.id),
          ),
        )
        .all();
      stored.set(key, existing);

      if (!this.mayWrite(change, role, existing?.data)) refuse(change);
    }

    // v1 devices cannot be told which row failed, so nothing is applied and the
    // Worker turns this into a 403. v2 devices apply the rest and keep only the
    // named rows pending.
    if (denied.length > 0 && !partial) {
      return {
        denied: [...new Set(denied)],
        deniedIds,
        changes: [],
        cursor: request.cursor,
        head: this.currentSeq(),
      };
    }

    // Movements are the authority for stock, so apply their deltas only for
    // ones we've never seen before (idempotent on retry). Captured against the
    // pre-push state, and applied after all product docs are written below.
    const newMovements: SyncChange[] = [];
    const newMovementIds = new Set<string>();
    const newIngredientMovements: IngredientMovement[] = [];
    const webOrderStock: { id: string; prevStatus?: WebOrderStatus; status: WebOrderStatus }[] = [];
    const newReceipts: unknown[] = [];
    const newReturns: unknown[] = [];
    const now = Date.now();

    // All SQL below is synchronous and there is no `await` between statements.
    // SQLite-backed Durable Objects coalesce such writes into one atomic storage
    // transaction, while movement ids still make whole-request retries safe.
    let seq = this.currentSeq();

    let appliedAny = false;

    for (const change of request.changes) {
      // Refused rows only reach here on a partial push, where the rest of the
      // batch is still applied.
      if (deniedKeys.has(`${change.collection}/${change.id}`)) continue;

      const existing = stored.get(`${change.collection}/${change.id}`);
      // Clamp future-dated client clocks so one fast device cannot pin a
      // document ahead of every other device's edits.
      const updatedAt = Math.min(change.updatedAt, now + CLOCK_SKEW_MS);

      // Stock movements are append-only commands. Once an id exists, a retry
      // may acknowledge it but must never replace the server-normalized
      // before/after balance or its server-stamped actor snapshot.
      if (
        (change.collection === "stock_movements" || change.collection === "ingredient_movements") &&
        existing
      ) {
        continue;
      }

      // Ingredient movements are applied after the batch, like stock movements.
      if (change.collection === "ingredient_movements") {
        const movement = ingredientMovementOf(change.data);
        if (movement && !change.deleted) {
          newIngredientMovements.push({
            ...movement,
            ...(actor
              ? { actorId: actor.id, actorName: actor.name, actorEmail: actor.email, actorRole: role }
              : {}),
          });
        }
        continue;
      }

      // Stored version is newer or equal — keep it, drop the incoming change.
      // Ties favour the server copy, which every device sees identically.
      if (existing && existing.updatedAt >= updatedAt) continue;

      // Never trust a product's absolute stock off the wire. Two tills or a
      // long-offline device would otherwise overwrite each other's counts with
      // last-write-wins. Stock is preserved from the server's current value
      // (0 for a brand-new tracked product) and only moved by the movement log.
      let data = change.data;
      if (change.collection === "stock_movements" && !change.deleted && actor) {
        data = {
          ...(change.data as StockMovement),
          actorId: actor.id,
          actorName: actor.name,
          actorEmail: actor.email,
          actorRole: role,
        };
      }
      if (change.collection === "held_orders" && !change.deleted) {
        data = stripHeldOrderCosts(data);
      }
      if (change.collection === "web_orders" && !change.deleted && data && typeof data === "object") {
        // Stock bookkeeping is server-owned: a device copy that predates it
        // must never wipe the markers, or the stock would move twice.
        const prev = existing ? (JSON.parse(existing.data) as WebOrder) : null;
        const next = data as WebOrder;
        data = {
          ...next,
          stockDeductedAt: prev?.stockDeductedAt,
          stockRestoredAt: prev?.stockRestoredAt,
        };
        webOrderStock.push({ id: change.id, prevStatus: prev?.status, status: next.status });
      }
      if (change.collection === "ingredients" && !change.deleted) {
        data = sanitizeIngredient(change.data, existing?.data) ?? change.data;
      }
      if (
        (change.collection === "receipts" || change.collection === "returns") &&
        !change.deleted
      ) {
        data = correctSaleTime(data, existing?.data, now, options?.deviceClockSkewMs);
      }
      if (change.collection === "receipts" && !existing && !change.deleted) {
        newReceipts.push(data);
      }
      if (change.collection === "returns" && !existing && !change.deleted) {
        newReturns.push(data);
      }
      if (change.collection === "products" && !change.deleted) {
        if (!roleCanReadProductCosts(role)) {
          data = preserveProductCosts(existing?.data, data);
        }
        data = this.sanitizeProductStock(data, existing?.data);
      }
      if (
        change.collection === "stock_movements" &&
        !existing &&
        !change.deleted &&
        !newMovementIds.has(change.id)
      ) {
        newMovementIds.add(change.id);
        newMovements.push({ ...change, data });
      }

      seq += 1;
      appliedAny = true;
      const row = {
        collection: change.collection,
        id: change.id,
        data: JSON.stringify(data),
        updatedAt,
        deleted: change.deleted,
        serverSeq: seq,
      };
      this.db
        .insert(schema.documents)
        .values(row)
        .onConflictDoUpdate({
          target: [schema.documents.collection, schema.documents.id],
          set: {
            data: row.data,
            updatedAt: row.updatedAt,
            deleted: row.deleted,
            serverSeq: row.serverSeq,
          },
        })
        .run();
    }

    // VIP orders move menu stock on acceptance (and put it back on a cancel)
    // before device movements are applied, so the billing guard below can see
    // that an order's stock has already left.
    for (const entry of webOrderStock) {
      const before = seq;
      seq = this.syncWebOrderStock(entry.id, entry.prevStatus, entry.status, seq, actor, role);
      if (seq !== before) appliedAny = true;
    }

    // Apply the new movements' deltas to the (now-written) product docs.
    for (const movement of newMovements) {
      if (this.isDuplicateVipSale(movement)) {
        // An older app build billed a VIP order and recorded the sale again.
        // The stock already left when the order was accepted: void the copy.
        seq += 1;
        this.db
          .update(schema.documents)
          .set({ deleted: true, serverSeq: seq, updatedAt: Date.now() })
          .where(
            and(
              eq(schema.documents.collection, "stock_movements"),
              eq(schema.documents.id, movement.id),
            ),
          )
          .run();
        continue;
      }
      seq = this.applyMovementDelta(movement, seq);
    }

    // Ingredient ledger: device movements first, then recipe use by new sales.
    for (const movement of newIngredientMovements) {
      seq = this.applyIngredientMovement(movement, seq);
      appliedAny = true;
    }
    for (const receipt of newReceipts) {
      const before = seq;
      seq = this.deductRecipesForReceipt(receipt, seq);
      if (!roleCan(role, "discount:apply")) {
        seq = this.flagUnauthorizedDiscount(receipt, seq, actor, role);
      }
      if (seq !== before) appliedAny = true;
    }
    if (!roleCan(role, "sale:refund")) {
      for (const ret of newReturns) {
        const before = seq;
        seq = this.flagUnauthorizedRefund(ret, seq, actor, role);
        if (seq !== before) appliedAny = true;
      }
    }

    // Let other devices know there's something to pull (e.g. one till marks an
    // order READY and every other screen updates straight away). A push whose
    // every row was refused or superseded changed nothing worth waking them for.
    if (appliedAny) this.broadcast("changes");

    // The download half of the round-trip is paged exactly like a pull, so an
    // upload can never be killed by an oversized response. Anything past the
    // page arrives on the device's next cycle.
    if (options?.skipPull) {
      return {
        denied: [],
        deniedIds,
        changes: [],
        cursor: request.cursor,
        head: this.currentSeq(),
      };
    }
    const page = this.changesSincePage(request.cursor, role);
    return {
      denied: [],
      deniedIds,
      changes: page.changes,
      cursor: page.cursor,
      head: this.currentSeq(),
    };
  }

  /**
   * Whether `role` may apply this change.
   *
   * Normally the collection's write permission decides, with two exceptions:
   *
   *  - Selling: a cashier/waiter has `sale:create` but not `catalog:write`, and
   *    completing a sale must decrement stock. So a product write is allowed
   *    when it changes `stockQuantity` alone and doesn't increase it.
   *  - Discounting: a receipt only needs `sale:create`, but a *discounted*
   *    receipt reprices the sale, so it additionally needs `discount:apply`.
   *    Otherwise a cashier's device could reduce a bill by writing the discount
   *    straight into the document.
   */
  private mayWrite(change: SyncChange, role: StoreRole, storedJson?: string): boolean {
    const disposition = syncWriteDisposition(role, change);
    if (disposition === "denied") return false;

    // Money must add up before it is stored. Permissions decide who may raise a
    // sale or a refund; this decides whether the document they sent is coherent,
    // which is what stops a bill being quietly reduced without a declared
    // discount. Tombstones carry no money to check.
    if (!change.deleted && !syncMoneyDocumentIsConsistent(change.collection, change.data)) {
      return false;
    }

    if (change.collection === "ingredient_movements") {
      const movement = ingredientMovementOf(change.data);
      if (!movement || movement.id !== change.id || SERVER_ONLY_REASONS.has(movement.reason)) {
        return false;
      }
      // A retry of a movement we already hold is acknowledged, never replayed.
      return !storedJson || (JSON.parse(storedJson) as { ingredientId?: string }).ingredientId === movement.ingredientId;
    }

    if (change.collection === "stock_movements") {
      const movement = stockMovementOf(change.data);
      if (!movement || movement.id !== change.id || movement.delta === 0) return false;
      return !storedJson || isMovementRetry(storedJson, movement);
    }

    if (disposition === "allowed") return true;

    // The only conditional case is a seller's product update. No stored doc
    // means this would create a product, and any non-stock change is rejected.
    if (change.collection === "products" && storedJson) {
      return isStockDecrementOnly(JSON.parse(storedJson), change.data);
    }

    return false;
  }

  // --- Diagnostics (temporary: correct wrong-dated receipts) -----------------

  /**
   * List all receipts with their stored createdAt timestamps, newest first.
   * Used to find receipts whose createdAt was stamped with a wrong terminal
   * clock and now appear on the wrong day in Reports.
   */
  diagListReceipts(): Array<{
    id: string;
    number: string;
    createdAt: number;
    createdAtIso: string;
    total: number;
    status: string;
  }> {
    const rows = this.db
      .select({ id: schema.documents.id, data: schema.documents.data })
      .from(schema.documents)
      .where(eq(schema.documents.collection, "receipts"))
      .all() as Array<{ id: string; data: string }>;

    const receipts = rows
      .map((row) => {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(row.data) as Record<string, unknown>;
        } catch {
          return null;
        }
        const createdAt = typeof data.createdAt === "number" ? data.createdAt : 0;
        return {
          id: row.id,
          number: typeof data.number === "string" ? data.number : "",
          createdAt,
          createdAtIso: new Date(createdAt).toISOString(),
          total: typeof data.total === "number" ? data.total : 0,
          status: typeof data.status === "string" ? data.status : "",
        };
      })
      .filter((r) => r !== null)
      .sort((a, b) => b.createdAt - a.createdAt);

    return receipts as Array<{
      id: string;
      number: string;
      createdAt: number;
      createdAtIso: string;
      total: number;
      status: string;
    }>;
  }

  /**
   * Correct a single receipt's createdAt timestamp. Used when a terminal's
   * clock was wrong and a sale was stamped with the wrong date.
   */
  diagCorrectReceiptDate(receiptId: string, newCreatedAt: number): boolean {
    const [row] = this.db
      .select({ data: schema.documents.data })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.collection, "receipts"),
          eq(schema.documents.id, receiptId),
        ),
      )
      .all() as Array<{ data: string }>;

    if (!row) return false;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      return false;
    }

    if (typeof data.deviceCreatedAt !== "number" && typeof data.createdAt === "number") {
      data.deviceCreatedAt = data.createdAt;
    }
    data.createdAt = newCreatedAt;
    data.updatedAt = Date.now();

    // A new server_seq is what makes phones pull the corrected date; without
    // it every device kept showing the sale on the wrong day.
    this.db
      .update(schema.documents)
      .set({ data: JSON.stringify(data), updatedAt: Date.now(), serverSeq: this.currentSeq() + 1 })
      .where(
        and(
          eq(schema.documents.collection, "receipts"),
          eq(schema.documents.id, receiptId),
        ),
      )
      .run();

    return true;
  }

  // --- Realtime (WebSocket) -------------------------------------------------

  /**
   * WebSocket upgrade for staff devices. The Worker forwards an authenticated
   * upgrade request here; every connected till then gets a nudge the instant
   * something changes, removing the 20s polling delay.
   *
   * Uses *hibernatable* WebSockets (`acceptWebSocket`) so the DO can be evicted
   * from memory while sockets stay open — connections cost nothing while idle.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    // Hibernation-aware accept: no in-memory handler needed to keep it alive.
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** Keepalive from clients; anything else is ignored. */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") ws.send("pong");
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // 1000 = normal closure; anything else we still just let go.
    try {
      ws.close(code === 1006 ? 1000 : code, reason);
    } catch {
      /* already gone */
    }
  }

  /**
   * Tell every connected till that something changed. The payload is only a
   * hint — devices respond by running a normal sync, which keeps one code path
   * for applying data and stays correct even if a message is missed.
   */
  private broadcast(event: string, detail?: unknown): void {
    const payload = JSON.stringify({ event, detail });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        /* drop dead sockets silently */
      }
    }
  }

  // --- VIP web ordering -----------------------------------------------------

  /**
   * Replace a pushed product's stock with the server's authoritative value.
   *
   * `null` stockQuantity stays null (untracked). Otherwise the server's current
   * value wins — or 0 for a product it has never seen, since its opening stock
   * arrives as an "initial" movement. Variant stocks follow the same rule,
   * matched by variant id. Every non-stock field is taken from the client.
   */
  private sanitizeProductStock(incoming: unknown, storedJson?: string): unknown {
    if (!incoming || typeof incoming !== "object") return incoming;
    const next = { ...(incoming as Record<string, unknown>) } as StoredProduct;
    const current = storedJson ? (JSON.parse(storedJson) as StoredProduct) : null;

    if (next.stockQuantity !== null && next.stockQuantity !== undefined) {
      next.stockQuantity =
        typeof current?.stockQuantity === "number" ? current.stockQuantity : 0;
    }

    if (Array.isArray(next.variants)) {
      next.variants = next.variants.map((variant) => {
        if (variant.stock === null || variant.stock === undefined) return variant;
        const currentVariant = current?.variants?.find((v) => v.id === variant.id);
        return {
          ...variant,
          stock: typeof currentVariant?.stock === "number" ? currentVariant.stock : 0,
        };
      });
    }
    return next;
  }

  /**
   * Apply one stock movement's signed delta to its product (or variant),
   * clamped at zero, and re-write the product doc so devices pull the corrected
   * stock. Untracked stock (null) is left alone. Returns the advanced seq.
   */
  private applyMovementDelta(movement: SyncChange, seq: number): number {
    const data = stockMovementOf(movement.data);
    if (!data || data.delta === 0) return seq;

    const [row] = this.db
      .select({ data: schema.documents.data })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.collection, "products"),
          eq(schema.documents.id, data.productId),
        ),
      )
      .all();
    if (!row) return seq; // can't move stock for a product the store doesn't have

    const product = JSON.parse(row.data) as StoredProduct;
    const precision = product.sellBy === "fraction" ? 1000 : 1;
    const rounded = (value: number) => Math.round(value * precision) / precision;
    let before: number | undefined;
    let resulting: number | undefined;
    let settingChanged = false;

    if (data.variantId) {
      const variant = product.variants?.find((candidate) => candidate.id === data.variantId);
      if (variant && variant.stock !== null && variant.stock !== undefined) {
        before = variant.stock;
        resulting = rounded(Math.max(0, variant.stock + data.delta));
        variant.stock = resulting;
        if (typeof data.autoUpdateStock === "boolean") {
          settingChanged = variant.autoUpdateStock !== data.autoUpdateStock;
          variant.autoUpdateStock = data.autoUpdateStock;
        }
      }
    } else if (product.stockQuantity !== null && product.stockQuantity !== undefined) {
      before = product.stockQuantity;
      resulting = rounded(Math.max(0, product.stockQuantity + data.delta));
      product.stockQuantity = resulting;
      if (typeof data.autoUpdateStock === "boolean") {
        settingChanged = product.autoUpdateStock !== data.autoUpdateStock;
        product.autoUpdateStock = data.autoUpdateStock;
      }
    }

    if (before === undefined || resulting === undefined) return seq;

    let nextSeq = seq;
    const now = Date.now();
    const canonicalUpdatedAt = Math.max(
      now,
      Math.min(movement.updatedAt, now + CLOCK_SKEW_MS),
    );
    if (resulting !== before || settingChanged) {
      nextSeq += 1;
      this.db
        .insert(schema.documents)
        .values({
          collection: "products",
          id: product.id,
          data: JSON.stringify(product),
          updatedAt: now,
          deleted: false,
          serverSeq: nextSeq,
        })
        .onConflictDoUpdate({
          target: [schema.documents.collection, schema.documents.id],
          set: { data: JSON.stringify(product), updatedAt: now, serverSeq: nextSeq },
        })
        .run();
    }

    // Replace the device's optimistic after-value with what this single-writer
    // store actually applied. If concurrent/offline activity forced a clamp,
    // retain the requested delta separately so the history remains explainable.
    const actualDelta = resulting - before;
    const normalized: StockMovement = {
      ...data,
      baseStock: before,
      delta: actualDelta,
      resulting,
      ...(actualDelta !== data.delta
        ? { requestedDelta: data.requestedDelta ?? data.delta }
        : {}),
    };
    nextSeq += 1;
    this.db
      .update(schema.documents)
      .set({
        data: JSON.stringify(normalized),
        updatedAt: canonicalUpdatedAt,
        serverSeq: nextSeq,
      })
      .where(
        and(
          eq(schema.documents.collection, "stock_movements"),
          eq(schema.documents.id, movement.id),
        ),
      )
      .run();

    return nextSeq;
  }

  // --- Delivery-app links (see modules/channels) ---------------------------

  /** Server-only key/value for delivery-app connections, links and state. */
  async channelKvGet(key: string): Promise<string | null> {
    return (await this.ctx.storage.get<string>(`channels:${key}`)) ?? null;
  }

  async channelKvPut(key: string, json: string | null): Promise<void> {
    if (json === null) await this.ctx.storage.delete(`channels:${key}`);
    else await this.ctx.storage.put(`channels:${key}`, json);
  }

  /** Live products, with just what availability needs. */
  async channelProducts(): Promise<
    { id: string; name: string; stockQuantity: number | null; variants?: { stock?: number | null }[]; isActive?: boolean }[]
  > {
    return this.docs<StoredProduct & { isActive?: boolean }>("products").map((p) => ({
      id: p.id,
      name: p.name,
      stockQuantity: p.stockQuantity ?? null,
      variants: p.variants?.map((v) => ({ stock: v.stock })),
      isActive: p.isActive,
    }));
  }

  // --- Discount control -----------------------------------------------------

  /**
   * Discounts are owner-only. A discounted sale from anyone else (an older app
   * build that still shows the button) is kept so the money stays on the
   * books, and written to the activity history under that person's name so
   * the owner sees exactly who discounted what. The id is derived from the
   * receipt, so a re-sent receipt is flagged once.
   */
  private flagUnauthorizedDiscount(
    receipt: unknown,
    seq: number,
    actor: StockActor | undefined,
    role: StoreRole,
  ): number {
    if (!syncReceiptHasDiscount(receipt)) return seq;
    const r = receipt as { id?: unknown; number?: unknown; total?: unknown; discountTotal?: unknown; currency?: unknown };
    if (typeof r.id !== "string") return seq;
    const id = `audit_disc_${r.id}`;
    if (this.doc("audit_log", id)) return seq;
    const naira = (minor: unknown) =>
      typeof minor === "number" ? `₦${Math.round(minor / 100).toLocaleString("en-NG")}` : "?";
    const next = seq + 1;
    this.writeDoc(
      "audit_log",
      id,
      {
        id,
        at: Date.now(),
        actorId: actor?.id,
        actorName: actor?.name ?? "Unknown staff",
        actorRole: role,
        action: "discount.unauthorized",
        entity: "receipt",
        entityId: r.id,
        summary: `NOT ALLOWED: ${actor?.name ?? "A staff member"} (${role}) gave a ${naira(
          r.discountTotal,
        )} discount on ${typeof r.number === "string" ? r.number : "a sale"} · paid ${naira(r.total)}`,
      },
      next,
    );
    return next;
  }

  /**
   * Refunds are owner-only. One from anyone else (an older build) is kept,
   * because the cash has already left the drawer, and flagged by name.
   */
  private flagUnauthorizedRefund(
    ret: unknown,
    seq: number,
    actor: StockActor | undefined,
    role: StoreRole,
  ): number {
    if (!ret || typeof ret !== "object") return seq;
    const r = ret as { id?: unknown; number?: unknown; receiptNumber?: unknown; total?: unknown };
    if (typeof r.id !== "string") return seq;
    const id = `audit_refund_${r.id}`;
    if (this.doc("audit_log", id)) return seq;
    const amount =
      typeof r.total === "number" ? `₦${Math.round(r.total / 100).toLocaleString("en-NG")}` : "a";
    const next = seq + 1;
    this.writeDoc(
      "audit_log",
      id,
      {
        id,
        at: Date.now(),
        actorId: actor?.id,
        actorName: actor?.name ?? "Unknown staff",
        actorRole: role,
        action: "refund.unauthorized",
        entity: "return",
        entityId: r.id,
        summary: `NOT ALLOWED: ${actor?.name ?? "A staff member"} (${role}) gave ${amount} refund${
          typeof r.receiptNumber === "string" ? ` on ${r.receiptNumber}` : ""
        }`,
      },
      next,
    );
    return next;
  }

  // --- VIP order stock ------------------------------------------------------

  /**
   * Move menu stock for a VIP order when staff act on it.
   *
   *  - Leaving "received" (accepted, ready or served) takes the items out of
   *    stock once, so the guest menu shows them sold out straight away.
   *  - Cancelling after that puts them back once.
   *
   * A brand-new order never touches stock: a prank or mistaken order costs
   * nothing until someone accepts it. Movement ids are derived from the order,
   * so a retried push moves nothing twice.
   */
  private syncWebOrderStock(
    orderId: string,
    prevStatus: WebOrderStatus | undefined,
    status: WebOrderStatus,
    seq: number,
    actor: StockActor | undefined,
    role: StoreRole,
  ): number {
    const order = this.doc<WebOrder>("web_orders", orderId);
    if (!order || prevStatus === status) return seq;

    const accept = status !== "received" && status !== "cancelled" && !order.stockDeductedAt;
    const restore = status === "cancelled" && !!order.stockDeductedAt && !order.stockRestoredAt;
    if (!accept && !restore) return seq;

    let next = seq;
    const now = Date.now();
    order.lines.forEach((line, index) => {
      const product = this.doc<StoredProduct>("products", line.productId);
      if (!product || line.quantity <= 0) return;
      const variant = line.variantId
        ? product.variants?.find((v) => v.id === line.variantId)
        : undefined;
      const tracked = line.variantId
        ? variant != null && variant.stock != null && variant.autoUpdateStock !== false
        : product.stockQuantity != null && product.autoUpdateStock !== false;
      if (!tracked) return;

      const id = `mov_vip${accept ? "" : "ret"}_${order.id}_${index}`;
      if (this.doc("stock_movements", id)) return;
      const movement: StockMovement = {
        id,
        productId: product.id,
        productName: product.name,
        ...(variant ? { variantId: variant.id, variantName: variant.name } : {}),
        reason: accept ? "sale" : "return",
        delta: accept ? -line.quantity : line.quantity,
        resulting: 0,
        at: now,
        ref: `vip:${order.id}`,
        note: accept
          ? `VIP order ${order.code} accepted (${order.tableName})`
          : `VIP order ${order.code} cancelled`,
        ...(actor
          ? { actorId: actor.id, actorName: actor.name, actorEmail: actor.email, actorRole: role }
          : {}),
      };
      next += 1;
      this.writeDoc("stock_movements", id, movement, next);
      next = this.applyMovementDelta(
        { collection: "stock_movements", id, data: movement, updatedAt: now, deleted: false },
        next,
      );
    });

    // Keep the order's own edit clock: bumping it to server time could make a
    // phone's next status change look older and get dropped.
    next += 1;
    const marked = { ...order, ...(accept ? { stockDeductedAt: now } : { stockRestoredAt: now }) };
    this.db
      .update(schema.documents)
      .set({ data: JSON.stringify(marked), serverSeq: next })
      .where(and(eq(schema.documents.collection, "web_orders"), eq(schema.documents.id, order.id)))
      .run();
    return next;
  }

  /**
   * True for a device "sale" movement that bills a VIP order whose stock the
   * server already took on acceptance. Older app builds still record one.
   */
  private isDuplicateVipSale(movement: SyncChange): boolean {
    const data = movement.data as { reason?: unknown; ref?: unknown } | null;
    if (!data || data.reason !== "sale" || typeof data.ref !== "string" || !data.ref) return false;
    const row = this.db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.collection, "web_orders"),
          sql`json_extract(${schema.documents.data}, '$.receiptId') = ${data.ref}`,
          sql`json_extract(${schema.documents.data}, '$.stockDeductedAt') IS NOT NULL`,
        ),
      )
      .get();
    return !!row;
  }

  // --- Ingredient ledger & central transfers ---------------------------------

  /** One stored document, decoded, or null. */
  private doc<T>(collection: string, id: string): T | null {
    const row = this.db
      .select({ data: schema.documents.data, deleted: schema.documents.deleted })
      .from(schema.documents)
      .where(and(eq(schema.documents.collection, collection), eq(schema.documents.id, id)))
      .get();
    return row && !row.deleted ? (JSON.parse(row.data) as T) : null;
  }

  /** Upsert one server-authored document at the next seq. */
  private writeDoc(collection: string, id: string, data: unknown, seq: number, deleted = false): void {
    const json = JSON.stringify(data);
    const now = Date.now();
    this.db
      .insert(schema.documents)
      .values({ collection, id, data: json, updatedAt: now, deleted, serverSeq: seq })
      .onConflictDoUpdate({
        target: [schema.documents.collection, schema.documents.id],
        set: { data: json, updatedAt: now, deleted, serverSeq: seq },
      })
      .run();
  }

  /**
   * Apply one ingredient movement to its ingredient and store the movement with
   * the balance the server actually applied. Stock never goes below zero; a
   * clamped request keeps its `requestedDelta` so the history explains itself.
   * Movements for an unknown ingredient are stored but move nothing.
   */
  private applyIngredientMovement(movement: IngredientMovement, seq: number): number {
    let next = seq;
    const ingredient = this.doc<Ingredient>("ingredients", movement.ingredientId);
    let normalized: IngredientMovement = movement;
    if (ingredient) {
      const { before, resulting, actual } = applyDelta(currentStock(ingredient), movement.delta);
      normalized = {
        ...movement,
        ingredientName: ingredient.name,
        baseStock: before,
        delta: actual,
        resulting,
        ...(actual !== movement.delta ? { requestedDelta: movement.delta } : {}),
      };
      if (actual !== 0 || ingredient.stock !== resulting) {
        next += 1;
        this.writeDoc("ingredients", ingredient.id, { ...ingredient, stock: resulting }, next);
      }
    }
    next += 1;
    this.writeDoc("ingredient_movements", movement.id, normalized, next);
    return next;
  }

  /**
   * Take each sold product's recipe out of ingredient stock. Movement ids are
   * derived from the receipt, so a receipt pushed twice deducts once.
   */
  private deductRecipesForReceipt(receipt: unknown, seq: number): number {
    if (!receipt || typeof receipt !== "object") return seq;
    const r = receipt as { id?: unknown; createdAt?: unknown; lines?: unknown };
    if (typeof r.id !== "string" || !Array.isArray(r.lines)) return seq;
    let next = seq;
    const at = typeof r.createdAt === "number" ? r.createdAt : Date.now();
    r.lines.forEach((raw, index) => {
      const line = raw as { productId?: unknown; qty?: unknown };
      if (typeof line.productId !== "string" || typeof line.qty !== "number" || line.qty <= 0) return;
      const product = this.doc<StoredProduct & { recipe?: RecipeLine[] }>("products", line.productId);
      if (!product?.recipe?.length) return;
      for (const part of product.recipe) {
        const used = Math.round(part.qty * (line.qty as number));
        if (!Number.isInteger(part.qty) || part.qty <= 0 || used <= 0) continue;
        const id = `ingmov_rcp_${r.id}_${index}_${part.ingredientId}`;
        if (this.doc("ingredient_movements", id)) continue;
        next = this.applyIngredientMovement(
          {
            id,
            ingredientId: part.ingredientId,
            ingredientName: "",
            reason: "recipe",
            delta: -used,
            resulting: 0,
            at,
            ref: r.id as string,
            note: `Sold ${line.qty} × ${product.name}`,
          },
          next,
        );
      }
    });
    return next;
  }

  /**
   * Central side of a transfer. Checks and deducts stock, records the outgoing
   * transfer and queues its delivery, all in one synchronous SQLite batch, so
   * the stock can never leave without a record of where it went. Repeating the
   * same transfer id returns the original and deducts nothing.
   */
  async dispatchTransfer(input: {
    id: string;
    ingredientId: string;
    quantity: number;
    fromStoreId: string;
    fromStoreName: string;
    toStoreId: string;
    toStoreName: string;
    note?: string;
    actor: { id: string; name: string; email?: string };
  }): Promise<
    | { ok: true; transfer: StockTransfer; duplicate: boolean; lowStock: boolean }
    | { ok: false; error: "unknown_ingredient" | "invalid_quantity" | "insufficient_stock"; available?: number }
  > {
    const existing = this.doc<StockTransfer>("stock_transfers", input.id);
    if (existing) {
      this.ctx.waitUntil(this.deliverPendingTransfers());
      return { ok: true, transfer: existing, duplicate: true, lowStock: false };
    }
    if (!Number.isInteger(input.quantity) || input.quantity < 1) {
      return { ok: false, error: "invalid_quantity" };
    }
    const ingredient = this.doc<Ingredient>("ingredients", input.ingredientId);
    if (!ingredient || ingredient.archived) return { ok: false, error: "unknown_ingredient" };
    const available = currentStock(ingredient);
    if (available < input.quantity) {
      return { ok: false, error: "insufficient_stock", available };
    }

    const now = Date.now();
    const note = input.note?.trim().slice(0, 240) || undefined;
    const transfer: StockTransfer = {
      id: input.id,
      direction: "out",
      status: "sent",
      fromStoreId: input.fromStoreId,
      fromStoreName: input.fromStoreName,
      toStoreId: input.toStoreId,
      toStoreName: input.toStoreName,
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      unit: ingredient.unit,
      quantity: input.quantity,
      ...(note ? { note } : {}),
      sentAt: now,
      actorId: input.actor.id,
      actorName: input.actor.name.slice(0, 120),
    };

    // No await from here to the end of the block: SQLite-backed DOs commit
    // these statements as one atomic write.
    let seq = this.currentSeq();
    seq = this.applyIngredientMovement(
      {
        id: `ingmov_tx_${input.id}`,
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        reason: "transfer_out",
        delta: -input.quantity,
        resulting: 0,
        at: now,
        ref: input.id,
        note: `Sent to ${input.toStoreName}`,
        actorId: input.actor.id,
        actorName: input.actor.name,
      },
      seq,
    );
    seq += 1;
    this.writeDoc("stock_transfers", transfer.id, transfer, seq);
    // The outbox lives in a collection no role can read, so it never syncs.
    seq += 1;
    this.writeDoc(TRANSFER_OUTBOX, transfer.id, { transferId: transfer.id, attempts: 0 }, seq);
    this.broadcast("changes");

    await this.ctx.storage.setAlarm(Date.now() + 1000);
    this.ctx.waitUntil(this.deliverPendingTransfers());

    const after = available - input.quantity;
    return {
      ok: true,
      transfer,
      duplicate: false,
      lowStock: available > ingredient.lowAt && after <= ingredient.lowAt,
    };
  }

  /**
   * Branch side of a transfer. Credits the branch's copy of the ingredient,
   * creating it on first delivery. Keyed by transfer id, so the central store
   * can retry delivery as often as it needs to.
   */
  async receiveTransfer(transfer: StockTransfer): Promise<{ ok: true; receivedAt: number }> {
    const existing = this.doc<StockTransfer>("stock_transfers", transfer.id);
    if (existing?.receivedAt) return { ok: true, receivedAt: existing.receivedAt };

    const localId = `ing_c_${transfer.ingredientId}`;
    let seq = this.currentSeq();
    if (!this.doc<Ingredient>("ingredients", localId)) {
      seq += 1;
      this.writeDoc(
        "ingredients",
        localId,
        {
          id: localId,
          name: transfer.ingredientName,
          unit: transfer.unit,
          stock: 0,
          lowAt: 0,
          sourceIngredientId: transfer.ingredientId,
          sourceStoreId: transfer.fromStoreId,
        } satisfies Ingredient,
        seq,
      );
    }
    const receivedAt = Date.now();
    seq = this.applyIngredientMovement(
      {
        id: `ingmov_tx_${transfer.id}`,
        ingredientId: localId,
        ingredientName: transfer.ingredientName,
        reason: "transfer_in",
        delta: transfer.quantity,
        resulting: 0,
        at: receivedAt,
        ref: transfer.id,
        note: `From ${transfer.fromStoreName}`,
        actorId: transfer.actorId,
        actorName: transfer.actorName,
      },
      seq,
    );
    seq += 1;
    this.writeDoc(
      "stock_transfers",
      transfer.id,
      { ...transfer, direction: "in", status: "received", ingredientId: localId, receivedAt } satisfies StockTransfer,
      seq,
    );
    this.broadcast("changes");
    return { ok: true, receivedAt };
  }

  /** Try to deliver every queued outgoing transfer. Safe to run concurrently. */
  private async deliverPendingTransfers(): Promise<void> {
    const queued = this.docs<{ transferId: string; attempts: number }>(TRANSFER_OUTBOX);
    let retryLater = false;
    for (const entry of queued) {
      const transfer = this.doc<StockTransfer>("stock_transfers", entry.transferId);
      if (!transfer) {
        this.writeDoc(TRANSFER_OUTBOX, entry.transferId, entry, this.currentSeq() + 1, true);
        continue;
      }
      try {
        const branch = this.env.STORE.get(this.env.STORE.idFromName(transfer.toStoreId));
        const { receivedAt } = await branch.receiveTransfer(transfer);
        let seq = this.currentSeq() + 1;
        this.writeDoc("stock_transfers", transfer.id, { ...transfer, status: "received", receivedAt }, seq);
        seq += 1;
        this.writeDoc(TRANSFER_OUTBOX, transfer.id, entry, seq, true);
        this.broadcast("changes");
      } catch {
        retryLater = true;
        this.writeDoc(
          TRANSFER_OUTBOX,
          transfer.id,
          { ...entry, attempts: entry.attempts + 1 },
          this.currentSeq() + 1,
        );
      }
    }
    if (retryLater) {
      const attempts = Math.max(1, ...queued.map((q) => q.attempts + 1));
      // 2s, 4s, 8s ... capped at 5 minutes.
      await this.ctx.storage.setAlarm(Date.now() + Math.min(300_000, 1000 * 2 ** attempts));
    }
  }

  /** Retries transfer deliveries that failed or were cut off. */
  override async alarm(): Promise<void> {
    await this.deliverPendingTransfers();
  }

  /** This store's ingredients and transfers, for the Worker's list endpoints. */
  async stockOverview(): Promise<{ ingredients: Ingredient[]; transfers: StockTransfer[] }> {
    const transfers = this.docs<StockTransfer>("stock_transfers").sort((a, b) => b.sentAt - a.sentAt);
    return {
      ingredients: this.docs<Ingredient>("ingredients").filter((i) => !i.archived),
      transfers: transfers.slice(0, 200),
    };
  }

  /**
   * One-off import of a legacy D1 central balance as an opening movement.
   * Keyed by the legacy item id, so running the migration twice is harmless.
   */
  async importLegacyStock(input: {
    ingredient: Ingredient;
    quantity: number;
    actor: { id: string; name: string };
  }): Promise<{ ok: true; duplicate: boolean }> {
    const movementId = `ingmov_legacy_${input.ingredient.id}`;
    if (this.doc("ingredient_movements", movementId)) return { ok: true, duplicate: true };
    let seq = this.currentSeq();
    if (!this.doc<Ingredient>("ingredients", input.ingredient.id)) {
      seq += 1;
      this.writeDoc("ingredients", input.ingredient.id, { ...input.ingredient, stock: 0 }, seq);
    }
    if (input.quantity > 0) {
      seq = this.applyIngredientMovement(
        {
          id: movementId,
          ingredientId: input.ingredient.id,
          ingredientName: input.ingredient.name,
          reason: "initial",
          delta: input.quantity,
          resulting: 0,
          at: Date.now(),
          note: "Opening balance moved from the old central stock",
          actorId: input.actor.id,
          actorName: input.actor.name,
        },
        seq,
      );
    } else {
      seq += 1;
      this.writeDoc(
        "ingredient_movements",
        movementId,
        { id: movementId, ingredientId: input.ingredient.id, ingredientName: input.ingredient.name, reason: "initial", delta: 0, resulting: 0, at: Date.now() },
        seq,
        true,
      );
    }
    this.broadcast("changes");
    return { ok: true, duplicate: false };
  }

  /** Live documents of one collection, decoded. Internal helper. */
  private docs<T>(collection: string): T[] {
    return this.db
      .select({ data: schema.documents.data })
      .from(schema.documents)
      .where(
        and(eq(schema.documents.collection, collection), eq(schema.documents.deleted, false)),
      )
      .all()
      .map((r) => JSON.parse(r.data) as T);
  }

  /**
   * Menu for the public VIP page. Deliberately narrow: no cost prices, no stock
   * numbers, no inactive items — just what a guest needs to order.
   */
  async publicMenu(tableId: string, storeName: string, currency: string): Promise<PublicMenu | null> {
    const tables = this.docs<{ id: string; name: string }>("tables");
    const table = tables.find((t) => t.id === tableId);
    if (!table) return null;

    const categories = this.docs<{ id: string; name: string }>("categories").map((c) => ({
      id: c.id,
      name: c.name,
    }));

    const items = this.docs<StoredProduct>("products").map((p) => {
      const variants = p.variants?.length
        ? p.variants.map((variant) => ({
            id: variant.id,
            name: variant.name,
            // Guests pay the table-service price; see VIP_MARKUP_BPS.
            price: guestPrice(variant.price),
            available: variant.stock == null || variant.stock > 0,
          }))
        : undefined;
      return {
        id: p.id,
        name: p.name,
        price: guestPrice(p.price),
        categoryId: p.categoryId,
        variants,
        // Variant products are available when at least one choice is sellable.
        // null simple stock means "not tracked", which is still sellable.
        available: variants
          ? variants.some((variant) => variant.available)
          : p.stockQuantity == null || p.stockQuantity > 0,
      };
    });

    return { storeName, currency, tableName: table.name, categories, items };
  }

  /**
   * Accept an order from the VIP page. Prices and totals are resolved here from
   * the store's own catalog — the browser only sends product ids and quantities,
   * so a tampered client cannot change what anything costs.
   */
  async placeWebOrder(
    tableId: string,
    request: PlaceWebOrderRequest,
    currency = "NGN",
  ): Promise<{ ok: true; order: WebOrder } | { ok: false; error: string }> {
    const table = this.docs<{ id: string; name: string }>("tables").find((t) => t.id === tableId);
    if (!table) return { ok: false, error: "unknown_table" };

    // Abuse guard. The VIP endpoint is public, so cap how fast one table can
    // submit orders. Done in-memory here rather than with a Cloudflare WAF rule
    // because WAF rate limiting needs a custom domain (a zone) — this costs
    // nothing extra since the DO is already handling the request. A real guest
    // ordering a few rounds stays well under the limit.
    const now = Date.now();
    const recent = (this.orderRate.get(tableId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX_ORDERS) {
      return { ok: false, error: "rate_limited" };
    }
    recent.push(now);
    this.orderRate.set(tableId, recent);

    const catalog = this.docs<StoredProduct>("products");

    type ResolvedLine = {
      productId: string;
      variantId?: string;
      variantName?: string;
      name: string;
      unitPrice: number;
      quantity: number;
      stock: number | null | undefined;
      note?: string;
    };
    const requested = new Map<string, ResolvedLine>();

    for (const wanted of request.items) {
      const product = catalog.find((p) => p.id === wanted.productId);
      if (!product) continue; // preserve legacy behavior for unknown product ids

      const hasVariants = !!product.variants?.length;
      if (hasVariants && !wanted.variantId) return { ok: false, error: "missing_variant" };
      if (!hasVariants && wanted.variantId) return { ok: false, error: "unexpected_variant" };

      const variant = hasVariants
        ? product.variants!.find((candidate) => candidate.id === wanted.variantId)
        : undefined;
      if (hasVariants && !variant) return { ok: false, error: "invalid_variant" };

      const qty = Math.max(1, Math.min(99, Math.floor(wanted.quantity)));
      const key = JSON.stringify([product.id, variant?.id ?? null]);
      const existing = requested.get(key);
      const quantity = (existing?.quantity ?? 0) + qty;
      const stock = variant ? variant.stock : product.stockQuantity;

      // Aggregate duplicates before checking stock, otherwise two individually
      // valid lines could together order more than is available.
      if (stock != null && quantity > stock) return { ok: false, error: "insufficient_stock" };

      requested.set(key, {
        productId: product.id,
        variantId: variant?.id,
        variantName: variant?.name,
        name: product.name,
        // Same markup the guest menu showed; see VIP_MARKUP_BPS.
        unitPrice: guestPrice(variant?.price ?? product.price),
        quantity,
        stock,
        note: existing?.note ?? wanted.note?.slice(0, 140),
      });
    }

    const lines: WebOrderLine[] = [...requested.values()].map(({ stock: _stock, ...line }) => ({
      ...line,
      lineTotal: line.unitPrice * line.quantity,
    }));

    if (lines.length === 0) return { ok: false, error: "no_valid_items" };

    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const order: WebOrder = {
      id: `web_${now}_${Math.floor(Math.random() * 1e4)}`,
      code: `V-${Math.floor(1000 + Math.random() * 9000)}`,
      tableId,
      tableName: table.name,
      status: "received",
      lines,
      subtotal,
      total: subtotal,
      currency,
      guestName: request.guestName?.slice(0, 60),
      guestPhone: request.guestPhone?.slice(0, 24),
      note: request.note?.slice(0, 200),
      createdAt: now,
      updatedAt: now,
    };

    // Written through the same document store, so it reaches the POS on sync.
    const seq = this.currentSeq() + 1;
    this.db
      .insert(schema.documents)
      .values({
        collection: "web_orders",
        id: order.id,
        data: JSON.stringify(order),
        updatedAt: now,
        deleted: false,
        serverSeq: seq,
      })
      .run();

    // Nudge every connected till immediately — this is what makes a VIP order
    // appear (and chime) in about a second instead of on the next poll.
    this.broadcast("web_order", { code: order.code, tableName: order.tableName });

    return { ok: true, order };
  }

  // --- Public integration API -----------------------------------------------

  /** Shape a stored product into the stable public API shape. */
  private toApiProduct(p: StoredProduct, categoryName?: string, updatedAt = 0): ApiProduct {
    return {
      id: p.id,
      name: p.name,
      price: p.price,
      currency: p.currency ?? "NGN",
      categoryId: p.categoryId,
      categoryName,
      sku: p.sku,
      barcode: p.barcode,
      stock: p.stockQuantity ?? null,
      lowStockAt: p.lowStockAt,
      stockState: stockStateOf(p),
      available: p.stockQuantity === null || (p.stockQuantity ?? 0) > 0,
      updatedAt,
    };
  }

  /** Catalog for integrators, with resolved category names and stock state. */
  async apiProducts(): Promise<ApiProduct[]> {
    const categories = new Map(
      this.docs<{ id: string; name: string }>("categories").map((c) => [c.id, c.name]),
    );
    const rows = this.db
      .select({ data: schema.documents.data, updatedAt: schema.documents.updatedAt })
      .from(schema.documents)
      .where(
        and(eq(schema.documents.collection, "products"), eq(schema.documents.deleted, false)),
      )
      .all();

    return rows.map((r) => {
      const p = JSON.parse(r.data) as StoredProduct;
      return this.toApiProduct(p, p.categoryId ? categories.get(p.categoryId) : undefined, r.updatedAt);
    });
  }

  async apiCategories(): Promise<ApiCategory[]> {
    const products = this.docs<StoredProduct>("products");
    return this.docs<{ id: string; name: string }>("categories").map((c) => ({
      id: c.id,
      name: c.name,
      productCount: products.filter((p) => p.categoryId === c.id).length,
    }));
  }

  /**
   * Apply a stock change from an external system (delivery app marking items
   * sold, warehouse recording a delivery).
   *
   * Authoritative here rather than in the caller: we read the current value,
   * apply the delta, clamp at zero, log a movement for the audit trail, and
   * return the before/after so the Worker can emit the right events.
   */
  async apiAdjustStock(
    adjustments: ApiStockAdjustment[],
    source: string,
  ): Promise<{ applied: StockTransition[]; unknown: string[] }> {
    const applied: StockTransition[] = [];
    const unknown: string[] = [];
    let seq = this.currentSeq();
    const now = Date.now();

    // Statements auto-commit individually (see the note in push()): an
    // integrator batch interrupted mid-way leaves applied rows consistent and
    // unapplied ones retryable, since each adjustment is its own idempotent
    // product write + uniquely-keyed movement.
    for (const adj of adjustments) {
      const [row] = this.db
        .select({ data: schema.documents.data })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.collection, "products"),
            eq(schema.documents.id, adj.productId),
          ),
        )
        .all();

      if (!row) {
        unknown.push(adj.productId);
        continue;
      }

      const product = JSON.parse(row.data) as StoredProduct;
      const previous = product.stockQuantity;

      // An untracked item can't be adjusted without first being tracked.
      if (previous === null || previous === undefined) {
        unknown.push(adj.productId);
        continue;
      }

      const next =
        adj.stock !== undefined
          ? Math.max(0, Math.round(adj.stock))
          : Math.max(0, previous + Math.round(adj.delta ?? 0));
      if (next === previous) continue;

      const updated: StoredProduct = { ...product, stockQuantity: next };

      seq += 1;
      this.db
        .insert(schema.documents)
        .values({
          collection: "products",
          id: product.id,
          data: JSON.stringify(updated),
          updatedAt: now,
          deleted: false,
          serverSeq: seq,
        })
        .onConflictDoUpdate({
          target: [schema.documents.collection, schema.documents.id],
          set: { data: JSON.stringify(updated), updatedAt: now, serverSeq: seq },
        })
        .run();

      // Audit trail, same shape the POS writes.
      seq += 1;
      const movementId = `mov_api_${now}_${Math.floor(Math.random() * 1e4)}`;
      this.db
        .insert(schema.documents)
        .values({
          collection: "stock_movements",
          id: movementId,
          data: JSON.stringify({
            id: movementId,
            productId: product.id,
            productName: product.name,
            reason: adj.reason ?? "adjustment",
            delta: next - previous,
            baseStock: previous,
            resulting: next,
            at: now,
            ref: `api:${source}`,
            note: adj.note,
            actorName: `Integration · ${source}`,
          }),
          updatedAt: now,
          deleted: false,
          serverSeq: seq,
        })
        .run();

      applied.push({
        productId: product.id,
        name: product.name,
        previousStock: previous,
        stock: next,
        lowStockAt: product.lowStockAt,
        stockState: stockStateOf(updated),
      });
    }

    if (applied.length > 0) {
      // Tills see the new stock straight away.
      this.broadcast("changes");
    }

    return { applied, unknown };
  }

  /**
   * Receive a central-warehouse delivery into this store's stock.
   *
   * Called server-side by the inventory allocation fulfill path (never by
   * devices directly). It raises one tracked simple product by an integer
   * quantity and logs a `restock` movement with the allocation as its
   * reference, so the delivery shows in the product's history timeline and
   * syncs to every till like any other stock change.
   *
   * Product resolution: explicit `productId` wins; otherwise the first live
   * product whose name matches `globalItemName` case-insensitively is used.
   * Products with variants are refused — the caller must name the variant —
   * because raising the parent's simple balance would misstate what can sell.
   */
  async receiveCentralDelivery(input: {
    productId?: string;
    globalItemName: string;
    quantity: number;
    ref: string;
    note?: string;
    actor: { id: string; name: string; email?: string; role?: string };
  }): Promise<
    | { ok: true; duplicate?: boolean; productId: string; productName: string; previousStock: number; stock: number }
    | { ok: false; error: "unknown_product" | "untracked_product" | "product_has_variants" | "invalid_quantity" }
  > {
    const quantity = Math.round(input.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: "invalid_quantity" };
    }

    // The allocation id is the idempotency key. A phone that timed out may
    // retry while the first call is still in flight; without this, both would
    // add the delivery and the branch would be overstocked. The movement id is
    // therefore deterministic, and finding it means "already applied".
    const movementId = `mov_central_${input.ref}`;
    const already = this.db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.collection, "stock_movements"),
          eq(schema.documents.id, movementId),
        ),
      )
      .get();
    if (already) {
      return {
        ok: true,
        duplicate: true,
        productId: input.productId ?? "",
        productName: input.globalItemName,
        previousStock: 0,
        stock: 0,
      };
    }

    const live = this.db
      .select({ id: schema.documents.id, data: schema.documents.data })
      .from(schema.documents)
      .where(
        and(eq(schema.documents.collection, "products"), eq(schema.documents.deleted, false)),
      )
      .all();

    let match: { id: string; product: StoredProduct } | null = null;
    if (input.productId) {
      const row = live.find((r) => r.id === input.productId);
      if (row) match = { id: row.id, product: JSON.parse(row.data) as StoredProduct };
    } else {
      const wanted = input.globalItemName.trim().toLowerCase();
      for (const row of live) {
        const product = JSON.parse(row.data) as StoredProduct;
        if (product.name.trim().toLowerCase() === wanted) {
          match = { id: row.id, product };
          break;
        }
      }
    }

    if (!match) return { ok: false, error: "unknown_product" };
    const { product } = match;
    if (product.variants?.length) return { ok: false, error: "product_has_variants" };
    const previous = product.stockQuantity;
    if (previous === null || previous === undefined) {
      return { ok: false, error: "untracked_product" };
    }

    const next = previous + quantity;
    const updated: StoredProduct = { ...product, stockQuantity: next };
    let seq = this.currentSeq();
    const now = Date.now();

    seq += 1;
    this.db
      .insert(schema.documents)
      .values({
        collection: "products",
        id: product.id,
        data: JSON.stringify(updated),
        updatedAt: now,
        deleted: false,
        serverSeq: seq,
      })
      .onConflictDoUpdate({
        target: [schema.documents.collection, schema.documents.id],
        set: { data: JSON.stringify(updated), updatedAt: now, serverSeq: seq },
      })
      .run();

    seq += 1;
    this.db
      .insert(schema.documents)
      .values({
        collection: "stock_movements",
        id: movementId,
        data: JSON.stringify({
          id: movementId,
          productId: product.id,
          productName: product.name,
          reason: "restock",
          delta: quantity,
          baseStock: previous,
          resulting: next,
          at: now,
          ref: `central:${input.ref}`,
          note: (input.note ?? `Central delivery of ${quantity} × ${input.globalItemName}`).slice(0, 240),
          actorId: input.actor.id,
          actorName: input.actor.name,
          actorEmail: input.actor.email,
          actorRole: input.actor.role,
        }),
        updatedAt: now,
        deleted: false,
        serverSeq: seq,
      })
      .run();

    this.broadcast("changes");
    return { ok: true, productId: product.id, productName: product.name, previousStock: previous, stock: next };
  }

  /**
   * Raise one product's stock for a Stock Room conversion.
   *
   * Called server-side only, never by devices. `ref` is the conversion id and
   * the movement id is derived from it, so a retried request cannot add the
   * same stock twice. The product must exist, track stock, and be a simple item
   * (a parent with variants would misstate what can sell).
   */
  async addProductStock(input: {
    productId: string;
    quantity: number;
    ref: string;
    note?: string;
    actor: { id: string; name: string; email?: string; role?: string };
  }): Promise<
    | {
        ok: true;
        duplicate: boolean;
        productId: string;
        productName: string;
        previousStock: number;
        stock: number;
      }
    | {
        ok: false;
        error: "unknown_product" | "untracked_product" | "product_has_variants" | "invalid_quantity";
      }
  > {
    const quantity = Math.round(input.quantity);
    if (!Number.isFinite(quantity) || quantity < 1) {
      return { ok: false, error: "invalid_quantity" };
    }

    const [productRow] = this.db
      .select({ data: schema.documents.data })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.collection, "products"),
          eq(schema.documents.id, input.productId),
        ),
      )
      .all();

    if (!productRow) return { ok: false, error: "unknown_product" };
    const product = JSON.parse(productRow.data) as StoredProduct;
    if (product.variants?.length) return { ok: false, error: "product_has_variants" };
    const previous = product.stockQuantity;
    if (previous === null || previous === undefined) {
      return { ok: false, error: "untracked_product" };
    }

    const movementId = `mov_conv_${input.ref}`;
    const already = this.db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.collection, "stock_movements"),
          eq(schema.documents.id, movementId),
        ),
      )
      .get();
    if (already) {
      return {
        ok: true,
        duplicate: true,
        productId: product.id,
        productName: product.name,
        previousStock: previous,
        stock: previous,
      };
    }

    const next = previous + quantity;
    const updated: StoredProduct = { ...product, stockQuantity: next };
    let seq = this.currentSeq();
    const now = Date.now();

    seq += 1;
    this.db
      .insert(schema.documents)
      .values({
        collection: "products",
        id: product.id,
        data: JSON.stringify(updated),
        updatedAt: now,
        deleted: false,
        serverSeq: seq,
      })
      .onConflictDoUpdate({
        target: [schema.documents.collection, schema.documents.id],
        set: { data: JSON.stringify(updated), updatedAt: now, serverSeq: seq },
      })
      .run();

    seq += 1;
    this.db
      .insert(schema.documents)
      .values({
        collection: "stock_movements",
        id: movementId,
        data: JSON.stringify({
          id: movementId,
          productId: product.id,
          productName: product.name,
          reason: "restock",
          delta: quantity,
          baseStock: previous,
          resulting: next,
          at: now,
          ref: `stockroom:${input.ref}`,
          note: (input.note ?? `Stock Room conversion of ${quantity}`).slice(0, 240),
          actorId: input.actor.id,
          actorName: input.actor.name,
          actorEmail: input.actor.email,
          actorRole: input.actor.role,
        }),
        updatedAt: now,
        deleted: false,
        serverSeq: seq,
      })
      .run();

    this.broadcast("changes");
    return {
      ok: true,
      duplicate: false,
      productId: product.id,
      productName: product.name,
      previousStock: previous,
      stock: next,
    };
  }

  /**
   * Record one production run: consume `inputQty` of one tracked product and
   * add `outputQty` of another.
   *
   * Both stock writes happen in one SQLite transaction, so a failure can never
   * leave the input consumed without the output credited. `ref` is the client's
   * idempotency key: if the phone timed out after the write, repeating the same
   * run returns `duplicate` instead of producing a second batch.
   *
   * Products are looked up by primary key rather than scanning the catalog —
   * the branch may hold hundreds of products and this is on the hot path.
   */
  async produceFromStock(input: {
    inputProductId: string;
    outputProductId: string;
    inputQty: number;
    outputQty: number;
    ref: string;
    note?: string;
    actor: { id: string; name: string; email?: string; role?: string };
  }): Promise<
    | {
        ok: true;
        duplicate?: boolean;
        inputName: string;
        outputName: string;
        inputStock: number;
        outputStock: number;
      }
    | {
        ok: false;
        error:
          | "unknown_product"
          | "untracked_product"
          | "product_has_variants"
          | "invalid_quantity"
          | "same_product"
          | "insufficient_stock";
        available?: number;
      }
  > {
    const inputQty = Math.round(input.inputQty);
    const outputQty = Math.round(input.outputQty);
    if (
      !Number.isFinite(inputQty) ||
      inputQty <= 0 ||
      !Number.isFinite(outputQty) ||
      outputQty <= 0
    ) {
      return { ok: false, error: "invalid_quantity" };
    }
    if (input.inputProductId === input.outputProductId) {
      return { ok: false, error: "same_product" };
    }

    const loadProduct = (id: string): StoredProduct | null => {
      const row = this.db
        .select({ data: schema.documents.data })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.collection, "products"),
            eq(schema.documents.id, id),
            eq(schema.documents.deleted, false),
          ),
        )
        .get();
      return row ? (JSON.parse(row.data) as StoredProduct) : null;
    };

    const outMovementId = `mov_prod_${input.ref}_out`;
    const already = this.db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.collection, "stock_movements"),
          eq(schema.documents.id, outMovementId),
        ),
      )
      .get();
    if (already) {
      return {
        ok: true,
        duplicate: true,
        inputName: "",
        outputName: "",
        inputStock: 0,
        outputStock: 0,
      };
    }

    const from = loadProduct(input.inputProductId);
    const to = loadProduct(input.outputProductId);
    if (!from || !to) return { ok: false, error: "unknown_product" };
    if (from.variants?.length || to.variants?.length) {
      return { ok: false, error: "product_has_variants" };
    }

    const fromStock = from.stockQuantity;
    const toStock = to.stockQuantity;
    if (fromStock === null || fromStock === undefined || toStock === null || toStock === undefined) {
      return { ok: false, error: "untracked_product" };
    }
    if (fromStock < inputQty) {
      return { ok: false, error: "insufficient_stock", available: fromStock };
    }

    const nextFrom = fromStock - inputQty;
    const nextTo = toStock + outputQty;
    const now = Date.now();
    const note = input.note?.trim().slice(0, 240) || `${inputQty} ${from.name} used to make ${outputQty} ${to.name}`;
    let seq = this.currentSeq();

    this.db.transaction((tx) => {
      seq += 1;
      tx.insert(schema.documents)
        .values({
          collection: "products",
          id: from.id,
          data: JSON.stringify({ ...from, stockQuantity: nextFrom }),
          updatedAt: now,
          deleted: false,
          serverSeq: seq,
        })
        .onConflictDoUpdate({
          target: [schema.documents.collection, schema.documents.id],
          set: {
            data: JSON.stringify({ ...from, stockQuantity: nextFrom }),
            updatedAt: now,
            serverSeq: seq,
          },
        })
        .run();

      seq += 1;
      tx.insert(schema.documents)
        .values({
          collection: "stock_movements",
          id: outMovementId,
          data: JSON.stringify({
            id: outMovementId,
            productId: from.id,
            productName: from.name,
            reason: "production_out",
            delta: -inputQty,
            baseStock: fromStock,
            resulting: nextFrom,
            at: now,
            ref: `production:${input.ref}`,
            note: note.slice(0, 240),
            actorId: input.actor.id,
            actorName: input.actor.name,
            actorEmail: input.actor.email,
            actorRole: input.actor.role,
          }),
          updatedAt: now,
          deleted: false,
          serverSeq: seq,
        })
        .run();

      seq += 1;
      tx.insert(schema.documents)
        .values({
          collection: "products",
          id: to.id,
          data: JSON.stringify({ ...to, stockQuantity: nextTo }),
          updatedAt: now,
          deleted: false,
          serverSeq: seq,
        })
        .onConflictDoUpdate({
          target: [schema.documents.collection, schema.documents.id],
          set: {
            data: JSON.stringify({ ...to, stockQuantity: nextTo }),
            updatedAt: now,
            serverSeq: seq,
          },
        })
        .run();

      seq += 1;
      tx.insert(schema.documents)
        .values({
          collection: "stock_movements",
          id: `mov_prod_${input.ref}_in`,
          data: JSON.stringify({
            id: `mov_prod_${input.ref}_in`,
            productId: to.id,
            productName: to.name,
            reason: "production_in",
            delta: outputQty,
            baseStock: toStock,
            resulting: nextTo,
            at: now,
            ref: `production:${input.ref}`,
            note: note.slice(0, 240),
            actorId: input.actor.id,
            actorName: input.actor.name,
            actorEmail: input.actor.email,
            actorRole: input.actor.role,
          }),
          updatedAt: now,
          deleted: false,
          serverSeq: seq,
        })
        .run();
    });

    this.broadcast("changes");
    return {
      ok: true,
      inputName: from.name,
      outputName: to.name,
      inputStock: nextFrom,
      outputStock: nextTo,
    };
  }

  /**
   * Raw document changes since a sequence, for the public events feed. Reuses
   * the same monotonic `server_seq` the device sync uses, so integrators get an
   * exactly-resumable cursor for free.
   */
  async apiChangesSince(
    cursor: number,
    limit = 100,
  ): Promise<{
    rows: {
      collection: string;
      id: string;
      data: string;
      deleted: boolean;
      updatedAt: number;
      seq: number;
    }[];
    cursor: number;
    hasMore: boolean;
  }> {
    const rows = this.db
      .select()
      .from(schema.documents)
      .where(gt(schema.documents.serverSeq, cursor))
      .orderBy(schema.documents.serverSeq)
      .limit(limit + 1)
      .all();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      rows: page.map((r) => ({
        collection: r.collection,
        id: r.id,
        data: r.data,
        deleted: r.deleted,
        updatedAt: r.updatedAt,
        seq: r.serverSeq,
      })),
      cursor: page.length ? page[page.length - 1]!.serverSeq : cursor,
      hasMore,
    };
  }

  /** Diagnostics: number of live (non-deleted) documents per collection. */
  async stats(): Promise<Record<string, number>> {
    const rows = this.db
      .select({
        collection: schema.documents.collection,
        count: sql<number>`count(*)`,
      })
      .from(schema.documents)
      .where(eq(schema.documents.deleted, false))
      .groupBy(schema.documents.collection)
      .all();
    return Object.fromEntries(rows.map((r) => [r.collection, r.count]));
  }

  /**
   * Bulk-insert catalog documents for a brand-new store.
   *
   * Exists because standing up a shop from a supplier price list means writing
   * dozens of products, and the only other route in is a device typing them one
   * at a time. Documents are stored opaquely, so this takes them as-is and does
   * not validate their shape — the caller is responsible for sending exactly
   * what the app expects to read back.
   *
   * Skips any id that already exists rather than overwriting, so a retry after a
   * half-finished run cannot duplicate rows or clobber later edits. Each write
   * takes its own monotonic seq so devices pull them in order.
   *
   * Stock is written straight onto the product documents, which is where the app
   * reads it from; no opening `stock_movements` are logged, so a new shop starts
   * with a blank movement history.
   *
   * Has NO CALLER. Driven once by a temporary operator route that has since been
   * removed, and kept because bulk catalog import is an obvious future feature.
   */
  async seedCatalog(input: {
    categories?: { id: string }[];
    products?: { id: string }[];
  }): Promise<{ written: Record<string, number>; skipped: number }> {
    let seq = this.currentSeq();
    const now = Date.now();
    const written: Record<string, number> = {};
    let skipped = 0;

    const write = (collection: string, doc: { id: string }) => {
      const [existing] = this.db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(eq(schema.documents.collection, collection), eq(schema.documents.id, doc.id)),
        )
        .all();
      if (existing) {
        skipped += 1;
        return;
      }
      seq += 1;
      this.db
        .insert(schema.documents)
        .values({
          collection,
          id: doc.id,
          data: JSON.stringify(doc),
          updatedAt: now,
          deleted: false,
          serverSeq: seq,
        })
        .run();
      written[collection] = (written[collection] ?? 0) + 1;
    };

    for (const category of input.categories ?? []) write("categories", category);
    for (const product of input.products ?? []) write("products", product);

    return { written, skipped };
  }

  /**
   * Current live products, for keeping a copy before `replaceProducts`.
   *
   * Returned as a JSON string: the RPC boundary's serializable types reject an
   * array of index-signature objects, and the documents are opaque here anyway.
   */
  async exportProducts(): Promise<{ json: string }> {
    return { json: JSON.stringify(this.docs<unknown>("products")) };
  }

  /**
   * Swap a store's product list wholesale: tombstone every current product,
   * then insert the supplied ones. Categories and everything else are left
   * alone.
   *
   * Tombstones rather than DELETE, because a device only learns of a change by
   * pulling rows newer than its cursor — a hard delete leaves nothing to pull
   * and every till would keep showing the old menu forever. Each write takes its
   * own monotonic seq so the pull pages in order.
   *
   * Ids in `products` that match an existing row are updated in place rather
   * than tombstoned, so re-running with the same payload is idempotent.
   */
  async replaceProducts(input: {
    products: { id: string }[];
  }): Promise<{ removed: number; written: number }> {
    const incoming = new Map(input.products.map((p) => [p.id, p]));
    let seq = this.currentSeq();
    const now = Date.now();

    const live = this.db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.collection, "products"),
          eq(schema.documents.deleted, false),
        ),
      )
      .all();

    let removed = 0;
    for (const row of live) {
      if (incoming.has(row.id)) continue;
      seq += 1;
      this.db
        .update(schema.documents)
        .set({
          deleted: true,
          data: JSON.stringify({ id: row.id }),
          updatedAt: now,
          serverSeq: seq,
        })
        .where(
          and(eq(schema.documents.collection, "products"), eq(schema.documents.id, row.id)),
        )
        .run();
      removed += 1;
    }

    let written = 0;
    for (const product of input.products) {
      seq += 1;
      this.db
        .insert(schema.documents)
        .values({
          collection: "products",
          id: product.id,
          data: JSON.stringify(product),
          updatedAt: now,
          deleted: false,
          serverSeq: seq,
        })
        .onConflictDoUpdate({
          target: [schema.documents.collection, schema.documents.id],
          set: {
            data: JSON.stringify(product),
            updatedAt: now,
            deleted: false,
            serverSeq: seq,
          },
        })
        .run();
      written += 1;
    }

    return { removed, written };
  }

  /**
   * Every live row in the trading collections, for taking a backup before
   * `clearSales` destroys them. Read-only.
   */
  async exportSales(): Promise<{
    rows: { collection: string; id: string; data: string; updatedAt: number }[];
  }> {
    const rows = this.db
      .select({
        collection: schema.documents.collection,
        id: schema.documents.id,
        data: schema.documents.data,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.deleted, false),
          inArray(schema.documents.collection, [...SALES_COLLECTIONS]),
        ),
      )
      .all();
    return { rows };
  }

  /**
   * Hand this store over with a clean trading history: erase every sale, refund,
   * VIP order, held ticket, stock movement and audit entry, and keep the whole
   * catalog. Irreversible — take `exportSales` first.
   *
   * Has NO CALLER. Driven once by a temporary operator route that has since been
   * removed, and kept because "start a fresh set of books" is a plausible
   * owner-facing feature. Wire it to something owner-only and confirmation-gated.
   *
   * Tombstones rather than DELETE. A device only learns of a change by pulling
   * rows with `server_seq > cursor`, so a hard delete leaves nothing to pull and
   * every till would keep showing its own local copy of the old sales forever.
   * Each tombstone takes its own monotonic seq so pull pages in order, and
   * arrives with `dirty = 0` so no device re-uploads what it just dropped.
   *
   * The row's payload is replaced with a bare id. Devices never read the body of
   * a deleted row — every local query filters on `deleted = 0` — so the sale
   * details are genuinely gone from the server rather than merely hidden.
   *
   * Stock levels survive by design; see SALES_COLLECTIONS for why.
   */
  async clearSales(): Promise<{
    cleared: Record<string, number>;
    rows: number;
    productsKept: number;
  }> {
    const live = this.db
      .select({ collection: schema.documents.collection, id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.deleted, false),
          inArray(schema.documents.collection, [...SALES_COLLECTIONS]),
        ),
      )
      .all();

    const cleared: Record<string, number> = {};
    let seq = this.currentSeq();
    const now = Date.now();

    for (const row of live) {
      seq += 1;
      this.db
        .update(schema.documents)
        .set({
          deleted: true,
          data: JSON.stringify({ id: row.id }),
          updatedAt: now,
          serverSeq: seq,
        })
        .where(
          and(
            eq(schema.documents.collection, row.collection),
            eq(schema.documents.id, row.id),
          ),
        )
        .run();
      cleared[row.collection] = (cleared[row.collection] ?? 0) + 1;
    }

    const [products] = this.db
      .select({ n: sql<number>`count(*)` })
      .from(schema.documents)
      .where(
        and(eq(schema.documents.deleted, false), eq(schema.documents.collection, "products")),
      )
      .all();

    return { cleared, rows: live.length, productsKept: Number(products?.n ?? 0) };
  }

  /**
   * Permanently erase this store's entire operational database. Irreversible.
   *
   * Decommissioning a store needs this: once its registry row is gone from D1
   * nothing can route here again, so the storage would otherwise sit orphaned
   * and still be billed.
   *
   * Currently has NO CALLER, like `seedCatalog`, `replaceProducts`,
   * `exportProducts` and `clearSales`. All were driven by a temporary operator
   * route that has since been removed, and are kept because each is the building
   * block of a real feature the app still lacks — delete shop, bulk catalog
   * import, and start-fresh-books. Wire them to owner-only, confirmation-gated
   * paths, never to a bare route.
   *
   * `deleteAll()` rather than DELETE/DROP because Cloudflare documents that
   * removing rows or dropping tables leaves internal metadata behind, and only
   * `deleteAll()` empties storage enough for the object itself to be reclaimed.
   * The alarm is cleared first because this Worker's compatibility date predates
   * `deleteAll()` covering alarms (harmless here — this class sets none).
   *
   * Counts every row including tombstones, so the return value is a true record
   * of what was destroyed.
   */
  async wipe(): Promise<{ collections: Record<string, number>; rows: number }> {
    const rows = this.db
      .select({
        collection: schema.documents.collection,
        count: sql<number>`count(*)`,
      })
      .from(schema.documents)
      .groupBy(schema.documents.collection)
      .all();

    const collections = Object.fromEntries(rows.map((r) => [r.collection, r.count]));
    const total = rows.reduce((sum, r) => sum + Number(r.count), 0);

    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();

    return { collections, rows: total };
  }

  // --- Admin copy (prod -> staging) ------------------------------------------

  /**
   * One page of raw rows, oldest first, for a full-fidelity copy of this store
   * to another environment. Read-only. Rows keep their server_seq so devices
   * syncing against the copy see a consistent oplog.
   */
  adminExportPage(afterSeq: number, limit: number) {
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT collection, id, data, updated_at, deleted, server_seq FROM documents WHERE server_seq > ? ORDER BY server_seq ASC LIMIT ?",
        afterSeq,
        Math.min(Math.max(limit, 1), 500),
      )
      .toArray() as Array<{
        collection: string;
        id: string;
        data: string;
        updated_at: number;
        deleted: number;
        server_seq: number;
      }>;
    return { rows, head: this.currentSeq() };
  }

  /**
   * Read-only export of selected collections, oldest first, with the same
   * cursor contract as `adminExportPage`.
   *
   * A catalog copy needs the menu, not the store's sales history. Filtering in
   * SQL keeps the copy to a handful of pages instead of walking every receipt.
   */
  adminExportCollections(collections: string[], afterSeq: number, limit: number) {
    if (collections.length === 0) return { rows: [], head: this.currentSeq() };
    const placeholders = collections.map(() => "?").join(",");
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT collection, id, data, updated_at, deleted, server_seq FROM documents
         WHERE server_seq > ? AND collection IN (${placeholders})
         ORDER BY server_seq ASC LIMIT ?`,
        afterSeq,
        ...collections,
        Math.min(Math.max(limit, 1), 500),
      )
      .toArray() as Array<{
      collection: string;
      id: string;
      data: string;
      updated_at: number;
      deleted: number;
      server_seq: number;
    }>;
    return { rows, head: this.currentSeq() };
  }

  /**
   * Write rows exported from another environment, verbatim. `reset` clears
   * this store's documents first (used on the first page of a copy). Only the
   * staging Worker exposes the route that calls this.
   */
  adminImportPage(
    rows: Array<{ collection: string; id: string; data: string; updated_at: number; deleted: number; server_seq: number }>,
    reset: boolean,
  ) {
    const sqlApi = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      if (reset) sqlApi.exec("DELETE FROM documents");
      for (const r of rows) {
        sqlApi.exec(
          "INSERT OR REPLACE INTO documents (collection, id, data, updated_at, deleted, server_seq) VALUES (?, ?, ?, ?, ?, ?)",
          r.collection,
          r.id,
          r.data,
          r.updated_at,
          r.deleted ? 1 : 0,
          r.server_seq,
        );
      }
    });
    return { imported: rows.length, head: this.currentSeq() };
  }

}
