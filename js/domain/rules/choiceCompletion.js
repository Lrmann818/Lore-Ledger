// @ts-check
// Structured choice-completion model (R5-B1).
//
// One pure traversal of (build, registry) that answers "which build-time
// choices are unresolved, and which of those are legally required?". It is the
// single source of truth for five consumers:
//
//   1. the creation wizard Summary (via `formatChoiceShortfall`),
//   2. the Character-page incomplete-required-choices banner,
//   3. the focused Complete Choices dialog (via the descriptors + pickers),
//   4. the creation Spells picker's cantrip/known/spellbook caps (R5-B2), and
//   5. the Level Up Spells step's resulting-allowance pickers (R5-B2).
//
// R5-B2 also parks the persisted `underCapAckLevels` normalization here
// (`normalizeUnderCapAckLevels` and friends) so the under-cap concept —
// counts, shortfalls, and the acknowledgement record keyed by resulting total
// character level — has exactly one owner. The record is a *record*: nothing
// here infers acknowledgement from a shortfall, and no consumer suppresses a
// prompt because some other level was acknowledged.
//
// Required vs. under-cap is a fact of the data, not a judgement: required
// choices carry a fixed count (`choices[].count`, `skillChoices.choose`,
// `subfeatureOptions.choose`, the 2-skill expertise pick, the 2-point ASI, a
// reached `subclassLevel`), while the three under-cap categories are class-table
// *maxima* that the rules genuinely allow a player to come in under. Prepared
// spells are owned by the Long Rest flow (rest-rules-spec) and never appear
// here; build equipment choices are cosmetic (retirement audit G7) and are
// likewise excluded.
//
// Descriptors carry structured facts only — never resolved option arrays,
// copied registry records, UI state, or acknowledgement state. `picker` is a
// *reference* describing where options come from; `resolveChoiceOptions()`
// turns it into registry entries through the existing registry helpers so no
// filter logic is reimplemented.
//
// Layer rule: this module may import domain/rules + registry modules only. It
// must never import from js/pages/**.

import { getContentByKind, listContentByKind } from "./registry.js";
import { isSpellListChoice, resolveSpellChoiceOptions } from "./spellChoices.js";
import {
  asiChoiceId,
  classSkillChoiceId,
  EXPERTISE_FEATURE_IDS,
  featureChoiceId,
  getAsiSlots,
  getBuildFeatures,
  getClassLevelTotals,
  getSpellcastingClasses,
  MAX_CHARACTER_LEVEL,
  multiclassSkillChoiceId,
  normalizeBuildLevels,
  SPELLBOOK_INITIAL_SPELLS,
  SPELLBOOK_SPELLS_PER_LEVEL
} from "./progression.js";

/** @typedef {import("./registry.js").ContentRegistry} ContentRegistry */
/** @typedef {import("./builtinContent.js").BuiltinContentEntry} BuiltinContentEntry */

/**
 * Requirement classification. `required` choices have a fixed legal count;
 * `under-cap` categories are permitted maxima the rules allow coming in under.
 */
export const CHOICE_REQUIREMENT = Object.freeze({
  REQUIRED: "required",
  UNDER_CAP: "under-cap"
});

/**
 * The three permitted under-cap categories (R5-B2). Prepared spells are not one
 * of them: prepared lists are Long-Rest-owned play state with their own
 * transient confirmation (rest-rules-spec §4.5), and they must never be mixed
 * into the under-cap descriptors or the persisted acknowledgement record.
 */
export const UNDER_CAP_KIND = Object.freeze({
  CANTRIPS: "cantrips",
  KNOWN_SPELLS: "known-spells",
  SPELLBOOK: "spellbook"
});

/** Expertise features grant exactly two skill upgrades. */
const EXPERTISE_CHOICE_COUNT = 2;

/** An ASI slot distributes exactly two +1 increases. */
const ASI_POINTS = 2;

