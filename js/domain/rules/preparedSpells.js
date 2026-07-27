// @ts-check
// Prepared-spell plan (Prepared Correctness C1).
//
// One pure, registry-injected traversal of a character's canonical build/rest
// data answering "what may this character prepare right now, and how many of
// those may it hold?". It is the single source of truth for:
//
//   1. `getBuilderPreparedSpellOptions()` (the Long Rest dialog's data), and
//   2. `validateBuilderPreparedSpellSelections()` (the commit guard).
//
// The formulas live here so no UI module reproduces prepared capacity, class
// spell lists, spellbook filtering, grant exclusion, or multiclass spell-level
// rules.
//
// Two capacities, deliberately kept separate:
//
//   * `formulaCapacity` — the rules entitlement (class level or half level,
//     plus the spellcasting ability modifier, minimum 1). It stays `null` when
//     the ability modifier is unknown; `null` means "unknown", never zero.
//   * `effectiveCapacity` — `min(formulaCapacity, ordinaryCandidateIds.length)`,
//     i.e. how many ordinary spells this character can actually hold prepared
//     today. `limitedBy` records which input bound it, so a consumer can
//     explain an unreachable target instead of silently showing one.
//
// Granted / always-prepared spells (domain, oath, patron, or custom-class
// grants) are neither candidates nor capacity consumers: they are reported
// separately and excluded from both sides (rest-rules-spec §4).
//
// Multiclass rule: each caster's highest preparable spell level comes from
// **its own** class slot table at **its own** class level, as if it were
// single-classed. Combined multiclass slots let a character *cast* a known
// lower-level spell with a higher slot; they never unlock higher-level
// candidates for a class whose own table has not reached that level.
//
// Layer rule: this module may import domain/rules + registry modules (plus the
// shared character helpers, matching deriveCharacter.js). It must never import
// from js/pages/**.

import { normalizeCharacterRestState } from "../characterHelpers.js";
import { deriveCharacter } from "./deriveCharacter.js";
import { getSpellcastingClasses, normalizeBuildLevels } from "./progression.js";
import { listContentByKind } from "./registry.js";

/** @typedef {import("./registry.js").ContentRegistry} ContentRegistry */
/** @typedef {import("../../state.js").CharacterEntry} CharacterEntry */

/**
 * Which input bound `effectiveCapacity`.
 * - `formula`   — the class formula is the binding limit (the normal case).
 * - `candidates`— fewer eligible spells exist than the formula allows (an
 *                 under-filled wizard spellbook, or a class with no spell list).
 * - `unknown`   — the formula is unknown (no spellcasting ability modifier).
 */
export const PREPARED_LIMITED_BY = Object.freeze({
  FORMULA: "formula",
  CANDIDATES: "candidates",
  UNKNOWN: "unknown"
});

/**
 * @typedef {{
 *   classId: string,
 *   className: string,
 *   preparationMode: string,
 *   formulaCapacity: number | null,
 *   ordinaryCandidateIds: string[],
 *   grantedIds: string[],
 *   selectedIds: string[],
 *   effectiveCapacity: number | null,
 *   limitedBy: "formula" | "candidates" | "unknown",
 *   maxSpellLevel: number
 * }} PreparedSpellPlanEntry
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Deduplicated, trimmed string ids. Non-strings and blanks fail soft.
 * @param {unknown} value
 * @returns {string[]}
 */
function toIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanString).filter(Boolean))];
}

/**
 * The highest spell level a class slot row grants. A row is the class table's
 * entry for one class level: nine counts, index 0 = 1st-level slots.
 * @param {unknown} row
 * @returns {number}
 */
function maxSpellLevelFromSlotRow(row) {
  if (!Array.isArray(row)) return 0;
  let max = 0;
  row.forEach((count, index) => {
    const parsed = finiteInteger(count);
    if (parsed != null && parsed > 0) max = index + 1;
  });
  return max;
}

/**
 * The highest spell level this caster may prepare, derived from its own class
 * table at its own class level — never from combined multiclass slots. A
 * missing or malformed table fails soft to 0 (no candidates, no false prompt).
 * @param {{ classLevel: number, slotsByLevel: number[][] | null }} caster
 * @returns {number}
 */
function getClassMaxPreparableSpellLevel(caster) {
  const classLevel = finiteInteger(caster.classLevel);
  if (classLevel == null || classLevel < 1) return 0;
  const table = Array.isArray(caster.slotsByLevel) ? caster.slotsByLevel : null;
  if (!table) return 0;
  return maxSpellLevelFromSlotRow(table[classLevel - 1]);
}

/**
 * Whether a preparation mode uses a prepared list at all. Known-spell casters
 * (Bard, Ranger, Sorcerer, Warlock) never appear in a prepared plan.
 * @param {unknown} mode
 * @returns {boolean}
 */
export function isPreparedCasterMode(mode) {
  return mode === "prepared" || mode === "spellbook";
}

/**
 * Whether two prepared lists hold the same spells. Order is not meaningful in
 * a prepared list, so unchecking and rechecking the same spell is not a change
 * — which is what keeps a no-edit "Yes" from rewriting stored state.
 * @param {readonly string[]} a
 * @param {readonly string[]} b
 * @returns {boolean}
 */
