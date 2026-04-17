// @ts-check
// Pure character derivation helpers for the Step 3 rules foundation.

import { CHARACTER_ABILITY_KEYS, isBuilderCharacter, normalizeCharacterOverrides } from "../characterHelpers.js";
import { BUILTIN_CONTENT_REGISTRY, getContentById } from "./registry.js";

/** @typedef {import("../../state.js").CharacterEntry} CharacterEntry */
/** @typedef {import("./registry.js").ContentRegistry} ContentRegistry */

const SKILL_ABILITY = Object.freeze({
  acrobatics: "dex",
  animal: "wis",
  arcana: "int",
  athletics: "str",
  deception: "cha",
  history: "int",
  insight: "wis",
  intimidation: "cha",
  investigation: "int",
  medicine: "wis",
  nature: "int",
  perception: "wis",
  performance: "cha",
  persuasion: "cha",
  religion: "int",
  sleight: "dex",
  stealth: "dex",
  survival: "wis"
});

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
export function abilityModifier(value) {
  const score = finiteNumberOrNull(value);
  return score == null ? null : Math.floor((score - 10) / 2);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeLevel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(20, Math.trunc(n)));
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function proficiencyBonusForLevel(value) {
  const level = normalizeLevel(value);
  return level == null ? null : 2 + Math.floor((level - 1) / 4);
}

/**
 * @param {Record<string, unknown>} build
 * @param {"species" | "class" | "background"} kind
 * @returns {string}
 */
function getBuildContentId(build, kind) {
  const byKind = cleanString(build[`${kind}Id`]);
  if (byKind) return byKind;
  return cleanString(build[kind]);
}

/**
 * @param {ContentRegistry} registry
 * @param {"species" | "class" | "background"} kind
 * @param {unknown} id
 * @returns {import("./builtinContent.js").BuiltinContentEntry | null}
 */
function getContentByFlexibleId(registry, kind, id) {
  const normalizedId = cleanString(id);
  if (!normalizedId) return null;
  return getContentById(registry, normalizedId) || getContentById(registry, `${kind}_${normalizedId}`);
}

/**
 * @param {Record<string, unknown>} build
 * @returns {Record<string, unknown>}
 */
function getBuildAbilityBase(build) {
  if (isPlainObject(build.abilities) && isPlainObject(build.abilities.base)) return build.abilities.base;
  if (isPlainObject(build.abilityBase)) return build.abilityBase;
  return {};
}

/**
 * @param {Record<string, unknown>} character
 * @param {string} key
 * @param {Record<string, unknown> | null} build
 * @returns {number | null}
 */
function getAbilityBase(character, key, build) {
  if (build) return finiteNumberOrNull(getBuildAbilityBase(build)[key]);
  const abilities = isPlainObject(character.abilities) ? character.abilities : {};
  const row = isPlainObject(abilities[key]) ? abilities[key] : {};
  return finiteNumberOrNull(row.score);
}

/**
 * @param {unknown} level
 * @param {number} profBonus
 * @returns {number}
 */
function proficiencyAddForSkillLevel(level, profBonus) {
  if (level === "half") return Math.floor(profBonus / 2);
  if (level === "prof") return profBonus;
  if (level === "expert") return profBonus * 2;
  return 0;
}

/**
 * @param {Record<string, unknown>} character
 * @param {string} key
 * @param {Record<string, { modifier: number | null }>} abilities
 * @returns {number}
 */
function freeformSaveOptionsBonus(character, key, abilities) {
  const saveOptions = isPlainObject(character.saveOptions) ? character.saveOptions : {};
  const misc = isPlainObject(saveOptions.misc) ? finiteNumberOrZero(saveOptions.misc[key]) : 0;
  const modToAll = cleanString(saveOptions.modToAll);
  if (!modToAll) return misc;
  const pickedMod = abilities[modToAll]?.modifier;
  return pickedMod == null ? misc : misc + pickedMod;
}

/**
 * @param {unknown} character
 * @param {ContentRegistry} [registry]
 * @returns {{
 *   mode: "freeform" | "builder",
 *   labels: { classLevel: string, race: string, background: string },
 *   level: number | null,
 *   proficiencyBonus: number | null,
 *   abilities: Record<string, { base: number | null, override: number, total: number | null, modifier: number | null }>,
 *   saves: Record<string, { proficient: boolean, misc: number, total: number | null }>,
 *   skills: Record<string, { ability: string, level: string, misc: number, override: number, total: number | null }>,
 *   initiative: number | null,
 *   warnings: string[]
 * }}
 */
