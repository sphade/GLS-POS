import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import { getStoreProfile, updateStoreProfile } from "./stores.service.js";
import { updateStoreSchema } from "./stores.schema.js";

/**
 * Business Settings for the current store (resolved by `withStore`).
 *
 * Reading is open to any member — the receipt header, address and phone are
 * printed on every receipt, so a cashier's device needs them. Writing is
 * owner-only: this is the business's identity, not a per-shift preference.
 */
export const business = new Hono<AppEnv>()
  .get("/", async (c) => ok(c, await getStoreProfile(c.env, c.get("storeId"))))
  .patch("/", validate("json", updateStoreSchema), async (c) => {
    if (c.get("role") !== "owner") {
      throw HttpError.forbidden("Only the owner can change business settings", "owner_only");
    }
    return ok(c, await updateStoreProfile(c.env, c.get("storeId"), c.req.valid("json")));
  });
