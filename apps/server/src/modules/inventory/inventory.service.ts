import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { StoreRole } from "@gls-pos/types";
import { roleCan } from "@gls-pos/types";
import type { Env } from "../../env.js";
import type { StoreDurableObject } from "../../durable-objects/store.do.js";
import { createDb, schema } from "../../db/index.js";
import { newId } from "../../lib/id.js";
import { HttpError } from "../../lib/http-error.js";
import {
  getCentralStoreForUser,
  listStoresForUser,
} from "../stores/stores.service.js";

export { listStoresForUser };

/** The caller's role in one store, or null when they aren't a member. */
export async function roleInStore(
  env: Env,
  userId: string,
  storeId: string,
): Promise<StoreRole | null> {
  const db = createDb(env.DB);
  const [row] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.storeId, storeId)))
    .limit(1);
  return (row?.role as StoreRole) ?? null;
}

/** Only owners and managers may send central stock. */
const SENDER_ROLES: readonly StoreRole[] = ["owner", "manager"];

/** Throw unless the user holds an owner/manager role in this store. */
export async function requireSenderRole(env: Env, userId: string, storeId: string): Promise<StoreRole> {
  const role = await roleInStore(env, userId, storeId);
  if (!role) {
    throw HttpError.forbidden("You are not a member of this store", "not_a_member");
  }
  if (!SENDER_ROLES.includes(role)) {
    throw HttpError.forbidden("Only owners and managers can send stock", "sender_role_required");
  }
  return role;
}

/** Throw unless the user is a member of this store (any role, for reads). */
export async function requireMembership(env: Env, userId: string, storeId: string): Promise<StoreRole> {
  const role = await roleInStore(env, userId, storeId);
  if (!role) {
    throw HttpError.forbidden("You are not a member of this store", "not_a_member");
  }
  return role;
}

/**
 * The central store and the caller's role in it. Only its owner/manager can
 * see or move its stock; being a manager in a branch is not enough.
 */
export async function requireCentralSender(env: Env, userId: string) {
  const central = await getCentralStoreForUser(env, userId);
  if (!central) {
    throw new HttpError(
      409,
      "central_store_required",
      "Set up the central store before managing central stock.",
    );
  }
  const role = await requireSenderRole(env, userId, central.id);
  return { central, role };
}

/** Throw unless the user's role in this store may adjust inventory. */
export async function requireInventoryAdjust(env: Env, userId: string, storeId: string): Promise<StoreRole> {
  const role = await requireMembership(env, userId, storeId);
  if (!roleCan(role, "inventory:adjust")) {
    throw HttpError.forbidden("Your role cannot adjust inventory", "insufficient_permission");
  }
  return role;
}

export type AllocationActor = {
  id: string;
  name: string;
  email?: string;
};

// --- Central inventory items ---

type CentralStore = NonNullable<Awaited<ReturnType<typeof getCentralStoreForUser>>>;

function centralItemScope(central: CentralStore) {
  return and(
    eq(schema.globalInventoryItems.ownerId, central.ownerId),
    or(
      eq(schema.globalInventoryItems.storeId, central.id),
      isNull(schema.globalInventoryItems.storeId),
    ),
  );
}

export async function listGlobalInventoryItems(env: Env, central: CentralStore) {
  const db = createDb(env.DB);
  return db
    .select()
    .from(schema.globalInventoryItems)
    .where(centralItemScope(central))
    .orderBy(schema.globalInventoryItems.name);
}

export async function createGlobalInventoryItem(
  env: Env,
  central: CentralStore,
  input: {
    id?: string;
    name: string;
    unit: string;
    totalStock?: number;
    minStock?: number;
    description?: string;
  },
) {
  const db = createDb(env.DB);
  const id = input.id ?? newId("inv");
  const now = new Date();

  if (input.id) {
    const [existing] = await db
      .select()
      .from(schema.globalInventoryItems)
      .where(eq(schema.globalInventoryItems.id, id))
      .limit(1);
    if (existing) {
      if (existing.ownerId === central.ownerId) return existing;
      throw HttpError.badRequest("That item id is already in use", "duplicate_id");
    }
  }

  await db.insert(schema.globalInventoryItems).values({
    id,
    ownerId: central.ownerId,
    storeId: central.id,
    name: input.name,
    unit: input.unit,
    totalStock: input.totalStock ?? 0,
    minStock: input.minStock ?? 0,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const [created] = await db
    .select()
    .from(schema.globalInventoryItems)
    .where(eq(schema.globalInventoryItems.id, id))
    .limit(1);
  return created;
}

export async function updateGlobalInventoryItem(
  env: Env,
  central: CentralStore,
  itemId: string,
  input: { name?: string; unit?: string; totalStock?: number; minStock?: number; description?: string },
) {
  const db = createDb(env.DB);

  const [existing] = await db
    .select()
    .from(schema.globalInventoryItems)
    .where(and(eq(schema.globalInventoryItems.id, itemId), centralItemScope(central)))
    .limit(1);

  if (!existing) {
    throw HttpError.notFound("Central inventory item not found", "item_not_found");
  }

  const patch = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined),
  ) as Partial<typeof input>;

  if (Object.keys(patch).length > 0) {
    await db
      .update(schema.globalInventoryItems)
      .set({
        ...patch,
        ownerId: central.ownerId,
        storeId: central.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.globalInventoryItems.id, itemId));
  }

  return db
    .select()
    .from(schema.globalInventoryItems)
    .where(eq(schema.globalInventoryItems.id, itemId))
    .limit(1);
}

