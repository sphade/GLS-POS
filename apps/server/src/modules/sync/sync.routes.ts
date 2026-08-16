import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import type { PushResult } from "../../durable-objects/store.do.js";
import { syncPushSchema } from "./sync.schema.js";

/**
 * Offline-first sync endpoint. One round-trip uploads the device's dirty
 * changes and downloads everything the store has recorded since the device's
 * cursor.
 *
 * Authorisation lives in the Durable Object because it needs the stored
 * documents to apply field-level rules (e.g. a cashier may decrement stock to
 * complete a sale, but may not touch prices). A denied push applies nothing.
 *
 * Requires auth + a resolved store (mounted with requireAuth + withStore).
 */
export const sync = new Hono<AppEnv>()
  .post("/", validate("json", syncPushSchema), async (c) => {
    // Explicit annotation: the DO RPC type wrapper otherwise widens this oddly.
    const { denied, changes, cursor }: PushResult = await c
      .get("store")
      .push(c.req.valid("json"), c.get("role"));

    if (denied.length > 0) {
      throw HttpError.forbidden(
        `Your role cannot modify: ${denied.join(", ")}`,
        "insufficient_permission",
      );
    }
    return ok(c, { changes, cursor });
  })
  // Pull-only catch-up: ?cursor=N returns changes since N.
  .get("/", async (c) => {
    const cursor = Number(c.req.query("cursor") ?? "0") || 0;
    return ok(c, await c.get("store").pull(cursor));
  });
