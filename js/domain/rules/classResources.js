// @ts-check
// Generalized class-resource derivation (Level Up Phase 2).
//
// A "class resource" is a shared limited-use pool granted by class levels —
// Rage, Ki Points, Sorcery Points, Channel Divinity, Lay on Hands, and so on.
// This module derives the pools a build has unlocked, as pure data over
// (levels, registry, ability modifiers). It never touches character state;
// seeding into `character.resources[]` lives in builderSheetSeeding.js.
//
// Definitions resolve per class record in two ways:
//
//  1. An explicit `resources: []` array on the class record — the canonical
//     authoring shape for custom classes (documented in
//     docs/reference/content-registry-plan.md). When present it is
//     authoritative and builtin synthesis is skipped for that class.
//  2. Builtin SRD classes synthesize definitions from the shipped
//     `classSpecificByLevel` progression data plus the closed rules
//     vocabulary below. Use counts come from the data wherever the upstream
//     API models them; recovery cadence and the handful of counts the API
//     does not model (Second Wind, Wild Shape, Lay on Hands, Bardic
//     Inspiration, the Paladin's Channel Divinity) are SRD rules text — the
//     same precedent as UNARMORED_AC_FORMULAS and the spellbook constants in
//     progression.js.
//
// Deliberately NOT class resources: static progression values (Rage damage,
// Bardic Inspiration die size, Sneak Attack dice), calculated recovery
// amounts (the slot levels Arcane Recovery restores — only its 1/day use is
// a pool), feature-specific single-use counters owned by `featureUses`
// (Dragonborn Breath Weapon), and subclass feature counters (future feature
// detail work).

import { getContentByKind } from "./registry.js";
import { getClassLevelTotals } from "./progression.js";

/** @typedef {import("./registry.js").ContentRegistry} ContentRegistry */
/** @typedef {import("./builtinContent.js").BuiltinContentEntry} BuiltinContentEntry */
/** @typedef {"shortRest" | "longRest" | "shortOrLongRest" | "manual" | "none"} ResourceRecoveryMode */

/**
 * @typedef {(
 *   { type: "byClassLevel", values: Array<number | "unlimited" | null> } |
 *   { type: "constant", value: number, startLevel?: number } |
 *   { type: "classLevelMultiple", multiplier: number, startLevel?: number } |
 *   { type: "abilityModifier", ability: string, minimum?: number, startLevel?: number }
 * )} ClassResourceMaxShape
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   max: ClassResourceMaxShape,
 *   recovery: ResourceRecoveryMode | Array<{ minClassLevel: number, recovery: ResourceRecoveryMode }>
 * }} ClassResourceDefinition
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   max: number | null,
 *   unlimited: boolean,
 *   recovery: ResourceRecoveryMode,
 *   classIds: string[]
 * }} DerivedClassResource
 */

export const CLASS_RESOURCE_SEED_PREFIX = "class-resource:";

/**
 * The stable `builderSeed` marker stamped on seeded resource entries. Keyed
 * by pool id (not class id) so pools shared across classes — Channel
 * Divinity for a Cleric/Paladin multiclass — dedupe to one tile.
 * @param {string} resourceId
 * @returns {string}
 */
export function classResourceSeedMarker(resourceId) {
  return `${CLASS_RESOURCE_SEED_PREFIX}${resourceId}`;
}

const RESOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RECOVERY_MODES = Object.freeze(new Set(["shortRest", "longRest", "shortOrLongRest", "manual", "none"]));
// When two classes grant the same pool, the most permissive recovery wins.
const RECOVERY_RANK = Object.freeze({ shortOrLongRest: 4, shortRest: 3, longRest: 2, manual: 1, none: 0 });
// The upstream data uses a large sentinel (9999) for "unlimited" (Barbarian
// Rage at 20). Anything this large is a flag, not a trackable count.
const UNLIMITED_SENTINEL_MIN = 99;

