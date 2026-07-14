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
 *   errors: AuthoringFieldError[]
 * }} AuthoringResult
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

  const existingForValidation = editingId
    ? existing.filter((entry) => !(isPlainObject(entry) && entry.kind === "spell" && entry.id === editingId))
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
