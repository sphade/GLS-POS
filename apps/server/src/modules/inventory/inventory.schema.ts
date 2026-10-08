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
  globalItemId: z.string().min(1, "Global item ID is required"),
  fromStoreId: z.string().min(1, "Source store ID is required"),
  toStoreId: z.string().min(1, "Destination store ID is required"),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  notes: z.string().optional(),
});

export type CreateAllocationInput = z.infer<typeof createAllocationSchema>;
