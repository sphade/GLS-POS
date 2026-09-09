import * as Network from "expo-network";
import { AppState } from "react-native";
import { useCallback, useState } from "react";
import type { StoreRole, SyncChange, SyncCollection, SyncPullResponse } from "@gls-pos/types";
import {
  readableSyncCollections,
  SYNC_COLLECTIONS,
  SYNC_READ_POLICY_VERSION,
} from "@gls-pos/types";
import {
  getActiveStore,
  onLocalWrite,
  storeScope,
  type ChangeRow,
  type RemoteCollectionChange,
  type StoreScope,
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
const initialPullKey = (storeId: string) => `initial_pull_v1_${storeId}`;
const webOrdersBackfillKey = (storeId: string) => `web_orders_backfill_v1_${storeId}`;
const activeReadScopeKey = (storeId: string) => `active_read_scope_v2_${storeId}`;
const completedReadScopeKey = (storeId: string) => `completed_read_scope_v2_${storeId}`;
const pendingReadScopeKey = (storeId: string) => `pending_read_scope_v2_${storeId}`;
const replayHeadKey = (storeId: string) => `replay_head_v2_${storeId}`;
const readProjectionPolicyKey = (storeId: string) => `read_projection_policy_v2_${storeId}`;
const readableCollectionsKey = (storeId: string) => `readable_collections_v2_${storeId}`;
const readScopeForRole = (role: StoreRole) =>
  `${role}:read-policy-v${SYNC_READ_POLICY_VERSION}`;
const SYNC_TIMEOUT_MS = 15_000;

type SyncEpoch = {
  storeId: string;
  role: StoreRole;
  scope: string;
  generation: number;
  controller: AbortController;
};

const activeSyncEpochs = new Map<string, SyncEpoch>();
let foregroundSyncEpoch: SyncEpoch | null = null;
let nextSyncEpochGeneration = 0;

function epochIsCurrent(epoch: SyncEpoch): boolean {
  return (
    !epoch.controller.signal.aborted &&
    activeSyncEpochs.get(epoch.storeId) === epoch &&
    foregroundSyncEpoch === epoch
  );
}

function retireSyncEpoch(epoch: SyncEpoch): void {
  epoch.controller.abort();
  if (activeSyncEpochs.get(epoch.storeId) === epoch) {
    activeSyncEpochs.delete(epoch.storeId);
  }
  if (foregroundSyncEpoch === epoch) foregroundSyncEpoch = null;
}

function activateSyncEpoch(storeId: string, role: StoreRole): SyncEpoch {
  const scope = readScopeForRole(role);
  const existing = activeSyncEpochs.get(storeId);
  if (
    existing &&
    existing.role === role &&
    existing.scope === scope &&
    !existing.controller.signal.aborted
  ) {
    if (foregroundSyncEpoch && foregroundSyncEpoch !== existing) {
      retireSyncEpoch(foregroundSyncEpoch);
    }
    foregroundSyncEpoch = existing;
    return existing;
  }

  if (foregroundSyncEpoch) retireSyncEpoch(foregroundSyncEpoch);
  if (existing && existing !== foregroundSyncEpoch) retireSyncEpoch(existing);

  const epoch: SyncEpoch = {
    storeId,
    role,
    scope,
    generation: ++nextSyncEpochGeneration,
    controller: new AbortController(),
  };
  activeSyncEpochs.set(storeId, epoch);
  foregroundSyncEpoch = epoch;
  return epoch;
}

function currentSyncEpoch(storeId: string): SyncEpoch | null {
  const epoch = activeSyncEpochs.get(storeId) ?? null;
  return epoch && epochIsCurrent(epoch) ? epoch : null;
}

/**
 * Prepare the local authorization projection before store-scoped providers
 * render. The DB transaction purges only clean rows that the new role cannot
 * read and closes the upload gate until a cursor-zero replay drains.
 */
export function prepareStoreSyncScope(storeId: string, role: StoreRole): void {
  if (!storeId || storeId === "bootstrap" || storeId === "store_unknown") {
    if (foregroundSyncEpoch) retireSyncEpoch(foregroundSyncEpoch);
    return;
  }

  const epoch = activateSyncEpoch(storeId, role);
  const db = storeScope(storeId);
  db.transitionReadProjection({
    policyMarkerKey: readProjectionPolicyKey(storeId),
    policyVersion: String(SYNC_READ_POLICY_VERSION),
    readableCollectionsKey: readableCollectionsKey(storeId),
    activeScopeKey: activeReadScopeKey(storeId),
    completedScopeKey: completedReadScopeKey(storeId),
    pendingScopeKey: pendingReadScopeKey(storeId),
    cursorKey: cursorKey(storeId),
    replayHeadKey: replayHeadKey(storeId),
    nextScope: epoch.scope,
    nextReadable: readableSyncCollections(role),
  });
}

// --- Cold-start boot state ---------------------------------------------------
// Uploads stay behind the authoritative download until the current role's
// visibility scope has drained. Durable active/completed/pending markers make
// every role transition (including A -> B -> A) invalidate readiness exactly once.
function isBooted(storeId: string): boolean {
  const db = storeScope(storeId);
  const activeScope = db.metaGet(activeReadScopeKey(storeId));
  const pendingScope = db.metaGet(pendingReadScopeKey(storeId));
  return (
    activeScope !== null &&
    (pendingScope === null || pendingScope === "") &&
    db.metaGet(completedReadScopeKey(storeId)) === activeScope &&
    db.metaGet(initialPullKey(storeId)) === "1" &&
    db.metaGet(webOrdersBackfillKey(storeId)) === "1"
  );
}

/** Collections this device NEVER uploads. Product photos are 30–80KB base64 */
/** blobs; they reach devices via remote URLs, not the sync stream. */
const UPLOAD_SKIP: readonly SyncCollection[] = ["product_images"];
const UPLOADABLE_COLLECTIONS: readonly SyncCollection[] = SYNC_COLLECTIONS.filter(
  (collection) => !UPLOAD_SKIP.includes(collection),
);

/**
 * Number of durable local revisions still waiting to upload for one store.
 * Uses indexed COUNT queries through that store's explicit handle; payload JSON
 * is never loaded or parsed, and collections the sync engine never uploads are
 * deliberately excluded.
 */
export function getPendingSyncCount(storeId: string): number {
  if (!SYNC_ENABLED || !storeId || storeId === "bootstrap" || storeId === "store_unknown") {
    return 0;
  }
  const db = storeScope(storeId);
  return UPLOADABLE_COLLECTIONS.reduce(
    (total, collection) => total + db.countDirty(collection),
    0,
  );
}

export type SyncAttemptResult =
  | { ok: true; appliedCount: number }
  | {
      ok: false;
      kind:
        | "disabled"
        | "invalid_store"
        | "cancelled"
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

type DirtyRevision = Pick<SyncChange, "id" | "updatedAt">;
type PushBatch = {
  changes: SyncChange[];
  revisionsByCollection: Record<string, DirtyRevision[]>;
};

/**
 * Split changes into batches that respect the upload budget. A single row over
 * the budget still gets its own batch — dropping it would mean it never syncs.
 */
function batchChanges(changes: SyncChange[]): PushBatch[] {
  const batches: PushBatch[] = [];
  let current: PushBatch = { changes: [], revisionsByCollection: {} };
  let bytes = 0;

  const flush = () => {
    if (current.changes.length === 0) return;
    batches.push(current);
    current = { changes: [], revisionsByCollection: {} };
    bytes = 0;
  };

  for (const change of changes) {
    const size = JSON.stringify(change).length;
    if (current.changes.length > 0 && (bytes + size > MAX_PUSH_BYTES || current.changes.length >= MAX_PUSH_ROWS)) {
      flush();
    }
    current.changes.push(change);
    (current.revisionsByCollection[change.collection] ??= []).push({
      id: change.id,
      updatedAt: change.updatedAt,
    });
    bytes += size;
  }
  flush();

  return batches;
}

/**
 * Gather dirty changes, optionally limiting the push to selected collections.
 *
 * Reads from the store being synced, not whichever store is active — otherwise a
 * cycle that outlived a shop switch uploads the newly-opened shop's rows into the
 * previous shop's Durable Object.
 */
function collectDirty(
  db: StoreScope,
  onlyCollections?: readonly SyncCollection[],
): { changes: SyncChange[]; idsByCollection: Record<string, string[]> } {
  const changes: SyncChange[] = [];
  const idsByCollection: Record<string, string[]> = {};

  for (const collection of onlyCollections ?? SYNC_COLLECTIONS) {
    const dirty = db.loadDirty<unknown>(collection);
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
 * What one successful sync cycle changed locally.
 *
 * `pulledCollections` contain server rows applied to this device and therefore
 * may require data providers to reload. `uploadedCollections` only had their
 * dirty flags cleared after a successful push; local React state already holds
 * their data, but upload-status UI (for example Today) needs to refresh.
 */
export type SyncEvent = {
  /** Store that owns every id in this event. */
  storeId: string;
  /** Backfills update providers but must not alarm for historical web orders. */
  source: "incremental" | "backfill";
  appliedCount: number;
  pulledCollections: ReadonlySet<SyncCollection>;
  uploadedCollections: ReadonlySet<SyncCollection>;
  /**
   * Ids applied per collection this cycle.
   *
   * Providers used to answer a pull by re-reading their whole collection, which
   * for an append-only one like `receipts` meant parsing the entire trading
   * history every time any till made a sale. That cost grows all day and lands
   * on the JS thread, so taps queue behind it. With the ids in hand a provider
   * can merge just what moved, which stays flat no matter how long the shop has
   * been open.
   */
  pulledIds: ReadonlyMap<SyncCollection, readonly string[]>;
};

type SyncListener = (event: SyncEvent) => void;
const listeners = new Set<SyncListener>();

/** Subscribe to meaningful sync completions. Returns an unsubscribe function. */
export function onSynced(fn: SyncListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emitSynced(event: SyncEvent, epoch: SyncEpoch) {
  // A queued request may finish after a branch or role switch. It can neither
  // merge rows into the new projection nor wake providers from the retired one.
  if (!epochIsCurrent(epoch) || event.storeId !== getActiveStore()) return;
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      // A bad listener must never break syncing.
    }
  });
}

// --- Visible activity (drives the top status bar) ---------------------------
export type SyncErrorKind = Extract<SyncAttemptResult, { ok: false }>["kind"];
export type SyncActivity = {
  busy: boolean;
  error: string | null;
  /** Machine-readable recovery path for the current error (for example auth). */
  errorKind: SyncErrorKind | null;
  /** Store that produced the error; screens ignore stale failures after a switch. */
  errorStoreId: string | null;
};
let activity: SyncActivity = {
  busy: false,
  error: null,
  errorKind: null,
  errorStoreId: null,
};
const activityListeners = new Set<() => void>();

function setActivity(patch: Partial<SyncActivity>): void {
  const next = { ...activity, ...patch };
  if (
    next.busy === activity.busy &&
    next.error === activity.error &&
    next.errorKind === activity.errorKind &&
    next.errorStoreId === activity.errorStoreId
  ) {
    return;
  }
  activity = next;
  activityListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* bad listener */
    }
  });
}

