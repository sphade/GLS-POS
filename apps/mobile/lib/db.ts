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
const HISTORY_INDEXES: readonly { collection: Collection; statement: string }[] = [
  {
    collection: "receipts",
    statement: `CREATE INDEX IF NOT EXISTS receipts_created_at_idx
       ON receipts (json_extract(data, '$.createdAt') DESC);`,
  },
  {
    collection: "returns",
    statement: `CREATE INDEX IF NOT EXISTS returns_created_at_idx
       ON returns (json_extract(data, '$.createdAt') DESC);`,
  },
  {
    collection: "returns",
    statement: `CREATE INDEX IF NOT EXISTS returns_receipt_created_at_idx
       ON returns (
         json_extract(data, '$.receiptId'),
         json_extract(data, '$.createdAt') ASC
       );`,
  },
  {
    collection: "audit_log",
    statement: `CREATE INDEX IF NOT EXISTS audit_log_at_idx
       ON audit_log (json_extract(data, '$.at') DESC);`,
  },
  {
    collection: "stock_movements",
    statement: `CREATE INDEX IF NOT EXISTS stock_movements_product_at_idx
       ON stock_movements (
         json_extract(data, '$.productId'),
         json_extract(data, '$.variantId'),
         json_extract(data, '$.at') DESC
       );`,
  },
  {
    collection: "web_orders",
    statement: `CREATE INDEX IF NOT EXISTS web_orders_created_at_idx
       ON web_orders (json_extract(data, '$.createdAt') DESC);`,
  },
  {
    collection: "web_orders",
    statement: `CREATE INDEX IF NOT EXISTS web_orders_status_created_at_idx
       ON web_orders (
         json_extract(data, '$.status'),
         json_extract(data, '$.createdAt') DESC
       );`,
  },
];

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
    /**
     * The uploader reads pending rows oldest-first with a limit. Without
     * `updated_at` in the index SQLite has to sort every dirty row to answer
     * that, which is precisely the cost the limit exists to avoid on a till
     * carrying a large backlog.
     */
    database.execSync(
      `CREATE INDEX IF NOT EXISTS ${c}_dirty_updated_at_idx ON ${c} (dirty, updated_at);`,
    );
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
 * subsequent launches hit `IF NOT EXISTS` and finish immediately. Jobs are
 * keyed by store plus read projection so a later manager session can build
 * indexes that a restricted till correctly skipped.
 */
