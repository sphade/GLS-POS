import type { ApiResult, StoreMembership, StoreRole } from "@gls-pos/types";
import { API_URL, authCookie } from "./auth-client";

/**
 * Thin client for the control-plane HTTP API (store registry). Per-store
 * operational data does NOT go through here — it syncs via lib/sync.ts against
 * the store's Durable Object. Every request carries the better-auth cookie.
 */
async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_URL}/api${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookie(),
        ...init?.headers,
      },
    });
    return (await res.json()) as ApiResult<T>;
  } catch (err) {
    return { ok: false, error: { code: "network_error", message: (err as Error).message } };
  }
}

/** Someone with access to the current store. */
export type StoreMember = {
  userId: string;
  name: string;
  email: string;
  role: StoreRole;
};

export const api = {
  /** Stores the signed-in user belongs to. */
  listStores: () => request<StoreMembership[]>("/stores"),
  /** Create a store the user will own. */
  createStore: (body: { name: string; currency?: string }) =>
    request<StoreMembership>("/stores", { method: "POST", body: JSON.stringify(body) }),

  /** Staff roster for a store (requires staff:manage). */
  listMembers: (storeId: string) =>
    request<StoreMember[]>("/members", { headers: { "x-store-id": storeId } }),
  /** Grant or change a member's role by email (owner only). */
  setMemberRole: (storeId: string, email: string, role: StoreRole) =>
    request<{ userId: string; role: StoreRole }>("/members", {
      method: "POST",
      headers: { "x-store-id": storeId },
      body: JSON.stringify({ email, role }),
    }),
  /** Revoke a member's access. */
  removeMember: (storeId: string, userId: string) =>
    request<{ removed: boolean }>(`/members/${userId}`, {
      method: "DELETE",
      headers: { "x-store-id": storeId },
    }),
};
