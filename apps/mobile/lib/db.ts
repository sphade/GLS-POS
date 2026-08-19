import * as SQLite from "expo-sqlite";

/**
 * On-device SQLite — the offline-first source of truth.
 *
 * Each entity is stored as a JSON document keyed by id, alongside sync columns:
 *  - updated_at : last local change (ms) — used for last-write-wins merging
 *  - deleted    : tombstone (1) so deletes propagate during sync; reads skip it
 *  - dirty      : 1 = changed locally and not yet pushed to the server
 *
 * The UI reads/writes here synchronously (expo-sqlite sync API), so everything
 * works with no network; the sync engine drains `dirty` rows to the store
 * Durable Object and applies remote changes back.
 *
 * SCOPING: one database FILE PER STORE (`gls-pos-<storeId>.db`).
 *
 * A store (branch) is its own Durable Object with its own catalog and stock, so
 * the local mirror must be separated the same way. Sharing one file meant that
 * a manager switching between GLS branches merged both catalogs and receipt
 * histories into a single local database — Poka's stock showing up in Ikeja's
 * item list, and dirty rows at risk of pushing to the wrong store.
 */

export const COLLECTIONS = [
  "products",
  "categories",
  "modifiers",
  "ingredients",
  "tables",
  "customers",
  "staff",
  "receipts",
  "stock_movements",
  "product_images",
  "web_orders",
] as const;

export type Collection = (typeof COLLECTIONS)[number];

/**
 * Used before a store is known (app boot, sign-in screen). Nothing operational
 * is written here; it just keeps reads from crashing during those first frames.
 */
const BOOTSTRAP = "bootstrap";

const handles = new Map<string, SQLite.SQLiteDatabase>();
let activeStoreId: string = BOOTSTRAP;

const fileFor = (storeId: string) => `gls-pos-${storeId.replace(/[^A-Za-z0-9_-]/g, "")}.db`;

/** Open (once) and migrate the database for a store. */
function open(storeId: string): SQLite.SQLiteDatabase {
  const existing = handles.get(storeId);
  if (existing) return existing;

  const database = SQLite.openDatabaseSync(fileFor(storeId));
  database.execSync("PRAGMA journal_mode = WAL;");
  for (const c of COLLECTIONS) {
    database.execSync(
      `CREATE TABLE IF NOT EXISTS ${c} (
        id TEXT PRIMARY KEY NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        dirty INTEGER NOT NULL DEFAULT 1
      );`,
    );
    database.execSync(`CREATE INDEX IF NOT EXISTS ${c}_dirty_idx ON ${c} (dirty);`);
  }
  database.execSync(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);`);

  handles.set(storeId, database);
  return database;
}

/**
 * Point all subsequent reads/writes at a store's database. Must be called
 * before the data providers mount (see app/_layout.tsx), and again whenever the
 * user switches store.
 */
export function setActiveStore(storeId: string): void {
  if (!storeId) return;
  open(storeId);
  activeStoreId = storeId;
}

export function getActiveStore(): string {
  return activeStoreId;
}

/** The database for the active store. */
function conn(): SQLite.SQLiteDatabase {
  return open(activeStoreId);
}

/** Kept for compatibility; schema creation now happens on open. */
export function initDb() {
  conn();
}

/**
 * A single record by id. Use this instead of scanning `loadAll` when you only
 * need one document — important for large payloads like images, where loading
 * the whole collection would pull every photo's base64 into memory.
 */
export function loadOne<T>(c: Collection, id: string): T | null {
  const db = conn();
  const row = db.getFirstSync<{ data: string }>(
    `SELECT data FROM ${c} WHERE id = ? AND deleted = 0`,
    id,
  );
  return row ? (JSON.parse(row.data) as T) : null;
}

/**
 * How many records still need pushing to the server. This is the *real* sync
 * state (the `dirty` column the sync engine clears), unlike any flag stored
 * inside a document.
 */
export function countDirty(c: Collection): number {
  const db = conn();
  return (
    db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${c} WHERE dirty = 1`)?.n ?? 0
  );
}

