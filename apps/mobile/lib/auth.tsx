import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Permission, StoreMembership, StoreRole } from "@gls-pos/types";
import { ROLE_PERMISSIONS, roleCan } from "@gls-pos/types";
import {
  authClient,
  authCookie,
  bindCurrentAuthPrincipal,
  captureAuthCredentialForTeardown,
  clearAuthPrincipalBinding,
  clearLocalAuthStorage,
  getBoundAuthPrincipalId,
} from "./auth-client";
import { api } from "./api";
import { setAuditActor } from "./audit";
import {
  cancelAndDrainPushRegistration,
  unregisterPush,
} from "./push";
import { deviceMeta } from "./db";
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
 *  failed  — offline; `stores` is the last validated snapshot
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
  /** Changes whenever the current credential is rebound or revoked. */
  credentialRevision: number;
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
const LEGACY_AUTH_SNAPSHOT_KEY = "auth_snapshot_v1";
const AUTH_SNAPSHOT_KEY = "auth_snapshot_v2";
const AUTH_REFRESH_TIMEOUT_MS = 12_000;
const PUSH_UNREGISTER_TIMEOUT_MS = 2_500;
const SIGN_OUT_TIMEOUT_MS = 3_000;
const EMPTY_DRAIN = Promise.resolve();

type CachedAuthSnapshot = {
  version: 2;
  user: User;
  stores: StoreMembership[];
  activeStoreId: string | null;
};

type SnapshotWriteResult = {
  activeStoreId: string | null;
  persisted: boolean;
};

type InitialAuthState = {
  ready: boolean;
  user: User | null;
  stores: StoreMembership[];
  storesStatus: StoresStatus;
  activeStoreId: string | null;
};

type SessionResult = {
  data?: { user?: unknown } | null;
  error?: { message?: string } | null;
};

type RefreshLease = {
  controller: AbortController;
  raw: Promise<SessionResult>;
  drain: Promise<void>;
};

type CredentialMutationGuard = {
  revision: number;
  drain: Promise<void>;
  release: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

function isUser(value: unknown): value is User {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<User>;
  return (
    typeof user.id === "string" &&
    user.id.length > 0 &&
    typeof user.name === "string" &&
    typeof user.email === "string" &&
    (user.username === undefined || typeof user.username === "string")
  );
}

function isMembership(value: unknown): value is StoreMembership {
  if (!value || typeof value !== "object") return false;
  const membership = value as Partial<StoreMembership>;
  return (
    typeof membership.id === "string" &&
    membership.id.length > 0 &&
    typeof membership.name === "string" &&
    typeof membership.currency === "string" &&
    typeof membership.role === "string" &&
    Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, membership.role)
  );
}

function normalizeSnapshot(value: unknown): CachedAuthSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<CachedAuthSnapshot>;
  if (snapshot.version !== 2 || !isUser(snapshot.user) || !Array.isArray(snapshot.stores)) {
    return null;
  }
  if (!snapshot.stores.every(isMembership)) return null;
  const activeStoreId = snapshot.stores.some((store) => store.id === snapshot.activeStoreId)
    ? (snapshot.activeStoreId ?? null)
    : (snapshot.stores[0]?.id ?? null);
  return { version: 2, user: snapshot.user, stores: snapshot.stores, activeStoreId };
}

