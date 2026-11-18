import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStockDelta,
  isReceiptUpdateAllowed,
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
    if (field === "id") continue; // changing the id addresses a different document
    const tampered = { ...receipt, status: "paid", [field]: "changed" };
    assert.equal(
      isReceiptUpdateAllowed(receipt, tampered),
      false,
      `${field} must not change during a settlement`,
    );
  }
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
