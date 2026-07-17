// @ts-check
// Canonical maximum-HP display resolution.
//
// This module owns how a character's displayed max HP is chosen (see
// docs/reference/character-calculation-contract.md → "Structured Vitals
// ownership"). The HP *formula* itself lives in one place — `computeMaxHp()`
// in js/domain/rules/progression.js, consumed through `deriveCharacter()` —
// which reconstructs max HP exactly from the builder's level-by-level history:
// first level takes the maximum die, each recorded roll is used verbatim,
// missing rolls take the SRD average, the Constitution modifier applies at
// every level (so retroactive Con changes flow), and structured per-level
// bonuses (feat effects, Hill Dwarf `hpPerLevelBonus`) stack in.
//
// A character may carry an optional `hpMaxCalc` block (an extra key on the
// open character-entry shape — no schema migration, the AttackEntry.calc /
// builderSeed precedent):
//
//   hpMaxCalc: { mode: "derived" | "fixed", adjustment: number }
//
// - No block → legacy snapshot: the flat `hpMax` field is shown verbatim and
//   never auto-updates (Level Up keeps its accumulate policy). Every existing
//   sheet keeps its exact behavior; a stored bare total is never decomposed
//   into guessed rolls.
// - mode "derived" → displayed = computeMaxHp(level history) + adjustment,
//   updating live when Con, levels, or structured bonuses change. Derivation
//   is builder-only: a freeform sheet has no level history, so freeform max
//   HP stays a manual input.
// - mode "fixed" → the flat `hpMax` field IS the fixed value: shown verbatim,
//   never auto-updated, adjustment not applied.
//
// Current HP is play-state, never calc-managed. The one coupling rule: when a
// managed max drops below the stored current HP, current HP clamps down to
// the new max (`clampCurrentHpToMax`); raising the max never auto-heals
// except through the shipped Level Up delta. Temp HP lives in combat state
// and is never touched here.

import { deriveCharacter } from "./rules/deriveCharacter.js";
import { getActiveContentRegistry } from "./rules/registry.js";

/** @typedef {import("./rules/registry.js").ContentRegistry} ContentRegistry */

/** The closed max-HP-calc mode vocabulary. */
export const HP_MAX_CALC_MODES = Object.freeze(["derived", "fixed"]);

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
 * @typedef {{ mode: "derived" | "fixed", adjustment: number }} HpMaxCalc
 */

/**
 * Defensive read of a persisted `hpMaxCalc` block. Returns null for anything
 * that is not a structured calc — such characters keep their legacy flat
 * `hpMax` snapshot and the Level Up accumulate policy.
 *
 * @param {unknown} value
 * @returns {HpMaxCalc | null}
 */
export function normalizeHpMaxCalc(value) {
  if (!isPlainObject(value)) return null;
  const mode = typeof value.mode === "string" ? value.mode.trim() : "";
  if (!HP_MAX_CALC_MODES.includes(/** @type {HpMaxCalc["mode"]} */ (mode))) return null;
  return {
    mode: /** @type {HpMaxCalc["mode"]} */ (mode),
    adjustment: finiteNumberOrZero(value.adjustment)
  };
}

/**
 * The calc block Finish seeding stamps on a builder character so its max HP
 * derives live from creation onward.
 * @returns {HpMaxCalc}
 */
export function buildDerivedHpMaxCalc() {
  return { mode: "derived", adjustment: 0 };
}

/**
 * Cheap managed-mode probe (no derivation).
 *
 * @param {unknown} character
 * @returns {"derived" | "fixed" | null}
 */
export function getHpMaxManagedMode(character) {
  const calc = isPlainObject(character) ? normalizeHpMaxCalc(character.hpMaxCalc) : null;
  return calc ? calc.mode : null;
}