export function samePreparedSelection(a, b) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  const seen = new Set(left);
  return right.every((id) => seen.has(id));
}

/**
 * The prepared-spell plan for every prepared caster on a character.
 *
 * Pure: reads the passed character and registry only, mutates nothing, and
 * never throws. A freeform character, a character with no prepared caster, or
 * a class whose registry record has been deleted all yield no entry — so an
 * unresolvable class can never raise a false prompt or invite a destructive
 * cleanup.
 *
 * `selectedIds` reports the character's currently selected **ordinary** spells:
 * stored ids minus granted ids, restricted to ids that are still candidates.
 * That keeps a displayed count identical to the number of checked candidates.
 * Redundant granted ids and stale ids remain in storage untouched; this module
 * never rewrites them (see `validateBuilderPreparedSpellSelections`).
 *
 * @param {CharacterEntry | null | undefined} character
 * @param {ContentRegistry} registry
 * @returns {PreparedSpellPlanEntry[]}
 */
export function getPreparedSpellPlan(character, registry) {
  if (!character || typeof character !== "object") return [];
  if (!isPlainObject(character.build)) return [];

  const derived = deriveCharacter(character, registry);
  const derivedClasses = derived.spellcasting?.classes || [];
  if (!derivedClasses.length) return [];

  const rest = normalizeCharacterRestState(character.rest);
  const spellcastingSelections = isPlainObject(character.build.spellcasting)
    ? /** @type {Record<string, unknown>} */ (character.build.spellcasting)
    : {};

  // Per-class slot tables come from the canonical progression accessor so the
  // multiclass rule is expressed once, against normalized registry data.
  // `normalizeBuildLevels` is the same level source deriveCharacter uses, so a
  // malformed row or a legacy classId+level build resolves identically here.
  const progressionCasters = new Map(
    getSpellcastingClasses(normalizeBuildLevels(character.build), registry)
      .map((caster) => [caster.classId, caster])
  );

  const allSpells = listContentByKind(registry, "spell");

  /** @type {PreparedSpellPlanEntry[]} */
  const plan = [];
  for (const caster of derivedClasses) {
    if (!isPreparedCasterMode(caster.preparationMode)) continue;

    const selection = isPlainObject(spellcastingSelections[caster.classId])
      ? /** @type {Record<string, unknown>} */ (spellcastingSelections[caster.classId])
      : {};
    const grantedIds = [...new Set(
      derived.grantedSpells
        .filter((grant) => grant.classId === caster.classId)
        .map((grant) => cleanString(grant.spellId))
        .filter(Boolean)
    )];
    const grantedSet = new Set(grantedIds);

    const progressionCaster = progressionCasters.get(caster.classId);
    const maxSpellLevel = progressionCaster ? getClassMaxPreparableSpellLevel(progressionCaster) : 0;

    // Wizards (and any custom `spellbook` class) prepare from their spellbook;
    // prepared casters prepare from their class spell list. Custom spells take
    // part through the same `classIds` membership as builtin ones.
    const spellbookIds = new Set(toIdList(selection.knownIds));
    const ordinaryCandidateIds = maxSpellLevel < 1 ? [] : allSpells
      .filter((entry) => {
        const level = finiteInteger(entry.data?.level) || 0;
        if (level < 1 || level > maxSpellLevel) return false;
        if (grantedSet.has(entry.id)) return false;
        if (caster.preparationMode === "spellbook") return spellbookIds.has(entry.id);
        const classIds = Array.isArray(entry.data?.classIds) ? entry.data.classIds : [];
        return classIds.includes(caster.classId);
      })
      .map((entry) => entry.id);

    const legacyPrepared = toIdList(selection.preparedIds);
    const storedIds = Array.isArray(rest.preparedByClass[caster.classId])
      ? rest.preparedByClass[caster.classId]
      : legacyPrepared;
    const candidateSet = new Set(ordinaryCandidateIds);
    const selectedIds = toIdList(storedIds).filter((id) => candidateSet.has(id));

    const formulaCapacity = Number.isFinite(caster.preparedMax) ? Number(caster.preparedMax) : null;
    const effectiveCapacity = formulaCapacity == null
      ? null
      : Math.min(formulaCapacity, ordinaryCandidateIds.length);
    const limitedBy = formulaCapacity == null
      ? PREPARED_LIMITED_BY.UNKNOWN
      : (ordinaryCandidateIds.length < formulaCapacity
        ? PREPARED_LIMITED_BY.CANDIDATES
        : PREPARED_LIMITED_BY.FORMULA);

    plan.push({
      classId: caster.classId,
      className: caster.className,
      preparationMode: caster.preparationMode,
      formulaCapacity,
      ordinaryCandidateIds,
      grantedIds,
      selectedIds,
      effectiveCapacity,
      limitedBy: /** @type {PreparedSpellPlanEntry["limitedBy"]} */ (limitedBy),
      maxSpellLevel
    });
  }
  return plan;
}
