import { Hono } from "hono";
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
  getConversionRate,
  upsertConversionRate,
  listConversionRates,
  recordConversion,
  listConversions,
  listStoresForUser,
} from "./inventory.service.js";
import { createGlobalInventoryItemSchema, updateGlobalInventoryItemSchema, createAllocationSchema } from "./inventory.schema.js";

/**
 * Centralized inventory distribution management routes.
 * 
 * Endpoints:
 * - /inventory - Global inventory items (CRUD)
 * - /inventory/allocations - Allocations between stores
 * - /inventory/conversion-rates - Store-level conversion rates
 * - /inventory/conversions - Track bulk-to-portions conversions
 */

export const inventory = new Hono<AppEnv>();

// --- Global Inventory Items ---

inventory.get("/", async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const items = await listGlobalInventoryItems(c.env);
  return ok(c, items);
});

inventory.post("/", validate("json", createGlobalInventoryItemSchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const stores = await listStoresForUser(c.env, user.id);
  
  if (stores.length === 0) {
    throw HttpError.forbidden("You do not have access to any stores", "no_stores");
  }

  const item = await createGlobalInventoryItem(c.env, c.req.valid("json"));
  return ok(c, item, 201);
});

inventory.put("/:id", validate("json", updateGlobalInventoryItemSchema), async (c) => {
  const itemId = c.req.param("id");
  const item = await updateGlobalInventoryItem(c.env, itemId, c.req.valid("json"));
  return ok(c, item);
});

inventory.delete("/:id", async (c) => {
  const itemId = c.req.param("id");
  await deleteGlobalInventoryItem(c.env, itemId);
  return ok(c, { message: "Item deleted" });
});

// --- Allocations ---

inventory.get("/allocations", async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const stores = await listStoresForUser(c.env, user.id);
  
  if (stores.length === 0) {
    throw HttpError.forbidden("You do not have access to any stores", "no_stores");
  }

  const firstStore = stores[0];
  if (!firstStore) {
    throw HttpError.forbidden("You do not have access to any stores", "no_stores");
  }

  const allocations = await listAllocations(c.env, firstStore.id);
  return ok(c, allocations);
});

inventory.post("/allocations", validate("json", createAllocationSchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const allocation = await createAllocation(c.env, c.req.valid("json"));
  return ok(c, allocation, 201);
});

inventory.post("/allocations/:id/fulfill", async (c) => {
  const allocationId = c.req.param("id");
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const fulfillment = await fulfillAllocation(c.env, allocationId, user.id);
  return ok(c, fulfillment);
});

inventory.post("/allocations/:id/cancel", async (c) => {
  const allocationId = c.req.param("id");
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const cancellation = await cancelAllocation(c.env, allocationId);
  return ok(c, cancellation);
});

// --- Conversion Rates ---

inventory.get("/conversion-rates", async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const stores = await listStoresForUser(c.env, user.id);
  
  if (stores.length === 0) {
    throw HttpError.forbidden("You do not have access to any stores", "no_stores");
  }

  const firstStore = stores[0];
  if (!firstStore) {
    throw HttpError.forbidden("You do not have access to any stores", "no_stores");
  }

  const rates = await listConversionRates(c.env, firstStore.id);
  return ok(c, rates);
});

inventory.post("/conversion-rates", async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const stores = await listStoresForUser(c.env, user.id);
  
  if (stores.length === 0) {
    throw HttpError.forbidden("You do not have access to any stores", "no_stores");
  }

  const firstStore = stores[0];
  if (!firstStore) {
    throw HttpError.forbidden("You do not have access to any stores", "no_stores");
  }

  const body = await c.req.json();
  const { globalItemId, portionName, quantityPerPortion } = body;

  if (!globalItemId || !portionName || quantityPerPortion === undefined) {
    throw HttpError.badRequest("Missing required fields: globalItemId, portionName, quantityPerPortion", "missing_fields");
  }

  const rate = await upsertConversionRate(c.env, firstStore.id, globalItemId, portionName, quantityPerPortion);
  return ok(c, rate, 201);
});

// --- Conversions (bulk to portions) ---

inventory.post("/conversions", async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const stores = await listStoresForUser(c.env, user.id);
  
  if (stores.length === 0) {
    throw HttpError.forbidden("You do not have access to any stores", "no_stores");
  }

  const firstStore = stores[0];
  if (!firstStore) {
    throw HttpError.forbidden("You do not have access to any stores", "no_stores");
  }

  const body = await c.req.json();
  const { globalItemId, bulkQuantityUsed, portionsProduced, notes } = body;

  if (!globalItemId || bulkQuantityUsed === undefined || portionsProduced === undefined) {
    throw HttpError.badRequest("Missing required fields: globalItemId, bulkQuantityUsed, portionsProduced", "missing_fields");
  }

  const conversion = await recordConversion(c.env, firstStore.id, globalItemId, bulkQuantityUsed, portionsProduced, notes);
  return ok(c, conversion, 201);
});

inventory.get("/conversions", async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const stores = await listStoresForUser(c.env, user.id);
  
  if (stores.length === 0) {
    throw HttpError.forbidden("You do not have access to any stores", "no_stores");
  }

  const firstStore = stores[0];
  if (!firstStore) {
    throw HttpError.forbidden("You do not have access to any stores", "no_stores");
  }

  const limit = parseInt(c.req.query("limit") || "50");
  const conversions = await listConversions(c.env, firstStore.id, limit);
  return ok(c, conversions);
});
