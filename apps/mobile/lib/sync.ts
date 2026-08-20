import * as Network from "expo-network";
import type { SyncChange, SyncCollection, SyncPullResponse } from "@gls-pos/types";
import { SYNC_COLLECTIONS } from "@gls-pos/types";
import {
  applyRemote,
  clearDirty,
  loadDirty,
  metaGet,
  metaSet,
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
      kind: "invalid_store" | "auth" | "offline" | "server" | "network" | "timeout";
      message: string;
      status?: number;
      code?: string;
    };

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
  if (notify) emitSynced(data.changes.length);
  return data.changes.length;
}

/** Fetch with a hard deadline so a publish screen cannot spin forever. */
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
 */
export async function pullNow(
  storeId: string,
  fromBeginning = false,
  notify = true,
): Promise<number> {
  if (!storeId || storeId === "store_unknown" || storeId === "bootstrap") return -1;
  const cookie = authCookie();
  if (!cookie) return -1;
  try {
    const netState = await Network.getNetworkStateAsync();
    if (netState.isInternetReachable === false) return -1;
    const cursor = fromBeginning ? 0 : Number(metaGet(cursorKey(storeId)) ?? "0") || 0;
    const res = await fetch(`${API_URL}/api/sync?cursor=${cursor}`, {
      headers: { Cookie: cookie, "x-store-id": storeId },
    });
    const body = (await res.json()) as
      | { ok: true; data: SyncPullResponse }
      | { ok: false; error: { message: string } };
    if (!body.ok) return -1;
    return applyPulled(storeId, body.data, notify);
  } catch (e) {
    console.warn("[sync] pull failed:", (e as Error).message);
    return -1;
  }
}

async function performSync(
  storeId: string,
  onlyCollections?: readonly SyncCollection[],
): Promise<SyncAttemptResult> {
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

    const cursor = Number(metaGet(cursorKey(storeId)) ?? "0") || 0;
    const { changes, idsByCollection } = collectDirty(onlyCollections);
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
 * The active request is shared as a serialization barrier. A caller arriving
 * mid-sync waits and then runs its own cycle, so it never mistakes "queued" for
 * "published".
 */
let activeSync: Promise<SyncAttemptResult> | null = null;

export function syncNowDetailed(
  storeId: string,
  onlyCollections?: readonly SyncCollection[],
): Promise<SyncAttemptResult> {
  if (activeSync) {
    return activeSync.then(() => syncNowDetailed(storeId, onlyCollections));
  }

  const run = performSync(storeId, onlyCollections);
  activeSync = run;
  return run.finally(() => {
    if (activeSync === run) activeSync = null;
  });
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
export const SYNC_ENABLED = process.env.EXPO_PUBLIC_ENABLE_SYNC !== "0";

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
  return () => clearInterval(handle);
}