/**
 * @typedef {"required" | "under-cap"} ChoiceRequirement
 *
 * @typedef {"origin-ancestry" | "origin-spell" | "origin-language"
 *   | "class-skill" | "multiclass-skill" | "subclass"
 *   | "feature-option" | "expertise" | "asi"
 *   | "cantrips" | "known-spells" | "spellbook"} ChoiceCompletionKind
 *
 * @typedef {{ kind: "skills", from: string[] | null }
 *   | { kind: "features", from: string[] }
 *   | { kind: "languages", from: string[] | null }
 *   | { kind: "ancestries" }
 *   | { kind: "spells", from: unknown }
 *   | { kind: "subclasses", classId: string }
 *   | { kind: "asi", slot: { characterLevel: number, classId: string, classLevel: number } }
 *   } ChoicePickerRef
 *
 * @typedef {{
 *   key: string,
 *   requirement: ChoiceRequirement,
 *   kind: ChoiceCompletionKind,
 *   target: "choice" | "subclass" | "spellSelection",
 *   choiceId: string | null,
 *   levelKey: string | null,
 *   characterLevel: number | null,
 *   classId: string | null,
 *   featureId: string | null,
 *   source: { kind: string, id: string },
 *   label: string,
 *   scope: string,
 *   chosen: number,
 *   allowed: number,
 *   satisfied: boolean,
 *   picker: ChoicePickerRef | null,
 *   asiState: "unset" | "feat-missing" | "partial" | null,
 *   assignedPoints: number | null
 * }} ChoiceCompletionDescriptor
 *
 * @typedef {{
 *   descriptors: ChoiceCompletionDescriptor[],
 *   unresolvedRequired: ChoiceCompletionDescriptor[],
 *   underCapShortfalls: ChoiceCompletionDescriptor[],
 *   hasUnresolvedRequired: boolean,
 *   warnings: string[]
 * }} ChoiceCompletionReport
 */

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
 * Reads a stored choice value from any level bucket.
 *
 * A local read-only accessor rather than an import: `readChoice()` lives in
 * `js/pages/character/builderWizardSteps.js`, which this layer must not import.
 * Same convention as the private `isPlainObject`/`cleanString` helpers every
 * rules module already carries.
 *
 * @param {unknown} build
 * @param {string} choiceId
 * @returns {unknown}
 */
function readStoredChoice(build, choiceId) {
  if (!isPlainObject(build)) return undefined;
  const byLevel = build.choicesByLevel;
  if (!isPlainObject(byLevel)) return undefined;
  for (const levelChoices of Object.values(byLevel)) {
    if (isPlainObject(levelChoices) && choiceId in levelChoices) return levelChoices[choiceId];
  }
  return undefined;
}

/**
 * How many values are stored for a choice id (0 when unset).
 * @param {unknown} build
 * @param {string} choiceId
 * @returns {number}
 */
