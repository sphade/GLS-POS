import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import { deletePushToken, notifyStore, savePushToken } from "./push.service.js";

const registerSchema = z.object({
  /** ExponentPushToken[...] issued by the device. */
  token: z.string().min(10).max(200),
  platform: z.enum(["ios", "android"]).optional(),
});

/**
 * Push-token registration for staff devices. Scoped to the current store, so a
 * device only gets alerts for the store it's signed into.
 */
export const push = new Hono<AppEnv>()
  .post("/register", validate("json", registerSchema), async (c) => {
    const user = c.get("user");
    if (!user) throw HttpError.unauthorized();
    const { token, platform } = c.req.valid("json");
    await savePushToken(c.env, { token, userId: user.id, storeId: c.get("storeId"), platform });
    return ok(c, { registered: true });
  })
  .post("/unregister", validate("json", registerSchema.pick({ token: true })), async (c) => {
    await deletePushToken(c.env, c.req.valid("json").token);
    return ok(c, { removed: true });
  })
  /** Send a test alert to this store's devices, so staff can verify setup. */
  .post("/test", async (c) => {
    const result = await notifyStore(c.env, c.get("storeId"), {
      title: "GLS POS test alert",
      body: "Notifications are working on this device.",
      data: { kind: "test" },
    });
    return ok(c, result);
  });
