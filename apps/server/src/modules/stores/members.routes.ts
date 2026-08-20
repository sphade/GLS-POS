import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import { requirePermission } from "../../middleware/store.js";
import { listMembers, removeMember, setMemberRole } from "./stores.service.js";
import { createStaffAccount, setStaffPassword, usernameFromName } from "./staff.service.js";
import { setRoleSchema } from "./stores.schema.js";

/**
 * Staff/access management for the current store (resolved by `withStore`).
 * Reading the roster needs `staff:manage`; only an owner may change roles,
 * which `setMemberRole` also guards against demoting the owner.
 */
/** Owner types the person's name and a password; username is derived or given. */
const createStaffSchema = z.object({
  name: z.string().min(1).max(60),
  /** Optional — defaults to a handle derived from the name. */
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9._-]+$/, "letters, numbers, dot, underscore or dash only")
    .optional(),
  password: z.string().min(6, "use at least 6 characters"),
  role: z.enum(["owner", "manager", "cashier", "waiter", "kitchen"]),
});

const resetPasswordSchema = z.object({ password: z.string().min(6) });

export const members = new Hono<AppEnv>()
  .get("/", requirePermission("staff:manage"), async (c) =>
    ok(c, await listMembers(c.env, c.get("storeId"))),
  )

  /**
   * Create a staff account outright — no email, no invitation to accept. The
   * owner hands over the username and password directly.
   */
  .post(
    "/staff",
    requirePermission("staff:manage"),
    validate("json", createStaffSchema),
    async (c) => {
      const { name, username, password, role } = c.req.valid("json");

      // Only an owner may mint another owner.
      if (role === "owner" && c.get("role") !== "owner") {
        throw HttpError.forbidden("Only the owner can create another owner", "owner_only");
      }

      const created = await createStaffAccount(c.env, c.get("auth"), {
        storeId: c.get("storeId"),
        name,
        username: username ?? usernameFromName(name),
        password,
        role,
      });
      return ok(c, created, 201);
    },
  )

  /** Reset a staff password — the recovery path when there's no email. */
  .post(
    "/:userId/password",
    requirePermission("staff:manage"),
    validate("json", resetPasswordSchema),
    async (c) => {
      if (c.get("role") !== "owner") {
        throw HttpError.forbidden("Only the owner can reset passwords", "owner_only");
      }
      await setStaffPassword(c.env, c.get("auth"), {
        storeId: c.get("storeId"),
        userId: c.req.param("userId"),
        password: c.req.valid("json").password,
      });
      return ok(c, { updated: true });
    },
  )
  .post("/", requirePermission("staff:manage"), validate("json", setRoleSchema), async (c) => {
    const { email, role } = c.req.valid("json");
    return ok(c, await setMemberRole(c.env, c.get("storeId"), email, role));
  })
  .delete("/:userId", requirePermission("staff:manage"), async (c) => {
    await removeMember(c.env, c.get("storeId"), c.req.param("userId"));
    return ok(c, { removed: true });
  });
