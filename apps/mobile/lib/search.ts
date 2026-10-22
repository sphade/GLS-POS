/**
 * Catalog search keys.
 *
 * Every keystroke in the item search re-filters the whole catalog, and the
 * comparison itself was the expensive part: `item.name.toLowerCase()` allocated a
 * new string for every product on every pass. On a few hundred items, on the kind
 * of hardware a till actually runs, that lands on the same thread as the keyboard
 * and the taps.
 *
 * Catalog objects are replaced only when their contents change — `mergeInPlace`
 * deliberately hands back the previous object otherwise — so the lowered name can
 * be cached against the object itself and reused across passes. A WeakMap means
 * an item that leaves the catalog takes its entry with it, so nothing has to be
 * invalidated by hand.
 */

const loweredNames = new WeakMap<object, string>();

/** Lower-cased product name, computed once per catalog object. */
export function searchKeyOf(item: { name: string }): string {
  const cached = loweredNames.get(item);
  if (cached !== undefined) return cached;
  const lowered = item.name.toLowerCase();
  loweredNames.set(item, lowered);
  return lowered;
}

/**
 * Whether an item matches a search term.
 *
 * `term` is expected to be already trimmed and lower-cased by the caller, which
 * does it once per pass rather than once per item.
 */
export function itemMatchesSearch(item: { name: string }, term: string): boolean {
  return term.length === 0 || searchKeyOf(item).includes(term);
}

/**
 * Lenient match for short picker lists (choose a product, a store, an item).
 *
 * Starts with the same substring test, then falls back to "every character of
 * the query appears in order" so a half-remembered label still finds its row —
 * "rce" and "rice bag" both land on "Rice — 50kg bag". Order-sensitive on
 * purpose: it is cheap, predictable, and good enough for a few hundred rows.
 * `query` is expected to be trimmed and lower-cased by the caller.
 */
export function fuzzyMatches(text: string, query: string): boolean {
  if (query.length === 0) return true;
  const haystack = text.toLowerCase();
  if (haystack.includes(query)) return true;

  let cursor = 0;
  for (const char of query) {
    if (char === " ") continue;
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return false;
    cursor = found + 1;
  }
  return true;
}
