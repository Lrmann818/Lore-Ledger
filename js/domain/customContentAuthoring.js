// @ts-check
// Custom-content authoring: pure draft → canonical-record normalization for
// the in-app editor (Data & Settings → Custom Content).
//
// A draft holds form-native values (strings, booleans, string arrays) so UI
// code never assembles registry records by hand. Normalization produces a
// record in exactly the shape the import path accepts, and final validation
// is delegated to validateCustomContentRecord so the editor and the JSON
// import flow can never disagree about what a valid record is.

import { CHARACTER_ABILITY_KEYS } from "./characterHelpers.js";
import { validateCustomContentRecord } from "./customContent.js";
import { BUILTIN_CONTENT_REGISTRY, getContentByKind } from "./rules/registry.js";

/** @typedef {import("./rules/registry.js").ContentRegistry} ContentRegistry */

/**
 * @typedef {{ field: string, message: string }} AuthoringFieldError
 *   `field` names the draft field the message belongs to; "" marks a
 *   record-level error (shown at the top of the form).
 * @typedef {{
 *   registry: ContentRegistry,
 *   existing?: Array<Record<string, unknown>>,
 *   editingId?: string | null
 * }} AuthoringContext
 *   `existing` is the current state.content.custom array; `editingId` is set
 *   when editing so the record keeps its id and skips self-collision checks.
 * @typedef {{
 *   ok: boolean,
 *   record: Record<string, unknown> | null,
 *   errors: AuthoringFieldError[],
 *   companionRecords?: Array<Record<string, unknown>>
 * }} AuthoringResult
 *   `companionRecords` are sub-records (e.g. a race's trait records) that
 *   must be upserted alongside the main record in the same save.
 */

export const SPELL_SCHOOLS = Object.freeze([
  "abjuration", "conjuration", "divination", "enchantment",
  "evocation", "illusion", "necromancy", "transmutation"
]);

export const SPELL_ATTACK_TYPES = Object.freeze(["melee", "ranged"]);

export const DAMAGE_TYPES = Object.freeze([
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder"
]);

export { CHARACTER_ABILITY_KEYS as SAVE_ABILITIES };

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
 * @returns {string[]}
 */
