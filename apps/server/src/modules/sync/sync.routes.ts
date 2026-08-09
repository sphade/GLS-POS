import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { syncPushSchema } from "./sync.schema.js";

/**
 * Offline-first sync endpoint. One round-trip uploads the device's dirty
 * changes and downloads everything the store has recorded since the device's
 * cursor. All conflict resolution and sequencing happen inside the store's
 * Durable Object (see `push`), so this layer just validates and delegates.
 *
 * Requires auth + a resolved store (mounted with requireAuth + withStore).
 */
export const sync = new Hono<AppEnv>()
  .post("/", validate("json", syncPushSchema), async (c) =>
    ok(c, await c.get("store").push(c.req.valid("json"))),
  )
  // Pull-only catch-up: ?cursor=N returns changes since N.
  .get("/", async (c) => {
    const cursor = Number(c.req.query("cursor") ?? "0") || 0;
    return ok(c, await c.get("store").pull(cursor));
  });
