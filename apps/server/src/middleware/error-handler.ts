import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-error.js";
import { err } from "../lib/response.js";

/**
 * Central error handler wired via `app.onError`. Translates known error types
 * into the standard `ApiResult` envelope; anything unexpected becomes a 500
 * without leaking internals in production.
 */
export function onError(error: Error, c: Context) {
  if (error instanceof HttpError) {
    return err(c, { code: error.code, message: error.message }, error.status);
  }

  if (error instanceof ZodError) {
    return err(
      c,
      {
        code: "validation_error",
        message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      },
      400,
    );
  }

  if (error instanceof HTTPException) {
    return err(c, { code: "http_error", message: error.message }, error.status);
  }

  console.error("Unhandled error:", error);
  const isProd = c.env?.ENVIRONMENT === "production";
  return err(
    c,
    {
      code: "internal_error",
      message: isProd ? "Internal server error" : error.message,
    },
    500,
  );
}

export function notFound(c: Context) {
  return err(c, { code: "not_found", message: "Route not found" }, 404);
}
