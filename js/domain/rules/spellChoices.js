// @ts-check
// Reusable choice-based granted spells.
//
// Some race/subrace (and, in principle, class/background/feat) entries let the
// player choose a spell from a filtered list — the SRD 5.1 example is the High
// Elf wizard cantrip. Such a choice lives inline on the parent entry's
// `choices[]` array with a spell-list `kind` ("cantrip" today), a filtered
// `from` (`{ type: "list", source: "spells", filter: { classId, maxLevel } }`),
// and a `spellcastingAbility` for provenance. This module resolves the eligible
// options (for the wizard picker) and the player's stored selection into a
// granted-spell record (for derivation and seeding). It is deliberately
// generic: adding another filtered spell choice is data-only.

import { getContentByKind, listContentByKind } from "./registry.js";

/** @typedef {import("./registry.js").ContentRegistry} ContentRegistry */
/** @typedef {import("./builtinContent.js").BuiltinContentEntry} BuiltinContentEntry */

/**
 * Choice `kind` values that pick a spell from the registry. A closed set,
 * mirroring the registry-plan vocabulary; "cantrip" restricts to level-0
 * spells but the filter's `maxLevel` is authoritative.
 */
export const SPELL_CHOICE_KINDS = Object.freeze(new Set(["cantrip"]));

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
 * A choice object is a spell-list choice when its kind is in the spell-choice
 * vocabulary and it exposes a stable id.
 * @param {unknown} choice
 * @returns {choice is Record<string, unknown>}
 */
export function isSpellListChoice(choice) {
  return isPlainObject(choice) &&
    typeof choice.id === "string" &&
    SPELL_CHOICE_KINDS.has(cleanString(choice.kind));
}

/**
 * Resolves the eligible spell options for a spell-list choice's `from`.
 * Supports the filtered form (`source: "spells"` + `filter`) and a literal
 * `options` id list; returns registry spell entries, sorted by name.
 *
 * @param {ContentRegistry} registry
 * @param {unknown} from the choice's `from` descriptor
 * @returns {BuiltinContentEntry[]}
 */
export function resolveSpellChoiceOptions(registry, from) {
  const descriptor = isPlainObject(from) ? from : {};
  if (Array.isArray(descriptor.options)) {
    return descriptor.options
      .map((id) => getContentByKind(registry, "spell", cleanString(id)))
      .filter((entry) => !!entry)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  if (cleanString(descriptor.source) !== "spells") return [];
  const filter = isPlainObject(descriptor.filter) ? descriptor.filter : {};
  const classId = cleanString(filter.classId);
  const maxLevel = finiteNumberOrNull(filter.maxLevel);
  const minLevel = finiteNumberOrNull(filter.minLevel);
  const school = cleanString(filter.school);
  return listContentByKind(registry, "spell")
    .filter((entry) => {
      const data = isPlainObject(entry.data) ? entry.data : {};
      const level = finiteNumberOrNull(data.level);
      if (maxLevel != null && (level == null || level > maxLevel)) return false;
      if (minLevel != null && (level == null || level < minLevel)) return false;
      if (school && cleanString(data.school) !== school) return false;
      if (classId) {
        const classIds = Array.isArray(data.classIds) ? data.classIds.map(cleanString) : [];
        if (!classIds.includes(classId)) return false;
      }
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The spell-list choices declared by a set of parent entries (race, subrace,
 * …), each paired with its parent for labelling.
 * @param {Array<BuiltinContentEntry | null | undefined>} entries
 * @returns {Array<{ parent: BuiltinContentEntry, choice: Record<string, unknown> }>}
 */
export function getSpellListChoices(entries) {
  /** @type {Array<{ parent: BuiltinContentEntry, choice: Record<string, unknown> }>} */
  const out = [];
  for (const parent of entries) {
    if (!parent) continue;
    const choices = Array.isArray(parent.data?.choices) ? parent.data.choices : [];
    for (const choice of choices) {
      if (isSpellListChoice(choice)) out.push({ parent, choice });
    }
  }
  return out;
}

/**
 * Resolves the player's stored selections for a set of parents' spell-list
 * choices into granted-spell records. Only valid, in-registry selections that
 * still satisfy the choice's filter are returned, so a stale or ineligible id
 * degrades to "no grant" rather than a bad spell. `spellcastingAbility` and
 * `source` travel with each grant for provenance (e.g. High Elf casts its
 * cantrip with Intelligence).
 *
 * @param {Array<BuiltinContentEntry | null | undefined>} entries
 * @param {Record<string, unknown>} flatChoices flattened choicesByLevel
 * @param {ContentRegistry} registry
 * @returns {Array<{ spellId: string, source: string, spellcastingAbility: string, grantType: string, choiceId: string }>}
 */
export function collectChoiceGrantedSpells(entries, flatChoices, registry) {
  /** @type {ReturnType<typeof collectChoiceGrantedSpells>} */
  const out = [];
  for (const { choice } of getSpellListChoices(entries)) {
    const choiceId = cleanString(choice.id);
    const selected = flatChoices[choiceId];
    const spellId = cleanString(Array.isArray(selected) ? selected[0] : selected);
    if (!spellId) continue;
    // Guard against a stored id that no longer matches the choice's filter.
    const eligible = resolveSpellChoiceOptions(registry, choice.from);
    if (!eligible.some((entry) => entry.id === spellId)) continue;
    out.push({
      spellId,
      source: cleanString(choice.source) || "choice",
      spellcastingAbility: cleanString(choice.spellcastingAbility),
      grantType: cleanString(choice.kind) === "cantrip" ? "known_cantrip" : "known_spell",
      choiceId
    });
  }
  return out;
}
