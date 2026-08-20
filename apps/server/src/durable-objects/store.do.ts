/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { and, eq, gt, sql } from "drizzle-orm";
import type {
  ApiCategory,
  ApiProduct,
  ApiStockAdjustment,
  Permission,
  PlaceWebOrderRequest,
  PublicMenu,
  StockState,
  StoreRole,
  SyncChange,
  SyncPullResponse,
  SyncPushRequest,
  WebOrder,
  WebOrderLine,
} from "@gls-pos/types";
import { roleCan } from "@gls-pos/types";
import type { Env } from "../env.js";
import * as schema from "./schema.js";
import migrations from "./migrations/migrations.js";

const SEQ_KEY = "seq";

/** Public VIP endpoint throttle: at most N orders per table per window. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_ORDERS = 5;

/** The product fields the server cares about; the doc may carry more. */
type StoredProduct = {
  id: string;
  name: string;
  price: number;
  currency?: string;
  categoryId?: string;
  sku?: string;
  barcode?: string;
  stockQuantity: number | null;
  lowStockAt?: number;
  variants?: {
    id: string;
    name: string;
    /** Integer minor units. */
    price: number;
    /** Undefined/null means stock is not tracked for this variant. */
    stock?: number | null;
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

type DocumentRow = typeof schema.documents.$inferSelect;

/** Permission needed to write each collection outright. */
const WRITE_PERMISSION: Record<string, Permission> = {
  products: "catalog:write",
  categories: "catalog:write",
  modifiers: "catalog:write",
  ingredients: "catalog:write",
  tables: "tables:manage",
  customers: "customers:manage",
  staff: "staff:manage",
  receipts: "sale:create",
  stock_movements: "sale:create",
  product_images: "catalog:write",
  // Staff advance a web order through preparing → ready → served while selling.
  web_orders: "sale:create",
};

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
      if (key === "stock") continue;
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
    if (key === "stockQuantity" || key === "variants") continue;
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
export type PushResult = {
  /** Collections the caller's role may not write. Empty means the push applied. */
  denied: string[];
  changes: SyncChange[];
  cursor: number;
};

/** DB row → wire change (parse the stored JSON back into a document). */
function toChange(row: DocumentRow): SyncChange {
  return {
    collection: row.collection as SyncChange["collection"],
    id: row.id,
    data: JSON.parse(row.data),
    updatedAt: row.updatedAt,
    deleted: row.deleted,
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

  private getSeq(): number {
    const [row] = this.db
      .select({ value: schema.syncMeta.value })
      .from(schema.syncMeta)
      .where(eq(schema.syncMeta.key, SEQ_KEY))
      .all();
    return row?.value ?? 0;
  }

  private setSeq(value: number): void {
    this.db
      .insert(schema.syncMeta)
      .values({ key: SEQ_KEY, value })
      .onConflictDoUpdate({ target: schema.syncMeta.key, set: { value } })
      .run();
  }

  /** All changes recorded with a sequence greater than `cursor`, oldest first. */
  private changesSince(cursor: number): SyncChange[] {
    return this.db
      .select()
      .from(schema.documents)
      .where(gt(schema.documents.serverSeq, cursor))
      .orderBy(schema.documents.serverSeq)
      .all()
      .map(toChange);
  }

  /**
   * Pull only: return everything the store has seen since the device's cursor.
   * Used for a first full download and periodic catch-up.
   */
  async pull(cursor: number): Promise<SyncPullResponse> {
    const changes = this.changesSince(cursor);
    // The seq counter is the store's high-water mark (max server_seq).
    return { changes, cursor: changes.length ? this.getSeq() : cursor };
  }

  /**
   * Push the device's dirty changes, then return everything since its cursor
   * (so one round-trip both uploads and downloads).
   *
   * Conflicts resolve last-write-wins on `updatedAt`: an incoming change is
   * dropped only if the stored version is strictly newer. Each accepted write
   * gets the next monotonic `server_seq` so other devices pull it in order.
   */
  async push(request: SyncPushRequest, role: StoreRole): Promise<PushResult> {
    let seq = this.getSeq();

    // Authorise everything up front so a rejected push applies nothing. The DO
    // is single-threaded, so no other write can interleave between the checks
    // and the writes below.
    const stored = new Map<string, { updatedAt: number; data: string } | undefined>();
    const denied: string[] = [];

    for (const change of request.changes) {
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

      if (!this.mayWrite(change, role, existing?.data)) denied.push(change.collection);
    }

    if (denied.length > 0) {
      return { denied: [...new Set(denied)], changes: [], cursor: request.cursor };
    }

    for (const change of request.changes) {
      const existing = stored.get(`${change.collection}/${change.id}`);

      // Stored version is strictly newer — keep it, drop the incoming change.
      if (existing && existing.updatedAt > change.updatedAt) continue;

      seq += 1;
      const row = {
        collection: change.collection,
        id: change.id,
        data: JSON.stringify(change.data),
        updatedAt: change.updatedAt,
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

    this.setSeq(seq);

    // Let other devices know there's something to pull (e.g. one till marks an
    // order READY and every other screen updates straight away).
    if (request.changes.length > 0) this.broadcast("changes");

    const changes = this.changesSince(request.cursor);
    const nextCursor = changes.length ? seq : request.cursor;
    return { denied: [], changes, cursor: nextCursor };
  }

  /**
   * Whether `role` may apply this change.
   *
   * Normally the collection's write permission decides. The one exception is
   * selling: a cashier/waiter has `sale:create` but not `catalog:write`, and
   * completing a sale must decrement stock. So a product write is allowed when
   * it changes `stockQuantity` alone and doesn't increase it.
   */
  private mayWrite(change: SyncChange, role: StoreRole, storedJson?: string): boolean {
    const required = WRITE_PERMISSION[change.collection];
    if (!required) return false;
    if (roleCan(role, required)) return true;

    if (change.collection === "products" && roleCan(role, "sale:create") && !change.deleted) {
      // No stored doc means this would be creating a product — not a sale.
      if (!storedJson) return false;
      return isStockDecrementOnly(JSON.parse(storedJson), change.data);
    }

    return false;
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
            price: variant.price,
            available: variant.stock == null || variant.stock > 0,
          }))
        : undefined;
      return {
        id: p.id,
        name: p.name,
        price: p.price,
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
        unitPrice: variant?.price ?? product.price,
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
    const seq = this.getSeq() + 1;
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
    this.setSeq(seq);

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
    let seq = this.getSeq();
    const now = Date.now();

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
            resulting: next,
            at: now,
            ref: `api:${source}`,
            note: adj.note,
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
      this.setSeq(seq);
      // Tills see the new stock straight away.
      this.broadcast("changes");
    }

    return { applied, unknown };
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
}