/**
 * `classSpecificByLevel` keys that are shared limited-use pools. Counts come
 * from the shipped per-level data; recovery cadence is SRD rules text.
 * `fixedMax` pools use the data only to detect the unlock level (the data
 * value is a recovery *amount*, not a use count — Arcane Recovery).
 * @type {ReadonlyArray<{ key: string, id: string, name: string, recovery: ResourceRecoveryMode, fixedMax?: number }>}
 */
const CLASS_SPECIFIC_POOLS = Object.freeze([
  { key: "rage_count", id: "rage", name: "Rage", recovery: "longRest" },
  { key: "channel_divinity_charges", id: "channel-divinity", name: "Channel Divinity", recovery: "shortOrLongRest" },
  { key: "action_surges", id: "action-surge", name: "Action Surge", recovery: "shortOrLongRest" },
  { key: "indomitable_uses", id: "indomitable", name: "Indomitable", recovery: "longRest" },
  { key: "ki_points", id: "ki-points", name: "Ki Points", recovery: "shortOrLongRest" },
  { key: "sorcery_points", id: "sorcery-points", name: "Sorcery Points", recovery: "longRest" },
  { key: "mystic_arcanum_level_6", id: "mystic-arcanum-6th", name: "Mystic Arcanum (6th Level)", recovery: "longRest" },
  { key: "mystic_arcanum_level_7", id: "mystic-arcanum-7th", name: "Mystic Arcanum (7th Level)", recovery: "longRest" },
  { key: "mystic_arcanum_level_8", id: "mystic-arcanum-8th", name: "Mystic Arcanum (8th Level)", recovery: "longRest" },
  { key: "mystic_arcanum_level_9", id: "mystic-arcanum-9th", name: "Mystic Arcanum (9th Level)", recovery: "longRest" },
  { key: "arcane_recovery_levels", id: "arcane-recovery", name: "Arcane Recovery", recovery: "longRest", fixedMax: 1 }
]);

/**
 * Shared pools whose use counts the upstream API does not model numerically.
 * A pool exists only when the class's `featuresByLevel` actually grants a
 * matching feature id; the unlock level comes from that data. `matchExact`
 * avoids prefix collisions (the Cleric's versioned `channel-divinity-1-rest`
 * ids must not match the Paladin's bare `channel-divinity`).
 * @type {ReadonlyArray<{
 *   matchPrefix?: string, matchExact?: string,
 *   id: string, name: string,
 *   max: ClassResourceMaxShape,
 *   recovery: ResourceRecoveryMode,
 *   recoveryUpgrade?: { matchPrefix: string, recovery: ResourceRecoveryMode }
 * }>}
 */
const FEATURE_KEYED_POOLS = Object.freeze([
  {
    matchExact: "second-wind",
    id: "second-wind", name: "Second Wind",
    max: { type: "constant", value: 1 }, recovery: "shortOrLongRest"
  },
  {
    matchPrefix: "wild-shape-cr",
    id: "wild-shape", name: "Wild Shape",
    max: { type: "constant", value: 2 }, recovery: "shortOrLongRest"
  },
  {
    matchExact: "lay-on-hands",
    id: "lay-on-hands", name: "Lay on Hands",
    max: { type: "classLevelMultiple", multiplier: 5 }, recovery: "longRest"
  },
  {
    matchPrefix: "bardic-inspiration-d",
    id: "bardic-inspiration", name: "Bardic Inspiration",
    max: { type: "abilityModifier", ability: "cha", minimum: 1 }, recovery: "longRest",
    recoveryUpgrade: { matchPrefix: "font-of-inspiration", recovery: "shortOrLongRest" }
  },
  {
    matchExact: "channel-divinity",
    id: "channel-divinity", name: "Channel Divinity",
    max: { type: "constant", value: 1 }, recovery: "shortOrLongRest"
  }
]);

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
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} recovery
 * @returns {recovery is ResourceRecoveryMode}
 */
function isRecoveryMode(recovery) {
  return typeof recovery === "string" && RECOVERY_MODES.has(recovery);
}

