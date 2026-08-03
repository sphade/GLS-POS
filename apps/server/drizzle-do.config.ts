import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for the per-store Durable Object SQLite schema.
 * `driver: "durable-sqlite"` makes `generate` emit an importable migrations
 * bundle that the DO applies at startup via drizzle-orm/durable-sqlite/migrator.
 *
 *   pnpm db:generate:do
 */
export default defineConfig({
  schema: "./src/durable-objects/schema.ts",
  out: "./src/durable-objects/migrations",
  dialect: "sqlite",
  driver: "durable-sqlite",
});
