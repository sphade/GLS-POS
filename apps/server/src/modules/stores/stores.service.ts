import { and, eq, inArray } from "drizzle-orm";
import type { StoreMembership, StoreProfile, StoreRole } from "@gls-pos/types";
import { createDb, schema } from "../../db/index.js";
import { newId } from "../../lib/id.js";
import { HttpError } from "../../lib/http-error.js";
import type { Env } from "../../env.js";
import type { CreateStoreInput, UpdateStoreInput } from "./stores.schema.js";

/**
 * Control-plane store registry & membership logic (Cloudflare D1 via Drizzle).
 * The store's operational data lives in its Durable Object; this service only
 * answers ownership/identity questions and provisions the registry rows.
 */

/** Stores the given user belongs to, with their role in each. */
export async function listStoresForUser(env: Env, userId: string): Promise<StoreMembership[]> {
  const db = createDb(env.DB);
  const rows = await db
    .select({
      id: schema.store.id,
      name: schema.store.name,
      currency: schema.store.currency,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.store, eq(schema.member.storeId, schema.store.id))
    .where(eq(schema.member.userId, userId));

  return rows.map((r) => ({ ...r, role: r.role as StoreRole }));
}

/**
 * The caller's role in the store, or null when they aren't a member.
 * Used by the store middleware for both the membership check and permissions.
 */
export async function memberRole(
  env: Env,
  userId: string,
  storeId: string,
): Promise<StoreRole | null> {
  const db = createDb(env.DB);
  const [row] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.storeId, storeId)))
    .limit(1);
  return (row?.role as StoreRole) ?? null;
}

/**
 * Create a store and make the caller its owner.
 *
 * Only owners open new locations. Staff provisioned by an owner (manager,
 * cashier, waiter, kitchen) must not be able to spin up their own business from
 * inside the app. A brand-new account with no memberships is the one exception —
 * that's an owner registering their first restaurant.
 */
export async function createStore(
  env: Env,
  userId: string,
  input: CreateStoreInput,
): Promise<StoreMembership> {
  const db = createDb(env.DB);

  const memberships = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(eq(schema.member.userId, userId));

  if (memberships.length > 0 && !memberships.some((m) => m.role === "owner")) {
    throw HttpError.forbidden(
      "Only an owner can create a store. Ask the owner of your restaurant.",
      "owner_only",
    );
  }

  const now = new Date();
  const storeId = newId("store");

  await db.insert(schema.store).values({
    id: storeId,
    name: input.name,
    currency: input.currency,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.member).values({
    id: newId("mbr"),
    userId,
    storeId,
    role: "owner",
    createdAt: now,
  });

  return { id: storeId, name: input.name, currency: input.currency, role: "owner" };
}

/** The business profile shown in Business Settings. */
export async function getStoreProfile(env: Env, storeId: string): Promise<StoreProfile> {
  const db = createDb(env.DB);
  const [row] = await db
    .select({
      id: schema.store.id,
      name: schema.store.name,
      currency: schema.store.currency,
      address: schema.store.address,
      phone: schema.store.phone,
      receiptHeader: schema.store.receiptHeader,
      receiptFooter: schema.store.receiptFooter,
    })
    .from(schema.store)
    .where(eq(schema.store.id, storeId))
    .limit(1);
  if (!row) throw HttpError.notFound("That store was not found", "store_not_found");
  return row as StoreProfile;
}

/**
 * Update the business profile. Owner-only (enforced at the route) — the store
 * name and receipt details are the business's identity, not day-to-day settings.
 */
export async function updateStoreProfile(
  env: Env,
  storeId: string,
  input: UpdateStoreInput,
): Promise<StoreProfile> {
  const db = createDb(env.DB);

  // Only write the keys the client actually sent, so a partial save can't blank
  // out fields the screen wasn't showing.
  const patch = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined),
  ) as Partial<UpdateStoreInput>;

  if (Object.keys(patch).length > 0) {
    await db
      .update(schema.store)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.store.id, storeId));
  }

  return getStoreProfile(env, storeId);
}

