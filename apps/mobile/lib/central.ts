import { useEffect, useState } from "react";
import {
  api,
  type CentralAllocation,
  type CentralAllocationStatus,
  type CentralConversion,
  type CentralConversionRate,
  type CentralItem,
  type CentralStockMovement,
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
const CONVERSIONS = "central_conversions";
const RATES = "central_conversion_rates";
const MOVEMENTS = "central_stock_movements";
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
  | {
      kind: "item.adjust";
      itemId: string;
      movement: CentralStockMovement;
    }
  | { kind: "allocation.create"; allocation: CentralAllocation }
  | {
      kind: "allocation.fulfill" | "allocation.cancel";
      allocationId: string;
      fromStoreId: string;
      toStoreId: string;
    }
  | {
      kind: "conversion.create";
      conversion: CentralConversion;
      /** Saved with the conversion so the next batch needs no rate input. */
      portionSize?: number;
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

/** Add/remove history for one central item, newest first. */
export function centralStockMovements(
  scopeId: string,
  itemId: string,
): CentralStockMovement[] {
  return localDocLoadAll<CentralStockMovement>(scopeId, MOVEMENTS)
    .filter((movement) => movement.itemId === itemId && !movement.failed)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
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

export function centralConversions(scopeId: string): CentralConversion[] {
  return localDocLoadAll<CentralConversion>(scopeId, CONVERSIONS).sort(
    (a, b) => new Date(b.convertedAt).getTime() - new Date(a.convertedAt).getTime(),
  );
}

export function centralConversionRates(scopeId: string): CentralConversionRate[] {
  return localDocLoadAll<CentralConversionRate>(scopeId, RATES);
}

/**
 * How much of one item the shop still holds in its Stock Room.
 *
 * Deliveries received minus everything already turned into menu stock. Only
 * fulfilled deliveries count: a cancelled send never arrived.
 */
export function centralReceivedBalance(
  scopeId: string,
  globalItemId: string,
): number {
  const received = centralAllocations(scopeId)
    .filter((a) => a.toStoreId === scopeId && a.status === "fulfilled")
    .filter((a) => a.globalItemId === globalItemId)
    .reduce((sum, a) => sum + a.quantity, 0);
  const used = centralConversions(scopeId)
    .filter((c) => c.globalItemId === globalItemId && !c.failed)
    .reduce((sum, c) => sum + c.bulkQuantityUsed, 0);
  return received - used;
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
  const conversionFailure = centralConversions(scopeId).find((c) => !!c.syncError);
  if (conversionFailure?.syncError) return conversionFailure.syncError;
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

export type AdjustCentralStockInput = {
  itemId: string;
  /** Positive to add, negative to remove. */
  delta: number;
  note?: string;
};

/**
 * Add or remove central stock offline, exactly like a menu item adjustment.
 *
 * The balance moves by the delta (not to an absolute value), so two people
 * adding stock do not overwrite each other. The ledger row is written locally
 * first and the server replays it with the same id when the queue drains.
 */
export function adjustCentralStockLocal(
  scopeId: string,
  input: AdjustCentralStockInput,
  actor: CentralActor,
): { ok: true; item: CentralItem; movement: CentralStockMovement } | { ok: false; error: string } {
  const delta = Math.trunc(input.delta);
  if (!Number.isFinite(delta) || delta === 0) {
    return { ok: false, error: "Enter an amount to add or remove." };
  }

  const item = centralItem(scopeId, input.itemId);
  if (!item) {
    return { ok: false, error: "This item is no longer on this device." };
  }

  const base = item.totalStock;
  const resulting = base + delta;
  if (resulting < 0) {
    return {
      ok: false,
      error: `Only ${base} ${item.unit} of "${item.name}" in stock.`,
    };
  }

  const now = new Date();
  const movement: CentralStockMovement = {
    id: uid("mov"),
    itemId: item.id,
    storeId: scopeId,
    delta,
    baseStock: base,
    resulting,
    note: input.note?.trim().slice(0, 240) || null,
    actorId: actor.id,
    actorName: actor.name,
    at: now.toISOString(),
  };

  const updated: CentralItem = {
    ...item,
    totalStock: resulting,
    updatedAt: now.toISOString(),
  };

  const op = newOp(scopeId, actor, {
    kind: "item.adjust",
    itemId: item.id,
    movement,
  });

  localDocWriteBatch(scopeId, [
    { collection: ITEMS, item: updated },
    { collection: MOVEMENTS, item: movement },
    { collection: OUTBOX, item: op },
  ]);
  emitCentralChange(true);
  return { ok: true, item: updated, movement };
}

export type CreateCentralTransferInput = {
  globalItemId: string;
  toStoreId: string;
  toStoreName: string;
  /** Units leaving the centre. The shop receives exactly this, same unit. */
  quantity: number;
  notes?: string;
};

export type CreateCentralTransferResult =
  | { ok: true; allocation: CentralAllocation }
  | { ok: false; error: string };

/**
 * Deduct central stock and record the transfer locally.
 *
 * A transfer is received the moment it is sent, so it is written as fulfilled
 * straight away: nobody has to confirm a delivery that already left the
 * building. If the server refuses it (for example the central item ran out)
 * the outbox rolls this back and the stock returns.
 */
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

  const receiveQuantity = quantity;

  const now = new Date();
  const allocation: CentralAllocation = {
    id: uid("alloc"),
    globalItemId: item.id,
    fromStoreId: scopeId,
    toStoreId: input.toStoreId,
    productId: null,
    quantity,
    receiveQuantity,
    receiveUnit: item.unit,
    status: "fulfilled",
    allocatedAt: now.toISOString(),
    stockDeductedAt: now.toISOString(),
    fulfilledAt: now.toISOString(),
    notes: input.notes?.trim().slice(0, 240) || null,
    allocatedByUserId: actor.id,
    allocatedByName: actor.name,
    fulfilledByUserId: actor.id,
    fulfilledByName: actor.name,
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

export type CreateCentralConversionInput = {
  globalItemId: string;
  itemName: string;
  itemUnit: string;
  productId: string;
  productName: string;
  /** Whole units of the central item to turn into menu stock. */
  quantity: number;
  /** Whole units of the item that one menu unit uses. */
  portionSize: number;
  notes?: string;
};

/**
 * Turn part of a branch's Stock Room stock into menu stock, offline first.
 *
 * The received ledger drops immediately because the conversion is stored
 * locally. The menu product's own stock is raised by the server when the queued
 * batch syncs, so the branch's catalog catches up on the next pull.
 */
export function createCentralConversionLocal(
  scopeId: string,
  input: CreateCentralConversionInput,
  actor: CentralActor,
): { ok: true; conversion: CentralConversion } | { ok: false; error: string } {
  const quantity = Math.round(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { ok: false, error: "Enter a whole number of at least 1." };
  }
  if (!Number.isFinite(input.portionSize) || input.portionSize <= 0) {
    return { ok: false, error: "Set how much stock one menu item uses." };
  }

  const available = centralReceivedBalance(scopeId, input.globalItemId);
  if (quantity > available) {
    return {
      ok: false,
      error: `Only ${available} ${input.itemUnit} of "${input.itemName}" left in the Stock Room.`,
    };
  }

  const portions = Math.floor(quantity / input.portionSize + 1e-9);
  if (portions < 1) {
    return {
      ok: false,
      error: `That is less than one ${input.productName}. Raise the quantity or lower the portion size.`,
    };
  }

  const now = new Date();
  const conversion: CentralConversion = {
    id: uid("conv"),
    storeId: scopeId,
    globalItemId: input.globalItemId,
    productId: input.productId,
    bulkQuantityUsed: quantity,
    portionsProduced: portions,
    convertedAt: now.toISOString(),
    notes: input.notes?.trim().slice(0, 240) || null,
    itemName: input.itemName,
    itemUnit: input.itemUnit,
    productName: input.productName,
  };

  // Cache the rate locally so the next batch is one tap. The server saves the
  // same rate when the batch syncs.
  const rate: CentralConversionRate = {
    id: `rate_${input.globalItemId}_${input.productId}`,
    storeId: scopeId,
    globalItemId: input.globalItemId,
    productId: input.productId,
    portionName: input.productName,
    quantityPerPortion: input.portionSize,
    isActive: true,
    itemName: input.itemName,
    itemUnit: input.itemUnit,
  };

  const op = newOp(scopeId, actor, {
    kind: "conversion.create",
    conversion,
    portionSize: input.portionSize,
  });

  localDocWriteBatch(scopeId, [
    { collection: CONVERSIONS, item: conversion },
    { collection: RATES, item: rate },
    { collection: OUTBOX, item: op },
  ]);
  emitCentralChange(true);
  return { ok: true, conversion };
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
  "invalid_delta",
  "duplicate_id",
  "not_a_member",
  "sender_role_required",
  "owner_only",
  // Stock Room conversion refused by the server (rate missing, too small for
  // one menu item, product gone or untracked). The batch is undone locally.
  "rate_required",
  "too_small",
  "product_not_found",
  "product_refused",
  "invalid_store",
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
    case "item.adjust": {
      const res = await api.adjustCentralStock(op.itemId, {
        id: op.movement.id,
        delta: op.movement.delta,
        note: op.movement.note ?? undefined,
      });
      if (res.ok) {
        // Keep the server's balances: another device may have moved the stock
        // between this adjustment being queued and it being applied.
        localDocPut(op.scopeId, ITEMS, res.data.item);
        localDocPut(op.scopeId, MOVEMENTS, {
          ...op.movement,
          ...res.data.movement,
          failed: undefined,
          syncError: undefined,
        });
        return { ok: true };
      }
      if (res.error.code === "item_not_found") {
        // The item was deleted elsewhere; the adjustment has nothing to apply.
        localDocPut(op.scopeId, MOVEMENTS, { ...op.movement, failed: true });
        return { ok: true };
      }
      return {
        ok: false,
        error: res.error.message,
        permanent: !TRANSIENT_CODES.has(res.error.code),
        rollback: ROLLBACK_CODES.has(res.error.code),
      };
    }
    case "allocation.create": {
      const res = await api.createAllocation({
        id: op.allocation.id,
        globalItemId: op.allocation.globalItemId,
        toStoreId: op.allocation.toStoreId,
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
    case "conversion.create": {
      const res = await api.createConversion(op.scopeId, {
        id: op.conversion.id,
        globalItemId: op.conversion.globalItemId,
        productId: op.conversion.productId ?? "",
        bulkQuantityUsed: op.conversion.bulkQuantityUsed,
        portionSize: op.portionSize,
        notes: op.conversion.notes ?? undefined,
      });
      if (res.ok) {
        // Keep the server's timestamp and product name, drop any local error.
        localDocPut(op.scopeId, CONVERSIONS, {
          ...op.conversion,
          ...res.data,
          syncError: undefined,
          failed: undefined,
        });
        return { ok: true };
      }
      return {
        ok: false,
        error: res.error.message,
        permanent: !TRANSIENT_CODES.has(res.error.code),
        rollback: ROLLBACK_CODES.has(res.error.code),
      };
    }
  }
}

function rollbackAllocationCreate(
  scopeId: string,
  op: Extract<CentralOp, { kind: "allocation.create" }>,
  error: string,
): void {
  const stored = centralAllocation(scopeId, op.allocation.id) ?? op.allocation;
  // Already cancelled, or a branch confirmed it and it has to stay received.
  if (stored.status !== "pending" && stored.status !== "fulfilled") return;
  // A cancelled send must never put stock back twice.
  if (stored.stockDeductedAt == null) return;

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

function rollbackCentralAdjust(
  scopeId: string,
  op: Extract<CentralOp, { kind: "item.adjust" }>,
  error: string,
): void {
  const item = centralItem(scopeId, op.itemId);
  const writes: { collection: string; item: CentralItem | CentralStockMovement }[] = [
    {
      collection: MOVEMENTS,
      item: { ...op.movement, failed: true, syncError: error },
    },
  ];
  if (item) {
    // Undo exactly the delta this op applied. Clamped at zero because another
    // device may have removed stock in the meantime.
    writes.push({
      collection: ITEMS,
      item: {
        ...item,
        totalStock: Math.max(0, item.totalStock - op.movement.delta),
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
    case "item.adjust":
    case "allocation.create":
    case "conversion.create":
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
      if (op.kind === "allocation.create") {
        // The server received the delivery in the same request, so the queued
        // send is on the shop's shelf now. Rows written by an older build may
        // still read "pending"; catch them up.
        const local = centralAllocation(scopeId, op.allocation.id);
        if (local && local.status === "pending") {
          localDocPut(scopeId, ALLOCATIONS, {
            ...local,
            status: "fulfilled",
            fulfilledAt: new Date().toISOString(),
            fulfilledByUserId: op.actorId,
            fulfilledByName: op.actorName,
            syncError: undefined,
          });
        }
      }
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

    if (result.rollback && op.kind === "conversion.create") {
      // The server refused the batch. Mark it failed instead of retrying, so
      // the stock returns to the Stock Room and the reason stays visible.
      const local =
        localDocGet<CentralConversion>(scopeId, CONVERSIONS, op.conversion.id) ??
        op.conversion;
      localDocPut(scopeId, CONVERSIONS, {
        ...local,
        failed: true,
        syncError: result.error,
      });
      localDocDelete(scopeId, OUTBOX, op.id);
      continue;
    }

    if (result.rollback && op.kind === "item.adjust") {
      // The server has less stock than this device thought (another till got
      // there first). Undo the change so the balance matches the server.
      rollbackCentralAdjust(scopeId, op, result.error);
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

/** Replace the branch's conversion history cache. */
export async function refreshCentralConversions(scopeId: string): Promise<boolean> {
  if (OFFLINE_MODE || localDocCount(scopeId, OUTBOX) > 0) return false;
  const res = await api.listConversions(scopeId);
  if (!res.ok) return false;
  localDocReplaceAll(scopeId, CONVERSIONS, res.data);
  emitCentralChange();
  return true;
}

/** Replace the branch's saved conversion rates. */
export async function refreshCentralConversionRates(scopeId: string): Promise<boolean> {
  if (OFFLINE_MODE || localDocCount(scopeId, OUTBOX) > 0) return false;
  const res = await api.listConversionRates(scopeId);
  if (!res.ok) return false;
  localDocReplaceAll(scopeId, RATES, res.data);
  emitCentralChange();
  return true;
}

/**
 * Replace one item's add/remove history with the server's copy.
 *
 * The ledger is per item, so only that item's local rows are replaced; other
 * items keep theirs. Local writes waiting in the outbox block the refresh so an
 * unsynced adjustment cannot disappear.
 */
export async function refreshCentralStockMovements(
  scopeId: string,
  itemId: string,
): Promise<boolean> {
  if (OFFLINE_MODE || localDocCount(scopeId, OUTBOX) > 0) return false;
  const res = await api.listCentralStockMovements(itemId);
  if (!res.ok) return false;

  for (const movement of localDocLoadAll<CentralStockMovement>(scopeId, MOVEMENTS)) {
    if (movement.itemId === itemId) localDocDelete(scopeId, MOVEMENTS, movement.id);
  }
  if (res.data.length > 0) {
    localDocWriteBatch(
      scopeId,
      res.data.map((movement) => ({ collection: MOVEMENTS, item: movement })),
    );
  }
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
