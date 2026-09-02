import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Permission, StoreMembership, StoreRole } from "@gls-pos/types";
import { ROLE_PERMISSIONS, roleCan } from "@gls-pos/types";
import { authClient, authCookie } from "./auth-client";
import { api } from "./api";
import { setAuditActor } from "./audit";
import { unregisterPush } from "./push";
import { metaGet, metaSet } from "./db";
import { LOCAL_STORE_ID, LOCAL_STORE_MEMBERSHIP, LOCAL_USER, OFFLINE_MODE } from "./offline";

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

type User = { id: string; name: string; email: string; username?: string };

/** Shape better-auth returns from a sign-in/sign-up call. */
type AuthResult = { error?: { message?: string } | null };

/**
 * Whether we've actually heard back about this user's stores.
 *  pending — still asking; don't route on `stores` yet
 *  ok      — the list is authoritative, even if empty
 *  failed  — offline; `stores` is whatever we already knew
 */
type StoresStatus = "pending" | "ok" | "failed";

type AuthState = {
  ready: boolean;
  user: User | null;
  signedIn: boolean;
  /** Stores this user can access. */
  stores: StoreMembership[];
  /** Guards routing: an empty list only means "no stores" once this is "ok". */
  storesStatus: StoresStatus;
  activeStore: StoreMembership | null;
  role: StoreRole | null;
  permissions: readonly Permission[];
  /** Permission check used throughout the UI. */
  can: (p: Permission) => boolean;
  /**
   * Only owners open new locations, so only they see "Create Shop" / "Edit
   * Business". A user with no memberships at all is a new owner registering
   * their first restaurant. Enforced server-side too.
   */
  canManageBusiness: boolean;

  /**
   * Staff sign in with the username the owner gave them. An email is also
   * accepted, for accounts that predate username login.
   */
  signIn: (usernameOrEmail: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  /** Owner self-registration: creates the first account for a new business. */
  signUp: (
    name: string,
    username: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  selectStore: (storeId: string) => void;
  /** Create the first store for a brand-new owner. */
  createStore: (name: string) => Promise<{ ok: boolean; error?: string }>;
  refresh: () => Promise<void>;
};

const ACTIVE_STORE_KEY = "active_store_id";
const CACHED_USER_KEY = "cached_user";
const CACHED_STORES_KEY = "cached_stores";

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(OFFLINE_MODE ? LOCAL_USER : null);
  const [stores, setStores] = useState<StoreMembership[]>(
    OFFLINE_MODE ? [LOCAL_STORE_MEMBERSHIP] : [],
  );
  const [storesStatus, setStoresStatus] = useState<StoresStatus>(OFFLINE_MODE ? "ok" : "pending");
  const [activeStoreId, setActiveStoreId] = useState<string | null>(() =>
    OFFLINE_MODE ? LOCAL_STORE_ID : metaGet(ACTIVE_STORE_KEY),
  );

  /**
   * Pull the session + store list from the server. Safe to call any time.
   *
   * The user and their stores are applied in the *same* tick on purpose. If we
   * set the user first and awaited the store list afterwards, there'd be a
   * render where someone is signed in with zero stores — and the router would
   * bounce a cashier through "Create your store" before their membership
   * arrived.
   */
  const refresh = useCallback(async () => {
    // Offline builds have no server: the synthetic owner session is final.
    if (OFFLINE_MODE) {
      setUser(LOCAL_USER);
      setStores([LOCAL_STORE_MEMBERSHIP]);
      setStoresStatus("ok");
      return;
    }
    try {
      // No cookie yet => definitely signed out; skip the round-trip.
      if (!authCookie()) {
        setUser(null);
        setStores([]);
        setStoresStatus("ok");
        return;
      }
      const session = await authClient.getSession();
      const sessionUser = (session?.data?.user ?? null) as User | null;
      if (!sessionUser) {
        setUser(null);
        setStores([]);
        setStoresStatus("ok");
        return;
      }

      const res = await api.listStores();

      // Applied together, so no render observes "signed in, no stores" unless
      // that is genuinely true.
      setUser(sessionUser);
      if (res.ok) {
        setStores(res.data);
        setStoresStatus("ok");
        // Cache for offline fallback
        metaSet(CACHED_USER_KEY, JSON.stringify(sessionUser));
        metaSet(CACHED_STORES_KEY, JSON.stringify(res.data));
        // Fall back to the first store when the cached one is gone.
        setActiveStoreId((prev) => {
          const keep = prev && res.data.some((s) => s.id === prev);
          const next = keep ? prev : (res.data[0]?.id ?? null);
          if (next) metaSet(ACTIVE_STORE_KEY, next);
          return next;
        });
      } else {
        // Reachable but unhappy — treat like offline rather than "no stores".
        setStoresStatus("failed");
      }
    } catch {
      // Offline: restore from cache so the POS stays usable.
      const cachedUser = metaGet(CACHED_USER_KEY);
      const cachedStores = metaGet(CACHED_STORES_KEY);
      if (cachedUser) {
        setUser(JSON.parse(cachedUser) as User);
        if (cachedStores) setStores(JSON.parse(cachedStores) as StoreMembership[]);
        setStoresStatus("failed");
      } else {
        setStoresStatus("failed");
      }
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
      setReady(true);
    })();
  }, [refresh]);

  const activeStore = stores.find((s) => s.id === activeStoreId) ?? stores[0] ?? null;
  const activeRole = activeStore?.role ?? null;

  // Keep the audit trail's "who" in step with the session, so every logged
  // action is attributed to the signed-in user and their role in this store.
  useEffect(() => {
    setAuditActor(user && activeRole ? { id: user.id, name: user.name, role: activeRole } : null);
  }, [user, activeRole]);

  const value = useMemo<AuthState>(() => {
    const role = activeRole;
    const permissions = role ? ROLE_PERMISSIONS[role] : [];

    return {
      ready,
      user,
      signedIn: !!user,
      stores,
      storesStatus,
      activeStore,
      role,
      permissions,
      can: (p) => roleCan(role, p),
      canManageBusiness: stores.length === 0 || stores.some((s) => s.role === "owner"),

      signIn: async (identifier, password) => {
        // Offline builds: already signed in as the local owner; nothing to do.
        if (OFFLINE_MODE) return { ok: true };
        const id = identifier.trim().toLowerCase();
        const client = authClient as unknown as {
          signIn: { username: (i: { username: string; password: string }) => Promise<AuthResult> };
        };
        // Accounts created before username login (the original owner) only have
        // an email, so accept either credential and pick the right endpoint.
        const res = id.includes("@")
          ? await authClient.signIn.email({ email: id, password })
          : await client.signIn.username({ username: id, password });
        if (res.error) {
          return {
            ok: false,
            error: res.error.message ?? "That username or password isn't right",
          };
        }
        await refresh();
        return { ok: true };
      },

      signUp: async (name, username, password) => {
        if (OFFLINE_MODE) return { ok: true };
        // better-auth needs an email internally; staff never see or use it.
        const handle = username.trim().toLowerCase();
        const res = await authClient.signUp.email({
          name: name.trim(),
          email: `${handle}@staff.gls.local`,
          password,
          username: handle,
          displayUsername: username.trim(),
        } as never);
        if (res.error) return { ok: false, error: res.error.message ?? "Sign up failed" };
        await refresh();
        return { ok: true };
      },

      signOut: async () => {
        // Offline builds have no session to end; stay in the local POS.
        if (OFFLINE_MODE) return;
        // Stop alerts for this device first, while the session cookie is valid.
        await unregisterPush();
        await authClient.signOut();
        setUser(null);
        setStores([]);
        setStoresStatus("ok");
        metaSet(CACHED_USER_KEY, "");
        metaSet(CACHED_STORES_KEY, "");
      },

      selectStore: (storeId) => {
        metaSet(ACTIVE_STORE_KEY, storeId);
        setActiveStoreId(storeId);
      },

      createStore: async (name) => {
        if (OFFLINE_MODE) return { ok: true };
        const res = await api.createStore({ name, currency: "NGN" });
        if (!res.ok) return { ok: false, error: res.error.message };
        await refresh();
        /**
         * Switch into the shop that was just created.
         *
         * `refresh` keeps whichever store was already active, so without this an
         * owner opening a second location was dropped back into the first one
         * and would start ringing up sales against the wrong shop. Done after
         * the refresh so the new store is already in the list.
         */
        metaSet(ACTIVE_STORE_KEY, res.data.id);
        setActiveStoreId(res.data.id);
        return { ok: true };
      },

      refresh,
    };
  }, [ready, user, stores, storesStatus, activeStoreId, refresh]);

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
