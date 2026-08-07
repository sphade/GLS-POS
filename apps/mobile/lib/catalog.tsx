import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Item } from "./cart";
import { mockItems } from "./mock-items";

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

const uid = (p: string) => `${p}_${Date.now()}_${Math.round(Math.random() * 1e4)}`;

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
};

const CatalogContext = createContext<CatalogState | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Item[]>(mockItems);
  const [categories, setCategories] = useState<Category[]>([
    { id: "c1", name: "Coffee", color: "#8D6E63" },
    { id: "c2", name: "Food", color: "#EF6C00" },
    { id: "c3", name: "Pizza", color: "#C62828" },
    { id: "c4", name: "Drinks", color: "#F9A825" },
    { id: "c5", name: "Desserts", color: "#6D4C41" },
  ]);
  const [modifiers, setModifiers] = useState<ModifierGroup[]>([
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
  ]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([
    { id: "i1", name: "Rice", unit: "kg", stock: 40, lowAt: 10 },
    { id: "i2", name: "Chicken", unit: "kg", stock: 18, lowAt: 5 },
    { id: "i3", name: "Tomato", unit: "kg", stock: 8, lowAt: 10 },
    { id: "i4", name: "Cooking oil", unit: "ltr", stock: 12, lowAt: 4 },
    { id: "i5", name: "Cheese", unit: "kg", stock: 3, lowAt: 5 },
  ]);
  const [tables, setTables] = useState<Table[]>([
    { id: "t1", name: "TABLE - GLS 2", section: "DEFAULT ALL", seats: 4, reference: "234" },
    { id: "t2", name: "TABLE - GLS 3", section: "DEFAULT ALL", seats: 2, reference: "235" },
    { id: "t3", name: "VIP 1", section: "VIP", seats: 6, reference: "301" },
  ]);
  const [customers, setCustomers] = useState<Customer[]>([
    { id: "cu1", name: "Ada Obi", phone: "+234 801 111 2222", due: 0 },
    { id: "cu2", name: "Musa Bello", phone: "+234 802 333 4444", due: 250000 },
    { id: "cu3", name: "Ngozi Eze", phone: "+234 803 555 6666", email: "ngozi@example.com", due: 0 },
  ]);
  const [staff, setStaff] = useState<StaffMember[]>([
    { id: "s1", name: "You (Owner)", role: "Owner", active: true },
    { id: "s2", name: "Tunde A.", role: "Cashier", phone: "+234 805 777 8888", active: true },
    { id: "s3", name: "Grace O.", role: "Waiter", phone: "+234 806 999 0000", active: true },
  ]);

  const value = useMemo<CatalogState>(() => {
    /** Generic upsert: replace when the id exists, otherwise append. */
    function upsert<T extends { id: string }>(
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      prefix: string,
      draft: Partial<T>,
      defaults: Omit<T, "id">,
    ): T {
      const id = draft.id ?? uid(prefix);
      const next = { ...defaults, ...draft, id } as T;
      setter((prev) => (prev.some((p) => p.id === id) ? prev.map((p) => (p.id === id ? next : p)) : [...prev, next]));
      return next;
    }

    const remove = <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, id: string) =>
      setter((prev) => prev.filter((p) => p.id !== id));

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
        upsert<Item>(setProducts, "prod", p, {
          name: p.name,
          price: p.price,
          currency: "NGN",
          stockQuantity: null,
          categoryColor: swatches[0],
        }),
      deleteProduct: (id) => remove(setProducts, id),

      upsertCategory: (c) =>
        upsert<Category>(setCategories, "cat", c, {
          name: c.name,
          color: swatches[categories.length % swatches.length]!,
        }),
      deleteCategory: (id) => remove(setCategories, id),

      upsertModifier: (m) =>
        upsert<ModifierGroup>(setModifiers, "mod", m, {
          name: m.name,
          required: false,
          multiSelect: true,
          options: [],
        }),
      deleteModifier: (id) => remove(setModifiers, id),

      upsertIngredient: (i) =>
        upsert<Ingredient>(setIngredients, "ing", i, { name: i.name, unit: "kg", stock: 0, lowAt: 5 }),
      deleteIngredient: (id) => remove(setIngredients, id),

      upsertTable: (t) =>
        upsert<Table>(setTables, "tbl", t, { name: t.name, section: "DEFAULT ALL", seats: 4 }),
      deleteTable: (id) => remove(setTables, id),

      upsertCustomer: (c) => upsert<Customer>(setCustomers, "cust", c, { name: c.name, due: 0 }),
      deleteCustomer: (id) => remove(setCustomers, id),

      upsertStaff: (s) =>
        upsert<StaffMember>(setStaff, "staff", s, { name: s.name, role: "Cashier", active: true }),
      deleteStaff: (id) => remove(setStaff, id),
    };
  }, [products, categories, modifiers, ingredients, tables, customers, staff]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogState {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalog must be used within a CatalogProvider");
  return ctx;
}
