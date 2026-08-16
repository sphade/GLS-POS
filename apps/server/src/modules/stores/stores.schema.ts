import { z } from "zod";

/** Create a store the caller will own. */
export const createStoreSchema = z.object({
  name: z.string().min(1, "name is required"),
  currency: z.string().length(3).default("NGN"),
});

export type CreateStoreInput = z.infer<typeof createStoreSchema>;

/** Grant or change a member's role by email. */
export const setRoleSchema = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "manager", "cashier", "waiter", "kitchen"]),
});

export type SetRoleInput = z.infer<typeof setRoleSchema>;
