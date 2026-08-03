import { createMiddleware } from "hono/factory";
import type { StoreDurableObject } from "../durable-objects/store.do.js";
import type { Env } from "../env.js";

/** Context variables set by the store middleware. */
export type StoreVariables = {
  storeId: string;
  store: DurableObjectStub<StoreDurableObject>;
};

/**
 * Resolves the target store and its Durable Object stub, then stashes both on
 * the context. The store is taken from the `x-store-id` header for now; once the
 * store registry and memberships are wired up this will also verify that the
 * authenticated user belongs to the store.
 */
export const withStore = createMiddleware<{ Bindings: Env; Variables: StoreVariables }>(
  async (c, next) => {
    const storeId = c.req.header("x-store-id") ?? "store_default";
    const stub = c.env.STORE.get(c.env.STORE.idFromName(storeId));
    c.set("storeId", storeId);
    c.set("store", stub);
    await next();
  },
);
