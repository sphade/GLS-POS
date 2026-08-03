import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.js";

/** Create a Drizzle client bound to the request's D1 database. */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type DB = ReturnType<typeof createDb>;
export { schema };