export function subscribeSyncActivity(cb: () => void): () => void {
  activityListeners.add(cb);
  return () => activityListeners.delete(cb);
}

export function getSyncActivity(): SyncActivity {
  return activity;
}

/**
 * Rows applied per JS-task when pulling. expo-sqlite writes are synchronous,
 * so a big catch-up (first install, long absence) applied in one go would hold
 * the JS thread and jank the UI exactly like the old sync storms did. Chunking
 * yields between batches so touches and frames stay responsive throughout.
 */
const APPLY_CHUNK = 40;
const EMPTY_SYNC_COLLECTIONS: ReadonlySet<SyncCollection> = new Set<SyncCollection>();
type FrozenReplayHead = number | "invalid";

type PullAccumulator = {
  appliedCount: number;
  pulledCollections: Set<SyncCollection>;
  pulledIds: Map<SyncCollection, string[]>;
};

const emptyPullAccumulator = (): PullAccumulator => ({
  appliedCount: 0,
  pulledCollections: new Set<SyncCollection>(),
  pulledIds: new Map<SyncCollection, string[]>(),
});

const isValidHead = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isValidServerSeq = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function recordPulled(
  accumulator: PullAccumulator,
  collection: SyncCollection,
  id: string,
): void {
  accumulator.appliedCount += 1;
  accumulator.pulledCollections.add(collection);
  const ids = accumulator.pulledIds.get(collection);
  if (ids) ids.push(id);
  else accumulator.pulledIds.set(collection, [id]);
}

