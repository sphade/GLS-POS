import { roleCan, type StoreRole, type SyncChange, type SyncCollection } from "@gls-pos/types";
import type { Env } from "../../env.js";
import type { StockActor, PushResult } from "../../durable-objects/store.do.js";

/**
 * Copy a shop's menu (categories, products, modifiers) into another shop the
 * same person can write to.
 *
 * Written for opening a new branch: standing up "Gls kitchen ORA" by hand means
 * re-typing every item and price. The copy reuses the normal `push` path rather
 * than writing documents straight into the Durable Object, so every row passes
 * the same authorization and money checks a device's upload would — a copy can
 * never leave a store in a state a till could not have produced.
 *
 * Rows keep their ids. That keeps `categoryId`, `modifierIds` and variant ids
 * pointing at the copied documents, and makes running the copy twice an update
 * rather than a duplicate.
 *
 * Stock is deliberately NOT copied. A branch's shelf is its own: carrying over
 * the source's quantities would either hide items as "unavailable" or invent
 * stock the branch does not have. Products arrive as not-stock-tracked, which
 * means sellable immediately; the branch sets quantities afterwards.
 */
const CATALOG_COLLECTIONS = ["categories", "products", "modifiers"] as const;

/** Hard stop so a runaway copy cannot loop forever inside one request. */
const MAX_PAGES = 200;
const PAGE_SIZE = 500;

export type CopyCatalogResult = {
  fromStoreId: string;
  toStoreId: string;
  categories: number;
  products: number;
  modifiers: number;
  /** Rows the destination refused (role limits, or a newer local edit won). */
  refused: number;
};

type SourceRow = {
  collection: string;
  id: string;
  data: string;
  updated_at: number;
  deleted: number;
  server_seq: number;
};

/**
 * Rewrite the fields that are store-scoped or branch-specific before writing.
 * Everything else — prices, variants, modifiers, tax, ordering — is copied as
 * it stands.
 */
function rewriteForTarget(collection: string, raw: string, toStoreId: string): string {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return raw;
  }
  if (!doc || typeof doc !== "object") return raw;

  if ("storeId" in doc) doc.storeId = toStoreId;

  if (collection === "products") {
    // The branch tracks its own stock; see the note above.
    doc.stockQuantity = null;
    if (Array.isArray(doc.variants)) {
      doc.variants = doc.variants.map((variant) => {
        if (!variant || typeof variant !== "object") return variant;
        const next = { ...(variant as Record<string, unknown>) };
        delete next.stock;
        return next;
      });
    }
  }

  return JSON.stringify(doc);
}

export async function copyCatalog(
  env: Env,
  input: {
    fromStoreId: string;
    toStoreId: string;
    /** The caller's role in the DESTINATION store; every row is checked against it. */
    role: StoreRole;
    actor: StockActor;
  },
): Promise<CopyCatalogResult> {
  const source = env.STORE.get(env.STORE.idFromName(input.fromStoreId));
  const target = env.STORE.get(env.STORE.idFromName(input.toStoreId));

  const counts: Record<string, number> = { categories: 0, products: 0, modifiers: 0 };
  let refused = 0;
  let after = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { rows } = await source.adminExportCollections(
      [...CATALOG_COLLECTIONS],
      after,
      PAGE_SIZE,
    );
    if (rows.length === 0) break;

    const page_ = rows as SourceRow[];
    after = page_[page_.length - 1]!.server_seq;

    const changes: SyncChange[] = page_
      .filter((row) =>
        (CATALOG_COLLECTIONS as readonly string[]).includes(row.collection),
      )
      .map((row) => ({
        collection: row.collection as SyncCollection,
        id: row.id,
        data: JSON.parse(rewriteForTarget(row.collection, row.data, input.toStoreId)) as unknown,
        updatedAt: row.updated_at,
        deleted: row.deleted === 1,
      }));

    if (changes.length > 0) {
      const result: PushResult = await target.push(
        { cursor: 0, changes },
        input.role,
        input.actor,
        { partial: true, skipPull: true },
      );
      refused += result.deniedIds.length;
      for (const row of page_) {
        if (!(row.collection in counts)) continue;
        const wasRefused = result.deniedIds.some(
          (denied) => denied.collection === row.collection && denied.id === row.id,
        );
        if (!wasRefused) counts[row.collection] = (counts[row.collection] ?? 0) + 1;
      }
    }

    if (page_.length < PAGE_SIZE) break;
  }

  return {
    fromStoreId: input.fromStoreId,
    toStoreId: input.toStoreId,
    categories: counts.categories ?? 0,
    products: counts.products ?? 0,
    modifiers: counts.modifiers ?? 0,
    refused,
  };
}

/** Whether this role may read a shop's menu at all (source-side check). */
export function canReadCatalog(role: StoreRole | null): boolean {
  return !!role && roleCan(role, "catalog:read");
}
