import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import { requirePermission } from "../../middleware/store.js";
import { memberRole } from "./stores.service.js";
import { canReadCatalog, copyCatalog } from "./catalog.service.js";

/**
 * Menu operations that span two stores.
 *
 * Mounted behind requireAuth + withStore, so `x-store-id` names the DESTINATION
 * shop (the one the caller is currently in). The source shop is named in the
 * body and checked separately: the caller must be able to read that shop's menu
 * as well.
 */
export const copyCatalogSchema = z.object({
  fromStoreId: z.string().min(1),
});

export const catalog = new Hono<AppEnv>().post(
  "/copy",
  requirePermission("catalog:write"),
  validate("json", copyCatalogSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) throw HttpError.unauthorized();

    const toStoreId = c.get("storeId");
    const { fromStoreId } = c.req.valid("json");

    if (fromStoreId === toStoreId) {
      throw HttpError.badRequest("Choose a different shop to copy from", "same_store");
    }

    // Reading the source is its own permission: a cashier in this shop must not
    // be able to pull another shop's menu in through the back door.
    const sourceRole = await memberRole(c.env, user.id, fromStoreId);
    if (!sourceRole) {
      throw HttpError.forbidden("You are not a member of that shop", "not_a_member");
    }
    if (!canReadCatalog(sourceRole)) {
      throw HttpError.forbidden(
        "Your role cannot read that shop's menu",
        "insufficient_permission",
      );
    }

    const result = await copyCatalog(c.env, {
      fromStoreId,
      toStoreId,
      // The caller's real role in the destination. Passing "owner" here would
      // let a manager copy cost prices they cannot see.
      role: c.get("role"),
      actor: { id: user.id, name: user.name, email: user.email },
    });

    return ok(c, result);
  },
);
