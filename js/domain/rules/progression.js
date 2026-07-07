// @ts-check
// Pure level-by-level progression rules for builder characters (SRD 5.1).
//
// The build model stores one entry per character level in build.levels
// (entry i = character level i + 1), so multiclassing is represented
// exactly. Everything in this module is a pure function over
// (build, registry) — no state access, no DOM.

import { getContentByKind } from "./registry.js";

/** @typedef {import("./registry.js").ContentRegistry} ContentRegistry */
/** @typedef {import("./builtinContent.js").BuiltinContentEntry} BuiltinContentEntry */

export const MAX_CHARACTER_LEVEL = 20;

/** Multiclass combined spell slot table (SRD 5.1), rows are caster levels 1-20. */
export const MULTICLASS_SPELL_SLOTS = Object.freeze([
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1]
]);

// SRD unarmored-defense-style AC formulas keyed by the granting feature id.
// The formula itself is rules text, not API data, so it lives here.
const UNARMORED_AC_FORMULAS = Object.freeze({
  "barbarian-unarmored-defense": { base: 10, addAbilities: Object.freeze(["dex", "con"]), allowShield: true },
  "monk-unarmored-defense": { base: 10, addAbilities: Object.freeze(["dex", "wis"]), allowShield: false },
  "draconic-resilience": { base: 13, addAbilities: Object.freeze(["dex"]), allowShield: true }
});

// Feature ids that grant an "expertise" style skill upgrade choice.
export const EXPERTISE_FEATURE_IDS = Object.freeze(new Set([
  "bard-expertise-1", "bard-expertise-2", "rogue-expertise-1", "rogue-expertise-2"
]));

/**
 * Class lookup accepting legacy "class_<id>" ids from the v1 foundation.
 * @param {ContentRegistry} registry
 * @param {string} classId
 * @returns {BuiltinContentEntry | null}
 */
