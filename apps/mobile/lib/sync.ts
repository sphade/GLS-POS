import * as Network from "expo-network";
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

/** Apply a server pull and notify every local data provider immediately. */
function applyPulled(storeId: string, data: SyncPullResponse, notify = true): number {
  for (const change of data.changes) {
    const row: ChangeRow<{ id: string }> = {
      id: change.id,
      data: change.data as { id: string },
      updatedAt: change.updatedAt,
      deleted: change.deleted,
    };
    applyRemote(change.collection as SyncCollection, row);
  }
  metaSet(cursorKey(storeId), String(data.cursor));
  if (notify && data.changes.length > 0) emitSynced(data.changes.length);
  return data.changes.length;
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
 * Pull server changes without uploading local dirty rows first. This guarantees
 * incoming VIP orders still arrive when an unrelated local edit is denied.
 * `fromBeginning` repairs older devices whose cursor advanced before
 * `web_orders` existed locally.
 *
 * Only one pull per store may run at a time. Equivalent callers share the
 * active or queued result, while requests with different backfill/notification
 * semantics run serially so a normal pull cannot incorrectly satisfy a
 * from-the-beginning repair.
 */
const pullBarriers = new Map<string, Promise<void>>();
const pendingPulls = new Map<string, Promise<number>>();

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
    const cursor = fromBeginning ? 0 : Number(metaGet(cursorKey(storeId)) ?? "0") || 0;
    const res = await fetchWithTimeout(`${API_URL}/api/sync?cursor=${cursor}`, {
      headers: { Cookie: cookie, "x-store-id": storeId },
    });
    const body = (await res.json()) as
      | { ok: true; data: SyncPullResponse }
      | { ok: false; error: { message: string } };
    if (!res.ok || !body.ok) return -1;
    return applyPulled(storeId, body.data, notify);
  } catch (e) {
    console.warn("[sync] pull failed:", (e as Error).message);
    return -1;
  }
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

  const key = `${storeId}:${fromBeginning ? "backfill" : "incremental"}:${notify ? "notify" : "silent"}`;
  const pending = pendingPulls.get(key);
  if (pending) return pending;

  const previous = pullBarriers.get(storeId) ?? Promise.resolve();
  const run = previous.then(() => performPull(storeId, fromBeginning, notify));
  const barrier = run.then(
    () => undefined,
    () => undefined,
  );
  pullBarriers.set(storeId, barrier);
  void barrier.then(() => {
    if (pullBarriers.get(storeId) === barrier) pullBarriers.delete(storeId);
  });

  let tracked: Promise<number>;
  tracked = run.finally(() => {
    if (pendingPulls.get(key) === tracked) pendingPulls.delete(key);
  });
  pendingPulls.set(key, tracked);
  return tracked;
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

    return { ok: true, appliedCount: applyPulled(storeId, body.data) };
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
 * Serialize sync cycles while coalescing equivalent queued requests. A trigger
 * that arrives during an active cycle still gets one follow-up cycle, so writes
 * created after the active cycle collected its rows are never mistaken for
 * already-published data. Further equivalent triggers share that queued cycle.
 */
type SyncJob = {
  key: string;
  storeId: string;
  onlyCollections?: readonly SyncCollection[];
  promise: Promise<SyncAttemptResult>;
  resolve: (result: SyncAttemptResult) => void;
  reject: (reason?: unknown) => void;
};

let syncRunning = false;
const syncQueue: SyncJob[] = [];
const queuedSyncs = new Map<string, Promise<SyncAttemptResult>>();

function syncRequestKey(
  storeId: string,
  onlyCollections?: readonly SyncCollection[],
): string {
  const scope = onlyCollections
    ? [...new Set(onlyCollections)].sort().join(",")
    : "*";
  return `${storeId}:${scope}`;
}

function drainSyncQueue(): void {
  if (syncRunning) return;
  const job = syncQueue.shift();
  if (!job) return;

  syncRunning = true;
  if (queuedSyncs.get(job.key) === job.promise) queuedSyncs.delete(job.key);

  void (async () => {
    try {
      job.resolve(await performSync(job.storeId, job.onlyCollections));
    } catch (error) {
      job.reject(error);
    } finally {
      syncRunning = false;
      drainSyncQueue();
    }
  })();
}

export function syncNowDetailed(
  storeId: string,
  onlyCollections?: readonly SyncCollection[],
): Promise<SyncAttemptResult> {
  const key = syncRequestKey(storeId, onlyCollections);
  const queued = queuedSyncs.get(key);
  if (queued) return queued;

  let resolve!: (result: SyncAttemptResult) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<SyncAttemptResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const job: SyncJob = {
    key,
    storeId,
    onlyCollections: onlyCollections ? [...onlyCollections] : undefined,
    promise,
    resolve,
    reject,
  };
  queuedSyncs.set(key, promise);
  syncQueue.push(job);
  drainSyncQueue();
  return promise;
}

/** Backward-compatible count result used by existing refresh UI. */
export async function syncNow(storeId: string): Promise<number> {
  const result = await syncNowDetailed(storeId);
  return result.ok ? result.appliedCount : -1;
}

/**
 * Master switch for background sync. OFF by default so the app runs as a pure
 * offline/local demo with zero network calls. Flip it on by setting
 * EXPO_PUBLIC_ENABLE_SYNC=1 once a reachable backend is available.
 */
export const SYNC_ENABLED = process.env.EXPO_PUBLIC_ENABLE_SYNC === "1";

/**
 * Start periodic background sync for a store. Returns a stop function.
 * Fires immediately, then every `intervalMs` (default 20s).
 *
 * When sync is disabled (the default), this is a complete no-op — it never
 * touches the network, the auth cookie, or secure storage — so the demo works
 * entirely from local data.
 */
export function startAutoSync(storeId: string, intervalMs = 20_000): () => void {
  if (!SYNC_ENABLED) return () => {};
  void syncNow(storeId);
  const handle = setInterval(() => void syncNow(storeId), intervalMs);

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
  };
}
