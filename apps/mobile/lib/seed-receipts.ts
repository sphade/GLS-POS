import type { Receipt } from "./cart";

/**
 * Demo receipts so Reports / Today / drill-down charts have data on first launch.
 * Spread across today, yesterday, this week and earlier months so the
 * HOURLY / WEEKLY / MONTHLY views all show bars. Amounts are NGN minor units.
 * Remove this seed once the real backend feeds receipts.
 */

const HOUR = 3600_000;
const DAY = 86_400_000;

type Line = { name: string; qty: number; price: number };

function receiptAt(
  n: number,
  offsetMs: number,
  mode: string,
  customerName: string | null,
  lines: Line[],
): Receipt {
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  return {
    id: `seed_${n}`,
    number: `#${1000 + n}`,
    customerName,
    mode,
    itemCount,
    total,
    currency: "NGN",
    createdAt: Date.now() - offsetMs,
    synced: n % 7 !== 0, // a couple left unsynced to show the red banner
    lines,
    cashReceived: mode === "Cash" ? total + 50000 : undefined,
  };
}

export function seedReceipts(): Receipt[] {
  const r: Receipt[] = [
    // --- today, across the trading hours ---
    receiptAt(1, 8 * HOUR, "Cash", "Walk-in", [{ name: "Jollof Rice", qty: 2, price: 250000 }, { name: "Chicken", qty: 2, price: 180000 }]),
    receiptAt(2, 7 * HOUR, "Debit Card", "Ada", [{ name: "Fried Rice", qty: 1, price: 250000 }, { name: "Coke", qty: 2, price: 40000 }]),
    receiptAt(3, 6 * HOUR, "Cash", null, [{ name: "Shawarma", qty: 3, price: 200000 }]),
    receiptAt(4, 5 * HOUR, "UPI / BHIM", "Musa", [{ name: "Pizza", qty: 1, price: 1200000 }]),
    receiptAt(5, 4 * HOUR, "Cash", null, [{ name: "Meat Pie", qty: 4, price: 80000 }, { name: "Zobo", qty: 2, price: 50000 }]),
    receiptAt(6, 3 * HOUR, "Debit Card", "Tunde", [{ name: "Jollof Rice", qty: 3, price: 250000 }, { name: "Chicken", qty: 3, price: 180000 }]),
    receiptAt(7, 2 * HOUR, "Cash", null, [{ name: "Suya", qty: 2, price: 150000 }]),
    receiptAt(8, 1 * HOUR, "Credit Card", "Ngozi", [{ name: "Fried Rice", qty: 2, price: 250000 }, { name: "Water", qty: 2, price: 20000 }]),
    receiptAt(9, 20 * 60_000, "Cash", null, [{ name: "Coffee", qty: 1, price: 120000 }]),

    // --- yesterday ---
    receiptAt(10, DAY + 5 * HOUR, "Cash", "Bola", [{ name: "Jollof Rice", qty: 5, price: 250000 }]),
    receiptAt(11, DAY + 3 * HOUR, "Debit Card", null, [{ name: "Pizza", qty: 2, price: 1200000 }, { name: "Coke", qty: 4, price: 40000 }]),
    receiptAt(12, DAY + 1 * HOUR, "UPI / BHIM", "Emeka", [{ name: "Shawarma", qty: 4, price: 200000 }]),

    // --- earlier this week ---
    receiptAt(13, 3 * DAY + 6 * HOUR, "Cash", null, [{ name: "Fried Rice", qty: 3, price: 250000 }, { name: "Chicken", qty: 3, price: 180000 }]),
    receiptAt(14, 4 * DAY + 4 * HOUR, "Cash", "Grace", [{ name: "Suya", qty: 6, price: 150000 }]),
    receiptAt(15, 5 * DAY + 2 * HOUR, "Debit Card", null, [{ name: "Pizza", qty: 1, price: 1200000 }]),

    // --- previous months (for MONTHLY view) ---
    receiptAt(16, 35 * DAY, "Cash", null, [{ name: "Jollof Rice", qty: 8, price: 250000 }, { name: "Chicken", qty: 8, price: 180000 }]),
    receiptAt(17, 68 * DAY, "Debit Card", "Sade", [{ name: "Fried Rice", qty: 10, price: 250000 }]),
  ];
  return r;
}