function getClassEntry(registry, classId) {
  const direct = getContentByKind(registry, "class", classId);
  if (direct) return direct;
  if (classId.startsWith("class_")) {
    return getContentByKind(registry, "class", classId.slice("class_".length));
  }
  return null;
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
 * @returns {number | null}
 */
function finiteNumberOrNull(value) {
  if (value === "" || value == null) return null;
  let n;
  try {
    n = Number(value);
  } catch {
    return null;
  }
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalizes build.levels into a clean array of { classId, hp } entries.
 * Invalid rows are dropped; the array is capped at 20 levels.
 * @param {unknown} build
 * @returns {Array<{ classId: string, hp: number | null }>}
 */
export function normalizeBuildLevels(build) {
  if (!isPlainObject(build)) return [];
  /** @type {Array<{ classId: string, hp: number | null }>} */
  const out = [];
  const rows = Array.isArray(build.levels) ? build.levels : [];
  for (const row of rows) {
    if (out.length >= MAX_CHARACTER_LEVEL) break;
    if (!isPlainObject(row)) continue;
    const classId = cleanString(row.classId);
    if (!classId) continue;
    out.push({ classId, hp: finiteNumberOrNull(row.hp) });
  }
  if (out.length) return out;
  // Legacy v1 builds stored a single classId + level. The stored id is kept
  // verbatim; kind-aware lookups strip legacy "class_" prefixes themselves.
  const legacyClassId = cleanString(build.classId);
  const legacyLevel = finiteNumberOrNull(build.level);
  if (legacyClassId && legacyLevel != null && legacyLevel >= 1) {
    const count = Math.min(MAX_CHARACTER_LEVEL, Math.trunc(legacyLevel));
    for (let i = 0; i < count; i += 1) out.push({ classId: legacyClassId, hp: null });
  }
  return out;
}

/**
 * Total class levels per class in acquisition order.
 * @param {Array<{ classId: string }>} levels
 * @returns {Array<{ classId: string, level: number }>}
 */
export function getClassLevelTotals(levels) {
  /** @type {Array<{ classId: string, level: number }>} */
  const out = [];
  /** @type {Map<string, { classId: string, level: number }>} */
  const byClass = new Map();
  for (const row of levels) {
    const existing = byClass.get(row.classId);
    if (existing) {
      existing.level += 1;
    } else {
      const entry = { classId: row.classId, level: 1 };
      byClass.set(row.classId, entry);
      out.push(entry);
    }
  }
  return out;
}

/**
 * @param {Array<{ classId: string }>} levels
 * @returns {number}
 */
export function getTotalLevel(levels) {
  return Math.min(levels.length, MAX_CHARACTER_LEVEL);
}

/**
 * The class level within its own class at each character level.
 * Example: [f, f, w, f] → [1, 2, 1, 3].
 * @param {Array<{ classId: string }>} levels
 * @returns {number[]}
 */
export function getClassLevelAtEachCharacterLevel(levels) {
  /** @type {Record<string, number>} */
  const counts = {};
  return levels.map((row) => {
    counts[row.classId] = (counts[row.classId] || 0) + 1;
    return counts[row.classId];
  });
}

/**
 * Saving throw proficiencies come from the first class only (SRD
 * multiclassing rule).
 * @param {Array<{ classId: string }>} levels
 * @param {ContentRegistry} registry
 * @returns {string[]}
 */
export function getSavingThrowProficiencies(levels, registry) {
  const first = levels[0];
  if (!first) return [];
  const entry = getClassEntry(registry, first.classId);
  const saves = entry?.data?.savingThrowProficiencies;
  return Array.isArray(saves) ? saves.map(cleanString).filter(Boolean) : [];
}

/**
 * ASI slots reached by this build: one per class whose asiLevels include the
 * class level attained at a given character level.
 * @param {Array<{ classId: string }>} levels
 * @param {ContentRegistry} registry
 * @returns {Array<{ characterLevel: number, classId: string, classLevel: number }>}
 */
export function getAsiSlots(levels, registry) {
  const classLevels = getClassLevelAtEachCharacterLevel(levels);
  /** @type {Array<{ characterLevel: number, classId: string, classLevel: number }>} */
  const out = [];
  levels.forEach((row, index) => {
    const entry = getClassEntry(registry, row.classId);
    const asiLevels = Array.isArray(entry?.data?.asiLevels) ? entry.data.asiLevels : [];
    if (asiLevels.includes(classLevels[index])) {
      out.push({ characterLevel: index + 1, classId: row.classId, classLevel: classLevels[index] });
    }
  });
  return out;
}

/**
 * All class and subclass features gained by this build, in level order.
 * @param {Array<{ classId: string }>} levels
 * @param {Record<string, string>} subclassByClass
 * @param {ContentRegistry} registry
 * @returns {Array<{ featureId: string, classId: string, subclassId: string | null, classLevel: number, characterLevel: number }>}
 */
export function getBuildFeatures(levels, subclassByClass, registry) {
  const classLevels = getClassLevelAtEachCharacterLevel(levels);
  /** @type {Array<{ featureId: string, classId: string, subclassId: string | null, classLevel: number, characterLevel: number }>} */
  const out = [];
  levels.forEach((row, index) => {
    const classLevel = classLevels[index];
    const characterLevel = index + 1;
    const classEntry = getClassEntry(registry, row.classId);
    const featuresByLevel = isPlainObject(classEntry?.data?.featuresByLevel)
      ? classEntry.data.featuresByLevel
      : {};
    const classFeatureIds = /** @type {unknown[]} */ (Array.isArray(featuresByLevel[String(classLevel)])
      ? featuresByLevel[String(classLevel)]
      : []);
    for (const featureId of classFeatureIds) {
      const id = cleanString(featureId);
      if (id) out.push({ featureId: id, classId: row.classId, subclassId: null, classLevel, characterLevel });
    }
    const subclassId = cleanString(subclassByClass?.[row.classId]);
    if (subclassId) {
      const subclassEntry = getContentByKind(registry, "subclass", subclassId);
      const subFeaturesByLevel = isPlainObject(subclassEntry?.data?.featuresByLevel)
        ? subclassEntry.data.featuresByLevel
        : {};
      const subFeatureIds = /** @type {unknown[]} */ (Array.isArray(subFeaturesByLevel[String(classLevel)])
        ? subFeaturesByLevel[String(classLevel)]
        : []);
      for (const featureId of subFeatureIds) {
        const id = cleanString(featureId);
        if (id) out.push({ featureId: id, classId: row.classId, subclassId, classLevel, characterLevel });
      }
    }
  });
  return out;
}

/**
 * Hit dice pools per class, e.g. Fighter 3 / Wizard 2 → [{d10 × 3}, {d6 × 2}].
 * @param {Array<{ classId: string }>} levels
 * @param {ContentRegistry} registry
 * @returns {Array<{ classId: string, die: number | null, count: number }>}
 */
export function getHitDicePools(levels, registry) {
  return getClassLevelTotals(levels).map(({ classId, level }) => {
    const entry = getClassEntry(registry, classId);
    const die = finiteNumberOrNull(entry?.data?.hitDie);
    return { classId, die: die != null && die > 0 ? die : null, count: level };
  });
}

/**
 * Max HP for the build.
 * Level 1 grants the max of the first class's hit die. Later levels use the
 * stored per-level roll when present, otherwise the SRD average
 * (die / 2 + 1). The Constitution modifier applies once per level, and
 * per-level bonuses (e.g. custom feat hp_per_level_bonus) apply once per
 * level from the level they are relevant (applied uniformly here).
 *
 * @param {Array<{ classId: string, hp: number | null }>} levels
 * @param {number | null} conModifier
 * @param {ContentRegistry} registry
 * @param {{ perLevelBonus?: number }} [options]
 * @returns {{ max: number | null, breakdown: Array<{ characterLevel: number, classId: string, die: number | null, value: number | null, source: "max" | "roll" | "average" | "unknown" }> }}
 */
export function computeMaxHp(levels, conModifier, registry, options = {}) {
  const perLevelBonus = Number.isFinite(options.perLevelBonus) ? Number(options.perLevelBonus) : 0;
  /** @type {ReturnType<typeof computeMaxHp>["breakdown"]} */
  const breakdown = [];
  if (!levels.length) return { max: null, breakdown };
  let total = 0;
  let derivable = true;
  levels.forEach((row, index) => {
    const entry = getClassEntry(registry, row.classId);
    const die = finiteNumberOrNull(entry?.data?.hitDie);
    /** @type {"max" | "roll" | "average" | "unknown"} */
    let source = "unknown";
    /** @type {number | null} */
    let value = null;
    if (die != null && die > 0) {
      if (index === 0) {
        value = die;
        source = "max";
      } else if (row.hp != null && row.hp >= 1) {
        value = Math.trunc(row.hp);
        source = "roll";
      } else {
        value = Math.trunc(die / 2) + 1;
        source = "average";
      }
    }
    breakdown.push({ characterLevel: index + 1, classId: row.classId, die, value, source });
    if (value == null) {
      derivable = false;
      return;
    }
    total += value + (conModifier ?? 0) + perLevelBonus;
  });
  if (!derivable || conModifier == null) {
    return { max: derivable && conModifier == null ? null : null, breakdown };
  }
  return { max: Math.max(1, total), breakdown };
}

/**
 * Checks SRD multiclassing ability prerequisites for taking a level in
 * `classId` given final ability scores. Both the new class and every
 * existing class must satisfy their own prerequisites; this helper checks a
 * single class (callers verify the set).
 *
 * @param {string} classId
 * @param {Record<string, number | null>} abilityTotals
 * @param {ContentRegistry} registry
 * @returns {{ ok: boolean, unmet: string[] }}
 */
export function checkMulticlassPrerequisites(classId, abilityTotals, registry) {
  const entry = getClassEntry(registry, classId);
  const multiclassing = isPlainObject(entry?.data?.multiclassing) ? entry.data.multiclassing : null;
  if (!multiclassing) return { ok: true, unmet: [] };
  /** @type {string[]} */
  const unmet = [];
  const prerequisites = Array.isArray(multiclassing.prerequisites) ? multiclassing.prerequisites : [];
  for (const prereq of prerequisites) {
    if (!isPlainObject(prereq)) continue;
    const ability = cleanString(prereq.ability);
    const minimum = finiteNumberOrNull(prereq.minimum);
    if (!ability || minimum == null) continue;
    const score = abilityTotals[ability];
    if (score == null || score < minimum) unmet.push(`${ability.toUpperCase()} ${minimum}`);
  }
  const optionList = Array.isArray(multiclassing.prerequisiteOptions) ? multiclassing.prerequisiteOptions : [];
  if (optionList.length) {
    const anyMet = optionList.some((option) => {
      if (!isPlainObject(option)) return false;
      const ability = cleanString(option.ability);
      const minimum = finiteNumberOrNull(option.minimum);
      if (!ability || minimum == null) return false;
      const score = abilityTotals[ability];
      return score != null && score >= minimum;
    });
    if (!anyMet) {
      unmet.push(optionList
        .filter(isPlainObject)
        .map((option) => `${cleanString(option.ability).toUpperCase()} ${option.minimum}`)
        .join(" or "));
    }
  }
  return { ok: unmet.length === 0, unmet };
}

/**
 * Per-class spellcasting summary for the build.
 * @param {Array<{ classId: string }>} levels
 * @param {ContentRegistry} registry
 * @returns {Array<{
 *   classId: string,
 *   classLevel: number,
 *   ability: string,
 *   preparationMode: string,
 *   progression: string,
 *   ritualCasting: boolean,
 *   startLevel: number,
 *   cantripsKnownMax: number | null,
 *   spellsKnownMax: number | null,
 *   slotsByLevel: number[][] | null
 * }>}
 */
export function getSpellcastingClasses(levels, registry) {
  /** @type {ReturnType<typeof getSpellcastingClasses>} */
  const out = [];
  for (const { classId, level } of getClassLevelTotals(levels)) {
    const entry = getClassEntry(registry, classId);
    const spellcasting = isPlainObject(entry?.data?.spellcasting) ? entry.data.spellcasting : null;
    if (!spellcasting) continue;
    const startLevel = finiteNumberOrNull(spellcasting.startLevel) ?? 1;
    if (level < startLevel) continue;
    const cantrips = Array.isArray(spellcasting.cantripsKnownByLevel) ? spellcasting.cantripsKnownByLevel : null;
    const known = Array.isArray(spellcasting.spellsKnownByLevel) ? spellcasting.spellsKnownByLevel : null;
    out.push({
      classId,
      classLevel: level,
      ability: cleanString(spellcasting.ability),
      preparationMode: cleanString(spellcasting.preparationMode) || "known",
      progression: cleanString(spellcasting.progression) || "full",
      ritualCasting: spellcasting.ritualCasting === true,
      startLevel,
      cantripsKnownMax: cantrips ? finiteNumberOrNull(cantrips[level - 1]) : null,
      spellsKnownMax: known ? finiteNumberOrNull(known[level - 1]) : null,
      slotsByLevel: Array.isArray(spellcasting.slotsByLevel)
        ? /** @type {number[][]} */ (spellcasting.slotsByLevel)
        : null
    });
  }
  return out;
}

/**
 * Combined spell slots for the build.
 * - Pact magic (warlock) is always tracked separately.
 * - A single slot-progression class uses its own class table.
 * - Multiple slot-progression classes use the SRD multiclass table with
 *   caster level = full levels + floor(half levels / 2).
 *
 * @param {Array<{ classId: string }>} levels
 * @param {ContentRegistry} registry
 * @returns {{
 *   slots: number[],
 *   casterLevel: number,
 *   pact: { slots: number, slotLevel: number } | null
 * }}
 */
export function getCombinedSpellSlots(levels, registry) {
  const casters = getSpellcastingClasses(levels, registry);
  /** @type {{ slots: number, slotLevel: number } | null} */
  let pact = null;
  /** @type {typeof casters} */
  const slotCasters = [];
  for (const caster of casters) {
    if (caster.progression === "pact") {
      const row = caster.slotsByLevel?.[caster.classLevel - 1];
      if (Array.isArray(row)) {
        const slotLevelIndex = row.findIndex((count) => count > 0);
        if (slotLevelIndex >= 0) {
          pact = { slots: row[slotLevelIndex], slotLevel: slotLevelIndex + 1 };
        }
      }
      continue;
    }
    slotCasters.push(caster);
  }

  if (!slotCasters.length) {
    return { slots: [0, 0, 0, 0, 0, 0, 0, 0, 0], casterLevel: 0, pact };
  }

  if (slotCasters.length === 1) {
    const caster = slotCasters[0];
    const row = caster.slotsByLevel?.[caster.classLevel - 1];
    return {
      slots: Array.isArray(row) ? row.slice(0, 9) : [0, 0, 0, 0, 0, 0, 0, 0, 0],
      casterLevel: caster.progression === "half"
        ? Math.floor(caster.classLevel / 2)
        : caster.classLevel,
      pact
    };
  }

  let casterLevel = 0;
  for (const caster of slotCasters) {
    if (caster.progression === "half") casterLevel += Math.floor(caster.classLevel / 2);
    else casterLevel += caster.classLevel;
  }
  const clamped = Math.max(0, Math.min(MAX_CHARACTER_LEVEL, casterLevel));
  const slots = clamped >= 1
    ? MULTICLASS_SPELL_SLOTS[clamped - 1].slice()
    : [0, 0, 0, 0, 0, 0, 0, 0, 0];
  return { slots, casterLevel: clamped, pact };
}

/**
 * Spells granted automatically by the build (subclass domain/patron lists).
 * @param {Array<{ classId: string }>} levels
 * @param {Record<string, string>} subclassByClass
 * @param {ContentRegistry} registry
 * @returns {Array<{ spellId: string, classId: string, subclassId: string, grantType: string }>}
 */
export function getGrantedSpells(levels, subclassByClass, registry) {
  /** @type {ReturnType<typeof getGrantedSpells>} */
  const out = [];
  for (const { classId, level } of getClassLevelTotals(levels)) {
    const subclassId = cleanString(subclassByClass?.[classId]);
    if (!subclassId) continue;
    const subclassEntry = getContentByKind(registry, "subclass", subclassId);
    const grants = Array.isArray(subclassEntry?.data?.grantedSpells)
      ? subclassEntry.data.grantedSpells
      : [];
    for (const grant of grants) {
      if (!isPlainObject(grant)) continue;
      const spellId = cleanString(grant.spellId);
      const classLevel = finiteNumberOrNull(grant.classLevel) ?? 1;
      if (!spellId || level < classLevel) continue;
      out.push({
        spellId,
        classId,
        subclassId,
        grantType: cleanString(grant.grantType) || "always_prepared"
      });
    }
  }
  return out;
}

/**
 * Armor class derivation.
 * Priority: equipped armor → best applicable unarmored-defense formula →
 * base 10 + Dex. Shields stack except where the formula disallows them
 * (Monk Unarmored Defense).
 *
 * @param {{
 *   abilityModifiers: Record<string, number | null>,
 *   armorEntry: BuiltinContentEntry | null,
 *   hasShield: boolean,
 *   shieldEntry?: BuiltinContentEntry | null,
 *   featureIds: Iterable<string>,
 *   acBonus?: number
 * }} input
 * @returns {{ value: number | null, formula: string }}
 */
export function computeArmorClass(input) {
  const { abilityModifiers, armorEntry, hasShield, shieldEntry = null, featureIds, acBonus = 0 } = input;
  const dex = abilityModifiers.dex;
  const shieldBonus = hasShield
    ? (finiteNumberOrNull(shieldEntry?.data?.acBonus) ?? 2)
    : 0;

  if (armorEntry && isPlainObject(armorEntry.data)) {
    const data = armorEntry.data;
    const baseAC = finiteNumberOrNull(data.baseAC);
    if (baseAC != null) {
      let dexPart = 0;
      let formula = `${baseAC} (${armorEntry.name})`;
      if (data.addDex === true) {
        if (dex == null) return { value: null, formula: "" };
        const maxDex = finiteNumberOrNull(data.maxDex);
        dexPart = maxDex != null ? Math.min(dex, maxDex) : dex;
        formula += ` + Dex${maxDex != null ? ` (max ${maxDex})` : ""}`;
      }
      const value = baseAC + dexPart + shieldBonus + acBonus;
      if (shieldBonus) formula += ` + Shield ${shieldBonus}`;
      if (acBonus) formula += ` + Bonus ${acBonus}`;
      return { value, formula };
    }
  }

  const featureSet = new Set(featureIds);
  /** @type {{ base: number, addAbilities: readonly string[], allowShield: boolean } | null} */
  let best = null;
  let bestValue = null;
  for (const [featureId, config] of Object.entries(UNARMORED_AC_FORMULAS)) {
    if (!featureSet.has(featureId)) continue;
    let value = config.base;
    let complete = true;
    for (const ability of config.addAbilities) {
      const mod = abilityModifiers[ability];
      if (mod == null) { complete = false; break; }
      value += mod;
    }
    if (!complete) continue;
    const withShield = value + (config.allowShield ? shieldBonus : 0);
    if (bestValue == null || withShield > bestValue) {
      best = config;
      bestValue = withShield;
    }
  }
  if (best && bestValue != null) {
    const parts = [`${best.base}`, ...best.addAbilities.map((a) => a.toUpperCase())];
    let formula = parts.join(" + ");
    if (best.allowShield && shieldBonus) formula += ` + Shield ${shieldBonus}`;
    if (acBonus) formula += ` + Bonus ${acBonus}`;
    return { value: bestValue + acBonus, formula };
  }

  if (dex == null) return { value: null, formula: "" };
  let formula = "10 + Dex";
  if (shieldBonus) formula += ` + Shield ${shieldBonus}`;
  if (acBonus) formula += ` + Bonus ${acBonus}`;
  return { value: 10 + dex + shieldBonus + acBonus, formula };
}

/**
 * Interprets the small closed set of structured custom-feat effects.
 * See docs/reference/content-registry-plan.md "Feat Effects" for the
 * vocabulary. Unknown effect types are ignored (desc-only feats).
 *
 * @param {BuiltinContentEntry[]} featEntries
 * @returns {{
 *   abilityBonuses: Record<string, number>,
 *   hpPerLevelBonus: number,
 *   speedBonus: number,
 *   acBonus: number,
 *   initiativeBonus: number,
 *   saveProficiencies: string[],
 *   skillProficiencies: string[]
 * }}
 */
export function collectFeatEffects(featEntries) {
  /** @type {ReturnType<typeof collectFeatEffects>} */
  const out = {
    abilityBonuses: {},
    hpPerLevelBonus: 0,
    speedBonus: 0,
    acBonus: 0,
    initiativeBonus: 0,
    saveProficiencies: [],
    skillProficiencies: []
  };
  for (const entry of featEntries) {
    const effects = Array.isArray(entry?.data?.effects) ? entry.data.effects : [];
    for (const effect of effects) {
      if (!isPlainObject(effect)) continue;
      const type = cleanString(effect.type);
      const value = finiteNumberOrNull(effect.value) ?? 0;
      if (type === "hp_per_level_bonus") out.hpPerLevelBonus += value;
      else if (type === "speed_bonus") out.speedBonus += value;
      else if (type === "ac_bonus") out.acBonus += value;
      else if (type === "initiative_bonus") out.initiativeBonus += value;
      else if (type === "ability_bonus") {
        const ability = cleanString(effect.ability);
        if (ability) out.abilityBonuses[ability] = (out.abilityBonuses[ability] || 0) + value;
      } else if (type === "save_proficiency") {
        const ability = cleanString(effect.ability);
        if (ability && !out.saveProficiencies.includes(ability)) out.saveProficiencies.push(ability);
      } else if (type === "skill_proficiency") {
        const skill = cleanString(effect.skill);
        if (skill && !out.skillProficiencies.includes(skill)) out.skillProficiencies.push(skill);
      }
    }
  }
  return out;
}

/**
 * Flattens every choice value stored in choicesByLevel into a single lookup.
 * Later levels win on (unlikely) duplicate ids.
 * @param {unknown} choicesByLevel
 * @returns {Record<string, unknown>}
 */
export function flattenChoices(choicesByLevel) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!isPlainObject(choicesByLevel)) return out;
  const levelKeys = Object.keys(choicesByLevel)
    .filter((key) => Number.isInteger(Number(key)))
    .sort((a, b) => Number(a) - Number(b));
  for (const key of levelKeys) {
    const levelChoices = choicesByLevel[key];
    if (!isPlainObject(levelChoices)) continue;
    for (const [choiceId, value] of Object.entries(levelChoices)) {
      out[choiceId] = value;
    }
  }
  return out;
}

