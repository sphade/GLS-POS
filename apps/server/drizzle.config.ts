import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for the control-plane schema. `generate` emits SQL
 * migrations into ./migrations, which are applied to D1 with:
 *   wrangler d1 migrations apply gls-pos-control --local   (local)
 *   wrangler d1 migrations apply gls-pos-control --remote  (production)
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
});
