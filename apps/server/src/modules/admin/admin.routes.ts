import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import { createUserSchema, updateUserSchema } from "./admin.schema.js";
import { requireAuth } from "../../middleware/auth.js";
import { isAdmin, requireAdmin } from "../../middleware/admin.js";

/**
 * Admin routes. Mounted behind requireAuth + requireAdmin, so only admins
 * can access these endpoints.
 */
export const admin = new Hono<AppEnv>()
  .use(requireAuth)
  .use(isAdmin)
  .use(requireAdmin)
  .post("/users", validate("json", createUserSchema), async (c) => {
    const auth = c.get("auth");
    const input = c.req.valid("json");

    const user = await auth.api.createUser({
      body: {
        email: input.email,
        name: input.name,
        password: input.password,
      },
      headers: c.req.raw.headers,
    });

    return ok(c, user, 201);
  })
  .patch("/users/:userId", validate("json", updateUserSchema), async (c) => {
    const auth = c.get("auth");
    const userId = c.req.param("userId");
    const input = c.req.valid("json");

    // If password is included, use setUserPassword
    if (input.password) {
      await auth.api.setUserPassword({
        body: {
          userId,
          newPassword: input.password,
        },
        headers: c.req.raw.headers,
      });
    }

    // Update other fields if provided
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
  })
  .delete("/users/:userId", async (c) => {
    const auth = c.get("auth");
    const userId = c.req.param("userId");

    if (!userId) {
      throw HttpError.badRequest("userId is required");
    }

    try {
      // Better Auth's admin API provides a removeUser method
      await auth.api.removeUser({
        body: {
          userId,
        },
        headers: c.req.raw.headers,
      });

      return ok(c, { success: true });
    } catch (error) {
      throw HttpError.conflict(
        (error as Error)?.message || "Failed to delete user",
      );
    }
  });
