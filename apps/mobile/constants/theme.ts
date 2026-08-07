/**
 * Palette + strings from the Zobaze POS teardown (res/values/colors.xml,
 * strings.xml) so the replicated screens match the original.
 */
export const colors = {
  // GLS brand green (derived from the logo). Deep enough that white text on the
  // primary bar/buttons/active tab stays legible; `brand` is the lighter logo lime.
  primary: "#5AA02C",
  primaryDark: "#3F7A1C",
  brand: "#8BC34A",
  accent: "#8BC34A",
  green: "#3FA34D",
  dkGreen: "#2E7D46",
  red300: "#E57373",
  red500: "#F44336",
  red800: "#C62828",
  blue50: "#EAF4E0",
  blue600: "#3F7A1C",
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
  screenBg: "#E0E0E0",
  card: "#FFFFFF",
  white: "#FFFFFF",
  textTitle: "#424242",
  textSecondary: "#616161",
  hint: "#9E9E9E",
  outOfStock: "#C62828",
  lowStock: "#F44336",
  categoryHeader: "#64B5F6",
};

export const layout = {
  cardRadius: 4,
  cardMargin: 4,
  cardElevation: 2,
  imageArea: 80,
  gridCols: 3,
};

/** Exact labels from strings.xml. */
export const strings = {
  reports: "Reports",
  today: "Today",
  counter: "Counter",
  items: "Items",
  more: "More",
  searchHint: "I want to sell…",
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
  posReports: "POS Reports",
  storefrontReports: "StoreFront Reports",
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

const symbols: Record<string, string> = { USD: "$", NGN: "₦", EUR: "€", GBP: "£", INR: "₹" };
export function currencySymbol(currency = "USD") {
  return symbols[currency] ?? `${currency} `;
}
export function formatMoney(minor: number, currency = "USD"): string {
  return `${currencySymbol(currency)}${(minor / 100).toFixed(2)}`;
}

/** Cash denominations per currency (from CashPaymentActivity). */
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
