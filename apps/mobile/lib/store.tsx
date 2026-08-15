import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { startAutoSync } from "./sync";
import { api } from "./api";
import { useSession } from "./auth-client";

export type Store = {
  id: string;
  name: string;
  /** Short label shown in the avatar circle. */
  initials: string;
  currency: string;
  /** e.g. business phone / identifier shown under the name. */
  reference?: string;
};

const defaultStores: Store[] = [];

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "--";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function mapOrganizationToStore(org: {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: string;
}): Store {
  return {
    id: org.id,
    name: org.name,
    initials: initialsFromName(org.name),
    currency: "NGN",
    reference: org.slug,
  };
}

type StoreState = {
  store: Store;
  stores: Store[];
  setStoreId: (id: string) => void;
  addStore: (store: Store) => void;
};

const StoreContext = createContext<StoreState | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [stores, setStores] = useState<Store[]>(defaultStores);
  const [storeId, setStoreId] = useState<string | null>(null);
  const { data: session } = useSession();

  useEffect(() => {
    const loadOrganizations = async () => {
      let result;

      // If user is admin, list all organizations; otherwise, list only user's organizations
      if (session?.user?.role === "admin") {
        result = await api.listOrganizations();
      } else if (session?.user?.id) {
        result = await api.listUserOrganizations(session.user.id);
      } else {
        return;
      }

      if (!result.ok || result.data.length === 0) return;
      const mappedStores = result.data.map(mapOrganizationToStore);
      setStores(mappedStores);
      setStoreId(mappedStores[0]!.id);
    };
    void loadOrganizations();
  }, [session?.user?.id, session?.user?.role]);

  useEffect(() => {
    if (storeId) {
      startAutoSync(storeId);
    }
  }, [storeId]);

  const addStore = useCallback(
    (store: Store) => setStores((prev) => [...prev, store]),
    [],
  );

  const currentStore = storeId
    ? stores.find((s) => s.id === storeId)
    : stores[0];

  const value = useMemo<StoreState>(
    () => ({
      store: currentStore || {
        id: "",
        name: "",
        initials: "",
        currency: "NGN",
      },
      stores,
      setStoreId,
      addStore,
    }),
    [storeId, stores, currentStore, addStore],
  );

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

export function useStore(): StoreState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}
