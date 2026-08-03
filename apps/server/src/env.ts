import type { StoreDurableObject } from "./durable-objects/store.do.js";

/**
 * Cloudflare Worker bindings. Mirrors the bindings declared in wrangler.jsonc.
 * Regenerate types after changing bindings with `pnpm cf-typegen`.
 */
export interface Env {
  /** Control-plane D1 database: auth, store registry, memberships. */
  DB: D1Database;
  /** Per-store Durable Object namespace (SQLite-backed operational data). */
  STORE: DurableObjectNamespace<StoreDurableObject>;
  /** better-auth signing/encryption secret (Worker secret). */
  BETTER_AUTH_SECRET: string;
  /** Public base URL of this auth server (var). */
  BETTER_AUTH_URL: string;
  /** "development" | "production" — controls error verbosity. */
  ENVIRONMENT?: string;
}