function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  /** @type {string[]} */
  const out = [];
  for (const entry of value) {
    const clean = cleanString(entry);
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

/**
 * Lowercase-hyphen slug from a display name (the registry id character set).
 * @param {unknown} name
 * @returns {string}
 */
export function slugifyContentName(name) {
  return cleanString(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Generates a stable id for a new record: the slugged name, suffixed with
 * -2, -3, … while it would shadow a builtin record or collide with an
 * existing custom record of the same kind. Display names are never used as
 * primary keys — the generated id is fixed at creation and immutable after.
 *
 * @param {string} kind
 * @param {unknown} name
 * @param {Array<Record<string, unknown>>} [existing]
 * @returns {string}
 */
export function generateContentId(kind, name, existing = []) {
  const base = slugifyContentName(name) || `custom-${kind}`;
  const taken = (/** @type {string} */ candidate) =>
    !!getContentByKind(BUILTIN_CONTENT_REGISTRY, kind, candidate) ||
    existing.some((record) => isPlainObject(record) && record.kind === kind && record.id === candidate);
  if (!taken(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken(candidate)) return candidate;
  }
}

/**
 * @typedef {{
 *   name: string,
 *   level: string,
 *   school: string,
 *   classIds: string[],
 *   subclassIds: string[],
 *   castingTime: string,
 *   range: string,
 *   duration: string,
 *   componentV: boolean,
 *   componentS: boolean,
 *   componentM: boolean,
 *   material: string,
 *   ritual: boolean,
 *   concentration: boolean,
 *   desc: string,
 *   higherLevel: string,
 *   attackType: string,
 *   saveAbility: string,
 *   damageType: string
 * }} SpellDraft
 */

/**
 * @returns {SpellDraft}
 */
export function createSpellDraft() {
  return {
    name: "",
    level: "",
    school: "",
    classIds: [],
    subclassIds: [],
    castingTime: "1 action",
    range: "",
    duration: "",
    componentV: true,
    componentS: false,
    componentM: false,
    material: "",
    ritual: false,
    concentration: false,
    desc: "",
    higherLevel: "",
    attackType: "",
    saveAbility: "",
    damageType: ""
  };
}

/**
 * Builds an editable draft from a persisted custom spell record.
 * @param {Record<string, unknown>} record
 * @returns {SpellDraft}
 */
export function spellDraftFromRecord(record) {
  const source = isPlainObject(record) ? record : {};
  const components = cleanStringArray(source.components);
  return {
    name: cleanString(source.name),
    level: Number.isInteger(source.level) ? String(source.level) : "",
    school: cleanString(source.school),
    classIds: cleanStringArray(source.classIds),
    subclassIds: cleanStringArray(source.subclassIds),
    castingTime: cleanString(source.castingTime),
    range: cleanString(source.range),
    duration: cleanString(source.duration),
    componentV: components.includes("V"),
    componentS: components.includes("S"),
    componentM: components.includes("M"),
    material: cleanString(source.material),
    ritual: source.ritual === true,
    concentration: source.concentration === true,
    desc: cleanString(source.desc),
    higherLevel: cleanString(source.higherLevel),
    attackType: cleanString(source.attackType),
    saveAbility: cleanString(source.saveAbility),
    damageType: cleanString(source.damageType)
  };
}

/**
 * Normalizes a spell draft into a canonical custom spell record (the exact
 * shape of game-data/srd/spells.json entries with source "custom").
 * Returns field-level errors for inline display; nothing is coerced into a
 * different meaning silently.
 *
 * @param {SpellDraft} draft
 * @param {AuthoringContext} context
 * @returns {AuthoringResult}
 */
export function normalizeSpellDraft(draft, context) {
  /** @type {AuthoringFieldError[]} */
  const errors = [];
  const existing = Array.isArray(context?.existing) ? context.existing : [];
  const editingId = cleanString(context?.editingId);

  const name = cleanString(draft?.name);
  if (!name) errors.push({ field: "name", message: "Give the spell a name." });

  const levelText = cleanString(draft?.level);
  const level = /^\d$/.test(levelText) ? Number(levelText) : NaN;
  if (!Number.isInteger(level) || level < 0 || level > 9) {
    errors.push({ field: "level", message: "Pick a spell level (Cantrip through 9th)." });
  }

  const school = cleanString(draft?.school);
  if (!SPELL_SCHOOLS.includes(school)) {
    errors.push({ field: "school", message: "Pick a school of magic." });
  }

  const castingTime = cleanString(draft?.castingTime);
  if (!castingTime) errors.push({ field: "castingTime", message: "Enter a casting time (for example: 1 action)." });
  const range = cleanString(draft?.range);
  if (!range) errors.push({ field: "range", message: "Enter a range (for example: 60 feet, Self, or Touch)." });
  const duration = cleanString(draft?.duration);
  if (!duration) errors.push({ field: "duration", message: "Enter a duration (for example: Instantaneous or 1 minute)." });

  /** @type {string[]} */
  const components = [];
  if (draft?.componentV) components.push("V");
  if (draft?.componentS) components.push("S");
  if (draft?.componentM) components.push("M");
  const material = cleanString(draft?.material);
  if (draft?.componentM && !material) {
    errors.push({ field: "material", message: "Describe the material component, or turn off the M component." });
  }

  const desc = cleanString(draft?.desc);
  if (!desc) errors.push({ field: "desc", message: "Describe what the spell does." });

  const classIds = cleanStringArray(draft?.classIds);
  for (const classId of classIds) {
    if (!getContentByKind(context?.registry, "class", classId)) {
      errors.push({ field: "classIds", message: `Unknown class "${classId}" in the class list.` });
    }
  }
  const subclassIds = cleanStringArray(draft?.subclassIds);
  for (const subclassId of subclassIds) {
    if (!getContentByKind(context?.registry, "subclass", subclassId)) {
      errors.push({ field: "subclassIds", message: `Unknown subclass "${subclassId}" in the subclass list.` });
    }
  }

  const attackType = cleanString(draft?.attackType);
  if (attackType && !SPELL_ATTACK_TYPES.includes(attackType)) {
    errors.push({ field: "attackType", message: "Attack type must be melee or ranged (or left blank)." });
  }
  const saveAbility = cleanString(draft?.saveAbility);
  if (saveAbility && !CHARACTER_ABILITY_KEYS.includes(saveAbility)) {
    errors.push({ field: "saveAbility", message: "Save ability must be one of the six abilities (or left blank)." });
  }
  const damageType = cleanString(draft?.damageType);
  if (damageType && !DAMAGE_TYPES.includes(damageType)) {
    errors.push({ field: "damageType", message: "Pick a damage type from the list (or leave it blank)." });
  }

  if (errors.length) return { ok: false, record: null, errors };

  const id = editingId || generateContentId("spell", name, existing);
  const record = {
    id,
    kind: "spell",
    name,
    source: "custom",
    level,
    school,
    classIds,
    subclassIds,
    castingTime,
    range,
    duration,
    components,
    material: draft?.componentM ? material : null,
    ritual: draft?.ritual === true,
    concentration: draft?.concentration === true,
    desc,
    higherLevel: cleanString(draft?.higherLevel) || null,
    attackType: attackType || null,
    saveAbility: saveAbility || null,
    damageType: damageType || null
  };

  return finishRecordValidation("spell", record, existing, editingId);
}

/**
 * Shared tail of every normalize*Draft: run the exact import-path validation
 * so the editor can never save what an import would reject.
 *
 * @param {string} kind
 * @param {Record<string, unknown>} record
 * @param {Array<Record<string, unknown>>} existing
 * @param {string} editingId
 * @returns {AuthoringResult}
 */
function finishRecordValidation(kind, record, existing, editingId) {
  const existingForValidation = editingId
    ? existing.filter((entry) => !(isPlainObject(entry) && entry.kind === kind && entry.id === editingId))
    : existing;
  const validation = validateCustomContentRecord(record, { existing: existingForValidation });
  if (!validation.ok) {
    return {
      ok: false,
      record: null,
      errors: validation.errors.map((message) => ({ field: "", message }))
    };
  }
  return { ok: true, record, errors: [] };
}

// --- Feats -----------------------------------------------------------------

/**
 * The closed feat `effects` vocabulary consumed by collectFeatEffects()
 * (js/domain/rules/progression.js). `needs` names the draft fields each
 * effect type reads; everything else on the row is ignored.
 * @type {ReadonlyArray<{ type: string, label: string, needs: ReadonlyArray<string> }>}
 */
export const FEAT_EFFECT_TYPES = Object.freeze([
  Object.freeze({ type: "ability_bonus", label: "Ability score bonus", needs: Object.freeze(["ability", "value"]) }),
  Object.freeze({ type: "hp_per_level_bonus", label: "Max HP bonus per level", needs: Object.freeze(["value"]) }),
  Object.freeze({ type: "speed_bonus", label: "Speed bonus (feet)", needs: Object.freeze(["value"]) }),
  Object.freeze({ type: "ac_bonus", label: "Armor Class bonus", needs: Object.freeze(["value"]) }),
  Object.freeze({ type: "initiative_bonus", label: "Initiative bonus", needs: Object.freeze(["value"]) }),
  Object.freeze({ type: "save_proficiency", label: "Saving throw proficiency", needs: Object.freeze(["ability"]) }),
  Object.freeze({ type: "skill_proficiency", label: "Skill proficiency", needs: Object.freeze(["skill"]) })
]);

/**
 * @typedef {{ ability: string, minimum: string }} FeatPrerequisiteDraftRow
 * @typedef {{ type: string, value: string, ability: string, skill: string }} FeatEffectDraftRow
 * @typedef {{
 *   name: string,
 *   desc: string,
 *   prerequisites: FeatPrerequisiteDraftRow[],
 *   effects: FeatEffectDraftRow[]
 * }} FeatDraft
 */

/**
 * @returns {FeatDraft}
 */
export function createFeatDraft() {
  return { name: "", desc: "", prerequisites: [], effects: [] };
}

/**
 * @param {Record<string, unknown>} record
 * @returns {FeatDraft}
 */
export function featDraftFromRecord(record) {
  const source = isPlainObject(record) ? record : {};
  /** @type {FeatPrerequisiteDraftRow[]} */
  const prerequisites = [];
  for (const entry of Array.isArray(source.prerequisites) ? source.prerequisites : []) {
    if (!isPlainObject(entry)) continue;
    prerequisites.push({
      ability: cleanString(entry.ability),
      minimum: Number.isFinite(entry.minimum) ? String(entry.minimum) : ""
    });
  }
  /** @type {FeatEffectDraftRow[]} */
  const effects = [];
  for (const entry of Array.isArray(source.effects) ? source.effects : []) {
    if (!isPlainObject(entry)) continue;
    effects.push({
      type: cleanString(entry.type),
      value: Number.isFinite(entry.value) ? String(entry.value) : "",
      ability: cleanString(entry.ability),
      skill: cleanString(entry.skill)
    });
  }
  return {
    name: cleanString(source.name),
    desc: cleanString(source.desc),
    prerequisites,
    effects
  };
}

/**
 * Normalizes a feat draft into a canonical custom feat record (the shape of
 * game-data/srd/feats.json entries with source "custom"). Effect rows keep
 * only the fields their type consumes.
 *
 * @param {FeatDraft} draft
 * @param {AuthoringContext} context
 * @returns {AuthoringResult}
 */
export function normalizeFeatDraft(draft, context) {
  /** @type {AuthoringFieldError[]} */
  const errors = [];
  const existing = Array.isArray(context?.existing) ? context.existing : [];
  const editingId = cleanString(context?.editingId);

  const name = cleanString(draft?.name);
  if (!name) errors.push({ field: "name", message: "Give the feat a name." });
  const desc = cleanString(draft?.desc);
  if (!desc) errors.push({ field: "desc", message: "Describe what the feat does." });

  /** @type {Array<{ ability: string, minimum: number }>} */
  const prerequisites = [];
  const prereqRows = Array.isArray(draft?.prerequisites) ? draft.prerequisites : [];
  prereqRows.forEach((row, index) => {
    const label = `Prerequisite ${index + 1}`;
    const ability = cleanString(row?.ability);
    const minimumText = cleanString(row?.minimum);
    const minimum = /^\d{1,2}$/.test(minimumText) ? Number(minimumText) : NaN;
    if (!CHARACTER_ABILITY_KEYS.includes(ability)) {
      errors.push({ field: "prerequisites", message: `${label}: pick an ability.` });
      return;
    }
    if (!Number.isInteger(minimum) || minimum < 1 || minimum > 30) {
      errors.push({ field: "prerequisites", message: `${label}: enter a minimum score from 1 to 30.` });
      return;
    }
    prerequisites.push({ ability, minimum });
  });

  /** @type {Array<Record<string, unknown>>} */
  const effects = [];
  const effectRows = Array.isArray(draft?.effects) ? draft.effects : [];
  effectRows.forEach((row, index) => {
    const label = `Effect ${index + 1}`;
    const spec = FEAT_EFFECT_TYPES.find((candidate) => candidate.type === cleanString(row?.type));
    if (!spec) {
      errors.push({ field: "effects", message: `${label}: pick what the effect changes.` });
      return;
    }
    /** @type {Record<string, unknown>} */
    const effect = { type: spec.type };
    let rowOk = true;
    if (spec.needs.includes("ability")) {
      const ability = cleanString(row?.ability);
      if (!CHARACTER_ABILITY_KEYS.includes(ability)) {
        errors.push({ field: "effects", message: `${label}: pick an ability.` });
        rowOk = false;
      } else {
        effect.ability = ability;
      }
    }
    if (spec.needs.includes("skill")) {
      const skill = cleanString(row?.skill);
      if (!skill || !getContentByKind(context?.registry, "skill", skill)) {
        errors.push({ field: "effects", message: `${label}: pick a skill.` });
        rowOk = false;
      } else {
        effect.skill = skill;
      }
    }
    if (spec.needs.includes("value")) {
      const valueText = cleanString(row?.value);
      const value = /^-?\d{1,2}$/.test(valueText) ? Number(valueText) : NaN;
      if (!Number.isInteger(value) || value === 0 || value < -20 || value > 20) {
        errors.push({ field: "effects", message: `${label}: enter a non-zero whole number from -20 to 20.` });
        rowOk = false;
      } else {
        effect.value = value;
      }
    }
    if (rowOk) effects.push(effect);
  });

  if (errors.length) return { ok: false, record: null, errors };

  const id = editingId || generateContentId("feat", name, existing);
  const record = {
    id,
    kind: "feat",
    name,
    source: "custom",
    prerequisites,
    desc,
    effects
  };
  return finishRecordValidation("feat", record, existing, editingId);
}

// --- Races (with inline trait sub-records) ---------------------------------

export const RACE_SIZES = Object.freeze(["Tiny", "Small", "Medium", "Large", "Huge"]);

/**
 * @typedef {{ ability: string, bonus: string }} RaceAsiDraftRow
 * @typedef {{ id: string, name: string, description: string }} RaceTraitDraftRow
 *   `id` is "" for a not-yet-saved trait row; existing rows keep their id so
 *   editing updates the same trait record.
 * @typedef {{
 *   name: string,
 *   size: string,
 *   speed: string,
 *   lore: string,
 *   abilityScoreIncreases: RaceAsiDraftRow[],
 *   languages: string[],
 *   traits: RaceTraitDraftRow[],
 *   preservedTraitIds: string[]
 * }} RaceDraft
 *   `preservedTraitIds` carries trait references the form does not edit
 *   (builtin trait ids or unresolved references on imported races); they are
 *   kept verbatim on save so no data is silently dropped.
 */

/**
 * @returns {RaceDraft}
 */
export function createRaceDraft() {
  return {
    name: "",
    size: "Medium",
    speed: "30",
    lore: "",
    abilityScoreIncreases: [],
    languages: ["common"],
    traits: [],
    preservedTraitIds: []
  };
}

/**
 * Builds an editable draft from a persisted custom race record. Trait ids
 * that resolve to custom trait records become editable rows; everything else
 * (builtin ids, unresolved references) is preserved untouched.
 *
 * @param {Record<string, unknown>} record
 * @param {{ existing?: Array<Record<string, unknown>> }} [options]
 * @returns {RaceDraft}
 */
export function raceDraftFromRecord(record, options = {}) {
  const source = isPlainObject(record) ? record : {};
  const existing = Array.isArray(options.existing) ? options.existing : [];
  /** @type {RaceAsiDraftRow[]} */
  const abilityScoreIncreases = [];
  for (const entry of Array.isArray(source.abilityScoreIncreases) ? source.abilityScoreIncreases : []) {
    if (!isPlainObject(entry)) continue;
    abilityScoreIncreases.push({
      ability: cleanString(entry.ability),
      bonus: Number.isFinite(entry.bonus) ? String(entry.bonus) : ""
    });
  }
  /** @type {RaceTraitDraftRow[]} */
  const traits = [];
  /** @type {string[]} */
  const preservedTraitIds = [];
  for (const traitId of cleanStringArray(source.traits)) {
    const traitRecord = existing.find((entry) =>
      isPlainObject(entry) && entry.kind === "trait" && entry.id === traitId);
    if (traitRecord) {
      traits.push({
        id: traitId,
        name: cleanString(traitRecord.name),
        description: cleanString(traitRecord.description)
      });
    } else {
      preservedTraitIds.push(traitId);
    }
  }
  return {
    name: cleanString(source.name),
    size: cleanString(source.size) || "Medium",
    speed: Number.isFinite(source.speed) ? String(source.speed) : "",
    lore: cleanString(source.lore),
    abilityScoreIncreases,
    languages: cleanStringArray(source.languages),
    traits,
    preservedTraitIds
  };
}

/**
 * Normalizes a race draft into a canonical custom race record plus the
 * custom trait records its rows describe (`companionRecords`). Trait rows
 * without an id get one generated from their name, unique against builtin
 * content, existing custom content, and the other rows in this save.
 *
 * @param {RaceDraft} draft
 * @param {AuthoringContext} context
 * @returns {AuthoringResult}
 */
export function normalizeRaceDraft(draft, context) {
  /** @type {AuthoringFieldError[]} */
  const errors = [];
  const existing = Array.isArray(context?.existing) ? context.existing : [];
  const editingId = cleanString(context?.editingId);

  const name = cleanString(draft?.name);
  if (!name) errors.push({ field: "name", message: "Give the race a name." });

  const size = cleanString(draft?.size);
  if (!RACE_SIZES.includes(size)) {
    errors.push({ field: "size", message: "Pick a size category." });
  }

  const speedText = cleanString(draft?.speed);
  const speed = /^\d{1,3}$/.test(speedText) ? Number(speedText) : NaN;
  if (!Number.isInteger(speed) || speed < 5 || speed > 120) {
    errors.push({ field: "speed", message: "Enter a walking speed in feet (5 to 120)." });
  }

  /** @type {Array<{ ability: string, bonus: number }>} */
  const abilityScoreIncreases = [];
  const asiRows = Array.isArray(draft?.abilityScoreIncreases) ? draft.abilityScoreIncreases : [];
  asiRows.forEach((row, index) => {
    const label = `Ability increase ${index + 1}`;
    const ability = cleanString(row?.ability);
    const bonusText = cleanString(row?.bonus);
    const bonus = /^-?\d{1,2}$/.test(bonusText) ? Number(bonusText) : NaN;
    if (!CHARACTER_ABILITY_KEYS.includes(ability)) {
      errors.push({ field: "abilityScoreIncreases", message: `${label}: pick an ability.` });
      return;
    }
    if (!Number.isInteger(bonus) || bonus === 0 || bonus < -10 || bonus > 10) {
      errors.push({ field: "abilityScoreIncreases", message: `${label}: enter a non-zero whole number from -10 to 10.` });
      return;
    }
    abilityScoreIncreases.push({ ability, bonus });
  });

  const languages = cleanStringArray(draft?.languages);
  for (const languageId of languages) {
    if (!getContentByKind(context?.registry, "language", languageId)) {
      errors.push({ field: "languages", message: `Unknown language "${languageId}" in the language list.` });
    }
  }

  // Trait rows become companion custom trait records.
  /** @type {Array<Record<string, unknown>>} */
  const companionRecords = [];
  /** @type {string[]} */
  const traitIds = [];
  const pendingForIdGeneration = existing.slice();
  const traitRows = Array.isArray(draft?.traits) ? draft.traits : [];
  traitRows.forEach((row, index) => {
    const label = `Trait ${index + 1}`;
    const traitName = cleanString(row?.name);
    const traitDescription = cleanString(row?.description);
    if (!traitName) {
      errors.push({ field: "traits", message: `${label}: give the trait a name.` });
      return;
    }
    if (!traitDescription) {
      errors.push({ field: "traits", message: `${label}: describe what the trait does.` });
      return;
    }
    const traitId = cleanString(row?.id) || generateContentId("trait", traitName, pendingForIdGeneration);
    const traitRecord = {
      id: traitId,
      kind: "trait",
      name: traitName,
      source: "custom",
      description: traitDescription
    };
    const traitValidation = validateCustomContentRecord(traitRecord, {
      existing: pendingForIdGeneration.filter((entry) =>
        !(isPlainObject(entry) && entry.kind === "trait" && entry.id === traitId))
    });
    if (!traitValidation.ok) {
      for (const message of traitValidation.errors) {
        errors.push({ field: "traits", message: `${label}: ${message}` });
      }
      return;
    }
    companionRecords.push(traitRecord);
    traitIds.push(traitId);
    pendingForIdGeneration.push(traitRecord);
  });

  if (errors.length) return { ok: false, record: null, errors };

  const id = editingId || generateContentId("race", name, existing);
  const lore = cleanString(draft?.lore);
  const record = {
    id,
    kind: "race",
    name,
    source: "custom",
    size,
    speed,
    abilityScoreIncreases,
    traits: [...traitIds, ...cleanStringArray(draft?.preservedTraitIds)],
    subraceIds: [],
    languages,
    lore
  };
  const finished = finishRecordValidation("race", record, existing, editingId);
  if (!finished.ok) return finished;
  return { ...finished, companionRecords };
}

// --- Classes (with inline feature sub-records) ------------------------------

export const CLASS_HIT_DICE = Object.freeze(["6", "8", "10", "12"]);
export const CLASS_ARMOR_PROFICIENCIES = Object.freeze(["light", "medium", "heavy", "shield"]);
export const CLASS_WEAPON_PROFICIENCIES = Object.freeze(["simple", "martial"]);
export const CASTER_PROGRESSIONS = Object.freeze(["none", "full", "half", "pact"]);
export const PREPARATION_MODES = Object.freeze(["known", "prepared", "spellbook"]);
export const RESOURCE_RECOVERY_MODES = Object.freeze(["shortRest", "longRest", "shortOrLongRest", "manual", "none"]);
export const RESOURCE_MAX_TYPES = Object.freeze(["constant", "classLevelMultiple", "abilityModifier", "byClassLevel"]);

/**
 * Class-record fields the authoring form owns. Everything else on an
 * imported record (multiclassing, startingEquipment, choices, subclass
 * wiring, …) passes through edits verbatim so no data is silently dropped.
 */
const OWNED_CLASS_FIELDS = new Set([
  "id", "kind", "name", "source", "hitDie",
  "savingThrowProficiencies", "armorProficiencies", "weaponProficiencies", "toolProficiencies",
  "skillChoices", "asiLevels", "featuresByLevel", "spellcasting", "resources", "grantedSpells"
]);

/**
 * The standard SRD slot table for a casting progression, deep-copied from
 * the shipped class that defines it (wizard = full, paladin = half,
 * warlock = pact). Referencing shipped data keeps the tables single-sourced.
 * @param {string} progression
 * @returns {number[][] | null}
 */
export function standardSlotTable(progression) {
  const sourceClassId = progression === "full" ? "wizard"
    : progression === "half" ? "paladin"
      : progression === "pact" ? "warlock"
        : null;
  if (!sourceClassId) return null;
  const entry = getContentByKind(BUILTIN_CONTENT_REGISTRY, "class", sourceClassId);
  const spellcasting = entry && typeof entry.data?.spellcasting === "object" ? entry.data.spellcasting : null;
  const table = spellcasting && Array.isArray(/** @type {{slotsByLevel?: unknown}} */ (spellcasting).slotsByLevel)
    ? /** @type {{slotsByLevel: number[][]}} */ (spellcasting).slotsByLevel
    : null;
  return table ? JSON.parse(JSON.stringify(table)) : null;
}

/**
 * Parses a comma-separated list of per-class-level whole numbers, padding to
 * 20 entries by repeating the last value (a documented authoring
 * convenience — "3, 4" means 3 at level 1 and 4 from level 2 on).
 * @param {string} text
 * @param {{ allowUnlimited?: boolean }} [options]
 * @returns {{ values: Array<number | string> | null, error: string | null }}
 */
export function parsePerLevelList(text, options = {}) {
  const clean = cleanString(text);
  if (!clean) return { values: null, error: null };
  /** @type {Array<number | string>} */
  const values = [];
  for (const part of clean.split(",")) {
    const token = part.trim();
    if (options.allowUnlimited && token.toLowerCase() === "unlimited") {
      values.push("unlimited");
      continue;
    }
    if (!/^\d{1,3}$/.test(token)) {
      return { values: null, error: `"${token}" is not a whole number.` };
    }
    values.push(Number(token));
  }
  if (values.length > 20) return { values: null, error: "Enter at most 20 values (one per class level)." };
  while (values.length < 20) values.push(values[values.length - 1]);
  return { values, error: null };
}

/**
 * @typedef {{ id: string, level: string, name: string, description: string }} ClassFeatureDraftRow
 * @typedef {{
 *   name: string,
 *   maxType: string,
 *   constantValue: string,
 *   multiplier: string,
 *   ability: string,
 *   minimum: string,
 *   startLevel: string,
 *   byLevelValues: string,
 *   recovery: string
 * }} ClassResourceDraftRow
 * @typedef {{ classLevel: string, spellId: string }} ClassGrantedSpellDraftRow
 * @typedef {{
 *   name: string,
 *   hitDie: string,
 *   savingThrowProficiencies: string[],
 *   armorProficiencies: string[],
 *   weaponProficiencies: string[],
 *   toolProficiencies: string,
 *   skillChoicesCount: string,
 *   skillChoicesFrom: string[],
 *   asiLevels: string,
 *   features: ClassFeatureDraftRow[],
 *   progression: string,
 *   preparationMode: string,
 *   spellAbility: string,
 *   ritualCasting: boolean,
 *   startLevel: string,
 *   cantripsKnown: string,
 *   spellsKnown: string,
 *   resources: ClassResourceDraftRow[],
 *   grantedSpells: ClassGrantedSpellDraftRow[],
 *   preservedFeaturesByLevel: Record<string, string[]>,
 *   preservedResources: Array<Record<string, unknown>>,
 *   preservedFields: Record<string, unknown>
 * }} ClassDraft
 */

/**
 * @returns {ClassDraft}
 */
export function createClassDraft() {
  return {
    name: "",
    hitDie: "8",
    savingThrowProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: ["simple"],
    toolProficiencies: "",
    skillChoicesCount: "2",
    skillChoicesFrom: [],
    asiLevels: "4, 8, 12, 16, 19",
    features: [],
    progression: "none",
    preparationMode: "known",
    spellAbility: "",
    ritualCasting: false,
    startLevel: "1",
    cantripsKnown: "",
    spellsKnown: "",
    resources: [],
    grantedSpells: [],
    preservedFeaturesByLevel: {},
    preservedResources: [],
    preservedFields: {}
  };
}

/**
 * @param {unknown} resource
 * @returns {ClassResourceDraftRow | null} null when the resource cannot be
 *   represented by the form (e.g. threshold recovery arrays)
 */
function resourceRowFromRecord(resource) {
  if (!isPlainObject(resource)) return null;
  const max = isPlainObject(resource.max) ? resource.max : null;
  const recovery = typeof resource.recovery === "string" ? resource.recovery : null;
  if (!max || !recovery || !RESOURCE_RECOVERY_MODES.includes(recovery)) return null;
  const maxType = cleanString(max.type);
  if (!RESOURCE_MAX_TYPES.includes(maxType)) return null;
  const row = {
    name: cleanString(resource.name),
    maxType,
    constantValue: Number.isFinite(max.value) ? String(max.value) : "",
    multiplier: Number.isFinite(max.multiplier) ? String(max.multiplier) : "",
    ability: cleanString(max.ability),
    minimum: Number.isFinite(max.minimum) ? String(max.minimum) : "",
    startLevel: Number.isFinite(max.startLevel) ? String(max.startLevel) : "",
    byLevelValues: Array.isArray(max.values)
      ? max.values.map((value) => value == null ? "0" : String(value)).join(", ")
      : "",
    recovery
  };
  // Only unowned keys on the record body would be dropped — bail to
  // preservation if any exist.
  const extraKeys = Object.keys(resource).filter((key) => !["id", "name", "max", "recovery"].includes(key));
  if (extraKeys.length) return null;
  return row;
}

/**
 * Builds an editable draft from a persisted custom class record. Feature
 * ids that resolve to custom feature records become editable rows; other
 * feature references, unrepresentable resources, and every field the form
 * does not own are preserved verbatim.
 *
 * @param {Record<string, unknown>} record
 * @param {{ existing?: Array<Record<string, unknown>> }} [options]
 * @returns {ClassDraft}
 */
export function classDraftFromRecord(record, options = {}) {
  const source = isPlainObject(record) ? record : {};
  const existing = Array.isArray(options.existing) ? options.existing : [];
  const draft = createClassDraft();

  draft.name = cleanString(source.name);
  draft.hitDie = Number.isFinite(source.hitDie) ? String(source.hitDie) : "8";
  draft.savingThrowProficiencies = cleanStringArray(source.savingThrowProficiencies);
  draft.armorProficiencies = cleanStringArray(source.armorProficiencies);
  draft.weaponProficiencies = cleanStringArray(source.weaponProficiencies);
  draft.toolProficiencies = cleanStringArray(source.toolProficiencies).join(", ");
  const skillChoices = isPlainObject(source.skillChoices) ? source.skillChoices : null;
  draft.skillChoicesCount = Number.isFinite(skillChoices?.choose) ? String(skillChoices.choose) : "0";
  draft.skillChoicesFrom = cleanStringArray(skillChoices?.from);
  draft.asiLevels = (Array.isArray(source.asiLevels) ? source.asiLevels : [])
    .filter((level) => Number.isFinite(level)).join(", ");

  const featuresByLevel = isPlainObject(source.featuresByLevel) ? source.featuresByLevel : {};
  for (const [levelKey, ids] of Object.entries(featuresByLevel)) {
    for (const featureId of cleanStringArray(ids)) {
      const featureRecord = existing.find((entry) =>
        isPlainObject(entry) && entry.kind === "feature" && entry.id === featureId);
      if (featureRecord) {
        draft.features.push({
          id: featureId,
          level: levelKey,
          name: cleanString(featureRecord.name),
          description: cleanString(featureRecord.desc)
        });
      } else {
        (draft.preservedFeaturesByLevel[levelKey] ||= []).push(featureId);
      }
    }
  }

  const spellcasting = isPlainObject(source.spellcasting) ? source.spellcasting : null;
  if (spellcasting) {
    const progression = cleanString(spellcasting.progression);
    draft.progression = CASTER_PROGRESSIONS.includes(progression) ? progression : "full";
    const preparationMode = cleanString(spellcasting.preparationMode);
    draft.preparationMode = PREPARATION_MODES.includes(preparationMode) ? preparationMode : "known";
    draft.spellAbility = cleanString(spellcasting.ability);
    draft.ritualCasting = spellcasting.ritualCasting === true;
    draft.startLevel = Number.isFinite(spellcasting.startLevel) ? String(spellcasting.startLevel) : "1";
    draft.cantripsKnown = Array.isArray(spellcasting.cantripsKnownByLevel)
      ? spellcasting.cantripsKnownByLevel.join(", ") : "";
    draft.spellsKnown = Array.isArray(spellcasting.spellsKnownByLevel)
      ? spellcasting.spellsKnownByLevel.join(", ") : "";
  }

  for (const resource of Array.isArray(source.resources) ? source.resources : []) {
    const row = resourceRowFromRecord(resource);
    if (row) draft.resources.push(row);
    else if (isPlainObject(resource)) draft.preservedResources.push(resource);
  }

  for (const grant of Array.isArray(source.grantedSpells) ? source.grantedSpells : []) {
    if (!isPlainObject(grant)) continue;
    const classLevel = Number.isFinite(grant.classLevel) ? grant.classLevel
      : Number.isFinite(grant.level) ? grant.level : 1;
    draft.grantedSpells.push({
      classLevel: String(classLevel),
      spellId: cleanString(grant.spellId)
    });
  }

  for (const [key, value] of Object.entries(source)) {
    if (!OWNED_CLASS_FIELDS.has(key)) draft.preservedFields[key] = value;
  }
  return draft;
}

/**
 * Normalizes a class draft into a canonical custom class record plus the
 * custom feature records its rows describe (`companionRecords`). Casters get
 * the standard SRD slot table for their progression; per-level comma lists
 * pad to 20 by repeating the last value.
 *
 * @param {ClassDraft} draft
 * @param {AuthoringContext} context
 * @returns {AuthoringResult}
 */
export function normalizeClassDraft(draft, context) {
  /** @type {AuthoringFieldError[]} */
  const errors = [];
  const existing = Array.isArray(context?.existing) ? context.existing : [];
  const editingId = cleanString(context?.editingId);

  const name = cleanString(draft?.name);
  if (!name) errors.push({ field: "name", message: "Give the class a name." });

  const hitDie = CLASS_HIT_DICE.includes(cleanString(draft?.hitDie)) ? Number(draft.hitDie) : null;
  if (hitDie == null) errors.push({ field: "hitDie", message: "Pick a hit die." });

  const savingThrowProficiencies = cleanStringArray(draft?.savingThrowProficiencies)
    .filter((ability) => CHARACTER_ABILITY_KEYS.includes(ability));
  const armorProficiencies = cleanStringArray(draft?.armorProficiencies)
    .filter((value) => CLASS_ARMOR_PROFICIENCIES.includes(value));
  const weaponProficiencies = cleanStringArray(draft?.weaponProficiencies)
    .filter((value) => CLASS_WEAPON_PROFICIENCIES.includes(value));
  const toolProficiencies = cleanString(draft?.toolProficiencies)
    ? cleanString(draft.toolProficiencies).split(",").map((part) => part.trim()).filter(Boolean)
    : [];

  const skillCountText = cleanString(draft?.skillChoicesCount);
  const skillCount = /^\d{1,2}$/.test(skillCountText) ? Number(skillCountText) : NaN;
  const skillFrom = cleanStringArray(draft?.skillChoicesFrom);
  if (!Number.isInteger(skillCount) || skillCount < 0 || skillCount > 10) {
    errors.push({ field: "skillChoices", message: "Enter how many skills the class picks (0 to 10)." });
  } else if (skillCount > skillFrom.length) {
    errors.push({ field: "skillChoices", message: `The class picks ${skillCount} skills but only ${skillFrom.length} are on offer — check more skills or lower the count.` });
  }
  for (const skillId of skillFrom) {
    if (!getContentByKind(context?.registry, "skill", skillId)) {
      errors.push({ field: "skillChoices", message: `Unknown skill "${skillId}" in the skill list.` });
    }
  }

  /** @type {number[]} */
  const asiLevels = [];
  const asiText = cleanString(draft?.asiLevels);
  if (asiText) {
    for (const part of asiText.split(",")) {
      const token = part.trim();
      if (!token) continue;
      if (!/^\d{1,2}$/.test(token) || Number(token) < 2 || Number(token) > 20) {
        errors.push({ field: "asiLevels", message: `ASI level "${token}" must be a class level from 2 to 20.` });
        continue;
      }
      const level = Number(token);
      if (!asiLevels.includes(level)) asiLevels.push(level);
    }
    asiLevels.sort((a, b) => a - b);
  }

  const id = editingId || generateContentId("class", name, existing);

  // Feature rows become companion custom feature records tied to this class.
  /** @type {Array<Record<string, unknown>>} */
  const companionRecords = [];
  /** @type {Record<string, string[]>} */
  const featuresByLevel = {};
  for (const [levelKey, ids] of Object.entries(
    isPlainObject(draft?.preservedFeaturesByLevel) ? draft.preservedFeaturesByLevel : {}
  )) {
    featuresByLevel[levelKey] = cleanStringArray(ids);
  }
  const pendingForIdGeneration = existing.slice();
  const featureRows = Array.isArray(draft?.features) ? draft.features : [];
  featureRows.forEach((row, index) => {
    const label = `Feature ${index + 1}`;
    const featureName = cleanString(row?.name);
    const featureDescription = cleanString(row?.description);
    const levelText = cleanString(row?.level);
    const level = /^\d{1,2}$/.test(levelText) ? Number(levelText) : NaN;
    if (!Number.isInteger(level) || level < 1 || level > 20) {
      errors.push({ field: "features", message: `${label}: enter the class level (1 to 20) that grants it.` });
      return;
    }
    if (!featureName) {
      errors.push({ field: "features", message: `${label}: give the feature a name.` });
      return;
    }
    if (!featureDescription) {
      errors.push({ field: "features", message: `${label}: describe what the feature does.` });
      return;
    }
    const featureId = cleanString(row?.id) || generateContentId("feature", featureName, pendingForIdGeneration);
    const featureRecord = {
      id: featureId,
      kind: "feature",
      name: featureName,
      source: "custom",
      classId: id,
      subclassId: null,
      level,
      desc: featureDescription
    };
    const featureValidation = validateCustomContentRecord(featureRecord, {
      existing: pendingForIdGeneration.filter((entry) =>
        !(isPlainObject(entry) && entry.kind === "feature" && entry.id === featureId))
    });
    if (!featureValidation.ok) {
      for (const message of featureValidation.errors) {
        errors.push({ field: "features", message: `${label}: ${message}` });
      }
      return;
    }
    companionRecords.push(featureRecord);
    (featuresByLevel[String(level)] ||= []).push(featureId);
    pendingForIdGeneration.push(featureRecord);
  });

  // Spellcasting.
  const progression = cleanString(draft?.progression) || "none";
  if (!CASTER_PROGRESSIONS.includes(progression)) {
    errors.push({ field: "progression", message: "Pick a casting progression." });
  }
  /** @type {Record<string, unknown> | null} */
  let spellcasting = null;
  if (progression !== "none" && CASTER_PROGRESSIONS.includes(progression)) {
    const errorsBeforeCasting = errors.length;
    const ability = cleanString(draft?.spellAbility);
    if (!CHARACTER_ABILITY_KEYS.includes(ability)) {
      errors.push({ field: "spellAbility", message: "Pick the spellcasting ability." });
    }
    const preparationMode = cleanString(draft?.preparationMode);
    if (!PREPARATION_MODES.includes(preparationMode)) {
      errors.push({ field: "preparationMode", message: "Pick how the class prepares or knows spells." });
    }
    const startLevelText = cleanString(draft?.startLevel) || "1";
    const startLevel = /^\d{1,2}$/.test(startLevelText) ? Number(startLevelText) : NaN;
    if (!Number.isInteger(startLevel) || startLevel < 1 || startLevel > 20) {
      errors.push({ field: "startLevel", message: "Enter the class level casting starts at (1 to 20)." });
    }
    const cantrips = parsePerLevelList(draft?.cantripsKnown ?? "");
    if (cantrips.error) errors.push({ field: "cantripsKnown", message: `Cantrips known: ${cantrips.error}` });
    const known = parsePerLevelList(draft?.spellsKnown ?? "");
    if (known.error) errors.push({ field: "spellsKnown", message: `Spells known: ${known.error}` });
    if (preparationMode === "known" && !known.values && !known.error) {
      errors.push({ field: "spellsKnown", message: "A known-spells caster needs a spells-known count per level (for example: 2, 3, 4)." });
    }
    if (errors.length === errorsBeforeCasting) {
      spellcasting = {
        ability,
        startLevel,
        preparationMode,
        progression,
        ritualCasting: draft?.ritualCasting === true,
        cantripsKnownByLevel: cantrips.values,
        spellsKnownByLevel: known.values,
        slotsByLevel: standardSlotTable(progression)
      };
    }
  }

  // Resource rows (the Class Resources schema).
  /** @type {Array<Record<string, unknown>>} */
  const resources = [];
  const resourceRows = Array.isArray(draft?.resources) ? draft.resources : [];
  /** @type {string[]} */
  const resourceIds = [];
  resourceRows.forEach((row, index) => {
    const label = `Resource ${index + 1}`;
    const resourceName = cleanString(row?.name);
    if (!resourceName) {
      errors.push({ field: "resources", message: `${label}: give the pool a name.` });
      return;
    }
    const recovery = cleanString(row?.recovery);
    if (!RESOURCE_RECOVERY_MODES.includes(recovery)) {
      errors.push({ field: "resources", message: `${label}: pick how the pool recovers.` });
      return;
    }
    const maxType = cleanString(row?.maxType);
    const startLevelText = cleanString(row?.startLevel) || "1";
    const startLevel = /^\d{1,2}$/.test(startLevelText) ? Number(startLevelText) : NaN;
    if (!Number.isInteger(startLevel) || startLevel < 1 || startLevel > 20) {
      errors.push({ field: "resources", message: `${label}: enter the class level the pool unlocks at (1 to 20).` });
      return;
    }
    /** @type {Record<string, unknown> | null} */
    let max = null;
    if (maxType === "constant") {
      const value = /^\d{1,3}$/.test(cleanString(row?.constantValue)) ? Number(row.constantValue) : NaN;
      if (!Number.isInteger(value) || value < 1) {
        errors.push({ field: "resources", message: `${label}: enter how many uses the pool has.` });
        return;
      }
      max = { type: "constant", value, startLevel };
    } else if (maxType === "classLevelMultiple") {
      const multiplier = /^\d{1,3}$/.test(cleanString(row?.multiplier)) ? Number(row.multiplier) : NaN;
      if (!Number.isInteger(multiplier) || multiplier < 1) {
        errors.push({ field: "resources", message: `${label}: enter the per-level multiplier (Lay on Hands uses 5).` });
        return;
      }
      max = { type: "classLevelMultiple", multiplier, startLevel };
    } else if (maxType === "abilityModifier") {
      const ability = cleanString(row?.ability);
      if (!CHARACTER_ABILITY_KEYS.includes(ability)) {
        errors.push({ field: "resources", message: `${label}: pick the ability whose modifier sets the maximum.` });
        return;
      }
      const minimumText = cleanString(row?.minimum);
      const minimum = minimumText ? (/^\d{1,2}$/.test(minimumText) ? Number(minimumText) : NaN) : null;
      if (minimum !== null && !Number.isInteger(minimum)) {
        errors.push({ field: "resources", message: `${label}: the minimum must be a whole number.` });
        return;
      }
      max = { type: "abilityModifier", ability, startLevel, ...(minimum !== null ? { minimum } : {}) };
    } else if (maxType === "byClassLevel") {
      const parsed = parsePerLevelList(row?.byLevelValues ?? "", { allowUnlimited: true });
      if (parsed.error || !parsed.values) {
        errors.push({ field: "resources", message: `${label}: ${parsed.error || "enter the per-level maximums (for example: 2, 2, 3)."}` });
        return;
      }
      max = { type: "byClassLevel", values: parsed.values };
    } else {
      errors.push({ field: "resources", message: `${label}: pick how the maximum is calculated.` });
      return;
    }
    const baseResourceId = slugifyContentName(resourceName) || `pool-${index + 1}`;
    const resourceId = resourceIds.includes(baseResourceId) ? `${baseResourceId}-${index + 1}` : baseResourceId;
    resourceIds.push(resourceId);
    resources.push({ id: resourceId, name: resourceName, max, recovery });
  });

  // Granted spells.
  /** @type {Array<Record<string, unknown>>} */
  const grantedSpells = [];
  const grantRows = Array.isArray(draft?.grantedSpells) ? draft.grantedSpells : [];
  grantRows.forEach((row, index) => {
    const label = `Granted spell ${index + 1}`;
    const spellId = cleanString(row?.spellId);
    if (!spellId || !getContentByKind(context?.registry, "spell", spellId)) {
      errors.push({ field: "grantedSpells", message: `${label}: pick a spell.` });
      return;
    }
    const levelText = cleanString(row?.classLevel) || "1";
    const classLevel = /^\d{1,2}$/.test(levelText) ? Number(levelText) : NaN;
    if (!Number.isInteger(classLevel) || classLevel < 1 || classLevel > 20) {
      errors.push({ field: "grantedSpells", message: `${label}: enter the class level it unlocks at (1 to 20).` });
      return;
    }
    grantedSpells.push({ classLevel, spellId, grantType: "always_prepared" });
  });

  if (errors.length) return { ok: false, record: null, errors };

  const preservedResources = Array.isArray(draft?.preservedResources)
    ? draft.preservedResources.filter(isPlainObject)
    : [];
  const allResources = [...resources, ...preservedResources];
  const preservedFields = isPlainObject(draft?.preservedFields) ? draft.preservedFields : {};

  /** @type {Record<string, unknown>} */
  const record = {
    ...preservedFields,
    id,
    kind: "class",
    name,
    source: "custom",
    hitDie,
    savingThrowProficiencies,
    armorProficiencies,
    weaponProficiencies,
    toolProficiencies,
    skillChoices: { choose: Number.isInteger(skillCount) ? skillCount : 0, from: skillFrom },
    asiLevels,
    featuresByLevel,
    ...(spellcasting ? { spellcasting } : {}),
    ...(allResources.length ? { resources: allResources } : {}),
    ...(grantedSpells.length ? { grantedSpells } : {})
  };
  if (!("subclassIds" in record)) record.subclassIds = [];
  const finished = finishRecordValidation("class", record, existing, editingId);
  if (!finished.ok) return finished;
  return { ...finished, companionRecords };
}

/**
 * Feature records that were referenced by the class before an edit but no
 * longer are — removable only when they are custom feature records no other
 * custom class/subclass still references.
 *
 * @param {Record<string, unknown> | null} previousRecord
 * @param {Record<string, unknown>} nextRecord
 * @param {Array<Record<string, unknown>>} existing
 * @returns {string[]}
 */
export function collectOrphanedFeatureIds(previousRecord, nextRecord, existing) {
  if (!isPlainObject(previousRecord)) return [];
  const collectIds = (/** @type {unknown} */ byLevel) => {
    /** @type {string[]} */
    const ids = [];
    if (!isPlainObject(byLevel)) return ids;
    for (const value of Object.values(byLevel)) ids.push(...cleanStringArray(value));
    return ids;
  };
  const before = collectIds(previousRecord.featuresByLevel);
  const after = new Set(collectIds(nextRecord?.featuresByLevel));
  return before.filter((featureId) => {
    if (after.has(featureId)) return false;
    const isCustomFeature = existing.some((entry) =>
      isPlainObject(entry) && entry.kind === "feature" && entry.id === featureId);
    if (!isCustomFeature) return false;
    const stillReferenced = existing.some((entry) => {
      if (!isPlainObject(entry)) return false;
      if (entry.kind !== "class" && entry.kind !== "subclass") return false;
      if (entry.kind === previousRecord.kind && entry.id === previousRecord.id) return false;
      return collectIds(entry.featuresByLevel).includes(featureId);
    });
    return !stillReferenced;
  });
}

/**
 * Trait records that were referenced by the race before an edit but no
 * longer are — removable only when they are custom trait records that no
 * other custom race/subrace still references.
 *
 * @param {Record<string, unknown> | null} previousRecord
 * @param {Record<string, unknown>} nextRecord
 * @param {Array<Record<string, unknown>>} existing
 * @returns {string[]}
 */
export function collectOrphanedTraitIds(previousRecord, nextRecord, existing) {
  if (!isPlainObject(previousRecord)) return [];
  const before = cleanStringArray(previousRecord.traits);
  const after = new Set(cleanStringArray(nextRecord?.traits));
  return before.filter((traitId) => {
    if (after.has(traitId)) return false;
    const isCustomTrait = existing.some((entry) =>
      isPlainObject(entry) && entry.kind === "trait" && entry.id === traitId);
    if (!isCustomTrait) return false;
    const stillReferenced = existing.some((entry) => {
      if (!isPlainObject(entry)) return false;
      if (entry.kind !== "race" && entry.kind !== "subrace") return false;
      if (entry.kind === previousRecord.kind && entry.id === previousRecord.id) return false;
      return cleanStringArray(entry.traits).includes(traitId);
    });
    return !stillReferenced;
  });
}