function countStoredChoiceValues(build, choiceId) {
  const stored = readStoredChoice(build, choiceId);
  if (Array.isArray(stored)) return stored.map(cleanString).filter(Boolean).length;
  return cleanString(stored) ? 1 : 0;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function positiveIntegerOrNull(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * @param {Partial<ChoiceCompletionDescriptor> & {
 *   key: string, requirement: ChoiceRequirement, kind: ChoiceCompletionKind,
 *   label: string, chosen: number, allowed: number
 * }} input
 * @returns {ChoiceCompletionDescriptor}
 */
function makeDescriptor(input) {
  return {
    key: input.key,
    requirement: input.requirement,
    kind: input.kind,
    target: input.target ?? "choice",
    choiceId: input.choiceId ?? null,
    levelKey: input.levelKey ?? null,
    characterLevel: input.characterLevel ?? null,
    classId: input.classId ?? null,
    featureId: input.featureId ?? null,
    source: input.source ?? { kind: "", id: "" },
    label: input.label,
    scope: input.scope ?? "",
    chosen: input.chosen,
    allowed: input.allowed,
    satisfied: input.satisfied ?? (input.chosen >= input.allowed),
    picker: input.picker ?? null,
    asiState: input.asiState ?? null,
    assignedPoints: input.assignedPoints ?? null
  };
}

/**
 * Origin (race / subrace / background) required choices, in parent order and
 * then each parent's own `choices[]` order.
 *
 * Covers the ancestry pick, filtered spell/cantrip grants, and fixed-count
 * language choices. Languages are required (owner ruling, R5-B1): the rules do
 * not permit choosing fewer, so they are not an under-cap category.
 *
 * @param {unknown} build
 * @param {ContentRegistry} registry
 * @param {string[]} warnings
 * @returns {ChoiceCompletionDescriptor[]}
 */
function collectOriginDescriptors(build, registry, warnings) {
  /** @type {ChoiceCompletionDescriptor[]} */
  const out = [];
  const source = isPlainObject(build) ? build : {};

  /** @type {Array<{ sourceKind: string, id: string, entry: BuiltinContentEntry | null, fallbackLabel: string }>} */
  const parents = [
    {
      sourceKind: "race",
      id: cleanString(source.raceId),
      entry: getContentByKind(registry, "race", cleanString(source.raceId)),
      fallbackLabel: "Race"
    },
    {
      sourceKind: "subrace",
      id: cleanString(source.subraceId),
      entry: getContentByKind(registry, "subrace", cleanString(source.subraceId)),
      fallbackLabel: "Subrace"
    },
    {
      sourceKind: "background",
      id: cleanString(source.backgroundId),
      entry: getContentByKind(registry, "background", cleanString(source.backgroundId)),
      fallbackLabel: "Background"
    }
  ];

  for (const parent of parents) {
    if (parent.id && !parent.entry) {
      // Deleted or missing custom content degrades soft: no descriptor, so a
      // vanished record can never raise the banner on its own.
      warnings.push(`${parent.sourceKind} "${parent.id}" is not in this campaign's content.`);
      continue;
    }
    if (!parent.entry) continue;
    const choices = Array.isArray(parent.entry.data?.choices) ? parent.entry.data.choices : [];
    const parentName = parent.entry.name || parent.fallbackLabel;

    for (const choice of choices) {
      if (!isPlainObject(choice) || typeof choice.id !== "string") continue;
      const choiceId = cleanString(choice.id);
      if (!choiceId) continue;
      const kind = cleanString(choice.kind);
      const count = positiveIntegerOrNull(choice.count) ?? 1;
      // Read the option selector before the kind narrowing below, so both the
      // spell and language branches can reference it.
      const fromDescriptor = choice.from;
      const chosen = countStoredChoiceValues(build, choiceId);
      const shared = {
        key: `choice:${choiceId}`,
        requirement: /** @type {ChoiceRequirement} */ (CHOICE_REQUIREMENT.REQUIRED),
        target: /** @type {"choice"} */ ("choice"),
        choiceId,
        levelKey: "1",
        source: { kind: parent.sourceKind, id: parent.entry.id },
        chosen
      };

      if (kind === "ancestry") {
        out.push(makeDescriptor({
          ...shared,
          kind: "origin-ancestry",
          label: "Draconic Ancestry",
          allowed: count,
          picker: { kind: "ancestries" }
        }));
        continue;
      }

      if (isSpellListChoice(choice)) {
        out.push(makeDescriptor({
          ...shared,
          kind: "origin-spell",
          label: `${parentName} ${kind === "cantrip" ? "cantrip" : "spell"}`,
          allowed: count,
          picker: { kind: "spells", from: fromDescriptor }
        }));
        continue;
      }

      if (kind === "language") {
        const from = isPlainObject(fromDescriptor) ? fromDescriptor : {};
        const options = Array.isArray(from.options)
          ? from.options.map(cleanString).filter(Boolean)
          : null;
        out.push(makeDescriptor({
          ...shared,
          kind: "origin-language",
          label: `${parentName} ${count > 1 ? "languages" : "language"}`,
          allowed: count,
          picker: { kind: "languages", from: options }
        }));
      }
    }
  }

  return out;
}

/**
 * First-class and multiclass skill choices, in class order.
 * @param {unknown} build
 * @param {ContentRegistry} registry
 * @param {Array<{ classId: string, level: number }>} totals
 * @param {string[]} warnings
 * @returns {ChoiceCompletionDescriptor[]}
 */
function collectSkillDescriptors(build, registry, totals, warnings) {
  /** @type {ChoiceCompletionDescriptor[]} */
  const out = [];
  totals.forEach((info, index) => {
    const classEntry = getContentByKind(registry, "class", info.classId);
    if (!classEntry) {
      warnings.push(`class "${info.classId}" is not in this campaign's content.`);
      return;
    }
    const skillSource = index === 0
      ? classEntry.data?.skillChoices
      : (isPlainObject(classEntry.data?.multiclassing) ? classEntry.data.multiclassing.skillChoices : null);
    if (!isPlainObject(skillSource)) return;
    const choose = positiveIntegerOrNull(skillSource.choose);
    if (choose == null) return;
    const from = Array.isArray(skillSource.from) ? skillSource.from.map(cleanString).filter(Boolean) : [];
    const choiceId = index === 0
      ? classSkillChoiceId(info.classId)
      : multiclassSkillChoiceId(info.classId);
    out.push(makeDescriptor({
      key: `choice:${choiceId}`,
      requirement: CHOICE_REQUIREMENT.REQUIRED,
      kind: index === 0 ? "class-skill" : "multiclass-skill",
      target: "choice",
      choiceId,
      // Class and multiclass skill choices live under level key "1" by the
      // existing storage convention (level-up spec Gap D).
      levelKey: "1",
      classId: info.classId,
      source: { kind: "class", id: info.classId },
      label: `${classEntry.name} skills`,
      chosen: countStoredChoiceValues(build, choiceId),
      allowed: choose,
      picker: { kind: "skills", from: from.length ? from : null }
    }));
  });
  return out;
}

/**
 * Subclass picks whose class level has reached the class's subclass level.
 * @param {unknown} build
 * @param {ContentRegistry} registry
 * @param {Array<{ classId: string, level: number }>} totals
 * @returns {ChoiceCompletionDescriptor[]}
 */
function collectSubclassDescriptors(build, registry, totals) {
  /** @type {ChoiceCompletionDescriptor[]} */
  const out = [];
  const source = isPlainObject(build) ? build : {};
  const subclassByClass = isPlainObject(source.subclassByClass)
    ? /** @type {Record<string, unknown>} */ (source.subclassByClass)
    : {};
  for (const info of totals) {
    const classEntry = getContentByKind(registry, "class", info.classId);
    const subclassLevel = Number(classEntry?.data?.subclassLevel);
    const subclassIds = Array.isArray(classEntry?.data?.subclassIds) ? classEntry.data.subclassIds : [];
    if (!Number.isInteger(subclassLevel) || info.level < subclassLevel || !subclassIds.length) continue;
    const chosen = cleanString(subclassByClass[info.classId]) ? 1 : 0;
    out.push(makeDescriptor({
      key: `subclass:${info.classId}`,
      requirement: CHOICE_REQUIREMENT.REQUIRED,
      kind: "subclass",
      target: "subclass",
      characterLevel: null,
      classId: info.classId,
      source: { kind: "class", id: info.classId },
      label: classEntry?.name || info.classId,
      chosen,
      allowed: 1,
      picker: { kind: "subclasses", classId: info.classId }
    }));
  }
  return out;
}

/**
 * Feature subfeature options (Fighting Style, Pact Boon, Metamagic, …) and
 * expertise picks, in build-feature order, first occurrence of each feature id.
 * @param {unknown} build
 * @param {ContentRegistry} registry
 * @param {Array<{ classId: string, hp: number | null }>} levels
 * @returns {ChoiceCompletionDescriptor[]}
 */
function collectFeatureDescriptors(build, registry, levels) {
  /** @type {ChoiceCompletionDescriptor[]} */
  const out = [];
  const source = isPlainObject(build) ? build : {};
  const subclassByClass = isPlainObject(source.subclassByClass)
    ? /** @type {Record<string, string>} */ (source.subclassByClass)
    : {};
  const seen = new Set();

  for (const feature of getBuildFeatures(levels, subclassByClass, registry)) {
    if (seen.has(feature.featureId)) continue;
    const featureEntry = getContentByKind(registry, "feature", feature.featureId);
    const subOptions = featureEntry && isPlainObject(featureEntry.data?.subfeatureOptions)
      ? featureEntry.data.subfeatureOptions
      : null;
    const choiceId = featureChoiceId(feature.featureId);

    if (subOptions && Array.isArray(subOptions.from) && subOptions.from.length) {
      seen.add(feature.featureId);
      const choose = Number.isInteger(Number(subOptions.choose)) ? Number(subOptions.choose) : 1;
      out.push(makeDescriptor({
        key: `choice:${choiceId}`,
        requirement: CHOICE_REQUIREMENT.REQUIRED,
        kind: "feature-option",
        target: "choice",
        choiceId,
        levelKey: String(feature.characterLevel),
        characterLevel: feature.characterLevel,
        classId: feature.classId,
        featureId: feature.featureId,
        source: { kind: "feature", id: feature.featureId },
        label: featureEntry?.name || feature.featureId,
        chosen: countStoredChoiceValues(build, choiceId),
        allowed: choose,
        picker: { kind: "features", from: subOptions.from.map(cleanString).filter(Boolean) }
      }));
      continue;
    }

    if (EXPERTISE_FEATURE_IDS.has(feature.featureId)) {
      seen.add(feature.featureId);
      out.push(makeDescriptor({
        key: `choice:${choiceId}`,
        requirement: CHOICE_REQUIREMENT.REQUIRED,
        kind: "expertise",
        target: "choice",
        choiceId,
        levelKey: String(feature.characterLevel),
        characterLevel: feature.characterLevel,
        classId: feature.classId,
        featureId: feature.featureId,
        source: { kind: "feature", id: feature.featureId },
        label: featureEntry?.name || "Expertise",
        scope: `Level ${feature.characterLevel}`,
        chosen: countStoredChoiceValues(build, choiceId),
        allowed: EXPERTISE_CHOICE_COUNT,
        picker: { kind: "skills", from: null }
      }));
    }
  }
  return out;
}

/**
 * ASI-or-feat slots reached by the build, including partially assigned ASIs.
 * @param {unknown} build
 * @param {ContentRegistry} registry
 * @param {Array<{ classId: string, hp: number | null }>} levels
 * @returns {ChoiceCompletionDescriptor[]}
 */
function collectAsiDescriptors(build, registry, levels) {
  /** @type {ChoiceCompletionDescriptor[]} */
  const out = [];
  for (const slot of getAsiSlots(levels, registry)) {
    const choiceId = asiChoiceId(slot.characterLevel);
    const stored = readStoredChoice(build, choiceId);
    const shared = {
      key: `choice:${choiceId}`,
      requirement: /** @type {ChoiceRequirement} */ (CHOICE_REQUIREMENT.REQUIRED),
      kind: /** @type {ChoiceCompletionKind} */ ("asi"),
      target: /** @type {"choice"} */ ("choice"),
      choiceId,
      levelKey: String(slot.characterLevel),
      characterLevel: slot.characterLevel,
      classId: slot.classId,
      source: { kind: "class", id: slot.classId },
      label: "Ability Score Improvement",
      scope: `Level ${slot.characterLevel}`,
      picker: /** @type {ChoicePickerRef} */ ({ kind: "asi", slot })
    };

    if (!isPlainObject(stored)) {
      out.push(makeDescriptor({
        ...shared,
        chosen: 0,
        allowed: ASI_POINTS,
        satisfied: false,
        asiState: "unset",
        assignedPoints: 0
      }));
      continue;
    }

    if (stored.type === "feat") {
      const hasFeat = !!cleanString(stored.featId);
      out.push(makeDescriptor({
        ...shared,
        chosen: hasFeat ? 1 : 0,
        allowed: 1,
        satisfied: hasFeat,
        asiState: hasFeat ? null : "feat-missing"
      }));
      continue;
    }

    const increases = isPlainObject(stored.increases) ? stored.increases : {};
    let assigned = 0;
    for (const value of Object.values(increases)) {
      const n = Number(value);
      if (Number.isFinite(n)) assigned += n;
    }
    out.push(makeDescriptor({
      ...shared,
      chosen: assigned,
      allowed: ASI_POINTS,
      satisfied: assigned >= ASI_POINTS,
      asiState: assigned >= ASI_POINTS ? null : "partial",
      assignedPoints: assigned
    }));
  }
  return out;
}

/**
 * Permitted under-cap spell categories: class cantrips, known spells, and the
 * wizard spellbook. These are maxima — the rules allow coming in under, so they
 * are reported but never treated as unresolved required choices.
 *
 * Prepared-spell capacity is deliberately absent: prepared lists are play-state
 * owned by the Long Rest flow (rest-rules-spec).
 *
 * `picker` is null: a leveled-spell candidate set depends on the caster's slot
 * progression, which the two wizards already compute for their own pickers. A
 * single filter reference could not express it honestly.
 *
 * @param {unknown} build
 * @param {ContentRegistry} registry
 * @param {Array<{ classId: string, hp: number | null }>} levels
 * @returns {ChoiceCompletionDescriptor[]}
 */
function collectSpellCategoryDescriptors(build, registry, levels) {
  /** @type {ChoiceCompletionDescriptor[]} */
  const out = [];
  const source = isPlainObject(build) ? build : {};
  const selections = isPlainObject(source.spellcasting)
    ? /** @type {Record<string, unknown>} */ (source.spellcasting)
    : {};

  for (const caster of getSpellcastingClasses(levels, registry)) {
    const classEntry = getContentByKind(registry, "class", caster.classId);
    const className = classEntry?.name || caster.classId;
    const selection = isPlainObject(selections[caster.classId])
      ? /** @type {Record<string, unknown>} */ (selections[caster.classId])
      : {};
    /** @param {unknown} list @returns {number} */
    const count = (list) => (Array.isArray(list) ? list.map(cleanString).filter(Boolean).length : 0);
    const shared = {
      requirement: /** @type {ChoiceRequirement} */ (CHOICE_REQUIREMENT.UNDER_CAP),
      target: /** @type {"spellSelection"} */ ("spellSelection"),
      classId: caster.classId,
      source: { kind: "class", id: caster.classId },
      picker: null
    };

    if (caster.cantripsKnownMax != null) {
      out.push(makeDescriptor({
        ...shared,
        key: `spells:${caster.classId}:cantrips`,
        kind: "cantrips",
        label: `${className} cantrips`,
        chosen: count(selection.cantripIds),
        allowed: caster.cantripsKnownMax
      }));
    }
    if (caster.preparationMode === "known" && caster.spellsKnownMax != null) {
      out.push(makeDescriptor({
        ...shared,
        key: `spells:${caster.classId}:known`,
        kind: "known-spells",
        label: `${className} known spells`,
        chosen: count(selection.knownIds),
        allowed: caster.spellsKnownMax
      }));
    }
    if (caster.preparationMode === "spellbook") {
      out.push(makeDescriptor({
        ...shared,
        key: `spells:${caster.classId}:spellbook`,
        kind: "spellbook",
        label: `${className} spellbook`,
        chosen: count(selection.knownIds),
        allowed: SPELLBOOK_INITIAL_SPELLS + SPELLBOOK_SPELLS_PER_LEVEL * (caster.classLevel - 1)
      }));
    }
  }
  return out;
}

/**
 * The complete structured completion report for a build.
 *
 * Descriptor order is deterministic: origin choices (race → subrace →
 * background, each in its own `choices[]` order), class/multiclass skills,
 * reached subclasses, feature options + expertise, ASI/feat slots, then the
 * under-cap spell categories. This matches the shipped creation-Summary order.
 *
 * Never throws. A malformed build, a missing registry record, an unusable count,
 * or a wrongly typed stored selection degrades to "no descriptor" or "nothing
 * chosen" — a required descriptor is only ever produced from an affirmative,
 * countable requirement, so deleted custom content cannot raise a false banner.
 *
 * @param {unknown} build
 * @param {ContentRegistry} registry
 * @returns {ChoiceCompletionReport}
 */
export function getChoiceCompletionReport(build, registry) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {ChoiceCompletionDescriptor[]} */
  const descriptors = [];

  if (isPlainObject(build)) {
    descriptors.push(...collectOriginDescriptors(build, registry, warnings));
    const levels = normalizeBuildLevels(build);
    if (levels.length) {
      const totals = getClassLevelTotals(levels);
      descriptors.push(...collectSkillDescriptors(build, registry, totals, warnings));
      descriptors.push(...collectSubclassDescriptors(build, registry, totals));
      descriptors.push(...collectFeatureDescriptors(build, registry, levels));
      descriptors.push(...collectAsiDescriptors(build, registry, levels));
      descriptors.push(...collectSpellCategoryDescriptors(build, registry, levels));
    }
  }

  const unresolvedRequired = descriptors.filter(
    (descriptor) => descriptor.requirement === CHOICE_REQUIREMENT.REQUIRED && !descriptor.satisfied
  );
  const underCapShortfalls = descriptors.filter(
    (descriptor) => descriptor.requirement === CHOICE_REQUIREMENT.UNDER_CAP && !descriptor.satisfied
  );

  return {
    descriptors,
    unresolvedRequired,
    underCapShortfalls,
    hasUnresolvedRequired: unresolvedRequired.length > 0,
    warnings
  };
}

/**
 * The permitted under-cap spell categories for a build — satisfied and short
 * alike, in the report's own deterministic order.
 *
 * A thin accessor over `getChoiceCompletionReport()`, not a second walk: the
 * creation Spells picker takes its cap from the same `allowed` the creation
 * Summary counts against, so a rendered cap and a rendered shortfall can never
 * disagree. Consumers select a category with
 * `descriptors.find((d) => d.classId === id && d.kind === UNDER_CAP_KIND.…)`.
 *
 * @param {unknown} build
 * @param {ContentRegistry} registry
 * @returns {ChoiceCompletionDescriptor[]}
 */
export function getUnderCapChoiceDescriptors(build, registry) {
  return getChoiceCompletionReport(build, registry).descriptors.filter(
    (descriptor) => descriptor.requirement === CHOICE_REQUIREMENT.UNDER_CAP
  );
}

/**
 * The resulting **total character level** a build describes: the number of
 * level rows, which is what `underCapAckLevels` is keyed by. 0 for a build with
 * no levels (a malformed or class-less draft), which is never a valid
 * acknowledgement level.
 *
 * @param {unknown} build
 * @returns {number}
 */
export function getResultingCharacterLevel(build) {
  return normalizeBuildLevels(build).length;
}

/**
 * Normalizes the optional persisted `underCapAckLevels` record.
 *
 * Defensive by contract: only genuine integers inside the legal character-level
 * range survive. Strings (including numeric ones), fractions, negatives, zero,
 * out-of-range values, `NaN`, and non-array containers all fail soft to
 * "not acknowledged" — the worst consequence of dropping a malformed entry is
 * that the player is asked to confirm again, which is always safe. Duplicates
 * collapse and the result is ascending, so the stored record is canonical.
 *
 * @param {unknown} value
 * @returns {number[]}
 */
export function normalizeUnderCapAckLevels(value) {
  if (!Array.isArray(value)) return [];
  /** @type {Set<number>} */
  const levels = new Set();
  for (const raw of value) {
    if (typeof raw !== "number" || !Number.isInteger(raw)) continue;
    if (raw < 1 || raw > MAX_CHARACTER_LEVEL) continue;
    levels.add(raw);
  }
  return [...levels].sort((a, b) => a - b);
}

/**
 * Whether a resulting total character level has a recorded acknowledgement.
 *
 * Read-only: nothing in R5-B2 infers acknowledgement from the mere existence of
 * a shortfall, and no flow suppresses a prompt on the strength of a *different*
 * level's record.
 *
 * @param {unknown} value
 * @param {unknown} level
 * @returns {boolean}
 */
export function hasUnderCapAckLevel(value, level) {
  if (typeof level !== "number" || !Number.isInteger(level)) return false;
  return normalizeUnderCapAckLevels(value).includes(level);
}

/**
 * The record that results from acknowledging one resulting total character
 * level. Append-only and idempotent: an already-recorded level changes nothing,
 * and an invalid level is ignored rather than stored.
 *
 * Callers must only invoke this **after** the creation or Level Up commit has
 * succeeded (see `js/pages/character/characterPage.js`).
 *
 * @param {unknown} value
 * @param {unknown} level
 * @returns {number[]}
 */
export function appendUnderCapAckLevel(value, level) {
  const current = normalizeUnderCapAckLevels(value);
  const normalizedLevel = normalizeUnderCapAckLevels([level]);
  if (!normalizedLevel.length) return current;
  return normalizeUnderCapAckLevels([...current, normalizedLevel[0]]);
}

/**
 * Whether the build has at least one unresolved *required* choice. Under-cap
 * shortfalls never count — they are legal states (owner ruling, R5-B).
 *
 * Implemented over the same single traversal rather than a parallel
 * short-circuit walk, so the banner can never disagree with the dialog.
 *
 * @param {unknown} build
 * @param {ContentRegistry} registry
 * @returns {boolean}
 */
export function hasUnresolvedRequiredChoices(build, registry) {
  return getChoiceCompletionReport(build, registry).hasUnresolvedRequired;
}

/**
 * Resolves a descriptor's picker reference into selectable registry entries.
 *
 * The single place option resolution happens: it delegates to the existing
 * registry helpers and `resolveSpellChoiceOptions()`, so no filter logic is
 * duplicated and option order matches what the creation wizard renders.
 *
 * @param {ChoiceCompletionDescriptor | null | undefined} descriptor
 * @param {ContentRegistry} registry
 * @returns {Array<{ id: string, name: string }>}
 */
export function resolveChoiceOptions(descriptor, registry) {
  const picker = descriptor?.picker;
  if (!picker) return [];
  /** @param {BuiltinContentEntry} entry @returns {{ id: string, name: string }} */
  const toOption = (entry) => ({ id: entry.id, name: entry.name });

  if (picker.kind === "ancestries") {
    return listContentByKind(registry, "ancestry").map(toOption);
  }
  if (picker.kind === "languages") {
    if (!Array.isArray(picker.from)) return listContentByKind(registry, "language").map(toOption);
    return picker.from
      .map((id) => getContentByKind(registry, "language", cleanString(id)))
      .filter((entry) => !!entry)
      .map(toOption);
  }
  if (picker.kind === "skills") {
    if (!Array.isArray(picker.from)) return listContentByKind(registry, "skill").map(toOption);
    return picker.from.map((id) => {
      const skillId = cleanString(id);
      const entry = getContentByKind(registry, "skill", skillId);
      return { id: skillId, name: entry?.name || skillId };
    });
  }
  if (picker.kind === "features") {
    return picker.from.map((id) => {
      const featureId = cleanString(id);
      const entry = getContentByKind(registry, "feature", featureId);
      // Same display trim the creation wizard applies: the parent feature
      // already says "Fighting Style", so the options need not repeat it.
      return { id: featureId, name: (entry?.name || featureId).replace(/^Fighting Style:\s*/, "") };
    });
  }
  if (picker.kind === "subclasses") {
    return listContentByKind(registry, "subclass")
      .filter((entry) => cleanString(entry.data?.classId) === picker.classId)
      .map(toOption);
  }
  if (picker.kind === "spells") {
    return resolveSpellChoiceOptions(registry, picker.from).map(toOption);
  }
  // "asi" builds its own ability/feat lists inside renderAsiSlot.
  return [];
}

/**
 * The user-facing shortfall line for an unsatisfied descriptor.
 *
 * The single source of this wording: the creation Summary, the Complete Choices
 * dialog, and (later) the under-cap confirmation all render the same strings.
 *
 * @param {ChoiceCompletionDescriptor | null | undefined} descriptor
 * @returns {string}
 */
export function formatChoiceShortfall(descriptor) {
  if (!descriptor) return "";
  const { kind, label, chosen, allowed, characterLevel } = descriptor;

  if (kind === "origin-ancestry" || kind === "origin-spell") {
    return `${label}: not chosen`;
  }
  if (kind === "subclass") {
    return `${label}: subclass not chosen`;
  }
  if (kind === "expertise") {
    return `${label} (Level ${characterLevel}): ${chosen} of ${allowed} skills chosen`;
  }
  if (kind === "asi") {
    if (descriptor.asiState === "feat-missing") return `Level ${characterLevel} feat: not chosen`;
    if (descriptor.asiState === "unset") {
      return `Level ${characterLevel} Ability Score Improvement: not chosen`;
    }
    return `Level ${characterLevel} Ability Score Improvement: ${descriptor.assignedPoints ?? 0} of ${allowed} points assigned`;
  }
  if (kind === "spellbook") {
    return `${label}: ${chosen} of ${allowed} spells chosen`;
  }
  return `${label}: ${chosen} of ${allowed} chosen`;
}
