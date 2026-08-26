import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Item } from "./cart";
import { mockItems, categories as MENU_CATEGORIES } from "./mock-items";
import { ITEM_IMAGES } from "./item-images";
import { loadImageIds, saveImage } from "./image-store";
import { logAudit } from "./audit";
import { SYNC_ENABLED, onSynced } from "./sync";
import {
  getActiveStore,
  loadAll,
  markAllDirty,
  put as dbPut,
  resetCollection,
  seedOnce,
  softDelete,
} from "./db";

/** Colour palette auto-assigned to new categories/items. */
export const swatches = [
  "#EF3E36", "#8D6E63", "#EF6C00", "#C62828", "#F9A825",
  "#6D4C41", "#0277BD", "#2E7D32", "#6A1B9A", "#00838F",
];

export type Category = { id: string; name: string; color: string };
export type ModifierOption = { id: string; name: string; price: number };
export type ModifierGroup = {
  id: string;
  name: string;
  required: boolean;
  multiSelect: boolean;
  options: ModifierOption[];
};
export type Ingredient = { id: string; name: string; unit: string; stock: number; lowAt: number };
export type Table = { id: string; name: string; section: string; seats: number; reference?: string };
export type Customer = { id: string; name: string; phone?: string; email?: string; address?: string; due: number };
export type StaffMember = { id: string; name: string; role: string; phone?: string; active: boolean };

/** Why stock moved. Every change to a tracked item's stock writes one of these. */
export type StockMovementReason = "sale" | "adjustment" | "initial" | "restock";
export type StockMovement = {
  id: string;
  productId: string;
  productName: string;
  /** Selected variant snapshot; absent for simple products. */
  variantId?: string;
  variantName?: string;
  reason: StockMovementReason;
  /** signed change, e.g. -2 for a sale of 2, +10 for a restock */
  delta: number;
  /** stock level after this movement */
  resulting: number;
  at: number;
  /** optional link, e.g. a receipt id for sales */
  ref?: string;
};

const uid = (p: string) => `${p}_${Date.now()}_${Math.round(Math.random() * 1e4)}`;

/** Singular, human label per collection for audit summaries. */
const ENTITY_LABEL: Record<string, string> = {
  products: "item",
  categories: "category",
  modifiers: "modifier",
  ingredients: "ingredient",
  tables: "table",
  customers: "customer",
  staff: "staff member",
};

/** Record a create/update/delete of a catalog entity in the audit trail. */
function auditEntity(collection: string, verb: "create" | "update" | "delete", id: string, name?: string) {
  const label = ENTITY_LABEL[collection] ?? collection;
  const past = verb === "create" ? "Created" : verb === "update" ? "Updated" : "Deleted";
  logAudit({
    action: `${collection}.${verb}`,
    entity: collection,
    entityId: id,
    summary: `${past} ${label}${name ? ` "${name}"` : ""}`,
  });
}

// --- First-run defaults ----------------------------------------------------

/** Categories mirror the real GLS menu (see mock-items.ts). */
const DEFAULT_CATEGORIES: Category[] = MENU_CATEGORIES;

// No demo modifiers or ingredients — a real store defines its own. Earlier
// builds seeded examples (Add-ons, Spice level; Rice, Chicken …); those are
// cleaned up on existing devices by cleanupDemoData below.
const DEFAULT_MODIFIERS: ModifierGroup[] = [];

const DEFAULT_INGREDIENTS: Ingredient[] = [];

const DEFAULT_TABLES: Table[] = [
  { id: "t1", name: "TABLE - GLS 2", section: "DEFAULT ALL", seats: 4, reference: "234" },
  { id: "t2", name: "TABLE - GLS 3", section: "DEFAULT ALL", seats: 2, reference: "235" },
  { id: "t3", name: "VIP 1", section: "VIP", seats: 6, reference: "301" },
];

// No demo customers or staff — a real store starts empty and adds its own.
// (Earlier builds seeded fake people like "Ada Obi" / "Tunde A."; those are
//  cleaned up on existing devices by cleanupDemoData below.)
const DEFAULT_CUSTOMERS: Customer[] = [];

