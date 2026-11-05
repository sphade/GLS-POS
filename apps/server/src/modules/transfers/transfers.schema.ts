import { z } from "zod";

/**
 * Send one ingredient from the central store to a branch. `id` is minted by the
 * device so a retry after a dropped response is recognised, never re-sent.
 */
export const createTransferSchema = z.object({
  id: z
    .string()
    .regex(/^tx_[A-Za-z0-9_-]{6,60}$/, "Transfer id must look like tx_xxxxxx"),
  ingredientId: z.string().min(1).max(120),
  toStoreId: z.string().min(1).max(120),
  /** Whole base units (g, ml or pcs). */
  quantity: z.number().int().min(1).max(1_000_000_000),
  note: z.string().max(240).optional(),
});

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
