import { and, eq } from "drizzle-orm";
import type { ApiEvent, ApiEventType } from "@gls-pos/types";
import { createDb, schema } from "../../db/index.js";
import { newId } from "../../lib/id.js";
import type { Env } from "../../env.js";

/**
 * Outbound webhooks, so integrators are told about changes instead of polling.
 *
 * Each delivery is signed with HMAC-SHA256 over the exact request body and sent
 * as `x-gls-signature: sha256=<hex>`. Receivers must recompute it with their
 * endpoint secret — that's what proves the call came from us and wasn't altered.
 *
 * Delivery is best-effort and fire-and-forget: a broken integrator endpoint must
 * never slow down or fail a sale. Endpoints that fail repeatedly are disabled.
 */

const MAX_FAILURES = 15;
const TIMEOUT_MS = 5000;

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createWebhook(
  env: Env,
  input: { storeId: string; url: string; events: ApiEventType[] | ["*"] },
): Promise<{ id: string; secret: string }> {
  const id = newId("wh");
  // Shown once so the integrator can verify signatures.
  const secret = `whsec_${crypto.randomUUID().replace(/-/g, "")}`;
  await createDb(env.DB).insert(schema.webhook).values({
    id,
    storeId: input.storeId,
    url: input.url,
    secret,
    events: input.events.join(","),
    createdAt: new Date(),
  });
  return { id, secret };
}

export async function listWebhooks(env: Env, storeId: string) {
  return createDb(env.DB)
    .select({
      id: schema.webhook.id,
      url: schema.webhook.url,
      events: schema.webhook.events,
      isActive: schema.webhook.isActive,
      failureCount: schema.webhook.failureCount,
      lastStatus: schema.webhook.lastStatus,
      lastAttemptAt: schema.webhook.lastAttemptAt,
      createdAt: schema.webhook.createdAt,
    })
    .from(schema.webhook)
    .where(eq(schema.webhook.storeId, storeId));
}

export async function deleteWebhook(env: Env, storeId: string, id: string): Promise<void> {
  await createDb(env.DB)
    .delete(schema.webhook)
    .where(and(eq(schema.webhook.id, id), eq(schema.webhook.storeId, storeId)));
}

/**
 * Deliver events to every subscribed endpoint for a store.
 *
 * Call inside `ctx.waitUntil(...)` so it runs after the response is sent.
 */
export async function dispatchEvents(env: Env, storeId: string, events: ApiEvent[]): Promise<void> {
  if (events.length === 0) return;

  const db = createDb(env.DB);
  const hooks = await db
    .select()
    .from(schema.webhook)
    .where(and(eq(schema.webhook.storeId, storeId), eq(schema.webhook.isActive, true)));
  if (hooks.length === 0) return;

  await Promise.all(
    hooks.map(async (hook) => {
      const wanted = hook.events.split(",");
      const matching = wanted.includes("*")
        ? events
        : events.filter((e) => wanted.includes(e.type));
      if (matching.length === 0) return;

      const body = JSON.stringify({ storeId, events: matching });
      let status = 0;

      try {
        const res = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-gls-signature": `sha256=${await sign(hook.secret, body)}`,
            "x-gls-event-count": String(matching.length),
            "User-Agent": "GLS-POS-Webhook/1",
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        status = res.status;
      } catch {
        status = 0; // timeout or network failure
      }

      const ok = status >= 200 && status < 300;
      const failures = ok ? 0 : hook.failureCount + 1;

      await db
        .update(schema.webhook)
        .set({
          lastStatus: status,
          lastAttemptAt: new Date(),
          failureCount: failures,
          // Stop hammering an endpoint that's clearly gone.
          isActive: failures < MAX_FAILURES,
        })
        .where(eq(schema.webhook.id, hook.id));
    }),
  );
}
