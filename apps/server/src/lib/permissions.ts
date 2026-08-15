import { createAccessControl } from "better-auth/plugins/access";

export const statement = {
  project: ["create", "share", "update", "delete"],
} as const;

export const ac = createAccessControl(statement);

export const cashier = ac.newRole({
  project: ["share"],
});

export const manager = ac.newRole({
  project: ["share"],
});

export const owner = ac.newRole({
  project: ["create", "update", "share", "delete"],
});
