import * as SQLite from "expo-sqlite";

/**
 * On-device SQLite — the offline-first source of truth.
 *
 * Each entity is stored as a JSON document keyed by id, alongside sync columns:
 *  - updated_at : monotonic per-row revision seeded from wall-clock ms
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
  "returns",
  "stock_movements",
  "product_images",
  "web_orders",
  "audit_log",
  "held_orders",
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

  /**
   * Expression index behind the paginated stock timeline (see `loadDocsPage`).
   * Without it, filtering an append-only log by product means a full scan that
   * decodes every row's JSON; with it, a page is an index seek. Wrapped because
   * expression indexes need a modern SQLite — the query still works unindexed.
   */
  try {
    database.execSync(
      `CREATE INDEX IF NOT EXISTS stock_movements_product_at_idx
         ON stock_movements (
           json_extract(data, '$.productId'),
           json_extract(data, '$.variantId'),
           json_extract(data, '$.at') DESC
         );`,
    );
  } catch {
    /* older SQLite without expression-index support */
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

/**
 * Live rows currently waiting to upload. Unlike `countDirty`, this excludes
 * tombstones: deleted receipts still sync, but must not appear as visible
 * "receipts not uploaded" or row-level warning icons.
 */
export function loadDirtyIds(c: Collection): string[] {
  return conn()
    .getAllSync<{ id: string }>(`SELECT id FROM ${c} WHERE dirty = 1 AND deleted = 0`)
    .map((row) => row.id);
}

/** Ids of all live records — cheap, no payload. */
export function loadIds(c: Collection): string[] {
  const db = conn();
  return db
    .getAllSync<{ id: string }>(`SELECT id FROM ${c} WHERE deleted = 0`)
    .map((r) => r.id);
}

/** Only simple identifiers may reach SQL; JSON paths are built, not passed in. */
const SAFE_FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;

const jsonPath = (field: string): string => {
  if (!SAFE_FIELD.test(field)) throw new Error(`Unsafe document field: ${field}`);
  return `json_extract(data, '$.${field}')`;
};

/**
 * One page of documents filtered by top-level JSON fields, ordered by a JSON
 * field, plus the total number of matches.
 *
 * The alternative — `loadAll` then filter/slice in JS — parses every document in
 * the collection on every read. For an append-only log like `stock_movements`
 * that grows with every sale, that is the whole store's history parsed to show
 * ten rows, on the same thread the keyboard is typing on. SQLite does the
 * filtering, ordering, counting and limiting here instead, so cost tracks the
 * page size rather than the history length.
 *
 * A `null` filter value matches documents where the field is absent or null.
 */
export function loadDocsPage<T>(
  c: Collection,
  filters: Record<string, string | null>,
  order: { field: string; direction: "asc" | "desc" },
  page: { limit: number; offset: number },
): { rows: T[]; total: number } {
  const db = conn();
  const clauses = ["deleted = 0"];
  const params: string[] = [];

  for (const [field, value] of Object.entries(filters)) {
    if (value === null) {
      clauses.push(`${jsonPath(field)} IS NULL`);
    } else {
      clauses.push(`${jsonPath(field)} = ?`);
      params.push(value);
    }
  }

  const where = clauses.join(" AND ");
  const direction = order.direction === "asc" ? "ASC" : "DESC";
  const total =
    db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${c} WHERE ${where}`, ...params)?.n ?? 0;

  const rows = db.getAllSync<{ data: string }>(
    `SELECT data FROM ${c}
     WHERE ${where}
     ORDER BY ${jsonPath(order.field)} ${direction}, id ${direction}
     LIMIT ? OFFSET ?`,
    ...params,
    Math.max(0, page.limit),
    Math.max(0, page.offset),
  );

  return { rows: rows.map((r) => JSON.parse(r.data) as T), total };
}

/** All live (non-deleted) records of a collection, in insertion order. */
export function loadAll<T>(c: Collection): T[] {
  const db = conn();
  const rows = db.getAllSync<{ data: string }>(
    `SELECT data FROM ${c} WHERE deleted = 0 ORDER BY rowid ASC`,
  );
  return rows.map((r) => JSON.parse(r.data) as T);
}

/**
 * Called after a local write marks something dirty, so the sync engine can push
 * promptly instead of waiting for the next 20s poll. Registered by sync.ts; a
 * plain callback avoids an import cycle (sync.ts imports db.ts, not the reverse).
 */
let localWriteListener: (() => void) | null = null;
export function onLocalWrite(cb: (() => void) | null): void {
  localWriteListener = cb;
}
const notifyLocalWrite = () => {
  if (localWriteListener) localWriteListener();
};

type DirtyMode = boolean | "preserve";

/** Write one row through a specific handle without notifying sync. */
function putOn<T extends { id: string }>(
  db: SQLite.SQLiteDatabase,
  c: Collection,
  item: T,
  dirty: DirtyMode,
): void {
  const preserveDirty = dirty === "preserve";
  db.runSync(
    `INSERT INTO ${c} (id, data, updated_at, deleted, dirty) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(id) DO UPDATE SET
       data = excluded.data,
       updated_at = MAX(excluded.updated_at, updated_at + 1),
       deleted = 0,
       dirty = CASE WHEN ? = 1 THEN dirty ELSE excluded.dirty END`,
    item.id,
    JSON.stringify(item),
    Date.now(),
    dirty === true ? 1 : 0,
    preserveDirty ? 1 : 0,
  );
}

/** Insert or update a record; marks it dirty for the next sync. */
export function put<T extends { id: string }>(c: Collection, item: T, dirty = true) {
  putOn(conn(), c, item, dirty);
  if (dirty) notifyLocalWrite();
}

/**
 * Commit related document writes together and wake sync once after the commit.
 * Stock adjustments use this so the materialized product quantity can never be
 * persisted without its append-only movement (or vice versa).
 */
export function putBatch(
  writes: readonly { collection: Collection; item: { id: string }; dirty?: DirtyMode }[],
  dirty = true,
): void {
  if (writes.length === 0) return;
  const db = conn();
  db.withTransactionSync(() => {
    for (const write of writes) {
      putOn(db, write.collection, write.item, write.dirty ?? dirty);
    }
  });
  if (writes.some((write) => (write.dirty ?? dirty) === true)) notifyLocalWrite();
}

/** Soft-delete (tombstone) so the deletion can sync. */
export function softDelete(c: Collection, id: string) {
  const db = conn();
  db.runSync(
    `UPDATE ${c}
     SET deleted = 1, dirty = 1, updated_at = MAX(?, updated_at + 1)
     WHERE id = ?`,
    Date.now(),
    id,
  );
  notifyLocalWrite();
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
export type DirtyRevision = Pick<ChangeRow<unknown>, "id" | "updatedAt">;

// Implementations take an explicit handle; the exports below bind them to the
// active store. See `storeScope` at the bottom for why sync needs the former.

function loadDirtyOn<T>(db: SQLite.SQLiteDatabase, c: Collection): ChangeRow<T>[] {
  const rows = db.getAllSync<{ id: string; data: string; updated_at: number; deleted: number }>(
    `SELECT id, data, updated_at, deleted FROM ${c} WHERE dirty = 1`,
  );
  return rows.map((r) => ({ id: r.id, data: JSON.parse(r.data) as T, updatedAt: r.updated_at, deleted: !!r.deleted }));
}

/** Mark only the exact revisions accepted by the server as clean. */
function clearDirtyOn(
  db: SQLite.SQLiteDatabase,
  c: Collection,
  revisions: readonly DirtyRevision[],
) {
  for (const revision of revisions) {
    db.runSync(
      `UPDATE ${c} SET dirty = 0 WHERE id = ? AND updated_at = ? AND dirty = 1`,
      revision.id,
      revision.updatedAt,
    );
  }
}

function applyRemoteOn<T extends { id: string }>(
  db: SQLite.SQLiteDatabase,
  c: Collection,
  change: ChangeRow<T>,
) {
  const local = db.getFirstSync<{ updated_at: number; dirty: number }>(
    `SELECT updated_at, dirty FROM ${c} WHERE id = ?`,
    change.id,
  );
  // Don't clobber a newer local edit that hasn't synced yet. Stock movements
  // are the exception: they are append-only and server-normalized, so an
  // existing server row with the same id is the canonical acknowledgement of
  // that command and must replace/clean the optimistic local copy.
  if (
    local &&
    local.dirty === 1 &&
    local.updated_at >= change.updatedAt &&
    c !== "stock_movements"
  ) {
    return;
  }
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

function metaGetOn(db: SQLite.SQLiteDatabase, key: string): string | null {
  return db.getFirstSync<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, key)?.value ?? null;
}

function metaSetOn(db: SQLite.SQLiteDatabase, key: string, value: string) {
  db.runSync(
    `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

/** Rows changed locally since the last push. */
export function loadDirty<T>(c: Collection): ChangeRow<T>[] {
  return loadDirtyOn<T>(conn(), c);
}

export function clearDirty(c: Collection, revisions: readonly DirtyRevision[]) {
  clearDirtyOn(conn(), c, revisions);
}

/** Apply a change pulled from the server (last-write-wins by updatedAt). */
export function applyRemote<T extends { id: string }>(c: Collection, change: ChangeRow<T>) {
  applyRemoteOn(conn(), c, change);
}

export function metaGet(key: string): string | null {
  return metaGetOn(conn(), key);
}

export function metaSet(key: string, value: string) {
  metaSetOn(conn(), key, value);
}

/**
 * One specific store's database, addressed explicitly.
 *
 * Everything else in this module writes through the *active* store handle,
 * which is correct for UI code: a screen only ever reads the shop it is
 * showing. Sync is the exception. A request is issued for one store and its
 * response arrives later — possibly after the user switched shops — so writing
 * through the active handle put one shop's products, tables and VIP orders into
 * another shop's file, and pushed the new shop's rows to the old shop's Durable
 * Object. Taking the store explicitly means a response can only ever land where
 * it belongs, no matter what happens mid-flight.
 *
 * The handle is resolved per operation rather than once up front, so a pull that
 * yields between chunks still writes every chunk to the same store. `open` is a
 * cached Map lookup, so this costs nothing.
 */
export type StoreScope = {
  metaGet: (key: string) => string | null;
  metaSet: (key: string, value: string) => void;
  loadDirty: <T>(c: Collection) => ChangeRow<T>[];
  clearDirty: (c: Collection, revisions: readonly DirtyRevision[]) => void;
  applyRemote: <T extends { id: string }>(c: Collection, change: ChangeRow<T>) => void;
};

/**
 * Key/value that belongs to the *device*, not to any shop.
 *
 * Which shop was last open, and the cached identity used to boot offline, are
 * not facts about a shop — but they were being written through the active-store
 * handle, which silently broke them. They landed in whichever shop's file was
 * open at the time, then got read at app start, before any shop is selected,
 * from the bootstrap file. Same key, different database, so the value always
 * came back null and the app fell back to the first shop in the list instead of
 * the one you were last using.
 *
 * Pinned to the bootstrap database, which exists before any store is known and
 * never changes.
 */
export const deviceMeta = {
  get: (key: string): string | null => metaGetOn(open(BOOTSTRAP), key),
  set: (key: string, value: string): void => metaSetOn(open(BOOTSTRAP), key, value),
};

export function storeScope(storeId: string): StoreScope {
  const handle = () => open(storeId);
  return {
    metaGet: (key) => metaGetOn(handle(), key),
    metaSet: (key, value) => metaSetOn(handle(), key, value),
    loadDirty: <T>(c: Collection) => loadDirtyOn<T>(handle(), c),
    clearDirty: (c, revisions) => clearDirtyOn(handle(), c, revisions),
    applyRemote: (c, change) => applyRemoteOn(handle(), c, change),
  };
}

/** Seed a collection once (first launch), writing rows as clean/not-dirty. */
export function seedOnce(flag: string, run: () => void) {
  initDb();
  if (metaGet(flag)) return;
  run();
  metaSet(flag, "1");
}
