import { zValidator as baseZValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

/**
 * Wrapper around `@hono/zod-validator` that routes validation failures through
 * our central error handler (by throwing the ZodError) instead of returning the
 * library's default response shape. Keeps every error in the `ApiResult`
 * envelope.
 */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return baseZValidator(target, schema, (result) => {
    if (!result.success) {
      throw result.error;
    }
  });
}
