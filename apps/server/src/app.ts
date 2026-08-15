import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { AppEnv } from "./context.js";
import { ok } from "./lib/response.js";
import { onError, notFound } from "./middleware/error-handler.js";
import { withAuth, requireAuth } from "./middleware/auth.js";
import { withStore } from "./middleware/store.js";
import { stores } from "./modules/stores/stores.routes.js";
import { sync } from "./modules/sync/sync.routes.js";
import { customAuth } from "./modules/auth/auth.routes.js";
import { organizations } from "./modules/organizations/organizations.routes.js";
import { admin } from "./modules/admin/admin.routes.js";
import { users } from "./modules/users/users.routes.js";
import { createAuth } from "./auth/auth.js";
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

  app.all("/api/auth/*", (c) => {
    console.log("triggered auth handler");
    let auth = createAuth(c.env);
    return auth.handler(c.req.raw);
  });

  // Resolve the per-request auth instance + session for every route.
  app.use("*", withAuth);

  // better-auth owns all sign-up/in/out and session endpoints.

  const api = app.basePath("/api");
  api.get("/me", requireAuth, (c) => ok(c, { user: c.get("user") }));

  // Custom auth wrappers for sign-up and sign-in.

  // Better Auth organization wrappers.
  api.route("/organizations", organizations);

  // Admin routes (auth-protected + admin-only).
  api.route("/admin", admin);

  // User routes (auth-protected, users manage their own profile).
  api.route("/users", users);

  // Store registry & membership (control plane, D1).
  api.use("/stores/*", requireAuth);
  api.use("/stores", requireAuth);
  api.route("/stores", stores);

  // Offline-first sync against the caller's store Durable Object.
  api.use("/sync", requireAuth, withStore);
  api.use("/sync/*", requireAuth, withStore);
  api.route("/sync", sync);

  app.notFound(notFound);
  app.onError(onError);

  return app;
}
