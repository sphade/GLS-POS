import { z } from "zod";

/** Update the authenticated user's profile. */
export const updateProfileSchema = z
  .object({
    email: z.email("Invalid email address").optional(),
    name: z.string().min(1, "name is required").optional(),
    oldPassword: z
      .string()
      .min(8, "password must be at least 8 characters")
      .optional(),
    newPassword: z
      .string()
      .min(8, "password must be at least 8 characters")
      .optional(),
  })
  .refine(
    (data) => {
      // If newPassword is provided, oldPassword is required
      if (data.newPassword && !data.oldPassword) {
        return false;
      }
      return true;
    },
    {
      message: "oldPassword is required when updating password",
      path: ["oldPassword"],
    },
  );

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