/**
 * Compact human-readable summary of the derived HP breakdown, e.g.
 * "L1 10 (max) · L2 6 (average) · L3 8 (rolled) + Con +2/level".
 *
 * @param {ReturnType<typeof deriveCharacter> | null} derived
 * @returns {string}
 */
export function describeHpBreakdown(derived) {
  const rows = Array.isArray(derived?.hp?.breakdown) ? derived.hp.breakdown : [];
  if (!rows.length) return "";
  const sourceLabel = { max: "max", roll: "rolled", average: "average", unknown: "?" };
  const parts = rows.map((row) => {
    const value = row.value == null ? "?" : String(row.value);
    const label = sourceLabel[/** @type {keyof typeof sourceLabel} */ (row.source)] || "?";
    return `L${row.characterLevel} ${value} (${label})`;
  });
  const conMod = derived?.abilities?.con?.modifier;
  const conText = typeof conMod === "number" && Number.isFinite(conMod)
    ? ` + Con ${conMod >= 0 ? "+" : ""}${conMod}/level`
    : "";
  return `${parts.join(" · ")}${conText}`;
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
 * }} HpMaxDisplayModel
 */

/**
 * The one max-HP display derivation. Pure: nothing is mutated.
 *
 * @param {unknown} character
 * @param {ReturnType<typeof deriveCharacter> | null} derived
 * @returns {HpMaxDisplayModel}
 */
export function getHpMaxDisplayModel(character, derived) {
  const source = isPlainObject(character) ? character : {};
  const calc = normalizeHpMaxCalc(source.hpMaxCalc);
  const flat = finiteNumberOrNull(source.hpMax);
  const base = finiteNumberOrNull(derived?.hp?.max);
  const canDerive = base != null;

  if (!calc) {
    return { mode: "legacy", value: flat, base, adjustment: 0, formula: "", canDerive, warnings: [] };
  }

  if (calc.mode === "fixed") {
    return { mode: "fixed", value: flat, base, adjustment: 0, formula: "", canDerive, warnings: [] };
  }

  if (!canDerive) {
    return {
      mode: "derived",
      value: flat,
      base: null,
      adjustment: calc.adjustment,
      formula: "",
      canDerive: false,
      warnings: ["Max HP cannot be calculated — showing the saved value."]
    };
  }

  return {
    mode: "derived",
    value: base + calc.adjustment,
    base,
    adjustment: calc.adjustment,
    formula: describeHpBreakdown(derived),
    canDerive: true,
    warnings: []
  };
}

/**
 * Resolves the max-HP value a non-panel surface (tracker linked cards, combat
 * participant seeding) should display for a character — calc-aware, with a
 * safe fallback to the flat snapshot.
 *
 * @param {unknown} character
 * @param {{ registry?: ContentRegistry, derived?: ReturnType<typeof deriveCharacter> | null }} [options]
 * @returns {number | null}
 */
export function getDisplayedHpMax(character, options = {}) {
  const source = isPlainObject(character) ? character : {};
  const calc = normalizeHpMaxCalc(source.hpMaxCalc);
  const flat = finiteNumberOrNull(source.hpMax);
  if (!calc || calc.mode === "fixed") return flat;

  let derived = options.derived ?? null;
  if (!derived) {
    try {
      derived = deriveCharacter(character, options.registry ?? getActiveContentRegistry());
    } catch (err) {
      console.warn("Max HP derivation failed:", err);
      return flat;
    }
  }
  const model = getHpMaxDisplayModel(character, derived);
  return model.value ?? flat;
}

/**
 * The current-HP clamp rule for a changed max: current HP never exceeds the
 * new max; lowering the max never "heals" and raising it never auto-heals.
 * Returns the (possibly unchanged) current HP.
 *
 * @param {number | null} hpCur
 * @param {number | null} newMax
 * @returns {number | null}
 */
export function clampCurrentHpToMax(hpCur, newMax) {
  if (hpCur == null || newMax == null) return hpCur;
  return Math.min(hpCur, newMax);
}
