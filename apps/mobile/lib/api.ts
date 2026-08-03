import Constants from "expo-constants";
import type { ApiResult, Order, Product } from "@gls-pos/types";

/**
 * Base URL for the Hono server. Override via the EXPO_PUBLIC_API_URL env var.
 * Defaults to localhost for web/simulator; use your machine's LAN IP for a
 * physical device.
 */
const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "http://localhost:8787";

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_URL}/api${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    return (await res.json()) as ApiResult<T>;
  } catch (err) {
    return {
      ok: false,
      error: { code: "network_error", message: (err as Error).message },
    };
  }
}

export const api = {
  listProducts: () => request<Product[]>("/products"),
  getProduct: (id: string) => request<Product>(`/products/${id}`),
  createProduct: (body: Partial<Product>) =>
    request<Product>("/products", { method: "POST", body: JSON.stringify(body) }),
  updateProduct: (id: string, body: Partial<Product>) =>
    request<Product>(`/products/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteProduct: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/products/${id}`, { method: "DELETE" }),
  listOrders: () => request<Order[]>("/orders"),
  getOrder: (id: string) => request<Order>(`/orders/${id}`),
  createOrder: (body: Partial<Order>) =>
    request<Order>("/orders", { method: "POST", body: JSON.stringify(body) }),
};
