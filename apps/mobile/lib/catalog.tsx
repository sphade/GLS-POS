import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Item } from "./cart";
import { mockItems, categories as MENU_CATEGORIES } from "./mock-items";
import { ITEM_IMAGES } from "./item-images";
import { loadImageIds, saveImage } from "./image-store";
import {
  getActiveStore,
  loadAll,
  markAllDirty,
  put as dbPut,
  metaGet,
  metaSet,
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

// --- First-run defaults ----------------------------------------------------

/** Categories mirror the real GLS menu (see mock-items.ts). */
const DEFAULT_CATEGORIES: Category[] = MENU_CATEGORIES;

const DEFAULT_MODIFIERS: ModifierGroup[] = [
  {
    id: "m1",
    name: "Add-ons",
    required: false,
    multiSelect: true,
    options: [
      { id: "o1", name: "Extra cheese", price: 50000 },
      { id: "o2", name: "Extra chicken", price: 120000 },
      { id: "o3", name: "Plantain", price: 70000 },
    ],
  },
  {
    id: "m2",
    name: "Spice level",
    required: true,
    multiSelect: false,
    options: [
      { id: "o4", name: "Mild", price: 0 },
      { id: "o5", name: "Medium", price: 0 },
      { id: "o6", name: "Hot", price: 0 },
    ],
  },
];

const DEFAULT_INGREDIENTS: Ingredient[] = [
  { id: "i1", name: "Rice", unit: "kg", stock: 40, lowAt: 10 },
  { id: "i2", name: "Chicken", unit: "kg", stock: 18, lowAt: 5 },
  { id: "i3", name: "Tomato", unit: "kg", stock: 8, lowAt: 10 },
  { id: "i4", name: "Cooking oil", unit: "ltr", stock: 12, lowAt: 4 },
  { id: "i5", name: "Cheese", unit: "kg", stock: 3, lowAt: 5 },
];

const DEFAULT_TABLES: Table[] = [
  { id: "t1", name: "TABLE - GLS 2", section: "DEFAULT ALL", seats: 4, reference: "234" },
  { id: "t2", name: "TABLE - GLS 3", section: "DEFAULT ALL", seats: 2, reference: "235" },
  { id: "t3", name: "VIP 1", section: "VIP", seats: 6, reference: "301" },
];

const DEFAULT_CUSTOMERS: Customer[] = [
  { id: "cu1", name: "Ada Obi", phone: "+234 801 111 2222", due: 0 },
  { id: "cu2", name: "Musa Bello", phone: "+234 802 333 4444", due: 250000 },
  { id: "cu3", name: "Ngozi Eze", phone: "+234 803 555 6666", email: "ngozi@example.com", due: 0 },
];

const DEFAULT_STAFF: StaffMember[] = [
  { id: "s1", name: "You (Owner)", role: "Owner", active: true },
  { id: "s2", name: "Tunde A.", role: "Cashier", phone: "+234 805 777 8888", active: true },
  { id: "s3", name: "Grace O.", role: "Waiter", phone: "+234 806 999 0000", active: true },
];

/**
 * Write the starter data into the ACTIVE store's database once.
 *
 * Called from the provider rather than at module load: with one database per
 * store, importing this file used to seed whichever database happened to be
 * active at import time — which was the bootstrap one, before any store was
 * known. Each branch now seeds its own copy on first open.
 */
function seedStore() {
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
    mockItems.forEach((p) => dbPut("products", { ...p, imageUrl: ITEM_IMAGES[p.name] }));
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
  recordSale: (lines: { productId: string; qty: number }[], ref?: string) => void;
  /** Log a manual stock change (adjustment/initial/restock). Does not itself
   *  write the product; the caller has already persisted the new quantity. */
  logStockChange: (
    product: Item,
    delta: number,
    reason: StockMovementReason,
    resulting: number,
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
/**
 * True once we have a database worth seeding. Excludes only the pre-mount
 * bootstrap database; the offline `local` store IS seeded, so the POS is usable
 * before it can reach the server.
 */
function isRealStore(): boolean {
  const id = getActiveStore();
  return !!id && id !== "bootstrap";
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

const CatalogContext = createContext<CatalogState | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  // Seed this store's database before the first read below. The provider is
  // keyed by store id (see app/_layout.tsx), so this runs once per branch.
  const [products, setProducts] = useState<Item[]>(() => {
    seedStore();
    repairUnsyncedSeed();
    return loadAll<Item>("products");
  });
  const [categories, setCategories] = useState<Category[]>(() => loadAll<Category>("categories"));
  const [modifiers, setModifiers] = useState<ModifierGroup[]>(() => loadAll<ModifierGroup>("modifiers"));
  const [ingredients, setIngredients] = useState<Ingredient[]>(() => loadAll<Ingredient>("ingredients"));
  const [tables, setTables] = useState<Table[]>(() => loadAll<Table>("tables"));
  const [customers, setCustomers] = useState<Customer[]>(() => loadAll<Customer>("customers"));
  const [staff, setStaff] = useState<StaffMember[]>(() => loadAll<StaffMember>("staff"));

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
      const next = { ...defaults, ...draft, id } as T;
      dbPut(collection, next);
      setter((prev) => (prev.some((p) => p.id === id) ? prev.map((p) => (p.id === id ? next : p)) : [...prev, next]));
      return next;
    }

    function remove<T extends { id: string }>(
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      collection: Parameters<typeof softDelete>[0],
      id: string,
    ) {
      softDelete(collection, id);
      setter((prev) => prev.filter((p) => p.id !== id));
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
        setProducts((prev) => {
          let changed = false;
          const next = prev.map((p) => {
            if (p.stockQuantity === null) return p; // not tracked
            const line = lines.find((l) => l.productId === p.id);
            if (!line || line.qty <= 0) return p;
            const resulting = Math.max(0, p.stockQuantity - line.qty);
            const updated = { ...p, stockQuantity: resulting };
            dbPut("products", updated);
            dbPut<StockMovement>("stock_movements", {
              id: uid("mov"),
              productId: p.id,
              productName: p.name,
              reason: "sale",
              delta: -(p.stockQuantity - resulting),
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

      logStockChange: (product, delta, reason, resulting) => {
        if (delta === 0) return;
        dbPut<StockMovement>("stock_movements", {
          id: uid("mov"),
          productId: product.id,
          productName: product.name,
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
