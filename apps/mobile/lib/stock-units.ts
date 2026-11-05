import type { IngredientUnit } from "@gls-pos/types";

/**
 * Display helpers for ingredient quantities. Stock is stored as whole base
 * units (g, ml, pcs); people read and type kg and litres. Everything that
 * crosses into storage goes through `toBase`, so no float is ever saved.
 */

/** The unit a person types in for each base unit. */
export const DISPLAY_UNIT: Record<IngredientUnit, string> = { g: "kg", ml: "L", pcs: "pcs" };

const SCALE: Record<IngredientUnit, number> = { g: 1000, ml: 1000, pcs: 1 };

/** "2500" g -> "2.5 kg"; small amounts stay in g/ml so 250 g doesn't read 0.25 kg. */
export function formatQty(base: number, unit: IngredientUnit): string {
  if (unit === "pcs") return `${base.toLocaleString()} pcs`;
  if (Math.abs(base) < 1000) return `${base} ${unit}`;
  const big = base / SCALE[unit];
  const text = Number.isInteger(big) ? big.toLocaleString() : big.toFixed(2).replace(/\.?0+$/, "");
  return `${text} ${DISPLAY_UNIT[unit]}`;
}

/** Parse what was typed in the display unit ("2.5" kg) to whole base units (2500 g). */
export function toBase(typed: string, unit: IngredientUnit): number | null {
  const value = Number(typed.replace(/,/g, "").trim());
  if (!typed.trim() || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * SCALE[unit]);
}

/** Whole base units back to the display unit, for editing an existing figure. */
export function fromBase(base: number, unit: IngredientUnit): string {
  const v = base / SCALE[unit];
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
}

/** Label for the unit choice chips. */
export const UNIT_CHOICES: { unit: IngredientUnit; label: string }[] = [
  { unit: "g", label: "Weight (kg)" },
  { unit: "ml", label: "Volume (L)" },
  { unit: "pcs", label: "Pieces" },
];
