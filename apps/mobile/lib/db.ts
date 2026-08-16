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
 * works with no network. Phase B2 drains `dirty` rows to the store Durable
 * Object and applies remote changes back.
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
] as const;

export type Collection = (typeof COLLECTIONS)[number];

const db = SQLite.openDatabaseSync("gls-pos.db");

let ready = false;

export function initDb() {
  if (ready) return;
  db.execSync("PRAGMA journal_mode = WAL;");
  for (const c of COLLECTIONS) {
    db.execSync(
      `CREATE TABLE IF NOT EXISTS ${c} (
        id TEXT PRIMARY KEY NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        dirty INTEGER NOT NULL DEFAULT 1
      );`,
    );
  }
  db.execSync(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);`);
  ready = true;
}

/** All live (non-deleted) records of a collection, in insertion order. */
export function loadAll<T>(c: Collection): T[] {
  initDb();
  const rows = db.getAllSync<{ data: string }>(
    `SELECT data FROM ${c} WHERE deleted = 0 ORDER BY rowid ASC`,
  );
  return rows.map((r) => JSON.parse(r.data) as T);
}

/** Insert or update a record; marks it dirty for the next sync. */
export function put<T extends { id: string }>(c: Collection, item: T, dirty = true) {
  initDb();
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
  initDb();
  db.runSync(`UPDATE ${c} SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?`, Date.now(), id);
}

/** Hard-wipe a collection. Used when re-seeding demo data (sync off). */
export function resetCollection(c: Collection) {
  initDb();
  db.runSync(`DELETE FROM ${c}`);
}

// --- sync-facing helpers (used in Phase B2) --------------------------------

export type ChangeRow<T> = { id: string; data: T; updatedAt: number; deleted: boolean };

/** Rows changed locally since the last push. */
export function loadDirty<T>(c: Collection): ChangeRow<T>[] {
  initDb();
  const rows = db.getAllSync<{ id: string; data: string; updated_at: number; deleted: number }>(
    `SELECT id, data, updated_at, deleted FROM ${c} WHERE dirty = 1`,
  );
  return rows.map((r) => ({ id: r.id, data: JSON.parse(r.data) as T, updatedAt: r.updated_at, deleted: !!r.deleted }));
}

export function clearDirty(c: Collection, ids: string[]) {
  if (ids.length === 0) return;
  initDb();
  const placeholders = ids.map(() => "?").join(",");
  db.runSync(`UPDATE ${c} SET dirty = 0 WHERE id IN (${placeholders})`, ...ids);
}

/** Apply a change pulled from the server (last-write-wins by updatedAt). */
export function applyRemote<T extends { id: string }>(c: Collection, change: ChangeRow<T>) {
  initDb();
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
  initDb();
  return db.getFirstSync<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, key)?.value ?? null;
}

export function metaSet(key: string, value: string) {
  initDb();
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
