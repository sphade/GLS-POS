import { createMiddleware } from "hono/factory";
import { createAuth, type Auth } from "../auth/auth.js";
import { HttpError } from "../lib/http-error.js";
import type { Env } from "../env.js";

type Session = Auth["$Infer"]["Session"];

/** Context variables set by the auth middleware. */
export type AuthVariables = {
  auth: Auth;
  user: Session["user"] | null;
  session: Session["session"] | null;
};

/**
 * Builds the per-request better-auth instance, resolves the session, and stashes
 * the auth instance + user/session on the context. Non-blocking: unauthenticated
 * requests still pass through with null user/session.
 */
export const withAuth = createMiddleware<{ Bindings: Env; Variables: AuthVariables }>(
  async (c, next) => {
    const auth = createAuth(c.env);
    c.set("auth", auth);

    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", result?.user ?? null);
    c.set("session", result?.session ?? null);

    await next();
  },
);

/** Guard for protected routes. Must run after `withAuth`. */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  if (!c.get("user")) {
    throw HttpError.unauthorized("Authentication required");
  }
  await next();
});
