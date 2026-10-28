import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import {
  createGlobalInventoryItem,
  listGlobalInventoryItems,
  updateGlobalInventoryItem,
  deleteGlobalInventoryItem,
  listAllocations,
  createAllocation,
  fulfillAllocation,
  cancelAllocation,
  listStoreProducts,
  upsertConversionRate,
  listConversionRates,
  recordConversion,
  listConversions,
  listProductionRules,
  upsertProductionRule,
  deleteProductionRule,
  produceStock,
  listStoresForUser,
  requireCentralSender,
  requireMembership,
  requireInventoryAdjust,
} from "./inventory.service.js";
import {
  createGlobalInventoryItemSchema,
  updateGlobalInventoryItemSchema,
  createAllocationSchema,
  listAllocationsQuerySchema,
  upsertConversionRateSchema,
  recordConversionSchema,
  upsertProductionRuleSchema,
  produceStockSchema,
} from "./inventory.schema.js";

/**
 * Centralized inventory distribution management routes.
 *
 * The central store owns the bulk items in `global_inventory_items`. A
 * transfer deducts the centre at dispatch, writes an `inventory_allocations`
 * row, and raises the branch's Durable Object stock when the branch confirms.
 *
 * Endpoints:
 * - /inventory - Central-store items (CRUD, central owner/manager only)
 * - /inventory/allocations - Central -> branch transfers (send + confirm)
 * - /inventory/store-products - Destination catalog for the Send picker
 * - /inventory/conversion-rates - Store-level conversion rates
 * - /inventory/conversions - Track bulk-to-portions conversions
 * - /inventory/production-rules - Owner-defined branch yield rules
 * - /inventory/produce - Run one batch (consume input, add output)
 */

export const inventory = new Hono<AppEnv>();

const storeIdQuerySchema = z.object({ storeId: z.string().min(1) });

// --- Global Inventory Items ---

inventory.get("/", async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const { central } = await requireCentralSender(c.env, user.id);
  const items = await listGlobalInventoryItems(c.env, central);
  return ok(c, items);
});

inventory.post("/", validate("json", createGlobalInventoryItemSchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const { central } = await requireCentralSender(c.env, user.id);

  const item = await createGlobalInventoryItem(c.env, central, c.req.valid("json"));
  return ok(c, item, 201);
});

inventory.put("/:id", validate("json", updateGlobalInventoryItemSchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const { central } = await requireCentralSender(c.env, user.id);
  const itemId = c.req.param("id");
  const item = await updateGlobalInventoryItem(c.env, central, itemId, c.req.valid("json"));
  return ok(c, item);
});

inventory.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const { central } = await requireCentralSender(c.env, user.id);
  const itemId = c.req.param("id");
  await deleteGlobalInventoryItem(c.env, central, itemId);
  return ok(c, { message: "Item deleted" });
});

// --- Allocations ---

inventory.get("/allocations", validate("query", listAllocationsQuerySchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const query = c.req.valid("query");

  if (query.toStoreId) await requireMembership(c.env, user.id, query.toStoreId);
  if (query.fromStoreId) await requireMembership(c.env, user.id, query.fromStoreId);

  const memberStoreIds =
    query.toStoreId || query.fromStoreId
      ? undefined
      : (await listStoresForUser(c.env, user.id)).map((s) => s.id);

  const allocations = await listAllocations(c.env, { ...query, memberStoreIds });
  return ok(c, allocations);
});

inventory.post("/allocations", validate("json", createAllocationSchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const allocation = await createAllocation(c.env, c.req.valid("json"), {
    id: user.id,
    name: user.name,
    email: user.email,
  });
  return ok(c, allocation, 201);
});

inventory.post("/allocations/:id/fulfill", async (c) => {
  const allocationId = c.req.param("id");
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const fulfillment = await fulfillAllocation(c.env, allocationId, {
    id: user.id,
    name: user.name,
    email: user.email,
  });
  return ok(c, fulfillment);
});

inventory.post("/allocations/:id/cancel", async (c) => {
  const allocationId = c.req.param("id");
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const cancellation = await cancelAllocation(c.env, allocationId, user.id);
  return ok(c, cancellation);
});

// --- Destination catalog for the Send-to-store picker ---

inventory.get("/store-products", validate("query", storeIdQuerySchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const { storeId } = c.req.valid("query");
  await requireMembership(c.env, user.id, storeId);
  return ok(c, await listStoreProducts(c.env, storeId));
});

// --- Conversion Rates ---

async function resolveRateStoreId(c: Context<AppEnv>): Promise<string> {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const storeId = c.req.query("storeId");
  if (storeId) {
    await requireMembership(c.env, user.id, storeId);
    return storeId;
  }
  const stores = await listStoresForUser(c.env, user.id);
  if (stores.length === 0) {
    throw HttpError.forbidden("You do not have access to any stores", "no_stores");
  }
  const firstStore = stores[0];
  if (!firstStore) {
    throw HttpError.forbidden("You do not have access to any stores", "no_stores");
  }
  return firstStore.id;
}

inventory.get("/conversion-rates", async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const storeId = await resolveRateStoreId(c);
  const rates = await listConversionRates(c.env, storeId);
  return ok(c, rates);
});

inventory.post("/conversion-rates", validate("json", upsertConversionRateSchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const storeId = await resolveRateStoreId(c);
  await requireInventoryAdjust(c.env, user.id, storeId);

  const { globalItemId, productId, portionName, quantityPerPortion } = c.req.valid("json");
  const rate = await upsertConversionRate(
    c.env,
    storeId,
    globalItemId,
    productId,
    portionName,
    quantityPerPortion,
  );
  return ok(c, rate, 201);
});

// --- Conversions (bulk to portions) ---

inventory.post("/conversions", validate("json", recordConversionSchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const storeId = await resolveRateStoreId(c);
  await requireInventoryAdjust(c.env, user.id, storeId);

  const conversion = await recordConversion(c.env, storeId, c.req.valid("json"), {
    id: user.id,
    name: user.name,
    email: user.email,
  });
  return ok(c, conversion, 201);
});

inventory.get("/conversions", async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const storeId = await resolveRateStoreId(c);

  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10) || 50, 1), 100);
  const conversions = await listConversions(c.env, storeId, limit);
  return ok(c, conversions);
});

// --- Production (branch product -> branch product) ---

inventory.get("/production-rules", validate("query", storeIdQuerySchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const { storeId } = c.req.valid("query");
  await requireMembership(c.env, user.id, storeId);
  return ok(c, await listProductionRules(c.env, storeId));
});

inventory.post("/production-rules", validate("json", upsertProductionRuleSchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const { storeId, ...rule } = c.req.valid("json");
  await requireInventoryAdjust(c.env, user.id, storeId);
  return ok(c, await upsertProductionRule(c.env, storeId, rule), 201);
});

inventory.delete("/production-rules/:id", validate("query", storeIdQuerySchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const { storeId } = c.req.valid("query");
  await requireInventoryAdjust(c.env, user.id, storeId);
  return ok(c, await deleteProductionRule(c.env, storeId, c.req.param("id")));
});

inventory.post("/produce", validate("json", produceStockSchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const { storeId, ruleId, inputQty, outputQty, ref, note } = c.req.valid("json");
  await requireInventoryAdjust(c.env, user.id, storeId);
  return ok(
    c,
    await produceStock(
      c.env,
      storeId,
      { ruleId, inputQty, outputQty, ref, note },
      { id: user.id, name: user.name, email: user.email },
    ),
    201,
  );
});
