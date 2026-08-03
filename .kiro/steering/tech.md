# Tech & Architecture — GLS-POS

## Stack

- **Monorepo:** Turborepo + pnpm workspaces. Node >= 22, pnpm >= 10.
- **Mobile:** Expo (React Native) with expo-router. iOS, Android, web from one
  codebase. TanStack Query for server state; better-auth (Expo client) for auth.
- **Backend:** Hono running on **Cloudflare Workers**.
- **Auth:** better-auth (email/password now; social later). The Expo plugin
  handles secure cookie storage and deep-link callbacks.
- **Shared types:** `@gls-pos/types` package consumed by both apps.
- **Money:** always integer minor units (cents). Never floats.

## Data architecture — hybrid (this is the important one)

We deliberately run **two tiers** of data because a restaurant POS has two very
different kinds of data.

### 1. Control plane — global database (Cloudflare D1)

One shared SQLite database (D1) for data that spans stores:

- **Auth** — better-auth `user`, `session`, `account`, `verification`. A person
  can belong to more than one restaurant, so identity is global.
- **Store / org registry** — which stores exist, who owns them, plan/settings.
  This is also the routing map: it tells the Worker which store Durable Object
  to talk to.
- **Membership** — `(userId, storeId, role)` linking people to stores.
- **Cross-store analytics rollups** — combined reporting for multi-location
  owners.

Accessed with **Drizzle ORM** (`drizzle-orm/d1`). Migrations via drizzle-kit,
applied with `wrangler d1 migrations apply`.

### 2. Data plane — one Durable Object (SQLite) per store

Each restaurant gets its own **Store Durable Object** (`idFromName(storeId)`)
with embedded SQLite (`ctx.storage.sql`). It owns that store's live operational
data: catalog, inventory, tables, orders, KOT/KDS.

Why per-store Durable Objects (not rows in a shared Postgres):

- **Single-writer consistency.** A DO processes one request at a time, so
  race-prone POS operations (seating a table, firing a KOT, decrementing stock)
  are safe without hand-rolled locking.
- **Real-time KDS/tables.** DOs do native (hibernatable) WebSockets — the store
  DO is the live coordination point every device in that restaurant connects to.
- **Offline-first fit.** The mobile app holds local SQLite and syncs; the store
  DO is the authoritative SQLite mirror. Sync is naturally scoped per store.
- **Isolation + blast radius.** One busy or broken store can't affect another.
  Scales horizontally to millions of stores.

### Request flow

1. Worker (Hono) authenticates the request via better-auth against **D1**.
2. It resolves the target `storeId` and checks the user's membership in **D1**.
3. It gets the store's DO stub (`env.STORE.get(env.STORE.idFromName(storeId))`)
   and calls a typed **RPC** method for catalog/order/table operations.
4. The DO reads/writes its own SQLite and returns the result.

### Rules of thumb

- Identity, ownership, and cross-store questions → **D1 (Drizzle)**.
- Anything scoped to a single store's daily operations → **Store DO (SQLite)**.
- Never put one store's operational data in the global DB, and never duplicate
  the user table into a DO.
- Server is authoritative for money/totals — compute them in the DO, never trust
  client-sent totals.

## Local development

- `wrangler dev` runs the Worker, local D1, and DOs on your machine (no
  Cloudflare login needed for local mode).
- Secrets in `.dev.vars` locally; `wrangler secret put` in production.
- `wrangler types` regenerates binding types into `worker-configuration.d.ts`.

## Conventions

- API envelope is always `ApiResult<T>` (`{ ok: true, data }` or
  `{ ok: false, error }`).
- Request validation with zod at the route boundary; business logic in services
  / the DO, free of HTTP concerns.
- Prefer typed DO **RPC** methods over ad-hoc `fetch` between Worker and DO.
