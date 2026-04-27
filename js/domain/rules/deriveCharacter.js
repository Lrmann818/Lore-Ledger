// @ts-check
// Pure character derivation helpers for the Step 3 rules foundation.

import { CHARACTER_ABILITY_KEYS, isBuilderCharacter, normalizeCharacterOverrides } from "../characterHelpers.js";
import { BUILTIN_CONTENT_REGISTRY, getContentById } from "./registry.js";

/** @typedef {import("../../state.js").CharacterEntry} CharacterEntry */
/** @typedef {import("./registry.js").ContentRegistry} ContentRegistry */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   damageType: string,
 *   damageResistance: string,
 *   breathWeapon: {
 *     shape: string,
 *     size: number | null,
 *     width: number | null,
 *     length: number | null,
 *     saveAbility: string,
 *     saveDC: number | null,
 *     damageDice: string
 *   }
 * }} DragonbornAncestryDerived
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   source: string,
 *   sourceDetail: string,
 *   kind: "feature-action",
 *   activation: string,
 *   saveAbility: string,
 *   saveDc: number | null,
 *   area: string,
 *   damage: string,
 *   damageType: string,
 *   recovery: string,
 *   description: string
 * }} DerivedFeatureAction
 */

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
function finitePositiveNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
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
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  let n;
  try {
    n = Number(value);
  } catch {
    return null;
  }
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
 * @param {"race" | "class" | "background"} kind
 * @returns {string}
 */
function getBuildContentId(build, kind) {
  const byKind = cleanString(build[`${kind}Id`]);
  if (byKind) return byKind;
  return cleanString(build[kind]);
}

/**
 * @param {ContentRegistry} registry
 * @param {"race" | "class" | "background"} kind
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
 * @param {number | null} level
 * @returns {string}
 */
function dragonbornBreathDamageDice(level) {
  if (level == null || level < 6) return "2d6";
  if (level < 11) return "3d6";
  if (level < 16) return "4d6";
  return "5d6";
}

/**
 * @param {string} value
 * @returns {string}
 */
