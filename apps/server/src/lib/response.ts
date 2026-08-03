import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiError, ApiResult } from "@gls-pos/types";

/**
 * Helpers for the standard `ApiResult<T>` envelope so every route responds in
 * the same shape the client already expects.
 */

export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json<ApiResult<T>>({ ok: true, data }, status);
}

export function err(
  c: Context,
  error: ApiError,
  status: ContentfulStatusCode = 400,
) {
  return c.json<ApiResult<never>>({ ok: false, error }, status);
}