/** Everyone with access to a store, for the Staff screen. */
export async function listMembers(env: Env, storeId: string) {
  const db = createDb(env.DB);
  return db
    .select({
      userId: schema.member.userId,
      name: schema.user.name,
      email: schema.user.email,
      username: schema.user.displayUsername,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(eq(schema.member.storeId, storeId));
}

/**
 * Grant or change someone's role by email. Owner-only (enforced at the route).
 * The store owner's own role can't be downgraded, so a store always has an owner.
 */
export async function setMemberRole(
  env: Env,
  storeId: string,
  email: string,
  role: StoreRole,
): Promise<{ userId: string; role: StoreRole }> {
  const db = createDb(env.DB);

  const [target] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  if (!target) {
    throw HttpError.notFound("No user with that email. They must sign up first.", "user_not_found");
  }

  const [storeRow] = await db
    .select({ ownerId: schema.store.ownerId })
    .from(schema.store)
    .where(eq(schema.store.id, storeId))
    .limit(1);
  if (storeRow?.ownerId === target.id && role !== "owner") {
    throw HttpError.badRequest("The store owner's role cannot be changed", "cannot_demote_owner");
  }

  const existing = await memberRole(env, target.id, storeId);
  if (existing) {
    await db
      .update(schema.member)
      .set({ role })
      .where(and(eq(schema.member.userId, target.id), eq(schema.member.storeId, storeId)));
  } else {
    await db.insert(schema.member).values({
      id: newId("mbr"),
      userId: target.id,
      storeId,
      role,
      createdAt: new Date(),
    });
  }

  return { userId: target.id, role };
}

/**
 * People the caller could add to this store: everyone who already works in one
 * of the *other* shops the caller owns, minus whoever is already here.
 *
 * Deliberately not a global user search. Matching against every account on the
 * platform would let any owner discover and attach users belonging to unrelated
 * businesses; "already in a shop I own" is both the useful set and the safe one.
 */
export async function listAttachableStaff(
  env: Env,
  callerUserId: string,
  storeId: string,
): Promise<{ userId: string; name: string; username: string | null; shops: number }[]> {
  const db = createDb(env.DB);

  const owned = await db
    .select({ storeId: schema.member.storeId })
    .from(schema.member)
    .where(and(eq(schema.member.userId, callerUserId), eq(schema.member.role, "owner")));

  const ownedIds = owned.map((o) => o.storeId).filter((id) => id !== storeId);
  if (ownedIds.length === 0) return [];

  const rows = await db
    .select({
      userId: schema.member.userId,
      name: schema.user.name,
      username: schema.user.displayUsername,
      storeId: schema.member.storeId,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(inArray(schema.member.storeId, ownedIds));

  const alreadyHere = new Set(
    (
      await db
        .select({ userId: schema.member.userId })
        .from(schema.member)
        .where(eq(schema.member.storeId, storeId))
    ).map((m) => m.userId),
  );

  // One row per person, with a count of how many of your shops they're in — the
  // same user appears once per shop in the join above.
  const byUser = new Map<string, { userId: string; name: string; username: string | null; shops: number }>();
  for (const r of rows) {
    if (alreadyHere.has(r.userId)) continue;
    const seen = byUser.get(r.userId);
    if (seen) seen.shops += 1;
    else byUser.set(r.userId, { userId: r.userId, name: r.name, username: r.username, shops: 1 });
  }

  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Attach an existing account to this store with a role, matched by username.
 *
 * Roles are per store, so the same person can be a manager in one shop and a
 * cashier in another. Re-attaching someone already here just updates their role.
 */
export async function attachMemberByUsername(
  env: Env,
  storeId: string,
  username: string,
  role: StoreRole,
): Promise<{ userId: string; role: StoreRole }> {
  const db = createDb(env.DB);
  const handle = username.trim().toLowerCase();

  const [target] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.username, handle))
    .limit(1);
  if (!target) {
    throw HttpError.notFound(
      `No account with the username "${handle}".`,
      "user_not_found",
    );
  }

  const existing = await memberRole(env, target.id, storeId);
  if (existing) {
    await db
      .update(schema.member)
      .set({ role })
      .where(and(eq(schema.member.userId, target.id), eq(schema.member.storeId, storeId)));
  } else {
    await db.insert(schema.member).values({
      id: newId("mbr"),
      userId: target.id,
      storeId,
      role,
      createdAt: new Date(),
    });
  }

  return { userId: target.id, role };
}

/** Revoke access. The owner can never be removed. */
export async function removeMember(env: Env, storeId: string, userId: string): Promise<void> {
  const db = createDb(env.DB);
  const [storeRow] = await db
    .select({ ownerId: schema.store.ownerId })
    .from(schema.store)
    .where(eq(schema.store.id, storeId))
    .limit(1);
  if (storeRow?.ownerId === userId) {
    throw HttpError.badRequest("The store owner cannot be removed", "cannot_remove_owner");
  }
  await db
    .delete(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.storeId, storeId)));
}
