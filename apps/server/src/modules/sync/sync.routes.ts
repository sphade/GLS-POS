import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import type { PushResult } from "../../durable-objects/store.do.js";
import { syncPullQuerySchema, syncPushSchema, syncRecentQuerySchema } from "./sync.schema.js";
import { afterSync } from "../channels/channels.service.js";

/**
 * How far the device's clock is behind (+) or ahead (−) of the server, from the
 * `x-device-time` header newer builds send. Undefined for older builds.
 */
function deviceClockSkew(header: string | undefined): number | undefined {
  const deviceTime = Number(header);
  if (!header || !Number.isFinite(deviceTime) || deviceTime <= 0) return undefined;
  return Date.now() - deviceTime;
}

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
    const user = c.get("user");
    if (!user) throw HttpError.unauthorized();

    // Absent or unparseable header means an older build, which expects the
    // all-or-nothing 403. Only devices that announce v2 get partial application
    // plus per-row `deniedIds`, so the server can be deployed ahead of the fleet.
    const protocol = Number.parseInt(c.req.header("x-sync-protocol") ?? "", 10);
    const partial = Number.isFinite(protocol) && protocol >= 2;

    // Explicit annotation: the DO RPC type wrapper otherwise widens this oddly.
    const { denied, deniedIds, changes, cursor, head }: PushResult = await c
      .get("store")
      .push(
        c.req.valid("json"),
        c.get("role"),
        {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        { partial, deviceClockSkewMs: deviceClockSkew(c.req.header("x-device-time")) },
      );

    // Keep linked delivery-app listings in step with stock. Background only:
    // a sale never waits on Azumi, and a failure retries on the next sync.
    const collections = [...new Set(c.req.valid("json").changes.map((ch) => ch.collection))];
    if (collections.length > 0) {
      c.executionCtx.waitUntil(
        afterSync(c.env, c.get("storeId"), collections).catch(() => undefined),
      );
    }

    if (denied.length > 0) {
      throw HttpError.forbidden(
        `Your role cannot modify: ${denied.join(", ")}`,
        "insufficient_permission",
      );
    }
    return ok(c, { changes, cursor, head, deniedIds });
  })
  // Pull-only catch-up: ?cursor=N returns changes since N.
  .get("/", validate("query", syncPullQuerySchema), async (c) => {
    const { cursor } = c.req.valid("query");
    return ok(c, await c.get("store").pull(cursor, c.get("role")));
  })
  /**
   * First-sync reference page: the shop's description (menu, categories, tables,
   * staff, customers, modifiers, ingredients, held orders) without its trading
   * history. A new till loads this first so it is usable in seconds; the normal
   * replay still follows and remains authoritative.
   */
  .get("/reference", validate("query", syncPullQuerySchema), async (c) => {
    const { cursor } = c.req.valid("query");
    return ok(c, await c.get("store").pullReference(cursor, c.get("role")));
  })
  /**
   * First-sync recent trading, newest first: today's receipts and returns before
   * the years of history behind them. `before=0` starts at the head; the reply's
   * `cursor` is the next lower bound, and 0 means the pass is exhausted.
   */
  .get("/recent", validate("query", syncRecentQuerySchema), async (c) => {
    const { before } = c.req.valid("query");
    return ok(c, await c.get("store").pullRecent(before, c.get("role")));
  });
