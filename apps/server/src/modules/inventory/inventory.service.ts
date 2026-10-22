import { and, eq, desc, inArray, or, sql } from "drizzle-orm";
import type { StoreMembership, StoreRole } from "@gls-pos/types";
import { roleCan } from "@gls-pos/types";
import type { Env } from "../../env.js";
import type { StoreDurableObject } from "../../durable-objects/store.do.js";
import { createDb, schema } from "../../db/index.js";
import { newId } from "../../lib/id.js";
import { HttpError } from "../../lib/http-error.js";

// --- Stores service (copied from stores.service.ts for inventory module) ---

export async function listStoresForUser(env: Env, userId: string): Promise<StoreMembership[]> {
  const db = createDb(env.DB);
  const rows = await db
    .select({
      id: schema.store.id,
      name: schema.store.name,
      currency: schema.store.currency,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.store, eq(schema.member.storeId, schema.store.id))
    .where(eq(schema.member.userId, userId));

  return rows.map((r) => ({ ...r, role: r.role as StoreRole }));
}

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

/** Throw unless the user is an owner/manager in at least one store (central hub access). */
export async function requireCentralSender(env: Env, userId: string): Promise<StoreMembership[]> {
  const stores = await listStoresForUser(env, userId);
  if (!stores.some((s) => SENDER_ROLES.includes(s.role))) {
    throw HttpError.forbidden("Only owners and managers can manage central stock", "sender_role_required");
  }
  return stores;
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

// --- Global Inventory Items ---

export async function listGlobalInventoryItems(env: Env) {
  const db = createDb(env.DB);
  return db.select().from(schema.globalInventoryItems).orderBy(schema.globalInventoryItems.name);
}

export async function createGlobalInventoryItem(
  env: Env,
  input: { name: string; unit: string; totalStock?: number; minStock?: number; description?: string },
) {
  const db = createDb(env.DB);
  const id = newId("inv");

  await db.insert(schema.globalInventoryItems).values({
    id,
    name: input.name,
    unit: input.unit,
    totalStock: input.totalStock ?? 0,
    minStock: input.minStock ?? 0,
    description: input.description ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { id, name: input.name, unit: input.unit, totalStock: input.totalStock ?? 0 };
}

export async function updateGlobalInventoryItem(
  env: Env,
  itemId: string,
  input: { name?: string; unit?: string; totalStock?: number; minStock?: number; description?: string },
) {
  const db = createDb(env.DB);

  const [existing] = await db
    .select()
    .from(schema.globalInventoryItems)
    .where(eq(schema.globalInventoryItems.id, itemId))
    .limit(1);

  if (!existing) {
    throw HttpError.notFound("Inventory item not found", "item_not_found");
  }

  const patch = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined),
  ) as Partial<typeof input>;

  if (Object.keys(patch).length > 0) {
    await db
      .update(schema.globalInventoryItems)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.globalInventoryItems.id, itemId));
  }

  return db
    .select()
    .from(schema.globalInventoryItems)
    .where(eq(schema.globalInventoryItems.id, itemId))
    .limit(1);
}

