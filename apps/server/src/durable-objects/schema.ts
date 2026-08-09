import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * Per-store operational schema, embedded in each Store Durable Object's SQLite.
 * This is the data plane: one isolated copy of these tables exists per store.
 *
 * The store is offline-first. The device holds the same collections in local
 * SQLite and the DO is the authoritative mirror, so the DO keeps every entity
 * as an opaque JSON `document` rather than one strongly-typed table per entity.
 * That keeps the sync engine generic: adding a new collection (e.g. expenses)
 * needs no migration here.
 *
 * Sync columns:
 *  - updated_at : the device wall-clock (ms) of the last change — the
 *                 last-write-wins clock used to resolve conflicts.
 *  - deleted    : tombstone so deletions propagate to other devices.
 *  - server_seq : a monotonic per-store sequence assigned on every write, so a
 *                 device can pull "everything since cursor N" in order.
 */

export const documents = sqliteTable(
  "documents",
  {
    /** Logical collection name, e.g. "products", "receipts". */
    collection: text("collection").notNull(),
    id: text("id").notNull(),
    /** JSON-encoded domain document (the same shape the device stores). */
    data: text("data").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
    serverSeq: integer("server_seq").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.collection, t.id] }),
    index("documents_server_seq_idx").on(t.serverSeq),
  ],
);

/**
 * Tiny key/value table for the DO's own bookkeeping. Currently holds the
 * monotonic `seq` counter that assigns `server_seq` to each document write.
 */
export const syncMeta = sqliteTable("sync_meta", {
  key: text("key").primaryKey(),
  value: integer("value").notNull(),
});
