/**
 * VIP web ordering: a guest scans the QR code on their table, browses the menu
 * in a browser, and places an order. The order lands in the store's Durable
 * Object and syncs to the POS, where staff bill it and take the food over.
 *
 * There is no guest login and no online payment — the table token identifies
 * the table, and payment happens in person against the printed receipt.
 */

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
}

/** What the guest's browser submits. Prices are deliberately absent. */
export interface PlaceWebOrderRequest {
  items: { productId: string; quantity: number; note?: string }[];
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
