import { createMiddleware } from "hono/factory";
import { HttpError } from "../lib/http-error.js";
import type { AuthVariables } from "./auth.js";

/** Context variables set by the admin middleware. */
export type AdminVariables = {
  isAdmin: boolean;
};

/**
 * Checks if the authenticated user is an admin.
 * Sets the `isAdmin` context variable. Non-blocking: passes through regardless.
 *
 * Must run after `withAuth`.
 */
export const isAdmin = createMiddleware<{
  Variables: AuthVariables & AdminVariables;
}>(async (c, next) => {
  const user = c.get("user");
  const userIsAdmin = user?.role === "admin";
  c.set("isAdmin", userIsAdmin);
  await next();
});

/**
 * Guard for admin-only routes. Returns 401 if the user is not an admin.
 * Must run after `isAdmin`.
 */
export const requireAdmin = createMiddleware<{ Variables: AdminVariables }>(
  async (c, next) => {
    if (!c.get("isAdmin")) {
      throw HttpError.unauthorized("Admin access required");
    }
    await next();
  },
);