export function prepareHistoryIndexes(
  storeId: string,
  readableCollections: readonly Collection[],
): Promise<void> {
  if (!storeId) return Promise.resolve();

  const readable = new Set(readableCollections);
  const projectionKey = COLLECTIONS.filter((collection) => readable.has(collection)).join(",");
  const jobKey = `${storeId}:${projectionKey}`;
  const existing = historyIndexJobs.get(jobKey);
  if (existing) return existing;

  const database = open(storeId);
  const job = (async () => {
    for (const { collection, statement } of HISTORY_INDEXES) {
      if (!readable.has(collection)) continue;
      try {
        await database.execAsync(statement);
      } catch {
        // Older SQLite without expression-index support stays correct; its
        // historical queries simply run without this acceleration.
      }
    }
  })();
  historyIndexJobs.set(jobKey, job);
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
/**
 * Subscribers woken after a local dirty write commits.
 *
 * This is a Set rather than one slot on purpose. It used to be a single
 * callback assigned by `onLocalWrite(cb)` and cleared with `onLocalWrite(null)`,
 * which meant a stale teardown could unregister whoever had replaced it. A
 * store switch, a role change or a React remount could therefore leave nothing
 * listening, silently disabling push-on-write and dropping the app back to the
 * 20-second safety poll — sales sitting on a till for no visible reason.
 */
const localWriteListeners = new Set<() => void>();

/** Subscribe to committed local writes. Returns an unsubscribe function. */
export function onLocalWrite(cb: () => void): () => void {
  localWriteListeners.add(cb);
  return () => localWriteListeners.delete(cb);
}

function emitLocalWrite(): void {
  for (const listener of localWriteListeners) {
    try {
      listener();
    } catch {
      // A failing listener must never break the write that triggered it.
    }
  }
}

/**
 * Re-entrant transactions.
 *
 * A sale is not one write: it is the receipt, its numbering counter, the
 * decremented product documents, an append-only stock movement per line, the
 * audit entry, and the tombstone of the table ticket it came from. Those used to
 * commit in two or three separate transactions, which left real gaps — the app
 * dying (or the OS killing it) between them recorded a sale whose stock was
 * never deducted, or deducted stock for a receipt that no longer existed.
 *
 * SQLite has no nested `BEGIN`, so an inner writer that opens its own
 * transaction while an outer one is running would throw. Savepoints give the
 * same all-or-nothing guarantee while nesting cleanly, so every writer below can
 * keep opening "a transaction" without knowing whether it is the outermost one.
 */
const txDepth = new WeakMap<SQLite.SQLiteDatabase, number>();
let savepointSeq = 0;
/** Set when a dirty write happens inside a transaction; flushed after commit. */
let pendingLocalWrite = false;

const depthOf = (db: SQLite.SQLiteDatabase): number => txDepth.get(db) ?? 0;

function withTx(db: SQLite.SQLiteDatabase, body: () => void): void {
  const depth = depthOf(db);

  if (depth === 0) {
    txDepth.set(db, 1);
    try {
      db.withTransactionSync(body);
    } finally {
      txDepth.set(db, 0);
    }
    return;
  }

  const name = `gls_sp_${(savepointSeq += 1)}`;
  txDepth.set(db, depth + 1);
  try {
    db.execSync(`SAVEPOINT ${name}`);
    try {
      body();
      db.execSync(`RELEASE ${name}`);
    } catch (error) {
      // Undo only this inner unit; the enclosing transaction decides its own
      // fate, exactly as a standalone transaction would have.
      db.execSync(`ROLLBACK TO ${name}`);
      db.execSync(`RELEASE ${name}`);
      throw error;
    }
  } finally {
    txDepth.set(db, depth);
  }
}

/**
 * Commit several related writes as one unit, waking sync once afterwards.
 *
 * Used by anything that must never be half-recorded — completing a sale,
 * refunding one — so a crash leaves either the whole operation or none of it.
 * Nested calls are safe. The callback's return value is passed through.
 */
export function runAtomic<T>(body: () => T): T {
  const db = conn();
  let result!: T;
  try {
    withTx(db, () => {
      result = body();
    });
  } catch (error) {
    // The unit rolled back, so there is nothing for sync to upload. Drop the
    // deferred wake-up rather than leaving it armed for an unrelated write.
    if (depthOf(db) === 0) pendingLocalWrite = false;
    throw error;
  }
  flushLocalWrite(db);
  return result;
}

function flushLocalWrite(db: SQLite.SQLiteDatabase): void {
  if (depthOf(db) > 0 || !pendingLocalWrite) return;
  pendingLocalWrite = false;
  emitLocalWrite();
}

const notifyLocalWrite = () => {
  // Mid-transaction the rows are not durable yet, and the upload would race the
  // commit. Remember it and wake sync once the outermost unit has committed.
  if (depthOf(conn()) > 0) {
    pendingLocalWrite = true;
    return;
  }
  pendingLocalWrite = false;
  emitLocalWrite();
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
  withTx(db, () => {
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
  withTx(db, () => {
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
/**
 * A dirty row plus the encoded size SQLite already knew.
 *
 * The uploader needs each row's size to fill its request budget. Measuring that
 * with `JSON.stringify` meant serialising every pending row on the JS thread on
 * every attempt, purely to count characters — then serialising the whole batch
 * again to send it. The stored column length is the same number, already to hand.
 */
export type DirtyRow<T> = ChangeRow<T> & { bytes: number };
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

/**
 * Rows awaiting upload, oldest first, optionally capped.
 *
 * Both details matter on a slow connection. Without a cap this read parsed the
 * entire backlog on every sync attempt — including attempts that were about to
 * fail — so the further behind a till fell, the more work each doomed retry cost
 * on the same thread that handles taps. With a cap the cost per attempt is
 * bounded and the queue still drains, just across more cycles.
 *
 * Oldest-first means a backlog uploads in the order it was rung up, so the
 * earliest sales reach the server first and a partial drain is still coherent.
 */
function loadDirtyOn<T>(
  db: SQLite.SQLiteDatabase,
  c: Collection,
  limit?: number,
): DirtyRow<T>[] {
  const capped = typeof limit === "number" && Number.isInteger(limit) && limit > 0;
  const rows = capped
    ? db.getAllSync<{ id: string; data: string; updated_at: number; deleted: number }>(
        `SELECT id, data, updated_at, deleted FROM ${c} WHERE dirty = 1
         ORDER BY updated_at ASC, id ASC LIMIT ?`,
        limit,
      )
    : db.getAllSync<{ id: string; data: string; updated_at: number; deleted: number }>(
        `SELECT id, data, updated_at, deleted FROM ${c} WHERE dirty = 1
         ORDER BY updated_at ASC, id ASC`,
      );
  return rows.map((r) => ({
    id: r.id,
    data: JSON.parse(r.data) as T,
    updatedAt: r.updated_at,
    deleted: !!r.deleted,
    bytes: r.data.length,
  }));
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
  withTx(db, () => clearDirtyRevisionsOn(db, c, revisions));
}

/**
 * Reclaim the space held by retired product photos.
 *
 * Photos used to be stored as base64 in `product_images` — 30–80KB per item. The
 * feature is gone (items now render a generated avatar), but devices seeded by an
 * earlier build still carry those blobs, which is easily the largest thing in a
 * store's local database and pure dead weight now that nothing reads it.
 *
 * The table itself is deliberately kept. It remains part of the sync protocol, so
 * dropping it would break a device that still has an older cursor or an upgraded
 * device receiving legacy rows. Only its contents go.
 */
function purgeRetiredProductImagesOn(db: SQLite.SQLiteDatabase): void {
  const [row] = db.getAllSync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM product_images`,
  );
  if (!row || row.n === 0) return;
  db.runSync(`DELETE FROM product_images`);
}

/** Delete only server-acknowledged rows from collections outside this role's projection. */
function purgeCleanCollectionsOn(
  db: SQLite.SQLiteDatabase,
  collections: readonly Collection[],
): void {
  for (const collection of new Set(collections)) {
    db.runSync(`DELETE FROM ${collection} WHERE dirty = 0`);
  }
}

/**
 * One commit for all revisions acknowledged by one server response and any
 * newly-clean rows that this role is not allowed to retain.
 */
function clearDirtyBatchOn(
  db: SQLite.SQLiteDatabase,
  batches: readonly DirtyRevisionBatch[],
  purgeCollections: readonly Collection[] = [],
  redactProductCosts = false,
): void {
  const hasRevisions = batches.some((batch) => batch.revisions.length > 0);
  if (!hasRevisions && purgeCollections.length === 0) return;

  withTx(db, () => {
    for (const batch of batches) {
      clearDirtyRevisionsOn(db, batch.collection, batch.revisions);
    }
    if (redactProductCosts) redactAcknowledgedProductCostsOn(db, batches);
    purgeCleanCollectionsOn(db, purgeCollections);
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
  withTx(db, () => {
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
  retainProductCosts: boolean;
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

type CostProjection = { value: unknown; changed: boolean };

/** Remove root/variant costs from one product-shaped snapshot. */
function stripProductSnapshotCosts(value: unknown): CostProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value, changed: false };
  }

  const product = { ...(value as Record<string, unknown>) };
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(product, "cost")) {
    delete product.cost;
    changed = true;
  }
  if (Array.isArray(product.variants)) {
    product.variants = product.variants.map((variant) => {
      if (!variant || typeof variant !== "object" || Array.isArray(variant)) return variant;
      const projected = { ...(variant as Record<string, unknown>) };
      if (!Object.prototype.hasOwnProperty.call(projected, "cost")) return variant;
      delete projected.cost;
      changed = true;
      return projected;
    });
  }
  return { value: product, changed };
}

/** Redact only product revisions that the same server response made clean. */
function redactAcknowledgedProductCostsOn(
  db: SQLite.SQLiteDatabase,
  batches: readonly DirtyRevisionBatch[],
): void {
  for (const batch of batches) {
    if (batch.collection !== "products") continue;
    for (const revision of batch.revisions) {
      const row = db.getFirstSync<{ data: string }>(
        `SELECT data FROM products
         WHERE id = ? AND updated_at = ? AND dirty = 0`,
        revision.id,
        revision.updatedAt,
      );
      if (!row) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(row.data) as unknown;
      } catch {
        continue;
      }
      const projection = stripProductSnapshotCosts(parsed);
      if (!projection.changed) continue;
      db.runSync(
        `UPDATE products SET data = ?
         WHERE id = ? AND updated_at = ? AND dirty = 0`,
        JSON.stringify(projection.value),
        revision.id,
        revision.updatedAt,
      );
    }
  }
}

/**
 * Remove back-office cost fields from clean cached products before restricted
 * providers can read them. Dirty rows are deliberately untouched: they may be
 * unsynced manager edits and remain covered by the offline-safety exception.
 */
function redactCleanProductCostsOn(db: SQLite.SQLiteDatabase): void {
  const rows = db.getAllSync<{ id: string; data: string }>(
    `SELECT id, data FROM products WHERE dirty = 0 AND instr(data, '"cost"') > 0`,
  );

  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data) as unknown;
    } catch {
      continue;
    }
    const projection = stripProductSnapshotCosts(parsed);
    if (projection.changed) {
      db.runSync(
        `UPDATE products SET data = ? WHERE id = ? AND dirty = 0`,
        JSON.stringify(projection.value),
        row.id,
      );
    }
  }
}

/**
 * Held bills need product names/prices but never product costs. Strip legacy
 * snapshots from clean and dirty rows without changing their sync revision;
 * the operational ticket remains complete and any later upload is sanitized.
 */
function redactHeldOrderCostsOn(db: SQLite.SQLiteDatabase): void {
  const rows = db.getAllSync<{ id: string; data: string }>(
    `SELECT id, data FROM held_orders WHERE instr(data, '"cost"') > 0`,
  );

  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data) as unknown;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;

    const held = { ...(parsed as Record<string, unknown>) };
    if (!Array.isArray(held.entries)) continue;
    let changed = false;
    held.entries = held.entries.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const projected = { ...(entry as Record<string, unknown>) };
      const item = stripProductSnapshotCosts(projected.item);
      const variant = stripProductSnapshotCosts(projected.variant);
      if (item.changed) {
        projected.item = item.value;
        changed = true;
      }
      if (variant.changed) {
        projected.variant = variant.value;
        changed = true;
      }
      return changed ? projected : entry;
    });

    if (changed) {
      db.runSync(`UPDATE held_orders SET data = ? WHERE id = ?`, JSON.stringify(held), row.id);
    }
  }
}

/**
 * Atomically move a store database to a narrower or wider read projection.
 *
 * A missing policy marker means the database predates filtered sync, so its
 * previous projection is deliberately treated as every collection. Clean rows
 * outside the projection and clean protected product costs are removed; dirty
 * rows (including tombstones) survive for later reconciliation by a suitably-
 * authorized user.
 */
function transitionReadProjectionOn(
  db: SQLite.SQLiteDatabase,
  input: ReadProjectionTransitionInput,
): ReadProjectionTransitionResult {
  let transitioned = false;
  let purgedCollections: Collection[] = [];

  withTx(db, () => {
    const policyIsCurrent =
      metaGetOn(db, input.policyMarkerKey) === input.policyVersion;
    const storedProjection = policyIsCurrent
      ? normalizedProjection(metaGetOn(db, input.readableCollectionsKey))
      : null;
    const previous = storedProjection ?? [...COLLECTIONS];
    const nextSet = new Set(input.nextReadable);
    const next = COLLECTIONS.filter((collection) => nextSet.has(collection));
    const projectionChanged =
      previous.length !== next.length ||
      previous.some((collection, index) => collection !== next[index]);
    const scopeChanged = metaGetOn(db, input.activeScopeKey) !== input.nextScope;

    transitioned = !policyIsCurrent || projectionChanged || scopeChanged;

    // Run this on every preparation, not only role transitions. A restricted
    // till may have created receipt/audit/stock rows since the last transition;
    // once acknowledged, none of those clean rows should survive a remount.
    purgedCollections = COLLECTIONS.filter((collection) => !nextSet.has(collection));
    purgeCleanCollectionsOn(db, purgedCollections);
    purgeRetiredProductImagesOn(db);
    redactHeldOrderCostsOn(db);
    if (!input.retainProductCosts) redactCleanProductCostsOn(db);

    if (!transitioned) return;

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
export function loadDirty<T>(c: Collection, limit?: number): DirtyRow<T>[] {
  return loadDirtyOn<T>(conn(), c, limit);
}

export function clearDirty(c: Collection, revisions: readonly DirtyRevision[]) {
  clearDirtyOn(conn(), c, revisions);
}

export function clearDirtyBatch(
  batches: readonly DirtyRevisionBatch[],
  purgeCollections: readonly Collection[] = [],
  redactProductCosts = false,
): void {
  clearDirtyBatchOn(conn(), batches, purgeCollections, redactProductCosts);
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
  loadDirty: <T>(c: Collection, limit?: number) => DirtyRow<T>[];
  clearDirty: (c: Collection, revisions: readonly DirtyRevision[]) => void;
  clearDirtyBatch: (
    batches: readonly DirtyRevisionBatch[],
    purgeCollections?: readonly Collection[],
    redactProductCosts?: boolean,
  ) => void;
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
    loadDirty: <T>(c: Collection, limit?: number) => loadDirtyOn<T>(handle(), c, limit),
    clearDirty: (c, revisions) => clearDirtyOn(handle(), c, revisions),
    clearDirtyBatch: (batches, purgeCollections, redactProductCosts) =>
      clearDirtyBatchOn(handle(), batches, purgeCollections, redactProductCosts),
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