const DEFAULT_STAFF: StaffMember[] = [];

/**
 * Write the starter data into the ACTIVE store's database once.
 *
 * ⛔ SYNC-ENABLED BUILDS NEVER SEED. The SERVER is the single source of truth:
 * a fresh install starts empty and pulls the real menu/tables/history down.
 * Client-side seeding was the root cause of two nasty bugs — fresh installs
 * displayed default stock (10) over newer server values, and re-seeded default
 * tables resurrected deleted ones by out-timestamping their tombstones.
 * Seeding now exists ONLY for the offline demo mode (sync off).
 */
function seedStore() {
  if (SYNC_ENABLED) return;
  // Before sign-in the store is a placeholder; don't seed (or later download 62
  // images into) a throwaway database.
  if (!isRealStore()) return;

  seedOnce("catalog_seeded_gls_v3", () => {
    // v3 moved photos out of the product document into `product_images`, so the
    // old rows (which carried base64 inline) are cleared out entirely.
    (
      [
        "products",
        "categories",
        "modifiers",
        "ingredients",
        "tables",
        "customers",
        "staff",
        "product_images",
      ] as const
    ).forEach(resetCollection);
    // Seeded rows are written DIRTY so the first sync uploads them to the store's
    // Durable Object. Writing them clean (as an earlier version did) meant the
    // server never received the catalog or tables — which silently broke the VIP
    // page, since it reads the menu and validates the table server-side.
    DEFAULT_CATEGORIES.forEach((c) => dbPut("categories", c));
    DEFAULT_MODIFIERS.forEach((m) => dbPut("modifiers", m));
    DEFAULT_INGREDIENTS.forEach((i) => dbPut("ingredients", i));
    DEFAULT_TABLES.forEach((t) => dbPut("tables", t));
    DEFAULT_CUSTOMERS.forEach((c) => dbPut("customers", c));
    DEFAULT_STAFF.forEach((s) => dbPut("staff", s));
    // Attach the source image URL; first launch hydrates it into a stored image.
    mockItems.forEach((p) => {
      dbPut("products", { ...p, imageUrl: ITEM_IMAGES[p.name] });
      // Opening stock is recorded as an "initial" movement. The server rebuilds
      // stock from the movement log (never from a product's absolute value), so
      // without this the seeded stock would reset to zero on first sync.
      //
      // The ID is DETERMINISTIC (product-derived, not random): several devices
      // each seed their own copy and push it, and with random IDs the server
      // would apply every device's +N as fresh stock — ten phones meant
      // "10 × N items in stock". With one stable id per product, replays
      // collapse server-side into exactly one applied delta.
      if (typeof p.stockQuantity === "number" && p.stockQuantity !== 0) {
        dbPut<StockMovement>("stock_movements", {
          id: `mov_initial_${p.id}`,
          productId: p.id,
          productName: p.name,
          reason: "initial",
          delta: p.stockQuantity,
          resulting: p.stockQuantity,
          at: Date.now(),
        });
      }
    });
  });
}

type CatalogState = {
  products: Item[];
  categories: Category[];
  modifiers: ModifierGroup[];
  ingredients: Ingredient[];
  tables: Table[];
  sections: string[];
  customers: Customer[];
  staff: StaffMember[];

  upsertProduct: (p: Partial<Item> & { name: string; price: number }) => Item;
  deleteProduct: (id: string) => void;
  upsertCategory: (c: Partial<Category> & { name: string }) => Category;
  deleteCategory: (id: string) => void;
  upsertModifier: (m: Partial<ModifierGroup> & { name: string }) => ModifierGroup;
  deleteModifier: (id: string) => void;
  upsertIngredient: (i: Partial<Ingredient> & { name: string }) => Ingredient;
  deleteIngredient: (id: string) => void;
  upsertTable: (t: Partial<Table> & { name: string }) => Table;
  deleteTable: (id: string) => void;
  upsertCustomer: (c: Partial<Customer> & { name: string }) => Customer;
  deleteCustomer: (id: string) => void;
  upsertStaff: (s: Partial<StaffMember> & { name: string }) => StaffMember;
  deleteStaff: (id: string) => void;

  /** Decrement stock for tracked items sold, logging a movement per line. */
  recordSale: (lines: { productId: string; variantId?: string; qty: number }[], ref?: string) => void;
  /** Log a manual stock change (adjustment/initial/restock). Does not itself
   *  write the product; the caller has already persisted the new quantity.
   *  Pass `variant` when the change is to a specific variant's stock. */
  logStockChange: (
    product: Item,
    delta: number,
    reason: StockMovementReason,
    resulting: number,
    variant?: { id: string; name: string },
  ) => void;
};

