import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import { HttpError } from "../../lib/http-error.js";
import { notifyStore } from "../push/push.service.js";
import { createTransferSchema } from "./transfers.schema.js";
import { createTransfer, importLegacyCentralStock, listBranches } from "./transfers.service.js";

/**
 * Central-store transfers. Mounted behind `requireAuth` + `withStore`, so the
 * selected store (`x-store-id`) is the central store sending the stock.
 *
 * Stock itself lives in each store's Durable Object and reaches devices
 * through normal sync (`ingredients`, `ingredient_movements`,
 * `stock_transfers`). These routes only cover what a device cannot do offline:
 * moving stock between two stores.
 */
export const transfers = new Hono<AppEnv>();

transfers.get("/branches", async (c) => {
  return ok(c, await listBranches(c.env, c.get("storeId")));
});

transfers.post("/", validate("json", createTransferSchema), async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  const result = await createTransfer(c.env, c.get("storeId"), c.get("role"), c.req.valid("json"), {
    id: user.id,
    name: user.name,
    email: user.email,
  });

  if (!result.duplicate) {
    const t = result.transfer;
    c.executionCtx.waitUntil(
      Promise.all([
        notifyStore(
          c.env,
          t.toStoreId,
          {
            title: `Stock on its way: ${t.ingredientName}`,
            body: `${t.quantity} ${t.unit} from ${t.fromStoreName}.`,
            data: { kind: "transfer_in", storeId: t.toStoreId },
          },
          { roles: ["owner", "manager"] },
        ),
        result.lowStock
          ? notifyStore(
              c.env,
              t.fromStoreId,
              {
                title: `${t.ingredientName} is running low`,
                body: `Central stock dropped to its alert level after sending to ${t.toStoreName}.`,
                data: { kind: "central_low_stock", storeId: t.fromStoreId },
              },
              { roles: ["owner"] },
            )
          : Promise.resolve(),
      ]).catch(() => undefined),
    );
  }
  return ok(c, result.transfer, result.duplicate ? 200 : 201);
});

/** Owner-only, one-off: copy the old D1 central stock into the Durable Objects. */
transfers.post("/import-legacy", async (c) => {
  const user = c.get("user");
  if (!user) throw HttpError.unauthorized();
  return ok(
    c,
    await importLegacyCentralStock(c.env, c.get("storeId"), c.get("role"), { id: user.id, name: user.name }),
  );
});