export async function deleteGlobalInventoryItem(
  env: Env,
  central: CentralStore,
  itemId: string,
) {
  const db = createDb(env.DB);
  const [existing] = await db
    .select({ id: schema.globalInventoryItems.id })
    .from(schema.globalInventoryItems)
    .where(and(eq(schema.globalInventoryItems.id, itemId), centralItemScope(central)))
    .limit(1);
  if (!existing) {
    throw HttpError.notFound("Central inventory item not found", "item_not_found");
  }
  await db
    .delete(schema.globalInventoryItems)
    .where(eq(schema.globalInventoryItems.id, itemId));
}

// --- Central stock adjustments (add / remove) ---

/**
 * Add or remove central stock and record why.
 *
 * The balance is moved by a signed delta rather than overwritten, so two people
 * adding stock on two devices both count instead of the last save winning. The
 * row is keyed by a client id: replaying the same adjustment after a dropped
 * response cannot double the stock.
 */
export async function adjustCentralStock(
  env: Env,
  central: CentralStore,
  itemId: string,
  input: { id?: string; delta: number; note?: string },
  actor: { id: string; name: string },
) {
  const db = createDb(env.DB);

  const delta = Math.trunc(input.delta);
  if (!Number.isFinite(delta) || delta === 0) {
    throw HttpError.badRequest("Enter an amount to add or remove", "invalid_delta");
  }

  const [item] = await db
    .select()
    .from(schema.globalInventoryItems)
    .where(and(eq(schema.globalInventoryItems.id, itemId), centralItemScope(central)))
    .limit(1);
  if (!item) {
    throw HttpError.notFound("Central inventory item not found", "item_not_found");
  }

  // Replaying a queued adjustment returns the original row and changes nothing.
  if (input.id) {
    const [existing] = await db
      .select()
      .from(schema.centralStockMovements)
      .where(eq(schema.centralStockMovements.id, input.id))
      .limit(1);
    if (existing) {
      return { item, movement: existing, duplicate: true, lowStock: null };
    }
  }

  const base = item.totalStock;
  const now = new Date();
  const id = input.id ?? newId("mov");
  const note = input.note?.trim().slice(0, 240) || null;

  // Move the balance with SQL arithmetic and a guard, so two devices adding at
  // the same time both count and a removal can never push the total below zero.
  const [updated] = await db
    .update(schema.globalInventoryItems)
    .set({
      totalStock: sql`${schema.globalInventoryItems.totalStock} + ${delta}`,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.globalInventoryItems.id, itemId),
        gte(sql`${schema.globalInventoryItems.totalStock} + ${delta}`, 0),
      ),
    )
    .returning();

  if (!updated) {
    throw HttpError.badRequest(
      `Only ${base} ${item.unit} of "${item.name}" in stock`,
      "insufficient_stock",
    );
  }

  const resulting = updated.totalStock;

  await db.insert(schema.centralStockMovements).values({
    id,
    itemId,
    storeId: central.id,
    delta,
    baseStock: resulting - delta,
    resulting,
    note,
    actorId: actor.id,
    actorName: actor.name,
    at: now,
  });

  const [movement] = await db
    .select()
    .from(schema.centralStockMovements)
    .where(eq(schema.centralStockMovements.id, id))
    .limit(1);

  return {
    item: updated,
    movement,
    duplicate: false,
    /**
     * Set when a removal dropped the item to or below its alert level. The
     * route sends the owner one push; adding stock never alerts.
     */
    lowStock:
      delta < 0 && base > item.minStock && updated.totalStock <= item.minStock
        ? {
            itemId: item.id,
            itemName: item.name,
            unit: item.unit,
            remaining: updated.totalStock,
            minStock: item.minStock,
          }
        : null,
  };
}

/** Recent add/remove entries for one central item, newest first. */
export async function listCentralStockMovements(
  env: Env,
  central: CentralStore,
  itemId: string,
  limit = 50,
) {
  const db = createDb(env.DB);

  const [item] = await db
    .select({ id: schema.globalInventoryItems.id })
    .from(schema.globalInventoryItems)
    .where(and(eq(schema.globalInventoryItems.id, itemId), centralItemScope(central)))
    .limit(1);
  if (!item) {
    throw HttpError.notFound("Central inventory item not found", "item_not_found");
  }

  return db
    .select()
    .from(schema.centralStockMovements)
    .where(eq(schema.centralStockMovements.itemId, itemId))
    .orderBy(desc(schema.centralStockMovements.at))
    .limit(limit);
}

// --- Inventory Allocations ---

export type AllocationFilters = {
  toStoreId?: string;
  fromStoreId?: string;
  status?: "pending" | "fulfilled" | "cancelled";
  /** Restrict to allocations touching any of these stores (the caller's memberships). */
  memberStoreIds?: string[];
};

/**
 * Allocations enriched for list screens: global-item name/unit plus both store
 * names and the staff attribution, newest first. Cap 100 — the hub pages, it
 * never needs the full history in one response.
 */
