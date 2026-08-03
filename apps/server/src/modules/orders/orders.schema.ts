import { z } from "zod";

/** A single line requested by the client. Prices are integer minor units. */
export const orderItemInputSchema = z.object({
  productId: z.string().min(1).optional(),
  name: z.string().min(1).default("Item"),
  unitPrice: z.number().int().nonnegative().default(0),
  quantity: z.number().int().positive().default(1),
  taxRateBps: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
});

export const paymentInputSchema = z.object({
  method: z.enum(["cash", "card", "wallet", "transfer", "other"]),
  amount: z.number().int().nonnegative(),
  reference: z.string().optional(),
});

export const createOrderSchema = z.object({
  storeId: z.string().min(1).default("store_default"),
  channel: z.enum(["in_store", "phone", "delivery", "online"]).default("in_store"),
  status: z.enum(["open", "completed", "refunded", "cancelled"]).default("completed"),
  items: z.array(orderItemInputSchema).min(1, "order requires at least one item"),
  payments: z.array(paymentInputSchema).default([]),
  currency: z.string().length(3).default("USD"),
  discountTotal: z.number().int().nonnegative().default(0),
  customerId: z.string().min(1).optional(),
  staffId: z.string().min(1).optional(),
  note: z.string().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
