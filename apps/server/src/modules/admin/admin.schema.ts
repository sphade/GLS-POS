import { z } from "zod";

/** Create a user (admin only). */
export const createUserSchema = z.object({
  email: z.email("Invalid email address"),
  name: z.string().min(1, "name is required"),
  password: z.string().min(8, "password must be at least 8 characters"),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Update a user (admin only). */
export const updateUserSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  email: z.email("Invalid email address").optional(),
  name: z.string().min(1, "name is required").optional(),
  password: z
    .string()
    .min(8, "password must be at least 8 characters")
    .optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
