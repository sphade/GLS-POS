import { and, eq } from "drizzle-orm";
import type { Ingredient, IngredientUnit, StoreRole } from "@gls-pos/types";
import type { Env } from "../../env.js";
import { createDb, schema } from "../../db/index.js";
import { HttpError } from "../../lib/http-error.js";
import type { CreateTransferInput } from "./transfers.schema.js";

/** Only owners and managers of the central store may send its stock. */
const SENDER_ROLES: readonly StoreRole[] = ["owner", "manager"];

type Actor = { id: string; name: string; email?: string };

function stub(env: Env, storeId: string) {
  return env.STORE.get(env.STORE.idFromName(storeId));
}

/** The central store row, or a 409 telling the caller this is not one. */
async function requireCentral(env: Env, storeId: string) {
  const db = createDb(env.DB);
  const [central] = await db
    .select({
      id: schema.store.id,
      name: schema.store.name,
      ownerId: schema.store.ownerId,
      isCentral: schema.store.isCentral,
    })
    .from(schema.store)
    .where(eq(schema.store.id, storeId))
    .limit(1);
  if (!central?.isCentral) {
    throw new HttpError(409, "not_central_store", "Switch to the Central Store to send stock.");
  }
  return central;
}

/**
 * Send stock from the central store (the caller's selected store) to one of its
 * branches. D1 answers only "is this branch under this centre"; the stock check
 * and deduction happen inside the central store's Durable Object.
 */
export async function createTransfer(
  env: Env,
  centralStoreId: string,
  role: StoreRole,
  input: CreateTransferInput,
  actor: Actor,
) {
  if (!SENDER_ROLES.includes(role)) {
    throw HttpError.forbidden("Only owners and managers can send stock", "sender_role_required");
  }
  const central = await requireCentral(env, centralStoreId);

  const db = createDb(env.DB);
  const [branch] = await db
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
  if (!branch) throw HttpError.notFound("Branch not found", "to_store_not_found");
  if (branch.isCentral || branch.parentStoreId !== central.id || branch.ownerId !== central.ownerId) {
    throw HttpError.forbidden("That shop is not a branch of this Central Store", "not_in_tree");
  }

  const result = await stub(env, central.id).dispatchTransfer({
    id: input.id,
    ingredientId: input.ingredientId,
    quantity: input.quantity,
    fromStoreId: central.id,
    fromStoreName: central.name,
    toStoreId: branch.id,
    toStoreName: branch.name,
    note: input.note,
    actor: { id: actor.id, name: actor.name, email: actor.email },
  });

  if (!result.ok) {
    if (result.error === "unknown_ingredient") {
      throw HttpError.notFound("That item is not in central stock", "item_not_found");
    }
    if (result.error === "insufficient_stock") {
      throw HttpError.badRequest(
        `Only ${result.available ?? 0} left in central stock`,
        "insufficient_stock",
      );
    }
    throw HttpError.badRequest("Quantity must be a whole number of at least 1", "invalid_quantity");
  }
  return result;
}

/** Branches the central store can send to, for the destination picker. */
export async function listBranches(env: Env, centralStoreId: string) {
  const central = await requireCentral(env, centralStoreId);
  const db = createDb(env.DB);
  return db
    .select({ id: schema.store.id, name: schema.store.name })
    .from(schema.store)
    .where(and(eq(schema.store.parentStoreId, central.id), eq(schema.store.isCentral, false)))
    .orderBy(schema.store.name);
}

/** Free-text legacy units -> base unit and the factor to whole base units. */
function legacyUnit(unit: string): { unit: IngredientUnit; scale: number } {
  const u = unit.toLowerCase().trim();
  if (u === "kg" || u.startsWith("kilo")) return { unit: "g", scale: 1000 };
  if (u === "g" || u.startsWith("gram")) return { unit: "g", scale: 1 };
  if (u === "l" || u.startsWith("lit")) return { unit: "ml", scale: 1000 };
  if (u === "ml") return { unit: "ml", scale: 1 };
  return { unit: "pcs", scale: 1 };
}

/**
 * One-off move of the old D1 central stock into the Durable Objects.
 *
 *  - Each central item becomes an ingredient in the central store's DO with
 *    its D1 balance as an opening movement.
 *  - Each branch's Stock Room balance (delivered minus converted) becomes an
 *    opening movement on that branch's copy of the item.
 *
 * The old tables are only read. Every import is keyed by the legacy id, so
 * running this twice adds nothing.
 */
export async function importLegacyCentralStock(
  env: Env,
  centralStoreId: string,
  role: StoreRole,
  actor: Actor,
) {
  if (role !== "owner") {
    throw HttpError.forbidden("Only the owner can move the old central stock", "owner_required");
  }
  const central = await requireCentral(env, centralStoreId);
  const db = createDb(env.DB);
  const items = await db
    .select()
    .from(schema.globalInventoryItems)
    .where(eq(schema.globalInventoryItems.ownerId, central.ownerId));

  const report: { item: string; central: number; branches: Record<string, number> }[] = [];
  for (const item of items) {
    const { unit, scale } = legacyUnit(item.unit);
    const ingredient: Ingredient = {
      id: `ing_legacy_${item.id}`,
      name: item.name,
      unit,
      stock: 0,
      lowAt: Math.max(0, Math.round(item.minStock * scale)),
    };
    const centralQty = Math.max(0, Math.round(item.totalStock * scale));
    await stub(env, central.id).importLegacyStock({ ingredient, quantity: centralQty, actor });

    const allocations = await db
      .select({ toStoreId: schema.inventoryAllocations.toStoreId, quantity: schema.inventoryAllocations.quantity })
      .from(schema.inventoryAllocations)
      .where(
        and(
          eq(schema.inventoryAllocations.globalItemId, item.id),
          eq(schema.inventoryAllocations.status, "fulfilled"),
        ),
      );
    const conversions = await db
      .select({
        storeId: schema.inventoryConversions.storeId,
        used: schema.inventoryConversions.bulkQuantityUsed,
      })
      .from(schema.inventoryConversions)
      .where(eq(schema.inventoryConversions.globalItemId, item.id));

    const balance = new Map<string, number>();
    for (const a of allocations) balance.set(a.toStoreId, (balance.get(a.toStoreId) ?? 0) + a.quantity);
    for (const c of conversions) balance.set(c.storeId, (balance.get(c.storeId) ?? 0) - c.used);

    const branches: Record<string, number> = {};
    for (const [storeId, qty] of balance) {
      const amount = Math.max(0, Math.round(qty * scale));
      branches[storeId] = amount;
      await stub(env, storeId).importLegacyStock({
        ingredient: {
          ...ingredient,
          id: `ing_c_${ingredient.id}`,
          lowAt: 0,
          sourceIngredientId: ingredient.id,
          sourceStoreId: central.id,
        },
        quantity: amount,
        actor,
      });
    }
    report.push({ item: item.name, central: centralQty, branches });
  }
  return { imported: report.length, items: report };
}
