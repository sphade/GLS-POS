import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import { requirePermission } from "../../middleware/store.js";
import {
  autoLink,
  channelLinkView,
  channelStatuses,
  connectChannel,
  disconnectChannel,
  isSalesChannel,
  pushAvailability,
  setLinks,
} from "./channels.service.js";

const connectSchema = z.object({ apiKey: z.string().trim().min(8).max(500) });
const linksSchema = z.object({
  links: z
    .array(
      z.object({
        productId: z.string().min(1).max(120),
        ref: z.string().min(1).max(120),
        kind: z.enum(["item", "option"]).optional(),
        auto: z.boolean().optional(),
      }),
    )
    .max(2000),
});

function channelParam(value: string) {
  if (!isSalesChannel(value)) throw HttpError.notFound("Unknown delivery app", "unknown_channel");
  return value;
}

const fail = (e: unknown, code: string) =>
  HttpError.badRequest(e instanceof Error ? e.message : "Something went wrong", code);

/**
 * Delivery apps (mounted at /api/channels, auth + store). Connecting an app
 * hands it control of the menu's availability, so it is owner-only.
 */
export const channels = new Hono<AppEnv>()
  .use("*", requirePermission("settings:manage"))
  .get("/", async (c) => ok(c, await channelStatuses(c.env, c.get("storeId"))))
  .post("/:channel/connect", validate("json", connectSchema), async (c) => {
    const channel = channelParam(c.req.param("channel"));
    try {
      return ok(c, await connectChannel(c.env, c.get("storeId"), channel, c.req.valid("json").apiKey));
    } catch (e) {
      throw fail(e, "channel_connect_failed");
    }
  })
  .delete("/:channel", async (c) => {
    await disconnectChannel(c.env, c.get("storeId"), channelParam(c.req.param("channel")));
    return ok(c, { disconnected: true });
  })
  .get("/:channel/links", async (c) => {
    try {
      return ok(c, await channelLinkView(c.env, c.get("storeId"), channelParam(c.req.param("channel"))));
    } catch (e) {
      throw fail(e, "channel_menu_failed");
    }
  })
  .put("/:channel/links", validate("json", linksSchema), async (c) => {
    const channel = channelParam(c.req.param("channel"));
    return ok(c, await setLinks(c.env, c.get("storeId"), channel, c.req.valid("json").links));
  })
  .post("/:channel/auto-link", async (c) => {
    try {
      return ok(c, await autoLink(c.env, c.get("storeId"), channelParam(c.req.param("channel"))));
    } catch (e) {
      throw fail(e, "channel_menu_failed");
    }
  })
  /** Re-send every linked item's stock. */
  .post("/sync", async (c) => ok(c, await pushAvailability(c.env, c.get("storeId"), { force: true })));