export async function deleteGlobalInventoryItem(env: Env, itemId: string) {
  const db = createDb(env.DB);
  await db
    .delete(schema.globalInventoryItems)
    .where(eq(schema.globalInventoryItems.id, itemId));
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

export async function createAllocation(
  env: Env,
  input: { globalItemId: string; fromStoreId: string; toStoreId: string; productId?: string; quantity: number; notes?: string },
  actor: AllocationActor,
) {
  const db = createDb(env.DB);

  if (input.fromStoreId === input.toStoreId) {
    throw HttpError.badRequest("Source and destination stores must differ", "same_store");
  }

  // Only an owner/manager of the sending store may send.
  await requireSenderRole(env, actor.id, input.fromStoreId);
  // The destination must exist; membership there is checked on fulfill/listing.
  const [fromStore] = await db
    .select({ id: schema.store.id })
    .from(schema.store)
    .where(eq(schema.store.id, input.fromStoreId))
    .limit(1);

  if (!fromStore) {
    throw HttpError.notFound("Source store not found", "from_store_not_found");
  }

  const [toStore] = await db
    .select({ id: schema.store.id })
    .from(schema.store)
    .where(eq(schema.store.id, input.toStoreId))
    .limit(1);

  if (!toStore) {
    throw HttpError.notFound("Destination store not found", "to_store_not_found");
  }

  // Verify global item exists
  const [item] = await db
    .select()
    .from(schema.globalInventoryItems)
    .where(eq(schema.globalInventoryItems.id, input.globalItemId))
    .limit(1);

  if (!item) {
    throw HttpError.notFound("Global inventory item not found", "item_not_found");
  }

  const quantity = Math.round(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw HttpError.badRequest("Quantity must be a whole number of at least 1", "invalid_quantity");
  }

  // Refuse oversends up front: the centre can never promise what it doesn't hold.
  if (item.totalStock < quantity) {
    throw HttpError.badRequest(
      `Only ${item.totalStock} ${item.unit} of "${item.name}" in central stock`,
      "insufficient_stock",
    );
  }

  // Create the allocation (stock moves on fulfill, so a pending send reserves
  // nothing and a cancel costs nothing).
  const allocationId = newId("alloc");
  const now = new Date();
  await db.insert(schema.inventoryAllocations).values({
    id: allocationId,
    globalItemId: input.globalItemId,
    fromStoreId: input.fromStoreId,
    toStoreId: input.toStoreId,
    productId: input.productId ?? null,
    quantity,
    status: "pending",
    allocatedAt: now,
    notes: input.notes?.slice(0, 240) ?? null,
    allocatedByUserId: actor.id,
    allocatedByName: actor.name.slice(0, 120),
  });

  return {
    id: allocationId,
    globalItemId: input.globalItemId,
    fromStoreId: input.fromStoreId,
    toStoreId: input.toStoreId,
    productId: input.productId ?? null,
    quantity,
    status: "pending",
    allocatedAt: now,
    notes: input.notes ?? null,
    allocatedByUserId: actor.id,
    allocatedByName: actor.name,
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
  const effective = ([toRole, fromRole] as const).find((r) => r && SENDER_ROLES.includes(r));
  if (!toRole && !fromRole) {
    throw HttpError.forbidden("You are not a member of this delivery", "not_a_member");
  }
  if (!effective) {
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

  // Re-check central stock: another send may have drained it while pending.
  if (item.totalStock < allocation.quantity) {
    throw HttpError.badRequest(
      `Only ${item.totalStock} ${item.unit} of "${item.name}" left in central stock`,
      "insufficient_stock",
    );
  }

  // Raise the destination store's DO stock FIRST. If the product mapping is
  // wrong the allocation stays pending with a clear error and central stock
  // is untouched, so staff can fix the mapping and retry.
  const received = await storeStub(env, allocation.toStoreId).receiveCentralDelivery({
    productId: allocation.productId ?? undefined,
    globalItemName: item.name,
    quantity: allocation.quantity,
    ref: allocation.id,
    note: allocation.notes ?? `Central delivery of ${allocation.quantity} ${item.unit} ${item.name}`,
    actor: { id: actor.id, name: actor.name, email: actor.email, role: effective },
  });

  if (!received.ok) {
    const message =
      received.error === "unknown_product"
        ? `No "${item.name}" product in the destination store. Create it there first, then confirm again.`
        : received.error === "untracked_product"
          ? `The destination "${item.name}" product does not track stock. Enable tracking, then confirm again.`
          : received.error === "product_has_variants"
            ? `The destination "${item.name}" product has variants. Split it into simple items or pick the variant product first.`
            : "Invalid delivery quantity";
    const code = received.error === "unknown_product" ? "unknown_product" : "delivery_refused";
    const status = received.error === "unknown_product" ? 404 : 400;
    throw new HttpError(status, code, message);
  }

  // Central stock only moves once the branch actually received it.
  //
  // Claim the pending row first, so exactly one caller deducts: a phone that
  // timed out may retry while this call is still running, and both would
  // otherwise subtract the quantity. The DO itself is idempotent by allocation
  // id, so a retry's stock raise is a no-op.
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

  if (claimed.length > 0) {
    await db
      .update(schema.globalInventoryItems)
      .set({
        totalStock: sql`${schema.globalInventoryItems.totalStock} - ${allocation.quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.globalInventoryItems.id, allocation.globalItemId));
  }

  return { success: true, allocationId, received };
}

export async function cancelAllocation(env: Env, allocationId: string, actorUserId: string) {
  const db = createDb(env.DB);

  const [allocation] = await db
    .select({
      id: schema.inventoryAllocations.id,
      status: schema.inventoryAllocations.status,
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

  await db
    .update(schema.inventoryAllocations)
    .set({ status: "cancelled" })
    .where(eq(schema.inventoryAllocations.id, allocationId));

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
) {
  const db = createDb(env.DB);

  const [rate] = await db
    .select()
    .from(schema.inventoryConversionRates)
    .where(
      and(
        eq(schema.inventoryConversionRates.storeId, storeId),
        eq(schema.inventoryConversionRates.globalItemId, globalItemId),
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
  globalItemId: string,
  bulkQuantityUsed: number,
  portionsProduced: number,
  notes?: string,
) {
  const db = createDb(env.DB);

  const bulk = Math.round(bulkQuantityUsed);
  const portions = Math.round(portionsProduced);
  if (!Number.isFinite(bulk) || bulk < 1 || !Number.isFinite(portions) || portions < 1) {
    throw HttpError.badRequest("Quantities must be whole numbers of at least 1", "invalid_quantity");
  }

  const id = newId("conv_rec");
  await db.insert(schema.inventoryConversions).values({
    id,
    storeId,
    globalItemId,
    bulkQuantityUsed: bulk,
    portionsProduced: portions,
    convertedAt: new Date(),
    notes: notes?.slice(0, 240) ?? null,
  });

  return { id, success: true };
}

export async function listConversions(env: Env, storeId: string, limit: number = 50) {
  const db = createDb(env.DB);

  return db
    .select({
      id: schema.inventoryConversions.id,
      storeId: schema.inventoryConversions.storeId,
      globalItemId: schema.inventoryConversions.globalItemId,
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
