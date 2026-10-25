import type { ApiResult, StoreMembership, StoreProfile, StoreRole } from "@gls-pos/types";
import { API_URL, authCookie } from "./auth-client";
import { OFFLINE_MODE } from "./offline";

/**
 * Thin client for the control-plane HTTP API (store registry). Per-store
 * operational data does NOT go through here — it syncs via lib/sync.ts against
 * the store's Durable Object. Every request carries the better-auth cookie.
 */
const REQUEST_TIMEOUT_MS = 12_000;

async function request<T>(path: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<ApiResult<T>> {
  // Offline builds never touch the network; every caller already handles a
  // failed result, so screens degrade with a truthful message instead of
  // hanging on a fetch that can never succeed.
  if (OFFLINE_MODE) {
    return { ok: false, error: { code: "offline_build", message: "This build runs without a server." } };
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  init?.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}/api${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookie(),
        ...init?.headers,
      },
    });
    return (await res.json()) as ApiResult<T>;
  } catch (err) {
    const error = err as Error;
    return {
      ok: false,
      error: {
        code: error.name === "AbortError" ? "timeout" : "network_error",
        message: error.name === "AbortError" ? "The server took too long to respond." : error.message,
      },
    };
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", abortFromCaller);
  }
}

/** Someone with access to the current store. */
export type StoreMember = {
  userId: string;
  name: string;
  email: string;
  /** Login handle; null for older accounts created before username login. */
  username: string | null;
  role: StoreRole;
};

/**
 * Someone who already works in another of your shops and could be added to this
 * one. `shops` is how many of your shops they're already in.
 */
export type AttachableStaff = {
  userId: string;
  name: string;
  username: string | null;
  shops: number;
};

/** Stock owned by the central store. Quantities are whole base units. */
export type CentralItem = {
  id: string;
  ownerId?: string | null;
  storeId?: string | null;
  name: string;
  unit: string;
  totalStock: number;
  minStock: number;
  description: string | null;
  createdAt?: string | number;
  updatedAt?: string | number;
};

export type CentralAllocationStatus = "pending" | "fulfilled" | "cancelled";

/** A send from the centre to a branch, enriched with names for list screens. */
export type CentralAllocation = {
  id: string;
  globalItemId: string;
  fromStoreId: string;
  toStoreId: string;
  productId: string | null;
  quantity: number;
  /** What the receiving shop's stock rises by. Equal to `quantity` when the
   *  two sides count in the same unit (or on rows from before conversion). */
  receiveQuantity?: number | null;
  /** The receiving shop's unit, e.g. 'pieces'. */
  receiveUnit?: string | null;
  status: CentralAllocationStatus;
  allocatedAt: string | number;
  stockDeductedAt?: string | number | null;
  fulfilledAt?: string | number | null;
  notes: string | null;
  allocatedByUserId?: string | null;
  allocatedByName?: string | null;
  fulfilledByUserId?: string | null;
  fulfilledByName?: string | null;
  itemName: string;
  itemUnit: string;
  fromStoreName: string;
  toStoreName: string;
  /** Local-only: the last sync failure for this transfer, if any. */
  syncError?: string;
};

export type StoreProductOption = {
  id: string;
  name: string;
  stock: number | null;
  stockState: string;
};

/** Owner-defined yield between two branch products: inputQty of one makes outputQty of the other. */
export type ProductionRule = {
  id: string;
  storeId: string;
  inputProductId: string;
  outputProductId: string;
  inputQty: number;
  outputQty: number;
};

/** Result of one production run, with the stocks after the writes. */
export type ProductionResult = {
  success: boolean;
  ruleId: string;
  duplicate: boolean;
  inputProductId: string;
  outputProductId: string;
  inputName: string;
  outputName: string;
  inputStock: number;
  outputStock: number;
};

export const CENTRAL_UNITS = ["kg", "liters", "pieces", "bags", "boxes", "cans"] as const;

