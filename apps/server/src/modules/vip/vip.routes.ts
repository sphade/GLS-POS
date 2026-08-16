import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../../env.js";
import { createDb, schema } from "../../db/index.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import { placeWebOrderSchema } from "./vip.schema.js";
import { renderVipPage } from "./vip.page.js";
import { notifyStore } from "../push/push.service.js";

/**
 * VIP guest ordering — the only PUBLIC part of the API.
 *
 * A guest scans the QR code on their table, which opens
 * `/vip/<storeId>/<tableId>`. No login: possession of the table's URL is the
 * credential, which is appropriate because the QR lives on the physical table.
 *
 * Security posture, given this is unauthenticated:
 *  - Read surface is narrow: menu names/prices only (no costs, no stock counts).
 *  - Writes can only create a `web_orders` document for that one table.
 *  - All money is computed server-side from the store's own catalog.
 *  - Payload size and quantities are capped by the zod schema.
 *
 * NOTE: there is no rate limiting yet. Anyone with a table URL could spam
 * orders, so staff can cancel, and a Cloudflare rate-limit rule (or Turnstile)
 * should be added before this is exposed to the public.
 */
export const vip = new Hono<{ Bindings: Env }>();

/** Resolve a store from the control plane without requiring a session. */
async function lookupStore(env: Env, storeId: string) {
  const db = createDb(env.DB);
  const [row] = await db
    .select({ id: schema.store.id, name: schema.store.name, currency: schema.store.currency })
    .from(schema.store)
    .where(eq(schema.store.id, storeId))
    .limit(1);
  return row ?? null;
}

const stubFor = (env: Env, storeId: string) => env.STORE.get(env.STORE.idFromName(storeId));

/** The guest-facing page itself. */
vip.get("/:storeId/:tableId", async (c) => {
  const { storeId, tableId } = c.req.param();
  const store = await lookupStore(c.env, storeId);
  if (!store) return c.html(renderVipPage({ error: "This link is not valid." }), 404);

  const menu = await stubFor(c.env, storeId).publicMenu(tableId, store.name, store.currency);
  if (!menu) {
    return c.html(renderVipPage({ error: "That table could not be found." }), 404);
  }
  return c.html(renderVipPage({ menu, storeId, tableId }));
});

/** Menu as JSON (used by the page, handy for testing). */
vip.get("/api/:storeId/:tableId/menu", async (c) => {
  const { storeId, tableId } = c.req.param();
  const store = await lookupStore(c.env, storeId);
  if (!store) throw HttpError.notFound("Store not found", "store_not_found");

  const menu = await stubFor(c.env, storeId).publicMenu(tableId, store.name, store.currency);
  if (!menu) throw HttpError.notFound("Table not found", "table_not_found");
  return ok(c, menu);
});

/** Place the order. Totals are resolved inside the Durable Object. */
vip.post(
  "/api/:storeId/:tableId/order",
  validate("json", placeWebOrderSchema),
  async (c) => {
    const { storeId, tableId } = c.req.param();
    const store = await lookupStore(c.env, storeId);
    if (!store) throw HttpError.notFound("Store not found", "store_not_found");

    const result = await stubFor(c.env, storeId).placeWebOrder(
      tableId,
      c.req.valid("json"),
      store.currency,
    );

    if (!result.ok) {
      if (result.error === "unknown_table") {
        throw HttpError.notFound("Table not found", "table_not_found");
      }
      if (result.error === "rate_limited") {
        throw new HttpError(429, "rate_limited", "Too many orders just now — please wait a moment.");
      }
      throw HttpError.badRequest("None of those items are available right now", result.error);
    }
    // Alert staff phones even if the app is closed or the screen is locked.
    // Fired via waitUntil so the guest's response isn't held up by Expo, and
    // wrapped so a push failure can never fail the order.
    const items = result.order.lines.reduce((n, l) => n + l.quantity, 0);
    c.executionCtx.waitUntil(
      notifyStore(c.env, storeId, {
        title: `New VIP order · ${result.order.tableName}`,
        body: `${result.order.code} — ${items} item${items === 1 ? "" : "s"}, ${
          store.currency
        } ${(result.order.total / 100).toLocaleString()}`,
        data: { kind: "web_order", orderId: result.order.id, storeId },
      }).catch(() => undefined),
    );

    return ok(c, { code: result.order.code, total: result.order.total, id: result.order.id }, 201);
  },
);