function titleCaseLabel(value) {
  const text = cleanString(value);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/**
 * @param {DragonbornAncestryDerived["breathWeapon"]} breathWeapon
 * @returns {string}
 */
function formatBreathWeaponArea(breathWeapon) {
  if (breathWeapon.shape === "line" && breathWeapon.width != null && breathWeapon.length != null) {
    return `${breathWeapon.width} by ${breathWeapon.length} ft. line`;
  }
  if (breathWeapon.shape === "cone" && breathWeapon.size != null) {
    return `${breathWeapon.size} ft. cone`;
  }
  return "";
}

/**
 * @param {unknown} character
 * @param {ContentRegistry} [registry]
 * @returns {{
 *   mode: "freeform" | "builder",
 *   labels: { classLevel: string, race: string, background: string },
 *   level: number | null,
 *   proficiencyBonus: number | null,
 *   vitals: { speed: number | null, hitDieAmt: number | null, hitDieSize: number | null },
 *   raceAbilityBonuses: Record<string, number>,
 *   abilities: Record<string, { base: number | null, override: number, total: number | null, modifier: number | null }>,
 *   saves: Record<string, { proficient: boolean, misc: number, total: number | null }>,
 *   skills: Record<string, { ability: string, level: string, misc: number, override: number, total: number | null }>,
 *   initiative: number | null,
 *   dragonbornAncestry: DragonbornAncestryDerived | null,
 *   derivedFeatureActions: DerivedFeatureAction[],
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
  const raceId = build ? getBuildContentId(build, "race") : "";
  const backgroundId = build ? getBuildContentId(build, "background") : "";
  const classEntry = build ? getContentByFlexibleId(registry, "class", classId) : null;
  const raceEntry = build ? getContentByFlexibleId(registry, "race", raceId) : null;
  const backgroundEntry = build ? getContentByFlexibleId(registry, "background", backgroundId) : null;

  if (build && classId && !classEntry) warnings.push(`Unknown class content: ${classId}`);
  if (build && raceId && !raceEntry) warnings.push(`Unknown race content: ${raceId}`);
  if (build && backgroundId && !backgroundEntry) warnings.push(`Unknown background content: ${backgroundId}`);

  const level = build
    ? normalizeLevel(build.level)
    : normalizeLevel(source.level ?? source.characterLevel);
  if (build && level == null) warnings.push("Missing or malformed builder level");
  const proficiencyBonus = build
    ? proficiencyBonusForLevel(level)
    : finiteNumberOrNull(source.proficiency);

  const builderSpeed = build && raceEntry
    ? finitePositiveNumberOrNull(raceEntry.data?.speed)
    : null;
  const builderHitDieSize = build && classEntry
    ? finitePositiveNumberOrNull(classEntry.data?.hitDie)
    : null;
  if (build && !raceId) warnings.push("Missing race content for speed");
  if (build && raceEntry && builderSpeed == null) warnings.push(`Malformed race speed content: ${raceEntry.id}`);
  if (build && !classId) warnings.push("Missing class content for hit dice");
  if (build && classEntry && builderHitDieSize == null) warnings.push(`Malformed class hit die content: ${classEntry.id}`);

  /** @type {Record<string, number>} */
  const raceAbilityBonuses = {};
  for (const key of CHARACTER_ABILITY_KEYS) raceAbilityBonuses[key] = 0;
  if (build && raceEntry && Array.isArray(raceEntry.data?.abilityScoreIncreases)) {
    for (const entry of raceEntry.data.abilityScoreIncreases) {
      if (!isPlainObject(entry)) continue;
      const key = cleanString(entry.ability);
      if (!CHARACTER_ABILITY_KEYS.includes(/** @type {typeof CHARACTER_ABILITY_KEYS[number]} */ (key))) continue;
      raceAbilityBonuses[key] += finiteNumberOrZero(entry.bonus);
    }
  }

  /** @type {ReturnType<typeof deriveCharacter>["abilities"]} */
  const abilities = {};
  for (const key of CHARACTER_ABILITY_KEYS) {
    const base = getAbilityBase(source, key, build);
    const override = finiteNumberOrZero(overrides.abilities[key]);
    const raceBonus = build ? raceAbilityBonuses[key] || 0 : 0;
    const total = base == null ? null : base + raceBonus + override;
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

  /** @type {DragonbornAncestryDerived | null} */
  let dragonbornAncestry = null;
  if (build && raceEntry) {
    const raceChoices = Array.isArray(raceEntry.data?.choices) ? raceEntry.data.choices : [];
    const ancestryChoice = raceChoices.find(
      (c) => isPlainObject(c) && c.kind === "ancestry" && typeof c.id === "string"
    );
    if (ancestryChoice) {
      const choiceId = /** @type {string} */ (ancestryChoice.id);
      const choicesByLevel = isPlainObject(build.choicesByLevel) ? build.choicesByLevel : {};
      const level1Choices = isPlainObject(choicesByLevel["1"]) ? choicesByLevel["1"] : {};
      const ancestryId = cleanString(level1Choices[choiceId]);
      if (ancestryId) {
        const ancestryEntry = getContentById(registry, ancestryId);
        if (!ancestryEntry) {
          warnings.push(`Unknown ancestry content: ${ancestryId}`);
        } else {
          const data = isPlainObject(ancestryEntry.data) ? ancestryEntry.data : {};
          const damageType = cleanString(data.damageType);
          const saveAbility = cleanString(data.saveAbility);
          const breathWeaponRaw = isPlainObject(data.breathWeapon) ? data.breathWeapon : {};
          const shape = cleanString(breathWeaponRaw.shape);
          const isCone = shape === "cone";
          const isLine = shape === "line";
          const conMod = abilities.con?.modifier;
          const saveDC = conMod != null && proficiencyBonus != null
            ? 8 + conMod + proficiencyBonus
            : null;
          dragonbornAncestry = {
            id: cleanString(ancestryEntry.id),
            name: cleanString(ancestryEntry.name),
            damageType,
            damageResistance: damageType,
            breathWeapon: {
              shape,
              size: isCone ? (typeof breathWeaponRaw.size === "number" ? breathWeaponRaw.size : null) : null,
              width: isLine ? (typeof breathWeaponRaw.width === "number" ? breathWeaponRaw.width : null) : null,
              length: isLine ? (typeof breathWeaponRaw.length === "number" ? breathWeaponRaw.length : null) : null,
              saveAbility,
              saveDC,
              damageDice: dragonbornBreathDamageDice(level)
            }
          };
        }
      }
    }
  }

  /** @type {DerivedFeatureAction[]} */
  const derivedFeatureActions = [];
  if (dragonbornAncestry) {
    const breathWeapon = dragonbornAncestry.breathWeapon;
    derivedFeatureActions.push({
      id: "dragonborn-breath-weapon",
      name: "Breath Weapon",
      source: "Dragonborn",
      sourceDetail: dragonbornAncestry.name ? `${dragonbornAncestry.name} Draconic Ancestry` : "",
      kind: "feature-action",
      activation: "Action",
      saveAbility: breathWeapon.saveAbility,
      saveDc: breathWeapon.saveDC,
      area: formatBreathWeaponArea(breathWeapon),
      damage: breathWeapon.damageDice,
      damageType: titleCaseLabel(dragonbornAncestry.damageType),
      recovery: "Short or Long Rest",
      description: "Each creature in the area makes the listed save. Failed save takes full damage; successful save takes half."
    });
  }

  return {
    mode,
    labels: {
      classLevel: build
        ? [classEntry?.name || "", level ? String(level) : ""].filter(Boolean).join(" ")
        : cleanString(source.classLevel),
      race: build ? raceEntry?.name || "" : cleanString(source.race),
      background: build ? backgroundEntry?.name || "" : cleanString(source.background)
    },
    level,
    proficiencyBonus,
    vitals: {
      speed: build ? builderSpeed : null,
      hitDieAmt: build ? level : null,
      hitDieSize: build ? builderHitDieSize : null
    },
    raceAbilityBonuses,
    abilities,
    saves,
    skills,
    initiative,
    dragonbornAncestry,
    derivedFeatureActions,
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
