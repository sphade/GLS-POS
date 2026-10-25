import { useEffect, useState } from "react";
import {
  api,
  type CentralAllocation,
  type CentralAllocationStatus,
  type CentralItem,
} from "./api";
import {
  localDocCount,
  localDocDelete,
  localDocGet,
  localDocLoadAll,
  localDocPut,
  localDocReplaceAll,
  localDocWriteBatch,
} from "./db";
import { uid } from "./ids";
import { OFFLINE_MODE } from "./offline";

/**
 * Offline-first central stock.
 *
 * The control-plane API owns central items and transfer records, but the till
 * must not stop when the network does. This module keeps a local copy in the
 * store's SQLite file and writes every mutation to a durable outbox first.
 * Screens read local state synchronously; a background bridge drains the
 * outbox and refreshes the cache when the server is reachable.
 *
 * Central items live in the central store's local database. A branch's incoming
 * deliveries and its confirm/cancel outbox live in that branch's database, so
 * switching shops cannot mix queues.
 */

const ITEMS = "central_items";
const ALLOCATIONS = "central_allocations";
const OUTBOX = "central_outbox";

export type CentralActor = {
  id: string;
  name: string;
  email?: string;
  role?: string;
};

export type CentralMembership = { id: string };

type OpBase = {
  id: string;
  scopeId: string;
  actorId: string;
  actorName: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
};

type ItemPatch = {
  name: string;
  unit: string;
  totalStock: number;
  minStock: number;
  description?: string;
};

type NewCentralOp =
  | { kind: "item.create"; item: CentralItem }
  | { kind: "item.update"; itemId: string; patch: ItemPatch }
  | { kind: "item.delete"; itemId: string }
  | { kind: "allocation.create"; allocation: CentralAllocation }
  | {
      kind: "allocation.fulfill" | "allocation.cancel";
      allocationId: string;
      fromStoreId: string;
      toStoreId: string;
    };

export type CentralOp = OpBase & NewCentralOp;

const changeListeners = new Set<() => void>();
const writeListeners = new Set<() => void>();

