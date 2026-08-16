/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { and, eq, gt, sql } from "drizzle-orm";
import type {
  Permission,
  PlaceWebOrderRequest,
  PublicMenu,
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

/**
 * Selling has to decrement stock, which means a cashier must be able to write
 * to `products` — but only that one field, and only downward. Anything else
 * (price, name, restocking) still needs the full catalog/inventory permission.
 *
 * Returns true when `next` differs from `prev` in `stockQuantity` alone and the
 * value did not increase.
 */
function isStockDecrementOnly(prev: unknown, next: unknown): boolean {
  if (!prev || typeof prev !== "object" || !next || typeof next !== "object") return false;
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === "stockQuantity") continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }

  const before = a.stockQuantity;
  const after = b.stockQuantity;
  if (typeof before !== "number" || typeof after !== "number") return false;
  return after <= before;
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

    const items = this.docs<{
      id: string;
      name: string;
      price: number;
      categoryId?: string;
      stockQuantity: number | null;
      currency?: string;
    }>("products").map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      categoryId: p.categoryId,
      // null stock means "not tracked", which is still sellable.
      available: p.stockQuantity === null || p.stockQuantity > 0,
    }));

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

    const catalog = this.docs<{
      id: string;
      name: string;
      price: number;
      stockQuantity: number | null;
    }>("products");

    const lines: WebOrderLine[] = [];
    for (const wanted of request.items) {
      const product = catalog.find((p) => p.id === wanted.productId);
      if (!product) continue; // silently drop unknown ids
      const qty = Math.max(1, Math.min(99, Math.floor(wanted.quantity)));
      if (product.stockQuantity !== null && product.stockQuantity <= 0) continue; // sold out
      lines.push({
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        quantity: qty,
        lineTotal: product.price * qty,
        note: wanted.note?.slice(0, 140),
      });
    }

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

    return { ok: true, order };
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
