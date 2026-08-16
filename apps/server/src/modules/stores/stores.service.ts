import { and, eq } from "drizzle-orm";
import type { StoreMembership, StoreRole } from "@gls-pos/types";
import { createDb, schema } from "../../db/index.js";
import { newId } from "../../lib/id.js";
import { HttpError } from "../../lib/http-error.js";
import type { Env } from "../../env.js";
import type { CreateStoreInput } from "./stores.schema.js";

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

/** Create a store and make the caller its owner. */
export async function createStore(
  env: Env,
  userId: string,
  input: CreateStoreInput,
): Promise<StoreMembership> {
  const db = createDb(env.DB);
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

/** Everyone with access to a store, for the Staff screen. */
export async function listMembers(env: Env, storeId: string) {
  const db = createDb(env.DB);
  return db
    .select({
      userId: schema.member.userId,
      name: schema.user.name,
      email: schema.user.email,
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