/**
 * The earliest class level whose featuresByLevel grants a matching feature,
 * or null when the class never grants it.
 * @param {Record<string, unknown>} featuresByLevel
 * @param {{ matchPrefix?: string, matchExact?: string }} matcher
 * @returns {number | null}
 */
function findFeatureUnlockLevel(featuresByLevel, matcher) {
  let unlock = null;
  for (const [levelKey, ids] of Object.entries(featuresByLevel)) {
    const level = Number(levelKey);
    if (!Number.isInteger(level) || level < 1 || !Array.isArray(ids)) continue;
    const hit = ids.some((featureId) => {
      const id = cleanString(featureId);
      if (matcher.matchExact) return id === matcher.matchExact;
      return matcher.matchPrefix ? id.startsWith(matcher.matchPrefix) : false;
    });
    if (hit && (unlock == null || level < unlock)) unlock = level;
  }
  return unlock;
}

/**
 * Normalizes an explicit (custom-class) resource definition. Malformed
 * entries return null and the caller records a warning — a bad homebrew
 * record degrades to "no pool", never to a crash or a garbage tile.
 * @param {unknown} raw
 * @returns {ClassResourceDefinition | null}
 */
function normalizeResourceDefinition(raw) {
  if (!isPlainObject(raw)) return null;
  const id = cleanString(raw.id);
  const name = cleanString(raw.name);
  if (!RESOURCE_ID_PATTERN.test(id) || !name) return null;

  const max = raw.max;
  if (!isPlainObject(max)) return null;
  /** @type {ClassResourceMaxShape | null} */
  let maxShape = null;
  if (max.type === "byClassLevel" && Array.isArray(max.values)) {
    const values = max.values.map((value) => {
      if (value === "unlimited") return /** @type {"unlimited"} */ ("unlimited");
      const n = finiteNumberOrNull(value);
      return n != null && n > 0 ? Math.trunc(n) : null;
    });
    if (values.some((value) => value != null)) maxShape = { type: "byClassLevel", values };
  } else if (max.type === "constant") {
    const value = finiteNumberOrNull(max.value);
    const startLevel = finiteNumberOrNull(max.startLevel);
    if (value != null && value > 0) {
      maxShape = { type: "constant", value: Math.trunc(value), ...(startLevel != null ? { startLevel: Math.trunc(startLevel) } : {}) };
    }
  } else if (max.type === "classLevelMultiple") {
    const multiplier = finiteNumberOrNull(max.multiplier);
    const startLevel = finiteNumberOrNull(max.startLevel);
    if (multiplier != null && multiplier > 0) {
      maxShape = { type: "classLevelMultiple", multiplier, ...(startLevel != null ? { startLevel: Math.trunc(startLevel) } : {}) };
    }
  } else if (max.type === "abilityModifier") {
    const ability = cleanString(max.ability);
    const minimum = finiteNumberOrNull(max.minimum);
    const startLevel = finiteNumberOrNull(max.startLevel);
    if (ability) {
      maxShape = {
        type: "abilityModifier", ability,
        ...(minimum != null ? { minimum } : {}),
        ...(startLevel != null ? { startLevel: Math.trunc(startLevel) } : {})
      };
    }
  }
  if (!maxShape) return null;

  /** @type {ClassResourceDefinition["recovery"] | null} */
  let recovery = null;
  if (isRecoveryMode(raw.recovery)) {
    recovery = raw.recovery;
  } else if (Array.isArray(raw.recovery)) {
    const thresholds = raw.recovery
      .filter(isPlainObject)
      .map((entry) => ({
        minClassLevel: finiteNumberOrNull(entry.minClassLevel),
        recovery: entry.recovery
      }))
      .filter((entry) => entry.minClassLevel != null && entry.minClassLevel >= 1 && isRecoveryMode(entry.recovery))
      .map((entry) => ({
        minClassLevel: Math.trunc(/** @type {number} */ (entry.minClassLevel)),
        recovery: /** @type {ResourceRecoveryMode} */ (entry.recovery)
      }))
      .sort((a, b) => a.minClassLevel - b.minClassLevel);
    if (thresholds.length) recovery = thresholds;
  }
  if (!recovery) return null;

  return { id, name, max: maxShape, recovery };
}

