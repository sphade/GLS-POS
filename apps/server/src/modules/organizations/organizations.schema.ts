import { z } from "zod";

/** Create a Better Auth organization for the signed-in user. */
export const createOrganizationSchema = z.object({
  name: z.string().min(1, "name is required"),
  slug: z.string().min(1, "slug is required"),
  logo: z.string().url().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Add a member to an organization. */
export const addMemberSchema = z.object({
  organizationId: z.string().min(1, "organizationId is required"),
  userId: z.string().min(1, "userId is required"),
  role: z.enum(["cashier", "owner", "manager"], {
    message: "role must be one of: owner, admin, member",
  }),
});

export type AddMemberInput = z.infer<typeof addMemberSchema>;
