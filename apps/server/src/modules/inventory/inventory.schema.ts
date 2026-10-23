import { z } from "zod";

// --- Global Inventory Items ---

export const createGlobalInventoryItemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  unit: z.enum(["kg", "liters", "pieces", "bags", "boxes", "cans"]).default("kg"),
  totalStock: z.number().int().min(0).optional(),
  minStock: z.number().int().min(0).optional(),
  description: z.string().optional(),
});

export const updateGlobalInventoryItemSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  unit: z.enum(["kg", "liters", "pieces", "bags", "boxes", "cans"]).optional(),
  totalStock: z.number().int().min(0).optional(),
  minStock: z.number().int().min(0).optional(),
  description: z.string().optional(),
});

export type CreateGlobalInventoryItemInput = z.infer<typeof createGlobalInventoryItemSchema>;
export type UpdateGlobalInventoryItemInput = z.infer<typeof updateGlobalInventoryItemSchema>;

// --- Allocations ---

export const createAllocationSchema = z.object({
  globalItemId: z.string().min(1, "Central item ID is required"),
  /** The source is always the caller's central store, never a branch. */
  toStoreId: z.string().min(1, "Destination store ID is required"),
  /**
   * Destination product in the receiving store. Optional for backwards
   * compatibility: when omitted the server matches by global-item name on
   * fulfill and refuses with a clear error if nothing matches.
   */
  productId: z.string().min(1).optional(),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  notes: z.string().max(240).optional(),
});

export type CreateAllocationInput = z.infer<typeof createAllocationSchema>;

export const listAllocationsQuerySchema = z.object({
  toStoreId: z.string().min(1).optional(),
  fromStoreId: z.string().min(1).optional(),
  status: z.enum(["pending", "fulfilled", "cancelled"]).optional(),
});

export type ListAllocationsQuery = z.infer<typeof listAllocationsQuerySchema>;

// --- Conversion rates (bulk -> portion) ---

export const upsertConversionRateSchema = z.object({
  globalItemId: z.string().min(1, "Global item ID is required"),
  portionName: z.string().min(1, "Portion name is required").max(120),
  /** Base units of bulk stock per portion (e.g. grams when the unit is kg). */
  quantityPerPortion: z.number().positive("Quantity per portion must be positive"),
});

export type UpsertConversionRateInput = z.infer<typeof upsertConversionRateSchema>;

// --- Conversions (bulk used -> portions made) ---

export const recordConversionSchema = z.object({
  globalItemId: z.string().min(1, "Global item ID is required"),
  bulkQuantityUsed: z.number().int().min(1, "Bulk quantity must be at least 1"),
  portionsProduced: z.number().int().min(1, "Portions must be at least 1"),
  notes: z.string().max(240).optional(),
});

export type RecordConversionInput = z.infer<typeof recordConversionSchema>;

// --- Production rules (branch product -> branch product) ---

export const upsertProductionRuleSchema = z.object({
  storeId: z.string().min(1, "Store ID is required"),
  inputProductId: z.string().min(1, "Product used is required"),
  outputProductId: z.string().min(1, "Product made is required"),
  inputQty: z.number().int().min(1, "Quantity used must be at least 1"),
  outputQty: z.number().int().min(1, "Quantity made must be at least 1"),
});

export type UpsertProductionRuleInput = z.infer<typeof upsertProductionRuleSchema>;

export const produceStockSchema = z.object({
  storeId: z.string().min(1, "Store ID is required"),
  ruleId: z.string().min(1, "Production rule is required"),
  inputQty: z.number().int().min(1, "Quantity used must be at least 1"),
  outputQty: z.number().int().min(1, "Quantity made must be at least 1"),
  /** Client-generated idempotency key; repeating it must not produce twice. */
  ref: z
    .string()
    .min(4)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Reference must be letters, numbers, - or _"),
  note: z.string().max(240).optional(),
});

export type ProduceStockInput = z.infer<typeof produceStockSchema>;
