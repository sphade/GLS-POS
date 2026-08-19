import { Hono } from "hono";
import { z } from "zod";
import { ALL_API_SCOPES } from "@gls-pos/types";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import { requirePermission } from "../../middleware/store.js";
import { issueApiKey, listApiKeys, revokeApiKey } from "./api-key.service.js";
import { createWebhook, deleteWebhook, listWebhooks } from "./webhook.service.js";

/**
 * Staff-facing management of integrations: issuing API keys and registering
 * webhooks. Gated on `settings:manage`, so only an owner/manager can grant an
 * external system access to the store.
 */
const scopeEnum = z.enum(ALL_API_SCOPES as unknown as [string, ...string[]]);

const createKeySchema = z.object({
  name: z.string().min(1).max(60),
  scopes: z.array(scopeEnum).min(1),
});

const createWebhookSchema = z.object({
  url: z.string().url().startsWith("https://", "webhook URLs must use HTTPS"),
  events: z.array(z.string().min(1)).min(1),
});

export const integrations = new Hono<AppEnv>()
  // --- API keys ---
  .get("/keys", requirePermission("settings:manage"), async (c) =>
    ok(c, await listApiKeys(c.env, c.get("storeId"))),
  )
  .post(
    "/keys",
    requirePermission("settings:manage"),
    validate("json", createKeySchema),
    async (c) => {
      const { name, scopes } = c.req.valid("json");
      const issued = await issueApiKey(c.env, {
        storeId: c.get("storeId"),
        name,
        scopes: scopes as never,
        createdBy: c.get("user")?.id,
      });
      // `key` is returned once and never retrievable again.
      return ok(
        c,
        { ...issued, warning: "Copy this key now — it cannot be shown again." },
        201,
      );
    },
  )
  .delete("/keys/:id", requirePermission("settings:manage"), async (c) => {
    await revokeApiKey(c.env, c.get("storeId"), c.req.param("id"));
    return ok(c, { revoked: true });
  })

  // --- webhooks ---
  .get("/webhooks", requirePermission("settings:manage"), async (c) =>
    ok(c, await listWebhooks(c.env, c.get("storeId"))),
  )
  .post(
    "/webhooks",
    requirePermission("settings:manage"),
    validate("json", createWebhookSchema),
    async (c) => {
      const { url, events } = c.req.valid("json");
      const created = await createWebhook(c.env, {
        storeId: c.get("storeId"),
        url,
        events: events as never,
      });
      return ok(
        c,
        {
          ...created,
          warning: "Store this signing secret — it cannot be shown again.",
          signatureHeader: "x-gls-signature",
        },
        201,
      );
    },
  )
  .delete("/webhooks/:id", requirePermission("settings:manage"), async (c) => {
    await deleteWebhook(c.env, c.get("storeId"), c.req.param("id"));
    return ok(c, { deleted: true });
  })

  /** Discoverability: what scopes and events exist. */
  .get("/capabilities", (c) => {
    if (!c.get("user")) throw HttpError.unauthorized();
    return ok(c, {
      scopes: ALL_API_SCOPES,
      events: [
        "product.created",
        "product.updated",
        "product.deleted",
        "stock.changed",
        "stock.low",
        "stock.out",
        "stock.replenished",
        "order.created",
        "order.updated",
      ],
      baseUrl: `${c.env.BETTER_AUTH_URL.replace(/\/$/, "")}/v1`,
    });
  });
