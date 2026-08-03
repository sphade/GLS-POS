import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { HttpError } from "../../lib/http-error.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { createProductSchema, updateProductSchema } from "./products.schema.js";

/**
 * Product routes. Thin HTTP layer: validate input, delegate to the store's
 * Durable Object via RPC, wrap the result. Errors bubble to the central handler.
 */
export const products = new Hono<AppEnv>()
  .get("/", async (c) => ok(c, await c.get("store").listProducts()))
  .get("/:id", async (c) => {
    const product = await c.get("store").getProduct(c.req.param("id"));
    if (!product) throw HttpError.notFound("Product not found");
    return ok(c, product);
  })
  .post("/", validate("json", createProductSchema), async (c) =>
    ok(c, await c.get("store").createProduct(c.req.valid("json")), 201),
  )
  .patch("/:id", validate("json", updateProductSchema), async (c) => {
    const updated = await c.get("store").updateProduct(c.req.param("id"), c.req.valid("json"));
    if (!updated) throw HttpError.notFound("Product not found");
    return ok(c, updated);
  })
  .delete("/:id", async (c) => {
    const deleted = await c.get("store").deleteProduct(c.req.param("id"));
    if (!deleted) throw HttpError.notFound("Product not found");
    return ok(c, { id: c.req.param("id"), deleted: true });
  });
