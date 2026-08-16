import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Permission, StoreMembership, StoreRole } from "@gls-pos/types";
import { ROLE_PERMISSIONS, roleCan } from "@gls-pos/types";
import { authClient, authCookie } from "./auth-client";
import { api } from "./api";
import { metaGet, metaSet } from "./db";

/**
 * Session + role/permission state for the whole app.
 *
 * Roles are authoritative on the server; this mirrors them so the UI can hide
 * what the user can't do. Hiding is a convenience — every gated action is also
 * enforced by the Worker, so a tampered client still can't do more.
 *
 * The active store id is cached locally so the app can boot offline into the
 * same store with the last known role.
 */

type User = { id: string; name: string; email: string };

type AuthState = {
  ready: boolean;
  user: User | null;
  signedIn: boolean;
  /** Stores this user can access. */
  stores: StoreMembership[];
  activeStore: StoreMembership | null;
  role: StoreRole | null;
  permissions: readonly Permission[];
  /** Permission check used throughout the UI. */
  can: (p: Permission) => boolean;

  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signUp: (name: string, email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  selectStore: (storeId: string) => void;
  /** Create the first store for a brand-new owner. */
  createStore: (name: string) => Promise<{ ok: boolean; error?: string }>;
  refresh: () => Promise<void>;
};

const ACTIVE_STORE_KEY = "active_store_id";

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [stores, setStores] = useState<StoreMembership[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(() => metaGet(ACTIVE_STORE_KEY));

  /** Pull the session + store list from the server. Safe to call any time. */
  const refresh = useCallback(async () => {
    try {
      // No cookie yet => definitely signed out; skip the round-trip.
      if (!authCookie()) {
        setUser(null);
        setStores([]);
        return;
      }
      const session = await authClient.getSession();
      const sessionUser = (session?.data?.user ?? null) as User | null;
      setUser(sessionUser);
      if (!sessionUser) {
        setStores([]);
        return;
      }
      const res = await api.listStores();
      if (res.ok) {
        setStores(res.data);
        // Fall back to the first store when the cached one is gone.
        setActiveStoreId((prev) => {
          const keep = prev && res.data.some((s) => s.id === prev);
          const next = keep ? prev : (res.data[0]?.id ?? null);
          if (next) metaSet(ACTIVE_STORE_KEY, next);
          return next;
        });
      }
    } catch {
      // Offline: keep whatever we already have so the POS stays usable.
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
      setReady(true);
    })();
  }, [refresh]);

  const value = useMemo<AuthState>(() => {
    const activeStore = stores.find((s) => s.id === activeStoreId) ?? stores[0] ?? null;
    const role = activeStore?.role ?? null;
    const permissions = role ? ROLE_PERMISSIONS[role] : [];

    return {
      ready,
      user,
      signedIn: !!user,
      stores,
      activeStore,
      role,
      permissions,
      can: (p) => roleCan(role, p),

      signIn: async (email, password) => {
        const res = await authClient.signIn.email({ email, password });
        if (res.error) return { ok: false, error: res.error.message ?? "Sign in failed" };
        await refresh();
        return { ok: true };
      },

      signUp: async (name, email, password) => {
        const res = await authClient.signUp.email({ name, email, password });
        if (res.error) return { ok: false, error: res.error.message ?? "Sign up failed" };
        await refresh();
        return { ok: true };
      },

      signOut: async () => {
        await authClient.signOut();
        setUser(null);
        setStores([]);
      },

      selectStore: (storeId) => {
        metaSet(ACTIVE_STORE_KEY, storeId);
        setActiveStoreId(storeId);
      },

      createStore: async (name) => {
        const res = await api.createStore({ name, currency: "NGN" });
        if (!res.ok) return { ok: false, error: res.error.message };
        await refresh();
        return { ok: true };
      },

      refresh,
    };
  }, [ready, user, stores, activeStoreId, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

/** Convenience hook for gating UI: `const can = usePermission();` */
export function usePermission() {
  return useAuth().can;
}
