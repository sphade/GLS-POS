import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { AppEnv } from "./context.js";
import { ok } from "./lib/response.js";
import { onError, notFound } from "./middleware/error-handler.js";
import { withAuth, requireAuth } from "./middleware/auth.js";
import { withStore } from "./middleware/store.js";
import { products } from "./modules/products/products.routes.js";
import { orders } from "./modules/orders/orders.routes.js";

/**
 * Build the Hono application. New feature areas are added by creating a module
 * under `src/modules/<feature>` and mounting it here.
 *
 * Request pipeline: CORS/logging → better-auth handles /api/auth/* → withAuth
 * resolves the session → business routes (which also resolve the store DO).
 */
export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: (origin) => origin ?? "*",
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "Cookie", "x-store-id"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/", (c) => c.json({ ok: true, service: "gls-pos-server" }));
  app.get("/health", (c) => c.json({ ok: true, status: "healthy" }));

  // Resolve the per-request auth instance + session for every route.
  app.use("*", withAuth);

  // better-auth owns all sign-up/in/out and session endpoints.
  app.on(["GET", "POST"], "/api/auth/*", (c) => c.get("auth").handler(c.req.raw));

  const api = app.basePath("/api");
  api.get("/me", requireAuth, (c) => ok(c, { user: c.get("user") }));

  // Business routes operate against a specific store's Durable Object.
  api.use("/products/*", withStore);
  api.use("/orders/*", withStore);
  api.route("/products", products);
  api.route("/orders", orders);

  app.notFound(notFound);
  app.onError(onError);

  return app;
}
