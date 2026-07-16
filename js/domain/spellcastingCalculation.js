// @ts-check
// Canonical spell save DC + spell attack bonus calculator.
//
// This module owns ALL spell-stat math (see
// docs/reference/character-calculation-contract.md → "Structured Vitals
// ownership"). The character-page Vitals panel and the combat embedded Vitals
// panel (one shared panel) and Finish seeding derive spell DC/attack through
// `getSpellcastingDisplayModel()` — there is no second formula.
//
// Spell DC and spell attack are modeled as PROFILES, one per distinct
// spellcasting ability, never a single universal scalar:
//
//   DC     = 8 + proficiency bonus + ability modifier + dcAdjustment
//   Attack =     proficiency bonus + ability modifier + attackAdjustment
//
// A character may carry an optional `spellcastingCalc` block (an extra key on
// the open character-entry shape — no schema migration, the AttackEntry.calc /
// builderSeed precedent):
//
//   spellcastingCalc: {
//     mode: "derived" | "fixed",
//     bySource: { [abilityKey]: { dcAdjustment, attackAdjustment } },  // builder
//     freeform: [{ ability, dcAdjustment, attackAdjustment }],         // freeform
//     fixed: { dc, attack }                                            // fixed mode
//   }
//
// - No block → legacy snapshot: the flat `spellDC`/`spellAttack` fields are
//   shown verbatim and never auto-update. This preserves existing sheets; a
//   stored number's ability is never inferred.
// - mode "derived" → profiles derive live from the character's abilities and
//   proficiency (builder: the derived spellcasting sources; freeform: the
//   user-declared abilities), plus explicit per-source adjustments.
// - mode "fixed" → the stored fixed values are shown; nothing recalculates.
//
// The flat `spellDC`/`spellAttack` fields remain a back-compat mirror of the
// primary profile so registry-less surfaces (combat cards, tracker cards) stay
// correct.

import { CHARACTER_ABILITY_KEYS } from "./characterHelpers.js";

/** @typedef {import("./rules/registry.js").ContentRegistry} ContentRegistry */
/** @typedef {import("./rules/deriveCharacter.js").deriveCharacter} deriveCharacterFn */

/** The closed spellcasting-calc mode vocabulary. */
export const SPELLCASTING_CALC_MODES = Object.freeze(["derived", "fixed"]);

const ABILITY_LABEL = Object.freeze({
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
});

/**
 * @param {string} ability
 * @returns {string}
 */
