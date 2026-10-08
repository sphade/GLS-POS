import { and, eq, desc, gte, lte, sum, sql } from "drizzle-orm";
import type { StoreMembership, StoreRole } from "@gls-pos/types";
import type { Env } from "../../env.js";
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

export async function listAllocations(env: Env, storeId: string, status?: "pending" | "fulfilled" | "cancelled") {
  const db = createDb(env.DB);

  // Simple query without the store names - they can be added later if needed
  const query = db
    .select()
    .from(schema.inventoryAllocations);

  if (status) {
    query.where(eq(schema.inventoryAllocations.status, status));
  }

  return query.orderBy(desc(schema.inventoryAllocations.allocatedAt));
}

export async function createAllocation(
  env: Env,
  input: { globalItemId: string; fromStoreId: string; toStoreId: string; quantity: number; notes?: string },
) {
  const db = createDb(env.DB);

  // Verify the stores exist
  const [fromStore] = await db
    .select()
    .from(schema.store)
    .where(eq(schema.store.id, input.fromStoreId))
    .limit(1);

  if (!fromStore) {
    throw HttpError.notFound("Source store not found", "from_store_not_found");
  }

  const [toStore] = await db
    .select()
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

  // Create the allocation
  const allocationId = newId("alloc");
  await db.insert(schema.inventoryAllocations).values({
    id: allocationId,
    globalItemId: input.globalItemId,
    fromStoreId: input.fromStoreId,
    toStoreId: input.toStoreId,
    quantity: input.quantity,
    status: "pending",
    allocatedAt: new Date(),
    notes: input.notes ?? null,
  });

  return {
    id: allocationId,
    globalItemId: input.globalItemId,
    fromStoreId: input.fromStoreId,
    toStoreId: input.toStoreId,
    quantity: input.quantity,
    status: "pending",
    allocatedAt: new Date(),
    notes: input.notes ?? null,
  };
}

export async function fulfillAllocation(env: Env, allocationId: string, fulfilledBy: string) {
  const db = createDb(env.DB);

  const [allocation] = await db
    .select({
      id: schema.inventoryAllocations.id,
      globalItemId: schema.inventoryAllocations.globalItemId,
      fromStoreId: schema.inventoryAllocations.fromStoreId,
      toStoreId: schema.inventoryAllocations.toStoreId,
      quantity: schema.inventoryAllocations.quantity,
      status: schema.inventoryAllocations.status,
    })
    .from(schema.inventoryAllocations)
    .where(eq(schema.inventoryAllocations.id, allocationId))
    .limit(1);

  if (!allocation) {
    throw HttpError.notFound("Allocation not found", "allocation_not_found");
  }

  if (allocation.status !== "pending") {
    throw HttpError.badRequest("Allocation is not pending", "already_processed");
  }

  // Mark as fulfilled
  await db
    .update(schema.inventoryAllocations)
    .set({ status: "fulfilled", fulfilledAt: new Date() })
    .where(eq(schema.inventoryAllocations.id, allocationId));

  // Update the global inventory item's stock
  await db
    .update(schema.globalInventoryItems)
    .set({
      totalStock: sql`${schema.globalInventoryItems.totalStock} - ${allocation.quantity}`,
      updatedAt: new Date(),
    })
    .where(eq(schema.globalInventoryItems.id, allocation.globalItemId));

  // TODO: Call the store DO to add the items to the receiving store's inventory
  // This would be handled by the DO RPC method: addReceivedInventory

  return { success: true, allocationId };
}

export async function cancelAllocation(env: Env, allocationId: string) {
  const db = createDb(env.DB);

  const [allocation] = await db
    .select({
      id: schema.inventoryAllocations.id,
      status: schema.inventoryAllocations.status,
      quantity: schema.inventoryAllocations.quantity,
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

  await db
    .update(schema.inventoryAllocations)
    .set({ status: "cancelled" })
    .where(eq(schema.inventoryAllocations.id, allocationId));

  return { success: true, allocationId };
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

  const id = newId("conv_rec");
  await db.insert(schema.inventoryConversions).values({
    id,
    storeId,
    globalItemId,
    bulkQuantityUsed,
    portionsProduced,
    convertedAt: new Date(),
    notes: notes ?? null,
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
    .limit(limit);
}
