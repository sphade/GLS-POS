import { and, eq } from "drizzle-orm";
import type { StoreRole } from "@gls-pos/types";
import { createDb, schema } from "../../db/index.js";
import { newId } from "../../lib/id.js";
import { HttpError } from "../../lib/http-error.js";
import type { Auth } from "../../auth/auth.js";
import type { Env } from "../../env.js";

/**
 * Owner-provisioned staff accounts.
 *
 * Restaurant staff sign in with a username and password — most don't have a
 * work email, and making them self-register would be a terrible closing-shift
 * experience. The owner types their name and a password and hands them the
 * credentials.
 *
 * better-auth requires an email internally, so we synthesise one from the
 * username. It's never used for delivery or shown in the app.
 */

const STAFF_EMAIL_DOMAIN = "staff.gls.local";

/** "Tunde A." -> "tunde.a" — a sensible default handle from a person's name. */
export function usernameFromName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 24);
  return base.length >= 3 ? base : `${base}.staff`;
}

const emailFor = (username: string) => `${username}@${STAFF_EMAIL_DOMAIN}`;

/**
 * Create a staff user and attach them to the store with a role.
 *
 * Uses better-auth's own sign-up so the password is hashed exactly as it is for
 * any other account — we never touch password storage ourselves.
 */
export async function createStaffAccount(
  env: Env,
  auth: Auth,
  input: {
    storeId: string;
    name: string;
    username: string;
    password: string;
    role: StoreRole;
  },
): Promise<{ userId: string; username: string }> {
  const handle = input.username.trim().toLowerCase();
  const db = createDb(env.DB);

  // Give a clear error rather than better-auth's generic one.
  const [taken] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.username, handle))
    .limit(1);
  if (taken) {
    throw HttpError.conflict(
      `The username "${handle}" is already taken. Try another.`,
      "username_taken",
    );
  }

  let created: { user?: { id: string } } | null = null;
  try {
    created = await auth.api.signUpEmail({
      body: {
        name: input.name.trim(),
        email: emailFor(handle),
        password: input.password,
        username: handle,
        displayUsername: input.username.trim(),
      } as never,
    });
  } catch (e) {
    throw HttpError.badRequest(
      (e as Error).message || "Could not create that staff account",
      "staff_create_failed",
    );
  }

  const userId = created?.user?.id;
  if (!userId) {
    throw HttpError.badRequest("Could not create that staff account", "staff_create_failed");
  }

  // D1 has no cross-statement transaction here, so if attaching them to the
  // store fails we remove the account again — an orphaned user would hold the
  // username hostage and the owner could never retry with the same handle.
  try {
    await db.insert(schema.member).values({
      id: newId("mbr"),
      userId,
      storeId: input.storeId,
      role: input.role,
      createdAt: new Date(),
    });
  } catch (e) {
    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteUser(userId).catch(() => {});
    throw HttpError.badRequest(
      (e as Error).message || "Could not add that staff member to the store",
      "staff_create_failed",
    );
  }

  return { userId, username: handle };
}

/**
 * Reset a staff member's password. Owner-only (enforced at the route) — this is
 * the realistic recovery path when someone forgets their login, since there's no
 * email to send a reset link to.
 */
export async function setStaffPassword(
  env: Env,
  auth: Auth,
  input: { storeId: string; userId: string; password: string },
): Promise<void> {
  const db = createDb(env.DB);

  // Scope to the caller's store: an owner may only reset passwords for their
  // own staff, never for someone who happens to work at a different store.
  const [membership] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(eq(schema.member.userId, input.userId), eq(schema.member.storeId, input.storeId)),
    )
    .limit(1);
  if (!membership) throw HttpError.notFound("That staff member was not found", "not_a_member");

  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(input.password);
  await ctx.internalAdapter.updatePassword(input.userId, hashed);

  // A forced reset usually means "that person shouldn't be signed in any more"
  // (lost phone, someone shared the password), so drop their live sessions too.
  await ctx.internalAdapter.deleteUserSessions(input.userId);
}
