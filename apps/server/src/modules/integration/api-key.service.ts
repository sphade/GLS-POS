import { and, eq, isNull } from "drizzle-orm";
import type { ApiScope } from "@gls-pos/types";
import { createDb, schema } from "../../db/index.js";
import { newId } from "../../lib/id.js";
import type { Env } from "../../env.js";

/**
 * API key issuing and verification for the public integration API.
 *
 * Keys look like `gls_live_<32 random chars>`. Only a SHA-256 hash is stored,
 * so the plaintext is unrecoverable — it's shown once at creation and never
 * again. Verification hashes the presented key and looks that up, which is a
 * constant-time-ish single indexed read.
 */

const PREFIX = "gls_live_";

/** URL-safe random secret. */
function randomSecret(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf)).replace(/[+/=]/g, "").slice(0, 32);
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type IssuedKey = {
  id: string;
  name: string;
  /** Full key — the ONLY time this is available. */
  key: string;
  prefix: string;
  scopes: ApiScope[];
};

/** Create a key for a store. Returns the plaintext once. */
export async function issueApiKey(
  env: Env,
  input: { storeId: string; name: string; scopes: ApiScope[]; createdBy?: string },
): Promise<IssuedKey> {
  const secret = randomSecret();
  const key = `${PREFIX}${secret}`;
  const id = newId("ak");

  await createDb(env.DB)
    .insert(schema.apiKey)
    .values({
      id,
      storeId: input.storeId,
      name: input.name,
      // Enough to recognise the key in a list without revealing it.
      prefix: key.slice(0, PREFIX.length + 6),
      keyHash: await sha256(key),
      scopes: input.scopes.join(","),
      createdBy: input.createdBy,
      createdAt: new Date(),
    });

  return { id, name: input.name, key, prefix: key.slice(0, PREFIX.length + 6), scopes: input.scopes };
}

export type VerifiedKey = { id: string; storeId: string; name: string; scopes: ApiScope[] };

/** Resolve a presented key, or null when unknown/revoked. */
export async function verifyApiKey(env: Env, presented: string): Promise<VerifiedKey | null> {
  if (!presented.startsWith(PREFIX)) return null;
  const db = createDb(env.DB);
  const hash = await sha256(presented);

  const [row] = await db
    .select({
      id: schema.apiKey.id,
      storeId: schema.apiKey.storeId,
      name: schema.apiKey.name,
      scopes: schema.apiKey.scopes,
    })
    .from(schema.apiKey)
    .where(and(eq(schema.apiKey.keyHash, hash), isNull(schema.apiKey.revokedAt)))
    .limit(1);

  if (!row) return null;

  // Best-effort usage stamp; never block the request on it.
  void db
    .update(schema.apiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKey.id, row.id))
    .catch(() => undefined);

  return { ...row, scopes: row.scopes.split(",").filter(Boolean) as ApiScope[] };
}

/** Keys for a store (never includes the secret). */
export async function listApiKeys(env: Env, storeId: string) {
  return createDb(env.DB)
    .select({
      id: schema.apiKey.id,
      name: schema.apiKey.name,
      prefix: schema.apiKey.prefix,
      scopes: schema.apiKey.scopes,
      createdAt: schema.apiKey.createdAt,
      lastUsedAt: schema.apiKey.lastUsedAt,
      revokedAt: schema.apiKey.revokedAt,
    })
    .from(schema.apiKey)
    .where(eq(schema.apiKey.storeId, storeId));
}

/** Revoke rather than delete, so the audit trail survives. */
export async function revokeApiKey(env: Env, storeId: string, keyId: string): Promise<void> {
  await createDb(env.DB)
    .update(schema.apiKey)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKey.id, keyId), eq(schema.apiKey.storeId, storeId)));
}
