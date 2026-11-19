import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStockDelta,
  isReceiptUpdateAllowed,
  stockChainGaps,
  ticketClaimState,
  RECEIPT_IDENTITY_FIELDS,
} from "./invariants.ts";

// --- Stock arithmetic -------------------------------------------------------

test("a sale moves stock down by exactly what was sold", () => {
  assert.deepEqual(applyStockDelta(10, -3), { resulting: 7, actualDelta: -3 });
});

test("stock never goes negative, and the movement records the applied delta", () => {
  // Two tills offline both sell the last 10 units. The second movement must not
  // claim to have removed 10 when only 0 were there to remove.
  assert.deepEqual(applyStockDelta(10, -12), { resulting: 0, actualDelta: -10 });
  assert.deepEqual(applyStockDelta(0, -1), { resulting: 0, actualDelta: 0 });
});

test("deliveries and corrections move stock up by the full amount", () => {
  assert.deepEqual(applyStockDelta(0, 50), { resulting: 50, actualDelta: 50 });
  assert.deepEqual(applyStockDelta(4, 1.5, 1000), { resulting: 5.5, actualDelta: 1.5 });
  // Whole-unit products keep whole numbers: a stray half unit is rounded out
  // rather than left in a balance the grid cannot display.
  assert.deepEqual(applyStockDelta(4, 1.5), { resulting: 6, actualDelta: 2 });
});

test("weighed goods keep three decimals and do not drift", () => {
  assert.deepEqual(applyStockDelta(1.5, -0.25, 1000), { resulting: 1.25, actualDelta: -0.25 });
  // 0.1 + 0.2 style error: rounding the result keeps the ledger readable.
  assert.deepEqual(applyStockDelta(0.1, 0.2, 1000), { resulting: 0.3, actualDelta: 0.2 });
});

test("base + applied delta always equals the resulting balance", () => {
  for (const base of [0, 1, 7.5, 100]) {
    for (const delta of [-200, -7.5, -1, 0, 1, 3.25, 40]) {
      const { resulting, actualDelta } = applyStockDelta(base, delta, 1000);
      assert.equal(Math.round((base + actualDelta) * 1000) / 1000, resulting);
      assert.ok(resulting >= 0, "stock must never be negative");
    }
  }
});

// --- Receipts are append-only ----------------------------------------------

const receipt = {
  id: "rcpt_1",
  number: "#A1001",
  total: 5000,
  currency: "NGN",
  itemCount: 2,
  createdAt: 1_700_000_000_000,
  customerName: null,
  mode: "Cash",
  storeName: "GLS",
  storeReference: undefined,
  servedBy: "Amina",
  discountTotal: 0,
  orderDiscount: undefined,
  lines: [{ name: "Jollof", qty: 2, price: 2500 }],
  cashReceived: 5000,
  status: "unpaid",
};

test("an unpaid bill may be marked paid with nothing else changed", () => {
  assert.equal(isReceiptUpdateAllowed(receipt, { ...receipt, status: "paid", paidAt: 123 }), true);
});

test("a receipt that is re-sent unchanged is accepted, not stuck pending", () => {
  // The server may have stored the sale but lost the response. The till retries;
  // that retry must clear, not be refused as an edit.
  const paid = { ...receipt, status: "paid", paidAt: 1 };
  assert.equal(isReceiptUpdateAllowed(paid, paid), true);
  assert.equal(isReceiptUpdateAllowed(paid, { ...paid, synced: true }), true);
});

test("a paid receipt cannot be edited", () => {
  const paid = { ...receipt, status: "paid" };
  assert.equal(isReceiptUpdateAllowed(paid, { ...paid, total: 1 }), false);
  assert.equal(isReceiptUpdateAllowed(paid, { ...receipt, status: "unpaid" }), false);
});

test("every identity field is protected from an update", () => {
  for (const field of RECEIPT_IDENTITY_FIELDS) {
    // `id` addresses a different document; `createdAt` is pinned server-side
    // instead of compared, so a settlement from a device with a stale copy of a
    // re-dated sale can still go through.
    if (field === "id" || field === "createdAt") continue;
    const tampered = { ...receipt, status: "paid", [field]: "changed" };
    assert.equal(
      isReceiptUpdateAllowed(receipt, tampered),
      false,
      `${field} must not change during a settlement`,
    );
  }
});

