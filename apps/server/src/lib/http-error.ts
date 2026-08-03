import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Domain/HTTP error that the central error handler knows how to serialize into
 * the standard `ApiResult` envelope. Throw this from services instead of
 * returning ad-hoc error responses, so error handling stays in one place.
 */
export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }

  static badRequest(message: string, code = "bad_request") {
    return new HttpError(400, code, message);
  }

  static unauthorized(message = "Unauthorized", code = "unauthorized") {
    return new HttpError(401, code, message);
  }

  static forbidden(message = "Forbidden", code = "forbidden") {
    return new HttpError(403, code, message);
  }

  static notFound(message = "Not found", code = "not_found") {
    return new HttpError(404, code, message);
  }

  static conflict(message: string, code = "conflict") {
    return new HttpError(409, code, message);
  }
}
