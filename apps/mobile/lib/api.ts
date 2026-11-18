import type {
  ApiResult,
  ChannelLink,
  ChannelLinkView,
  ChannelStatus,
  DayCloseResult,
  DayCloseSummary,
  StockTransfer,
  StoreMembership,
  StoreProfile,
  StoreRole,
  ReconciliationReport,
} from "@gls-pos/types";
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

/**
 * One add or remove on a central item.
 *
 * `delta` is signed (+50 arrived, -20 spoilt), and the before/after balances are
 * stored with it so the owner sees how the total got where it is.
 */
export type CentralStockMovement = {
  id: string;
  itemId: string;
  storeId?: string | null;
  delta: number;
  baseStock: number;
  resulting: number;
  note: string | null;
  actorId?: string | null;
  actorName: string | null;
  at: string | number;
  /** Local-only: the server refused this change, so it was undone. */
  failed?: boolean;
  syncError?: string;
};

/** A send from the centre to a branch, enriched with names for list screens. */
export type CentralAllocation = {
  id: string;
  globalItemId: string;
  fromStoreId: string;
  toStoreId: string;
  /** Legacy destination-product mapping; new transfers leave this null. */
  productId: string | null;
  quantity: number;
  /** Quantity the shop records as received. Mirrors `quantity` on new rows. */
  receiveQuantity?: number | null;
  /** The item's unit at send time, e.g. 'kg'. */
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

/**
 * A saved rate: how much of one central item turns into one menu product.
 * Example: 0.2 kg of rice per plate of Jollof rice.
 */
export type CentralConversionRate = {
  id: string;
  storeId: string;
  globalItemId: string;
  productId: string | null;
  portionName: string;
  quantityPerPortion: number;
  isActive: boolean;
  itemName: string;
  itemUnit: string;
};

/** One batch of Stock Room stock turned into a menu product. */
export type CentralConversion = {
  id: string;
  storeId: string;
  globalItemId: string;
  productId: string | null;
  bulkQuantityUsed: number;
  portionsProduced: number;
  convertedAt: string | number;
  notes: string | null;
  itemName: string;
  itemUnit: string;
  productName?: string;
  /** Local-only: the last sync failure for this conversion, if any. */
  syncError?: string;
  /**
   * Local-only: the server refused this batch (stock gone, product untracked).
   * A failed row is hidden and its stock returns to the Stock Room.
   */
  failed?: boolean;
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

/** A store's self-check, tagged with the store it describes. */
export type StoreCheck = ReconciliationReport & { storeId: string };

/** Result of copying another shop's menu into this one. */
export type CopyCatalogResult = {
  fromStoreId: string;
  toStoreId: string;
  categories: number;
  products: number;
  modifiers: number;
  /** Items this shop already had. They are left exactly as they are. */
  skipped: number;
  /** Rows the destination refused (role limits). */
  refused: number;
};

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

  /**
   * Copy another shop's menu (categories, products, modifiers) into this one.
   *
   * Runs server-side through the same write path a till uses, so it takes as
   * long as a large catalogue needs to be written. The caller must be able to
   * write the menu here and read it there.
   */
  copyCatalog: (storeId: string, fromStoreId: string) =>
    request<CopyCatalogResult>(
      "/catalog/copy",
      {
        method: "POST",
        headers: { "x-store-id": storeId },
        body: JSON.stringify({ fromStoreId }),
      },
      120_000,
    ),

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
  adjustCentralStock: (itemId: string, body: { id?: string; delta: number; note?: string }) =>
    // The server writes the balance and the ledger row together. Retrying is
    // safe because the row id is minted on the device.
    request<{ item: CentralItem; movement: CentralStockMovement; duplicate: boolean }>(
      `/inventory/${itemId}/adjust`,
      { method: "POST", body: JSON.stringify(body) },
      30_000,
    ),
  listCentralStockMovements: (itemId: string, limit = 50) =>
    request<CentralStockMovement[]>(`/inventory/${itemId}/movements?limit=${limit}`),

  listAllocations: (query?: { toStoreId?: string; fromStoreId?: string; status?: CentralAllocationStatus }) => {
    const params = new URLSearchParams();
    if (query?.toStoreId) params.set("toStoreId", query.toStoreId);
    if (query?.fromStoreId) params.set("fromStoreId", query.fromStoreId);
    if (query?.status) params.set("status", query.status);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return request<CentralAllocation[]>(`/inventory/allocations${suffix}`);
  },
  // --- Delivery apps (Azumi) ---
  channelStatuses: (storeId: string) =>
    request<ChannelStatus[]>("/channels", { headers: { "x-store-id": storeId } }),
  connectChannel: (storeId: string, channel: string, apiKey: string) =>
    request<ChannelStatus>(`/channels/${channel}/connect`, {
      method: "POST",
      headers: { "x-store-id": storeId, "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    }),
  disconnectChannel: (storeId: string, channel: string) =>
    request<{ disconnected: true }>(`/channels/${channel}`, {
      method: "DELETE",
      headers: { "x-store-id": storeId },
    }),
  channelLinks: (storeId: string, channel: string) =>
    request<ChannelLinkView>(`/channels/${channel}/links`, { headers: { "x-store-id": storeId } }, 20_000),
  saveChannelLinks: (storeId: string, channel: string, links: ChannelLink[]) =>
    request<unknown>(`/channels/${channel}/links`, {
      method: "PUT",
      headers: { "x-store-id": storeId, "Content-Type": "application/json" },
      body: JSON.stringify({ links }),
    }, 20_000),
  autoLinkChannel: (storeId: string, channel: string) =>
    request<{ added: number; total: number; unmatched: number }>(`/channels/${channel}/auto-link`, {
      method: "POST",
      headers: { "x-store-id": storeId },
    }, 20_000),
  syncChannels: (storeId: string) =>
    request<Record<string, { pushed: number; error?: string }>>("/channels/sync", {
      method: "POST",
      headers: { "x-store-id": storeId },
    }, 20_000),

  // --- Central store transfers (stock lives in each store's DO) ---
  listTransferBranches: (centralStoreId: string) =>
    request<{ id: string; name: string }[]>("/transfers/branches", {
      headers: { "x-store-id": centralStoreId },
    }),
  sendTransfer: (
    centralStoreId: string,
    body: { id: string; ingredientId: string; toStoreId: string; quantity: number; note?: string },
  ) =>
    request<StockTransfer>("/transfers", {
      method: "POST",
      headers: { "x-store-id": centralStoreId, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  importLegacyCentralStock: (centralStoreId: string) =>
    request<{ imported: number }>("/transfers/import-legacy", {
      method: "POST",
      headers: { "x-store-id": centralStoreId },
    }),
  createAllocation: (body: {
    id?: string;
    globalItemId: string;
    toStoreId: string;
    quantity: number;
    notes?: string;
  }) =>
    // Longer than the default: the server may need to wake the destination
    // store for reads, which can outlast 12s on a cold store. Retrying is safe
    // (the server dedupes by id).
    request<CentralAllocation>("/inventory/allocations", { method: "POST", body: JSON.stringify(body) }, 30_000),
  fulfillAllocation: (id: string) =>
    // Deliberately longer than the default for cold starts. Retrying is safe
    // (the server dedupes by allocation id).
    request<{ success: boolean; allocationId: string }>(
      `/inventory/allocations/${id}/fulfill`,
      { method: "POST" },
      30_000,
    ),
  cancelAllocation: (id: string) =>
    request<{ success: boolean; allocationId: string }>(`/inventory/allocations/${id}/cancel`, { method: "POST" }),
  listStoreProducts: (storeId: string) =>
    request<StoreProductOption[]>(`/inventory/store-products?storeId=${encodeURIComponent(storeId)}`),

  listConversionRates: (storeId: string) =>
    request<CentralConversionRate[]>(
      `/inventory/conversion-rates?storeId=${encodeURIComponent(storeId)}`,
    ),
  listConversions: (storeId: string, limit = 50) =>
    request<CentralConversion[]>(
      `/inventory/conversions?storeId=${encodeURIComponent(storeId)}&limit=${limit}`,
    ),
  createConversion: (
    storeId: string,
    body: {
      id?: string;
      globalItemId: string;
      productId: string;
      bulkQuantityUsed: number;
      portionSize?: number;
      notes?: string;
    },
  ) =>
    // The server raises the menu product's stock inside this request, so allow
    // a cold store longer than the default. Retrying is safe (deduped by id).
    request<CentralConversion>(
      `/inventory/conversions?storeId=${encodeURIComponent(storeId)}`,
      { method: "POST", body: JSON.stringify(body) },
      30_000,
    ),

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

  // --- Store self-check (owner only) ---------------------------------------
  /**
   * Ask the store to reconcile itself: stock arithmetic, balances against the
   * movement ledger, receipts that never moved stock, and table tickets left
   * open or claimed twice.
   *
   * Read-only and safe to run mid-trading. Longer timeout because the store may
   * be cold and the check reads every document.
   */
  runStoreCheck: (storeId: string) =>
    request<StoreCheck>("/diag/reconcile", { headers: { "x-store-id": storeId } }, 30_000),

  // --- Frozen daily close (Z-report) ---------------------------------------
  /** Days already closed for this store, newest first. */
  listDayCloses: (storeId: string, limit = 30) =>
    request<{ storeId: string; closes: DayCloseSummary[] }>(`/day-close?limit=${limit}`, {
      headers: { "x-store-id": storeId },
    }),
  /**
   * Close a local trading day. The till sends the day it saw and the exact
   * bounds; the store computes the totals. Closing an already-closed day
   * returns the first copy, so this is safe to retry.
   */
  closeDay: (storeId: string, body: { day: string; from: number; to: number }) =>
    request<{ storeId: string } & DayCloseResult>(
      "/day-close",
      {
        method: "POST",
        headers: { "x-store-id": storeId },
        body: JSON.stringify(body),
      },
      30_000,
    ),
};
