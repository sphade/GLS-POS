import type { AuditEntry, StoreRole } from "@gls-pos/types";
import { loadAll, put as dbPut } from "./db";

/**
 * Lightweight audit trail.
 *
 * Every meaningful action (a sale, a catalog edit, a stock change, a staff
 * change) appends an append-only `audit_log` row attributed to the signed-in
 * user. It syncs like any other collection, so managers see one combined
 * history across every till. Writing is fire-and-forget and must never break
 * the action it records.
 *
 * Attribution comes from a module-level "current actor" the auth layer keeps in
 * step with the session — audit calls sit deep in data helpers that don't have
 * the React auth context handy, and a plain setter avoids threading the user
 * through every call site.
 */

type Actor = { id: string; name: string; role: StoreRole };

let currentActor: Actor | null = null;

/** Auth keeps this current with the signed-in user + active-store role. */
export function setAuditActor(actor: Actor | null): void {
  currentActor = actor;
}

const uid = () => `aud_${Date.now()}_${Math.round(Math.random() * 1e6)}`;

/** Append an audit entry. No-op (but never throws) when signed out. */
export function logAudit(input: {
  action: string;
  entity: string;
  summary: string;
  entityId?: string;
}): void {
  const actor = currentActor;
  if (!actor) return;
  try {
    const entry: AuditEntry = {
      id: uid(),
      at: Date.now(),
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      summary: input.summary,
    };
    dbPut("audit_log", entry);
  } catch {
    // Auditing must never interfere with the operation it records.
  }
}

/** Newest-first audit entries from the local mirror. */
export function loadAuditLog(): AuditEntry[] {
  return loadAll<AuditEntry>("audit_log").sort((a, b) => b.at - a.at);
}