type ApplyPulledResult = {
  appliedCount: number;
  cursor: number;
  reset: boolean;
  cancelled: boolean;
};

/**
 * Apply every row in the response through the existing cooperative chunks,
 * commit its cursor only after the whole page is durable, then publish source-
 * split events. During a replay, an absent/invalid sequence is conservatively
 * historical; normal pulls and push responses are always incremental.
 */
async function applyPulled(
  storeId: string,
  data: SyncPullResponse,
  epoch: SyncEpoch,
  notify = true,
  uploadedCollections: ReadonlySet<SyncCollection> = EMPTY_SYNC_COLLECTIONS,
  replayHead?: FrozenReplayHead,
): Promise<ApplyPulledResult> {
  const db = storeScope(storeId);
  const prior = Number(db.metaGet(cursorKey(storeId)) ?? "0") || 0;

  // Era guard: never re-store the stale response cursor after rewinding. The
  // caller will immediately request zero and re-apply the rebuilt oplog.
  if (isValidHead(data.head) && prior > data.head) {
    console.warn("[sync] store oplog rebuilt (head", data.head, "< cursor", prior, ") — pulling from zero");
    if (!epochIsCurrent(epoch)) {
      return { appliedCount: 0, cursor: prior, reset: false, cancelled: true };
    }
    db.metaSet(cursorKey(storeId), "0");
    if (notify && uploadedCollections.size > 0) {
      emitSynced({
        storeId,
        source: "incremental",
        appliedCount: 0,
        pulledCollections: EMPTY_SYNC_COLLECTIONS,
        uploadedCollections,
        pulledIds: new Map<SyncCollection, string[]>(),
      }, epoch);
    }
    return { appliedCount: 0, cursor: 0, reset: true, cancelled: false };
  }

  const backfill = emptyPullAccumulator();
  const incremental = emptyPullAccumulator();
  let applied = 0;

  for (let start = 0; start < data.changes.length; start += APPLY_CHUNK) {
    if (!epochIsCurrent(epoch)) {
      return { appliedCount: applied, cursor: prior, reset: false, cancelled: true };
    }

    const batch = data.changes.slice(start, start + APPLY_CHUNK);
    const remoteBatch: RemoteCollectionChange[] = [];
    for (const change of batch) {
      const collection = change.collection as SyncCollection;
      const row: ChangeRow<{ id: string }> = {
        id: change.id,
        data: change.data as { id: string },
        updatedAt: change.updatedAt,
        deleted: change.deleted,
      };
      remoteBatch.push({ collection, change: row });

      const isBackfill =
        replayHead !== undefined &&
        (replayHead === "invalid" ||
          !isValidServerSeq(change.serverSeq) ||
          change.serverSeq <= replayHead);
      recordPulled(isBackfill ? backfill : incremental, collection, change.id);
    }

    // One transaction per cooperative chunk: conflict checks still happen per
    // row, but old flash storage pays for one commit instead of forty.
    db.applyRemoteBatch(remoteBatch);
    applied += batch.length;
    if (start + APPLY_CHUNK < data.changes.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  // A cleaned-up role effect may finish a synchronous chunk, but it must not
  // advance the shared cursor or publish events for its retired replay.
  if (!epochIsCurrent(epoch)) {
    return { appliedCount: applied, cursor: prior, reset: false, cancelled: true };
  }

  // The cursor advances once every row is durable. If the app stops during a
  // chunk, the old cursor causes an idempotent refetch rather than a lost tail.
  let committedCursor = prior;
  if (data.cursor > prior) {
    db.metaSet(cursorKey(storeId), String(data.cursor));
    committedCursor = data.cursor;
  }

  if (notify && backfill.appliedCount > 0) {
    emitSynced({
      storeId,
      source: "backfill",
      appliedCount: backfill.appliedCount,
      pulledCollections: backfill.pulledCollections,
      uploadedCollections: EMPTY_SYNC_COLLECTIONS,
      pulledIds: backfill.pulledIds,
    }, epoch);
  }
  if (notify && (incremental.appliedCount > 0 || uploadedCollections.size > 0)) {
    emitSynced({
      storeId,
      source: "incremental",
      appliedCount: incremental.appliedCount,
      pulledCollections: incremental.pulledCollections,
      uploadedCollections,
      pulledIds: incremental.pulledIds,
    }, epoch);
  }

  return { appliedCount: applied, cursor: committedCursor, reset: false, cancelled: false };
}

/** Internal cancellation is distinct from a network deadline and never retries. */
class SyncCancelledError extends Error {
  override name = "SyncCancelledError";
}

class SyncTimeoutError extends Error {
  override name = "SyncTimeoutError";
}

/** Fetch with a hard deadline, composed with the originating role epoch. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  epoch: SyncEpoch,
): Promise<Response> {
  if (!epochIsCurrent(epoch)) throw new SyncCancelledError("Sync epoch retired");

  const controller = new AbortController();
  let timedOut = false;
  const abortForEpoch = () => controller.abort();
  epoch.controller.signal.addEventListener("abort", abortForEpoch, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SYNC_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!epochIsCurrent(epoch)) throw new SyncCancelledError("Sync epoch retired");
    return response;
  } catch (error) {
    if (!epochIsCurrent(epoch) || epoch.controller.signal.aborted) {
      throw new SyncCancelledError("Sync epoch retired");
    }
    if (timedOut) throw new SyncTimeoutError("Sync request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
    epoch.controller.signal.removeEventListener("abort", abortForEpoch);
  }
}

/**
 * Page budget for one pull request. The server pages its responses (rows and
 * bytes), so a full catch-up — including product photos — arrives across
 * several bounded requests instead of one multi-megabyte reply that always
 * overran the request timeout.
 */
const PULL_MAX_PAGES = 60;

type PullError = {
  kind: SyncErrorKind;
  message: string;
  status?: number;
  code?: string;
};

export type PullResult =
  | { status: "complete"; appliedCount: number }
  | { status: "page_cap"; appliedCount: number }
  | { status: "partial"; appliedCount: number; error: PullError }
  | { status: "failed"; appliedCount: number; error: PullError }
  | { status: "cancelled"; appliedCount: number };

type ReplayPullContext = {
  scope: string;
  epoch: SyncEpoch;
  frozenHead: FrozenReplayHead | null;
  /** Remains true until the first request succeeds, so every retry still asks zero. */
  startAtZero: boolean;
  persistHead: boolean;
};

const pullFailure = (
  successfulPages: number,
  appliedCount: number,
  error: PullError,
): PullResult => ({
  status: successfulPages > 0 ? "partial" : "failed",
  appliedCount,
  error,
});

const cancelledPull = (appliedCount = 0): PullResult => ({
  status: "cancelled",
  appliedCount,
});

/**
 * Fetch bounded server pages. Only a successful response with no cursor
 * progress is complete; an error after progress and the page cap are explicit
 * resumable outcomes so callers never mark a truncated replay as drained.
 */
async function performPull(
  storeId: string,
  notify: boolean,
  epoch: SyncEpoch,
  replay?: ReplayPullContext,
): Promise<PullResult> {
  if (!epochIsCurrent(epoch) || (replay && replay.epoch !== epoch)) {
    return cancelledPull();
  }

  const cookie = authCookie();
  if (!cookie) {
    return pullFailure(0, 0, {
      kind: "auth",
      message: "Your sign-in session is unavailable. Sign out and sign in again, then retry.",
    });
  }

  const db = storeScope(storeId);
  let appliedTotal = 0;
  let successfulPages = 0;

  try {
    const netState = await Network.getNetworkStateAsync();
    if (!epochIsCurrent(epoch)) return cancelledPull(appliedTotal);
    if (netState.isInternetReachable === false) {
      return pullFailure(0, 0, {
        kind: "offline",
        message: "This device is offline. Connect to the internet and retry.",
      });
    }

    for (let page = 0; page < PULL_MAX_PAGES; page += 1) {
      if (!epochIsCurrent(epoch)) return cancelledPull(appliedTotal);

      // A new scope keeps forcing zero until a request actually succeeds. Once
      // it does, all continuations use the page cursor persisted by applyPulled.
      const forceZero = replay?.startAtZero === true;
      const cursor = forceZero
        ? 0
        : Number(db.metaGet(cursorKey(storeId)) ?? "0") || 0;

      const res = await fetchWithTimeout(
        `${API_URL}/api/sync?cursor=${cursor}`,
        { headers: { Cookie: cookie, "x-store-id": storeId } },
        epoch,
      );

      let body:
        | { ok: true; data: SyncPullResponse }
        | { ok: false; error: { code?: string; message?: string } };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        if (!epochIsCurrent(epoch)) return cancelledPull(appliedTotal);
        return pullFailure(successfulPages, appliedTotal, {
          kind: "server",
          status: res.status,
          message: `The server returned an invalid response (${res.status}).`,
        });
      }
      if (!epochIsCurrent(epoch)) return cancelledPull(appliedTotal);

      if (!res.ok || !body.ok) {
        const code = body.ok ? undefined : body.error.code;
        const serverMessage = body.ok ? undefined : body.error.message;
        return pullFailure(successfulPages, appliedTotal, {
          kind: res.status === 401 ? "auth" : "server",
          status: res.status,
          code,
          message:
            res.status === 401
              ? "Your session has expired. Sign out and sign in again, then retry."
              : serverMessage ?? `The server rejected the pull (${res.status}).`,
        });
      }

      if (!isValidHead(body.data.cursor) || !isValidHead(body.data.head)) {
        return pullFailure(successfulPages, appliedTotal, {
          kind: "server",
          status: res.status,
          message: "The server returned invalid sync bounds.",
        });
      }

      // A rebuilt server oplog invalidates both the cursor and an older frozen
      // boundary. The DO intentionally echoes the ahead request cursor while
      // reporting its smaller head, so handle this before normal progression.
      if (cursor > body.data.head) {
        if (!epochIsCurrent(epoch)) return cancelledPull(appliedTotal);
        db.metaSet(cursorKey(storeId), "0");
        if (replay) {
          replay.frozenHead = body.data.head;
          if (replay.persistHead) {
            db.metaSet(replayHeadKey(storeId), String(body.data.head));
          }
        }
        successfulPages += 1;
        continue;
      }

      const orderedChanges = body.data.changes.every(
        (change, index, changes) =>
          isValidServerSeq(change.serverSeq) &&
          change.serverSeq > cursor &&
          change.serverSeq <= body.data.cursor &&
          (index === 0 || change.serverSeq > changes[index - 1]!.serverSeq),
      );
      if (
        body.data.cursor < cursor ||
        (body.data.cursor === cursor && body.data.changes.length > 0) ||
        !orderedChanges
      ) {
        return pullFailure(successfulPages, appliedTotal, {
          kind: "server",
          status: res.status,
          message: "The server returned a regressing or inconsistent sync cursor.",
        });
      }

      // Reassert zero after a stale pre-transition job has left the queue, then
      // retire the flag only now that this first request really succeeded.
      if (forceZero && replay) {
        if (!epochIsCurrent(epoch)) return cancelledPull(appliedTotal);
        db.metaSet(cursorKey(storeId), "0");
        replay.startAtZero = false;
      }

      // Freeze exactly the first successful replay response's top-level head.
      // Later response heads may include live orders and must never move it.
      if (replay && replay.frozenHead === null) {
        replay.frozenHead = body.data.head;
        if (replay.persistHead && epochIsCurrent(epoch)) {
          db.metaSet(replayHeadKey(storeId), String(replay.frozenHead));
        }
      }

      const applied = await applyPulled(
        storeId,
        body.data,
        epoch,
        notify,
        EMPTY_SYNC_COLLECTIONS,
        replay ? (replay.frozenHead ?? "invalid") : undefined,
      );
      if (applied.cancelled) return cancelledPull(appliedTotal + applied.appliedCount);
      if (applied.reset) {
        if (replay && epochIsCurrent(epoch)) {
          replay.frozenHead = body.data.head;
          if (replay.persistHead) {
            db.metaSet(replayHeadKey(storeId), String(replay.frozenHead));
          }
        }
        successfulPages += 1;
        continue;
      }

      appliedTotal += applied.appliedCount;
      successfulPages += 1;

      // Hidden rows may yield no documents while still advancing. Completion
      // requires exact equality; a smaller cursor is a protocol error above.
      if (body.data.cursor === cursor) {
        return { status: "complete", appliedCount: appliedTotal };
      }
    }

    return { status: "page_cap", appliedCount: appliedTotal };
  } catch (error) {
    if (error instanceof SyncCancelledError || !epochIsCurrent(epoch)) {
      return cancelledPull(appliedTotal);
    }
    const timedOut = error instanceof SyncTimeoutError;
    const message = timedOut
      ? "The server took too long to respond. Check your connection and retry."
      : `Could not reach the server: ${error instanceof Error ? error.message : String(error)}`;
    console.warn("[sync] pull failed:", message);
    return pullFailure(successfulPages, appliedTotal, {
      kind: timedOut ? "timeout" : "network",
      message,
    });
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
const jobQueue: {
  key: string;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}[] = [];
/** One promise per queued key; repeated triggers share it. */
const queuedJobs = new Map<string, Promise<unknown>>();
/** Running keys are separate so one fresh trailing job can survive per key. */
const runningJobKeys = new Set<string>();
let jobRunning = false;

function enqueueJob<T>(key: string, run: () => Promise<T>): Promise<T> {
  const queued = queuedJobs.get(key);
  if (queued) return queued as Promise<T>;

  // If this key is currently running, deliberately enqueue exactly one trailing
  // cycle. The active job may already have snapshotted dirty rows or the server
  // cursor; swallowing a later write/nudge into its old promise would leave that
  // change waiting for the next 20-second safety poll. `queuedJobs` coalesces all
  // further triggers into this one trailing cycle.
  const isTrailing = runningJobKeys.has(key);

  let resolve!: (value: unknown) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  queuedJobs.set(key, promise);
  jobQueue.push({ key, run: run as () => Promise<unknown>, resolve, reject });

  // A running key guarantees the serialized runner is already alive; the
  // newly queued trailing job will be picked up by its next loop iteration.
  if (isTrailing) return promise as Promise<T>;

  if (!jobRunning) {
    jobRunning = true;
    setActivity({ busy: true });
    void (async () => {
      for (;;) {
        const job = jobQueue.shift();
        if (!job) break;
        // It is no longer queued. A same-key trigger during `run` may now create
        // one trailing job, while additional triggers share that queued promise.
        queuedJobs.delete(job.key);
        runningJobKeys.add(job.key);
        try {
          job.resolve(await job.run());
        } catch (error) {
          job.reject(error);
        } finally {
          runningJobKeys.delete(job.key);
        }
      }
      jobRunning = false;
      setActivity({ busy: false });
    })();
  }
  return promise as Promise<T>;
}

type ReplayController = {
  scope: string;
  epoch: SyncEpoch;
  request: (manual?: boolean) => Promise<PullResult>;
};

const activeReplayControllers = new Map<string, ReplayController>();

export function pullNow(
  storeId: string,
  fromBeginning = false,
  notify = true,
  manual = false,
): Promise<PullResult> {
  if (!SYNC_ENABLED) {
    return Promise.resolve({
      status: "failed",
      appliedCount: 0,
      error: {
        kind: "disabled",
        message: "Server sync is disabled in this build.",
      },
    });
  }
  if (!storeId || storeId === "store_unknown" || storeId === "bootstrap") {
    return Promise.resolve({
      status: "failed",
      appliedCount: 0,
      error: { kind: "invalid_store", message: "No valid store is selected." },
    });
  }

  const epoch = currentSyncEpoch(storeId);
  if (!epoch) return Promise.resolve(cancelledPull());

  // Realtime, refresh, and safety-poll pulls must not leapfrog an unfinished
  // replay and mislabel its historical tail as incremental. They join the
  // current role epoch's replay instead.
  const activeReplay = activeReplayControllers.get(storeId);
  if (activeReplay?.epoch === epoch) return activeReplay.request(manual);
  if (activeReplay) activeReplayControllers.delete(storeId);

  if (fromBeginning) {
    const manualReplay: ReplayPullContext = {
      scope: `manual:${epoch.scope}`,
      epoch,
      frozenHead: null,
      startAtZero: true,
      persistHead: false,
    };
    const key = `${storeId}|${epoch.generation}|pull|replay|manual|${notify ? "notify" : "silent"}`;
    return enqueueJob(key, () => performPull(storeId, notify, epoch, manualReplay));
  }

  const key = `${storeId}|${epoch.generation}|pull|incremental|${notify ? "notify" : "silent"}`;
  return enqueueJob(key, () => performPull(storeId, notify, epoch));
}

const cancelledSync = (): SyncAttemptResult => ({
  ok: false,
  kind: "cancelled",
  message: "The store authorization scope changed.",
});

async function performSync(
  storeId: string,
  epoch: SyncEpoch,
  onlyCollections?: readonly SyncCollection[],
): Promise<SyncAttemptResult> {
  if (!SYNC_ENABLED) {
    return {
      ok: false,
      kind: "disabled",
      message: "Server sync is disabled in this build. Enable sync and restart the app before publishing.",
    };
  }

  if (!epochIsCurrent(epoch)) return cancelledSync();

  // Never upload (or use an empty push as a pull) ahead of the current role's
  // cursor-zero replay. The replay controller owns downloads until it drains.
  if (!isBooted(storeId)) {
    return { ok: true, appliedCount: 0 };
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
    if (!epochIsCurrent(epoch)) return cancelledSync();
    if (netState.isInternetReachable === false) {
      return { ok: false, kind: "offline", message: "This device is offline. Connect to the internet and retry." };
    }

    // Photos never upload; every other collection remains dirty until the
    // server acknowledges its exact revision.
    const scope = onlyCollections ?? UPLOADABLE_COLLECTIONS;
    const { changes } = collectDirty(storeScope(storeId), scope);
    const batches = batchChanges(changes);
    const queue: PushBatch[] = batches.length > 0
      ? batches
      : [{ changes: [], revisionsByCollection: {} }];

    let applied = 0;
    for (const batch of queue) {
      if (!epochIsCurrent(epoch)) return cancelledSync();
      const result = await pushBatch(storeId, cookie, batch, epoch);
      if (!result.ok) return result;
      applied += result.appliedCount;
    }
    return epochIsCurrent(epoch)
      ? { ok: true, appliedCount: applied }
      : cancelledSync();
  } catch (error) {
    if (error instanceof SyncCancelledError || !epochIsCurrent(epoch)) {
      return cancelledSync();
    }
    const timedOut = error instanceof SyncTimeoutError;
    const message = timedOut
      ? "The server took too long to respond. Check your connection and retry."
      : `Could not reach the server: ${error instanceof Error ? error.message : String(error)}`;
    console.warn("[sync] failed:", message);
    return { ok: false, kind: timedOut ? "timeout" : "network", message };
  }
}

/** Push one batch, acknowledge its exact revisions, and apply what came back. */
async function pushBatch(
  storeId: string,
  cookie: string,
  batch: PushBatch,
  epoch: SyncEpoch,
): Promise<SyncAttemptResult> {
  const { changes, revisionsByCollection } = batch;
  const db = storeScope(storeId);
  try {
    if (!epochIsCurrent(epoch)) return cancelledSync();

    // Re-read per batch: an earlier batch advances the cursor.
    const cursor = Number(db.metaGet(cursorKey(storeId)) ?? "0") || 0;
    const res = await fetchWithTimeout(
      `${API_URL}/api/sync`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          "x-store-id": storeId,
        },
        body: JSON.stringify({ cursor, changes }),
      },
      epoch,
    );

    let body:
      | { ok: true; data: SyncPullResponse }
      | { ok: false; error: { code?: string; message?: string } };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      if (!epochIsCurrent(epoch)) return cancelledSync();
      return {
        ok: false,
        kind: "server",
        status: res.status,
        message: `The server returned an invalid response (${res.status}).`,
      };
    }
    if (!epochIsCurrent(epoch)) return cancelledSync();

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

    const orderedChanges =
      Array.isArray(body.data.changes) &&
      body.data.changes.every(
        (change, index, responseChanges) =>
          isValidServerSeq(change.serverSeq) &&
          change.serverSeq > cursor &&
          change.serverSeq <= body.data.cursor &&
          (index === 0 || change.serverSeq > responseChanges[index - 1]!.serverSeq),
      );
    if (
      !isValidHead(body.data.cursor) ||
      !isValidHead(body.data.head) ||
      body.data.cursor < cursor ||
      (body.data.cursor === cursor && body.data.changes.length > 0) ||
      !orderedChanges
    ) {
      return {
        ok: false,
        kind: "server",
        status: res.status,
        message: "The server returned a regressing or inconsistent sync cursor.",
      };
    }

    // A stale/aborted POST may already have committed remotely. Do not clear
    // anything unless this exact role epoch still owns the response.
    if (!epochIsCurrent(epoch)) return cancelledSync();
    const acknowledged = Object.entries(revisionsByCollection).map(
      ([collection, revisions]) => ({
        collection: collection as SyncCollection,
        revisions,
      }),
    );
    db.clearDirtyBatch(acknowledged);

    const uploadedCollections = new Set<SyncCollection>(
      Object.keys(revisionsByCollection) as SyncCollection[],
    );
    const pulled = await applyPulled(
      storeId,
      body.data,
      epoch,
      true,
      uploadedCollections,
    );
    if (pulled.cancelled) return cancelledSync();
    return {
      ok: true,
      appliedCount: pulled.appliedCount,
    };
  } catch (error) {
    if (error instanceof SyncCancelledError || !epochIsCurrent(epoch)) {
      return cancelledSync();
    }
    const timedOut = error instanceof SyncTimeoutError;
    const message = timedOut
      ? "The server took too long to respond. Check your connection and retry."
      : `Could not reach the server: ${error instanceof Error ? error.message : String(error)}`;
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
  epoch: SyncEpoch,
  onlyCollections?: readonly SyncCollection[],
): string {
  const scope = onlyCollections
    ? [...new Set(onlyCollections)].sort().join(",")
    : "*";
  return `${storeId}|${epoch.generation}|sync|${scope}`;
}

// --- Failure retry ladder ---------------------------------------------------
//
// A failed push used to wait for the next poll (up to 20s) before retrying,
// which is why a sale could sit on one till for half a minute. Transient
// failures now re-arm themselves quickly, then stop (the poll, nudges, and
// connectivity-regain flush take over from there):
//  - network/timeout errors: 3s → 6s → 12s → 24s → 48s
//  - "offline" verdicts: fixed 5s re-checks ×3 — expo-network can report
//    offline spuriously right after bursts of activity, and silently skipping
//    the push on a lying check is exactly how the "tap to sync" banner was
//    born. A genuinely dead connection exhausts these quickly and falls back
//    to the regain-flush + poll.
const NETWORK_LADDER = [3_000, 6_000, 12_000, 24_000, 48_000];
const OFFLINE_LADDER = [5_000, 5_000, 5_000];
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryAttempts = new Map<string, number>();
type FailedSyncResult = Extract<SyncAttemptResult, { ok: false }>;
const automaticSyncBlocks = new Map<string, FailedSyncResult>();
const retryKey = (epoch: SyncEpoch) => `${epoch.storeId}|${epoch.generation}`;

function cancelRetry(epoch: SyncEpoch): void {
  const key = retryKey(epoch);
  const timer = retryTimers.get(key);
  if (timer) clearTimeout(timer);
  retryTimers.delete(key);
}

function clearRetryState(epoch: SyncEpoch): void {
  const key = retryKey(epoch);
  cancelRetry(epoch);
  retryAttempts.delete(key);
}

function clearAllRetryState(): void {
  for (const timer of retryTimers.values()) clearTimeout(timer);
  retryTimers.clear();
  retryAttempts.clear();
  for (const [key, result] of automaticSyncBlocks) {
    const transientServer =
      result.kind === "server" &&
      (result.status === 408 || result.status === 429 || (result.status ?? 0) >= 500);
    if (
      result.kind === "network" ||
      result.kind === "timeout" ||
      result.kind === "offline" ||
      transientServer
    ) {
      automaticSyncBlocks.delete(key);
    }
  }
}

function clearSyncErrorForEpoch(epoch: SyncEpoch): void {
  if (!epochIsCurrent(epoch) || activity.errorStoreId !== epoch.storeId) return;
  setActivity({ error: null, errorKind: null, errorStoreId: null });
}

/** Called after every full-sync attempt: success resets, transient failures
 *  schedule the next rung of the ladder, permanent ones stop auto-retrying.
 *  Also feeds the store-scoped recovery UI. */
function handleSyncOutcome(epoch: SyncEpoch, result: SyncAttemptResult): void {
  if (!SYNC_ENABLED || !epochIsCurrent(epoch)) return;
  if (!result.ok && result.kind === "cancelled") return;

  if (result.ok) {
    clearRetryState(epoch);
    automaticSyncBlocks.delete(retryKey(epoch));
    if (isBooted(epoch.storeId)) clearSyncErrorForEpoch(epoch);
    return;
  }
  setActivity({
    error: result.message,
    errorKind: result.kind,
    errorStoreId: epoch.storeId,
  });

  const ladder =
    result.kind === "network" || result.kind === "timeout"
      ? NETWORK_LADDER
      : result.kind === "offline"
        ? OFFLINE_LADDER
        : result.kind === "server" &&
            (result.status === 408 || result.status === 429 || (result.status ?? 0) >= 500)
          ? NETWORK_LADDER
          : undefined;

  if (!ladder) {
    clearRetryState(epoch);
    automaticSyncBlocks.set(retryKey(epoch), result);
    return;
  }

  const key = retryKey(epoch);
  const attempts = (retryAttempts.get(key) ?? 0) + 1;
  if (attempts > ladder.length) {
    automaticSyncBlocks.set(key, result);
    return;
  }
  if (retryTimers.has(key)) return;

  retryAttempts.set(key, attempts);
  const timer = setTimeout(() => {
    retryTimers.delete(key);
    if (epochIsCurrent(epoch)) void syncNow(epoch.storeId);
  }, ladder[attempts - 1]!);
  retryTimers.set(key, timer);
}

/** Immediate flush when the network comes back — no waiting for the ladder. */
let networkListenerBound = false;

function requestSyncDetailed(
  storeId: string,
  onlyCollections: readonly SyncCollection[] | undefined,
  manual: boolean,
): Promise<SyncAttemptResult> {
  if (!SYNC_ENABLED) {
    return Promise.resolve({
      ok: false,
      kind: "disabled",
      message: "Server sync is disabled in this build.",
    });
  }
  if (!storeId || storeId === "store_unknown" || storeId === "bootstrap") {
    return Promise.resolve({
      ok: false,
      kind: "invalid_store",
      message: "No valid store is selected.",
    });
  }

  const epoch = currentSyncEpoch(storeId);
  if (!epoch) return Promise.resolve(cancelledSync());
  const key = syncRequestKey(storeId, epoch, onlyCollections);
  const epochKey = retryKey(epoch);
  const blocked = automaticSyncBlocks.get(epochKey);
  if (blocked && !manual) return Promise.resolve(blocked);
  if (manual) {
    clearRetryState(epoch);
    automaticSyncBlocks.delete(epochKey);
  }

  // Bind once per app session: regaining internet retries the current role
  // epoch immediately without retaining a previous store in the closure.
  if (!networkListenerBound) {
    networkListenerBound = true;
    try {
      const networkModule = Network as unknown as {
        addNetworkStateListener?: (
          listener: (event: { networkState?: { isInternetReachable?: boolean | null } }) => void,
        ) => { remove(): void };
      };
      networkModule.addNetworkStateListener?.((event) => {
        if (event.networkState?.isInternetReachable === true) {
          clearAllRetryState();
          const active = getActiveStore();
          const activeEpoch = currentSyncEpoch(active);
          if (activeEpoch) void syncNow(active);
        }
      });
    } catch {
      /* listener unsupported — ladder + polling still cover it */
    }
  }

  return enqueueJob(key, async () => {
    if (!epochIsCurrent(epoch)) return cancelledSync();
    const result = await performSync(storeId, epoch, onlyCollections);
    handleSyncOutcome(epoch, result);
    return result;
  });
}

/** Explicit UI publication/retry bypasses an automatic terminal latch once. */
export function syncNowDetailed(
  storeId: string,
  onlyCollections?: readonly SyncCollection[],
): Promise<SyncAttemptResult> {
  return requestSyncDetailed(storeId, onlyCollections, true);
}

/** Backward-compatible count result used by automatic background callers. */
export async function syncNow(storeId: string): Promise<number> {
  const result = await requestSyncDetailed(storeId, undefined, false);
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
const REPLAY_CONTINUE_DELAY_MS = 250;

function readFrozenReplayHead(db: StoreScope, storeId: string): FrozenReplayHead | null {
  const raw = db.metaGet(replayHeadKey(storeId));
  if (raw === null || raw === "") return null;
  if (raw === "invalid") return "invalid";
  const head = Number(raw);
  return isValidHead(head) ? head : null;
}

export function startAutoSync(
  storeId: string,
  role: StoreRole,
  intervalMs = 20_000,
): () => void {
  if (
    !SYNC_ENABLED ||
    !storeId ||
    storeId === "bootstrap" ||
    storeId === "store_unknown"
  ) {
    return () => {};
  }

  const db = storeScope(storeId);
  const scope = readScopeForRole(role);
  const transitioned =
    db.metaGet(activeReadScopeKey(storeId)) !== scope ||
    db.metaGet(readProjectionPolicyKey(storeId)) !== String(SYNC_READ_POLICY_VERSION);
  prepareStoreSyncScope(storeId, role);
  const epoch = currentSyncEpoch(storeId);
  if (!epoch || epoch.scope !== scope) return () => {};
  clearRetryState(epoch);

  let stopped = false;
  const isCurrent = () => !stopped && epochIsCurrent(epoch);

  const pendingScope = db.metaGet(pendingReadScopeKey(storeId));
  const needsReplay =
    transitioned ||
    (pendingScope !== null && pendingScope !== "") ||
    db.metaGet(completedReadScopeKey(storeId)) !== scope ||
    db.metaGet(initialPullKey(storeId)) !== "1" ||
    db.metaGet(webOrdersBackfillKey(storeId)) !== "1";
  if (needsReplay && pendingScope !== scope) {
    db.metaSet(pendingReadScopeKey(storeId), scope);
  }

  let replayRetry: ReturnType<typeof setTimeout> | null = null;
  let replayCompleted = false;
  let replayController: ReplayController | null = null;
  let replayContext: ReplayPullContext | null = null;
  let replayTransientAttempt = 0;
  let terminalReplayResult: PullResult | null = null;

  const cancelReplayRetry = () => {
    if (replayRetry) clearTimeout(replayRetry);
    replayRetry = null;
  };

  const finishReplay = () => {
    if (replayCompleted || !isCurrent()) return;
    replayCompleted = true;
    cancelReplayRetry();

    // These synchronous writes cannot interleave with a role transition. The
    // pending marker opens last, only after a no-progress page has completed.
    db.metaSet(initialPullKey(storeId), "1");
    db.metaSet(webOrdersBackfillKey(storeId), "1");
    db.metaSet(completedReadScopeKey(storeId), scope);
    db.metaSet(pendingReadScopeKey(storeId), "");

    if (replayController && activeReplayControllers.get(storeId) === replayController) {
      activeReplayControllers.delete(storeId);
    }
    clearSyncErrorForEpoch(epoch);
    void syncNow(storeId);
  };

  const scheduleReplay = (delayMs: number) => {
    if (replayCompleted || replayRetry || !isCurrent()) return;
    replayRetry = setTimeout(() => {
      replayRetry = null;
      if (isCurrent()) void requestReplay(false);
    }, delayMs);
  };

  const transientReplayLadder = (error: PullError): readonly number[] | null => {
    if (error.kind === "network" || error.kind === "timeout") return NETWORK_LADDER;
    if (error.kind === "offline") return OFFLINE_LADDER;
    if (
      error.kind === "server" &&
      (error.status === 408 || error.status === 429 || (error.status ?? 0) >= 500)
    ) {
      return NETWORK_LADDER;
    }
    return null;
  };

  const handleReplayResult = (result: PullResult) => {
    if (!isCurrent() || result.status === "cancelled") return;
    if (result.status === "complete") {
      terminalReplayResult = null;
      finishReplay();
      return;
    }
    if (result.status === "page_cap") {
      terminalReplayResult = null;
      replayTransientAttempt = 0;
      clearSyncErrorForEpoch(epoch);
      scheduleReplay(REPLAY_CONTINUE_DELAY_MS);
      return;
    }

    setActivity({
      error: result.error.message,
      errorKind: result.error.kind,
      errorStoreId: storeId,
    });
    const ladder = transientReplayLadder(result.error);
    if (!ladder) {
      terminalReplayResult = result;
      replayTransientAttempt = 0;
      cancelReplayRetry();
      return;
    }

    if (result.status === "partial") replayTransientAttempt = 0;
    const delay = ladder[replayTransientAttempt];
    if (delay === undefined) return;
    replayTransientAttempt += 1;
    scheduleReplay(delay);
  };

  const requestReplay = (manual = false): Promise<PullResult> => {
    if (!replayContext || !isCurrent()) return Promise.resolve(cancelledPull());
    if (terminalReplayResult && !manual) return Promise.resolve(terminalReplayResult);
    if (manual) {
      terminalReplayResult = null;
      replayTransientAttempt = 0;
    }
    cancelReplayRetry();
    const key = `${storeId}|${epoch.generation}|pull|replay|${scope}|notify`;
    const promise = enqueueJob(key, () => performPull(storeId, true, epoch, replayContext!));
    void promise.then(handleReplayResult);
    return promise;
  };

  if (needsReplay) {
    const restartFromZero = transitioned || pendingScope !== scope;
    const persistedHead = restartFromZero ? null : readFrozenReplayHead(db, storeId);
    replayContext = {
      scope,
      epoch,
      frozenHead: persistedHead,
      // A missing head proves no replay response was durably accepted yet.
      startAtZero: restartFromZero || persistedHead === null,
      persistHead: true,
    };
    replayController = { scope, epoch, request: requestReplay };
    activeReplayControllers.set(storeId, replayController);
    void requestReplay(false);
  } else {
    void syncNow(storeId);
  }

  const handle = setInterval(() => {
    if (!isCurrent() || AppState.currentState !== "active") return;
    if (!isBooted(storeId)) return;
    void syncNow(storeId);
  }, intervalMs);

  let debounce: ReturnType<typeof setTimeout> | null = null;
  onLocalWrite(() => {
    if (!isCurrent()) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (isCurrent() && isBooted(storeId)) void syncNow(storeId);
    }, 1200);
  });

  return () => {
    stopped = true;
    cancelReplayRetry();
    if (replayController && activeReplayControllers.get(storeId) === replayController) {
      activeReplayControllers.delete(storeId);
    }
    clearInterval(handle);
    if (debounce) clearTimeout(debounce);
    onLocalWrite(null);
    clearRetryState(epoch);
    if (activeSyncEpochs.get(storeId) === epoch) retireSyncEpoch(epoch);
  };
}

// --- Convenience APIs for screens -------------------------------------------

/** Per store: one shared throttle let a pull for one shop starve another. */
const lastQuietPullAt = new Map<string, number>();

/** Fire-and-forget background delta check, throttled to one per few seconds.
 *  Used on tab switches / screen opens: local data keeps rendering; fresh
 *  deltas from other devices arrive quietly via onSynced. */
export function quietPull(storeId: string): void {
  if (!SYNC_ENABLED) return;
  const now = Date.now();
  if (now - (lastQuietPullAt.get(storeId) ?? 0) < 3_000) return;
  lastQuietPullAt.set(storeId, now);
  void pullNow(storeId);
}

/** Pull-to-refresh for screens: pull server deltas, then run a full sync. */
export function useServerRefresh(
  storeId: string,
): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    if (!SYNC_ENABLED) return;
    setRefreshing(true);
    try {
      await pullNow(storeId, false, true, true);
      await syncNowDetailed(storeId);
    } finally {
      setRefreshing(false);
    }
  }, [storeId]);
  return { refreshing, onRefresh };
}
