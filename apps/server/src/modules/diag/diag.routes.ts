import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { HttpError } from "../../lib/http-error.js";

/**
 * Diagnostics for correcting receipts whose `createdAt` was stamped with a
 * wrong terminal clock (sales from one day showing on the next), and for the
 * owner asking the store to check itself.
 *
 * Mounted behind requireAuth + withStore: only the owner of the store named in
 * `x-store-id` may list or re-date its receipts, or read the reconciliation.
 * It used to accept a password kept in the source code, which let anyone who
 * saw the repo rewrite any store's sales history.
 */
export const diag = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    if (c.get("role") !== "owner") {
      throw HttpError.forbidden("Only the store owner can run store diagnostics", "owner_required");
    }
    await next();
  })
  .get("/receipts", async (c) => {
    const receipts = await c.get("store").diagListReceipts();
    return ok(c, { storeId: c.get("storeId"), count: receipts.length, receipts });
  })
  /**
   * Read-only self-check: movement arithmetic, balances versus the ledger,
   * movements without products, receipts without stock movements, duplicate
   * table tickets and bills left open for hours.
   *
   * Deliberately a GET with no side effects — the owner can run it as often as
   * they like, and it is safe to call while the shop is trading.
   */
  .get("/reconcile", async (c) => {
    const report = await c.get("store").reconcile();
    return ok(c, { storeId: c.get("storeId"), ...report });
  })
  .post("/receipts/:id/date", async (c) => {
    const { id } = c.req.param();
    const body = (await c.req.json().catch(() => ({}))) as { createdAt?: number };
    const { createdAt } = body;
    // A sale can't be dated in the future or before 2020.
    if (
      typeof createdAt !== "number" ||
      !Number.isFinite(createdAt) ||
      createdAt < Date.UTC(2020, 0, 1) ||
      createdAt > Date.now()
    ) {
      throw HttpError.badRequest("createdAt must be a past time in milliseconds", "invalid_date");
    }
    const corrected = await c.get("store").diagCorrectReceiptDate(id, createdAt);
    return ok(c, { receiptId: id, corrected });
  });
