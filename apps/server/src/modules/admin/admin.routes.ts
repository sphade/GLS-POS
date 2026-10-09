import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { HttpError } from "../../lib/http-error.js";

/**
 * Operator-only copy of store data between environments (prod -> staging).
 *
 * Not reachable by staff sessions: every request must carry
 * `Authorization: Bearer <ADMIN_TOKEN>`, a Worker secret. With no secret set
 * the whole module answers 404, so it is inert by default.
 *
 * - GET  /admin/stores/:storeId/documents?after=N&limit=M  — read-only export
 * - POST /admin/stores/:storeId/documents                  — import, STAGING ONLY
 */
export const admin = new Hono<AppEnv>();

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

admin.use("*", async (c, next) => {
  const secret = c.env.ADMIN_TOKEN;
  if (!secret) throw HttpError.notFound();
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !safeEqual(token, secret)) {
    return c.json({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } }, 401);
  }
  await next();
});

const storeStub = (c: { env: AppEnv["Bindings"] }, storeId: string) =>
  c.env.STORE.get(c.env.STORE.idFromName(storeId));

admin.get("/stores/:storeId/documents", async (c) => {
  const after = Number(c.req.query("after") ?? 0) || 0;
  const limit = Number(c.req.query("limit") ?? 200) || 200;
  const page = await storeStub(c, c.req.param("storeId")).adminExportPage(after, limit);
  return c.json({ ok: true, data: page });
});

admin.post("/stores/:storeId/documents", async (c) => {
  if (c.env.ENVIRONMENT !== "staging") {
    return c.json({ ok: false, error: { code: "forbidden", message: "Import is staging-only" } }, 403);
  }
  const body = await c.req.json<{ reset?: boolean; rows?: unknown[] }>();
  if (!Array.isArray(body.rows)) {
    return c.json({ ok: false, error: { code: "bad_request", message: "rows[] required" } }, 400);
  }
  const result = await storeStub(c, c.req.param("storeId")).adminImportPage(
    body.rows as Parameters<import("../../durable-objects/store.do.js").StoreDurableObject["adminImportPage"]>[0],
    body.reset === true,
  );
  return c.json({ ok: true, data: result });
});
