import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { HttpError } from "../../lib/http-error.js";

/**
 * The frozen daily close (Z-report).
 *
 * Mounted behind requireAuth + withStore + `reports:view`, so owners and
 * managers can close a day but a cashier cannot. The totals are computed by the
 * store from its own documents; the till only says which local day it means.
 *
 * Why the till sends the bounds: only the device knows the shop's timezone and
 * its corrected clock, and a day boundary is a local concept. The server
 * validates the window is about one day so a caller cannot spread a close over
 * a month of trading.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
/** Generous slack for DST and a shop that opens late. */
const MAX_WINDOW_MS = DAY_MS + 6 * 60 * 60 * 1000;

export const dayClose = new Hono<AppEnv>()
  .get("/", async (c) => {
    const limit = Number(c.req.query("limit") ?? 30);
    const closes = await c.get("store").listDayCloses(Number.isFinite(limit) ? limit : 30);
    return ok(c, { storeId: c.get("storeId"), closes });
  })
  .post("/", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      day?: unknown;
      from?: unknown;
      to?: unknown;
    };
    const { day, from, to } = body;

    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw HttpError.badRequest("day must be YYYY-MM-DD", "invalid_day");
    }
    if (
      typeof from !== "number" ||
      !Number.isFinite(from) ||
      typeof to !== "number" ||
      !Number.isFinite(to) ||
      to <= from ||
      to - from > MAX_WINDOW_MS
    ) {
      throw HttpError.badRequest("from/to must bound a single day", "invalid_window");
    }

    const user = c.get("user");
    if (!user) throw HttpError.unauthorized();
    const result = await c.get("store").closeDay({
      day,
      from,
      to,
      actor: { id: user.id, name: user.name ?? user.email ?? "Staff" },
    });
    return ok(c, { storeId: c.get("storeId"), ...result });
  });
