import { Hono } from "hono";
import type { AppEnv } from "../../context.js";
import { ok } from "../../lib/response.js";
import { validate } from "../../lib/validator.js";
import {
  createOrganizationSchema,
  addMemberSchema,
} from "./organizations.schema.js";
import { requireAuth } from "../../middleware/auth.js";

/**
 * Better Auth organization wrappers. Mounted behind requireAuth, so calls can
 * use the current session headers while keeping mobile off plugin internals.
 */
export const organizations = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const auth = c.get("auth");
    const organizations = await auth.api.listOrganizations({
      headers: c.req.raw.headers,
    });
    return ok(c, organizations);
  })
  .get("/user/:userId", requireAuth, async (c) => {
    const auth = c.get("auth");
    const userId = c.req.param("userId");

    const organizations = await auth.api.listOrganizations({
      query: {
        userId,
      },
      headers: c.req.raw.headers,
    });

    return ok(c, organizations);
  })
  .post(
    "/create",
    requireAuth,
    validate("json", createOrganizationSchema),
    async (c) => {
      const auth = c.get("auth");
      const organization = await auth.api.createOrganization({
        body: c.req.valid("json"),
        headers: c.req.raw.headers,
      });

      return ok(c, organization, 201);
    },
  )
  .get("/:orgId/members", requireAuth, async (c) => {
    const auth = c.get("auth");
    const orgId = c.req.param("orgId");

    const members = await auth.api.listMembers({
      query: {
        organizationId: orgId,
      },
      headers: c.req.raw.headers,
    });

    return ok(c, members);
  })
  .post(
    "/:orgId/members",
    requireAuth,
    validate("json", addMemberSchema),
    async (c) => {
      const auth = c.get("auth");
      const orgId = c.req.param("orgId");
      const input = c.req.valid("json");

      const member = await auth.api.addMember({
        body: {
          organizationId: orgId,
          userId: input.userId,
          role: input.role,
        },
        headers: c.req.raw.headers,
      });

      return ok(c, member, 201);
    },
  );
