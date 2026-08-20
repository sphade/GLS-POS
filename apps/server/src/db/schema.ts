import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Control-plane schema (Cloudflare D1). Holds cross-store data only:
 * better-auth tables + the store registry + memberships. Per-store operational
 * data (catalog, orders, tables) lives in each store's Durable Object, NOT here.
 *
 * The `user` / `session` / `account` / `verification` tables match better-auth's
 * expected schema so its Drizzle adapter can use them directly.
 */

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /**
   * Required by better-auth. For staff accounts this is a synthesised internal
   * address (`<username>@staff.gls.local`) because they sign in with a username.
   */
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  /** Added by the better-auth username plugin: the login handle (lower-cased). */
  username: text("username").unique(),
  /** The handle as typed, preserving capitalisation for display. */
  displayUsername: text("display_username"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// --- Store registry & membership (control plane) ---------------------------

/**
 * A restaurant/store. Its operational data lives in a Durable Object keyed by id.
 *
 * The profile fields below are control-plane on purpose: they identify the
 * business rather than describe a day's trading, and receipts need them even on
 * a device that has never synced the store's DO.
 */
export const store = sqliteTable("store", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("USD"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  /** Street address, printed on receipts. */
  address: text("address"),
  /** Contact number for customers, printed on receipts. */
  phone: text("phone"),
  /** Optional line above the itemisation, e.g. a tagline or RC number. */
  receiptHeader: text("receipt_header"),
  /** Optional line below the total, e.g. "Thank you, come again". */
  receiptFooter: text("receipt_footer"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/**
 * Expo push tokens for staff devices, so the server can alert a locked/closed
 * phone when a VIP order arrives. One row per device per store; the token is
 * the natural key because Expo reissues it per install.
 */
export const pushToken = sqliteTable("push_token", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  storeId: text("store_id")
    .notNull()
    .references(() => store.id, { onDelete: "cascade" }),
  platform: text("platform"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/**
 * API keys for external systems (delivery apps, marketplaces, dashboards).
 *
 * Only a SHA-256 hash of the secret is stored, so a database leak can't be
 * replayed against the API. The plaintext key is shown once at creation.
 * `scopes` is a comma-separated allowlist, e.g. "catalog:read,stock:write".
 */
export const apiKey = sqliteTable("api_key", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => store.id, { onDelete: "cascade" }),
  /** Human label, e.g. "Chowdeck integration". */
  name: text("name").notNull(),
  /** First few chars of the key, for identifying it in a list. */
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  scopes: text("scopes").notNull(),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  /** Set when revoked; revoked keys are kept for audit rather than deleted. */
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
});

/**
 * Outbound webhooks. Lets an external system be told about stock changes and
 * orders instead of polling. Deliveries are signed with HMAC-SHA256 over the
 * body using `secret`, sent in the `x-gls-signature` header.
 */
export const webhook = sqliteTable("webhook", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => store.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  /** Comma-separated event names, or "*" for everything. */
  events: text("events").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  /** Consecutive failures; used to disable a persistently broken endpoint. */
  failureCount: integer("failure_count").notNull().default(0),
  lastStatus: integer("last_status"),
  lastAttemptAt: integer("last_attempt_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** Links a user to a store with a role. */
export const member = sqliteTable("member", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  storeId: text("store_id")
    .notNull()
    .references(() => store.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("owner"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
