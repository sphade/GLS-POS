import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ROLE_PERMISSIONS } from "@gls-pos/types";
import type { AppEnv } from "./context.js";
import { ok } from "./lib/response.js";
import { HttpError } from "./lib/http-error.js";
import { onError, notFound } from "./middleware/error-handler.js";
import { withAuth, requireAuth } from "./middleware/auth.js";
import { withStore } from "./middleware/store.js";
import { stores } from "./modules/stores/stores.routes.js";
import { members } from "./modules/stores/members.routes.js";
import { business } from "./modules/stores/business.routes.js";
import { sync } from "./modules/sync/sync.routes.js";
import { vip } from "./modules/vip/vip.routes.js";
import { push } from "./modules/push/push.routes.js";
import { v1 } from "./modules/integration/v1.routes.js";
import { integrations } from "./modules/integration/integration.routes.js";
import { withApiKey } from "./middleware/api-key.js";

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

  // VIP guest ordering is intentionally PUBLIC (guests scan a QR at the table),
  // so it is mounted before the auth middleware. Its own module documents the
  // narrow read/write surface that makes this safe.
  app.route("/vip", vip);

  /**
   * Public integration API (v1) for external systems — delivery apps, etc.
   * Authenticated by API key rather than a staff session, so it's mounted before
   * withAuth and carries its own middleware.
   */
  app.use("/v1/*", withApiKey);
  app.route("/v1", v1);

  // Resolve the per-request auth instance + session for every route.
  app.use("*", withAuth);

  // better-auth owns all sign-up/in/out and session endpoints.
  app.on(["GET", "POST"], "/api/auth/*", (c) => c.get("auth").handler(c.req.raw));

  const api = app.basePath("/api");
  api.get("/me", requireAuth, (c) => ok(c, { user: c.get("user") }));

  // Store registry & membership (control plane, D1).
  api.use("/stores/*", requireAuth);
  api.use("/stores", requireAuth);
  api.route("/stores", stores);

  // Push-token registration for staff devices.
  api.use("/push/*", requireAuth, withStore);
  api.route("/push", push);

  // Staff manage API keys + webhooks for external systems here.
  api.use("/integrations/*", requireAuth, withStore);
  api.route("/integrations", integrations);

  // Store-scoped staff & role management.
  api.use("/members", requireAuth, withStore);
  api.use("/members/*", requireAuth, withStore);
  api.route("/members", members);

  // Business profile: name, address, contact, receipt lines. Owner-only to write.
  api.use("/business", requireAuth, withStore);
  api.route("/business", business);

  // The caller's role + effective permissions for the selected store, so the
  // client can shape its UI from the same matrix the server enforces.
  api.get("/session/store", requireAuth, withStore, (c) => {
    const role = c.get("role");
    return ok(c, { storeId: c.get("storeId"), role, permissions: ROLE_PERMISSIONS[role] });
  });

  // The VIP link to encode into each table's QR code. Staff-only.
  api.get("/vip-link", requireAuth, withStore, (c) => {
    const tableId = c.req.query("tableId");
    if (!tableId) throw HttpError.badRequest("tableId is required");
    const base = c.env.BETTER_AUTH_URL.replace(/\/$/, "");
    return ok(c, { url: `${base}/vip/${c.get("storeId")}/${tableId}` });
  });

  /**
   * Realtime channel. Authenticated + membership-checked here, then the upgrade
   * is handed to the store's Durable Object, which holds the socket and pushes
   * change notifications to every till.
   */
  api.get("/realtime", requireAuth, withStore, async (c) => {
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      throw HttpError.badRequest("Expected a WebSocket upgrade", "upgrade_required");
    }
    return c.get("store").fetch(new Request("https://do/realtime", c.req.raw));
  });

  // Offline-first sync against the caller's store Durable Object.
  api.use("/sync", requireAuth, withStore);
  api.use("/sync/*", requireAuth, withStore);
  api.route("/sync", sync);

  app.notFound(notFound);
  app.onError(onError);

  return app;
}
