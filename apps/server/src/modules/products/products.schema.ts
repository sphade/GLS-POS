import { z } from "zod";

/** Validation for creating a product. Money fields are integer minor units. */
export const createProductSchema = z.object({
  storeId: z.string().min(1).default("store_default"),
  categoryId: z.string().min(1).optional(),
  name: z.string().min(1, "name is required"),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  price: z.number().int().nonnegative(),
  cost: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).default("USD"),
  stockQuantity: z.number().int().nullable().default(null),
  taxRateBps: z.number().int().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
  isActive: z.boolean().default(true),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

/** Partial update; every field optional. */
export const updateProductSchema = createProductSchema.partial();

export type UpdateProductInput = z.infer<typeof updateProductSchema>;
