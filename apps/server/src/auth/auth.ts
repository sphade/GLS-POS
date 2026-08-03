import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb, schema } from "../db/index.js";
import type { Env } from "../env.js";

/**
 * Build a better-auth instance for the current request. On Workers the D1
 * binding only exists per-request (inside `fetch`), so auth must be created
 * per-request rather than at module load.
 *
 * Persists to the control-plane D1 database via the Drizzle adapter. The Expo
 * plugin enables secure cookie storage and deep-link callbacks for the mobile
 * client; `trustedOrigins` must include the app scheme (app.json → "glspos").
 */
export function createAuth(env: Env) {
  const db = createDb(env.DB);
  const isDev = env.ENVIRONMENT !== "production";

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: {
      enabled: true,
    },
    trustedOrigins: [
      "glspos://",
      "glspos://*",
      ...(isDev ? ["exp://", "exp://**"] : []),
    ],
    plugins: [expo()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
