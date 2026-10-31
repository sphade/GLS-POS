import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import { withStore } from "../../middleware/store.js";
import { deletePushToken, notifyStore, savePushToken } from "./push.service.js";

const registerSchema = z.object({
  /** ExponentPushToken[...] issued by the device. */
  token: z.string().min(10).max(200),
  platform: z.enum(["ios", "android"]).optional(),
});

/**
 * Push-token registration for staff devices.
 *
 * Registration is deliberately NOT store-scoped: a phone is registered for
 * every branch its user belongs to, so a manager covering two shops hears both.
 * The store id in the header is ignored here — only `/test` needs one, because
 * a test alert has to pick a single shop to buzz.
 */
export const push = new Hono<AppEnv>()
  .post("/register", validate("json", registerSchema), async (c) => {
    const user = c.get("user");
    if (!user) throw HttpError.unauthorized();
    const { token, platform } = c.req.valid("json");
    const result = await savePushToken(c.env, { token, userId: user.id, platform });
    return ok(c, { registered: true, stores: result.stores });
  })
  .post("/unregister", validate("json", registerSchema.pick({ token: true })), async (c) => {
    const user = c.get("user");
    if (!user) throw HttpError.unauthorized();
    await deletePushToken(c.env, c.req.valid("json").token, user.id);
    return ok(c, { removed: true });
  })
  /** Send a test alert to this store's devices, so staff can verify setup. */
  .post("/test", withStore, async (c) => {
    const result = await notifyStore(c.env, c.get("storeId"), {
      title: "GLS POS test alert",
      body: "Notifications are working on this device.",
      data: { kind: "test" },
    });
    return ok(c, result);
  });
