import { z } from "zod";
import { SYNC_COLLECTIONS } from "@gls-pos/types";

/**
 * Validation for the sync push payload. Documents are opaque JSON, so `data` is
 * unknown — the store DO persists it verbatim. Only the sync envelope (which
 * collection, id, LWW clock, tombstone) is validated here.
 */
const syncChangeSchema = z.object({
  collection: z.enum(SYNC_COLLECTIONS),
  id: z.string().min(1),
  data: z.unknown(),
  updatedAt: z.number().int().nonnegative(),
  deleted: z.boolean(),
});

export const syncPushSchema = z.object({
  cursor: z.number().int().nonnegative().default(0),
  changes: z.array(syncChangeSchema).default([]),
});

export type SyncPushInput = z.infer<typeof syncPushSchema>;
