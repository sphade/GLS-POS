import { z } from "zod";

/** Create a store the caller will own. */
export const createStoreSchema = z.object({
  name: z.string().min(1, "name is required"),
  currency: z.string().length(3).default("NGN"),
});

export type CreateStoreInput = z.infer<typeof createStoreSchema>;

/**
 * Business Settings. Every field is optional so the screen can save just what
 * changed; empty strings clear a field rather than storing "".
 */
const blankToNull = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .nullable()
    .optional();

export const updateStoreSchema = z.object({
  name: z.string().min(1, "name is required").max(80).optional(),
  currency: z.string().length(3).optional(),
  address: blankToNull(200),
  phone: blankToNull(40),
  receiptHeader: blankToNull(120),
  receiptFooter: blankToNull(120),
});

export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;

/** Grant or change a member's role by email. */
export const setRoleSchema = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "manager", "cashier", "waiter", "kitchen"]),
});

export type SetRoleInput = z.infer<typeof setRoleSchema>;