export function deriveCharacter(character, registry = BUILTIN_CONTENT_REGISTRY) {
  const source = isPlainObject(character) ? character : {};
  const build = isBuilderCharacter(source) ? /** @type {Record<string, unknown>} */ (source.build) : null;
  const mode = build ? "builder" : "freeform";
  const overrides = normalizeCharacterOverrides(source.overrides);
  /** @type {string[]} */
  const warnings = [];

  const classId = build ? getBuildContentId(build, "class") : "";
  const speciesId = build ? getBuildContentId(build, "species") : "";
  const backgroundId = build ? getBuildContentId(build, "background") : "";
  const classEntry = build ? getContentByFlexibleId(registry, "class", classId) : null;
  const speciesEntry = build ? getContentByFlexibleId(registry, "species", speciesId) : null;
  const backgroundEntry = build ? getContentByFlexibleId(registry, "background", backgroundId) : null;

  if (build && classId && !classEntry) warnings.push(`Unknown class content: ${classId}`);
  if (build && speciesId && !speciesEntry) warnings.push(`Unknown species content: ${speciesId}`);
  if (build && backgroundId && !backgroundEntry) warnings.push(`Unknown background content: ${backgroundId}`);

  const level = build
    ? normalizeLevel(build.level) ?? 1
    : normalizeLevel(source.level ?? source.characterLevel);
  const proficiencyBonus = build
    ? proficiencyBonusForLevel(level)
    : finiteNumberOrNull(source.proficiency);

  /** @type {ReturnType<typeof deriveCharacter>["abilities"]} */
  const abilities = {};
  for (const key of CHARACTER_ABILITY_KEYS) {
    const base = getAbilityBase(source, key, build);
    const override = finiteNumberOrZero(overrides.abilities[key]);
    const total = base == null && override === 0 ? null : finiteNumberOrZero(base) + override;
    abilities[key] = {
      base,
      override,
      total,
      modifier: abilityModifier(total)
    };
  }

  const classSaveProfs = new Set(
    Array.isArray(classEntry?.data?.saveProficiencies)
      ? classEntry.data.saveProficiencies.map(cleanString).filter(Boolean)
      : []
  );
  const existingAbilities = isPlainObject(source.abilities) ? source.abilities : {};

  /** @type {ReturnType<typeof deriveCharacter>["saves"]} */
  const saves = {};
  for (const key of CHARACTER_ABILITY_KEYS) {
    const row = isPlainObject(existingAbilities[key]) ? existingAbilities[key] : {};
    const proficient = build ? classSaveProfs.has(key) : row.saveProf === true;
    const modifier = abilities[key]?.modifier;
    const misc = finiteNumberOrZero(overrides.saves[key]) +
      (build ? 0 : freeformSaveOptionsBonus(source, key, abilities));
    saves[key] = {
      proficient,
      misc,
      total: modifier == null
        ? null
        : modifier + (proficient && proficiencyBonus != null ? proficiencyBonus : 0) + misc
    };
  }

  const skillsSource = isPlainObject(source.skills) ? source.skills : {};
  /** @type {ReturnType<typeof deriveCharacter>["skills"]} */
  const skills = {};
  for (const [skillKey, rawSkill] of Object.entries(skillsSource)) {
    if (!isPlainObject(rawSkill)) continue;
    const ability = SKILL_ABILITY[skillKey] || cleanString(rawSkill.ability);
    if (!ability) continue;
    const levelValue = cleanString(rawSkill.level) || (rawSkill.prof === true ? "prof" : "none");
    const levelName = levelValue === "half" || levelValue === "prof" || levelValue === "expert"
      ? levelValue
      : "none";
    const abilityMod = abilities[ability]?.modifier;
    const misc = finiteNumberOrZero(rawSkill.misc);
    const override = finiteNumberOrZero(overrides.skills[skillKey]);
    skills[skillKey] = {
      ability,
      level: levelName,
      misc,
      override,
      total: abilityMod == null
        ? null
        : abilityMod + proficiencyAddForSkillLevel(levelName, proficiencyBonus ?? 0) + misc + override
    };
  }

  const dexMod = abilities.dex?.modifier;
  const initiative = dexMod == null ? null : dexMod + finiteNumberOrZero(overrides.initiative);

  return {
    mode,
    labels: {
      classLevel: build
        ? [classEntry?.name || "", level ? String(level) : ""].filter(Boolean).join(" ")
        : cleanString(source.classLevel),
      race: build ? speciesEntry?.name || "" : cleanString(source.race),
      background: build ? backgroundEntry?.name || "" : cleanString(source.background)
    },
    level,
    proficiencyBonus,
    abilities,
    saves,
    skills,
    initiative,
    warnings
  };
}

/**
 * Returns a cloned character with derived compatibility fields applied.
 * This helper is intentionally not wired into migration or UI flows yet.
 *
 * @param {unknown} character
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @returns {Record<string, unknown>}
 */
export function materializeDerivedCharacterFields(character, derived) {
  const source = isPlainObject(character) ? character : {};
  const next = JSON.parse(JSON.stringify(source));

  if (derived.labels.classLevel) next.classLevel = derived.labels.classLevel;
  if (derived.labels.race) next.race = derived.labels.race;
  if (derived.labels.background) next.background = derived.labels.background;
  if (derived.proficiencyBonus != null) next.proficiency = derived.proficiencyBonus;
  if (derived.initiative != null) next.initiative = derived.initiative;

  if (!isPlainObject(next.abilities)) next.abilities = {};
  for (const key of CHARACTER_ABILITY_KEYS) {
    const ability = derived.abilities[key];
    if (!ability) continue;
    const row = isPlainObject(next.abilities[key]) ? next.abilities[key] : {};
    next.abilities[key] = {
      ...row,
      score: ability.total,
      mod: ability.modifier,
      save: derived.saves[key]?.total ?? null
    };
  }

  return next;
}