/** Read only the principal-bindable v2 cache envelope. */
function readCachedSnapshot(): CachedAuthSnapshot | null {
  try {
    const raw = deviceMeta.get(AUTH_SNAPSHOT_KEY);
    return raw ? normalizeSnapshot(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function readBoundCachedSnapshot(): CachedAuthSnapshot | null {
  const snapshot = readCachedSnapshot();
  return snapshot && getBoundAuthPrincipalId() === snapshot.user.id ? snapshot : null;
}

function writeCachedSnapshot(
  user: User,
  stores: StoreMembership[],
  preferredStoreId: string | null,
): SnapshotWriteResult {
  const activeStoreId = stores.some((store) => store.id === preferredStoreId)
    ? preferredStoreId
    : (stores[0]?.id ?? null);
  const snapshot: CachedAuthSnapshot = { version: 2, user, stores, activeStoreId };

  try {
    deviceMeta.set(AUTH_SNAPSHOT_KEY, JSON.stringify(snapshot));
    // Legacy records are deliberately never used for cold startup because they
    // have no secure cookie-to-principal binding.
    deviceMeta.set(LEGACY_AUTH_SNAPSHOT_KEY, "");
    deviceMeta.set(CACHED_USER_KEY, "");
    deviceMeta.set(CACHED_STORES_KEY, "");
    deviceMeta.set(ACTIVE_STORE_KEY, activeStoreId ?? "");
    return { activeStoreId, persisted: true };
  } catch {
    return { activeStoreId, persisted: false };
  }
}

/** Explicit sign-out is the only path that purges validated authorization. */
function purgeCachedAuth(): void {
  for (const key of [
    AUTH_SNAPSHOT_KEY,
    LEGACY_AUTH_SNAPSHOT_KEY,
    CACHED_USER_KEY,
    CACHED_STORES_KEY,
    ACTIVE_STORE_KEY,
  ]) {
    try {
      deviceMeta.set(key, "");
    } catch {
      // Local revocation should continue even if one bootstrap write fails.
    }
  }
}

function initialAuthState(): InitialAuthState {
  if (OFFLINE_MODE) {
    return {
      ready: true,
      user: LOCAL_USER,
      stores: [LOCAL_STORE_MEMBERSHIP],
      storesStatus: "ok",
      activeStoreId: LOCAL_STORE_ID,
    };
  }

  if (!authCookie()) {
    return { ready: true, user: null, stores: [], storesStatus: "ok", activeStoreId: null };
  }

  // Cached authorization mounts only when this exact session-token cookie was
  // previously bound to the same server-confirmed user.
  const snapshot = readBoundCachedSnapshot();
  if (!snapshot) {
    return { ready: false, user: null, stores: [], storesStatus: "pending", activeStoreId: null };
  }
  return {
    ready: true,
    user: snapshot.user,
    stores: snapshot.stores,
    storesStatus: "failed",
    activeStoreId: snapshot.activeStoreId,
  };
}

function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(new Error("Request timed out"));
      }
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(initialAuthState);
  const [ready, setReady] = useState(initial.ready);
  const [user, setUser] = useState<User | null>(initial.user);
  const [stores, setStores] = useState<StoreMembership[]>(initial.stores);
  const [storesStatus, setStoresStatus] = useState<StoresStatus>(initial.storesStatus);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(initial.activeStoreId);
  const [credentialRevision, setCredentialRevision] = useState(0);

  const activeStoreIdRef = useRef<string | null>(initial.activeStoreId);
  const currentUserIdRef = useRef<string | null>(initial.user?.id ?? null);
  const mountedRef = useRef(true);
  const refreshGeneration = useRef(0);
  const refreshStartRevisionRef = useRef(0);
  const refreshBlockCountRef = useRef(0);
  const activeRefreshLeaseRef = useRef<RefreshLease | null>(null);
  const credentialMutationRevisionRef = useRef(0);
  const signOutTransitionRef = useRef<Promise<void> | null>(null);

  const revokeCredentialBinding = useCallback(() => {
    clearAuthPrincipalBinding();
    setCredentialRevision((revision) => revision + 1);
  }, []);

  const finishSnapshotBinding = useCallback((userId: string, persisted: boolean): boolean => {
    const bound = persisted && bindCurrentAuthPrincipal(userId);
    if (!bound) clearAuthPrincipalBinding();
    setCredentialRevision((revision) => revision + 1);
    return bound;
  }, []);

  /**
   * Block new refreshes, invalidate refreshes still waiting to start, and abort
   * the active getSession request synchronously. Its drain settles only after
   * Better Auth's Expo onSuccess storage hooks have also finished.
   */
  const beginCredentialMutation = useCallback((): CredentialMutationGuard => {
    const revision = ++credentialMutationRevisionRef.current;
    refreshBlockCountRef.current += 1;
    refreshGeneration.current += 1;
    refreshStartRevisionRef.current += 1;

    const active = activeRefreshLeaseRef.current;
    active?.controller.abort();
    let released = false;

    return {
      revision,
      drain: active?.drain ?? EMPTY_DRAIN,
      release: () => {
        if (released) return;
        released = true;
        refreshBlockCountRef.current = Math.max(0, refreshBlockCountRef.current - 1);
      },
    };
  }, []);

  /**
   * Revalidate the cached session and memberships in the background. Each run
   * carries both a UI generation and a start revision. A newer refresh or auth
   * mutation aborts its predecessor and prevents waiters from starting later.
   */
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const startRevision = ++refreshStartRevisionRef.current;
    const predecessor = activeRefreshLeaseRef.current;
    predecessor?.controller.abort();
    if (predecessor) await predecessor.drain;

    const isCurrent = () =>
      mountedRef.current && refreshGeneration.current === generation;
    if (
      !isCurrent() ||
      refreshStartRevisionRef.current !== startRevision ||
      refreshBlockCountRef.current > 0
    ) {
      return;
    }

    if (OFFLINE_MODE) {
      currentUserIdRef.current = LOCAL_USER.id;
      activeStoreIdRef.current = LOCAL_STORE_ID;
      setUser(LOCAL_USER);
      setStores([LOCAL_STORE_MEMBERSHIP]);
      setActiveStoreId(LOCAL_STORE_ID);
      setStoresStatus("ok");
      setReady(true);
      return;
    }

    let confirmedUser: User | null = null;
    let cachedSnapshot: CachedAuthSnapshot | null = null;

    const applyConfirmedFallback = (
      sessionUser: User,
      snapshot: CachedAuthSnapshot | null,
    ) => {
      currentUserIdRef.current = sessionUser.id;
      setUser(sessionUser);

      if (snapshot?.user.id === sessionUser.id) {
        const write = writeCachedSnapshot(
          sessionUser,
          snapshot.stores,
          snapshot.activeStoreId,
        );
        finishSnapshotBinding(sessionUser.id, write.persisted);
        activeStoreIdRef.current = write.activeStoreId;
        setStores(snapshot.stores);
        setActiveStoreId(write.activeStoreId);
      } else {
        // Keep any different principal's validated snapshot on disk, but never
        // mount its authorization or leave it bound to the current credential.
        revokeCredentialBinding();
        activeStoreIdRef.current = null;
        setStores([]);
        setActiveStoreId(null);
      }
      setStoresStatus("failed");
    };

    if (!authCookie()) {
      if (!isCurrent()) return;
      currentUserIdRef.current = null;
      activeStoreIdRef.current = null;
      setUser(null);
      setStores([]);
      setStoresStatus("ok");
      setActiveStoreId(null);
      revokeCredentialBinding();
      clearLocalAuthStorage();
      setReady(true);
      return;
    }

    cachedSnapshot = readCachedSnapshot();
    const controller = new AbortController();
    const client = authClient as unknown as {
      getSession: (input?: {
        fetchOptions?: { signal?: AbortSignal };
      }) => Promise<SessionResult>;
    };
    const raw = client.getSession({ fetchOptions: { signal: controller.signal } });
    const drain = raw.then(
      () => undefined,
      () => undefined,
    );
    const lease: RefreshLease = { controller, raw, drain };
    activeRefreshLeaseRef.current = lease;
    void drain.then(() => {
      if (activeRefreshLeaseRef.current === lease) {
        activeRefreshLeaseRef.current = null;
      }
    });

    try {
      const session = await withDeadline(raw, AUTH_REFRESH_TIMEOUT_MS, () => controller.abort());
      if (!isCurrent()) return;
      if (session.error) throw new Error(session.error.message ?? "Session check failed");

      const sessionUser = session.data?.user;
      if (!isUser(sessionUser)) {
        currentUserIdRef.current = null;
        activeStoreIdRef.current = null;
        setUser(null);
        setStores([]);
        setStoresStatus("ok");
        setActiveStoreId(null);
        // Preserve the validated v2 snapshot; only the invalid current Better
        // Auth credential and its local session cache are revoked.
        revokeCredentialBinding();
        clearLocalAuthStorage();
        return;
      }

      confirmedUser = sessionUser;
      const identityChanged = currentUserIdRef.current !== sessionUser.id;
      if (identityChanged) {
        // Never leave the previous principal's role or store visible while the
        // newly confirmed user's memberships are being resolved. The old v2
        // snapshot remains until the new principal's memberships succeed.
        setAuditActor(null);
        setStores([]);
        setStoresStatus("pending");
        activeStoreIdRef.current = null;
        setActiveStoreId(null);
        revokeCredentialBinding();
      }
      currentUserIdRef.current = sessionUser.id;
      setUser(sessionUser);

      const res = await api.listStores();
      if (!isCurrent()) return;
      if (!res.ok) {
        applyConfirmedFallback(sessionUser, cachedSnapshot);
        return;
      }

      const write = writeCachedSnapshot(
        sessionUser,
        res.data,
        activeStoreIdRef.current,
      );
      finishSnapshotBinding(sessionUser.id, write.persisted);
      currentUserIdRef.current = sessionUser.id;
      activeStoreIdRef.current = write.activeStoreId;
      setUser(sessionUser);
      setStores(res.data);
      setActiveStoreId(write.activeStoreId);
      setStoresStatus("ok");
    } catch {
      if (!isCurrent()) return;

      if (confirmedUser) {
        applyConfirmedFallback(confirmedUser, cachedSnapshot);
      } else {
        // Before the server confirms a principal, only the snapshot bound to
        // this exact current cookie is safe to reuse. A mismatch clears only
        // in-memory authorization and the binding, never auth_snapshot_v2.
        const snapshot = readBoundCachedSnapshot();
        if (snapshot) {
          currentUserIdRef.current = snapshot.user.id;
          activeStoreIdRef.current = snapshot.activeStoreId;
          setUser(snapshot.user);
          setStores(snapshot.stores);
          setActiveStoreId(snapshot.activeStoreId);
        } else {
          currentUserIdRef.current = null;
          activeStoreIdRef.current = null;
          setUser(null);
          setStores([]);
          setActiveStoreId(null);
          revokeCredentialBinding();
        }
        setStoresStatus("failed");
      }
    } finally {
      if (isCurrent()) setReady(true);
    }
  }, [finishSnapshotBinding, revokeCredentialBinding]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      refreshGeneration.current += 1;
      refreshStartRevisionRef.current += 1;
      activeRefreshLeaseRef.current?.controller.abort();
    };
  }, [refresh]);

  const activeStore = stores.find((store) => store.id === activeStoreId) ?? stores[0] ?? null;
  const activeRole = activeStore?.role ?? null;

  // Keep the audit trail's "who" in step with the session, so every logged
  // action is attributed to the signed-in user and their role in this store.
  useEffect(() => {
    setAuditActor(
      user && activeRole
        ? { id: user.id, name: user.name, email: user.email, role: activeRole }
        : null,
    );
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
      credentialRevision,
      can: (permission) => roleCan(role, permission),
      canManageBusiness:
        (storesStatus === "ok" && stores.length === 0) ||
        stores.some((store) => store.role === "owner"),

      signIn: async (identifier, password) => {
        if (OFFLINE_MODE) return { ok: true };
        const guard = beginCredentialMutation();
        const pendingSignOut = signOutTransitionRef.current;

        try {
          await Promise.all([guard.drain, pendingSignOut ?? EMPTY_DRAIN]);
          if (credentialMutationRevisionRef.current !== guard.revision) {
            return { ok: false, error: "Sign in was cancelled" };
          }

          const id = identifier.trim().toLowerCase();
          const client = authClient as unknown as {
            signIn: {
              username: (input: { username: string; password: string }) => Promise<AuthResult>;
            };
          };
          const result = id.includes("@")
            ? await authClient.signIn.email({ email: id, password })
            : await client.signIn.username({ username: id, password });
          if (result.error) {
            return {
              ok: false,
              error: result.error.message ?? "That username or password isn't right",
            };
          }
          if (credentialMutationRevisionRef.current !== guard.revision) {
            return { ok: false, error: "Sign in was cancelled" };
          }

          guard.release();
          await refresh();
          return credentialMutationRevisionRef.current === guard.revision
            ? { ok: true }
            : { ok: false, error: "Sign in was cancelled" };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : "Sign in failed",
          };
        } finally {
          guard.release();
        }
      },

      signUp: async (name, username, password) => {
        if (OFFLINE_MODE) return { ok: true };
        const guard = beginCredentialMutation();
        const pendingSignOut = signOutTransitionRef.current;

        try {
          await Promise.all([guard.drain, pendingSignOut ?? EMPTY_DRAIN]);
          if (credentialMutationRevisionRef.current !== guard.revision) {
            return { ok: false, error: "Sign up was cancelled" };
          }

          const handle = username.trim().toLowerCase();
          const result = await authClient.signUp.email({
            name: name.trim(),
            email: `${handle}@staff.gls.local`,
            password,
            username: handle,
            displayUsername: username.trim(),
          } as never);
          if (result.error) {
            return { ok: false, error: result.error.message ?? "Sign up failed" };
          }
          if (credentialMutationRevisionRef.current !== guard.revision) {
            return { ok: false, error: "Sign up was cancelled" };
          }

          guard.release();
          await refresh();
          return credentialMutationRevisionRef.current === guard.revision
            ? { ok: true }
            : { ok: false, error: "Sign up was cancelled" };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : "Sign up failed",
          };
        } finally {
          guard.release();
        }
      },

      signOut: () => {
        if (OFFLINE_MODE) return Promise.resolve();
        const existingTransition = signOutTransitionRef.current;
        if (existingTransition) return existingTransition;

        // Capture routing and the bound cookie before local revocation. Both
        // cancellations happen synchronously; their raw drains are awaited by
        // the transition before unregister or Better Auth can run.
        const credential = captureAuthCredentialForTeardown(currentUserIdRef.current);
        const storeId = activeStoreIdRef.current;
        const guard = beginCredentialMutation();
        const pushDrain = cancelAndDrainPushRegistration();

        currentUserIdRef.current = null;
        activeStoreIdRef.current = null;
        revokeCredentialBinding();
        setAuditActor(null);
        setUser(null);
        setStores([]);
        setStoresStatus("ok");
        setActiveStoreId(null);
        setReady(true);
        purgeCachedAuth();

        const operation = Promise.resolve().then(async () => {
          try {
            await Promise.all([guard.drain, pushDrain]);
            await unregisterPush({
              credential,
              storeId,
              timeoutMs: PUSH_UNREGISTER_TIMEOUT_MS,
            });

            const controller = new AbortController();
            const client = authClient as unknown as {
              signOut: (options?: {
                fetchOptions?: { signal?: AbortSignal };
              }) => Promise<unknown>;
            };
            const raw = client.signOut({ fetchOptions: { signal: controller.signal } });
            const drain = raw.then(
              () => undefined,
              () => undefined,
            );
            try {
              await withDeadline(
                raw,
                SIGN_OUT_TIMEOUT_MS,
                () => controller.abort(),
              );
            } catch {
              // Local access is already revoked; the remote request is bounded.
            } finally {
              controller.abort();
              // Keep relogin behind every Expo cookie/session storage hook even
              // when the network deadline fired before the raw promise settled.
              await drain;
            }
          } catch {
            // Keep the shared transition resolved so a subsequent login can run.
          } finally {
            clearAuthPrincipalBinding();
            clearLocalAuthStorage();
            guard.release();
          }
        });

        signOutTransitionRef.current = operation;
        const releaseTransition = () => {
          if (signOutTransitionRef.current === operation) {
            signOutTransitionRef.current = null;
          }
        };
        void operation.then(releaseTransition, releaseTransition);
        return operation;
      },

      selectStore: (storeId) => {
        if (!stores.some((store) => store.id === storeId)) return;
        if (!user || currentUserIdRef.current !== user.id) return;

        activeStoreIdRef.current = storeId;
        setActiveStoreId(storeId);

        // Selection may update an already trusted snapshot, but must never bind
        // a newly replaced cookie to whatever user happens to be on screen.
        if (getBoundAuthPrincipalId() === user.id) {
          const write = writeCachedSnapshot(user, stores, storeId);
          if (!write.persisted) revokeCredentialBinding();
        }
      },

      createStore: async (name) => {
        if (OFFLINE_MODE) return { ok: true };
        const pendingSignOut = signOutTransitionRef.current;
        if (pendingSignOut) await pendingSignOut;

        const expectedUserId = currentUserIdRef.current;
        const result = await api.createStore({ name, currency: "NGN" });
        if (!result.ok) return { ok: false, error: result.error.message };
        await refresh();

        // Only a successfully refreshed, still-bound snapshot may select the
        // newly created store. Never write an unbound active-store legacy key.
        const snapshot = readCachedSnapshot();
        if (
          expectedUserId &&
          currentUserIdRef.current === expectedUserId &&
          snapshot?.user.id === expectedUserId &&
          getBoundAuthPrincipalId() === expectedUserId &&
          snapshot.stores.some((store) => store.id === result.data.id)
        ) {
          const write = writeCachedSnapshot(snapshot.user, snapshot.stores, result.data.id);
          if (write.persisted) {
            activeStoreIdRef.current = result.data.id;
            setActiveStoreId(result.data.id);
          } else {
            revokeCredentialBinding();
          }
        }
        return { ok: true };
      },

      refresh,
    };
  }, [
    activeRole,
    activeStore,
    beginCredentialMutation,
    credentialRevision,
    ready,
    refresh,
    revokeCredentialBinding,
    stores,
    storesStatus,
    user,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

/** Convenience hook for gating UI: `const can = usePermission();` */
export function usePermission() {
  return useAuth().can;
}
