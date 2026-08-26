import * as Network from "expo-network";
import { AppState } from "react-native";
import type { SyncChange, SyncCollection, SyncPullResponse } from "@gls-pos/types";
import { SYNC_COLLECTIONS } from "@gls-pos/types";
import {
  applyRemote,
  clearDirty,
  loadDirty,
  metaGet,
  metaSet,
  onLocalWrite,
  type ChangeRow,
} from "./db";
import { API_URL, authCookie } from "./auth-client";
import { OFFLINE_MODE } from "./offline";

/**
 * Offline-first sync engine.
 *
 * Reads locally-dirty rows out of the device SQLite (see lib/db.ts), pushes
 * them to the store's Durable Object in one round-trip, then applies whatever
 * the server returns. The server assigns a monotonic sequence to every change;
 * we persist the high-water `cursor` per store so the next sync only pulls
 * what's new. All conflict resolution is last-write-wins on `updatedAt`.
 *
 * Everything degrades gracefully: no network or no session → no-op, and the
 * app keeps working entirely from local data.
 */

const cursorKey = (storeId: string) => `sync_cursor_${storeId}`;
const SYNC_TIMEOUT_MS = 15_000;

export type SyncAttemptResult =
  | { ok: true; appliedCount: number }
  | {
      ok: false;
      kind:
        | "disabled"
        | "invalid_store"
        | "auth"
        | "offline"
        | "server"
        | "network"
        | "timeout";
      message: string;
      status?: number;
      code?: string;
    };

/**
 * Upload budget per request.
 *
 * A push used to send every dirty row in one POST. That is fine for orders and
 * catalog edits, but `product_images` rows are 30–80KB of base64 each, so a
 * freshly seeded store produced a multi-megabyte body that could not finish
 * inside SYNC_TIMEOUT_MS on a phone connection. The request aborted, nothing was
 * marked clean, and the next attempt resent the same oversized payload — an
 * endless "could not reach the server" on a perfectly good network.
 *
 * Batches are therefore capped by encoded size and by row count, and each batch
 * clears its own dirty rows so progress is never lost.
 */
const MAX_PUSH_BYTES = 512 * 1024;
const MAX_PUSH_ROWS = 200;

type PushBatch = { changes: SyncChange[]; idsByCollection: Record<string, string[]> };

/**
 * Split changes into batches that respect the upload budget. A single row over
 * the budget still gets its own batch — dropping it would mean it never syncs.
 */
function batchChanges(changes: SyncChange[]): PushBatch[] {
  const batches: PushBatch[] = [];
  let current: PushBatch = { changes: [], idsByCollection: {} };
  let bytes = 0;

  const flush = () => {
    if (current.changes.length === 0) return;
    batches.push(current);
    current = { changes: [], idsByCollection: {} };
    bytes = 0;
  };

  for (const change of changes) {
    const size = JSON.stringify(change).length;
    if (current.changes.length > 0 && (bytes + size > MAX_PUSH_BYTES || current.changes.length >= MAX_PUSH_ROWS)) {
      flush();
    }
    current.changes.push(change);
    (current.idsByCollection[change.collection] ??= []).push(change.id);
    bytes += size;
  }
  flush();

  return batches;
}

/** Gather dirty changes, optionally limiting the push to selected collections. */
function collectDirty(
  onlyCollections?: readonly SyncCollection[],
): { changes: SyncChange[]; idsByCollection: Record<string, string[]> } {
  const changes: SyncChange[] = [];
  const idsByCollection: Record<string, string[]> = {};

  for (const collection of onlyCollections ?? SYNC_COLLECTIONS) {
    const dirty = loadDirty<unknown>(collection);
    if (dirty.length === 0) continue;
    idsByCollection[collection] = dirty.map((d) => d.id);
    for (const d of dirty) {
      changes.push({
        collection,
        id: d.id,
        data: d.data,
        updatedAt: d.updatedAt,
        deleted: d.deleted,
      });
    }
  }

  return { changes, idsByCollection };
}

/**
 * Listeners notified after a sync applies remote changes, so features can react
 * the instant data lands instead of polling their own timers.
 */
