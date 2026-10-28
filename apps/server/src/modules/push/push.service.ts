import { and, eq, inArray } from "drizzle-orm";
import type { StoreRole } from "@gls-pos/types";
import { createDb, schema } from "../../db/index.js";
import type { Env } from "../../env.js";

/**
 * Expo push notifications for staff devices.
 *
 * Uses Expo's public push API, which needs no secret for ExponentPushToken
 * sends — the token itself is the credential. That keeps this free and avoids
 * managing APNs/FCM keys.
 *
 * Every send is best-effort: a VIP order must never fail because a
 * notification couldn't be delivered.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Register (or refresh) a device token for a store. */
export async function savePushToken(
  env: Env,
  input: { token: string; userId: string; storeId: string; platform?: string },
): Promise<void> {
  const db = createDb(env.DB);
  await db
    .insert(schema.pushToken)
    .values({
      token: input.token,
      userId: input.userId,
      storeId: input.storeId,
      platform: input.platform,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.pushToken.token,
      set: { userId: input.userId, storeId: input.storeId, createdAt: new Date() },
    });
}

export async function deletePushToken(env: Env, token: string): Promise<void> {
  const db = createDb(env.DB);
  await db.delete(schema.pushToken).where(eq(schema.pushToken.token, token));
}

/** Tokens belonging to a store's staff. */
async function tokensForStore(env: Env, storeId: string): Promise<string[]> {
  const db = createDb(env.DB);
  const rows = await db
    .select({ token: schema.pushToken.token })
    .from(schema.pushToken)
    .where(eq(schema.pushToken.storeId, storeId));
  return rows.map((r) => r.token);
}

/**
 * Tokens for the staff in this store who hold one of `roles`.
 *
 * A device token belongs to a user, and a user's role is per store, so the
 * join is what stops a cashier's phone from buzzing about an owner-only event.
 * Staff who left the store are excluded automatically because the membership
 * row is gone.
 */
async function tokensForRoles(
  env: Env,
  storeId: string,
  roles: readonly StoreRole[],
): Promise<string[]> {
  if (roles.length === 0) return [];
  const db = createDb(env.DB);
  const rows = await db
    .select({ token: schema.pushToken.token })
    .from(schema.pushToken)
    .innerJoin(
      schema.member,
      and(
        eq(schema.member.userId, schema.pushToken.userId),
        eq(schema.member.storeId, schema.pushToken.storeId),
      ),
    )
    .where(
      and(
        eq(schema.pushToken.storeId, storeId),
        inArray(schema.member.role, roles as string[]),
      ),
    );
  return rows.map((r) => r.token);
}

/**
 * Who should hear about an event.
 *
 * Omit `roles` to reach every device signed into the store (floor-wide events
 * like a new order). Pass roles to keep money- and stock-sensitive alerts with
 * the people responsible for them.
 */
export type PushAudience = {
  roles?: readonly StoreRole[];
};

/**
 * Alert staff devices for a store. Expo accepts up to 100 messages per
 * request; we chunk to stay inside that.
 *
 * Invalid tokens are pruned so a reinstalled app doesn't leave dead rows behind.
 */
export async function notifyStore(
  env: Env,
  storeId: string,
  message: { title: string; body: string; data?: Record<string, unknown> },
  audience: PushAudience = {},
): Promise<{ sent: number }> {
  const tokens = audience.roles
    ? await tokensForRoles(env, storeId, audience.roles)
    : await tokensForStore(env, storeId);
  if (tokens.length === 0) return { sent: 0 };

  let sent = 0;
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100);
    const payload = batch.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      data: message.data,
      sound: "default",
      priority: "high",
      // Android: show on the lock screen and make some noise.
      channelId: "vip-orders",
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as {
        data?: { status: string; message?: string; details?: { error?: string } }[];
      };

      // Prune tokens Expo tells us are dead.
      const dead: string[] = [];
      body.data?.forEach((r, idx) => {
        if (r.status === "ok") sent += 1;
        else if (r.details?.error === "DeviceNotRegistered") dead.push(batch[idx]!);
      });
      await Promise.all(dead.map((t) => deletePushToken(env, t)));
    } catch {
      // Network hiccup to Expo — nothing we can do, and nothing depends on it.
    }
  }

  return { sent };
}

/** Was this user's device already registered for this store? */
export async function hasToken(env: Env, userId: string, storeId: string): Promise<boolean> {
  const db = createDb(env.DB);
  const [row] = await db
    .select({ token: schema.pushToken.token })
    .from(schema.pushToken)
    .where(and(eq(schema.pushToken.userId, userId), eq(schema.pushToken.storeId, storeId)))
    .limit(1);
  return !!row;
}
