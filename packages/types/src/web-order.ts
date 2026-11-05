/**
 * VIP web ordering: a guest scans the QR code on their table, browses the menu
 * in a browser, and places an order. The order lands in the store's Durable
 * Object and syncs to the POS, where staff bill it and take the food over.
 *
 * There is no guest login and no online payment — the table token identifies
 * the table, and payment happens in person against the printed receipt.
 */

import type { StoreRole } from "./permissions";

/**
 * The roles that receive VIP orders: they get the ringing push and the
 * full-screen alert. Floor leads act on guest orders; owners, cashiers, waiters
 * and the kitchen are not interrupted. One list, used by the server's push and
 * the app's alert, so the two can never disagree.
 */
export const VIP_ORDER_ROLES: readonly StoreRole[] = ["manager", "supervisor"];

export function receivesVipOrders(role: StoreRole | null | undefined): boolean {
  return !!role && VIP_ORDER_ROLES.includes(role);
}

export type WebOrderStatus =
  /** Guest submitted it; waiting for staff to see it. */
  | "received"
  /** Staff accepted it and it's being prepared. */
  | "preparing"
  /** Ready to carry to the table. */
  | "ready"
  /** Delivered to the table and billed. */
  | "served"
  | "cancelled";

export interface WebOrderLine {
  productId: string;
  /** Selected variant snapshot; absent for a simple single-price product. */
  variantId?: string;
  variantName?: string;
  name: string;
  /** Unit price in integer minor units, resolved server-side from the catalog. */
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  note?: string;
}

export interface WebOrder {
  id: string;
  /** Short human code read out loud in the restaurant, e.g. "V-4821". */
  code: string;
  tableId: string;
  tableName: string;
  status: WebOrderStatus;
  lines: WebOrderLine[];
  subtotal: number;
  total: number;
  currency: string;
  /** Optional guest details, all self-declared. */
  guestName?: string;
  guestPhone?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
  /** Set when staff turn it into a sale. */
  receiptId?: string;
  /**
   * Server-owned. When the order was accepted (left "received"), the server
   * took its items out of menu stock. Billing must not deduct them again.
   */
  stockDeductedAt?: number;
  /** Server-owned. Set when a cancelled order's stock was put back. */
  stockRestoredAt?: number;
}

/** What the guest's browser submits. Prices are deliberately absent. */
export interface PlaceWebOrderRequest {
  items: { productId: string; variantId?: string; quantity: number; note?: string }[];
  guestName?: string;
  guestPhone?: string;
  note?: string;
}

/** Menu payload for the public page — no costs, no stock internals. */
export interface PublicMenuItem {
  id: string;
  name: string;
  price: number;
  categoryId?: string;
  /** Present for products whose sellable choices must be selected explicitly. */
  variants?: {
    id: string;
    name: string;
    /** Integer minor units. */
    price: number;
    available: boolean;
  }[];
  /** False when out of stock, so the page can disable it. */
  available: boolean;
}

export interface PublicMenu {
  storeName: string;
  currency: string;
  tableName: string;
  categories: { id: string; name: string }[];
  items: PublicMenuItem[];
}
