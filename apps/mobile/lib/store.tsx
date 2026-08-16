import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { startAutoSync } from "./sync";
import { useAuth } from "./auth";

export type Store = {
  id: string;
  name: string;
  /** Short label shown in the avatar circle. */
  initials: string;
  currency: string;
  /** The signed-in user's role in this store, shown under the name. */
  reference?: string;
};

/** "GLS Kitchen & Bakery" -> "GK" */
function initialsOf(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]!).join("") || "ST").toUpperCase();
}

type StoreState = {
  store: Store;
  stores: Store[];
  setStoreId: (id: string) => void;
};

const StoreContext = createContext<StoreState | null>(null);

/**
 * The store switcher, backed by the user's real memberships from the control
 * plane. Only mounts once the user is signed in and has at least one store
 * (see the gate in app/_layout.tsx), so `activeStore` is always present.
 *
 * Also drives background sync for whichever store is active.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const { stores: memberships, activeStore, selectStore } = useAuth();

  const stores = useMemo<Store[]>(
    () =>
      memberships.map((m) => ({
        id: m.id,
        name: m.name,
        initials: initialsOf(m.name),
        currency: m.currency,
        reference: m.role.charAt(0).toUpperCase() + m.role.slice(1),
      })),
    [memberships],
  );

  const store = useMemo<Store>(() => {
    const found = activeStore && stores.find((s) => s.id === activeStore.id);
    return (
      found ??
      stores[0] ?? { id: "store_unknown", name: "My Store", initials: "MS", currency: "NGN" }
    );
  }, [activeStore, stores]);

  // Offline-first background sync for the active store. No-ops when sync is
  // disabled or there's no session, so the POS keeps working from local data.
  useEffect(() => startAutoSync(store.id), [store.id]);

  const value = useMemo<StoreState>(
    () => ({ store, stores, setStoreId: selectStore }),
    [store, stores, selectStore],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}
