import { createMiddleware } from "hono/factory";
import type { StoreDurableObject } from "../durable-objects/store.do.js";
import { HttpError } from "../lib/http-error.js";
import { isMember } from "../modules/stores/stores.service.js";
import type { Env } from "../env.js";
import type { AuthVariables } from "./auth.js";

/** Context variables set by the store middleware. */
export type StoreVariables = {
  storeId: string;
  store: DurableObjectStub<StoreDurableObject>;
};

/**
 * Resolves the target store from the `x-store-id` header, verifies the
 * authenticated user is a member of it (control-plane check against D1), then
 * stashes the store id and its Durable Object stub on the context.
 *
 * Must run after `withAuth` (needs the user) and typically alongside
 * `requireAuth`. The DO is addressed by `idFromName(storeId)` so identity is
 * stable across the fleet.
 */
export const withStore = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables & StoreVariables;
}>(async (c, next) => {
  const storeId = c.req.header("x-store-id");
  if (!storeId) throw HttpError.badRequest("x-store-id header is required", "store_required");

  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();

  if (!(await isMember(c.env, user.id, storeId))) {
    throw HttpError.forbidden("You are not a member of this store", "not_a_member");
  }

  c.set("storeId", storeId);
  c.set("store", c.env.STORE.get(c.env.STORE.idFromName(storeId)));
  await next();
});
