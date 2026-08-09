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

/** Gather every locally-dirty change across all collections into wire form. */
function collectDirty(): { changes: SyncChange[]; idsByCollection: Record<string, string[]> } {
  const changes: SyncChange[] = [];
  const idsByCollection: Record<string, string[]> = {};

  for (const collection of SYNC_COLLECTIONS) {
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

let inFlight = false;

/**
 * Run one sync cycle for the given store. Returns the number of remote changes
 * applied, or -1 if it was skipped (offline / signed out / already running).
 */
export async function syncNow(storeId: string): Promise<number> {
  if (inFlight) return -1;

  const cookie = authCookie();
  if (!cookie) return -1; // not signed in yet

  const netState = await Network.getNetworkStateAsync();
  if (!netState.isInternetReachable) return -1;

  inFlight = true;
  try {
    const cursor = Number(metaGet(cursorKey(storeId)) ?? "0") || 0;
    const { changes, idsByCollection } = collectDirty();

    const res = await fetch(`${API_URL}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "x-store-id": storeId,
      },
      body: JSON.stringify({ cursor, changes }),
    });

    const body = (await res.json()) as
      | { ok: true; data: SyncPullResponse }
      | { ok: false; error: { code: string; message: string } };

    if (!body.ok) {
      console.warn("[sync] server rejected:", body.error.message);
      return -1;
    }

    // Our pushes were accepted — clear their dirty flags.
    for (const [collection, ids] of Object.entries(idsByCollection)) {
      clearDirty(collection as SyncCollection, ids);
    }

    // Apply everything the server sent back (last-write-wins in applyRemote).
    for (const change of body.data.changes) {
      const row: ChangeRow<{ id: string }> = {
        id: change.id,
        data: change.data as { id: string },
        updatedAt: change.updatedAt,
        deleted: change.deleted,
      };
      applyRemote(change.collection as SyncCollection, row);
    }

    metaSet(cursorKey(storeId), String(body.data.cursor));
    return body.data.changes.length;
  } catch (e) {
    console.warn("[sync] failed:", (e as Error).message);
    return -1;
  } finally {
    inFlight = false;
  }
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
  return () => clearInterval(handle);
}
