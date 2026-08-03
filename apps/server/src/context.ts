import type { Env } from "./env.js";
import type { AuthVariables } from "./middleware/auth.js";
import type { StoreVariables } from "./middleware/store.js";

/**
 * Shared Hono generic for the whole app: Worker bindings plus the context
 * variables set by middleware (auth session + resolved store stub).
 */
export type AppEnv = {
  Bindings: Env;
  Variables: AuthVariables & StoreVariables;
};
