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
