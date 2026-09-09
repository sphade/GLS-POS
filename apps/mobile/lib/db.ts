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

/**
 * Append-only history is read by timestamp or parent id, never by scanning
 * every JSON document into JavaScript. These can be expensive to build on an
 * upgraded store, so `prepareHistoryIndexes` creates them asynchronously while
 * the app shows a responsive loading frame instead of blocking render.
 */
const HISTORY_INDEXES = [
  `CREATE INDEX IF NOT EXISTS receipts_created_at_idx
     ON receipts (json_extract(data, '$.createdAt') DESC);`,
  `CREATE INDEX IF NOT EXISTS returns_created_at_idx
     ON returns (json_extract(data, '$.createdAt') DESC);`,
  `CREATE INDEX IF NOT EXISTS returns_receipt_created_at_idx
     ON returns (
       json_extract(data, '$.receiptId'),
       json_extract(data, '$.createdAt') ASC
     );`,
  `CREATE INDEX IF NOT EXISTS audit_log_at_idx
     ON audit_log (json_extract(data, '$.at') DESC);`,
  `CREATE INDEX IF NOT EXISTS web_orders_created_at_idx
     ON web_orders (json_extract(data, '$.createdAt') DESC);`,
  `CREATE INDEX IF NOT EXISTS web_orders_status_created_at_idx
     ON web_orders (
       json_extract(data, '$.status'),
       json_extract(data, '$.createdAt') DESC
     );`,
] as const;

const historyIndexJobs = new Map<string, Promise<void>>();