export function abilityLabel(ability) {
  return ABILITY_LABEL[/** @type {keyof typeof ABILITY_LABEL} */ (ability)] || (ability ? ability.toUpperCase() : "");
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
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
 * @param {number} value
 * @returns {string}
 */
function signedNumber(value) {
  return value >= 0 ? `+${value}` : String(value);
}

/**
 * @param {unknown} value
 * @returns {string} a valid ability key or ""
 */
function abilityKeyOrEmpty(value) {
  const key = cleanString(value);
  return CHARACTER_ABILITY_KEYS.includes(/** @type {typeof CHARACTER_ABILITY_KEYS[number]} */ (key)) ? key : "";
}

/**
 * @typedef {{ dcAdjustment: number, attackAdjustment: number }} SpellcastingSourceAdjustment
 *
 * @typedef {{
 *   mode: "derived" | "fixed",
 *   bySource: Record<string, SpellcastingSourceAdjustment>,
 *   freeform: Array<{ ability: string, dcAdjustment: number, attackAdjustment: number }>,
 *   fixed: { dc: number | null, attack: number | null }
 * }} SpellcastingCalc
 */

/**
 * Defensive read of a persisted `spellcastingCalc` block. Returns null for
 * anything that is not a structured calc (missing, malformed, unknown mode) —
 * such characters keep their legacy flat `spellDC`/`spellAttack` snapshot.
 *
 * @param {unknown} value
 * @returns {SpellcastingCalc | null}
 */
export function normalizeSpellcastingCalc(value) {
  if (!isPlainObject(value)) return null;
  const mode = cleanString(value.mode);
  if (!SPELLCASTING_CALC_MODES.includes(/** @type {SpellcastingCalc["mode"]} */ (mode))) return null;

  /** @type {Record<string, SpellcastingSourceAdjustment>} */
  const bySource = {};
  if (isPlainObject(value.bySource)) {
    for (const [key, raw] of Object.entries(value.bySource)) {
      const abilityKey = abilityKeyOrEmpty(key);
      if (!abilityKey || !isPlainObject(raw)) continue;
      bySource[abilityKey] = {
        dcAdjustment: finiteNumberOrZero(raw.dcAdjustment),
        attackAdjustment: finiteNumberOrZero(raw.attackAdjustment)
      };
    }
  }

  /** @type {Array<{ ability: string, dcAdjustment: number, attackAdjustment: number }>} */
  const freeform = [];
  const seenFreeform = new Set();
  if (Array.isArray(value.freeform)) {
    for (const raw of value.freeform) {
      if (!isPlainObject(raw)) continue;
      const ability = abilityKeyOrEmpty(raw.ability);
      if (!ability || seenFreeform.has(ability)) continue;
      seenFreeform.add(ability);
      freeform.push({
        ability,
        dcAdjustment: finiteNumberOrZero(raw.dcAdjustment),
        attackAdjustment: finiteNumberOrZero(raw.attackAdjustment)
      });
    }
  }

  const fixedRaw = isPlainObject(value.fixed) ? value.fixed : {};
  return {
    mode: /** @type {SpellcastingCalc["mode"]} */ (mode),
    bySource,
    freeform,
    fixed: {
      dc: finiteNumberOrNull(fixedRaw.dc),
      attack: finiteNumberOrNull(fixedRaw.attack)
    }
  };
}

/**
 * The calc block Finish seeding stamps on a builder caster so its spell DC /
 * attack derive live from creation onward.
 * @returns {SpellcastingCalc}
 */
export function buildDerivedSpellcastingCalc() {
  return { mode: "derived", bySource: {}, freeform: [], fixed: { dc: null, attack: null } };
}

/**
 * @typedef {{
 *   sourceKey: string,
 *   ability: string,
 *   label: string,
 *   sources: string[],
 *   abilityModifier: number | null,
 *   proficiencyBonus: number | null,
 *   dcAdjustment: number,
 *   attackAdjustment: number,
 *   baseDc: number | null,
 *   baseAttack: number | null,
 *   dc: number | null,
 *   attack: number | null,
 *   dcLabel: string,
 *   attackLabel: string,
 *   derived: boolean,
 *   warnings: string[]
 * }} SpellcastingProfile
 *
 * @typedef {{
 *   mode: "legacy" | "derived" | "fixed",
 *   profiles: SpellcastingProfile[],
 *   flat: { dc: number | null, attack: number | null },
 *   hasDerivableSources: boolean,
 *   warnings: string[]
 * }} SpellcastingDisplayModel
 */

/**
 * @param {ReturnType<import("./rules/deriveCharacter.js").deriveCharacter>} derived
 * @param {string} ability
 * @returns {number | null}
 */
function abilityModifierFor(derived, ability) {
  if (!ability) return null;
  const value = derived?.abilities?.[ability]?.modifier;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Collects the distinct spellcasting ability sources for a builder character
 * from the derived spellcasting classes and choice-granted spells (e.g. a High
 * Elf's Intelligence cantrip), grouped by ability with provenance labels.
 *
 * @param {ReturnType<import("./rules/deriveCharacter.js").deriveCharacter>} derived
 * @returns {Array<{ ability: string, sources: string[] }>}
 */
export function collectDerivedSpellcastingSources(derived) {
  /** @type {Map<string, Set<string>>} */
  const byAbility = new Map();
  const add = (/** @type {string} */ abilityRaw, /** @type {string} */ label) => {
    const ability = abilityKeyOrEmpty(abilityRaw);
    if (!ability) return;
    if (!byAbility.has(ability)) byAbility.set(ability, new Set());
    if (label) byAbility.get(ability)?.add(label);
  };

  const classes = Array.isArray(derived?.spellcasting?.classes) ? derived.spellcasting.classes : [];
  for (const info of classes) {
    add(info.ability, cleanString(info.className) || cleanString(info.classId));
  }
  const grants = Array.isArray(derived?.grantedSpells) ? derived.grantedSpells : [];
  for (const grant of grants) {
    const ability = abilityKeyOrEmpty(grant?.spellcastingAbility);
    if (!ability) continue;
    add(ability, cleanString(grant?.source) || "Racial");
  }

  return [...byAbility.entries()].map(([ability, sources]) => ({ ability, sources: [...sources] }));
}

/**
 * @param {string} ability
 * @param {string[]} sources
 * @param {number} dcAdjustment
 * @param {number} attackAdjustment
 * @param {ReturnType<import("./rules/deriveCharacter.js").deriveCharacter>} derived
 * @returns {SpellcastingProfile}
 */
function buildProfile(ability, sources, dcAdjustment, attackAdjustment, derived) {
  const abilityModifier = abilityModifierFor(derived, ability);
  const proficiencyBonus = typeof derived?.proficiencyBonus === "number" && Number.isFinite(derived.proficiencyBonus)
    ? derived.proficiencyBonus
    : null;
  /** @type {string[]} */
  const warnings = [];
  const ready = abilityModifier != null && proficiencyBonus != null;
  if (abilityModifier == null) warnings.push(`The ${ability.toUpperCase()} score is not set.`);
  if (proficiencyBonus == null) warnings.push("No proficiency bonus is set.");

  const baseDc = ready ? 8 + proficiencyBonus + abilityModifier : null;
  const baseAttack = ready ? proficiencyBonus + abilityModifier : null;
  const dc = baseDc == null ? null : baseDc + dcAdjustment;
  const attack = baseAttack == null ? null : baseAttack + attackAdjustment;
  const label = sources.length ? `${abilityLabel(ability)} (${sources.join(", ")})` : abilityLabel(ability);

  return {
    sourceKey: ability,
    ability,
    label,
    sources,
    abilityModifier,
    proficiencyBonus,
    dcAdjustment,
    attackAdjustment,
    baseDc,
    baseAttack,
    dc,
    attack,
    dcLabel: dc == null ? "—" : String(dc),
    attackLabel: attack == null ? "—" : signedNumber(attack),
    derived: ready,
    warnings
  };
}

/**
 * The one spellcasting display derivation. Pure: nothing is mutated.
 *
 * @param {unknown} character
 * @param {ReturnType<import("./rules/deriveCharacter.js").deriveCharacter>} derived
 * @returns {SpellcastingDisplayModel}
 */
export function getSpellcastingDisplayModel(character, derived) {
  const source = isPlainObject(character) ? character : {};
  const calc = normalizeSpellcastingCalc(source.spellcastingCalc);
  const flatDc = finiteNumberOrNull(source.spellDC);
  const flatAttack = finiteNumberOrNull(source.spellAttack);

  const derivedSources = collectDerivedSpellcastingSources(derived);
  const hasDerivableSources = derivedSources.length > 0;

  // Legacy: no calc block. Show the stored flat snapshot verbatim.
  if (!calc) {
    return {
      mode: "legacy",
      profiles: [],
      flat: { dc: flatDc, attack: flatAttack },
      hasDerivableSources,
      warnings: []
    };
  }

  // Fixed override: the stored fixed values (falling back to the flat mirror).
  if (calc.mode === "fixed") {
    const dc = calc.fixed.dc != null ? calc.fixed.dc : flatDc;
    const attack = calc.fixed.attack != null ? calc.fixed.attack : flatAttack;
    /** @type {SpellcastingProfile} */
    const profile = {
      sourceKey: "fixed",
      ability: "",
      label: "Fixed value",
      sources: [],
      abilityModifier: null,
      proficiencyBonus: null,
      dcAdjustment: 0,
      attackAdjustment: 0,
      baseDc: dc,
      baseAttack: attack,
      dc,
      attack,
      dcLabel: dc == null ? "—" : String(dc),
      attackLabel: attack == null ? "—" : signedNumber(attack),
      derived: false,
      warnings: []
    };
    return {
      mode: "fixed",
      profiles: [profile],
      flat: { dc, attack },
      hasDerivableSources,
      warnings: []
    };
  }

  // Derived: builder sources, or the freeform-declared abilities.
  /** @type {Array<{ ability: string, sources: string[], dcAdjustment: number, attackAdjustment: number }>} */
  const specs = [];
  if (derivedSources.length) {
    for (const { ability, sources } of derivedSources) {
      const adj = calc.bySource[ability] || { dcAdjustment: 0, attackAdjustment: 0 };
      specs.push({ ability, sources, dcAdjustment: adj.dcAdjustment, attackAdjustment: adj.attackAdjustment });
    }
  } else {
    for (const entry of calc.freeform) {
      specs.push({
        ability: entry.ability,
        sources: [],
        dcAdjustment: entry.dcAdjustment,
        attackAdjustment: entry.attackAdjustment
      });
    }
  }

  /** @type {SpellcastingProfile[]} */
  const profiles = specs.map((spec) =>
    buildProfile(spec.ability, spec.sources, spec.dcAdjustment, spec.attackAdjustment, derived));

  /** @type {string[]} */
  const warnings = [];
  if (!profiles.length) {
    warnings.push("No spellcasting source is set — showing the saved values.");
    return {
      mode: "derived",
      profiles: [],
      flat: { dc: flatDc, attack: flatAttack },
      hasDerivableSources,
      warnings
    };
  }

  const primary = profiles[0];
  return {
    mode: "derived",
    profiles,
    flat: {
      dc: primary.dc != null ? primary.dc : flatDc,
      attack: primary.attack != null ? primary.attack : flatAttack
    },
    hasDerivableSources,
    warnings
  };
}
