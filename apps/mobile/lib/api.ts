import type { ApiResult, StoreMembership } from "@gls-pos/types";
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

export const api = {
  /** Stores the signed-in user belongs to. */
  listStores: () => request<StoreMembership[]>("/stores"),
  /** Create a store the user will own. */
  createStore: (body: { name: string; currency?: string }) =>
    request<StoreMembership>("/stores", { method: "POST", body: JSON.stringify(body) }),
};