/** Open (once) and migrate the database for a store. */
function open(storeId: string): SQLite.SQLiteDatabase {
  const existing = handles.get(storeId);
  if (existing) return existing;

  const database = SQLite.openDatabaseSync(fileFor(storeId));
  /**
   * Storage tuning, which matters most on the oldest hardware.
   *
   * `synchronous = FULL` (the default) fsyncs on every commit, and a sale is
   * several commits — receipt, product, stock movements, audit. On slow eMMC
   * that is tens of milliseconds each, paid on the JS thread while someone is
   * punching in an order. `NORMAL` is the documented pairing for WAL: still
   * corruption-safe, and only risks the last commits on an OS crash or power
   * cut, which for a till that syncs to the server is a recoverable loss.
   *
   * The WAL is also capped and truncated on open. A day of heavy trading grows
   * it steadily, and every reader pays to scan it — which is why the app gets
   * slower through a shift and feels fresh again after a restart.
   */
  database.execSync("PRAGMA journal_mode = WAL;");
  database.execSync("PRAGMA synchronous = NORMAL;");
  database.execSync("PRAGMA wal_autocheckpoint = 256;");
  database.execSync("PRAGMA temp_store = MEMORY;");
  try {
    database.execSync("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    /* a busy WAL just gets checkpointed on the next open */
  }
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

/**
 * Build history indexes without monopolising the JavaScript thread.
 *
 * The first upgraded launch can have years of receipts to index. Expo's async
 * API performs that native work while React keeps painting the loading frame;
 * subsequent launches hit `IF NOT EXISTS` and finish immediately. One shared
 * promise per store prevents remounts from starting duplicate builds.
 */
export function prepareHistoryIndexes(storeId: string): Promise<void> {
  if (!storeId) return Promise.resolve();
  const existing = historyIndexJobs.get(storeId);
  if (existing) return existing;

  const database = open(storeId);
  const job = (async () => {
    for (const statement of HISTORY_INDEXES) {
      try {
        await database.execAsync(statement);
      } catch {
        // Older SQLite without expression-index support stays correct; its
        // historical queries simply run without this acceleration.
      }
    }
  })();
  historyIndexJobs.set(storeId, job);
  return job;
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
function countDirtyOn(db: SQLite.SQLiteDatabase, c: Collection): number {
  return db.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${c} WHERE dirty = 1`,
  )?.n ?? 0;
}

export function countDirty(c: Collection): number {
  return countDirtyOn(conn(), c);
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

/** Number of live rows without parsing their JSON payloads. */
export function countDocs(c: Collection): number {
  return conn().getFirstSync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${c} WHERE deleted = 0`,
  )?.n ?? 0;
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

/**
 * Newest/oldest documents without parsing the rest of the collection.
 *
 * This is the live-provider primitive: providers retain a small recent window
 * while SQLite keeps the complete offline history. `limit + 1` can be used by
 * callers to determine whether another page exists without a growing COUNT.
 */
export function loadRecentDocs<T>(
  c: Collection,
  orderField: string,
  limit: number,
  offset = 0,
  direction: "asc" | "desc" = "desc",
): T[] {
  const sqlDirection = direction === "asc" ? "ASC" : "DESC";
  const rows = conn().getAllSync<{ data: string }>(
    `SELECT data FROM ${c}
     WHERE deleted = 0
     ORDER BY ${jsonPath(orderField)} ${sqlDirection}, id ${sqlDirection}
     LIMIT ? OFFSET ?`,
    Math.max(0, Math.trunc(limit)),
    Math.max(0, Math.trunc(offset)),
  );
  return rows.map((row) => JSON.parse(row.data) as T);
}

/**
 * Documents whose numeric JSON timestamp is inside the half-open `[from, to)`
 * range. Reports use half-open bounds so adjacent calendar ranges never count
 * a sale or refund twice.
 */
export function loadDocsInRange<T>(
  c: Collection,
  field: string,
  from: number,
  to: number,
  direction: "asc" | "desc" = "desc",
): T[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const sqlDirection = direction === "asc" ? "ASC" : "DESC";
  const path = jsonPath(field);
  const rows = conn().getAllSync<{ data: string }>(
    `SELECT data FROM ${c}
     WHERE deleted = 0 AND ${path} >= ? AND ${path} < ?
     ORDER BY ${path} ${sqlDirection}, id ${sqlDirection}`,
    from,
    to,
  );
  return rows.map((row) => JSON.parse(row.data) as T);
}

/**
 * All live documents matching one indexed top-level field. Used for a
 * receipt's credit notes, so refund correctness never depends on whether those
 * notes happen to be inside the provider's recent in-memory window.
 */
export function loadDocsByField<T>(
  c: Collection,
  field: string,
  value: string | number | null,
  order: { field: string; direction: "asc" | "desc" },
): T[] {
  const clauses = ["deleted = 0"];
  const params: (string | number)[] = [];
  const matchPath = jsonPath(field);
  if (value === null) {
    clauses.push(`${matchPath} IS NULL`);
  } else {
    clauses.push(`${matchPath} = ?`);
    params.push(value);
  }
  const sqlDirection = order.direction === "asc" ? "ASC" : "DESC";
  const rows = conn().getAllSync<{ data: string }>(
    `SELECT data FROM ${c}
     WHERE ${clauses.join(" AND ")}
     ORDER BY ${jsonPath(order.field)} ${sqlDirection}, id ${sqlDirection}`,
    ...params,
  );
  return rows.map((row) => JSON.parse(row.data) as T);
}

export type DocValueFilter = {
  field: string;
  value: string | number | null;
  operator?: "eq" | "neq";
};

/**
 * Sum one numeric document field in SQLite without materialising the matching
 * documents. Summary bars can therefore remain all-history accurate while the
 * list below them is paged.
 */
export function sumDocs(
  c: Collection,
  field: string,
  filters: readonly DocValueFilter[] = [],
): number {
  const clauses = ["deleted = 0"];
  const params: (string | number)[] = [];
  for (const filter of filters) {
    const path = jsonPath(filter.field);
    const neq = filter.operator === "neq";
    if (filter.value === null) {
      clauses.push(`${path} IS ${neq ? "NOT " : ""}NULL`);
    } else {
      clauses.push(`${path} ${neq ? "!=" : "="} ?`);
      params.push(filter.value);
    }
  }
  const path = jsonPath(field);
  return (
    conn().getFirstSync<{ total: number | null }>(
      `SELECT COALESCE(SUM(CAST(${path} AS INTEGER)), 0) AS total
       FROM ${c} WHERE ${clauses.join(" AND ")}`,
      ...params,
    )?.total ?? 0
  );
}

/**
 * Bounded case-insensitive search across selected top-level text fields.
 * SQLite may scan for a contains query, but only matching page rows are parsed
 * into JavaScript, and the work happens only when the user explicitly searches.
 */
export function searchDocs<T>(
  c: Collection,
  fields: readonly string[],
  query: string,
  order: { field: string; direction: "asc" | "desc" },
  page: { limit: number; offset: number },
): T[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed || fields.length === 0) {
    return loadRecentDocs<T>(c, order.field, page.limit, page.offset, order.direction);
  }

  const escaped = trimmed.replace(/[\\%_]/g, "\\$&");
  const needle = `%${escaped}%`;
  const matches = fields.map(
    (field) => `LOWER(CAST(COALESCE(${jsonPath(field)}, '') AS TEXT)) LIKE ? ESCAPE '\\'`,
  );
  const direction = order.direction === "asc" ? "ASC" : "DESC";
  const rows = conn().getAllSync<{ data: string }>(
    `SELECT data FROM ${c}
     WHERE deleted = 0 AND (${matches.join(" OR ")})
     ORDER BY ${jsonPath(order.field)} ${direction}, id ${direction}
     LIMIT ? OFFSET ?`,
    ...fields.map(() => needle),
    Math.max(0, Math.trunc(page.limit)),
    Math.max(0, Math.trunc(page.offset)),
  );
  return rows.map((row) => JSON.parse(row.data) as T);
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

/**
 * Atomically allocate a tagged per-device number and insert its document.
 *
 * Receipt/credit-note numbering must not depend on a bounded React array, but
 * persisting the counter in a separate commit adds latency and can leave a gap
 * if the app stops before the document write. This keeps both writes in one
 * transaction and wakes sync only after they commit together.
 */
export function putWithDeviceSequence<T extends { id: string }>(
  c: Collection,
  sequencePrefix: string,
  build: (tag: number, sequence: number) => T,
  dirty = true,
): T {
  const db = conn();
  let item!: T;
  db.withTransactionSync(() => {
    let tag = Number(metaGetOn(db, "receipt_tag") ?? "") || 0;
    if (tag < 1 || tag > 9) {
      tag = 1 + Math.floor(Math.random() * 9);
      metaSetOn(db, "receipt_tag", String(tag));
    }

    const sequenceKey = `${sequencePrefix}_${tag}`;
    const raw = metaGetOn(db, sequenceKey);
    const stored = raw === null ? Number.NaN : Number(raw);
    const current =
      Number.isSafeInteger(stored) && stored >= 0
        ? stored
        : (db.getFirstSync<{ n: number }>(
            `SELECT COUNT(*) AS n FROM ${c} WHERE deleted = 0`,
          )?.n ?? 0);
    const next = current + 1;
    item = build(tag, next);
    metaSetOn(db, sequenceKey, String(next));
    putOn(db, c, item, dirty);
  });
  if (dirty) notifyLocalWrite();
  return item;
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
export type DirtyRevisionBatch = {
  collection: Collection;
  revisions: readonly DirtyRevision[];
};
export type RemoteCollectionChange = {
  collection: Collection;
  change: ChangeRow<{ id: string }>;
};

// Implementations take an explicit handle; the exports below bind them to the
// active store. See `storeScope` at the bottom for why sync needs the former.

function loadDirtyOn<T>(db: SQLite.SQLiteDatabase, c: Collection): ChangeRow<T>[] {
  const rows = db.getAllSync<{ id: string; data: string; updated_at: number; deleted: number }>(
    `SELECT id, data, updated_at, deleted FROM ${c} WHERE dirty = 1`,
  );
  return rows.map((r) => ({ id: r.id, data: JSON.parse(r.data) as T, updatedAt: r.updated_at, deleted: !!r.deleted }));
}

/** Mark revisions clean inside the caller's current transaction. */
function clearDirtyRevisionsOn(
  db: SQLite.SQLiteDatabase,
  c: Collection,
  revisions: readonly DirtyRevision[],
): void {
  for (const revision of revisions) {
    db.runSync(
      `UPDATE ${c} SET dirty = 0 WHERE id = ? AND updated_at = ? AND dirty = 1`,
      revision.id,
      revision.updatedAt,
    );
  }
}

/** Mark only the exact revisions accepted by the server as clean. */
function clearDirtyOn(
  db: SQLite.SQLiteDatabase,
  c: Collection,
  revisions: readonly DirtyRevision[],
): void {
  if (revisions.length === 0) return;
  db.withTransactionSync(() => clearDirtyRevisionsOn(db, c, revisions));
}

/** One commit for all collections acknowledged by one server response. */
function clearDirtyBatchOn(
  db: SQLite.SQLiteDatabase,
  batches: readonly DirtyRevisionBatch[],
): void {
  if (!batches.some((batch) => batch.revisions.length > 0)) return;
  db.withTransactionSync(() => {
    for (const batch of batches) {
      clearDirtyRevisionsOn(db, batch.collection, batch.revisions);
    }
  });
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

/** Apply one pull chunk in a single SQLite transaction. */
function applyRemoteBatchOn(
  db: SQLite.SQLiteDatabase,
  changes: readonly RemoteCollectionChange[],
): void {
  if (changes.length === 0) return;
  db.withTransactionSync(() => {
    for (const { collection, change } of changes) {
      applyRemoteOn(db, collection, change);
    }
  });
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

export type ReadProjectionTransitionInput = {
  policyMarkerKey: string;
  policyVersion: string;
  readableCollectionsKey: string;
  activeScopeKey: string;
  completedScopeKey: string;
  pendingScopeKey: string;
  cursorKey: string;
  replayHeadKey: string;
  nextScope: string;
  nextReadable: readonly Collection[];
};

export type ReadProjectionTransitionResult = {
  transitioned: boolean;
  purgedCollections: readonly Collection[];
};

function normalizedProjection(raw: string | null): Collection[] | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value) || !value.every((entry) => COLLECTIONS.includes(entry as Collection))) {
      return null;
    }
    const selected = new Set(value as Collection[]);
    return COLLECTIONS.filter((collection) => selected.has(collection));
  } catch {
    return null;
  }
}

/**
 * Atomically move a store database to a narrower or wider read projection.
 *
 * A missing policy marker means the database predates filtered sync, so its
 * previous projection is deliberately treated as every collection. Clean rows
 * that leave the projection are deleted; dirty rows and tombstones survive for
 * later reconciliation by a suitably-authorized user.
 */
function transitionReadProjectionOn(
  db: SQLite.SQLiteDatabase,
  input: ReadProjectionTransitionInput,
): ReadProjectionTransitionResult {
  let transitioned = false;
  let purgedCollections: Collection[] = [];

  db.withTransactionSync(() => {
    const policyIsCurrent =
      metaGetOn(db, input.policyMarkerKey) === input.policyVersion;
    const storedProjection = policyIsCurrent
      ? normalizedProjection(metaGetOn(db, input.readableCollectionsKey))
      : null;
    const previous = storedProjection ?? [...COLLECTIONS];
    const nextSet = new Set(input.nextReadable);
    const next = COLLECTIONS.filter((collection) => nextSet.has(collection));
    const previousSet = new Set(previous);
    const projectionChanged =
      previous.length !== next.length ||
      previous.some((collection, index) => collection !== next[index]);
    const scopeChanged = metaGetOn(db, input.activeScopeKey) !== input.nextScope;

    transitioned = !policyIsCurrent || projectionChanged || scopeChanged;
    if (!transitioned) return;

    purgedCollections = previous.filter(
      (collection) => previousSet.has(collection) && !nextSet.has(collection),
    );
    for (const collection of purgedCollections) {
      db.runSync(`DELETE FROM ${collection} WHERE dirty = 0`);
    }

    // These writes share the purge transaction: a crash can expose either the
    // complete old projection or the complete pending new one, never a mixture.
    metaSetOn(db, input.pendingScopeKey, input.nextScope);
    metaSetOn(db, input.replayHeadKey, "");
    metaSetOn(db, input.cursorKey, "0");
    metaSetOn(db, input.completedScopeKey, "");
    metaSetOn(db, input.activeScopeKey, input.nextScope);
    metaSetOn(db, input.readableCollectionsKey, JSON.stringify(next));
    metaSetOn(db, input.policyMarkerKey, input.policyVersion);
  });

  return { transitioned, purgedCollections };
}

/**
 * Merge specific ids into an already-loaded, newest-first list.
 *
 * The point is what it avoids: re-reading a whole append-only collection just
 * because a few rows arrived. Only the named ids are parsed, deletions drop
 * out, and the result keeps its sort without re-sorting the entire history.
 */
export function mergeById<T extends { id: string }>(
  current: readonly T[],
  c: Collection,
  ids: readonly string[],
  sortKey: (row: T) => number,
): T[] {
  if (ids.length === 0) return current as T[];

  const touched = new Set(ids);
  const incoming: T[] = [];
  for (const id of touched) {
    const row = loadOne<T>(c, id);
    if (row) incoming.push(row);
  }

  // Drop the old copies of everything touched, then splice the new ones in.
  const kept = current.filter((row) => !touched.has(row.id));
  if (incoming.length === 0) return kept.length === current.length ? (current as T[]) : kept;

  incoming.sort((a, b) => sortKey(b) - sortKey(a));
  const merged: T[] = [];
  let i = 0;
  let j = 0;
  while (i < kept.length && j < incoming.length) {
    merged.push(sortKey(incoming[j]!) > sortKey(kept[i]!) ? incoming[j++]! : kept[i++]!);
  }
  while (i < kept.length) merged.push(kept[i++]!);
  while (j < incoming.length) merged.push(incoming[j++]!);
  return merged;
}

/**
 * Merge specific ids into an already-loaded list, keeping its existing order.
 *
 * For the catalog, order is insertion order rather than a timestamp, so this
 * replaces touched rows where they already sit, appends genuinely new ones, and
 * drops any that were deleted. Returns the original array when nothing actually
 * changed, so React can skip the render entirely.
 */
export function mergeInPlace<T extends { id: string }>(
  current: readonly T[],
  c: Collection,
  ids: readonly string[],
): T[] {
  if (ids.length === 0) return current as T[];

  const fetched = new Map<string, T | null>();
  for (const id of new Set(ids)) fetched.set(id, loadOne<T>(c, id));

  let changed = false;
  const next: T[] = [];
  for (const row of current) {
    if (!fetched.has(row.id)) {
      next.push(row);
      continue;
    }
    const fresh = fetched.get(row.id) ?? null;
    if (fresh === null) {
      changed = true; // tombstoned elsewhere
      continue;
    }
    /**
     * Keep the previous object when the content is identical. A pull often
     * re-sends a row that didn't really move (the server rewrites a product on
     * every stock movement), and handing React a fresh object for it defeats
     * `React.memo` on the item cards — the whole grid repaints for nothing.
     */
    if (JSON.stringify(fresh) === JSON.stringify(row)) {
      next.push(row);
    } else {
      changed = true;
      next.push(fresh);
    }
    fetched.set(row.id, null); // consumed; anything left is new
  }

  const existing = new Set(current.map((row) => row.id));
  for (const [id, row] of fetched) {
    if (row && !existing.has(id)) {
      next.push(row);
      changed = true;
    }
  }

  return changed ? next : (current as T[]);
}

/** Rows changed locally since the last push. */
export function loadDirty<T>(c: Collection): ChangeRow<T>[] {
  return loadDirtyOn<T>(conn(), c);
}

export function clearDirty(c: Collection, revisions: readonly DirtyRevision[]) {
  clearDirtyOn(conn(), c, revisions);
}

export function clearDirtyBatch(batches: readonly DirtyRevisionBatch[]): void {
  clearDirtyBatchOn(conn(), batches);
}

/** Apply a change pulled from the server (last-write-wins by updatedAt). */
export function applyRemote<T extends { id: string }>(c: Collection, change: ChangeRow<T>) {
  applyRemoteOn(conn(), c, change);
}

export function applyRemoteBatch(changes: readonly RemoteCollectionChange[]): void {
  applyRemoteBatchOn(conn(), changes);
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
  transitionReadProjection: (
    input: ReadProjectionTransitionInput,
  ) => ReadProjectionTransitionResult;
  countDirty: (c: Collection) => number;
  loadDirty: <T>(c: Collection) => ChangeRow<T>[];
  clearDirty: (c: Collection, revisions: readonly DirtyRevision[]) => void;
  clearDirtyBatch: (batches: readonly DirtyRevisionBatch[]) => void;
  applyRemote: <T extends { id: string }>(c: Collection, change: ChangeRow<T>) => void;
  applyRemoteBatch: (changes: readonly RemoteCollectionChange[]) => void;
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
    transitionReadProjection: (input) => transitionReadProjectionOn(handle(), input),
    countDirty: (c) => countDirtyOn(handle(), c),
    loadDirty: <T>(c: Collection) => loadDirtyOn<T>(handle(), c),
    clearDirty: (c, revisions) => clearDirtyOn(handle(), c, revisions),
    clearDirtyBatch: (batches) => clearDirtyBatchOn(handle(), batches),
    applyRemote: (c, change) => applyRemoteOn(handle(), c, change),
    applyRemoteBatch: (changes) => applyRemoteBatchOn(handle(), changes),
  };
}

/** Seed a collection once (first launch), writing rows as clean/not-dirty. */
export function seedOnce(flag: string, run: () => void) {
  initDb();
  if (metaGet(flag)) return;
  run();
  metaSet(flag, "1");
}