/**
 * Synthesizes builtin pool definitions for one class record from its shipped
 * `classSpecificByLevel` data and `featuresByLevel` grants.
 * @param {Record<string, unknown>} data
 * @returns {ClassResourceDefinition[]}
 */
function synthesizeBuiltinDefinitions(data) {
  /** @type {ClassResourceDefinition[]} */
  const definitions = [];
  const classSpecific = isPlainObject(data.classSpecificByLevel) ? data.classSpecificByLevel : {};
  const featuresByLevel = isPlainObject(data.featuresByLevel) ? data.featuresByLevel : {};

  for (const pool of CLASS_SPECIFIC_POOLS) {
    /** @type {Array<number | "unlimited" | null>} */
    const values = [];
    let anyValue = false;
    let unlockLevel = null;
    for (let level = 1; level <= 20; level += 1) {
      const row = classSpecific[String(level)];
      const raw = isPlainObject(row) ? finiteNumberOrNull(row[pool.key]) : null;
      if (raw != null && raw > 0) {
        anyValue = true;
        if (unlockLevel == null) unlockLevel = level;
        values.push(raw >= UNLIMITED_SENTINEL_MIN ? "unlimited" : Math.trunc(raw));
      } else {
        values.push(null);
      }
    }
    if (!anyValue || unlockLevel == null) continue;
    definitions.push({
      id: pool.id,
      name: pool.name,
      max: pool.fixedMax != null
        ? { type: "constant", value: pool.fixedMax, startLevel: unlockLevel }
        : { type: "byClassLevel", values },
      recovery: pool.recovery
    });
  }

  for (const pool of FEATURE_KEYED_POOLS) {
    const unlockLevel = findFeatureUnlockLevel(featuresByLevel, pool);
    if (unlockLevel == null) continue;
    /** @type {ClassResourceMaxShape} */
    const max = pool.max.type === "byClassLevel"
      ? pool.max
      : { ...pool.max, startLevel: unlockLevel };
    /** @type {ClassResourceDefinition["recovery"]} */
    let recovery = pool.recovery;
    if (pool.recoveryUpgrade) {
      const upgradeLevel = findFeatureUnlockLevel(featuresByLevel, { matchPrefix: pool.recoveryUpgrade.matchPrefix });
      if (upgradeLevel != null) {
        recovery = [
          { minClassLevel: unlockLevel, recovery: pool.recovery },
          { minClassLevel: upgradeLevel, recovery: pool.recoveryUpgrade.recovery }
        ];
      }
    }
    definitions.push({ id: pool.id, name: pool.name, max, recovery });
  }

  return definitions;
}

/**
 * Resolves the resource definitions one class record contributes. An explicit
 * `resources` array (the custom-class shape) is authoritative when present —
 * including an empty array, which is a deliberate "this class has no pools".
 * @param {BuiltinContentEntry} classEntry
 * @returns {{ definitions: ClassResourceDefinition[], warnings: string[] }}
 */
export function getClassResourceDefinitions(classEntry) {
  /** @type {string[]} */
  const warnings = [];
  const data = isPlainObject(classEntry?.data) ? classEntry.data : {};
  if (Array.isArray(data.resources)) {
    /** @type {ClassResourceDefinition[]} */
    const definitions = [];
    data.resources.forEach((raw, index) => {
      const normalized = normalizeResourceDefinition(raw);
      if (normalized) definitions.push(normalized);
      else warnings.push(`Malformed resource definition ${index + 1} on class ${classEntry.id}`);
    });
    return { definitions, warnings };
  }
  return { definitions: synthesizeBuiltinDefinitions(data), warnings };
}

/**
 * @param {ClassResourceMaxShape} shape
 * @param {number} classLevel
 * @param {Record<string, number | null>} abilityModifiers
 * @returns {{ active: boolean, max: number | null, unlimited: boolean }}
 */
