import { Hono } from "hono";
import type { Env } from "../../env.js";
import { ok } from "../../lib/response.js";
import { HttpError } from "../../lib/http-error.js";

/**
 * Temporary diagnostics for correcting receipts whose `createdAt` was stamped
 * with a wrong terminal clock.
 *
 * Protected by a simple secret header (x-diag-secret) rather than auth, so it
 * can be used without a session. Intended to be removed after the fix is done.
 */
const DIAG_SECRET = "gls-diag-fix-dates-2026";

export const diag = new Hono<{ Bindings: Env }>()
  .get("/receipts", async (c) => {
    if (c.req.header("x-diag-secret") !== DIAG_SECRET) {
      throw HttpError.unauthorized();
    }
    const storeId = c.req.header("x-store-id");
    if (!storeId) throw HttpError.badRequest("x-store-id header is required");
    const store = c.env.STORE.get(c.env.STORE.idFromName(storeId));
    const receipts = await store.diagListReceipts();
    return ok(c, { storeId, count: receipts.length, receipts });
  })
  .post("/receipts/:id/date", async (c) => {
    if (c.req.header("x-diag-secret") !== DIAG_SECRET) {
      throw HttpError.unauthorized();
    }
    const storeId = c.req.header("x-store-id");
    if (!storeId) throw HttpError.badRequest("x-store-id header is required");
    const { id } = c.req.param();
    const body = await c.req.json();
    const { createdAt } = body as { createdAt?: number };
    if (typeof createdAt !== "number" || createdAt <= 0) {
      return c.json({ ok: false, error: "createdAt must be a positive number" }, 400);
    }
    const store = c.env.STORE.get(c.env.STORE.idFromName(storeId));
    const ok_ = await store.diagCorrectReceiptDate(id, createdAt);
    return ok(c, { receiptId: id, corrected: ok_ });
  });