type SyncListener = (appliedCount: number) => void;
const listeners = new Set<SyncListener>();

/** Subscribe to sync completions. Returns an unsubscribe function. */
export function onSynced(fn: SyncListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emitSynced(count: number) {
  listeners.forEach((fn) => {
    try {
      fn(count);
    } catch {
      // A bad listener must never break syncing.
    }
  });
}

/**
 * Rows applied per JS-task when pulling. expo-sqlite writes are synchronous,
 * so a big catch-up (first install, long absence) applied in one go would hold
 * the JS thread and jank the UI exactly like the old sync storms did. Chunking
 * yields between batches so touches and frames stay responsive throughout.
 */
const APPLY_CHUNK = 40;

/** Apply a server pull in chunks, then notify every local data provider. */
async function applyPulled(storeId: string, data: SyncPullResponse, notify = true): Promise<number> {
  // Era guard: if the store's head sequence is BEHIND our bookmark, its oplog
  // was rebuilt at some point (e.g. a Durable Object storage reset). Our cursor
  // would point past its history forever, making every future pull silently
  // empty. Rewind once and catch up from scratch — rows re-apply idempotently.
  const prior = Number(metaGet(cursorKey(storeId)) ?? "0") || 0;
  const head = data.head ?? 0;
  if (head > 0 && prior > head) {
    console.warn("[sync] store oplog rebuilt (head", head, "< cursor", prior, ") — pulling from zero");
    metaSet(cursorKey(storeId), "0");
  }

  let applied = 0;

  for (let start = 0; start < data.changes.length; start += APPLY_CHUNK) {
    const batch = data.changes.slice(start, start + APPLY_CHUNK);
    for (const change of batch) {
      const row: ChangeRow<{ id: string }> = {
        id: change.id,
        data: change.data as { id: string },
        updatedAt: change.updatedAt,
        deleted: change.deleted,
      };
      applyRemote(change.collection as SyncCollection, row);
    }
    applied += batch.length;
    if (start + APPLY_CHUNK < data.changes.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  // The cursor advances only once every row is in, so an app killed mid-pull
  // simply refetches the tail instead of losing it. Re-applying rows is safe —
  // every write is an idempotent upsert guarded by last-write-wins.
  metaSet(cursorKey(storeId), String(data.cursor));
  if (notify && applied > 0) emitSynced(applied);
  return applied;
}

/** Fetch with a hard deadline so a sync request cannot hang indefinitely. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Page budget for one pull request. The server pages its responses (rows and
 * bytes), so a full catch-up — including product photos — arrives across
 * several bounded requests instead of one multi-megabyte reply that always
 * overran the request timeout.
 */
const PULL_MAX_PAGES = 60;

/**
 * Fetch server changes without uploading local dirty rows first. This guarantees
 * incoming VIP orders still arrive when an unrelated local edit is denied.
 * `fromBeginning` repairs older devices whose cursor advanced before
 * `web_orders` existed locally.
 *
 * Pages are fetched back-to-back while the server keeps reporting progress, so
 * a first sync completes in seconds rather than waiting on repeated polls.
 */
async function performPull(
  storeId: string,
  fromBeginning: boolean,
  notify: boolean,
): Promise<number> {
  const cookie = authCookie();
  if (!cookie) return -1;

  try {
    const netState = await Network.getNetworkStateAsync();
    if (netState.isInternetReachable === false) return -1;

    let appliedTotal = 0;

    for (let page = 0; page < PULL_MAX_PAGES; page += 1) {
      // Re-read the stored cursor every page: applyPulled may have rewound it
      // to zero after detecting a rebuilt server oplog.
      const cursor = page === 0 && fromBeginning
        ? 0
        : Number(metaGet(cursorKey(storeId)) ?? "0") || 0;

      const res = await fetchWithTimeout(`${API_URL}/api/sync?cursor=${cursor}`, {
        headers: { Cookie: cookie, "x-store-id": storeId },
      });
      const body = (await res.json()) as
        | { ok: true; data: SyncPullResponse }
        | { ok: false; error: { message: string } };
      if (!res.ok || !body.ok) return appliedTotal > 0 ? appliedTotal : -1;

      const applied = await applyPulled(storeId, body.data, notify);
      if (applied > 0) appliedTotal += applied;

      // Empty page, or the server returned our own cursor back: we're caught up.
      // Otherwise loop — the next page re-reads the cursor applyPulled stored.
      if (body.data.changes.length === 0 || body.data.cursor <= cursor) break;
    }

    return appliedTotal;
  } catch (e) {
    console.warn("[sync] pull failed:", (e as Error).message);
    return -1;
  }
}

/**
 * One serialized pipeline for every network cycle — full syncs and pull-onlys
 * alike. Jobs run strictly one at a time in arrival order; equivalent queued
 * requests share the running-or-queued result instead of duplicating work.
 *
 * Previously pulls and syncs each ran their own concurrent pipelines, so a
 * WebSocket nudge could open a second round-trip mid-poll. One lane means at
 * most a single request in flight per device, which is what keeps the UI calm.
 */
const jobQueue: { key: string; run: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (reason?: unknown) => void }[] = [];
const queuedJobs = new Map<string, Promise<unknown>>();
let jobRunning = false;

function enqueueJob<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = queuedJobs.get(key);
  if (existing) return existing as Promise<T>;

  let resolve!: (value: unknown) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  queuedJobs.set(key, promise);
  jobQueue.push({ key, run: run as () => Promise<unknown>, resolve, reject });

  if (!jobRunning) {
    jobRunning = true;
    void (async () => {
      for (;;) {
        const job = jobQueue.shift();
        if (!job) break;
        queuedJobs.delete(job.key);
        try {
          job.resolve(await job.run());
        } catch (error) {
          job.reject(error);
        }
      }
      jobRunning = false;
    })();
  }
  return promise as Promise<T>;
}

export function pullNow(
  storeId: string,
  fromBeginning = false,
  notify = true,
): Promise<number> {
  if (!SYNC_ENABLED) return Promise.resolve(-1);
  if (!storeId || storeId === "store_unknown" || storeId === "bootstrap") {
    return Promise.resolve(-1);
  }

  const key = `${storeId}|pull|${fromBeginning ? "backfill" : "incremental"}|${notify ? "notify" : "silent"}`;
  return enqueueJob(key, () => performPull(storeId, fromBeginning, notify));
}

async function performSync(
  storeId: string,
  onlyCollections?: readonly SyncCollection[],
): Promise<SyncAttemptResult> {
  if (!SYNC_ENABLED) {
    return {
      ok: false,
      kind: "disabled",
      message: "Server sync is disabled in this build. Enable sync and restart the app before publishing.",
    };
  }

  if (!storeId || storeId === "store_unknown" || storeId === "bootstrap") {
    return { ok: false, kind: "invalid_store", message: "No valid store is selected." };
  }

  const cookie = authCookie();
  if (!cookie) {
    return {
      ok: false,
      kind: "auth",
      message: "Your sign-in session is unavailable. Sign out and sign in again, then retry.",
    };
  }

  try {
    const netState = await Network.getNetworkStateAsync();
    if (netState.isInternetReachable === false) {
      return { ok: false, kind: "offline", message: "This device is offline. Connect to the internet and retry." };
    }

    const { changes } = collectDirty(onlyCollections);
    // One request per batch. The last one always runs even with nothing dirty,
    // so a sync with no local edits still pulls server changes.
    const batches = batchChanges(changes);
    const queue: PushBatch[] = batches.length > 0 ? batches : [{ changes: [], idsByCollection: {} }];

    let applied = 0;
    for (const batch of queue) {
      const result = await pushBatch(storeId, cookie, batch);
      if (!result.ok) return result;
      applied += result.appliedCount;
    }
    return { ok: true, appliedCount: applied };
  } catch (e) {
    const error = e as Error;
    const timedOut = error.name === "AbortError";
    const message = timedOut
      ? "The server took too long to respond. Check your connection and retry."
      : `Could not reach the server: ${error.message}`;
    console.warn("[sync] failed:", message);
    return { ok: false, kind: timedOut ? "timeout" : "network", message };
  }
}

/** Push one batch, clear its dirty rows on success, and apply what came back. */
async function pushBatch(
  storeId: string,
  cookie: string,
  batch: PushBatch,
): Promise<SyncAttemptResult> {
  const { changes, idsByCollection } = batch;
  try {
    // Re-read per batch: an earlier batch advances the cursor.
    const cursor = Number(metaGet(cursorKey(storeId)) ?? "0") || 0;
    const res = await fetchWithTimeout(`${API_URL}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "x-store-id": storeId,
      },
      body: JSON.stringify({ cursor, changes }),
    });

    let body:
      | { ok: true; data: SyncPullResponse }
      | { ok: false; error: { code?: string; message?: string } };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return {
        ok: false,
        kind: "server",
        status: res.status,
        message: `The server returned an invalid response (${res.status}).`,
      };
    }

    if (!res.ok || !body.ok) {
      const code = body.ok ? undefined : body.error.code;
      const serverMessage = body.ok ? undefined : body.error.message;
      const message =
        res.status === 401
          ? "Your session has expired. Sign out and sign in again, then retry."
          : res.status === 403
            ? serverMessage ?? "Your account does not have permission to publish this table."
            : serverMessage ?? `The server rejected the update (${res.status}).`;
      console.warn("[sync] server rejected:", message);
      return {
        ok: false,
        kind: res.status === 401 ? "auth" : "server",
        status: res.status,
        code,
        message,
      };
    }

    for (const [collection, ids] of Object.entries(idsByCollection)) {
      clearDirty(collection as SyncCollection, ids);
    }

    return { ok: true, appliedCount: await applyPulled(storeId, body.data) };
  } catch (e) {
    const error = e as Error;
    const timedOut = error.name === "AbortError";
    const message = timedOut
      ? "The server took too long to respond. Check your connection and retry."
      : `Could not reach the server: ${error.message}`;
    console.warn("[sync] failed:", message);
    return { ok: false, kind: timedOut ? "timeout" : "network", message };
  }
}

/**
 * Coalescing key for a full sync. A trigger that arrives while an equivalent
 * cycle is active or queued shares its result; writes created after the active
 * cycle collected its rows are covered by the follow-up cycle the debounced
 * push-on-write schedules.
 */
function syncRequestKey(
  storeId: string,
  onlyCollections?: readonly SyncCollection[],
): string {
  const scope = onlyCollections
    ? [...new Set(onlyCollections)].sort().join(",")
    : "*";
  return `${storeId}|sync|${scope}`;
}

// --- Failure retry ladder ---------------------------------------------------
//
// A failed push used to wait for the next poll (up to 20s) before retrying,
// which is why a sale could sit on one till for half a minute. Transient
// failures now re-arm themselves quickly: 3s → 6s → 12s → 24s → 48s, then stop
// (the poll, nudges, and connectivity-regain flush take over from there).
const RETRY_DELAYS_MS = [3_000, 6_000, 12_000, 24_000, 48_000];
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryAttempts = new Map<string, number>();

function cancelRetry(storeId: string): void {
  const timer = retryTimers.get(storeId);
  if (timer) clearTimeout(timer);
  retryTimers.delete(storeId);
}

function clearRetryState(storeId: string): void {
  cancelRetry(storeId);
  retryAttempts.delete(storeId);
}

/** Called after every full-sync attempt: success resets, transient failures
 *  schedule the next rung of the ladder, permanent ones stop auto-retrying. */
function handleSyncOutcome(storeId: string, result: SyncAttemptResult): void {
  if (!SYNC_ENABLED) return;
  if (result.ok) {
    clearRetryState(storeId);
    return;
  }
  if (result.kind !== "network" && result.kind !== "timeout") {
    // Auth/server/permission failures won't heal by hammering; leave them to
    // the user (banners surface the reason) and the regular poll.
    clearRetryState(storeId);
    return;
  }

  const attempts = (retryAttempts.get(storeId) ?? 0) + 1;
  if (attempts > RETRY_DELAYS_MS.length) return; // ladder exhausted
  if (retryTimers.has(storeId)) return; // a retry is already armed

  retryAttempts.set(storeId, attempts);
  const delay = RETRY_DELAYS_MS[attempts - 1]!;
  const timer = setTimeout(() => {
    retryTimers.delete(storeId);
    void syncNow(storeId);
  }, delay);
  retryTimers.set(storeId, timer);
}

/** Immediate flush when the network comes back — no waiting for the ladder. */
let networkListenerBound = false;

export function syncNowDetailed(
  storeId: string,
  onlyCollections?: readonly SyncCollection[],
): Promise<SyncAttemptResult> {
  const key = syncRequestKey(storeId, onlyCollections);

  // Bind once per app session: regaining internet retries instantly and wipes
  // any backoff state, because a fresh connection makes the old failure count
  // meaningless.
  if (!networkListenerBound && SYNC_ENABLED) {
    networkListenerBound = true;
    try {
      // Optional + structurally typed: older expo-network versions may not
      // expose a listener; ladder + polling still cover those installs.
      const networkModule = Network as unknown as {
        addNetworkStateListener?: (
          listener: (event: { networkState?: { isInternetReachable?: boolean | null } }) => void,
        ) => { remove(): void };
      };
      networkModule.addNetworkStateListener?.((event) => {
        if (event.networkState?.isInternetReachable === true) {
          const affected = new Set([...retryTimers.keys(), ...retryAttempts.keys()]);
          for (const store of affected) clearRetryState(store);
          void syncNow(storeId);
        }
      });
    } catch {
      /* listener unsupported — ladder + polling still cover it */
    }
  }

  return enqueueJob(key, async () => {
    const result = await performSync(storeId, onlyCollections);
    handleSyncOutcome(storeId, result);
    return result;
  });
}

/** Backward-compatible count result used by existing refresh UI. */
export async function syncNow(storeId: string): Promise<number> {
  const result = await syncNowDetailed(storeId);
  return result.ok ? result.appliedCount : -1;
}

/**
 * Master switch for every network path this module exposes (sync, pull, and
 * the realtime gate downstream). OFF by default so the app runs as a pure
 * offline/local demo with zero network calls. Enable both of:
 *   EXPO_PUBLIC_ENABLE_SYNC=1  (and EXPO_PUBLIC_OFFLINE_MODE unset/0)
 * OFFLINE_MODE always wins — when the backend is stripped, nothing here runs.
 */
export const SYNC_ENABLED =
  !OFFLINE_MODE && process.env.EXPO_PUBLIC_ENABLE_SYNC === "1";

/**
 * Start periodic background sync for a store. Returns a stop function.
 * Fires immediately, then every `intervalMs` (default 20s).
 *
 * Polling runs only while the app is foregrounded — a backgrounded till
 * shouldn't burn battery or data on requests nobody is looking at. Background
 * devices stay fresh via WebSocket nudges and push notifications instead,
 * which each trigger one immediate catch-up when something actually changed.
 *
 * When sync is disabled (the default), this is a complete no-op — it never
 * touches the network, the auth cookie, or secure storage — so the demo works
 * entirely from local data.
 */
export function startAutoSync(storeId: string, intervalMs = 20_000): () => void {
  if (!SYNC_ENABLED) return () => {};
  clearRetryState(storeId);
  void syncNow(storeId);
  const handle = setInterval(() => {
    if (AppState.currentState !== "active") return;
    void syncNow(storeId);
  }, intervalMs);

  // Push-on-write: a local edit schedules a sync ~1s later instead of waiting
  // for the next poll, so changes leave the device promptly. Debounced so a
  // burst of edits (e.g. building a cart) collapses into one push.
  let debounce: ReturnType<typeof setTimeout> | null = null;
  onLocalWrite(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void syncNow(storeId), 1200);
  });

  return () => {
    clearInterval(handle);
    if (debounce) clearTimeout(debounce);
    onLocalWrite(null);
    clearRetryState(storeId);
  };
}