/** Subscribe to every local central change, including background refreshes. */
export function subscribeCentralChanges(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** Subscribe only to locally-authored changes, for the sync bridge. */
export function subscribeCentralWrites(listener: () => void): () => void {
  writeListeners.add(listener);
  return () => {
    writeListeners.delete(listener);
  };
}

function emitCentralChange(write = false): void {
  if (write) {
    for (const listener of writeListeners) {
      try {
        listener();
      } catch {
        // A listener must never break the write that triggered it.
      }
    }
  }
  for (const listener of changeListeners) {
    try {
      listener();
    } catch {
      // A listener must never break the write that triggered it.
    }
  }
}

export function centralItems(scopeId: string): CentralItem[] {
  return localDocLoadAll<CentralItem>(scopeId, ITEMS).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function centralItem(scopeId: string, id: string): CentralItem | null {
  return localDocGet<CentralItem>(scopeId, ITEMS, id);
}

export function centralAllocations(scopeId: string): CentralAllocation[] {
  return localDocLoadAll<CentralAllocation>(scopeId, ALLOCATIONS).sort(
    (a, b) => new Date(b.allocatedAt).getTime() - new Date(a.allocatedAt).getTime(),
  );
}

export function centralAllocation(
  scopeId: string,
  id: string,
): CentralAllocation | null {
  return localDocGet<CentralAllocation>(scopeId, ALLOCATIONS, id);
}

export function centralPendingCount(scopeId: string): number {
  return localDocCount(scopeId, OUTBOX);
}

/** Most recent sync failure in this scope, if any. */
export function centralLastError(scopeId: string): string | null {
  const failures = localDocLoadAll<CentralOp>(scopeId, OUTBOX)
    .filter((op) => !!op.lastError)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (failures[0]?.lastError) return failures[0].lastError;
  const allocationFailure = centralAllocations(scopeId).find((a) => !!a.syncError);
  return allocationFailure?.syncError ?? null;
}

function saveOp(scopeId: string, op: CentralOp, now = Date.now()): void {
  localDocPut(scopeId, OUTBOX, op);
}

function newOp(
  scopeId: string,
  actor: CentralActor,
  body: NewCentralOp,
): CentralOp {
  return {
    ...body,
    id: uid("cops"),
    scopeId,
    actorId: actor.id,
    actorName: actor.name,
    createdAt: Date.now(),
    attempts: 0,
  } as CentralOp;
}

export type SaveCentralItemInput = {
  id?: string;
  name: string;
  unit: string;
  totalStock: number;
  minStock: number;
  description?: string;
};

/** Create or update a central item locally, then queue the server write. */
export function saveCentralItemLocal(
  scopeId: string,
  input: SaveCentralItemInput,
  actor: CentralActor,
): CentralItem | null {
  const now = new Date();
  const existing = input.id ? centralItem(scopeId, input.id) : null;

  if (input.id && !existing) return null;

  const item: CentralItem = existing
    ? {
        ...existing,
        name: input.name,
        unit: input.unit,
        totalStock: input.totalStock,
        minStock: input.minStock,
        description: input.description ?? null,
        updatedAt: now.toISOString(),
      }
    : {
        id: uid("inv"),
        ownerId: null,
        storeId: scopeId,
        name: input.name,
        unit: input.unit,
        totalStock: input.totalStock,
        minStock: input.minStock,
        description: input.description ?? null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

  const patch: ItemPatch = {
    name: item.name,
    unit: item.unit,
    totalStock: item.totalStock,
    minStock: item.minStock,
    description: item.description ?? "",
  };

  const op = existing
    ? newOp(scopeId, actor, { kind: "item.update", itemId: item.id, patch })
    : newOp(scopeId, actor, { kind: "item.create", item });

  localDocWriteBatch(scopeId, [
    { collection: ITEMS, item },
    { collection: OUTBOX, item: op },
  ]);
  emitCentralChange(true);
  return item;
}

export function deleteCentralItemLocal(
  scopeId: string,
  itemId: string,
  actor: CentralActor,
): void {
  const op = newOp(scopeId, actor, { kind: "item.delete", itemId });
  saveOp(scopeId, op);
  localDocDelete(scopeId, ITEMS, itemId);
  emitCentralChange(true);
}

export type CreateCentralTransferInput = {
  globalItemId: string;
  toStoreId: string;
  toStoreName: string;
  productId?: string;
  quantity: number;
  notes?: string;
};

export type CreateCentralTransferResult =
  | { ok: true; allocation: CentralAllocation }
  | { ok: false; error: string };

/** Deduct central stock and create a pending transfer locally. */
export function createCentralTransferLocal(
  scopeId: string,
  centralName: string,
  input: CreateCentralTransferInput,
  actor: CentralActor,
): CreateCentralTransferResult {
  const item = centralItem(scopeId, input.globalItemId);
  if (!item) return { ok: false, error: "This central item no longer exists." };

  const quantity = Math.round(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { ok: false, error: "Enter a whole number of at least 1." };
  }
  if (quantity > item.totalStock) {
    return {
      ok: false,
      error: `Only ${item.totalStock} ${item.unit} of "${item.name}" in central stock.`,
    };
  }

  const now = new Date();
  const allocation: CentralAllocation = {
    id: uid("alloc"),
    globalItemId: item.id,
    fromStoreId: scopeId,
    toStoreId: input.toStoreId,
    productId: input.productId ?? null,
    quantity,
    status: "pending",
    allocatedAt: now.toISOString(),
    stockDeductedAt: now.toISOString(),
    notes: input.notes?.trim().slice(0, 240) || null,
    allocatedByUserId: actor.id,
    allocatedByName: actor.name,
    itemName: item.name,
    itemUnit: item.unit,
    fromStoreName: centralName,
    toStoreName: input.toStoreName,
  };

  const updatedItem: CentralItem = {
    ...item,
    totalStock: item.totalStock - quantity,
    updatedAt: now.toISOString(),
  };
  const op = newOp(scopeId, actor, { kind: "allocation.create", allocation });

  localDocWriteBatch(scopeId, [
    { collection: ITEMS, item: updatedItem },
    { collection: ALLOCATIONS, item: allocation },
    { collection: OUTBOX, item: op },
  ]);
  emitCentralChange(true);
  return { ok: true, allocation };
}

/** Mark a delivery received in the branch cache and queue the server confirm. */
export function fulfillCentralAllocationLocal(
  scopeId: string,
  allocation: CentralAllocation,
  actor: CentralActor,
): CentralAllocation {
  const current = centralAllocation(scopeId, allocation.id) ?? allocation;
  if (current.status !== "pending") return current;

  const now = new Date();
  const updated: CentralAllocation = {
    ...current,
    status: "fulfilled",
    fulfilledAt: now.toISOString(),
    fulfilledByUserId: actor.id,
    fulfilledByName: actor.name,
    syncError: undefined,
  };
  const op = newOp(scopeId, actor, {
    kind: "allocation.fulfill",
    allocationId: updated.id,
    fromStoreId: updated.fromStoreId,
    toStoreId: updated.toStoreId,
  });

  localDocWriteBatch(scopeId, [
    { collection: ALLOCATIONS, item: updated },
    { collection: OUTBOX, item: op },
  ]);
  emitCentralChange(true);
  return updated;
}

/** Cancel a delivery locally and return its stock to the central cache. */
export function cancelCentralAllocationLocal(
  scopeId: string,
  allocation: CentralAllocation,
  actor: CentralActor,
): CentralAllocation {
  const current = centralAllocation(scopeId, allocation.id) ?? allocation;
  if (current.status !== "pending") return current;

  const now = new Date();
  const updated: CentralAllocation = {
    ...current,
    status: "cancelled",
    syncError: undefined,
  };
  const op = newOp(scopeId, actor, {
    kind: "allocation.cancel",
    allocationId: updated.id,
    fromStoreId: updated.fromStoreId,
    toStoreId: updated.toStoreId,
  });

  localDocWriteBatch(scopeId, [
    { collection: ALLOCATIONS, item: updated },
    { collection: OUTBOX, item: op },
  ]);

  if (current.stockDeductedAt != null) {
    const central = localDocGet<CentralItem>(
      current.fromStoreId,
      ITEMS,
      current.globalItemId,
    );
    if (central) {
      localDocPut(current.fromStoreId, ITEMS, {
        ...central,
        totalStock: central.totalStock + current.quantity,
        updatedAt: now.toISOString(),
      });
    }
  }

  emitCentralChange(true);
  return updated;
}

type OpResult =
  | { ok: true; item?: CentralItem }
  | { ok: false; error: string; permanent: boolean; rollback?: boolean };

const TRANSIENT_CODES = new Set([
  "network_error",
  "timeout",
  "offline_build",
  "unauthorized",
  "central_store_required",
  "internal_error",
  "server_error",
]);

const ROLLBACK_CODES = new Set([
  "insufficient_stock",
  "item_not_found",
  "to_store_not_found",
  "invalid_destination",
  "not_in_tree",
  "invalid_quantity",
  "duplicate_id",
  "not_a_member",
  "sender_role_required",
  "owner_only",
]);

function failure(error: { code: string; message: string }): OpResult {
  return {
    ok: false,
    error: error.message,
    permanent: !TRANSIENT_CODES.has(error.code),
  };
}

async function applyCentralOp(op: CentralOp): Promise<OpResult> {
  switch (op.kind) {
    case "item.create": {
      const res = await api.createCentralItem({
        id: op.item.id,
        name: op.item.name,
        unit: op.item.unit,
        totalStock: op.item.totalStock,
        minStock: op.item.minStock,
        description: op.item.description ?? undefined,
      });
      return res.ok ? { ok: true, item: res.data } : failure(res.error);
    }
    case "item.update": {
      const res = await api.updateCentralItem(op.itemId, op.patch);
      return res.ok
        ? { ok: true, item: res.data[0] ?? undefined }
        : res.error.code === "item_not_found"
          ? { ok: true }
          : failure(res.error);
    }
    case "item.delete": {
      const res = await api.deleteCentralItem(op.itemId);
      return res.ok || res.error.code === "item_not_found"
        ? { ok: true }
        : failure(res.error);
    }
    case "allocation.create": {
      const res = await api.createAllocation({
        id: op.allocation.id,
        globalItemId: op.allocation.globalItemId,
        toStoreId: op.allocation.toStoreId,
        productId: op.allocation.productId ?? undefined,
        quantity: op.allocation.quantity,
        notes: op.allocation.notes ?? undefined,
      });
      if (res.ok) return { ok: true };
      return {
        ok: false,
        error: res.error.message,
        permanent: !TRANSIENT_CODES.has(res.error.code),
        rollback: ROLLBACK_CODES.has(res.error.code),
      };
    }
    case "allocation.fulfill": {
      const res = await api.fulfillAllocation(op.allocationId);
      return res.ok ? { ok: true } : failure(res.error);
    }
    case "allocation.cancel": {
      const res = await api.cancelAllocation(op.allocationId);
      return res.ok ? { ok: true } : failure(res.error);
    }
  }
}

function rollbackAllocationCreate(
  scopeId: string,
  op: Extract<CentralOp, { kind: "allocation.create" }>,
  error: string,
): void {
  const stored = centralAllocation(scopeId, op.allocation.id) ?? op.allocation;
  if (stored.status !== "pending") return;

  const item = centralItem(scopeId, stored.globalItemId);
  const writes: { collection: string; item: CentralAllocation | CentralItem }[] = [
    {
      collection: ALLOCATIONS,
      item: {
        ...stored,
        status: "cancelled" as CentralAllocationStatus,
        syncError: error,
      },
    },
  ];
  if (item) {
    writes.push({
      collection: ITEMS,
      item: {
        ...item,
        totalStock: item.totalStock + stored.quantity,
        updatedAt: new Date().toISOString(),
      },
    });
  }
  localDocWriteBatch(scopeId, writes);
  emitCentralChange();
}

function opAllowed(op: CentralOp, memberships: readonly CentralMembership[]): boolean {
  const member = (id: string) => memberships.some((m) => m.id === id);
  switch (op.kind) {
    case "item.create":
    case "item.update":
    case "item.delete":
    case "allocation.create":
      return member(op.scopeId);
    case "allocation.fulfill":
    case "allocation.cancel":
      return member(op.fromStoreId) || member(op.toStoreId);
  }
}

export type FlushCentralResult = {
  ok: boolean;
  pending: number;
  error?: string;
  offline?: boolean;
};

/**
 * Drain queued central operations in FIFO order.
 *
 * Transient failures stay queued. A refused transfer is rolled back locally so
 * the central balance does not stay deducted for a send the server rejected.
 */
export async function flushCentralOutbox(
  scopeId: string,
  actor: CentralActor,
  memberships: readonly CentralMembership[],
): Promise<FlushCentralResult> {
  if (OFFLINE_MODE) {
    return { ok: false, pending: centralPendingCount(scopeId), offline: true };
  }

  const ops = localDocLoadAll<CentralOp>(scopeId, OUTBOX).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  if (ops.length === 0) return { ok: true, pending: 0 };

  for (const op of ops) {
    if (!opAllowed(op, memberships)) continue;

    const result = await applyCentralOp(op);
    if (result.ok) {
      localDocDelete(scopeId, OUTBOX, op.id);
      if (result.item) localDocPut(scopeId, ITEMS, result.item);
      if (op.kind === "allocation.fulfill" || op.kind === "allocation.cancel") {
        const local = centralAllocation(scopeId, op.allocationId);
        if (local?.syncError) {
          localDocPut(scopeId, ALLOCATIONS, { ...local, syncError: undefined });
        }
      }
      continue;
    }

    if (result.rollback && op.kind === "allocation.create") {
      rollbackAllocationCreate(scopeId, op, result.error);
      localDocDelete(scopeId, OUTBOX, op.id);
      continue;
    }

    const next: CentralOp = {
      ...op,
      attempts: op.attempts + 1,
      lastError: result.error,
    };
    saveOp(scopeId, next);
    emitCentralChange();
    return {
      ok: false,
      error: result.error,
      pending: centralPendingCount(scopeId),
    };
  }

  emitCentralChange();
  return { ok: true, pending: centralPendingCount(scopeId) };
}

/** Replace the local central item cache when there are no local writes waiting. */
export async function refreshCentralItems(scopeId: string): Promise<boolean> {
  if (OFFLINE_MODE || localDocCount(scopeId, OUTBOX) > 0) return false;
  const res = await api.listCentralItems();
  if (!res.ok) return false;
  localDocReplaceAll(scopeId, ITEMS, res.data);
  emitCentralChange();
  return true;
}

/** Replace the local transfer cache for one scope. */
export async function refreshCentralAllocations(
  scopeId: string,
  query?: { toStoreId?: string; fromStoreId?: string },
): Promise<boolean> {
  if (OFFLINE_MODE || localDocCount(scopeId, OUTBOX) > 0) return false;
  const res = await api.listAllocations(query);
  if (!res.ok) return false;
  localDocReplaceAll(scopeId, ALLOCATIONS, res.data);
  emitCentralChange();
  return true;
}

/** Re-render a screen whenever local central data or its outbox changes. */
export function useCentralRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      subscribeCentralChanges(() => {
        setRevision((current) => current + 1);
      }),
    [],
  );
  return revision;
}