export const api = {
  /** Stores the signed-in user belongs to. */
  listStores: () => request<StoreMembership[]>("/stores"),
  /** Create a store the user will own. */
  createStore: (body: { name: string; currency?: string }) =>
    request<StoreMembership>("/stores", { method: "POST", body: JSON.stringify(body) }),
  /** Create the owner's parent central store, or return the existing one. */
  ensureCentralStore: (body?: { name?: string; currency?: string }) =>
    request<StoreMembership>("/stores/central", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  /** Staff roster for a store (requires staff:manage). */
  listMembers: (storeId: string) =>
    request<StoreMember[]>("/members", { headers: { "x-store-id": storeId } }),

  /**
   * Create a staff account outright. The owner supplies the person's name and a
   * password; the username defaults to a handle derived from the name.
   */
  createStaff: (
    storeId: string,
    body: { name: string; username?: string; password: string; role: StoreRole },
  ) =>
    request<{ userId: string; username: string }>("/members/staff", {
      method: "POST",
      headers: { "x-store-id": storeId },
      body: JSON.stringify(body),
    }),

  /**
   * People already in your other shops, for adding without a second account.
   * Scoped server-side to shops you own — not a global user search.
   */
  listAttachableStaff: (storeId: string) =>
    request<AttachableStaff[]>("/members/attachable", { headers: { "x-store-id": storeId } }),

  /** Add an existing account to this store by username, with a per-store role. */
  attachStaff: (storeId: string, username: string, role: StoreRole) =>
    request<{ userId: string; role: StoreRole }>("/members/attach", {
      method: "POST",
      headers: { "x-store-id": storeId },
      body: JSON.stringify({ username, role }),
    }),

  /** Reset a staff member's password (owner only). */
  resetStaffPassword: (storeId: string, userId: string, password: string) =>
    request<{ updated: boolean }>(`/members/${userId}/password`, {
      method: "POST",
      headers: { "x-store-id": storeId },
      body: JSON.stringify({ password }),
    }),
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

  /** Business profile — readable by any member, writable by the owner. */
  getBusiness: (storeId: string) =>
    request<StoreProfile>("/business", { headers: { "x-store-id": storeId } }),
  updateBusiness: (storeId: string, body: Partial<Omit<StoreProfile, "id">>) =>
    request<StoreProfile>("/business", {
      method: "PATCH",
      headers: { "x-store-id": storeId },
      body: JSON.stringify(body),
    }),

  // --- Central stock hub (warehouse -> branches) ---------------------------
  //
  // Control-plane API: needs network + an owner/manager role. Every caller
  // already handles a failed result, so offline screens show the message
  // instead of hanging.
  listCentralItems: () => request<CentralItem[]>("/inventory"),
  createCentralItem: (body: {
    id?: string;
    name: string;
    unit: string;
    totalStock?: number;
    minStock?: number;
    description?: string;
  }) => request<CentralItem>("/inventory", { method: "POST", body: JSON.stringify(body) }),
  updateCentralItem: (id: string, body: { name?: string; unit?: string; totalStock?: number; minStock?: number; description?: string }) =>
    request<CentralItem[]>(`/inventory/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteCentralItem: (id: string) =>
    request<{ message: string }>(`/inventory/${id}`, { method: "DELETE" }),

  listAllocations: (query?: { toStoreId?: string; fromStoreId?: string; status?: CentralAllocationStatus }) => {
    const params = new URLSearchParams();
    if (query?.toStoreId) params.set("toStoreId", query.toStoreId);
    if (query?.fromStoreId) params.set("fromStoreId", query.fromStoreId);
    if (query?.status) params.set("status", query.status);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return request<CentralAllocation[]>(`/inventory/allocations${suffix}`);
  },
  createAllocation: (body: {
    id?: string;
    globalItemId: string;
    toStoreId: string;
    productId?: string;
    quantity: number;
    receiveQuantity?: number;
    receiveUnit?: string;
    notes?: string;
  }) =>
    // Longer than the default: the server raises the destination store's
    // Durable Object stock inside this request, which can outlast 12s on a
    // cold store. Retrying is safe (the server dedupes by id).
    request<CentralAllocation>("/inventory/allocations", { method: "POST", body: JSON.stringify(body) }, 30_000),
  fulfillAllocation: (id: string) =>
    // Deliberately longer than the default: the server wakes the destination
    // store's Durable Object and writes there before answering, which can
    // outlast 12s on a cold store. Retrying is safe (the server dedupes).
    request<{ success: boolean; allocationId: string }>(
      `/inventory/allocations/${id}/fulfill`,
      { method: "POST" },
      30_000,
    ),
  cancelAllocation: (id: string) =>
    request<{ success: boolean; allocationId: string }>(`/inventory/allocations/${id}/cancel`, { method: "POST" }),
  listStoreProducts: (storeId: string) =>
    request<StoreProductOption[]>(`/inventory/store-products?storeId=${encodeURIComponent(storeId)}`),

  listProductionRules: (storeId: string) =>
    request<ProductionRule[]>(
      `/inventory/production-rules?storeId=${encodeURIComponent(storeId)}`,
    ),
  saveProductionRule: (body: {
    storeId: string;
    inputProductId: string;
    outputProductId: string;
    inputQty: number;
    outputQty: number;
  }) =>
    request<ProductionRule>("/inventory/production-rules", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteProductionRule: (id: string, storeId: string) =>
    request<{ success: boolean; id: string }>(
      `/inventory/production-rules/${encodeURIComponent(id)}?storeId=${encodeURIComponent(storeId)}`,
      { method: "DELETE" },
    ),
  produce: (body: {
    storeId: string;
    ruleId: string;
    inputQty: number;
    outputQty: number;
    ref: string;
    note?: string;
  }) =>
    // Same headroom as a delivery confirm: the store Durable Object wakes and
    // commits two stock writes before answering. Retrying is safe.
    request<ProductionResult>(
      "/inventory/produce",
      { method: "POST", body: JSON.stringify(body) },
      30_000,
    ),
};
