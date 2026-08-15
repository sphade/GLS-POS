import { useSession } from "./auth-client";
import { useCatalog } from "./catalog";

type Permission = "create" | "read" | "update" | "delete";

type RolePermissions = {
  [role: string]: Permission[];
};

/**
 * App-level permissions. Only admins can perform write operations on users.
 * This is checked against session.user.role (app-wide role).
 */
export const appResources = {
  users: {
    permissions: {
      admin: ["create", "read", "update", "delete"],
      user: ["read"],
    } as RolePermissions,
  },
} as const;

/**
 * Organization-level permissions. These are scoped per-organization
 * and check against the staff member's role in that organization.
 * This is checked against staff[].role (org-specific role).
 */
export const orgResources = {
  inventoryItems: {
    permissions: {
      owner: ["create", "read", "update", "delete"],
      manager: ["create", "read", "update", "delete"],
      cashier: ["read"],
    } as RolePermissions,
  },
  staff: {
    permissions: {
      owner: ["create", "read", "update", "delete"],
      manager: ["read"],
      cashier: [],
    } as RolePermissions,
  },
  categories: {
    permissions: {
      owner: ["create", "read", "update", "delete"],
      manager: ["create", "read", "update", "delete"],
      cashier: ["read"],
    } as RolePermissions,
  },
  modifiers: {
    permissions: {
      owner: ["create", "read", "update", "delete"],
      manager: ["create", "read", "update", "delete"],
      cashier: ["read"],
    } as RolePermissions,
  },
  ingredients: {
    permissions: {
      owner: ["create", "read", "update", "delete"],
      manager: ["create", "read", "update", "delete"],
      cashier: ["read"],
    } as RolePermissions,
  },
  tables: {
    permissions: {
      owner: ["create", "read", "update", "delete"],
      manager: ["create", "read", "update", "delete"],
      cashier: ["read"],
    } as RolePermissions,
  },
  customers: {
    permissions: {
      owner: ["create", "read", "update", "delete"],
      manager: ["create", "read", "update", "delete"],
      cashier: ["create", "read"],
    } as RolePermissions,
  },
  reports: {
    permissions: {
      owner: ["create", "read", "update", "delete"],
      manager: ["create", "read", "update", "delete"],
      cashier: [],
    } as RolePermissions,
  },
} as const;

/**
 * Hook for checking role-based permissions on resources.
 * Supports both app-level (admin) and org-level (owner/manager/cashier) permissions.
 *
 * - App permissions: checked against session.user.role
 * - Org permissions: checked against staff member's role in the organization
 */
export function usePermission() {
  const { data: session } = useSession();
  const { staff } = useCatalog();

  // Type session to access user object
  const sessionData = session as unknown as {
    user?: { id?: string; role?: string };
  };

  // App-level role from session
  const appRole = sessionData?.user?.role || "user";

  // Find the current user's staff record to get their org role
  const currentUserStaff = staff.find((s) => s.id === sessionData?.user?.id);
  const orgRole = currentUserStaff?.role || "guest";

  // Unified permission checker that handles both app and org resources
  const checkPermission = (resource: string, action: Permission): boolean => {
    // Check if it's an app resource
    if (resource in appResources) {
      const perms =
        appResources[resource as keyof typeof appResources].permissions[
          appRole
        ] || [];
      return perms.includes(action);
    }
    // Otherwise check org resources
    if (resource in orgResources) {
      const perms =
        orgResources[resource as keyof typeof orgResources].permissions[
          orgRole
        ] || [];
      return perms.includes(action);
    }
    return false;
  };

  return {
    appRole,
    orgRole,
    // Unified permission checker for both app and org resources
    can: (resource: string, action: Permission) => {
      return checkPermission(resource, action);
    },
    // App-level permissions (admin operations on users)
    canAppAdmin: (action: Permission) => {
      const perms = appResources.users.permissions[appRole] || [];
      return perms.includes(action);
    },
    canAppRead: () =>
      appResources.users.permissions[appRole]?.includes("read") ?? false,
    canAppCreate: () =>
      appResources.users.permissions[appRole]?.includes("create") ?? false,
    canAppUpdate: () =>
      appResources.users.permissions[appRole]?.includes("update") ?? false,
    canAppDelete: () =>
      appResources.users.permissions[appRole]?.includes("delete") ?? false,
    // Org-level permissions (org-scoped resources)
    canRead: (resource: keyof typeof orgResources) =>
      orgResources[resource].permissions[orgRole]?.includes("read") ?? false,
    canCreate: (resource: keyof typeof orgResources) =>
      orgResources[resource].permissions[orgRole]?.includes("create") ?? false,
    canUpdate: (resource: keyof typeof orgResources) =>
      orgResources[resource].permissions[orgRole]?.includes("update") ?? false,
    canDelete: (resource: keyof typeof orgResources) =>
      orgResources[resource].permissions[orgRole]?.includes("delete") ?? false,
  };
}
