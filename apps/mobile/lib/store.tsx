import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { StoreRole } from "@gls-pos/types";
import { prepareStoreSyncScope, startAutoSync } from "./sync";
import { startRealtime } from "./realtime";
import {
  cancelAndDrainPushRegistration,
  registerForPush,
} from "./push";
import { captureBoundAuthCredential } from "./auth-client";
import { useAuth } from "./auth";
import { OFFLINE_MODE } from "./offline";

export type Store = {
  id: string;
  name: string;
  /** Short label shown in the avatar circle. */
  initials: string;
  currency: string;
  /** Canonical membership role used for read-scope synchronization. */
  role: StoreRole;
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
const BOOTSTRAP_STORE: Store = {
  id: "bootstrap",
  name: "My Store",
  initials: "MS",
  currency: "NGN",
  // Metadata-only placeholder; operational effects never run for this store.
  role: "owner",
};

/**
 * The keyed gate runs its synchronous projection transaction before any
 * store-scoped data provider can read SQLite under a newly-contracted role.
 */
function StoreProjectionGate({
  store,
  children,
}: {
  store: Store;
  children: ReactNode;
}) {
  useState(() => {
    prepareStoreSyncScope(store.id, store.role);
    return `${store.id}:${store.role}`;
  });
  return <>{children}</>;
}

/**
 * The store switcher, backed by the user's real memberships from the control
 * plane. Before a validated membership is available, the auth screens use the
 * metadata-only bootstrap scope; no operational or network work is started.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const {
    stores: memberships,
    activeStore,
    selectStore,
    user,
    credentialRevision,
  } = useAuth();

  const stores = useMemo<Store[]>(
    () =>
      memberships.map((m) => ({
        id: m.id,
        name: m.name,
        initials: initialsOf(m.name),
        currency: m.currency,
        role: m.role,
        reference: m.role.charAt(0).toUpperCase() + m.role.slice(1),
      })),
    [memberships],
  );

  const store = useMemo<Store>(() => {
    const found = activeStore && stores.find((candidate) => candidate.id === activeStore.id);
    return found ?? stores[0] ?? BOOTSTRAP_STORE;
  }, [activeStore, stores]);
  const operational = store.id !== BOOTSTRAP_STORE.id;

  // Offline-first background sync starts only for a membership-validated store.
  useEffect(() => {
    if (OFFLINE_MODE || !operational) return;
    return startAutoSync(store.id, store.role);
  }, [operational, store.id, store.role]);

  // Realtime is only a nudge channel; polling remains the safety net.
  useEffect(() => {
    if (OFFLINE_MODE || !operational) return;
    return startRealtime(store.id);
  }, [operational, store.id]);

  // Register this device for push, so a locked phone still gets alerted.
  useEffect(() => {
    if (OFFLINE_MODE || !operational || !user) return;

    // Capture once, before registration can await permissions, channels, or a
    // token. A credential revision reruns this effect even for the same user.
    const credential = captureBoundAuthCredential(user.id);
    if (!credential) return;

    const controller = new AbortController();
    void registerForPush(store.id, { credential, signal: controller.signal });

    return () => {
      controller.abort();
      void cancelAndDrainPushRegistration();
    };
  }, [credentialRevision, operational, store.id, user?.id]);

  const value = useMemo<StoreState>(
    () => ({ store, stores, setStoreId: selectStore }),
    [store, stores, selectStore],
  );

  return (
    <StoreContext.Provider value={value}>
      <StoreProjectionGate key={`${store.id}:${store.role}`} store={store}>
        {children}
      </StoreProjectionGate>
    </StoreContext.Provider>
  );
}

export function useStore(): StoreState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}
