import { and, eq } from "drizzle-orm";
import type { StoreMembership, StoreRole } from "@gls-pos/types";
import { createDb, schema } from "../../db/index.js";
import { newId } from "../../lib/id.js";
import type { Env } from "../../env.js";
import type { CreateStoreInput } from "./stores.schema.js";

/**
 * Control-plane store registry & membership logic (Cloudflare D1 via Drizzle).
 * The store's operational data lives in its Durable Object; this service only
 * answers ownership/identity questions and provisions the registry rows.
 */

/** Stores the given user belongs to, with their role in each. */
export async function listStoresForUser(
  env: Env,
  userId: string,
): Promise<StoreMembership[]> {
  const db = createDb(env.DB);
  const rows = await db
    .select({
      id: schema.store.id,
      name: schema.store.name,
      currency: schema.store.currency,
      role: schema.storeMember.role,
    })
    .from(schema.storeMember)
    .innerJoin(schema.store, eq(schema.storeMember.storeId, schema.store.id))
    .where(eq(schema.storeMember.userId, userId));

  return rows.map((r) => ({ ...r, role: r.role as StoreRole }));
}

/** True when the user is a member of the store. Used by the store middleware. */
export async function isMember(
  env: Env,
  userId: string,
  storeId: string,
): Promise<boolean> {
  const db = createDb(env.DB);
  const [row] = await db
    .select({ id: schema.storeMember.id })
    .from(schema.storeMember)
    .where(
      and(
        eq(schema.storeMember.userId, userId),
        eq(schema.storeMember.storeId, storeId),
      ),
    )
    .limit(1);
  return !!row;
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

  return {
    id: storeId,
    name: input.name,
    currency: input.currency,
    role: "owner",
  };
}
