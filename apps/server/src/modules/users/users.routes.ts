import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { updateProfileSchema } from "./users.schema.js";
import { requireAuth } from "../../middleware/auth.js";
import { HttpError } from "../../lib/http-error.js";

/**
 * User routes. For authenticated users to manage their own profile.
 * Not admin operations — users can only update their own profile.
 */
export const users = new Hono<AppEnv>()
  .use(requireAuth)
  .patch("/profile", validate("json", updateProfileSchema), async (c) => {
    const auth = c.get("auth");
    const user = c.get("user");

    if (!user?.id) {
      throw HttpError.unauthorized("User not authenticated");
    }

    const input = c.req.valid("json");

    try {
      // If password update is requested, use changePassword
      if (input.newPassword && input.oldPassword) {
        await auth.api.changePassword({
          body: {
            currentPassword: input.oldPassword,
            newPassword: input.newPassword,
          },
          headers: c.req.raw.headers,
        });
      }

      // Update email and/or name if provided
      if (input.email || input.name) {
        await auth.api.updateUser({
          body: {
            ...(input.email && { email: input.email }),
            ...(input.name && { name: input.name }),
          },
          headers: c.req.raw.headers,
        });
      }

      return ok(c, { success: true });
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(
        500,
        "internal_server_error",
        (error as Error)?.message || "Failed to update profile",
      );
    }
  });
