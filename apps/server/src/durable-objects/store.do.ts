/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { and, eq, gt, sql } from "drizzle-orm";
import type { SyncChange, SyncPullResponse, SyncPushRequest } from "@gls-pos/types";
import type { Env } from "../env.js";
import * as schema from "./schema.js";
import migrations from "./migrations/migrations.js";

const SEQ_KEY = "seq";

type DocumentRow = typeof schema.documents.$inferSelect;

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
  async push(request: SyncPushRequest): Promise<SyncPullResponse> {
    let seq = this.getSeq();

    for (const change of request.changes) {
      const [existing] = this.db
        .select({ updatedAt: schema.documents.updatedAt })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.collection, change.collection),
            eq(schema.documents.id, change.id),
          ),
        )
        .all();

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
    return { changes, cursor: nextCursor };
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
