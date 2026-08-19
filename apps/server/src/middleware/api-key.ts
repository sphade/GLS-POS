import { createMiddleware } from "hono/factory";
import type { ApiScope } from "@gls-pos/types";
import type { StoreDurableObject } from "../durable-objects/store.do.js";
import { HttpError } from "../lib/http-error.js";
import { verifyApiKey, type VerifiedKey } from "../modules/integration/api-key.service.js";
import type { Env } from "../env.js";

/** Context set by the API-key middleware. */
export type ApiKeyVariables = {
  apiKey: VerifiedKey;
  storeId: string;
  store: DurableObjectStub<StoreDurableObject>;
};

/**
 * Authenticates an external system by API key and scopes the request to that
 * key's store. Deliberately separate from the staff session middleware: an
 * integration has no user, no role, and can never act outside its one store.
 *
 * Accepts `Authorization: Bearer gls_live_…` or `x-api-key: gls_live_…`.
 */
export const withApiKey = createMiddleware<{
  Bindings: Env;
  Variables: ApiKeyVariables;
}>(async (c, next) => {
  const bearer = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  const presented = bearer || c.req.header("x-api-key");

  if (!presented) {
    throw HttpError.unauthorized(
      "Provide your API key in the Authorization header: 'Bearer gls_live_…'",
      "missing_api_key",
    );
  }

  const key = await verifyApiKey(c.env, presented);
  if (!key) throw HttpError.unauthorized("Invalid or revoked API key", "invalid_api_key");

  c.set("apiKey", key);
  c.set("storeId", key.storeId);
  c.set("store", c.env.STORE.get(c.env.STORE.idFromName(key.storeId)));
  await next();
});

/**
 * Require a scope on the presented key. Keeps integrations least-privilege: a
 * delivery app reading the menu never gets the ability to change stock.
 */
export function requireScope(scope: ApiScope) {
  return createMiddleware<{ Bindings: Env; Variables: ApiKeyVariables }>(async (c, next) => {
    const key = c.get("apiKey");
    if (!key.scopes.includes(scope)) {
      throw HttpError.forbidden(
        `This API key is missing the '${scope}' scope`,
        "insufficient_scope",
      );
    }
    await next();
  });
}
