import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import { createStore, ensureCentralStore, listStoresForUser } from "./stores.service.js";
import { createStoreSchema, ensureCentralStoreSchema } from "./stores.schema.js";

/**
 * Store registry routes (control plane). Mounted behind requireAuth, so
 * `c.get("user")` is always present here.
 */
export const stores = new Hono<AppEnv>()
  .get("/", async (c) => {
    const user = c.get("user");
    if (!user) throw HttpError.unauthorized();
    return ok(c, await listStoresForUser(c.env, user.id));
  })
  .post("/", validate("json", createStoreSchema), async (c) => {
    const user = c.get("user");
    if (!user) throw HttpError.unauthorized();
    return ok(c, await createStore(c.env, user.id, c.req.valid("json")), 201);
  })
  .post("/central", validate("json", ensureCentralStoreSchema), async (c) => {
    const user = c.get("user");
    if (!user) throw HttpError.unauthorized();
    return ok(c, await ensureCentralStore(c.env, user.id, c.req.valid("json")));
  });