/**
 * Products whose image we've already tried to fetch this session. Stops a
 * broken URL from being retried in a tight loop, while still allowing a fresh
 * attempt next launch (so a temporary network failure heals itself).
 */
const attemptedImages = new Set<string>();

/**
 * True once a genuine store is selected. `store_unknown` is the placeholder the
 * store provider uses before sign-in / before memberships load.
 */
function isRealStore(): boolean {
  const id = getActiveStore();
  return !!id && id !== "bootstrap" && id !== "store_unknown";
}

/**
 * One-time repair for devices seeded by an earlier build.
 *
 * That build wrote the starter catalog and tables as already-synced, so the sync
 * engine never uploaded them and the store's Durable Object stayed empty — which
 * silently broke the VIP page (no menu, and the table id couldn't be found).
 * Flagging the existing rows dirty makes the next sync upload what's already
 * there, without wiping anything the user has since edited.
 */
function repairUnsyncedSeed() {
  if (SYNC_ENABLED) return;
  if (!isRealStore()) return;
  seedOnce("seed_upload_repair_v1", () => {
    (
      [
        "products",
        "categories",
        "modifiers",
        "ingredients",
        "tables",
        "customers",
        "staff",
      ] as const
    ).forEach(markAllDirty);
  });
}

/**
 * Remove the fake demo people ("Ada Obi", "Tunde A." …) that earlier builds
 * seeded and synced to the server. Targets only their fixed seed ids, so
 * anything the store has since added is untouched. The soft-deletes tombstone
 * and sync, clearing the rows from every device and the store's server copy.
 */
function cleanupDemoData() {
  if (SYNC_ENABLED) return;
  if (!isRealStore()) return;
  seedOnce("cleanup_demo_people_v1", () => {
    ["cu1", "cu2", "cu3"].forEach((id) => softDelete("customers", id));
    ["s1", "s2", "s3"].forEach((id) => softDelete("staff", id));
    ["m1", "m2"].forEach((id) => softDelete("modifiers", id));
    ["i1", "i2", "i3", "i4", "i5"].forEach((id) => softDelete("ingredients", id));
  });
}

