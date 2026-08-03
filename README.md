# GLS-POS

A Zobaze-style point of sale system built as a Turborepo monorepo.

The design treats the POS as the **single source of truth** for catalog,
inventory, and sales. Every sale — in-store, phone, online, or delivery —
becomes a channel-agnostic `Order` against the same catalog, which is the
pattern used by systems like Square and Toast.

## Structure

```
GLS-POS/
├── apps/
│   ├── mobile/        Expo app (POS front-end, iOS/Android/web)
│   └── server/        Hono API backend (Node)
├── packages/
│   ├── types/         Shared POS domain types
│   └── typescript-config/  Shared tsconfig bases
├── turbo.json
└── pnpm-workspace.yaml
```

## Prerequisites

- Node >= 22
- pnpm >= 10

## Getting started

```bash
pnpm install

# run everything (server + mobile) via turbo
pnpm dev

# or run individually
pnpm --filter @gls-pos/server dev     # Hono API on http://localhost:8787
pnpm --filter @gls-pos/mobile dev     # Expo dev server
```

## API (skeleton)

Base URL: `http://localhost:8787/api`

| Method | Path             | Description             |
| ------ | ---------------- | ----------------------- |
| GET    | `/products`      | List products           |
| POST   | `/products`      | Create a product        |
| GET    | `/orders`        | List orders             |
| POST   | `/orders`        | Create an order         |

Data is currently held in memory. Swap `apps/server/src/store.ts` for a real
database (e.g. Drizzle + SQLite/Postgres) to add persistence.

## Roadmap

- [ ] Persistence (Drizzle + database)
- [ ] Auth (staff roles / permissions)
- [ ] Checkout screen + cart on mobile
- [ ] Receipts (print / share)
- [ ] Offline-first sync
- [ ] Delivery-channel order ingestion
```
