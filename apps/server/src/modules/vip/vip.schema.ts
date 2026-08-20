import { z } from "zod";

/**
 * Guest order payload. Notice there are no prices: the guest sends product ids
 * and quantities only, and the Durable Object resolves cost from the catalog.
 * That makes it impossible to order a ₦13,000 pizza for ₦1.
 */
export const placeWebOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        variantId: z.string().min(1).max(64).optional(),
        quantity: z.number().int().positive().max(99),
        note: z.string().max(140).optional(),
      }),
    )
    .min(1, "your order is empty")
    .max(50, "too many items"),
  guestName: z.string().max(60).optional(),
  guestPhone: z.string().max(24).optional(),
  note: z.string().max(200).optional(),
});

export type PlaceWebOrderInput = z.infer<typeof placeWebOrderSchema>;
