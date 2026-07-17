// @ts-check
// Canonical Armor Class display resolution.
//
// This module owns how a character's displayed AC is chosen (see
// docs/reference/character-calculation-contract.md → "Structured Vitals
// ownership"). The AC *formula* itself lives in one place —
// `computeArmorClass()` in js/domain/rules/progression.js, consumed through
// `deriveCharacter()` — this module decides between the legacy snapshot, the
// derived value plus an explicit adjustment, and an intentional fixed
// override, and gives every surface (Vitals tile, combat embedded tile,
// tracker linked cards, combat participant seeding) the same answer.
//
// A character may carry an optional `acCalc` block (an extra key on the open
// character-entry shape — no schema migration, the AttackEntry.calc /
// builderSeed precedent):
//
//   acCalc: { mode: "derived" | "fixed", adjustment: number }
//
// - No block → legacy snapshot: the flat `ac` field is shown verbatim and
//   never auto-updates. Every existing sheet keeps its exact behavior; a
//   stored bare total is never reinterpreted.
// - mode "derived" → displayed = computeArmorClass(build inputs) + adjustment,
//   updating live when Dex, armor, shield, features, or feats change.
//   Derivation is builder-only (a freeform sheet has no structured armor).
// - mode "fixed" → the flat `ac` field IS the fixed value: shown verbatim,
//   never auto-updated, adjustment not applied.
//
// The flat `ac` field stays a back-compat mirror of the displayed value so
// exports and older readers stay meaningful; it is refreshed at the editor,
// Finish/Edit re-seed, and Level Up choke points.

import { deriveCharacter } from "./rules/deriveCharacter.js";
import { getActiveContentRegistry } from "./rules/registry.js";

/** @typedef {import("./rules/registry.js").ContentRegistry} ContentRegistry */

/** The closed AC-calc mode vocabulary. */
export const AC_CALC_MODES = Object.freeze(["derived", "fixed"]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function finiteNumberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumberOrNull(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @typedef {{ mode: "derived" | "fixed", adjustment: number }} AcCalc
 */

/**
 * Defensive read of a persisted `acCalc` block. Returns null for anything
 * that is not a structured calc (missing, malformed, unknown mode) — such
 * characters keep their legacy flat `ac` snapshot.
 *
 * @param {unknown} value
 * @returns {AcCalc | null}
 */
export function normalizeAcCalc(value) {
  if (!isPlainObject(value)) return null;
  const mode = typeof value.mode === "string" ? value.mode.trim() : "";
  if (!AC_CALC_MODES.includes(/** @type {AcCalc["mode"]} */ (mode))) return null;
  return {
    mode: /** @type {AcCalc["mode"]} */ (mode),
    adjustment: finiteNumberOrZero(value.adjustment)
  };
}

/**
 * The calc block Finish seeding stamps on a builder character so its AC
 * derives live from creation onward.
 * @returns {AcCalc}
 */
export function buildDerivedAcCalc() {
  return { mode: "derived", adjustment: 0 };
}

/**
 * Cheap managed-mode probe (no derivation) for surfaces that only need to
 * know whether AC edits belong to the calculation editor.
 *
 * @param {unknown} character
 * @returns {"derived" | "fixed" | null}
 */
export function getAcManagedMode(character) {
  const calc = isPlainObject(character) ? normalizeAcCalc(character.acCalc) : null;
  return calc ? calc.mode : null;
}

/**
 * @typedef {{
 *   mode: "legacy" | "derived" | "fixed",
 *   value: number | null,
 *   base: number | null,
 *   adjustment: number,
 *   formula: string,
 *   canDerive: boolean,
 *   warnings: string[]
 * }} ArmorClassDisplayModel
 */

/**
 * The one AC display derivation. Pure: nothing is mutated.
 *
 * @param {unknown} character
 * @param {ReturnType<typeof deriveCharacter> | null} derived
 * @returns {ArmorClassDisplayModel}
 */
export function getArmorClassDisplayModel(character, derived) {
  const source = isPlainObject(character) ? character : {};
  const calc = normalizeAcCalc(source.acCalc);
  const flat = finiteNumberOrNull(source.ac);
  const base = finiteNumberOrNull(derived?.ac?.value);
  const formula = typeof derived?.ac?.formula === "string" ? derived.ac.formula : "";
  const canDerive = base != null;

  if (!calc) {
    return { mode: "legacy", value: flat, base, adjustment: 0, formula: "", canDerive, warnings: [] };
  }

  if (calc.mode === "fixed") {
    return { mode: "fixed", value: flat, base, adjustment: 0, formula: "", canDerive, warnings: [] };
  }

  if (!canDerive) {
    // Derived mode without a derivable base (freeform sheet, missing build
    // data): fail soft to the stored value rather than showing nothing.
    return {
      mode: "derived",
      value: flat,
      base: null,
      adjustment: calc.adjustment,
      formula: "",
      canDerive: false,
      warnings: ["Armor Class cannot be calculated — showing the saved value."]
    };
  }

  return {
    mode: "derived",
    value: base + calc.adjustment,
    base,
    adjustment: calc.adjustment,
    formula,
    canDerive: true,
    warnings: []
  };
}

/**
 * Resolves the AC value a non-panel surface (tracker linked cards, combat
 * participant seeding) should display for a character — calc-aware, with a
 * safe fallback to the flat snapshot when derivation is unavailable or fails.
 *
 * @param {unknown} character
 * @param {{ registry?: ContentRegistry, derived?: ReturnType<typeof deriveCharacter> | null }} [options]
 * @returns {number | null}
 */
export function getDisplayedArmorClass(character, options = {}) {
  const source = isPlainObject(character) ? character : {};
  const calc = normalizeAcCalc(source.acCalc);
  const flat = finiteNumberOrNull(source.ac);
  if (!calc || calc.mode === "fixed") return flat;

  let derived = options.derived ?? null;
  if (!derived) {
    try {
      derived = deriveCharacter(character, options.registry ?? getActiveContentRegistry());
    } catch (err) {
      console.warn("Armor Class derivation failed:", err);
      return flat;
    }
  }
  const model = getArmorClassDisplayModel(character, derived);
  return model.value ?? flat;
}