const CatalogContext = createContext<CatalogState | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  // Seed this store's database before the first read below. The provider is
  // keyed by store id (see app/_layout.tsx), so this runs once per branch.
  const [products, setProducts] = useState<Item[]>(() => {
    seedStore();
    repairUnsyncedSeed();
    cleanupDemoData();
    return loadAll<Item>("products");
  });
  const [categories, setCategories] = useState<Category[]>(() => loadAll<Category>("categories"));
  const [modifiers, setModifiers] = useState<ModifierGroup[]>(() => loadAll<ModifierGroup>("modifiers"));
  const [ingredients, setIngredients] = useState<Ingredient[]>(() => loadAll<Ingredient>("ingredients"));
  const [tables, setTables] = useState<Table[]>(() => loadAll<Table>("tables"));
  const [customers, setCustomers] = useState<Customer[]>(() => loadAll<Customer>("customers"));
  const [staff, setStaff] = useState<StaffMember[]>(() => loadAll<StaffMember>("staff"));

  // Re-read all local collections whenever sync pushes or pulls data, so the
  // UI always reflects the current server truth — even on first install where
  // the provider mounts before the initial pull completes.
  useEffect(() => {
    if (!SYNC_ENABLED) return;
    return onSynced(() => {
      setProducts(loadAll<Item>("products"));
      setCategories(loadAll<Category>("categories"));
      setModifiers(loadAll<ModifierGroup>("modifiers"));
      setIngredients(loadAll<Ingredient>("ingredients"));
      setTables(loadAll<Table>("tables"));
      setCustomers(loadAll<Customer>("customers"));
      setStaff(loadAll<StaffMember>("staff"));
    });
  }, []);

  /**
   * One-time image hydration for the seeded menu: download each photo and store
   * it in the `product_images` collection.
   *
   * Deliberately batched — an earlier version called setProducts once per image,
   * which re-rendered the whole grid 60 times and made the Items screen crawl.
   * Now the DB is written per image (so progress survives a kill) but React
   * state is updated once at the end. Runs after first paint.
   */
  useEffect(() => {
    if (!isRealStore()) return;
    let cancelled = false;

    /** Fetch to raw base64 (no data-URI prefix). */
    const toBase64 = async (url: string): Promise<{ base64: string; mime: string } | null> => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const mime = res.headers.get("content-type") ?? "image/jpeg";
        const blob = await res.blob();
        const dataUri = await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
        const base64 = dataUri?.split(",")[1];
        return base64 ? { base64, mime } : null;
      } catch {
        return null;
      }
    };

    void (async () => {
      // Resumable by construction: the work list is "products whose photo isn't
      // stored yet", so an interrupted or partly-failed run simply picks up the
      // remainder next launch. (An earlier version set a done-flag after a
      // partial run, which permanently stranded any image that failed once.)
      const have = loadImageIds();
      const targets = loadAll<Item>("products").filter(
        (p) => p.imageUrl && !have.has(p.id) && !attemptedImages.has(p.id),
      );
      if (targets.length === 0) return;

      const done: string[] = [];

      /** Download a few at a time — sequential was slow over a phone connection. */
      const CONCURRENCY = 4;
      let cursor = 0;
      const worker = async () => {
        while (!cancelled) {
          const p = targets[cursor++];
          if (!p) return;
          attemptedImages.add(p.id);
          const img = await toBase64(p.imageUrl!);
          if (!img) continue; // retried on next launch
          saveImage(p.id, img.base64, img.mime);
          dbPut("products", { ...p, hasImage: true });
          done.push(p.id);
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));

      if (cancelled || done.length === 0) return;
      // Single state update for the whole batch.
      const flagged = new Set(done);
      setProducts((prev) => prev.map((x) => (flagged.has(x.id) ? { ...x, hasImage: true } : x)));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<CatalogState>(() => {
    /** Write-through upsert: persist to SQLite, then update the in-memory mirror. */
    function upsert<T extends { id: string }>(
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      collection: Parameters<typeof dbPut>[0],
      prefix: string,
      draft: Partial<T>,
      defaults: Omit<T, "id">,
    ): T {
      const id = draft.id ?? uid(prefix);
      const isNew = !draft.id;
      const next = { ...defaults, ...draft, id } as T;
      dbPut(collection, next);
      setter((prev) => (prev.some((p) => p.id === id) ? prev.map((p) => (p.id === id ? next : p)) : [...prev, next]));
      auditEntity(collection, isNew ? "create" : "update", id, (next as { name?: string }).name);
      return next;
    }

    function remove<T extends { id: string }>(
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      collection: Parameters<typeof softDelete>[0],
      id: string,
    ) {
      softDelete(collection, id);
      setter((prev) => prev.filter((p) => p.id !== id));
      auditEntity(collection, "delete", id);
    }

    return {
      products,
      categories,
      modifiers,
      ingredients,
      tables,
      sections: [...new Set(tables.map((t) => t.section))],
      customers,
      staff,

      upsertProduct: (p) =>
        upsert<Item>(setProducts, "products", "prod", p, {
          name: p.name,
          price: p.price,
          currency: "NGN",
          stockQuantity: null,
          categoryColor: swatches[0],
        }),
      deleteProduct: (id) => remove(setProducts, "products", id),

      upsertCategory: (c) =>
        upsert<Category>(setCategories, "categories", "cat", c, {
          name: c.name,
          color: swatches[categories.length % swatches.length]!,
        }),
      deleteCategory: (id) => remove(setCategories, "categories", id),

      upsertModifier: (m) =>
        upsert<ModifierGroup>(setModifiers, "modifiers", "mod", m, {
          name: m.name,
          required: false,
          multiSelect: true,
          options: [],
        }),
      deleteModifier: (id) => remove(setModifiers, "modifiers", id),

      upsertIngredient: (i) =>
        upsert<Ingredient>(setIngredients, "ingredients", "ing", i, { name: i.name, unit: "kg", stock: 0, lowAt: 5 }),
      deleteIngredient: (id) => remove(setIngredients, "ingredients", id),

      upsertTable: (t) =>
        upsert<Table>(setTables, "tables", "tbl", t, { name: t.name, section: "DEFAULT ALL", seats: 4 }),
      deleteTable: (id) => remove(setTables, "tables", id),

      upsertCustomer: (c) => upsert<Customer>(setCustomers, "customers", "cust", c, { name: c.name, due: 0 }),
      deleteCustomer: (id) => remove(setCustomers, "customers", id),

      upsertStaff: (s) =>
        upsert<StaffMember>(setStaff, "staff", "staff", s, { name: s.name, role: "Cashier", active: true }),
      deleteStaff: (id) => remove(setStaff, "staff", id),

      recordSale: (lines, ref) => {
        const now = Date.now();
        const quantities = new Map<string, number>();
        for (const line of lines) {
          if (!Number.isFinite(line.qty) || line.qty <= 0) continue;
          const key = `${line.productId}\u0000${line.variantId ?? ""}`;
          quantities.set(key, (quantities.get(key) ?? 0) + line.qty);
        }

        setProducts((prev) => {
          let changed = false;
          const next = prev.map((product) => {
            if (product.variants?.length) {
              let productChanged = false;
              const variants = product.variants.map((variant) => {
                const qty = quantities.get(`${product.id}\u0000${variant.id}`) ?? 0;
                if (qty <= 0 || !variant.autoUpdateStock || variant.stock == null) return variant;
                const resulting = Math.max(0, variant.stock - qty);
                if (resulting === variant.stock) return variant;
                productChanged = true;
                dbPut<StockMovement>("stock_movements", {
                  id: uid("mov"),
                  productId: product.id,
                  productName: product.name,
                  variantId: variant.id,
                  variantName: variant.name,
                  reason: "sale",
                  delta: -(variant.stock - resulting),
                  resulting,
                  at: now,
                  ref,
                });
                return { ...variant, stock: resulting };
              });
              if (!productChanged) return product;
              const updated = { ...product, variants };
              dbPut("products", updated);
              changed = true;
              return updated;
            }

            const qty = quantities.get(`${product.id}\u0000`) ?? 0;
            if (qty <= 0 || product.stockQuantity == null) return product;
            const resulting = Math.max(0, product.stockQuantity - qty);
            if (resulting === product.stockQuantity) return product;
            const updated = { ...product, stockQuantity: resulting };
            dbPut("products", updated);
            dbPut<StockMovement>("stock_movements", {
              id: uid("mov"),
              productId: product.id,
              productName: product.name,
              reason: "sale",
              delta: -(product.stockQuantity - resulting),
              resulting,
              at: now,
              ref,
            });
            changed = true;
            return updated;
          });
          return changed ? next : prev;
        });
      },

      logStockChange: (product, delta, reason, resulting, variant) => {
        if (delta === 0) return;
        dbPut<StockMovement>("stock_movements", {
          id: uid("mov"),
          productId: product.id,
          productName: product.name,
          variantId: variant?.id,
          variantName: variant?.name,
          reason,
          delta,
          resulting,
          at: Date.now(),
        });
      },
    };
  }, [products, categories, modifiers, ingredients, tables, customers, staff]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogState {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalog must be used within a CatalogProvider");
  return ctx;
}
