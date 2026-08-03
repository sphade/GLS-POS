/**
 * Generate a prefixed, collision-resistant identifier, e.g. `prod_a1b2c3...`.
 * Uses the Web Crypto `crypto` global, available in Workers and Node 22+.
 */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
