/**
 * Roles & permissions — the single source of truth shared by the Worker and the
 * mobile app. The server enforces these (never trust the client); the UI uses
 * the same matrix to hide what a user can't do, so both stay in step.
 */

export type StoreRole =
  | "owner"
  | "manager"
  | "supervisor"
  | "cashier"
  | "waiter"
  | "kitchen";

/** Every gated capability in the app. */
export type Permission =
  // Selling
  | "sale:create"
  | "sale:refund"
  | "discount:apply"
  | "price:override"
  // Catalog & stock
  | "catalog:read"
  | "catalog:write"
  | "inventory:adjust"
  // Back office
  /** Aggregated business figures: the Reports tab and its drill-down charts. */
  | "reports:view"
  /**
   * The day's individual sales — the Today/Receipts list.
   *
   * Separate from `reports:view` on purpose: a supervisor running the floor
   * needs to look up what was sold and reprint a receipt without being shown
   * the business's aggregate takings and profit.
   */
  | "receipts:view"
  | "expenses:manage"
  | "customers:manage"
  // Administration
  | "staff:manage"
  | "settings:manage"
  | "tables:manage"
  | "audit:view"
  // Kitchen
  | "kitchen:view";

/**
 * Role → permissions. Deliberately explicit rather than hierarchical so it's
 * obvious at a glance who can do what.
 */
export const ROLE_PERMISSIONS: Record<StoreRole, readonly Permission[]> = {
  owner: [
    "sale:create",
    "sale:refund",
    "discount:apply",
    "price:override",
    "catalog:read",
    "catalog:write",
    "inventory:adjust",
    "reports:view",
    "receipts:view",
    "expenses:manage",
    "customers:manage",
    "staff:manage",
    "settings:manage",
    "tables:manage",
    "audit:view",
    "kitchen:view",
  ],
  // Runs the floor and catalog and can see aggregate reports, but cannot manage
  // staff roles or business settings.
  manager: [
    "sale:create",
    "sale:refund",
    "discount:apply",
    "price:override",
    "catalog:read",
    "catalog:write",
    "inventory:adjust",
    "reports:view",
    "receipts:view",
    "expenses:manage",
    "customers:manage",
    "tables:manage",
    "audit:view",
    "kitchen:view",
  ],
  // Manager operational access without aggregate reports, refunds, or
  // discounts. Catalog management and individual receipt lookup remain.
  supervisor: [
    "sale:create",
    "price:override",
    "catalog:read",
    "catalog:write",
    "inventory:adjust",
    "receipts:view",
    "expenses:manage",
    "customers:manage",
    "tables:manage",
    "audit:view",
    "kitchen:view",
  ],
  // Sells and takes payment, but no back office and no reversing money.
  cashier: ["sale:create", "catalog:read", "customers:manage", "tables:manage"],
  // Takes orders to tables; cannot change the menu or see money reports.
  waiter: ["sale:create", "catalog:read", "tables:manage", "kitchen:view"],
  // Kitchen display only.
  kitchen: ["catalog:read", "kitchen:view"],
};

/** Human labels for role pickers. */
export const ROLE_LABELS: Record<StoreRole, string> = {
  owner: "Owner",
  manager: "Manager",
  supervisor: "Supervisor",
  cashier: "Cashier",
  waiter: "Waiter",
  kitchen: "Kitchen",
};

export const ALL_ROLES = Object.keys(ROLE_PERMISSIONS) as StoreRole[];

/** True when the role grants the permission. */
export function roleCan(role: StoreRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Roles that may assign roles to others (guards privilege escalation). */
export function canAssignRoles(role: StoreRole | null | undefined): boolean {
  return role === "owner";
}