function resolveMaxAtLevel(shape, classLevel, abilityModifiers) {
  if (shape.type === "byClassLevel") {
    const value = shape.values[classLevel - 1] ?? null;
    if (value === "unlimited") return { active: true, max: null, unlimited: true };
    if (value != null && value > 0) return { active: true, max: value, unlimited: false };
    return { active: false, max: null, unlimited: false };
  }
  const startLevel = "startLevel" in shape && shape.startLevel != null ? shape.startLevel : 1;
  if (classLevel < startLevel) return { active: false, max: null, unlimited: false };
  if (shape.type === "constant") return { active: true, max: shape.value, unlimited: false };
  if (shape.type === "classLevelMultiple") {
    return { active: true, max: Math.trunc(shape.multiplier * classLevel), unlimited: false };
  }
  // abilityModifier
  const modifier = abilityModifiers[shape.ability];
  const minimum = shape.minimum ?? null;
  if (modifier == null) {
    if (minimum != null) return { active: true, max: minimum, unlimited: false };
    return { active: false, max: null, unlimited: false };
  }
  const value = minimum != null ? Math.max(minimum, modifier) : modifier;
  return value > 0
    ? { active: true, max: value, unlimited: false }
    : { active: false, max: null, unlimited: false };
}

/**
 * @param {ClassResourceDefinition["recovery"]} recovery
 * @param {number} classLevel
 * @returns {ResourceRecoveryMode}
 */
function resolveRecoveryAtLevel(recovery, classLevel) {
  if (typeof recovery === "string") return recovery;
  /** @type {ResourceRecoveryMode} */
  let resolved = recovery[0]?.recovery ?? "manual";
  for (const threshold of recovery) {
    if (classLevel >= threshold.minClassLevel) resolved = threshold.recovery;
  }
  return resolved;
}

/**
 * Kind-aware class lookup accepting legacy "class_<id>" ids (matches the
 * private helper in progression.js).
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
 * Derives every class-resource pool the build has unlocked. Pools sharing an
 * id across classes merge into one entry: per the SRD multiclassing rule
 * (Channel Divinity uses do not add), the highest single-class maximum wins,
 * and the most permissive recovery cadence wins.
 *
 * @param {Array<{ classId: string }>} levels
 * @param {ContentRegistry} registry
 * @param {Record<string, number | null>} abilityModifiers final ability modifiers
 * @returns {{ resources: DerivedClassResource[], warnings: string[] }}
 */
export function getDerivedClassResources(levels, registry, abilityModifiers) {
  /** @type {Map<string, DerivedClassResource>} */
  const byId = new Map();
  /** @type {string[]} */
  const warnings = [];

  for (const { classId, level } of getClassLevelTotals(levels)) {
    const classEntry = getClassEntry(registry, classId);
    if (!classEntry) continue; // deriveCharacter already warns about unknown classes
    const { definitions, warnings: definitionWarnings } = getClassResourceDefinitions(classEntry);
    warnings.push(...definitionWarnings);
    for (const definition of definitions) {
      const state = resolveMaxAtLevel(definition.max, level, abilityModifiers);
      if (!state.active) continue;
      const recovery = resolveRecoveryAtLevel(definition.recovery, level);
      const existing = byId.get(definition.id);
      if (!existing) {
        byId.set(definition.id, {
          id: definition.id,
          name: definition.name,
          max: state.max,
          unlimited: state.unlimited,
          recovery,
          classIds: [classId]
        });
        continue;
      }
      existing.unlimited = existing.unlimited || state.unlimited;
      if (existing.unlimited) {
        existing.max = null;
      } else if (state.max != null) {
        existing.max = existing.max == null ? state.max : Math.max(existing.max, state.max);
      }
      if ((RECOVERY_RANK[recovery] ?? 0) > (RECOVERY_RANK[existing.recovery] ?? 0)) {
        existing.recovery = recovery;
      }
      if (!existing.classIds.includes(classId)) existing.classIds.push(classId);
    }
  }

  return { resources: [...byId.values()], warnings };
}
