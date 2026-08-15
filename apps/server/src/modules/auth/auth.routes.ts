import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { createAuth } from "../../auth/auth.js";

/**
 * Custom auth segment that wraps better-auth's sign-up and sign-in endpoints.
 * POST /api/custom-auth/sign-up  → better-auth email/password sign-up
 * POST /api/custom-auth/sign-in  → better-auth email/password sign-in
 *
 * We simply delegate each request to better-auth's handler so the client can
 * use a stable, explicit URL instead of the generic /api/auth/* wildcard.
 */
const customAuth = new Hono<AppEnv>();

customAuth.post("/sign-up", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(new Request(url.toString(), c.req.raw));
});

customAuth.post("/sign-in", (c) => {
  const auth = createAuth(c.env);
  const url = new URL(c.req.url);
  url.pathname = "/api/auth/sign-in/email";
  return auth.handler(new Request(url.toString(), c.req.raw));
});

export { customAuth };
