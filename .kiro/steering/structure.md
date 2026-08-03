# Project Structure — GLS-POS

Turborepo monorepo. Two apps, shared packages.

```
GLS-POS/
├── apps/
│   ├── mobile/                 Expo app (POS front-end)
│   │   ├── app/                expo-router screens
│   │   ├── lib/                api client, auth client, query client
│   │   └── ...
│   └── server/                 Hono API on Cloudflare Workers
│       ├── src/
│       │   ├── index.ts        Worker entry: exports { fetch } + DO classes
│       │   ├── app.ts          Hono app factory (env-aware)
│       │   ├── env.ts          Bindings type + helpers
│       │   ├── auth/           better-auth instance factory (D1)
│       │   ├── db/             Drizzle client + control-plane schema
│       │   ├── durable-objects/ StoreDurableObject (per-store SQLite)
│       │   ├── middleware/     auth/session, error handling
│       │   ├── lib/            response envelope, errors, ids, validation
│       │   └── modules/        feature modules (products, orders, ...)
│       ├── migrations/         D1 SQL migrations (drizzle-kit output)
│       ├── wrangler.jsonc      Worker + D1 + DO bindings
│       └── drizzle.config.ts
├── packages/
│   ├── types/                  @gls-pos/types — shared domain types
│   └── typescript-config/      shared tsconfig bases
├── turbo.json
└── pnpm-workspace.yaml
```

## Where things go

- **Shared domain types** (`Product`, `Order`, ...) → `packages/types`. Both apps
  import from `@gls-pos/types`.
- **A new backend feature area** (tables, kitchen, staff, ...) → a folder under
  `apps/server/src/modules/<feature>` with `*.schema.ts` (zod), `*.service.ts`
  (logic), `*.routes.ts` (Hono). Mount it in `app.ts`.
- **Per-store operational tables** (catalog, orders, tables, KOT) → SQLite inside
  `StoreDurableObject`.
- **Global/control-plane tables** (auth, stores, memberships) → Drizzle schema in
  `apps/server/src/db`, migrated into D1.
- **Mobile screens** → `apps/mobile/app` (file-based routing). Client-only helpers
  → `apps/mobile/lib`.

## Module layering (backend)

Route (validate) → Service / DO RPC (business logic + persistence). Routes never
contain business logic; services and the DO never contain HTTP concerns.

## Naming

- Files: kebab-case (`orders.service.ts`, `store.do.ts`).
- IDs: prefixed (`prod_`, `order_`, `store_`).
- Env bindings: SCREAMING_SNAKE (`DB`, `STORE`, `BETTER_AUTH_SECRET`).
