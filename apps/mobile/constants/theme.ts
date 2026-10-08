/**
 * GLS-POS Theme - Modernized with improved contrast and visual hierarchy
 * Based on Zobaze POS but with better UX
 */
export const colors = {
  // GLS brand green with improved contrast
  primary: "#4CAF50",
  primaryDark: "#388E3C",
  brand: "#81C784",
  accent: "#4CAF50",
  green: "#4CAF50",
  dkGreen: "#388E3C",
  // Action colours
  actionAdd: "#4CAF50",
  actionRemove: "#F44336",
  red300: "#E57373",
  red500: "#F44336",
  red800: "#C62828",
  blue50: "#EAF4E0",
  blue600: "#388E3C",
  // Grey scale
  grey50: "#FAFAFA",
  grey100: "#F5F5F5",
  grey200: "#EEEEEE",
  grey300: "#E0E0E0",
  grey400: "#BDBDBD",
  grey500: "#9E9E9E",
  grey600: "#757575",
  grey700: "#616161",
  grey800: "#424242",
  grey900: "#212121",
  // Backgrounds
  screenBg: "#F5F5F5",
  card: "#FFFFFF",
  white: "#FFFFFF",
  textTitle: "#212121",
  textSecondary: "#757575",
  hint: "#9E9E9E",
  // Status
  outOfStock: "#F44336",
  lowStock: "#FF9800",
  categoryHeader: "#64B5F6",
};

export const layout = {
  cardRadius: 8,
  cardMargin: 4,
  cardElevation: 2,
  imageArea: 90,
  gridCols: 3,
};

export const LONG_PRESS_MS = 180;

export const strings = {
  reports: "Reports",
  today: "Today",
  counter: "Counter",
  items: "Items",
  more: "More",
  searchHint: "Search items...",
  goToCounter: "Go To Counter",
  newItem: "New Item",
  outOfStock: "Out of stock",
  counterIsEmpty: "Counter Is Empty",
  posReceipts: "POS Receipts",
  onlineOrders: "Online Orders",
  noTransactionsToday: "No Transactions Today",
  loadTenMore: "Load 10 More",
  getOldReceipts: "Get Old Receipts",
  someReceiptsNotSync: "Some Receipts are not sync with cloud!",
  guest: "Guest",
  by: "by",
  charge: "Charge",
  billTotal: "Bill Total",
  amountReceived: "Amount Received",
  amountShort: "Amount Short",
  receivedByCash: "Received by Cash",
  customerDetailsOptional: "Customer Details (optional)",
  selectPaymentMode: "Select Payment Mode",
  newSale: "New Sale",
  grandTotal: "Grand Total",
  subtotal: "Subtotal",
  thankYou: "Thank You! Visit again!",
  addItem: "Add Item",
  save: "Save",
  delete: "Delete",
};

const symbols: Record<string, string> = { NGN: "₦", USD: "$", EUR: "€", GBP: "£", INR: "₹" };
export function currencySymbol(currency = "NGN") {
  return symbols[currency] ?? `${currency} `;
}

export function formatAmount(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100);
  const kobo = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${kobo === 0 ? "" : `.${String(kobo).padStart(2, "0")}`}`;
}

export function formatMoney(minor: number, currency = "NGN"): string {
  return `${currencySymbol(currency)}${formatAmount(minor)}`;
}

export const denominations: Record<string, number[]> = {
  USD: [1, 2, 5, 10, 20, 50, 100],
  NGN: [5, 10, 20, 50, 100, 500, 1000],
  INR: [10, 20, 50, 100, 200, 500, 2000],
  ZAR: [10, 20, 50, 100, 200],
  KES: [50, 100, 200, 500, 1000, 5000],
  GHS: [5, 10, 20, 50, 100, 200],
  PHP: [20, 50, 100, 200, 500, 1000],
  MYR: [1, 2, 5, 10, 20, 50, 100],
};
export function denominationsFor(currency = "USD"): number[] {
  return denominations[currency] ?? [100, 500, 1000];
}
