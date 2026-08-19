import { Hono } from "hono";
import { z } from "zod";
import type {
  ApiEvent,
  ApiEventType,
  ApiStockLevel,
  StockEventData,
  WebOrder,
} from "@gls-pos/types";
import type { Env } from "../../env.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import { requireScope, type ApiKeyVariables } from "../../middleware/api-key.js";
import { stockEvents } from "./events.js";
import { dispatchEvents } from "./webhook.service.js";

/**
 * Public integration API, version 1.
 *
 * This is a *stable contract* for external systems (delivery apps, dashboards).
 * The internal device-sync protocol is free to change; this is not. Anything
 * added here should be additive.
 *
 * Every route is authenticated by API key (see withApiKey) and scoped to that
 * key's store, so an integration can never read or write another store.
 */
type V1Env = { Bindings: Env; Variables: ApiKeyVariables };

const adjustSchema = z.object({
  adjustments: z
    .array(
      z
        .object({
          productId: z.string().min(1),
          delta: z.number().int().optional(),
          stock: z.number().int().min(0).optional(),
          reason: z.enum(["restock", "adjustment", "sale", "waste"]).optional(),
          note: z.string().max(200).optional(),
        })
        // One or the other, never both — ambiguity here would corrupt stock.
        .refine((a) => (a.delta === undefined) !== (a.stock === undefined), {
          message: "provide exactly one of 'delta' or 'stock'",
        }),
    )
    .min(1)
    .max(200),
});

export const v1 = new Hono<V1Env>();

/** Who am I? Useful first call for integrators verifying their key. */
v1.get("/me", (c) => {
  const key = c.get("apiKey");
  return ok(c, { storeId: key.storeId, keyName: key.name, scopes: key.scopes });
});

// --- catalog ---------------------------------------------------------------

v1.get("/products", requireScope("catalog:read"), async (c) => {
  const products = await c.get("store").apiProducts();

  // Optional filters so integrators can pull only what they need.
  const state = c.req.query("stockState");
  const availableOnly = c.req.query("available") === "true";
  const since = Number(c.req.query("updatedSince") ?? "0") || 0;

  let data = products;
  if (state) data = data.filter((p) => p.stockState === state);
  if (availableOnly) data = data.filter((p) => p.available);
  if (since) data = data.filter((p) => p.updatedAt > since);

  return ok(c, { data, cursor: 0, hasMore: false });
});

v1.get("/products/:id", requireScope("catalog:read"), async (c) => {
  const product = (await c.get("store").apiProducts()).find((p) => p.id === c.req.param("id"));
  if (!product) throw HttpError.notFound("Product not found", "product_not_found");
  return ok(c, product);
});

v1.get("/categories", requireScope("catalog:read"), async (c) =>
  ok(c, { data: await c.get("store").apiCategories(), cursor: 0, hasMore: false }),
);

// --- stock -----------------------------------------------------------------

/** Compact availability feed — the cheapest way to mirror stock. */
v1.get("/stock", requireScope("stock:read"), async (c) => {
  const products = await c.get("store").apiProducts();
  const data: ApiStockLevel[] = products.map((p) => ({
    productId: p.id,
    name: p.name,
    stock: p.stock,
    stockState: p.stockState,
    available: p.available,
  }));
  return ok(c, { data, cursor: 0, hasMore: false });
});

/**
 * Adjust stock. Applied inside the Durable Object (single-writer, so concurrent
 * adjustments can't race), logged as a stock movement, and fanned out to
 * webhooks + connected tills.
 */
v1.post("/stock/adjust", requireScope("stock:write"), validate("json", adjustSchema), async (c) => {
  const key = c.get("apiKey");
  const { adjustments } = c.req.valid("json");

  const result = await c.get("store").apiAdjustStock(adjustments, key.name);

  // Notify subscribers after responding — never make the caller wait on webhooks.
  const events = stockEvents(key.storeId, result.applied);
  if (events.length > 0) {
    c.executionCtx.waitUntil(
      dispatchEvents(c.env, key.storeId, events as ApiEvent[]).catch(() => undefined),
    );
  }

  return ok(c, {
    applied: result.applied.length,
    unknownProductIds: result.unknown,
    changes: result.applied,
  });
});

// --- orders ----------------------------------------------------------------

/** Orders that came from the VIP/web channel. */
v1.get("/orders", requireScope("orders:read"), async (c) => {
  const since = Number(c.req.query("since") ?? "0") || 0;
  const page = await c.get("store").apiChangesSince(since, 200);
  const data = page.rows
    .filter((r) => r.collection === "web_orders" && !r.deleted)
    .map((r) => JSON.parse(r.data) as WebOrder);
  return ok(c, { data, cursor: page.cursor, hasMore: page.hasMore });
});

// --- events ----------------------------------------------------------------

/**
 * Change feed. Poll with `?since=<cursor>`; the cursor is the same monotonic
 * per-store sequence the device sync uses, so it's exactly resumable and never
 * skips or repeats an event.
 */
v1.get("/events", requireScope("events:read"), async (c) => {
  const since = Number(c.req.query("since") ?? "0") || 0;
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "100") || 100, 1), 500);
  const page = await c.get("store").apiChangesSince(since, limit);
  const storeId = c.get("storeId");

  const events: ApiEvent[] = [];
  for (const row of page.rows) {
    const doc = JSON.parse(row.data) as Record<string, unknown>;
    const base = { seq: row.seq, occurredAt: row.updatedAt ?? Date.now(), storeId };

    if (row.collection === "products") {
      const type: ApiEventType = row.deleted ? "product.deleted" : "product.updated";
      const stock = (doc.stockQuantity ?? null) as number | null;
      const lowAt = doc.lowStockAt as number | undefined;
      const productId = String(doc.id ?? row.id);
      const name = String(doc.name ?? "");
      const state =
        stock === null
          ? "untracked"
          : stock <= 0
            ? "out_of_stock"
            : stock <= (lowAt ?? 3)
              ? "low_stock"
              : "in_stock";
      events.push({
        ...base,
        type,
        data: {
          productId,
          name,
          stock,
          previousStock: null, // unknown when reconstructing from the log
          lowStockAt: lowAt,
          stockState: state,
        } satisfies StockEventData,
      });
    } else if (row.collection === "web_orders") {
      events.push({ ...base, type: "order.created", data: doc });
    }
  }

  const requested = c.req.query("types");
  const filtered = requested
    ? events.filter((e) => requested.split(",").includes(e.type))
    : events;

  return ok(c, { events: filtered, cursor: page.cursor, hasMore: page.hasMore });
});
