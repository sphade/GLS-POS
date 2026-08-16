import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { requirePermission } from "../../middleware/store.js";
import { listMembers, removeMember, setMemberRole } from "./stores.service.js";
import { setRoleSchema } from "./stores.schema.js";

/**
 * Staff/access management for the current store (resolved by `withStore`).
 * Reading the roster needs `staff:manage`; only an owner may change roles,
 * which `setMemberRole` also guards against demoting the owner.
 */
export const members = new Hono<AppEnv>()
  .get("/", requirePermission("staff:manage"), async (c) =>
    ok(c, await listMembers(c.env, c.get("storeId"))),
  )
  .post("/", requirePermission("staff:manage"), validate("json", setRoleSchema), async (c) => {
    const { email, role } = c.req.valid("json");
    return ok(c, await setMemberRole(c.env, c.get("storeId"), email, role));
  })
  .delete("/:userId", requirePermission("staff:manage"), async (c) => {
    await removeMember(c.env, c.get("storeId"), c.req.param("userId"));
    return ok(c, { removed: true });
  });