export async function listAllocations(env: Env, filters: AllocationFilters = {}) {
  const db = createDb(env.DB);

  const predicates = [];
  if (filters.toStoreId) predicates.push(eq(schema.inventoryAllocations.toStoreId, filters.toStoreId));
  if (filters.fromStoreId) predicates.push(eq(schema.inventoryAllocations.fromStoreId, filters.fromStoreId));
  if (filters.status) predicates.push(eq(schema.inventoryAllocations.status, filters.status));
  if (!filters.toStoreId && !filters.fromStoreId && filters.memberStoreIds) {
    const ids = filters.memberStoreIds;
    if (ids.length === 0) return [];
    predicates.push(
      or(
        inArray(schema.inventoryAllocations.toStoreId, ids),
        inArray(schema.inventoryAllocations.fromStoreId, ids),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(schema.inventoryAllocations)
    .where(predicates.length > 0 ? and(...predicates) : undefined)
    .orderBy(desc(schema.inventoryAllocations.allocatedAt))
    .limit(100);

  if (rows.length === 0) return [];

  const itemIds = [...new Set(rows.map((r) => r.globalItemId))];
  const storeIds = [...new Set(rows.flatMap((r) => [r.fromStoreId, r.toStoreId]))];

  const [items, stores] = await Promise.all([
    itemIds.length > 0
      ? db.select().from(schema.globalInventoryItems).where(inArray(schema.globalInventoryItems.id, itemIds))
      : [],
    storeIds.length > 0
      ? db
          .select({ id: schema.store.id, name: schema.store.name })
          .from(schema.store)
          .where(inArray(schema.store.id, storeIds))
      : [],
  ]);

  const itemById = new Map(items.map((i) => [i.id, i]));
  const storeNameById = new Map(stores.map((s) => [s.id, s.name]));

  return rows.map((r) => ({
    ...r,
    itemName: itemById.get(r.globalItemId)?.name ?? r.globalItemId,
    itemUnit: itemById.get(r.globalItemId)?.unit ?? "",
    fromStoreName: storeNameById.get(r.fromStoreId) ?? r.fromStoreId,
    toStoreName: storeNameById.get(r.toStoreId) ?? r.toStoreId,
  }));
}

function storeStub(env: Env, storeId: string): DurableObjectStub<StoreDurableObject> {
  return env.STORE.get(env.STORE.idFromName(storeId));
}

/**
 * Move stock from the central store to one branch.
 *
 * The source is never chosen by the client: it is always the caller's central
 * store. A transfer is a record of stock moving to a shop, not a change to that
 * shop's menu: the quantity sent is the quantity received, in the central item's
 * own unit. The shop sees it under its "Central stock", and no destination
 * product has to exist for the send to succeed.
 */
export async function createAllocation(
  env: Env,
  input: {
    id?: string;
    globalItemId: string;
    toStoreId: string;
    quantity: number;
    notes?: string;
  },
  actor: AllocationActor,
) {
  const db = createDb(env.DB);
  const { central } = await requireCentralSender(env, actor.id);
  const allocationId = input.id ?? newId("alloc");

  // Retrying a client-minted id must return the original transfer without
  // deducting stock a second time. Check before validating the item so a
  // response lost after a successful write is still safely replayable.
  if (input.id) {
    let [existing] = await db
      .select()
      .from(schema.inventoryAllocations)
      .where(eq(schema.inventoryAllocations.id, allocationId))
      .limit(1);
    if (existing) {
      if (existing.fromStoreId !== central.id) {
        throw HttpError.badRequest("That transfer id is already in use", "duplicate_id");
      }
      // A first attempt that died between writing the row and marking it
      // received would otherwise sit as pending forever. Finish it now,
      // best-effort: fulfilling is idempotent, so a repeat is free and a real
      // failure is left for the fulfill endpoint to report.
      if (existing.status === "pending") {
        try {
          await fulfillAllocation(env, allocationId, actor);
          const [refreshed] = await db
            .select()
            .from(schema.inventoryAllocations)
            .where(eq(schema.inventoryAllocations.id, allocationId))
            .limit(1);
          if (refreshed) existing = refreshed;
        } catch {
          // Leave it pending rather than fail a replay of a good transfer.
        }
      }
      const [existingItem] = await db
        .select({ name: schema.globalInventoryItems.name, unit: schema.globalInventoryItems.unit })
        .from(schema.globalInventoryItems)
        .where(eq(schema.globalInventoryItems.id, existing.globalItemId))
        .limit(1);
      const [existingStore] = await db
        .select({ name: schema.store.name })
        .from(schema.store)
        .where(eq(schema.store.id, existing.toStoreId))
        .limit(1);
      return {
        ...existing,
        itemName: existingItem?.name ?? existing.globalItemId,
        itemUnit: existingItem?.unit ?? "",
        fromStoreName: central.name,
        toStoreName: existingStore?.name ?? existing.toStoreId,
        // A replay must not alert twice; the first attempt already did.
        lowStock: null,
      };
    }
  }

  const [item] = await db
    .select()
    .from(schema.globalInventoryItems)
    .where(and(eq(schema.globalInventoryItems.id, input.globalItemId), centralItemScope(central)))
    .limit(1);

  if (!item) {
    throw HttpError.notFound("Central inventory item not found", "item_not_found");
  }

  const [toStore] = await db
    .select({
      id: schema.store.id,
      name: schema.store.name,
      ownerId: schema.store.ownerId,
      isCentral: schema.store.isCentral,
      parentStoreId: schema.store.parentStoreId,
    })
    .from(schema.store)
    .where(eq(schema.store.id, input.toStoreId))
    .limit(1);

  if (!toStore) {
    throw HttpError.notFound("Destination store not found", "to_store_not_found");
  }
  if (toStore.isCentral) {
    throw HttpError.badRequest("Choose a branch, not the central store", "invalid_destination");
  }
  if (toStore.ownerId !== central.ownerId || (toStore.parentStoreId && toStore.parentStoreId !== central.id)) {
    throw HttpError.forbidden("That shop is not under this central store", "not_in_tree");
  }

  const quantity = Math.round(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw HttpError.badRequest("Quantity must be a whole number of at least 1", "invalid_quantity");
  }

  if (item.storeId !== central.id) {
    await db
      .update(schema.globalInventoryItems)
      .set({ ownerId: central.ownerId, storeId: central.id, updatedAt: new Date() })
      .where(eq(schema.globalInventoryItems.id, item.id));
  }

  const now = new Date();
  const deducted = await db
    .update(schema.globalInventoryItems)
    .set({
      totalStock: sql`${schema.globalInventoryItems.totalStock} - ${quantity}`,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.globalInventoryItems.id, item.id),
        gte(schema.globalInventoryItems.totalStock, quantity),
      ),
    )
    .returning({ id: schema.globalInventoryItems.id, totalStock: schema.globalInventoryItems.totalStock });

  if (deducted.length === 0) {
    const [fresh] = await db
      .select({ totalStock: schema.globalInventoryItems.totalStock })
      .from(schema.globalInventoryItems)
      .where(eq(schema.globalInventoryItems.id, item.id))
      .limit(1);
    throw HttpError.badRequest(
      `Only ${fresh?.totalStock ?? 0} ${item.unit} of "${item.name}" in central stock`,
      "insufficient_stock",
    );
  }

  try {
    await db.insert(schema.inventoryAllocations).values({
      id: allocationId,
      globalItemId: input.globalItemId,
      fromStoreId: central.id,
      toStoreId: input.toStoreId,
      productId: null,
      quantity,
      // The shop receives exactly what the centre sends, in the same unit.
      // The legacy receive columns stay populated so older clients and reports
      // keep displaying a coherent number.
      receiveQuantity: quantity,
      receiveUnit: item.unit,
      status: "pending",
      allocatedAt: now,
      stockDeductedAt: now,
      notes: input.notes?.slice(0, 240) ?? null,
      allocatedByUserId: actor.id,
      allocatedByName: actor.name.slice(0, 120),
    });
  } catch (err) {
    // Do not lose the centre's stock if the transfer row could not be written.
    await db
      .update(schema.globalInventoryItems)
      .set({
        totalStock: sql`${schema.globalInventoryItems.totalStock} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.globalInventoryItems.id, item.id));
    throw err;
  }

  // A transfer is received the moment it is sent. The centre dispatches and the
  // shop's central-stock ledger records it inside the same request, so nobody
  // has to stand around confirming a delivery that already left the building.
  try {
    await fulfillAllocation(env, allocationId, actor);
  } catch (err) {
    await db
      .delete(schema.inventoryAllocations)
      .where(eq(schema.inventoryAllocations.id, allocationId));
    await db
      .update(schema.globalInventoryItems)
      .set({
        totalStock: sql`${schema.globalInventoryItems.totalStock} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.globalInventoryItems.id, item.id));
    throw err;
  }

  return {
    id: allocationId,
    globalItemId: input.globalItemId,
    fromStoreId: central.id,
    toStoreId: input.toStoreId,
    productId: null,
    quantity,
    receiveQuantity: quantity,
    receiveUnit: item.unit,
    status: "fulfilled" as const,
    allocatedAt: now,
    stockDeductedAt: now,
    fulfilledAt: new Date(),
    notes: input.notes ?? null,
    allocatedByUserId: actor.id,
    allocatedByName: actor.name,
    itemName: item.name,
    itemUnit: item.unit,
    fromStoreName: central.name,
    toStoreName: toStore.name,
    /**
     * Set only when this send pushed the centre from healthy to low. The route
     * turns it into a push, so the service stays free of notification concerns
     * and a replay cannot alert twice.
     */
    lowStock:
      item.totalStock > item.minStock && deducted[0]!.totalStock <= item.minStock
        ? {
            itemId: item.id,
            itemName: item.name,
            unit: item.unit,
            remaining: deducted[0]!.totalStock,
            minStock: item.minStock,
          }
        : null,
  };
}

export async function fulfillAllocation(env: Env, allocationId: string, actor: AllocationActor) {
  const db = createDb(env.DB);

  const [allocation] = await db
    .select()
    .from(schema.inventoryAllocations)
    .where(eq(schema.inventoryAllocations.id, allocationId))
    .limit(1);

  if (!allocation) {
    throw HttpError.notFound("Allocation not found", "allocation_not_found");
  }

  if (allocation.status === "fulfilled") {
    // Retry after a client timeout: the first call already applied it.
    return { success: true, allocationId, alreadyFulfilled: true };
  }

  if (allocation.status !== "pending") {
    throw HttpError.badRequest("Allocation was cancelled", "already_processed");
  }

  // Confirming needs a sender role in the receiving store (or the sending one,
  // so the hub owner can confirm on a branch's behalf).
  const [toRole, fromRole] = await Promise.all([
    roleInStore(env, actor.id, allocation.toStoreId),
    roleInStore(env, actor.id, allocation.fromStoreId),
  ]);
  if (!toRole && !fromRole) {
    throw HttpError.forbidden("You are not a member of this delivery", "not_a_member");
  }
  if (![toRole, fromRole].some((r) => r && SENDER_ROLES.includes(r))) {
    throw HttpError.forbidden("Only owners and managers can confirm deliveries", "sender_role_required");
  }

  const [item] = await db
    .select()
    .from(schema.globalInventoryItems)
    .where(eq(schema.globalInventoryItems.id, allocation.globalItemId))
    .limit(1);

  if (!item) {
    throw HttpError.notFound("Global inventory item not found", "item_not_found");
  }

  // New transfers already left the centre at dispatch. Only legacy rows
  // (created before the tree model) still deduct on receipt.
  const deductOnReceipt = allocation.stockDeductedAt == null;
  if (deductOnReceipt && item.totalStock < allocation.quantity) {
    throw HttpError.badRequest(
      `Only ${item.totalStock} ${item.unit} of "${item.name}" left in central stock`,
      "insufficient_stock",
    );
  }

  // A transfer never touches the destination shop's menu or product stock. The
  // allocation row itself is the shop's central-stock ledger entry: whatever
  // quantity was sent is what the shop received, in the item's own unit.
  //
  // Claim the pending row so exactly one caller marks it received: a phone that
  // timed out may retry while this call is still running. For a new transfer
  // central stock was already deducted on dispatch; legacy rows are deducted
  // here once.
  const fulfilledAt = new Date();
  const claimed = await db
    .update(schema.inventoryAllocations)
    .set({
      status: "fulfilled",
      fulfilledAt,
      fulfilledByUserId: actor.id,
      fulfilledByName: actor.name.slice(0, 120),
    })
    .where(
      and(
        eq(schema.inventoryAllocations.id, allocationId),
        eq(schema.inventoryAllocations.status, "pending"),
      ),
    )
    .returning({ id: schema.inventoryAllocations.id });

  if (claimed.length > 0 && deductOnReceipt) {
    await db
      .update(schema.globalInventoryItems)
      .set({
        totalStock: sql`${schema.globalInventoryItems.totalStock} - ${allocation.quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.globalInventoryItems.id, allocation.globalItemId));
  }

  return { success: true, allocationId };
}

export async function cancelAllocation(env: Env, allocationId: string, actorUserId: string) {
  const db = createDb(env.DB);

  const [allocation] = await db
    .select({
      id: schema.inventoryAllocations.id,
      status: schema.inventoryAllocations.status,
      globalItemId: schema.inventoryAllocations.globalItemId,
      quantity: schema.inventoryAllocations.quantity,
      stockDeductedAt: schema.inventoryAllocations.stockDeductedAt,
      fromStoreId: schema.inventoryAllocations.fromStoreId,
      toStoreId: schema.inventoryAllocations.toStoreId,
    })
    .from(schema.inventoryAllocations)
    .where(eq(schema.inventoryAllocations.id, allocationId))
    .limit(1);

  if (!allocation) {
    throw HttpError.notFound("Allocation not found", "allocation_not_found");
  }

  if (allocation.status !== "pending") {
    throw HttpError.badRequest("Can only cancel pending allocations", "not_cancelable");
  }

  const [toRole, fromRole] = await Promise.all([
    roleInStore(env, actorUserId, allocation.toStoreId),
    roleInStore(env, actorUserId, allocation.fromStoreId),
  ]);
  if (![toRole, fromRole].some((r) => r && SENDER_ROLES.includes(r))) {
    if (!toRole && !fromRole) throw HttpError.forbidden("You are not a member of this delivery", "not_a_member");
    throw HttpError.forbidden("Only owners and managers can cancel deliveries", "sender_role_required");
  }

  const cancelled = await db
    .update(schema.inventoryAllocations)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(schema.inventoryAllocations.id, allocationId),
        eq(schema.inventoryAllocations.status, "pending"),
      ),
    )
    .returning({ id: schema.inventoryAllocations.id });

  // New transfers already left the centre at dispatch; cancelling puts the
  // stock back. Legacy rows were never deducted, so there is nothing to refund.
  if (cancelled.length > 0 && allocation.stockDeductedAt != null) {
    await db
      .update(schema.globalInventoryItems)
      .set({
        totalStock: sql`${schema.globalInventoryItems.totalStock} + ${allocation.quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.globalInventoryItems.id, allocation.globalItemId));
  }

  return { success: true, allocationId };
}

/** Live catalog products of one store, for the Send-to-store product picker. */
export async function listStoreProducts(env: Env, storeId: string) {
  const products = await storeStub(env, storeId).apiProducts();
  return products.map((p) => ({ id: p.id, name: p.name, stock: p.stock, stockState: p.stockState }));
}

// --- Conversion Rates ---

export async function getConversionRate(
  env: Env,
  storeId: string,
  globalItemId: string,
  productId?: string,
) {
  const db = createDb(env.DB);

  const [rate] = await db
    .select()
    .from(schema.inventoryConversionRates)
    .where(
      and(
        eq(schema.inventoryConversionRates.storeId, storeId),
        eq(schema.inventoryConversionRates.globalItemId, globalItemId),
        productId
          ? eq(schema.inventoryConversionRates.productId, productId)
          : isNull(schema.inventoryConversionRates.productId),
        eq(schema.inventoryConversionRates.isActive, true),
      ),
    )
    .limit(1);

  return rate;
}

export async function upsertConversionRate(
  env: Env,
  storeId: string,
  globalItemId: string,
  productId: string | undefined,
  portionName: string,
  quantityPerPortion: number,
) {
  const db = createDb(env.DB);

  if (!Number.isFinite(quantityPerPortion) || quantityPerPortion <= 0) {
    throw HttpError.badRequest("Quantity per portion must be positive", "invalid_rate");
  }

  const [existing] = await db
    .select()
    .from(schema.inventoryConversionRates)
    .where(
      and(
        eq(schema.inventoryConversionRates.storeId, storeId),
        eq(schema.inventoryConversionRates.globalItemId, globalItemId),
        productId
          ? eq(schema.inventoryConversionRates.productId, productId)
          : isNull(schema.inventoryConversionRates.productId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.inventoryConversionRates)
      .set({
        portionName,
        quantityPerPortion,
        updatedAt: new Date(),
      })
      .where(eq(schema.inventoryConversionRates.id, existing.id));

    const [updated] = await db
      .select()
      .from(schema.inventoryConversionRates)
      .where(eq(schema.inventoryConversionRates.id, existing.id))
      .limit(1);

    return updated;
  }

  const id = newId("conv");
  await db.insert(schema.inventoryConversionRates).values({
    id,
    storeId,
    globalItemId,
    productId: productId ?? null,
    portionName,
    quantityPerPortion,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const [newRate] = await db
    .select()
    .from(schema.inventoryConversionRates)
    .where(eq(schema.inventoryConversionRates.id, id))
    .limit(1);

  return newRate;
}

export async function listConversionRates(env: Env, storeId: string) {
  const db = createDb(env.DB);

  return db
    .select({
      id: schema.inventoryConversionRates.id,
      storeId: schema.inventoryConversionRates.storeId,
      globalItemId: schema.inventoryConversionRates.globalItemId,
      productId: schema.inventoryConversionRates.productId,
      portionName: schema.inventoryConversionRates.portionName,
      quantityPerPortion: schema.inventoryConversionRates.quantityPerPortion,
      isActive: schema.inventoryConversionRates.isActive,
      createdAt: schema.inventoryConversionRates.createdAt,
      updatedAt: schema.inventoryConversionRates.updatedAt,
      itemName: schema.globalInventoryItems.name,
      itemUnit: schema.globalInventoryItems.unit,
    })
    .from(schema.inventoryConversionRates)
    .innerJoin(schema.globalInventoryItems, eq(schema.inventoryConversionRates.globalItemId, schema.globalInventoryItems.id))
    .where(eq(schema.inventoryConversionRates.storeId, storeId))
    .orderBy(schema.inventoryConversionRates.portionName);
}

// --- Inventory Conversions (bulk to portions) ---

export async function recordConversion(
  env: Env,
  storeId: string,
  input: {
    id?: string;
    globalItemId: string;
    productId: string;
    bulkQuantityUsed: number;
    portionSize?: number;
    notes?: string;
  },
  actor: AllocationActor,
) {
  const db = createDb(env.DB);

  const bulk = Math.round(input.bulkQuantityUsed);
  if (!Number.isFinite(bulk) || bulk < 1) {
    throw HttpError.badRequest("Quantity must be a whole number of at least 1", "invalid_quantity");
  }

  const [store] = await db
    .select({
      id: schema.store.id,
      ownerId: schema.store.ownerId,
      isCentral: schema.store.isCentral,
    })
    .from(schema.store)
    .where(eq(schema.store.id, storeId))
    .limit(1);
  if (!store) throw HttpError.notFound("Store not found", "store_not_found");
  if (store.isCentral) {
    throw HttpError.badRequest(
      "The Central Store does not convert its own stock",
      "invalid_store",
    );
  }

  const [item] = await db
    .select()
    .from(schema.globalInventoryItems)
    .where(eq(schema.globalInventoryItems.id, input.globalItemId))
    .limit(1);
  if (!item) {
    throw HttpError.notFound("Central inventory item not found", "item_not_found");
  }
  if (item.ownerId && item.ownerId !== store.ownerId) {
    throw HttpError.forbidden("That item belongs to another business", "not_in_tree");
  }

  // Replaying a client-minted id returns the original conversion. The stock
  // raise is idempotent too, so a lost response can be retried safely.
  if (input.id) {
    const [existing] = await db
      .select()
      .from(schema.inventoryConversions)
      .where(eq(schema.inventoryConversions.id, input.id))
      .limit(1);
    if (existing) {
      if (existing.storeId !== storeId) {
        throw HttpError.badRequest("That conversion id is already in use", "duplicate_id");
      }
      return {
        ...existing,
        itemName: item.name,
        itemUnit: item.unit,
        productName: "",
      };
    }
  }

  // What the shop actually holds: fulfilled deliveries minus everything it has
  // already turned into menu stock. This is the ledger the Stock Room shows.
  const [received] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.inventoryAllocations.quantity}), 0)` })
    .from(schema.inventoryAllocations)
    .where(
      and(
        eq(schema.inventoryAllocations.toStoreId, storeId),
        eq(schema.inventoryAllocations.globalItemId, input.globalItemId),
        eq(schema.inventoryAllocations.status, "fulfilled"),
      ),
    );
  const [converted] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.inventoryConversions.bulkQuantityUsed}), 0)` })
    .from(schema.inventoryConversions)
    .where(
      and(
        eq(schema.inventoryConversions.storeId, storeId),
        eq(schema.inventoryConversions.globalItemId, input.globalItemId),
      ),
    );

  const available = Number(received?.total ?? 0) - Number(converted?.total ?? 0);
  if (bulk > available) {
    throw HttpError.badRequest(
      `Only ${available} ${item.unit} of "${item.name}" left in the Stock Room`,
      "insufficient_stock",
    );
  }

  // The owner sets the rate once; every later conversion is automatic. A rate
  // sent with this request is saved so the next one needs no input.
  const savedRate = await getConversionRate(env, storeId, input.globalItemId, input.productId);
  const portionSize = input.portionSize ?? savedRate?.quantityPerPortion;
  if (!portionSize || portionSize <= 0) {
    throw HttpError.badRequest(
      "Set how much stock one menu item uses, then convert again",
      "rate_required",
    );
  }

  const portions = Math.floor(bulk / portionSize + 1e-9);
  if (portions < 1) {
    throw HttpError.badRequest(
      `That is less than one menu item. Raise the quantity or lower the portion size.`,
      "too_small",
    );
  }

  const id = input.id ?? newId("conv_rec");
  await db.insert(schema.inventoryConversions).values({
    id,
    storeId,
    globalItemId: input.globalItemId,
    productId: input.productId,
    bulkQuantityUsed: bulk,
    portionsProduced: portions,
    convertedAt: new Date(),
    notes: input.notes?.slice(0, 240) ?? null,
  });

  // Raise the menu product's stock in its own store. If the product cannot take
  // it (missing, untracked, has variants) the conversion row is removed so the
  // stock reappears in the Stock Room.
  let added: Awaited<ReturnType<StoreDurableObject["addProductStock"]>>;
  try {
    added = await storeStub(env, storeId).addProductStock({
      productId: input.productId,
      quantity: portions,
      ref: id,
      note: input.notes ?? `Stock Room: ${bulk} ${item.unit} ${item.name}`,
      actor: { id: actor.id, name: actor.name, email: actor.email },
    });
  } catch (err) {
    await db
      .delete(schema.inventoryConversions)
      .where(eq(schema.inventoryConversions.id, id));
    throw err;
  }

  if (!added.ok) {
    await db
      .delete(schema.inventoryConversions)
      .where(eq(schema.inventoryConversions.id, id));
    const message =
      added.error === "unknown_product"
        ? "That menu item no longer exists in this shop."
        : added.error === "untracked_product"
          ? "That menu item does not track stock. Turn tracking on first."
          : added.error === "product_has_variants"
            ? "That menu item has variants. Convert into a simple item instead."
            : "Invalid conversion quantity.";
    const code =
      added.error === "unknown_product" ? "product_not_found" : "product_refused";
    throw new HttpError(added.error === "unknown_product" ? 404 : 400, code, message);
  }

  if (input.portionSize != null) {
    await upsertConversionRate(
      env,
      storeId,
      input.globalItemId,
      input.productId,
      added.productName,
      input.portionSize,
    );
  }

  return {
    id,
    storeId,
    globalItemId: input.globalItemId,
    productId: input.productId,
    bulkQuantityUsed: bulk,
    portionsProduced: portions,
    convertedAt: new Date(),
    notes: input.notes?.slice(0, 240) ?? null,
    itemName: item.name,
    itemUnit: item.unit,
    productName: added.productName,
  };
}

export async function listConversions(env: Env, storeId: string, limit: number = 50) {
  const db = createDb(env.DB);

  return db
    .select({
      id: schema.inventoryConversions.id,
      storeId: schema.inventoryConversions.storeId,
      globalItemId: schema.inventoryConversions.globalItemId,
      productId: schema.inventoryConversions.productId,
      bulkQuantityUsed: schema.inventoryConversions.bulkQuantityUsed,
      portionsProduced: schema.inventoryConversions.portionsProduced,
      convertedAt: schema.inventoryConversions.convertedAt,
      notes: schema.inventoryConversions.notes,
      itemName: schema.globalInventoryItems.name,
      itemUnit: schema.globalInventoryItems.unit,
    })
    .from(schema.inventoryConversions)
    .innerJoin(schema.globalInventoryItems, eq(schema.inventoryConversions.globalItemId, schema.globalInventoryItems.id))
    .where(eq(schema.inventoryConversions.storeId, storeId))
    .orderBy(desc(schema.inventoryConversions.convertedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

// --- Production (branch product -> branch product) ---

/**
 * Owner-defined yield rules for a branch, newest first. Names and live stock
 * are intentionally not joined here: the caller renders both against the
 * store catalog, which is the only authoritative source for them.
 */
export async function listProductionRules(env: Env, storeId: string) {
  const db = createDb(env.DB);
  return db
    .select({
      id: schema.inventoryProductionRules.id,
      storeId: schema.inventoryProductionRules.storeId,
      inputProductId: schema.inventoryProductionRules.inputProductId,
      outputProductId: schema.inventoryProductionRules.outputProductId,
      inputQty: schema.inventoryProductionRules.inputQty,
      outputQty: schema.inventoryProductionRules.outputQty,
    })
    .from(schema.inventoryProductionRules)
    .where(eq(schema.inventoryProductionRules.storeId, storeId))
    .orderBy(desc(schema.inventoryProductionRules.updatedAt));
}

/**
 * Create or update the rule for one (input, output) pair.
 *
 * Upserting on the pair means tapping "New rule" twice for the same recipe
 * corrects its numbers instead of leaving two competing defaults.
 */
export async function upsertProductionRule(
  env: Env,
  storeId: string,
  input: {
    inputProductId: string;
    outputProductId: string;
    inputQty: number;
    outputQty: number;
  },
) {
  const { inputProductId, outputProductId, inputQty, outputQty } = input;

  if (inputProductId === outputProductId) {
    throw HttpError.badRequest("Choose two different products", "same_product");
  }
  if (
    !Number.isInteger(inputQty) ||
    inputQty < 1 ||
    !Number.isInteger(outputQty) ||
    outputQty < 1
  ) {
    throw HttpError.badRequest("Quantities must be whole numbers of at least 1", "invalid_quantity");
  }

  const db = createDb(env.DB);
  const now = new Date();
  const [existing] = await db
    .select({ id: schema.inventoryProductionRules.id })
    .from(schema.inventoryProductionRules)
    .where(
      and(
        eq(schema.inventoryProductionRules.storeId, storeId),
        eq(schema.inventoryProductionRules.inputProductId, inputProductId),
        eq(schema.inventoryProductionRules.outputProductId, outputProductId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.inventoryProductionRules)
      .set({ inputQty, outputQty, updatedAt: now })
      .where(eq(schema.inventoryProductionRules.id, existing.id));
    return { id: existing.id, storeId, inputProductId, outputProductId, inputQty, outputQty };
  }

  const id = newId("prod_rule");
  await db.insert(schema.inventoryProductionRules).values({
    id,
    storeId,
    inputProductId,
    outputProductId,
    inputQty,
    outputQty,
    createdAt: now,
    updatedAt: now,
  });
  return { id, storeId, inputProductId, outputProductId, inputQty, outputQty };
}

export async function deleteProductionRule(env: Env, storeId: string, ruleId: string) {
  const db = createDb(env.DB);
  const deleted = await db
    .delete(schema.inventoryProductionRules)
    .where(
      and(
        eq(schema.inventoryProductionRules.id, ruleId),
        eq(schema.inventoryProductionRules.storeId, storeId),
      ),
    )
    .returning({ id: schema.inventoryProductionRules.id });

  if (deleted.length === 0) {
    throw HttpError.notFound("Production rule not found", "rule_not_found");
  }
  return { success: true, id: ruleId };
}

export async function getProductionRule(env: Env, storeId: string, ruleId: string) {
  const db = createDb(env.DB);
  const [rule] = await db
    .select()
    .from(schema.inventoryProductionRules)
    .where(
      and(
        eq(schema.inventoryProductionRules.id, ruleId),
        eq(schema.inventoryProductionRules.storeId, storeId),
      ),
    )
    .limit(1);

  if (!rule) throw HttpError.notFound("Production rule not found", "rule_not_found");
  return rule;
}

/**
 * Run one batch. The rule supplies the two product ids; the quantities are
 * what actually moved, so a cook can record a short or bumper yield without
 * first editing the recipe. `ref` makes retries after a timeout safe.
 */
export async function produceStock(
  env: Env,
  storeId: string,
  input: {
    ruleId: string;
    inputQty: number;
    outputQty: number;
    ref: string;
    note?: string;
  },
  actor: { id: string; name: string; email?: string; role?: string },
) {
  const rule = await getProductionRule(env, storeId, input.ruleId);
  const result = await storeStub(env, storeId).produceFromStock({
    inputProductId: rule.inputProductId,
    outputProductId: rule.outputProductId,
    inputQty: input.inputQty,
    outputQty: input.outputQty,
    ref: input.ref,
    note: input.note,
    actor,
  });

  if (!result.ok) {
    switch (result.error) {
      case "unknown_product":
        throw HttpError.notFound("One of the products no longer exists", "unknown_product");
      case "untracked_product":
        throw HttpError.badRequest(
          "Both products must have stock tracking turned on",
          "untracked_product",
        );
      case "product_has_variants":
        throw HttpError.badRequest(
          "Production does not support products with variants",
          "product_has_variants",
        );
      case "invalid_quantity":
        throw HttpError.badRequest(
          "Quantities must be whole numbers of at least 1",
          "invalid_quantity",
        );
      case "same_product":
        throw HttpError.badRequest("Choose two different products", "same_product");
      case "insufficient_stock":
        throw HttpError.badRequest(
          `Not enough stock: only ${result.available ?? 0} left`,
          "insufficient_stock",
        );
    }
  }

  return {
    success: true,
    ruleId: rule.id,
    duplicate: result.duplicate ?? false,
    inputProductId: rule.inputProductId,
    outputProductId: rule.outputProductId,
    inputName: result.inputName,
    outputName: result.outputName,
    inputStock: result.inputStock,
    outputStock: result.outputStock,
  };
}