test("a settlement from a device holding the old date is allowed; the store pins the day", () => {
  // The server re-dated this sale (wrong terminal clock). The till never saw
  // that correction, so it still sends the original timestamp. Refusing it
  // would leave a paid bill unsettled forever.
  const restated = { ...receipt, status: "paid", createdAt: receipt.createdAt - 86_400_000 };
  assert.equal(isReceiptUpdateAllowed(receipt, restated), true);
});

test("an update cannot be used to reduce a bill", () => {
  // The classic one: re-send yesterday's unpaid bill with a smaller total.
  assert.equal(
    isReceiptUpdateAllowed(receipt, { ...receipt, status: "paid", total: 1, lines: [] }),
    false,
  );
});

test("nonsense is refused rather than trusted", () => {
  assert.equal(isReceiptUpdateAllowed(null, { status: "paid" }), false);
  assert.equal(isReceiptUpdateAllowed(receipt, null), false);
  assert.equal(isReceiptUpdateAllowed(receipt, []), false);
});

// --- Stock history chains ---------------------------------------------------

test("a history that connects reports nothing", () => {
  assert.deepEqual(
    stockChainGaps([
      { id: "m1", baseStock: 0, resulting: 40 },
      { id: "m2", baseStock: 40, resulting: 38 },
      { id: "m3", baseStock: 38, resulting: 176 },
    ]),
    [],
  );
});

test("the BEEF history: 7 units vanished between a sale and a restock", () => {
  // 40 → 38 (a sale), then the next movement starts from 31, not 38.
  const gaps = stockChainGaps([
    { id: "sale", baseStock: 40, resulting: 38, at: 1 },
    { id: "restock_138", baseStock: 31, resulting: 169, at: 2 },
    { id: "restock_8", baseStock: 169, resulting: 177, at: 3 },
  ]);
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0], {
    movementId: "restock_138",
    expected: 38,
    actual: 31,
    gap: -7,
    at: 2,
  });
});

test("a row with no recorded balances starts a fresh segment, not a false break", () => {
  // Older rows may predate `baseStock`. They cannot be judged, so the next row
  // must not be compared against a balance that was never recorded.
  const gaps = stockChainGaps([
    { id: "m1", baseStock: 0, resulting: 10 },
    { id: "legacy" },
    { id: "m3", baseStock: 15, resulting: 12 },
  ]);
  assert.deepEqual(gaps, []);
});

test("an unexplained gain is reported with its sign", () => {
  const gaps = stockChainGaps([
    { id: "m1", baseStock: 0, resulting: 5 },
    { id: "m2", baseStock: 12, resulting: 12 },
  ]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]?.gap, 7);
});

test("weighted goods compare without floating-point noise", () => {
  assert.deepEqual(
    stockChainGaps([
      { id: "m1", baseStock: 0.1, resulting: 0.3 },
      { id: "m2", baseStock: 0.3, resulting: 0.6 },
    ]),
    [],
  );
});

// --- Table ticket leases ---------------------------------------------------

const NOW = 1_700_000_000_000;
const LEASE = 3 * 60_000;

test("an unclaimed table is free", () => {
  assert.equal(ticketClaimState(null, "dev_a", NOW), "free");
  assert.equal(ticketClaimState({}, "dev_a", NOW), "free");
});

test("the till holding a live lease may keep working", () => {
  assert.equal(
    ticketClaimState({ claimedBy: "dev_a", claimedUntil: NOW + LEASE }, "dev_a", NOW),
    "mine",
  );
});

test("another till is refused while the lease is live", () => {
  assert.equal(
    ticketClaimState({ claimedBy: "dev_a", claimedUntil: NOW + LEASE }, "dev_b", NOW),
    "leased",
  );
});

test("an expired lease frees the table", () => {
  assert.equal(
    ticketClaimState({ claimedBy: "dev_a", claimedUntil: NOW - 1 }, "dev_b", NOW),
    "free",
  );
  // A lease with no end time is treated as abandoned, not as a permanent lock.
  assert.equal(ticketClaimState({ claimedBy: "dev_a" }, "dev_b", NOW), "free");
});
