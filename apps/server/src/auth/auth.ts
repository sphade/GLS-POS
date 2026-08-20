import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { username } from "better-auth/plugins";
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

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: {
      enabled: true,
    },
    /**
     * The Expo client sends its origin in `expo-origin`, which the server-side
     * expo plugin copies into `origin`. That value is
     * `Linking.createURL("", { scheme })`, so it differs per platform:
     *   dev client / store build → glspos:///
     *   Expo Go                  → exp://<lan-ip>:8081/--/
     *   web                       → the page origin, e.g. http://localhost:8081
     *
     * Expo Go and web dev servers are trusted unconditionally, not just when
     * ENVIRONMENT is "development": the mobile app defaults to the deployed
     * Worker (see lib/auth-client.ts), so day-to-day development authenticates
     * against production. Omitting them means sign-in fails with
     * MISSING_OR_NULL_ORIGIN on every device that isn't a compiled build.
     *
     * WEB_ORIGIN is the deployed web build's origin, when there is one.
     */
    trustedOrigins: [
      "glspos://",
      "glspos://*",
      "exp://",
      "exp://*",
      "http://localhost:*",
      "http://127.0.0.1:*",
      ...(env.WEB_ORIGIN ? [env.WEB_ORIGIN] : []),
    ],
    plugins: [
      expo(),
      /**
       * Staff sign in with a username, not an email — waiters and cashiers in a
       * restaurant generally don't have work email addresses, and the owner
       * provisions their accounts directly (see modules/staff).
       *
       * better-auth still requires an email internally, so account creation
       * synthesises one (`<username>@staff.gls.local`). It's never shown or used
       * for delivery; the username is the real credential.
       */
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        // Match the Staff screen and route validator. Without this override the
        // plugin's default rejects dots and dashes even though the UI offers
        // handles such as "tunde.adeyemi".
        usernameValidator: (value) => /^[a-zA-Z0-9._-]+$/.test(value),
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
