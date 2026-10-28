import { z } from "zod";

/** IDs minted on a device while offline. Retrying the same id is safe. */
const clientId = z
  .string()
  .min(4)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "ID must be letters, numbers, - or _");

// --- Global Inventory Items ---

export const createGlobalInventoryItemSchema = z.object({
  id: clientId.optional(),
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
  /** Client-generated idempotency key; retrying the same id is safe. */
  id: clientId.optional(),
  globalItemId: z.string().min(1, "Central item ID is required"),
  /** The source is always the caller's central store, never a branch. */
  toStoreId: z.string().min(1, "Destination store ID is required"),
  /**
   * What leaves the centre. The shop receives exactly this quantity in the
   * same unit; it is not mapped to a destination product.
   */
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
  /** Branch menu product this rate produces. */
  productId: z.string().min(1).optional(),
  portionName: z.string().min(1, "Portion name is required").max(120),
  /** Bulk units used per one menu unit (e.g. 0.2 kg of rice per plate). */
  quantityPerPortion: z.number().positive("Quantity per portion must be positive"),
});

export type UpsertConversionRateInput = z.infer<typeof upsertConversionRateSchema>;

// --- Conversions (bulk used -> portions made) ---

export const recordConversionSchema = z.object({
  /** Client-generated idempotency key; retrying the same id is safe. */
  id: clientId.optional(),
  globalItemId: z.string().min(1, "Global item ID is required"),
  productId: z.string().min(1, "Choose the menu item to add this stock to"),
  /** Bulk units being converted, in the central item's unit. */
  bulkQuantityUsed: z.number().int().min(1, "Bulk quantity must be at least 1"),
  /**
   * Bulk units one menu unit uses. Sent so an owner can set the rate while
   * converting; when omitted the saved rate is used.
   */
  portionSize: z.number().positive("Portion size must be positive").optional(),
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
