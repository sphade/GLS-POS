import type { ApiResult, StoreMembership } from "@gls-pos/types";
import { API_URL, authCookie } from "./auth-client";

const EXPO_ORIGIN = "glspos://";

/**
 * Thin client for the control-plane HTTP API (store registry). Per-store
 * operational data does NOT go through here — it syncs via lib/sync.ts against
 * the store's Durable Object. Every request carries the better-auth cookie.
 */
async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_URL}/api${path}`, {
      ...init,
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        cookie: authCookie(),
        "expo-origin": EXPO_ORIGIN,
        "x-skip-oauth-proxy": "true",
        ...init?.headers,
      },
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
  /** Stores the signed-in user belongs to. */
  listStores: () => request<StoreMembership[]>("/stores"),
  /** Organizations the signed-in user belongs to. */
  listOrganizations: () =>
    request<
      Array<{
        id: string;
        name: string;
        slug: string;
        logo?: string | null;
        metadata?: string;
      }>
    >("/organizations"),
  /** Organizations linked to a specific user. */
  listUserOrganizations: (userId: string) =>
    request<
      Array<{
        id: string;
        name: string;
        slug: string;
        logo?: string | null;
        metadata?: string;
      }>
    >(`/organizations/user/${userId}`),
  /** Create an organization for the signed-in user. */
  createOrganization: (body: {
    name: string;
    slug: string;
    logo?: string | null;
    metadata?: Record<string, unknown>;
  }) =>
    request<{
      id: string;
      name: string;
      slug: string;
      logo?: string | null;
      metadata?: unknown;
      createdAt: string | Date;
    }>("/organizations/create", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Add a member to an organization. */
  addMemberToOrganization: (
    orgId: string,
    body: { userId: string; role: string; organizationId: string },
  ) =>
    request<{
      id: string;
      userId: string;
      organizationId: string;
      role: string;
      createdAt: string | Date;
    }>(`/organizations/${orgId}/members`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Get members of an organization. */
  listOrganizationMembers: (orgId: string) =>
    request<{
      members: Array<{
        id: string;
        userId: string;
        organizationId: string;
        role: string;
        createdAt: string | Date;
        user: {
          id: string;
          name: string;
          email: string;
        };
      }>;
    }>(`/organizations/${orgId}/members`, {
      method: "GET",
    }),
  /** Update the authenticated user's profile. */
  updateProfile: (body: {
    email?: string;
    name?: string;
    oldPassword?: string;
    newPassword?: string;
  }) =>
    request<{ success: boolean }>("/users/profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  /** Admin: Create a new user. */
  admin: {
    createUser: (body: { email: string; name: string; password: string }) =>
      request<{
        user: {
          id: string;
          email: string;
          name: string;
          createdAt: string | Date;
        };
      }>("/admin/users", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    /** Admin: Update a user (password, email, name). */
    updateUser: (body: {
      userId: string;
      email?: string;
      name?: string;
      password?: string;
    }) =>
      request<{ success: boolean }>("/admin/users/" + body.userId, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    /** Admin: Delete a user. */
    deleteUser: (userId: string) =>
      request<{ success: boolean }>("/admin/users/" + userId, {
        method: "DELETE",
      }),
  },
};
