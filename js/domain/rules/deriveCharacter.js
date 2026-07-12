// @ts-check
// Pure character derivation. Freeform characters keep their manual sheet
// semantics; builder characters derive from build choices + registry data.
//
// The return shape is a stable contract consumed by the character panels
// (vitals, abilities, basics, builder summary) — existing fields keep their
// semantics; multiclass-era additions extend the shape.

import { CHARACTER_ABILITY_KEYS, isBuilderCharacter, normalizeCharacterOverrides } from "../characterHelpers.js";
import { getActiveContentRegistry, getContentById, getContentByKind, listContentByKind } from "./registry.js";
import { getDerivedClassResources } from "./classResources.js";
import {
  collectAsiChoices,
  collectFeatEffects,
  computeArmorClass,
  computeMaxHp,
  EXPERTISE_FEATURE_IDS,
  featureChoiceId,
  flattenChoices,
  getBuildFeatures,
  getClassLevelTotals,
  getCombinedSpellSlots,
  getGrantedSpells,
  getHitDicePools,
  getSavingThrowProficiencies,
  getSpellcastingClasses,
  getTotalLevel,
  normalizeBuildLevels
} from "./progression.js";

/** @typedef {import("../../state.js").CharacterEntry} CharacterEntry */
/** @typedef {import("./registry.js").ContentRegistry} ContentRegistry */
/** @typedef {import("./builtinContent.js").BuiltinContentEntry} BuiltinContentEntry */

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
 *   useTracking?: {
 *     label: string,
 *     max: number,
 *     recovery: "shortOrLongRest"
 *   },
 *   description: string
 * }} DerivedFeatureAction
 *
 * @typedef {{
 *   classId: string,
 *   className: string,
 *   classLevel: number,
 *   ability: string,
 *   abilityModifier: number | null,
 *   saveDc: number | null,
 *   attackBonus: number | null,
 *   preparationMode: string,
 *   progression: string,
 *   ritualCasting: boolean,
 *   cantripsKnownMax: number | null,
 *   spellsKnownMax: number | null,
 *   preparedMax: number | null
 * }} DerivedSpellcastingClass
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

// Sheet skill keys ↔ registry skill ids differ for three entries.
const SHEET_KEY_BY_SKILL_ID = Object.freeze({
  "animal-handling": "animal",
  "sleight-of-hand": "sleight"
});

/**
 * @param {string} skillId
 * @returns {string}
 */
