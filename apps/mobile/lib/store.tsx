import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Store = {
  id: string;
  name: string;
  /** Short label shown in the avatar circle. */
  initials: string;
  currency: string;
  /** e.g. business phone / identifier shown under the name. */
  reference?: string;
};

/**
 * The stores (shops/branches) this account can switch between. The header
 * dropdown is a store switcher — one GLS business with multiple shops.
 */
export const stores: Store[] = [
  { id: "store_main", name: "GLS Main Shop", initials: "GM", currency: "NGN", reference: "+234 801 000 0001" },
  { id: "store_jollof", name: "GLS Jollof Kitchen", initials: "JK", currency: "NGN", reference: "+234 801 000 0002" },
  { id: "store_express", name: "GLS Express", initials: "GE", currency: "NGN", reference: "+234 801 000 0003" },
];

type StoreState = {
  store: Store;
  stores: Store[];
  setStoreId: (id: string) => void;
};

const StoreContext = createContext<StoreState | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [storeId, setStoreId] = useState(stores[0]!.id);

  const value = useMemo<StoreState>(
    () => ({
      store: stores.find((s) => s.id === storeId) ?? stores[0]!,
      stores,
      setStoreId,
    }),
    [storeId],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}
