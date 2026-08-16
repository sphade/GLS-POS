import { Hono } from "hono";
import type { Permission, SyncCollection } from "@gls-pos/types";
import { roleCan } from "@gls-pos/types";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import { syncPushSchema } from "./sync.schema.js";

/**
 * Which permission is required to *write* each collection. Reads are allowed
 * for any member (the POS needs the full catalog to sell), but pushes are gated
 * so e.g. a cashier can't quietly rewrite prices or the staff list.
 */
const WRITE_PERMISSION: Record<SyncCollection, Permission> = {
  products: "catalog:write",
  categories: "catalog:write",
  modifiers: "catalog:write",
  ingredients: "catalog:write",
  tables: "tables:manage",
  customers: "customers:manage",
  staff: "staff:manage",
  receipts: "sale:create",
  stock_movements: "sale:create",
};

/**
 * Offline-first sync endpoint. One round-trip uploads the device's dirty
 * changes and downloads everything the store has recorded since the device's
 * cursor. Conflict resolution and sequencing happen inside the store's Durable
 * Object; this layer validates and authorises.
 *
 * Requires auth + a resolved store (mounted with requireAuth + withStore).
 */
export const sync = new Hono<AppEnv>()
  .post("/", validate("json", syncPushSchema), async (c) => {
    const role = c.get("role");
    const { changes } = c.req.valid("json");

    // Reject the whole push if it touches anything this role may not write, so
    // a partial apply can never leave the device thinking it succeeded.
    const denied = [
      ...new Set(
        changes
          .filter((ch) => !roleCan(role, WRITE_PERMISSION[ch.collection]))
          .map((ch) => ch.collection),
      ),
    ];
    if (denied.length > 0) {
      throw HttpError.forbidden(
        `Your role cannot modify: ${denied.join(", ")}`,
        "insufficient_permission",
      );
    }

    return ok(c, await c.get("store").push(c.req.valid("json")));
  })
  // Pull-only catch-up: ?cursor=N returns changes since N.
  .get("/", async (c) => {
    const cursor = Number(c.req.query("cursor") ?? "0") || 0;
    return ok(c, await c.get("store").pull(cursor));
  });
