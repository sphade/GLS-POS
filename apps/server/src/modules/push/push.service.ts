import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
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

/**
 * Channel ids created by the app (`apps/mobile/lib/push.ts`). They must match
 * or Android falls back to a default channel and plays the system tone.
 *
 * VIP orders use a dedicated channel so they ring the shop's chime and can be
 * muted independently of stock alerts.
 */
const VIP_CHANNEL_ID = "vip-orders-v2";
const STORE_CHANNEL_ID = "vip-orders";
/** Android raw resource bundled by app.json → expo-notifications.sounds. */
const VIP_SOUND_FILE = "vip_order.wav";

/**
 * Which alert tone a notification carries.
 *
 * `vip` rings the shop's own chime; `default` is the phone's normal tone. It is
 * a property of the Android channel, so this choice is what actually decides
 * whether a locked phone sounds like a guest order or like an email.
 */
export type PushTone = "vip" | "default";

/**
 * Register (or refresh) a device token for every store the user belongs to.
 *
 * The device used to be registered for whichever shop was selected at the time,
 * and switching shops moved the token — so one phone could only ever hear one
 * branch. A manager covering two branches then had to choose which shop to be
 * deaf to. Registering across all memberships removes that choice.
 *
 * Rows for stores the user has since left are dropped, so a device that was
 * removed from a shop stops hearing it on the next registration.
 */
export async function savePushToken(
  env: Env,
  input: { token: string; userId: string; platform?: string },
): Promise<{ stores: number }> {
  const db = createDb(env.DB);

  const memberships = await db
    .select({ storeId: schema.member.storeId })
    .from(schema.member)
    .where(eq(schema.member.userId, input.userId));
  const storeIds = memberships.map((row) => row.storeId);

  const now = new Date();

  // A device is one person at a time. If sign-out could not reach the network,
  // the previous account's rows would linger on this token and the phone would
  // keep receiving that person's alerts. Registration is the point where the
  // device becomes authoritative for exactly one account.
  await db
    .delete(schema.pushToken)
    .where(
      and(
        eq(schema.pushToken.token, input.token),
        ne(schema.pushToken.userId, input.userId),
      ),
    );

  for (const storeId of storeIds) {
    await db
      .insert(schema.pushToken)
      .values({
        token: input.token,
        userId: input.userId,
        storeId,
        platform: input.platform,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.pushToken.token, schema.pushToken.storeId],
        set: { userId: input.userId, platform: input.platform, createdAt: now },
      });
  }

  // Prune the branches this user is no longer a member of. Without this a phone
  // that left a shop would keep receiving its alerts forever.
  await db
    .delete(schema.pushToken)
    .where(
      storeIds.length > 0
        ? and(
            eq(schema.pushToken.token, input.token),
            eq(schema.pushToken.userId, input.userId),
            notInArray(schema.pushToken.storeId, storeIds),
          )
        : and(
            eq(schema.pushToken.token, input.token),
            eq(schema.pushToken.userId, input.userId),
          ),
    );

  return { stores: storeIds.length };
}

/**
 * Remove a device. Passing `userId` limits the delete to that person's rows, so
 * one account cannot unregister another account's phone; the push service's own
 * dead-token pruning calls it without one.
 */
export async function deletePushToken(
  env: Env,
  token: string,
  userId?: string,
): Promise<void> {
  const db = createDb(env.DB);
  await db
    .delete(schema.pushToken)
    .where(
      userId
        ? and(eq(schema.pushToken.token, token), eq(schema.pushToken.userId, userId))
        : eq(schema.pushToken.token, token),
    );
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
  message: {
    title: string;
    body: string;
    data?: Record<string, unknown>;
    /** Defaults to the phone's normal notification tone. */
    tone?: PushTone;
  },
  audience: PushAudience = {},
): Promise<{ sent: number }> {
  const tokens = audience.roles
    ? await tokensForRoles(env, storeId, audience.roles)
    : await tokensForStore(env, storeId);
  if (tokens.length === 0) return { sent: 0 };

  const vip = message.tone === "vip";

  let sent = 0;
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100);
    const payload = batch.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      data: message.data,
      // iOS plays this file directly; Android resolves the channel's sound.
      sound: vip ? VIP_SOUND_FILE : "default",
      priority: "high",
      // Android: show on the lock screen and make some noise.
      channelId: vip ? VIP_CHANNEL_ID : STORE_CHANNEL_ID,
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
