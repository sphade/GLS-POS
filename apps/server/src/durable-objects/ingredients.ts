import type {
  Ingredient,
  IngredientMovement,
  IngredientMovementReason,
  IngredientUnit,
} from "@gls-pos/types";
import { INGREDIENT_UNITS } from "@gls-pos/types";

/**
 * Pure helpers for the per-store ingredient ledger. The Store Durable Object
 * owns the writes; these functions only validate and compute, so they can be
 * unit-tested without a DO.
 */

const REASONS = new Set<IngredientMovementReason>([
  "initial",
  "restock",
  "adjustment",
  "waste",
  "recipe",
  "transfer_out",
  "transfer_in",
]);

/** Reasons only the server may write. A device that sends one is refused. */
export const SERVER_ONLY_REASONS = new Set<IngredientMovementReason>([
  "transfer_out",
  "transfer_in",
]);

const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const optString = (v: unknown, max = 240) =>
  v === undefined || (typeof v === "string" && v.length <= max);

/** Runtime guard for an ingredient movement off the wire. */
export function ingredientMovementOf(value: unknown): IngredientMovement | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Partial<IngredientMovement>;
  if (
    typeof m.id !== "string" ||
    !m.id ||
    typeof m.ingredientId !== "string" ||
    !m.ingredientId ||
    typeof m.ingredientName !== "string" ||
    !REASONS.has(m.reason as IngredientMovementReason) ||
    !isWhole(m.delta) ||
    m.delta === 0 ||
    !isWhole(m.resulting) ||
    m.resulting < 0 ||
    typeof m.at !== "number" ||
    !Number.isFinite(m.at) ||
    (m.baseStock !== undefined && !isWhole(m.baseStock)) ||
    !optString(m.ref, 120) ||
    !optString(m.note) ||
    !optString(m.actorId, 120) ||
    !optString(m.actorName, 120)
  ) {
    return null;
  }
  // Fixed directions, so a label can never be used to mint stock.
  if ((m.reason === "recipe" || m.reason === "waste" || m.reason === "transfer_out") && m.delta > 0) {
    return null;
  }
  if ((m.reason === "initial" || m.reason === "restock" || m.reason === "transfer_in") && m.delta < 0) {
    return null;
  }
  return m as IngredientMovement;
}

/**
 * Clean an ingredient document a device pushed. Stock is never taken from the
 * wire: the server keeps its own value (0 for a new item) and only movements
 * change it. Units are restricted to whole base units.
 */
export function sanitizeIngredient(incoming: unknown, storedJson?: string): Ingredient | null {
  if (!incoming || typeof incoming !== "object") return null;
  const next = incoming as Partial<Ingredient>;
  if (typeof next.id !== "string" || typeof next.name !== "string" || !next.name.trim()) return null;
  const current = storedJson ? (JSON.parse(storedJson) as Partial<Ingredient>) : null;
  const unit: IngredientUnit = INGREDIENT_UNITS.includes(next.unit as IngredientUnit)
    ? (next.unit as IngredientUnit)
    : legacyUnit(next.unit);
  const lowAt = isWhole(next.lowAt) && next.lowAt >= 0 ? next.lowAt : 0;
  const packSize = isWhole(next.packSize) && next.packSize > 0 ? next.packSize : undefined;
  return {
    id: next.id,
    name: next.name.trim().slice(0, 120),
    unit,
    stock: currentStock(current),
    lowAt,
    ...(packSize && typeof next.packName === "string"
      ? { packName: next.packName.slice(0, 40), packSize }
      : {}),
    // Link fields are server-owned: keep whatever the server set.
    ...(current?.sourceIngredientId ? { sourceIngredientId: current.sourceIngredientId } : {}),
    ...(current?.sourceStoreId ? { sourceStoreId: current.sourceStoreId } : {}),
    ...(next.archived ? { archived: true } : {}),
  };
}

/**
 * The stored balance in base units. Ingredients saved before base units kept
 * stock in kg or litres (possibly fractional), so those are scaled by 1000.
 */
export function currentStock(doc: Partial<Ingredient> | null | undefined): number {
  if (!doc || typeof doc.stock !== "number" || !Number.isFinite(doc.stock)) return 0;
  const u = typeof doc.unit === "string" ? doc.unit.toLowerCase().trim() : "";
  const scale = u === "kg" || u === "l" || u === "litre" || u === "liter" ? 1000 : 1;
  return Math.max(0, Math.round(doc.stock * scale));
}

/** Old ingredients were typed with free-text units like "kg". Map them. */
function legacyUnit(unit: unknown): IngredientUnit {
  const u = typeof unit === "string" ? unit.toLowerCase().trim() : "";
  if (u === "kg" || u === "g" || u === "gram" || u === "grams") return "g";
  if (u === "l" || u === "ml" || u === "litre" || u === "liter") return "ml";
  return "pcs";
}

/** Apply a delta, clamping at zero. Returns the actual change applied. */
export function applyDelta(stock: number, delta: number) {
  const resulting = Math.max(0, stock + delta);
  return { before: stock, resulting, actual: resulting - stock };
}