/** Ids of all live records — cheap, no payload. */
export function loadIds(c: Collection): string[] {
  const db = conn();
  return db
    .getAllSync<{ id: string }>(`SELECT id FROM ${c} WHERE deleted = 0`)
    .map((r) => r.id);
}

/** All live (non-deleted) records of a collection, in insertion order. */
export function loadAll<T>(c: Collection): T[] {
  const db = conn();
  const rows = db.getAllSync<{ data: string }>(
    `SELECT data FROM ${c} WHERE deleted = 0 ORDER BY rowid ASC`,
  );
  return rows.map((r) => JSON.parse(r.data) as T);
}

/** Insert or update a record; marks it dirty for the next sync. */
export function put<T extends { id: string }>(c: Collection, item: T, dirty = true) {
  const db = conn();
  db.runSync(
    `INSERT INTO ${c} (id, data, updated_at, deleted, dirty) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(id) DO UPDATE SET
       data = excluded.data, updated_at = excluded.updated_at, deleted = 0, dirty = excluded.dirty`,
    item.id,
    JSON.stringify(item),
    Date.now(),
    dirty ? 1 : 0,
  );
}

/** Soft-delete (tombstone) so the deletion can sync. */
export function softDelete(c: Collection, id: string) {
  const db = conn();
  db.runSync(`UPDATE ${c} SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?`, Date.now(), id);
}

/**
 * Mark every row in a collection as needing upload.
 *
 * Used to repair devices seeded by an earlier build that wrote the starter
 * catalog as already-synced, so the server never received it. Returns how many
 * rows were flagged.
 */
export function markAllDirty(c: Collection): number {
  const db = conn();
  db.runSync(`UPDATE ${c} SET dirty = 1`);
  return db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${c}`)?.n ?? 0;
}

/** Hard-wipe a collection. Used when re-seeding demo data (sync off). */
export function resetCollection(c: Collection) {
  const db = conn();
  db.runSync(`DELETE FROM ${c}`);
}

// --- sync-facing helpers (used in Phase B2) --------------------------------

export type ChangeRow<T> = { id: string; data: T; updatedAt: number; deleted: boolean };

/** Rows changed locally since the last push. */
export function loadDirty<T>(c: Collection): ChangeRow<T>[] {
  const db = conn();
  const rows = db.getAllSync<{ id: string; data: string; updated_at: number; deleted: number }>(
    `SELECT id, data, updated_at, deleted FROM ${c} WHERE dirty = 1`,
  );
  return rows.map((r) => ({ id: r.id, data: JSON.parse(r.data) as T, updatedAt: r.updated_at, deleted: !!r.deleted }));
}

export function clearDirty(c: Collection, ids: string[]) {
  if (ids.length === 0) return;
  const db = conn();
  const placeholders = ids.map(() => "?").join(",");
  db.runSync(`UPDATE ${c} SET dirty = 0 WHERE id IN (${placeholders})`, ...ids);
}

/** Apply a change pulled from the server (last-write-wins by updatedAt). */
export function applyRemote<T extends { id: string }>(c: Collection, change: ChangeRow<T>) {
  const db = conn();
  const local = db.getFirstSync<{ updated_at: number; dirty: number }>(
    `SELECT updated_at, dirty FROM ${c} WHERE id = ?`,
    change.id,
  );
  // Don't clobber a newer local edit that hasn't synced yet.
  if (local && local.dirty === 1 && local.updated_at >= change.updatedAt) return;
  db.runSync(
    `INSERT INTO ${c} (id, data, updated_at, deleted, dirty) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, dirty = 0`,
    change.id,
    JSON.stringify(change.data),
    change.updatedAt,
    change.deleted ? 1 : 0,
  );
}

export function metaGet(key: string): string | null {
  const db = conn();
  return db.getFirstSync<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, key)?.value ?? null;
}

export function metaSet(key: string, value: string) {
  const db = conn();
  db.runSync(
    `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

/** Seed a collection once (first launch), writing rows as clean/not-dirty. */
export function seedOnce(flag: string, run: () => void) {
  initDb();
  if (metaGet(flag)) return;
  run();
  metaSet(flag, "1");
}
