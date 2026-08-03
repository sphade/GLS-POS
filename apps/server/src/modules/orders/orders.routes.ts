import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { HttpError } from "../../lib/http-error.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { createOrderSchema } from "./orders.schema.js";

/**
 * Order routes. Validate input, delegate to the store's Durable Object (which
 * computes totals server-side), wrap the result.
 */
export const orders = new Hono<AppEnv>()
  .get("/", async (c) => ok(c, await c.get("store").listOrders()))
  .get("/:id", async (c) => {
    const order = await c.get("store").getOrder(c.req.param("id"));
    if (!order) throw HttpError.notFound("Order not found");
    return ok(c, order);
  })
  .post("/", validate("json", createOrderSchema), async (c) =>
    ok(c, await c.get("store").createOrder(c.req.valid("json")), 201),
  );