/**
 * Collects ASI increases and chosen feats from asi-slot choices.
 * Choice ids follow `asi-<characterLevel>`; values are either
 * { type: "asi", increases: { str: 1, … } } or { type: "feat", featId }.
 *
 * @param {Record<string, unknown>} flatChoices
 * @returns {{ abilityIncreases: Record<string, number>, featIds: string[] }}
 */
export function collectAsiChoices(flatChoices) {
  /** @type {Record<string, number>} */
  const abilityIncreases = {};
  /** @type {string[]} */
  const featIds = [];
  for (const [choiceId, value] of Object.entries(flatChoices)) {
    if (!choiceId.startsWith("asi-") || !isPlainObject(value)) continue;
    if (value.type === "feat") {
      const featId = cleanString(value.featId);
      if (featId) featIds.push(featId);
      continue;
    }
    if (value.type === "asi" && isPlainObject(value.increases)) {
      for (const [ability, amount] of Object.entries(value.increases)) {
        const n = finiteNumberOrNull(amount);
        if (n != null && n !== 0) abilityIncreases[ability] = (abilityIncreases[ability] || 0) + n;
      }
    }
  }
  return { abilityIncreases, featIds };
}

/** @param {number} characterLevel @returns {string} */
export function asiChoiceId(characterLevel) {
  return `asi-${characterLevel}`;
}

/** @param {string} classId @returns {string} */
export function classSkillChoiceId(classId) {
  return `class-skill-${classId}`;
}

/** @param {string} classId @returns {string} */
export function multiclassSkillChoiceId(classId) {
  return `multiclass-skill-${classId}`;
}

/** @param {string} featureId @returns {string} */
export function featureChoiceId(featureId) {
  return `feature-${featureId}`;
}