function sheetKeyForSkillId(skillId) {
  return SHEET_KEY_BY_SKILL_ID[/** @type {keyof typeof SHEET_KEY_BY_SKILL_ID} */ (skillId)] || skillId;
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
 * Kind-aware content lookup that also accepts legacy `kind_id` style ids
 * from the pre-renumber builder foundation ("class_fighter" → "fighter").
 * @param {ContentRegistry} registry
 * @param {"race" | "subrace" | "class" | "background" | "subclass" | "feat" | "armor" | "weapon" | "spell"} kind
 * @param {unknown} id
 * @returns {BuiltinContentEntry | null}
 */
export function getContentByFlexibleId(registry, kind, id) {
  const normalizedId = cleanString(id);
  if (!normalizedId) return null;
  const direct = getContentByKind(registry, kind, normalizedId);
  if (direct) return direct;
  const legacyPrefix = `${kind}_`;
  if (normalizedId.startsWith(legacyPrefix)) {
    return getContentByKind(registry, kind, normalizedId.slice(legacyPrefix.length));
  }
  return null;
}

/**
 * @param {Record<string, unknown>} build
 * @param {"race" | "class" | "background" | "subrace"} kind
 * @returns {string}
 */
function getBuildContentId(build, kind) {
  const byKind = cleanString(build[`${kind}Id`]);
  if (byKind) return byKind;
  return cleanString(build[kind]);
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
 * Reads the choice values (arrays supported) stored for a data-defined
 * choice (race/background languages, ancestry, class skills, …).
 * @param {Record<string, unknown>} flatChoices
 * @param {string} choiceId
 * @returns {string[]}
 */
function readChoiceValues(flatChoices, choiceId) {
  const value = flatChoices[choiceId];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.map(cleanString).filter(Boolean);
  return [];
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
 *   passivePerception: number | null,
 *   classLevels: Array<{ classId: string, className: string, level: number, subclassId: string | null, subclassName: string | null }>,
 *   totalLevel: number | null,
 *   hp: { max: number | null, breakdown: ReturnType<typeof computeMaxHp>["breakdown"] } | null,
 *   hitDice: Array<{ classId: string, die: number | null, count: number }>,
 *   ac: { value: number | null, formula: string } | null,
 *   speed: number | null,
 *   spellcasting: {
 *     classes: DerivedSpellcastingClass[],
 *     slots: number[],
 *     casterLevel: number,
 *     pact: { slots: number, slotLevel: number } | null,
 *     primary: DerivedSpellcastingClass | null
 *   } | null,
 *   features: Array<{ featureId: string, name: string, desc: string, classId: string, subclassId: string | null, classLevel: number, characterLevel: number, replacedBy: string[] | null }>,
 *   proficiencies: { armor: string[], weapons: string[], tools: string[], languages: string[], savingThrows: string[], skills: string[], expertise: string[] },
 *   featIds: string[],
 *   grantedSpells: Array<{ spellId: string, classId: string, subclassId: string, grantType: string }>,
 *   dragonbornAncestry: DragonbornAncestryDerived | null,
 *   derivedFeatureActions: DerivedFeatureAction[],
 *   derivedResources: import("./classResources.js").DerivedClassResource[],
 *   warnings: string[]
 * }}
 */
export function deriveCharacter(character, registry = getActiveContentRegistry()) {
  const source = isPlainObject(character) ? character : {};
  const build = isBuilderCharacter(source) ? /** @type {Record<string, unknown>} */ (source.build) : null;
  const mode = build ? "builder" : "freeform";
  const overrides = normalizeCharacterOverrides(source.overrides);
  /** @type {string[]} */
  const warnings = [];

  const raceId = build ? getBuildContentId(build, "race") : "";
  const subraceId = build ? getBuildContentId(build, "subrace") : "";
  const backgroundId = build ? getBuildContentId(build, "background") : "";
  const raceEntry = build ? getContentByFlexibleId(registry, "race", raceId) : null;
  const subraceEntry = build ? getContentByFlexibleId(registry, "subrace", subraceId) : null;
  const backgroundEntry = build ? getContentByFlexibleId(registry, "background", backgroundId) : null;

  if (build && raceId && !raceEntry) warnings.push(`Unknown race content: ${raceId}`);
  if (build && subraceId && !subraceEntry) warnings.push(`Unknown subrace content: ${subraceId}`);
  if (build && backgroundId && !backgroundEntry) warnings.push(`Unknown background content: ${backgroundId}`);

  const levels = build ? normalizeBuildLevels(build) : [];
  const subclassByClass = build && isPlainObject(build.subclassByClass)
    ? /** @type {Record<string, string>} */ (build.subclassByClass)
    : {};
  const flatChoices = build ? flattenChoices(build.choicesByLevel) : {};

  // Legacy compatibility: a v1 build with classId+level and no levels array
  // still derives through normalizeBuildLevels' fallback.
  const legacyClassId = build ? getBuildContentId(build, "class") : "";

  // A build with no class levels and no legacy level field is still a level
  // 1 character (v2 default build before classes are chosen). An explicit but
  // malformed legacy level stays null and warns below.
  const totalLevel = build
    ? (levels.length
      ? getTotalLevel(levels)
      : (build.level === undefined ? 1 : normalizeLevel(build.level)))
    : null;
  const level = build
    ? totalLevel
    : normalizeLevel(source.level ?? source.characterLevel);
  if (build && level == null) warnings.push("Missing or malformed builder level");
  const proficiencyBonus = build
    ? proficiencyBonusForLevel(level)
    : finiteNumberOrNull(source.proficiency);

  // ---- class level totals ----
  /** @type {ReturnType<typeof deriveCharacter>["classLevels"]} */
  const classLevels = [];
  if (build) {
    for (const { classId, level: classLevel } of getClassLevelTotals(levels)) {
      const classEntry = getContentByFlexibleId(registry, "class", classId);
      if (!classEntry) warnings.push(`Unknown class content: ${classId}`);
      const subclassId = cleanString(subclassByClass[classId]) || null;
      const subclassEntry = subclassId ? getContentByFlexibleId(registry, "subclass", subclassId) : null;
      if (subclassId && !subclassEntry) warnings.push(`Unknown subclass content: ${subclassId}`);
      classLevels.push({
        classId,
        className: classEntry?.name || "",
        level: classLevel,
        subclassId,
        subclassName: subclassEntry?.name || null
      });
    }
  }
  const primaryClassEntry = build
    ? (classLevels.length
      ? getContentByFlexibleId(registry, "class", classLevels[0].classId)
      : (legacyClassId ? getContentByFlexibleId(registry, "class", legacyClassId) : null))
    : null;
  if (build && !classLevels.length && legacyClassId && !primaryClassEntry) {
    warnings.push(`Unknown class content: ${legacyClassId}`);
  }

  // ---- feats (ASI slots + custom feat effects) ----
  const { abilityIncreases, featIds } = build
    ? collectAsiChoices(flatChoices)
    : { abilityIncreases: {}, featIds: [] };
  /** @type {BuiltinContentEntry[]} */
  const featEntries = [];
  for (const featId of featIds) {
    const featEntry = getContentByFlexibleId(registry, "feat", featId);
    if (featEntry) featEntries.push(featEntry);
    else warnings.push(`Unknown feat content: ${featId}`);
  }
  const featEffects = collectFeatEffects(featEntries);

  // ---- race ability bonuses (race + subrace) ----
  /** @type {Record<string, number>} */
  const raceAbilityBonuses = {};
  for (const key of CHARACTER_ABILITY_KEYS) raceAbilityBonuses[key] = 0;
  if (build) {
    for (const entrySource of [raceEntry, subraceEntry]) {
      if (!entrySource || !Array.isArray(entrySource.data?.abilityScoreIncreases)) continue;
      for (const entry of entrySource.data.abilityScoreIncreases) {
        if (!isPlainObject(entry)) continue;
        const key = cleanString(entry.ability);
        if (!CHARACTER_ABILITY_KEYS.includes(/** @type {typeof CHARACTER_ABILITY_KEYS[number]} */ (key))) continue;
        raceAbilityBonuses[key] += finiteNumberOrZero(entry.bonus);
      }
    }
  }

  // ---- ability totals ----
  /** @type {ReturnType<typeof deriveCharacter>["abilities"]} */
  const abilities = {};
  for (const key of CHARACTER_ABILITY_KEYS) {
    const base = getAbilityBase(source, key, build);
    const override = finiteNumberOrZero(overrides.abilities[key]);
    const raceBonus = build ? raceAbilityBonuses[key] || 0 : 0;
    const asiBonus = build ? finiteNumberOrZero(abilityIncreases[key]) : 0;
    const featBonus = build ? finiteNumberOrZero(featEffects.abilityBonuses[key]) : 0;
    const total = base == null ? null : base + raceBonus + asiBonus + featBonus + override;
    abilities[key] = {
      base,
      override,
      total,
      modifier: abilityModifier(total)
    };
  }

  // ---- saving throws ----
  const builderSaveProfs = new Set(build ? getSavingThrowProficiencies(levels, registry) : []);
  if (build && !levels.length && primaryClassEntry) {
    const saves = primaryClassEntry.data?.savingThrowProficiencies;
    if (Array.isArray(saves)) for (const key of saves) builderSaveProfs.add(cleanString(key));
  }
  for (const key of featEffects.saveProficiencies) builderSaveProfs.add(key);
  const existingAbilities = isPlainObject(source.abilities) ? source.abilities : {};

  /** @type {ReturnType<typeof deriveCharacter>["saves"]} */
  const saves = {};
  for (const key of CHARACTER_ABILITY_KEYS) {
    const row = isPlainObject(existingAbilities[key]) ? existingAbilities[key] : {};
    const proficient = build ? builderSaveProfs.has(key) : row.saveProf === true;
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

  // ---- features (class + subclass), with subfeature choice expansion ----
  /** @type {ReturnType<typeof deriveCharacter>["features"]} */
  const features = [];
  /** @type {Set<string>} */
  const featureIdSet = new Set();
  if (build) {
    const rawFeatures = getBuildFeatures(levels, subclassByClass, registry);
    for (const raw of rawFeatures) {
      const featureEntry = getContentByKind(registry, "feature", raw.featureId);
      const subOptions = featureEntry && isPlainObject(featureEntry.data?.subfeatureOptions)
        ? featureEntry.data.subfeatureOptions
        : null;
      /** @type {string[] | null} */
      let replacedBy = null;
      if (subOptions) {
        const chosen = readChoiceValues(flatChoices, featureChoiceId(raw.featureId));
        if (chosen.length) {
          replacedBy = chosen;
          for (const chosenId of chosen) {
            const chosenEntry = getContentByKind(registry, "feature", chosenId);
            features.push({
              featureId: chosenId,
              name: chosenEntry?.name || chosenId,
              desc: cleanString(chosenEntry?.data?.desc),
              classId: raw.classId,
              subclassId: raw.subclassId,
              classLevel: raw.classLevel,
              characterLevel: raw.characterLevel,
              replacedBy: null
            });
            featureIdSet.add(chosenId);
          }
        }
      }
      features.push({
        featureId: raw.featureId,
        name: featureEntry?.name || raw.featureId,
        desc: cleanString(featureEntry?.data?.desc),
        classId: raw.classId,
        subclassId: raw.subclassId,
        classLevel: raw.classLevel,
        characterLevel: raw.characterLevel,
        replacedBy
      });
      featureIdSet.add(raw.featureId);
    }
  }

  // ---- proficiencies (armor/weapons/tools/languages/skills) ----
  /** @type {ReturnType<typeof deriveCharacter>["proficiencies"]} */
  const proficiencies = {
    armor: [],
    weapons: [],
    tools: [],
    languages: [],
    savingThrows: [...builderSaveProfs],
    skills: [],
    expertise: []
  };
  if (build) {
    /** @type {Set<string>} */
    const armorSet = new Set();
    /** @type {Set<string>} */
    const weaponSet = new Set();
    /** @type {Set<string>} */
    const toolSet = new Set();
    /** @type {Set<string>} */
    const languageSet = new Set();
    /** @type {Set<string>} */
    const skillSet = new Set();
    /** @type {Set<string>} */
    const expertiseSet = new Set();

    classLevels.forEach((info, index) => {
      const classEntry = getContentByFlexibleId(registry, "class", info.classId);
      if (!classEntry) return;
      const data = classEntry.data || {};
      if (index === 0) {
        for (const id of Array.isArray(data.armorProficiencies) ? data.armorProficiencies : []) armorSet.add(cleanString(id));
        for (const id of Array.isArray(data.weaponProficiencies) ? data.weaponProficiencies : []) weaponSet.add(cleanString(id));
        for (const id of Array.isArray(data.toolProficiencies) ? data.toolProficiencies : []) toolSet.add(cleanString(id));
        for (const skill of readChoiceValues(flatChoices, `class-skill-${info.classId}`)) skillSet.add(skill);
      } else {
        const multiclassing = isPlainObject(data.multiclassing) ? data.multiclassing : {};
        const profs = isPlainObject(multiclassing.proficiencies) ? multiclassing.proficiencies : {};
        for (const id of Array.isArray(profs.armor) ? profs.armor : []) armorSet.add(cleanString(id));
        for (const id of Array.isArray(profs.weapons) ? profs.weapons : []) weaponSet.add(cleanString(id));
        for (const id of Array.isArray(profs.tools) ? profs.tools : []) toolSet.add(cleanString(id));
        for (const skill of readChoiceValues(flatChoices, `multiclass-skill-${info.classId}`)) skillSet.add(skill);
      }
    });

    // Background skills + languages.
    if (backgroundEntry) {
      const bgSkills = backgroundEntry.data?.skillProficiencies;
      for (const skill of Array.isArray(bgSkills) ? bgSkills : []) skillSet.add(cleanString(skill));
      const bgChoices = Array.isArray(backgroundEntry.data?.choices) ? backgroundEntry.data.choices : [];
      for (const choice of bgChoices) {
        if (!isPlainObject(choice) || choice.kind !== "language") continue;
        for (const languageId of readChoiceValues(flatChoices, cleanString(choice.id))) languageSet.add(languageId);
      }
    }

    // Race languages + language choices.
    if (raceEntry) {
      const raceLanguages = raceEntry.data?.languages;
      for (const languageId of Array.isArray(raceLanguages) ? raceLanguages : []) languageSet.add(cleanString(languageId));
      const raceChoices = Array.isArray(raceEntry.data?.choices) ? raceEntry.data.choices : [];
      for (const choice of raceChoices) {
        if (!isPlainObject(choice) || choice.kind !== "language") continue;
        for (const languageId of readChoiceValues(flatChoices, cleanString(choice.id))) languageSet.add(languageId);
      }
    }

    // Feat skill proficiencies (custom feat effects).
    for (const skill of featEffects.skillProficiencies) skillSet.add(skill);

    // Expertise choices.
    for (const feature of features) {
      if (!EXPERTISE_FEATURE_IDS.has(feature.featureId)) continue;
      for (const skill of readChoiceValues(flatChoices, featureChoiceId(feature.featureId))) {
        expertiseSet.add(skill);
        skillSet.add(skill);
      }
    }

    armorSet.delete("");
    weaponSet.delete("");
    toolSet.delete("");
    languageSet.delete("");
    skillSet.delete("");
    expertiseSet.delete("");
    proficiencies.armor = [...armorSet];
    proficiencies.weapons = [...weaponSet];
    proficiencies.tools = [...toolSet];
    proficiencies.languages = [...languageSet];
    proficiencies.skills = [...skillSet];
    proficiencies.expertise = [...expertiseSet];
  }

  // ---- skills ----
  const skillsSource = isPlainObject(source.skills) ? source.skills : {};
  /** @type {ReturnType<typeof deriveCharacter>["skills"]} */
  const skills = {};
  if (build) {
    // Builder mode derives all registry skills. Sheet rows still contribute
    // their manual level and misc: the higher of the derived and manual
    // proficiency level wins, so user toggles remain a valid override path.
    const SKILL_LEVEL_RANK = { none: 0, half: 1, prof: 2, expert: 3 };
    const proficientSheetKeys = new Set(proficiencies.skills.map(sheetKeyForSkillId));
    const expertSheetKeys = new Set(proficiencies.expertise.map(sheetKeyForSkillId));
    const skillEntries = listContentByKind(registry, "skill");
    const allSkillKeys = skillEntries.length
      ? skillEntries.map((entry) => ({ key: sheetKeyForSkillId(entry.id), ability: cleanString(entry.data?.ability) }))
      : Object.entries(SKILL_ABILITY).map(([key, ability]) => ({ key, ability }));
    for (const { key, ability } of allSkillKeys) {
      const abilityKey = SKILL_ABILITY[/** @type {keyof typeof SKILL_ABILITY} */ (key)] || ability;
      const rawSkill = isPlainObject(skillsSource[key]) ? skillsSource[key] : {};
      const derivedLevel = expertSheetKeys.has(key) ? "expert" : proficientSheetKeys.has(key) ? "prof" : "none";
      const manualValue = cleanString(rawSkill.level) || (rawSkill.prof === true ? "prof" : "none");
      const manualLevel = manualValue === "half" || manualValue === "prof" || manualValue === "expert"
        ? manualValue
        : "none";
      const levelName = SKILL_LEVEL_RANK[manualLevel] > SKILL_LEVEL_RANK[derivedLevel]
        ? manualLevel
        : derivedLevel;
      const abilityMod = abilities[abilityKey]?.modifier;
      const misc = finiteNumberOrZero(rawSkill.misc);
      const override = finiteNumberOrZero(overrides.skills[key]);
      skills[key] = {
        ability: abilityKey,
        level: levelName,
        misc,
        override,
        total: abilityMod == null
          ? null
          : abilityMod + proficiencyAddForSkillLevel(levelName, proficiencyBonus ?? 0) + misc + override
      };
    }
  } else {
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
  }

  const dexMod = abilities.dex?.modifier;
  const initiative = dexMod == null
    ? null
    : dexMod + finiteNumberOrZero(overrides.initiative) + (build ? featEffects.initiativeBonus : 0);

  const perceptionRow = skills.perception;
  const passivePerception = perceptionRow?.total != null
    ? 10 + perceptionRow.total
    : (abilities.wis?.modifier != null ? 10 + abilities.wis.modifier : null);

  // ---- vitals: speed / hit dice ----
  const raceSpeed = build && raceEntry
    ? finitePositiveNumberOrNull(raceEntry.data?.speed)
    : null;
  const speed = build
    ? (raceSpeed != null ? raceSpeed + featEffects.speedBonus : null)
    : null;
  if (build && !raceId) warnings.push("Missing race content for speed");
  if (build && raceEntry && raceSpeed == null) warnings.push(`Malformed race speed content: ${raceEntry.id}`);

  const hitDice = build ? getHitDicePools(levels, registry) : [];
  const primaryHitDie = hitDice.length ? hitDice[0] : null;
  const legacyHitDieSize = build && primaryClassEntry
    ? finitePositiveNumberOrNull(primaryClassEntry.data?.hitDie)
    : null;
  if (build && !classLevels.length && !legacyClassId) warnings.push("Missing class content for hit dice");
  if (build) {
    for (const pool of hitDice) {
      if (pool.die != null) continue;
      const entry = getContentByFlexibleId(registry, "class", pool.classId);
      if (entry) warnings.push(`Malformed class hit die content: ${entry.id}`);
    }
    if (!hitDice.length && primaryClassEntry && legacyHitDieSize == null) {
      warnings.push(`Malformed class hit die content: ${primaryClassEntry.id}`);
    }
  }

  // ---- HP ----
  /** @type {ReturnType<typeof deriveCharacter>["hp"]} */
  let hp = null;
  if (build) {
    const conMod = abilities.con?.modifier ?? null;
    const result = computeMaxHp(levels, conMod, registry, { perLevelBonus: featEffects.hpPerLevelBonus });
    hp = { max: result.max, breakdown: result.breakdown };
  }

  // ---- AC ----
  /** @type {ReturnType<typeof deriveCharacter>["ac"]} */
  let ac = null;
  if (build) {
    const equipment = isPlainObject(build.equipment) ? build.equipment : {};
    const armorId = cleanString(equipment.armorId);
    const armorEntry = armorId ? getContentByFlexibleId(registry, "armor", armorId) : null;
    if (armorId && !armorEntry) warnings.push(`Unknown armor content: ${armorId}`);
    const abilityModifiers = /** @type {Record<string, number | null>} */ ({});
    for (const key of CHARACTER_ABILITY_KEYS) abilityModifiers[key] = abilities[key]?.modifier ?? null;
    const shieldEntry = getContentByKind(registry, "armor", "shield");
    ac = computeArmorClass({
      abilityModifiers,
      armorEntry,
      hasShield: equipment.shield === true,
      shieldEntry,
      featureIds: featureIdSet,
      acBonus: featEffects.acBonus
    });
  }

  // ---- spellcasting ----
  /** @type {ReturnType<typeof deriveCharacter>["spellcasting"]} */
  let spellcasting = null;
  if (build) {
    const casterInfos = getSpellcastingClasses(levels, registry);
    if (casterInfos.length) {
      const combined = getCombinedSpellSlots(levels, registry);
      /** @type {DerivedSpellcastingClass[]} */
      const classes = casterInfos.map((info) => {
        const classEntry = getContentByFlexibleId(registry, "class", info.classId);
        const abilityMod = abilities[info.ability]?.modifier ?? null;
        const saveDc = abilityMod != null && proficiencyBonus != null ? 8 + proficiencyBonus + abilityMod : null;
        const attackBonus = abilityMod != null && proficiencyBonus != null ? proficiencyBonus + abilityMod : null;
        const preparedMax = info.preparationMode === "prepared" || info.preparationMode === "spellbook"
          ? (abilityMod != null
            ? Math.max(1, (info.progression === "half" ? Math.floor(info.classLevel / 2) : info.classLevel) + abilityMod)
            : null)
          : null;
        return {
          classId: info.classId,
          className: classEntry?.name || info.classId,
          classLevel: info.classLevel,
          ability: info.ability,
          abilityModifier: abilityMod,
          saveDc,
          attackBonus,
          preparationMode: info.preparationMode,
          progression: info.progression,
          ritualCasting: info.ritualCasting,
          cantripsKnownMax: info.cantripsKnownMax,
          spellsKnownMax: info.spellsKnownMax,
          preparedMax
        };
      });
      spellcasting = {
        classes,
        slots: combined.slots,
        casterLevel: combined.casterLevel,
        pact: combined.pact,
        primary: classes[0] ?? null
      };
    }
  }

  const grantedSpells = build ? getGrantedSpells(levels, subclassByClass, registry) : [];

  // ---- class resources (shared limited-use pools) ----
  /** @type {import("./classResources.js").DerivedClassResource[]} */
  let derivedResources = [];
  if (build) {
    /** @type {Record<string, number | null>} */
    const abilityModifierLookup = {};
    for (const key of CHARACTER_ABILITY_KEYS) abilityModifierLookup[key] = abilities[key]?.modifier ?? null;
    const classResourceResult = getDerivedClassResources(levels, registry, abilityModifierLookup);
    derivedResources = classResourceResult.resources;
    warnings.push(...classResourceResult.warnings);
  }

  // ---- Dragonborn ancestry slice (kept for existing panels) ----
  /** @type {DragonbornAncestryDerived | null} */
  let dragonbornAncestry = null;
  if (build && raceEntry) {
    const raceChoices = Array.isArray(raceEntry.data?.choices) ? raceEntry.data.choices : [];
    const ancestryChoice = raceChoices.find(
      (c) => isPlainObject(c) && c.kind === "ancestry" && typeof c.id === "string"
    );
    if (ancestryChoice) {
      const choiceId = /** @type {string} */ (ancestryChoice.id);
      const ancestryId = cleanString(readChoiceValues(flatChoices, choiceId)[0]);
      if (ancestryId) {
        const ancestryEntry = getContentByKind(registry, "ancestry", ancestryId) || getContentById(registry, ancestryId);
        if (!ancestryEntry || ancestryEntry.kind !== "ancestry") {
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
      useTracking: {
        label: "Uses",
        max: 1,
        recovery: "shortOrLongRest"
      },
      description: "Each creature in the area makes the listed save. Failed save takes full damage; successful save takes half."
    });
  }

  const classLevelLabel = build
    ? classLevels.map((info) => {
      const subclassPart = info.subclassName ? ` (${info.subclassName})` : "";
      return `${info.className}${subclassPart} ${info.level}`.trim();
    }).join(" / ")
    : cleanString(source.classLevel);

  return {
    mode,
    labels: {
      classLevel: build
        ? (classLevelLabel || [primaryClassEntry?.name || "", level ? String(level) : ""].filter(Boolean).join(" "))
        : cleanString(source.classLevel),
      race: build
        ? [raceEntry?.name || "", subraceEntry ? `(${subraceEntry.name})` : ""].filter(Boolean).join(" ")
        : cleanString(source.race),
      background: build ? backgroundEntry?.name || "" : cleanString(source.background)
    },
    level,
    proficiencyBonus,
    vitals: {
      speed: build ? speed : null,
      hitDieAmt: build ? (primaryHitDie ? primaryHitDie.count : level) : null,
      hitDieSize: build ? (primaryHitDie ? primaryHitDie.die : legacyHitDieSize) : null
    },
    raceAbilityBonuses,
    abilities,
    saves,
    skills,
    initiative,
    passivePerception,
    classLevels,
    totalLevel: build ? totalLevel : null,
    hp,
    hitDice,
    ac,
    speed,
    spellcasting,
    features,
    proficiencies,
    featIds,
    grantedSpells,
    dragonbornAncestry,
    derivedFeatureActions,
    derivedResources,
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
