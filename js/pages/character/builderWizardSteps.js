// @ts-check
// Dynamic builder wizard steps: race/background choices, classes & levels,
// class choices (skills / expertise / fighting styles / ASI-or-feat),
// spells, and equipment. Each step renders into a container owned by
// builderWizard.js and mutates the shared draft build (v2 shape) directly.

import { CHARACTER_ABILITY_KEYS } from "../../domain/characterHelpers.js";
import { deriveCharacter } from "../../domain/rules/deriveCharacter.js";
import {
  getActiveContentRegistry,
  getContentByKind,
  listContentByKind
} from "../../domain/rules/registry.js";
import { isSpellListChoice, resolveSpellChoiceOptions } from "../../domain/rules/spellChoices.js";
import {
  appendLevel,
  asiChoiceId,
  checkMulticlassPrerequisites,
  classSkillChoiceId,
  EXPERTISE_FEATURE_IDS,
  featureChoiceId,
  getAsiSlots,
  getBuildAbilityTotals,
  getBuildFeatures,
  getClassBlocks,
  getClassLevelAtEachCharacterLevel,
  getClassLevelTotals,
  getSpellcastingClasses,
  MAX_CHARACTER_LEVEL,
  multiclassSkillChoiceId,
  normalizeBuildLevels,
  removeLevelAt,
  setClassBlocks,
  setLevelClassAt,
  setLevelHpAt,
  SPELLBOOK_INITIAL_SPELLS,
  SPELLBOOK_SPELLS_PER_LEVEL
} from "../../domain/rules/progression.js";

/** @typedef {import("../../domain/rules/registry.js").ContentRegistry} ContentRegistry */
/** @typedef {import("../../state.js").CharacterBuildState} CharacterBuildState */

/**
 * @typedef {{
 *   getDraft: () => { name: string, build: CharacterBuildState },
 *   getRegistry: () => ContentRegistry,
 *   signal: AbortSignal,
 *   enhanceSelect: (select: HTMLSelectElement) => void,
 *   onDraftChanged: () => void
 * }} WizardStepContext
 */

const ABILITY_LABELS = Object.freeze({
  str: "Strength", dex: "Dexterity", con: "Constitution",
  int: "Intelligence", wis: "Wisdom", cha: "Charisma"
});

const EXPERTISE_CHOICE_COUNT = 2;

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
 * Clears an element's children (the unit-test DOM lacks replaceChildren).
 * @param {HTMLElement} node
 */
function clearChildren(node) {
  if (typeof node.replaceChildren === "function") {
    node.replaceChildren();
    return;
  }
  node.innerHTML = "";
}

/**
 * @param {HTMLElement} parent
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  parent.appendChild(node);
  return /** @type {HTMLElement} */ (node);
}

/**
 * Shared primitive (also used by the Level Up wizard).
 * @param {HTMLElement} parent
 * @param {Array<{ value: string, label: string }>} options
 * @param {string} selected
 * @param {string} emptyLabel
 * @returns {HTMLSelectElement}
 */
export function makeSelect(parent, options, selected, emptyLabel) {
  const select = /** @type {HTMLSelectElement} */ (document.createElement("select"));
  select.className = "settingsSelect builderWizardSelect";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = emptyLabel;
  select.appendChild(empty);
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.appendChild(node);
  }
  select.value = options.some((option) => option.value === selected) ? selected : "";
  parent.appendChild(select);
  return select;
}

/**
 * Ensures build.choicesByLevel[levelKey] exists and returns it.
 * @param {CharacterBuildState} build
 * @param {string} levelKey
 * @returns {Record<string, unknown>}
 */
function ensureLevelChoices(build, levelKey) {
  if (!isPlainObject(build.choicesByLevel)) build.choicesByLevel = {};
  const byLevel = /** @type {Record<string, unknown>} */ (build.choicesByLevel);
  if (!isPlainObject(byLevel[levelKey])) byLevel[levelKey] = {};
  return /** @type {Record<string, unknown>} */ (byLevel[levelKey]);
}

/**
 * Reads a stored choice value from any level bucket.
 * Shared primitive (also used by the Level Up wizard).
 * @param {CharacterBuildState} build
 * @param {string} choiceId
 * @returns {unknown}
 */
export function readChoice(build, choiceId) {
  if (!isPlainObject(build.choicesByLevel)) return undefined;
  for (const levelChoices of Object.values(build.choicesByLevel)) {
    if (isPlainObject(levelChoices) && choiceId in levelChoices) return levelChoices[choiceId];
  }
  return undefined;
}

/**
 * Writes (or deletes, when value is undefined) a choice value at a level.
 * Shared primitive (also used by the Level Up wizard).
 * @param {CharacterBuildState} build
 * @param {string} levelKey
 * @param {string} choiceId
 * @param {unknown} value
 */
export function writeChoice(build, levelKey, choiceId, value) {
  // Remove any stale copy stored under another level first.
  if (isPlainObject(build.choicesByLevel)) {
    for (const [key, levelChoices] of Object.entries(build.choicesByLevel)) {
      if (isPlainObject(levelChoices) && choiceId in levelChoices && key !== levelKey) {
        delete levelChoices[choiceId];
      }
    }
  }
  const levelChoices = ensureLevelChoices(build, levelKey);
  if (value === undefined) delete levelChoices[choiceId];
  else levelChoices[choiceId] = value;
}

/**
 * Removes stored choices that no longer correspond to an active choice id.
 * @param {CharacterBuildState} build
 * @param {Set<string>} activeChoiceIds
 */
export function pruneStaleChoices(build, activeChoiceIds) {
  if (!isPlainObject(build.choicesByLevel)) return;
  for (const levelChoices of Object.values(build.choicesByLevel)) {
    if (!isPlainObject(levelChoices)) continue;
    for (const choiceId of Object.keys(levelChoices)) {
      if (!activeChoiceIds.has(choiceId)) delete levelChoices[choiceId];
    }
  }
}

/**
 * All choice ids the current draft build can legitimately store, used to
 * prune choices left behind by race/class/background edits.
 * @param {CharacterBuildState} build
 * @param {ContentRegistry} registry
 * @returns {Set<string>}
 */
export function collectActiveChoiceIds(build, registry) {
  /** @type {Set<string>} */
  const ids = new Set();
  const raceEntry = getContentByKind(registry, "race", cleanString(build.raceId));
  const subraceEntry = getContentByKind(registry, "subrace", cleanString(build.subraceId));
  const backgroundEntry = getContentByKind(registry, "background", cleanString(build.backgroundId));
  for (const parent of [raceEntry, subraceEntry, backgroundEntry]) {
    const choices = Array.isArray(parent?.data?.choices) ? parent.data.choices : [];
    for (const choice of choices) {
      if (isPlainObject(choice) && typeof choice.id === "string") ids.add(choice.id);
    }
  }
  const levels = normalizeBuildLevels(build);
  const subclassByClass = isPlainObject(build.subclassByClass)
    ? /** @type {Record<string, string>} */ (build.subclassByClass)
    : {};
  const totals = getClassLevelTotals(levels);
  totals.forEach((info, index) => {
    if (index === 0) ids.add(classSkillChoiceId(info.classId));
    else ids.add(multiclassSkillChoiceId(info.classId));
  });
  for (const slot of getAsiSlots(levels, registry)) ids.add(asiChoiceId(slot.characterLevel));
  for (const feature of getBuildFeatures(levels, subclassByClass, registry)) {
    const featureEntry = getContentByKind(registry, "feature", feature.featureId);
    if (featureEntry?.data?.subfeatureOptions || EXPERTISE_FEATURE_IDS.has(feature.featureId)) {
      ids.add(featureChoiceId(feature.featureId));
    }
  }
  return ids;
}

/**
 * Whether the current race/background carry any build-time choices.
 * @param {CharacterBuildState} build
 * @param {ContentRegistry} registry
 * @returns {boolean}
 */
export function hasOriginChoices(build, registry) {
  const raceEntry = getContentByKind(registry, "race", cleanString(build.raceId));
  const subraceEntry = getContentByKind(registry, "subrace", cleanString(build.subraceId));
  const backgroundEntry = getContentByKind(registry, "background", cleanString(build.backgroundId));
  for (const parent of [raceEntry, subraceEntry, backgroundEntry]) {
    const choices = Array.isArray(parent?.data?.choices) ? parent.data.choices : [];
    if (choices.some((choice) => isPlainObject(choice) && typeof choice.id === "string")) return true;
  }
  return false;
}

/**
 * Whether the build has any class-driven choices (skills, expertise,
 * fighting styles, ASI/feat slots).
 * @param {CharacterBuildState} build
 * @param {ContentRegistry} registry
 * @returns {boolean}
 */
export function hasClassChoices(build, registry) {
  const levels = normalizeBuildLevels(build);
  if (!levels.length) return false;
  const totals = getClassLevelTotals(levels);
  for (let i = 0; i < totals.length; i += 1) {
    const classEntry = getContentByKind(registry, "class", totals[i].classId);
    const source = i === 0
      ? classEntry?.data?.skillChoices
      : (isPlainObject(classEntry?.data?.multiclassing) ? classEntry.data.multiclassing.skillChoices : null);
    if (isPlainObject(source)) return true;
  }
  if (getAsiSlots(levels, registry).length) return true;
  const subclassByClass = isPlainObject(build.subclassByClass)
    ? /** @type {Record<string, string>} */ (build.subclassByClass)
    : {};
  for (const feature of getBuildFeatures(levels, subclassByClass, registry)) {
    if (EXPERTISE_FEATURE_IDS.has(feature.featureId)) return true;
    const featureEntry = getContentByKind(registry, "feature", feature.featureId);
    if (featureEntry?.data?.subfeatureOptions) return true;
  }
  return false;
}

/**
 * Whether any class in the build has spellcasting at its current level.
 * @param {CharacterBuildState} build
 * @param {ContentRegistry} registry
 * @returns {boolean}
 */
export function hasSpellcastingClasses(build, registry) {
  const derived = deriveCharacter({ build, overrides: null }, registry);
  return !!derived.spellcasting && derived.spellcasting.classes.length > 0;
}

/**
 * Reads how many values are stored for a choice id (0 for unset).
 * @param {CharacterBuildState} build
 * @param {string} choiceId
 * @returns {number}
 */
function countStoredChoiceValues(build, choiceId) {
  const stored = readChoice(build, choiceId);
  if (Array.isArray(stored)) return stored.map(cleanString).filter(Boolean).length;
  return cleanString(stored) ? 1 : 0;
}

/**
 * Human-readable summaries of every count-bearing choice the draft build has
 * not finished: class/multiclass skills, subclass picks the class level has
 * reached, feature subfeature options, expertise, ASI/feat slots (including
 * partially assigned ASIs), and cantrip/known/spellbook/prepared spell
 * counts below their derived caps. Guidance only — Finish stays allowed
 * (everything here is completable later via Edit in Builder or Level Up),
 * matching the multiclass-prerequisite stance.
 *
 * @param {CharacterBuildState} build
 * @param {ContentRegistry} registry
 * @returns {string[]}
 */
export function getIncompleteChoiceSummaries(build, registry) {
  /** @type {string[]} */
  const out = [];

  // Required origin choices (ancestry, race/subrace spell choices) — reported
  // regardless of class levels so a subrace cantrip appears in the summary.
  for (const choice of getRequiredOriginChoices(build, registry)) {
    if (!choice.filled) out.push(`${choice.label}: not chosen`);
  }

  const levels = normalizeBuildLevels(build);
  if (!levels.length) return out;
  const totals = getClassLevelTotals(levels);
  const subclassByClass = isPlainObject(build.subclassByClass)
    ? /** @type {Record<string, string>} */ (build.subclassByClass)
    : {};

  // Class / multiclass skill choices.
  totals.forEach((info, index) => {
    const classEntry = getContentByKind(registry, "class", info.classId);
    if (!classEntry) return;
    const source = index === 0
      ? classEntry.data?.skillChoices
      : (isPlainObject(classEntry.data?.multiclassing) ? classEntry.data.multiclassing.skillChoices : null);
    if (!isPlainObject(source)) return;
    const choose = Number(source.choose);
    if (!Number.isInteger(choose) || choose < 1) return;
    const choiceId = index === 0 ? classSkillChoiceId(info.classId) : multiclassSkillChoiceId(info.classId);
    const picked = countStoredChoiceValues(build, choiceId);
    if (picked < choose) out.push(`${classEntry.name} skills: ${picked} of ${choose} chosen`);
  });

  // Subclass picks the class level has reached.
  for (const info of totals) {
    const classEntry = getContentByKind(registry, "class", info.classId);
    const subclassLevel = Number(classEntry?.data?.subclassLevel);
    const subclassIds = Array.isArray(classEntry?.data?.subclassIds) ? classEntry.data.subclassIds : [];
    if (!Number.isInteger(subclassLevel) || info.level < subclassLevel || !subclassIds.length) continue;
    if (!cleanString(subclassByClass[info.classId])) {
      out.push(`${classEntry?.name || info.classId}: subclass not chosen`);
    }
  }

  // Feature subfeature choices (Fighting Style) and expertise.
  const seenFeatureChoices = new Set();
  for (const feature of getBuildFeatures(levels, subclassByClass, registry)) {
    if (seenFeatureChoices.has(feature.featureId)) continue;
    const featureEntry = getContentByKind(registry, "feature", feature.featureId);
    const subOptions = featureEntry && isPlainObject(featureEntry.data?.subfeatureOptions)
      ? featureEntry.data.subfeatureOptions
      : null;
    if (subOptions && Array.isArray(subOptions.from) && subOptions.from.length) {
      seenFeatureChoices.add(feature.featureId);
      const choose = Number.isInteger(Number(subOptions.choose)) ? Number(subOptions.choose) : 1;
      const picked = countStoredChoiceValues(build, featureChoiceId(feature.featureId));
      if (picked < choose) {
        out.push(`${featureEntry?.name || feature.featureId}: ${picked} of ${choose} chosen`);
      }
      continue;
    }
    if (EXPERTISE_FEATURE_IDS.has(feature.featureId)) {
      seenFeatureChoices.add(feature.featureId);
      const picked = countStoredChoiceValues(build, featureChoiceId(feature.featureId));
      if (picked < EXPERTISE_CHOICE_COUNT) {
        out.push(`${featureEntry?.name || "Expertise"} (Level ${feature.characterLevel}): ${picked} of ${EXPERTISE_CHOICE_COUNT} skills chosen`);
      }
    }
  }

  // ASI / feat slots, including partially assigned ASIs.
  for (const slot of getAsiSlots(levels, registry)) {
    const stored = readChoice(build, asiChoiceId(slot.characterLevel));
    if (!isPlainObject(stored)) {
      out.push(`Level ${slot.characterLevel} Ability Score Improvement: not chosen`);
      continue;
    }
    if (stored.type === "feat") {
      if (!cleanString(stored.featId)) out.push(`Level ${slot.characterLevel} feat: not chosen`);
      continue;
    }
    const increases = isPlainObject(stored.increases) ? stored.increases : {};
    let assigned = 0;
    for (const value of Object.values(increases)) {
      const n = Number(value);
      if (Number.isFinite(n)) assigned += n;
    }
    if (assigned < 2) {
      out.push(`Level ${slot.characterLevel} Ability Score Improvement: ${assigned} of 2 points assigned`);
    }
  }

  // Spell selections below their derived caps.
  const selections = isPlainObject(build.spellcasting)
    ? /** @type {Record<string, unknown>} */ (build.spellcasting)
    : {};
  for (const caster of getSpellcastingClasses(levels, registry)) {
    const classEntry = getContentByKind(registry, "class", caster.classId);
    const className = classEntry?.name || caster.classId;
    const selection = isPlainObject(selections[caster.classId])
      ? /** @type {Record<string, unknown>} */ (selections[caster.classId])
      : {};
    const count = (/** @type {unknown} */ list) => (Array.isArray(list)
      ? list.map(cleanString).filter(Boolean).length
      : 0);
    if (caster.cantripsKnownMax != null && count(selection.cantripIds) < caster.cantripsKnownMax) {
      out.push(`${className} cantrips: ${count(selection.cantripIds)} of ${caster.cantripsKnownMax} chosen`);
    }
    if (caster.preparationMode === "known" && caster.spellsKnownMax != null &&
      count(selection.knownIds) < caster.spellsKnownMax) {
      out.push(`${className} known spells: ${count(selection.knownIds)} of ${caster.spellsKnownMax} chosen`);
    }
    if (caster.preparationMode === "spellbook") {
      const target = SPELLBOOK_INITIAL_SPELLS + SPELLBOOK_SPELLS_PER_LEVEL * (caster.classLevel - 1);
      if (count(selection.knownIds) < target) {
        out.push(`${className} spellbook: ${count(selection.knownIds)} of ${target} spells chosen`);
      }
    }
  }

  return out;
}

/**
 * The stored ancestry-style required choice (id + stored value) when the
 * race carries one; used for origin-step validation.
 * @param {CharacterBuildState} build
 * @param {ContentRegistry} registry
 * @returns {{ choiceId: string, value: string } | null}
 */
export function getRequiredAncestryChoice(build, registry) {
  const raceEntry = getContentByKind(registry, "race", cleanString(build.raceId));
  const choices = Array.isArray(raceEntry?.data?.choices) ? raceEntry.data.choices : [];
  const ancestryChoice = choices.find((choice) =>
    isPlainObject(choice) && choice.kind === "ancestry" && typeof choice.id === "string");
  if (!ancestryChoice) return null;
  const choiceId = String(/** @type {Record<string, unknown>} */ (ancestryChoice).id);
  return { choiceId, value: cleanString(readChoice(build, choiceId)) };
}

/**
 * Required origin choices that must be filled before Finish: the ancestry
 * pick (Dragonborn) and any race/subrace spell-list choice (e.g. High Elf's
 * wizard cantrip). Each entry reports whether it is currently satisfied, so
 * the wizard can block Finish and name what is missing. Bonus languages stay
 * guidance-only (they appear in the incomplete-choice summary, not here).
 * @param {CharacterBuildState} build
 * @param {ContentRegistry} registry
 * @returns {Array<{ choiceId: string, label: string, filled: boolean }>}
 */
export function getRequiredOriginChoices(build, registry) {
  /** @type {Array<{ choiceId: string, label: string, filled: boolean }>} */
  const out = [];
  const raceEntry = getContentByKind(registry, "race", cleanString(build.raceId));
  const subraceEntry = getContentByKind(registry, "subrace", cleanString(build.subraceId));
  for (const parent of [raceEntry, subraceEntry]) {
    const choices = Array.isArray(parent?.data?.choices) ? parent.data.choices : [];
    for (const choice of choices) {
      if (!isPlainObject(choice) || typeof choice.id !== "string") continue;
      const kind = cleanString(choice.kind);
      const isSpellChoice = isSpellListChoice(choice);
      if (kind !== "ancestry" && !isSpellChoice) continue;
      const label = kind === "ancestry"
        ? "Draconic Ancestry"
        : `${parent?.name || "Subrace"} ${kind === "cantrip" ? "cantrip" : "spell"}`;
      out.push({ choiceId: choice.id, label, filled: countStoredChoiceValues(build, choice.id) >= 1 });
    }
  }
  return out;
}

/**
 * Renders `count` linked selects that prevent duplicate picks.
 * Stored value is a string (count 1) or string array (count > 1).
 * Shared primitive (also used by the Level Up wizard).
 *
 * @param {WizardStepContext} ctx
 * @param {HTMLElement} parent
 * @param {{
 *   label: string,
 *   count: number,
 *   options: Array<{ value: string, label: string }>,
 *   choiceId: string,
 *   levelKey: string,
 *   emptyLabel?: string
 * }} config
 */
export function renderMultiPickChoice(ctx, parent, config) {
  const { label, count, options, choiceId, levelKey } = config;
  const build = ctx.getDraft().build;
  const stored = readChoice(build, choiceId);
  const values = Array.isArray(stored)
    ? stored.map(cleanString)
    : (cleanString(stored) ? [cleanString(stored)] : []);

  const field = el(parent, "div", "builderIdentityField builderChoiceField");
  el(field, "span", "", label);

  /** @type {HTMLSelectElement[]} */
  const selects = [];
  const persist = () => {
    const picked = selects.map((select) => cleanString(select.value)).filter(Boolean);
    const unique = [...new Set(picked)];
    if (!unique.length) writeChoice(build, levelKey, choiceId, undefined);
    else writeChoice(build, levelKey, choiceId, count === 1 ? unique[0] : unique);
    ctx.onDraftChanged();
  };

  for (let i = 0; i < count; i += 1) {
    const select = makeSelect(field, options, values[i] || "", config.emptyLabel || "Choose…");
    // Label each picker for assistive tech (and stable test targeting); when
    // count > 1 disambiguate the individual selects.
    select.setAttribute("aria-label", count > 1 ? `${label} (${i + 1})` : label);
    select.dataset.choiceId = choiceId;
    select.addEventListener("change", () => {
      const value = cleanString(select.value);
      if (value) {
        for (const other of selects) {
          if (other !== select && other.value === value) other.value = "";
        }
      }
      persist();
    }, { signal: ctx.signal });
    selects.push(select);
    ctx.enhanceSelect(select);
  }
}

/* ------------------------------------------------------------------ */
/* Race & background choices                                          */
/* ------------------------------------------------------------------ */

/**
 * Renders the data-driven race + background choices (ancestry, languages).
 * Returns whether any choice exists (the step is skipped otherwise).
 *
 * @param {WizardStepContext} ctx
 * @param {HTMLElement} container
 * @param {{ onAncestryChanged?: () => void }} [hooks]
 * @returns {boolean}
 */
export function renderOriginChoicesStep(ctx, container, hooks = {}) {
  const registry = ctx.getRegistry();
  const build = ctx.getDraft().build;
  clearChildren(container);
  let rendered = false;

  /**
   * @param {import("../../domain/rules/builtinContent.js").BuiltinContentEntry | null} parentEntry
   * @param {string} parentLabel
   */
  const renderParentChoices = (parentEntry, parentLabel) => {
    const choices = Array.isArray(parentEntry?.data?.choices) ? parentEntry.data.choices : [];
    for (const choice of choices) {
      if (!isPlainObject(choice) || typeof choice.id !== "string") continue;
      const count = Number.isInteger(Number(choice.count)) ? Number(choice.count) : 1;
      const kind = cleanString(choice.kind);
      if (kind === "ancestry") {
        rendered = true;
        renderAncestryChoice(ctx, container, choice, hooks);
        continue;
      }
      if (kind === "language") {
        rendered = true;
        const from = isPlainObject(choice.from) ? choice.from : {};
        /** @type {Array<{ value: string, label: string }>} */
        let options;
        if (Array.isArray(from.options)) {
          options = from.options
            .map((id) => {
              const entry = getContentByKind(registry, "language", cleanString(id));
              return entry ? { value: entry.id, label: entry.name } : null;
            })
            .filter((option) => option != null);
        } else {
          options = listContentByKind(registry, "language")
            .map((entry) => ({ value: entry.id, label: entry.name }));
        }
        renderMultiPickChoice(ctx, container, {
          label: `${parentLabel}: choose ${count} language${count > 1 ? "s" : ""}`,
          count,
          options,
          choiceId: choice.id,
          levelKey: "1",
          emptyLabel: "Choose language"
        });
        continue;
      }
      if (isSpellListChoice(choice)) {
        rendered = true;
        const options = resolveSpellChoiceOptions(registry, choice.from)
          .map((entry) => ({ value: entry.id, label: entry.name }));
        const noun = kind === "cantrip" ? "cantrip" : "spell";
        renderMultiPickChoice(ctx, container, {
          label: `${parentLabel}: choose ${count} ${noun}${count > 1 ? "s" : ""}`,
          count,
          options,
          choiceId: choice.id,
          levelKey: "1",
          emptyLabel: `Choose ${noun}`
        });
      }
    }
  };

  const raceEntry = getContentByKind(registry, "race", cleanString(build.raceId));
  const subraceEntry = getContentByKind(registry, "subrace", cleanString(build.subraceId));
  const backgroundEntry = getContentByKind(registry, "background", cleanString(build.backgroundId));
  renderParentChoices(raceEntry, raceEntry?.name || "Race");
  renderParentChoices(subraceEntry, subraceEntry?.name || "Subrace");
  renderParentChoices(backgroundEntry, backgroundEntry?.name || "Background");
  return rendered;
}

/**
 * @param {WizardStepContext} ctx
 * @param {HTMLElement} container
 * @param {Record<string, unknown>} choice
 * @param {{ onAncestryChanged?: () => void }} hooks
 */
function renderAncestryChoice(ctx, container, choice, hooks) {
  const registry = ctx.getRegistry();
  const build = ctx.getDraft().build;
  const choiceId = String(choice.id);
  const stored = cleanString(readChoice(build, choiceId));

  const field = el(container, "div", "builderIdentityField builderChoiceField");
  const label = /** @type {HTMLLabelElement} */ (document.createElement("label"));
  label.setAttribute("for", "builderWizardDraconicAncestry");
  label.textContent = "Draconic Ancestry";
  field.appendChild(label);

  const options = listContentByKind(registry, "ancestry")
    .map((entry) => ({ value: entry.id, label: entry.name }));
  const select = makeSelect(field, options, stored, "Choose ancestry");
  // Stable id keeps existing smoke/unit coverage and styling hooks intact;
  // the preview body doubles as the select's description for screen readers.
  select.id = "builderWizardDraconicAncestry";
  select.setAttribute("aria-describedby", "builderWizardRaceChoicePreviewBody");
  select.addEventListener("change", () => {
    const value = cleanString(select.value);
    writeChoice(build, "1", choiceId, value || undefined);
    ctx.onDraftChanged();
    hooks.onAncestryChanged?.();
  }, { signal: ctx.signal });
  ctx.enhanceSelect(select);
}

/* ------------------------------------------------------------------ */
/* Classes & levels                                                   */
/* ------------------------------------------------------------------ */

export { getClassBlocks, setClassBlocks };

/**
 * Renders the Classes & Levels step as an ordered, per-character-level
 * editor. Each row is exactly one entry of `build.levels[]`, in order, so
 * interleaved multiclass builds (e.g. Fighter 1 → Wizard 1 → Fighter 2) are
 * represented and edited without being reordered. All mutations go through
 * the ordered level operations in progression.js — never setClassBlocks.
 *
 * @param {WizardStepContext} ctx
 * @param {HTMLElement} container
 */
export function renderClassesStep(ctx, container) {
  const registry = ctx.getRegistry();
  const draft = ctx.getDraft();
  const build = draft.build;
  clearChildren(container);

  const levels = normalizeBuildLevels(build);
  const totalLevel = levels.length;
  const classLevelAt = getClassLevelAtEachCharacterLevel(levels);
  const classOptions = listContentByKind(registry, "class")
    .map((entry) => ({ value: entry.id, label: entry.name }));

  const headline = el(container, "div", "builderClassesHeadline");
  el(headline, "span", "builderClassesTotal", `Character Level: ${totalLevel || 0} / ${MAX_CHARACTER_LEVEL}`);

  const rerender = () => {
    ctx.onDraftChanged();
    renderClassesStep(ctx, container);
  };

  // Multiclass prerequisite warnings (guided, never blocking).
  const distinctClasses = getClassLevelTotals(levels);
  if (distinctClasses.length > 1) {
    const derived = deriveCharacter({ build, overrides: null }, registry);
    /** @type {Record<string, number | null>} */
    const totals = {};
    for (const key of CHARACTER_ABILITY_KEYS) totals[key] = derived.abilities[key]?.total ?? null;
    /** @type {string[]} */
    const problems = [];
    for (const info of distinctClasses) {
      const check = checkMulticlassPrerequisites(info.classId, totals, registry);
      if (!check.ok) {
        const classEntry = getContentByKind(registry, "class", info.classId);
        problems.push(`${classEntry?.name || info.classId} needs ${check.unmet.join(", ")}`);
      }
    }
    if (problems.length) {
      el(container, "div", "builderWizardValidation builderMulticlassWarning",
        `Multiclass prerequisites not met (allowed, but house-rules territory): ${problems.join("; ")}.`);
    }
  }

  // One ordered row per character level: class picker, HP (level 2+), and a
  // remove button (level 2+). Editing a row mutates only that level.
  const levelsSection = el(container, "section", "builderLevelList");
  el(levelsSection, "h4", "builderWizardSubTitle", "Levels (in order)");
  el(levelsSection, "p", "builderAbilityMethodNote",
    "Each row is one character level, in the order gained. Level 1 uses the maximum hit die; " +
    "leave a later level's HP blank to use the SRD average (die ÷ 2 + 1), or enter a rolled value.");

  levels.forEach((row, index) => {
    const classEntry = getContentByKind(registry, "class", row.classId);
    const die = Number(classEntry?.data?.hitDie);
    const levelRow = el(levelsSection, "div", "builderLevelRow");
    el(levelRow, "span", "builderLevelRowLabel",
      `Level ${index + 1}${classEntry ? ` — ${classEntry.name} ${classLevelAt[index]}` : ""}`);

    const classSelect = makeSelect(levelRow, classOptions, row.classId, "Choose class");
    classSelect.setAttribute("aria-label", `Class for level ${index + 1}`);
    classSelect.addEventListener("change", () => {
      const nextId = cleanString(classSelect.value);
      if (!nextId) {
        classSelect.value = row.classId;
        return;
      }
      if (setLevelClassAt(build, index, nextId)) rerender();
    }, { signal: ctx.signal });
    ctx.enhanceSelect(classSelect);

    if (index >= 1) {
      const hpInput = /** @type {HTMLInputElement} */ (document.createElement("input"));
      hpInput.type = "number";
      hpInput.className = "builderLevelHpInput";
      hpInput.min = "1";
      hpInput.max = Number.isFinite(die) ? String(die) : "20";
      hpInput.step = "1";
      hpInput.inputMode = "numeric";
      hpInput.setAttribute("aria-label", `Hit points rolled at level ${index + 1}`);
      hpInput.placeholder = Number.isFinite(die) ? `avg ${Math.trunc(die / 2) + 1}` : "avg";
      hpInput.value = row.hp != null ? String(row.hp) : "";
      hpInput.addEventListener("input", () => {
        // HP edits never re-render (keeps focus); they stay attached to this
        // exact character-level index.
        if (setLevelHpAt(build, index, hpInput.value)) ctx.onDraftChanged();
      }, { signal: ctx.signal });
      levelRow.appendChild(hpInput);

      const removeBtn = /** @type {HTMLButtonElement} */ (el(levelRow, "button", "npcSmallBtn builderLevelRemoveBtn", "✕"));
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", `Remove level ${index + 1}`);
      removeBtn.addEventListener("click", () => {
        if (removeLevelAt(build, index)) rerender();
      }, { signal: ctx.signal });
    }
  });

  // Add the next level (defaults to the most recent class for convenience).
  if (totalLevel < MAX_CHARACTER_LEVEL) {
    const addWrap = el(levelsSection, "div", "builderAddLevelWrap");
    const defaultClassId = levels.length ? levels[levels.length - 1].classId : "";
    const addSelect = makeSelect(addWrap, classOptions, "", "Add next level as…");
    addSelect.setAttribute("aria-label", "Add the next character level");
    addSelect.addEventListener("change", () => {
      const classId = cleanString(addSelect.value) || defaultClassId;
      if (!classId) return;
      if (appendLevel(build, classId)) rerender();
    }, { signal: ctx.signal });
    ctx.enhanceSelect(addSelect);
    if (defaultClassId) {
      const addBtn = /** @type {HTMLButtonElement} */ (el(addWrap, "button", "npcSmallBtn builderAddLevelBtn", "+ Add level"));
      addBtn.type = "button";
      const defaultName = getContentByKind(registry, "class", defaultClassId)?.name || defaultClassId;
      addBtn.setAttribute("aria-label", `Add another ${defaultName} level`);
      addBtn.addEventListener("click", () => {
        if (appendLevel(build, defaultClassId)) rerender();
      }, { signal: ctx.signal });
    }
  }

  // Subclass selects: one per distinct class that has reached its subclass
  // level, keyed by class (multiple levels of a class share one subclass).
  const subclassClasses = distinctClasses.filter((info) => {
    const classEntry = getContentByKind(registry, "class", info.classId);
    const subclassLevel = Number(classEntry?.data?.subclassLevel);
    const subclassIds = Array.isArray(classEntry?.data?.subclassIds) ? classEntry.data.subclassIds : [];
    return Number.isInteger(subclassLevel) && info.level >= subclassLevel && subclassIds.length > 0;
  });
  if (subclassClasses.length) {
    const subclassSection = el(container, "section", "builderSubclassSection");
    el(subclassSection, "h4", "builderWizardSubTitle", "Subclasses");
    if (!isPlainObject(build.subclassByClass)) build.subclassByClass = {};
    for (const info of subclassClasses) {
      const classEntry = getContentByKind(registry, "class", info.classId);
      const flavor = cleanString(classEntry?.data && /** @type {{subclassFlavor?: unknown}} */ (classEntry.data).subclassFlavor);
      const subclassField = el(subclassSection, "div", "builderIdentityField builderSubclassField");
      el(subclassField, "span", "", `${classEntry?.name || info.classId} — ${flavor || "Subclass"}`);
      const subclassOptions = listContentByKind(registry, "subclass")
        .filter((entry) => cleanString(entry.data?.classId) === info.classId)
        .map((entry) => ({ value: entry.id, label: entry.name }));
      const stored = cleanString(/** @type {Record<string, string>} */ (build.subclassByClass)[info.classId]);
      const subclassSelect = makeSelect(subclassField, subclassOptions, stored, "Choose subclass");
      subclassSelect.addEventListener("change", () => {
        const value = cleanString(subclassSelect.value);
        if (value) /** @type {Record<string, string>} */ (build.subclassByClass)[info.classId] = value;
        else delete /** @type {Record<string, string>} */ (build.subclassByClass)[info.classId];
        ctx.onDraftChanged();
      }, { signal: ctx.signal });
      ctx.enhanceSelect(subclassSelect);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Class choices (skills, expertise, fighting styles, ASI/feat)       */
/* ------------------------------------------------------------------ */

/**
 * Renders the class-driven choices step. Returns whether anything rendered.
 * @param {WizardStepContext} ctx
 * @param {HTMLElement} container
 * @returns {boolean}
 */
export function renderClassChoicesStep(ctx, container) {
  const registry = ctx.getRegistry();
  const build = ctx.getDraft().build;
  clearChildren(container);
  let rendered = false;

  const levels = normalizeBuildLevels(build);
  const totals = getClassLevelTotals(levels);
  const subclassByClass = isPlainObject(build.subclassByClass)
    ? /** @type {Record<string, string>} */ (build.subclassByClass)
    : {};
  const skillOptions = listContentByKind(registry, "skill")
    .map((entry) => ({ value: entry.id, label: entry.name }));

  // 1. Class skill choices (first class full choice; later classes get the
  //    class's multiclass skill choice when the SRD grants one).
  totals.forEach((info, index) => {
    const classEntry = getContentByKind(registry, "class", info.classId);
    if (!classEntry) return;
    const source = index === 0
      ? classEntry.data?.skillChoices
      : (isPlainObject(classEntry.data?.multiclassing) ? classEntry.data.multiclassing.skillChoices : null);
    if (!isPlainObject(source)) return;
    const choose = Number(source.choose);
    const from = Array.isArray(source.from) ? source.from.map(cleanString).filter(Boolean) : [];
    if (!Number.isInteger(choose) || choose < 1 || !from.length) return;
    rendered = true;
    const options = from
      .map((skillId) => {
        const entry = getContentByKind(registry, "skill", skillId);
        return { value: skillId, label: entry?.name || skillId };
      });
    renderMultiPickChoice(ctx, container, {
      label: `${classEntry.name}${index === 0 ? "" : " (multiclass)"}: choose ${choose} skill${choose > 1 ? "s" : ""}`,
      count: choose,
      options,
      choiceId: index === 0 ? classSkillChoiceId(info.classId) : multiclassSkillChoiceId(info.classId),
      levelKey: "1",
      emptyLabel: "Choose skill"
    });
  });

  // 2. Feature subfeature choices (e.g. Fighting Style) and expertise.
  const seenFeatureChoices = new Set();
  for (const feature of getBuildFeatures(levels, subclassByClass, registry)) {
    if (seenFeatureChoices.has(feature.featureId)) continue;
    const featureEntry = getContentByKind(registry, "feature", feature.featureId);
    const levelKey = String(feature.characterLevel);
    const subOptions = featureEntry && isPlainObject(featureEntry.data?.subfeatureOptions)
      ? featureEntry.data.subfeatureOptions
      : null;
    if (subOptions && Array.isArray(subOptions.from) && subOptions.from.length) {
      seenFeatureChoices.add(feature.featureId);
      rendered = true;
      const choose = Number.isInteger(Number(subOptions.choose)) ? Number(subOptions.choose) : 1;
      const options = subOptions.from.map((subId) => {
        const subEntry = getContentByKind(registry, "feature", cleanString(subId));
        return {
          value: cleanString(subId),
          label: (subEntry?.name || cleanString(subId)).replace(/^Fighting Style:\s*/, "")
        };
      });
      renderMultiPickChoice(ctx, container, {
        label: `${featureEntry?.name || feature.featureId} (Level ${feature.characterLevel})`,
        count: choose,
        options,
        choiceId: featureChoiceId(feature.featureId),
        levelKey,
        emptyLabel: "Choose option"
      });
      continue;
    }
    if (EXPERTISE_FEATURE_IDS.has(feature.featureId)) {
      seenFeatureChoices.add(feature.featureId);
      rendered = true;
      renderMultiPickChoice(ctx, container, {
        label: `${featureEntry?.name || "Expertise"} (Level ${feature.characterLevel}): choose ${EXPERTISE_CHOICE_COUNT} skills`,
        count: EXPERTISE_CHOICE_COUNT,
        options: skillOptions,
        choiceId: featureChoiceId(feature.featureId),
        levelKey,
        emptyLabel: "Choose skill"
      });
    }
  }

  // 3. ASI-or-feat slots.
  const featOptions = listContentByKind(registry, "feat")
    .map((entry) => ({ value: entry.id, label: entry.source === "custom" ? `${entry.name} (custom)` : entry.name }));
  const abilityOptions = CHARACTER_ABILITY_KEYS
    .map((key) => ({ value: key, label: ABILITY_LABELS[key] }));
  for (const slot of getAsiSlots(levels, registry)) {
    rendered = true;
    renderAsiSlot(ctx, container, slot, featOptions, abilityOptions);
  }

  return rendered;
}

/**
 * Renders one ASI-or-feat slot editor. Shared with the Level Up wizard so
 * both flows keep the identical stored-choice shape.
 * @param {WizardStepContext} ctx
 * @param {HTMLElement} container
 * @param {{ characterLevel: number, classId: string, classLevel: number }} slot
 * @param {Array<{ value: string, label: string }>} featOptions
 * @param {Array<{ value: string, label: string }>} abilityOptions
 */
export function renderAsiSlot(ctx, container, slot, featOptions, abilityOptions) {
  const registry = ctx.getRegistry();
  const build = ctx.getDraft().build;
  const choiceId = asiChoiceId(slot.characterLevel);
  const levelKey = String(slot.characterLevel);
  const stored = readChoice(build, choiceId);
  const storedType = isPlainObject(stored) && stored.type === "feat" ? "feat" : "asi";
  const classEntry = getContentByKind(registry, "class", slot.classId);

  const section = el(container, "section", "builderAsiSlot");
  el(section, "h4", "builderWizardSubTitle",
    `Level ${slot.characterLevel} — Ability Score Improvement (${classEntry?.name || slot.classId} ${slot.classLevel})`);

  const modeField = el(section, "div", "builderIdentityField");
  el(modeField, "span", "", "Improvement type");
  const modeSelect = makeSelect(modeField, [
    { value: "asi", label: "Ability Score Improvement (+2 total)" },
    { value: "feat", label: "Feat" }
  ], storedType, "Choose…");
  modeSelect.value = storedType;
  ctx.enhanceSelect(modeSelect);

  const body = el(section, "div", "builderAsiBody");

  // SRD 5.1: "you can't increase an ability score above 20 using this
  // feature." Guidance-only, matching the multiclass-prerequisite stance.
  const capWarning = el(section, "div", "builderWizardValidation builderMulticlassWarning builderAsiCapWarning");
  capWarning.hidden = true;
  const refreshCapWarning = () => {
    const totals = getBuildAbilityTotals(build, registry);
    const over = Object.entries(totals)
      .filter(([, total]) => total != null && total > 20)
      .map(([ability]) => ability.toUpperCase());
    capWarning.hidden = over.length === 0;
    capWarning.textContent = over.length
      ? `Above the SRD ability cap of 20 (allowed, but house-rules territory): ${over.join(", ")}.`
      : "";
  };

  const renderBody = () => {
    clearChildren(body);
    const current = readChoice(build, choiceId);
    if (modeSelect.value === "feat") {
      const featField = el(body, "div", "builderIdentityField");
      el(featField, "span", "", "Feat");
      const storedFeat = isPlainObject(current) && current.type === "feat" ? cleanString(current.featId) : "";
      const featSelect = makeSelect(featField, featOptions, storedFeat, "Choose feat");
      featSelect.addEventListener("change", () => {
        const featId = cleanString(featSelect.value);
        writeChoice(build, levelKey, choiceId, featId ? { type: "feat", featId } : undefined);
        ctx.onDraftChanged();
      }, { signal: ctx.signal });
      ctx.enhanceSelect(featSelect);
      const featId = cleanString(featSelect.value);
      if (featId) {
        const featEntry = getContentByKind(registry, "feat", featId);
        const desc = cleanString(featEntry?.data?.desc);
        if (desc) el(body, "p", "builderFeatDesc", desc);
      }
      return;
    }
    // ASI: two +1 picks (same ability twice = +2).
    const storedIncreases = isPlainObject(current) && current.type === "asi" && isPlainObject(current.increases)
      ? /** @type {Record<string, unknown>} */ (current.increases)
      : {};
    /** @type {string[]} */
    const picks = [];
    for (const [ability, amount] of Object.entries(storedIncreases)) {
      const n = Number(amount);
      for (let i = 0; i < n && picks.length < 2; i += 1) picks.push(ability);
    }
    /** @type {HTMLSelectElement[]} */
    const selects = [];
    const persist = () => {
      /** @type {Record<string, number>} */
      const increases = {};
      for (const select of selects) {
        const ability = cleanString(select.value);
        if (ability) increases[ability] = (increases[ability] || 0) + 1;
      }
      writeChoice(build, levelKey, choiceId,
        Object.keys(increases).length ? { type: "asi", increases } : undefined);
      ctx.onDraftChanged();
      refreshCapWarning();
    };
    for (let i = 0; i < 2; i += 1) {
      const field = el(body, "div", "builderIdentityField");
      el(field, "span", "", `+1 to ability ${i + 1}`);
      const select = makeSelect(field, abilityOptions, picks[i] || "", "Choose ability");
      select.addEventListener("change", persist, { signal: ctx.signal });
      selects.push(select);
      ctx.enhanceSelect(select);
    }
  };

  modeSelect.addEventListener("change", () => {
    writeChoice(build, levelKey, choiceId, undefined);
    ctx.onDraftChanged();
    renderBody();
    refreshCapWarning();
  }, { signal: ctx.signal });
  renderBody();
  refreshCapWarning();
}

/* ------------------------------------------------------------------ */
/* Spells                                                              */
/* ------------------------------------------------------------------ */

/**
 * @param {CharacterBuildState} build
 * @param {string} classId
 * @returns {{ cantripIds: string[], knownIds: string[], preparedIds: string[] }}
 */
function ensureSpellSelection(build, classId) {
  if (!isPlainObject(build.spellcasting)) build.spellcasting = {};
  const bucket = /** @type {Record<string, unknown>} */ (build.spellcasting);
  if (!isPlainObject(bucket[classId])) bucket[classId] = { cantripIds: [], knownIds: [], preparedIds: [] };
  const selection = /** @type {Record<string, unknown>} */ (bucket[classId]);
  if (!Array.isArray(selection.cantripIds)) selection.cantripIds = [];
  if (!Array.isArray(selection.knownIds)) selection.knownIds = [];
  if (!Array.isArray(selection.preparedIds)) selection.preparedIds = [];
  return /** @type {{ cantripIds: string[], knownIds: string[], preparedIds: string[] }} */ (selection);
}

const ORDINALS = ["Cantrips", "1st Level", "2nd Level", "3rd Level", "4th Level", "5th Level", "6th Level", "7th Level", "8th Level", "9th Level"];

/**
 * Renders the spells step for every spellcasting class in the build.
 * Returns whether the build has any spellcasting.
 * @param {WizardStepContext} ctx
 * @param {HTMLElement} container
 * @returns {boolean}
 */
export function renderSpellsStep(ctx, container) {
  const registry = ctx.getRegistry();
  const draft = ctx.getDraft();
  const build = draft.build;
  clearChildren(container);

  const derived = deriveCharacter({ build, overrides: null }, registry);
  const spellcasting = derived.spellcasting;
  if (!spellcasting || !spellcasting.classes.length) return false;

  // Slots overview.
  const slotsRow = el(container, "div", "builderSpellSlotsRow");
  const slotParts = spellcasting.slots
    .map((count, index) => (count > 0 ? `${ORDINALS[index + 1]}: ${count}` : null))
    .filter(Boolean);
  if (spellcasting.pact) {
    slotParts.push(`Pact: ${spellcasting.pact.slots} × level ${spellcasting.pact.slotLevel}`);
  }
  el(slotsRow, "span", "builderSummaryLabel", "Spell Slots");
  el(slotsRow, "span", "builderSummaryValue", slotParts.length ? slotParts.join(", ") : "None");

  const allSpells = listContentByKind(registry, "spell");

  for (const casterInfo of spellcasting.classes) {
    const classEntry = getContentByKind(registry, "class", casterInfo.classId);
    const selection = ensureSpellSelection(build, casterInfo.classId);
    const section = el(container, "section", "builderSpellClassSection");
    el(section, "h4", "builderWizardSubTitle", `${casterInfo.className} Spellcasting`);

    const meta = el(section, "div", "builderWizardSummaryRows");
    const metaRows = [
      ["Ability", ABILITY_LABELS[/** @type {keyof typeof ABILITY_LABELS} */ (casterInfo.ability)] || casterInfo.ability.toUpperCase()],
      ["Spell Save DC", casterInfo.saveDc != null ? String(casterInfo.saveDc) : "—"],
      ["Spell Attack", casterInfo.attackBonus != null ? `+${casterInfo.attackBonus}` : "—"],
      ["Ritual Casting", casterInfo.ritualCasting ? "Yes" : "No"]
    ];
    for (const [label, value] of metaRows) {
      const row = el(meta, "div", "builderSummaryRow");
      el(row, "div", "builderSummaryLabel", label);
      el(row, "div", "builderSummaryValue", value);
    }

    const classSpells = allSpells.filter((entry) => {
      const classIds = Array.isArray(entry.data?.classIds) ? entry.data.classIds : [];
      return classIds.includes(casterInfo.classId);
    });

    // Granted spells (e.g. domain spells) — display only.
    const granted = derived.grantedSpells.filter((grant) => grant.classId === casterInfo.classId);
    if (granted.length) {
      const grantedRow = el(section, "div", "builderGrantedSpells");
      const names = granted.map((grant) => {
        const spellEntry = getContentByKind(registry, "spell", grant.spellId);
        return spellEntry?.name || grant.spellId;
      });
      el(grantedRow, "span", "builderSummaryLabel", "Always Prepared");
      el(grantedRow, "span", "builderSummaryValue", names.join(", "));
    }

    const filterField = el(section, "div", "builderSpellFilterField");
    const filterInput = /** @type {HTMLInputElement} */ (document.createElement("input"));
    filterInput.type = "search";
    filterInput.className = "settingsInput";
    filterInput.placeholder = `Filter ${casterInfo.className} spells…`;
    filterInput.setAttribute("aria-label", `Filter ${casterInfo.className} spells`);
    filterField.appendChild(filterInput);

    const listsWrap = el(section, "div", "builderSpellLists");

    const mode = casterInfo.preparationMode;
    /** @type {Array<{ key: "cantripIds" | "knownIds" | "preparedIds", title: string, spellLevels: number[], maxLabel: () => string }>} */
    const groups = [];
    groups.push({
      key: "cantripIds",
      title: "Cantrips",
      spellLevels: [0],
      maxLabel: () => casterInfo.cantripsKnownMax != null
        ? `${selection.cantripIds.length} / ${casterInfo.cantripsKnownMax} known`
        : `${selection.cantripIds.length} chosen`
    });
    const maxSlotLevel = (() => {
      let max = 0;
      spellcasting.slots.forEach((count, index) => { if (count > 0) max = index + 1; });
      if (spellcasting.pact && casterInfo.progression === "pact") max = Math.max(max, spellcasting.pact.slotLevel);
      return Math.max(max, 1);
    })();
    const leveled = Array.from({ length: maxSlotLevel }, (_, i) => i + 1);
    if (mode === "prepared") {
      groups.push({
        key: "preparedIds",
        title: "Prepared Spells",
        spellLevels: leveled,
        maxLabel: () => casterInfo.preparedMax != null
          ? `${selection.preparedIds.length} / ${casterInfo.preparedMax} prepared`
          : `${selection.preparedIds.length} prepared`
      });
    } else if (mode === "spellbook") {
      groups.push({
        key: "knownIds",
        title: "Spellbook",
        spellLevels: leveled,
        maxLabel: () => `${selection.knownIds.length} in spellbook (start with 6, +2 per wizard level)`
      });
      groups.push({
        key: "preparedIds",
        title: "Prepared Spells (from spellbook)",
        spellLevels: leveled,
        maxLabel: () => casterInfo.preparedMax != null
          ? `${selection.preparedIds.length} / ${casterInfo.preparedMax} prepared`
          : `${selection.preparedIds.length} prepared`
      });
    } else {
      groups.push({
        key: "knownIds",
        title: "Known Spells",
        spellLevels: leveled,
        maxLabel: () => casterInfo.spellsKnownMax != null
          ? `${selection.knownIds.length} / ${casterInfo.spellsKnownMax} known`
          : `${selection.knownIds.length} known`
      });
    }

    const renderLists = () => {
      clearChildren(listsWrap);
      const filter = filterInput.value.trim().toLowerCase();
      for (const group of groups) {
        const groupEl = el(listsWrap, "div", "builderSpellGroup");
        const groupHead = el(groupEl, "div", "builderSpellGroupHead");
        el(groupHead, "span", "builderSpellGroupTitle", group.title);
        const countEl = el(groupHead, "span", "builderSpellGroupCount", group.maxLabel());
        const sourcePool = group.key === "preparedIds" && mode === "spellbook"
          ? classSpells.filter((entry) => selection.knownIds.includes(entry.id))
          : classSpells;
        for (const spellLevel of group.spellLevels) {
          const levelSpells = sourcePool
            .filter((entry) => Number(entry.data?.level) === spellLevel)
            .filter((entry) => !filter || entry.name.toLowerCase().includes(filter));
          if (!levelSpells.length) continue;
          const details = /** @type {HTMLDetailsElement} */ (document.createElement("details"));
          details.className = "builderSpellLevelDetails";
          details.open = !!filter || spellLevel === 0;
          const summaryEl = document.createElement("summary");
          summaryEl.textContent = `${ORDINALS[spellLevel]} (${levelSpells.length})`;
          details.appendChild(summaryEl);
          const list = document.createElement("div");
          list.className = "builderSpellCheckList";
          for (const spellEntry of levelSpells) {
            const label = document.createElement("label");
            label.className = "builderSpellCheckItem";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = selection[group.key].includes(spellEntry.id);
            checkbox.addEventListener("change", () => {
              const list = selection[group.key];
              const index = list.indexOf(spellEntry.id);
              if (checkbox.checked && index < 0) list.push(spellEntry.id);
              if (!checkbox.checked && index >= 0) list.splice(index, 1);
              if (group.key === "knownIds" && mode === "spellbook" && !checkbox.checked) {
                // Removing a spellbook spell unprepares it.
                const preparedIndex = selection.preparedIds.indexOf(spellEntry.id);
                if (preparedIndex >= 0) selection.preparedIds.splice(preparedIndex, 1);
              }
              countEl.textContent = group.maxLabel();
              ctx.onDraftChanged();
            }, { signal: ctx.signal });
            label.appendChild(checkbox);
            const nameSpan = document.createElement("span");
            const ritual = spellEntry.data?.ritual === true ? " (ritual)" : "";
            const concentration = spellEntry.data?.concentration === true ? " (conc.)" : "";
            nameSpan.textContent = `${spellEntry.name}${ritual}${concentration}`;
            label.appendChild(nameSpan);
            list.appendChild(label);
          }
          details.appendChild(list);
          groupEl.appendChild(details);
        }
      }
    };
    filterInput.addEventListener("input", renderLists, { signal: ctx.signal });
    renderLists();

    if (!classSpells.length && classEntry) {
      el(section, "p", "builderAbilityMethodNote", `No SRD spell list found for ${classEntry.name}.`);
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Equipment                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {CharacterBuildState} build
 * @returns {{ armorId: string | null, shield: boolean, weaponIds: string[], startingChoices: Record<string, unknown>, notes: string }}
 */
function ensureEquipment(build) {
  if (!isPlainObject(build.equipment)) {
    build.equipment = { armorId: null, shield: false, weaponIds: [], startingChoices: {}, notes: "" };
  }
  const equipment = /** @type {Record<string, unknown>} */ (build.equipment);
  if (!Array.isArray(equipment.weaponIds)) equipment.weaponIds = [];
  if (!isPlainObject(equipment.startingChoices)) equipment.startingChoices = {};
  if (typeof equipment.notes !== "string") equipment.notes = "";
  return /** @type {ReturnType<typeof ensureEquipment>} */ (equipment);
}

/**
 * Describes a normalized starting-equipment option for radio labels.
 * @param {Record<string, unknown>} option
 * @returns {string}
 */
function describeEquipmentOption(option) {
  if (Array.isArray(option.items)) {
    return option.items.map((item) => describeEquipmentOption(/** @type {Record<string, unknown>} */ (item))).join(" + ");
  }
  if (typeof option.itemId === "string") {
    const quantity = Number(option.quantity) > 1 ? `${option.quantity}× ` : "";
    return `${quantity}${cleanString(option.name) || option.itemId}`;
  }
  if (typeof option.categoryId === "string") {
    return `Any ${cleanString(option.categoryName) || option.categoryId}`;
  }
  return cleanString(option.desc) || "Option";
}

/**
 * Renders the equipment step: armor/shield/weapons plus SRD-guided starting
 * equipment choices from the first class and background.
 * @param {WizardStepContext} ctx
 * @param {HTMLElement} container
 */
export function renderEquipmentStep(ctx, container) {
  const registry = ctx.getRegistry();
  const draft = ctx.getDraft();
  const build = draft.build;
  const equipment = ensureEquipment(build);
  clearChildren(container);

  // AC preview reflects the current picks.
  const acRow = el(container, "div", "builderSpellSlotsRow builderAcPreviewRow");
  const acLabel = el(acRow, "span", "builderSummaryLabel", "Armor Class");
  const acValue = el(acRow, "span", "builderSummaryValue", "");
  acLabel.id = "builderWizardAcPreviewLabel";
  const refreshAc = () => {
    const derived = deriveCharacter({ build, overrides: null }, registry);
    acValue.textContent = derived.ac?.value != null
      ? `${derived.ac.value}${derived.ac.formula ? ` (${derived.ac.formula})` : ""}`
      : "—";
  };

  // Armor + shield.
  const armorField = el(container, "div", "builderIdentityField");
  el(armorField, "span", "", "Armor");
  const armorOptions = listContentByKind(registry, "armor")
    .filter((entry) => cleanString(entry.data?.armorCategory) !== "shield")
    .map((entry) => ({ value: entry.id, label: entry.name }));
  const armorSelect = makeSelect(armorField, armorOptions, cleanString(equipment.armorId), "No armor");
  armorSelect.id = "builderWizardArmorSelect";
  armorSelect.addEventListener("change", () => {
    equipment.armorId = cleanString(armorSelect.value) || null;
    ctx.onDraftChanged();
    refreshAc();
  }, { signal: ctx.signal });
  ctx.enhanceSelect(armorSelect);

  const shieldField = el(container, "label", "builderEquipmentShieldField");
  const shieldCheckbox = /** @type {HTMLInputElement} */ (document.createElement("input"));
  shieldCheckbox.type = "checkbox";
  shieldCheckbox.checked = equipment.shield === true;
  shieldCheckbox.addEventListener("change", () => {
    equipment.shield = shieldCheckbox.checked;
    ctx.onDraftChanged();
    refreshAc();
  }, { signal: ctx.signal });
  shieldField.appendChild(shieldCheckbox);
  el(shieldField, "span", "", "Shield (+2 AC)");

  // Weapons.
  const weaponsSection = el(container, "section", "builderWeaponsSection");
  el(weaponsSection, "h4", "builderWizardSubTitle", "Weapons");
  const weaponListEl = el(weaponsSection, "div", "builderWeaponList");
  const weaponOptions = listContentByKind(registry, "weapon")
    .map((entry) => ({ value: entry.id, label: entry.name }));
  const renderWeaponList = () => {
    clearChildren(weaponListEl);
    equipment.weaponIds.forEach((weaponId, index) => {
      const entry = getContentByKind(registry, "weapon", weaponId);
      const row = el(weaponListEl, "div", "builderWeaponRow");
      const damage = cleanString(entry?.data?.damage);
      const damageType = cleanString(entry?.data?.damageType);
      el(row, "span", "builderWeaponName",
        `${entry?.name || weaponId}${damage ? ` — ${damage}${damageType ? ` ${damageType}` : ""}` : ""}`);
      const removeBtn = /** @type {HTMLButtonElement} */ (el(row, "button", "npcSmallBtn", "✕"));
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", `Remove ${entry?.name || weaponId}`);
      removeBtn.addEventListener("click", () => {
        equipment.weaponIds.splice(index, 1);
        ctx.onDraftChanged();
        renderWeaponList();
      }, { signal: ctx.signal });
    });
  };
  renderWeaponList();
  const addWeaponField = el(weaponsSection, "div", "builderIdentityField");
  const addWeaponSelect = makeSelect(addWeaponField, weaponOptions, "", "Add a weapon…");
  addWeaponSelect.setAttribute("aria-label", "Add a weapon");
  addWeaponSelect.addEventListener("change", () => {
    const weaponId = cleanString(addWeaponSelect.value);
    if (weaponId) {
      equipment.weaponIds.push(weaponId);
      addWeaponSelect.value = "";
      ctx.onDraftChanged();
      renderWeaponList();
    }
  }, { signal: ctx.signal });
  ctx.enhanceSelect(addWeaponSelect);

  // SRD-guided starting equipment from the first class + background.
  const levels = normalizeBuildLevels(build);
  const firstClassId = levels.length ? levels[0].classId : "";
  const sources = [
    { key: `class:${firstClassId}`, entry: firstClassId ? getContentByKind(registry, "class", firstClassId) : null },
    { key: `background:${cleanString(build.backgroundId)}`, entry: getContentByKind(registry, "background", cleanString(build.backgroundId)) }
  ];
  for (const source of sources) {
    if (!source.entry) continue;
    const fixed = Array.isArray(source.entry.data?.startingEquipment) ? source.entry.data.startingEquipment : [];
    const optionGroups = Array.isArray(source.entry.data?.startingEquipmentOptions)
      ? source.entry.data.startingEquipmentOptions
      : [];
    if (!fixed.length && !optionGroups.length) continue;
    const section = el(container, "section", "builderStartingEquipmentSection");
    el(section, "h4", "builderWizardSubTitle", `${source.entry.name} Starting Equipment`);
    if (fixed.length) {
      el(section, "p", "builderAbilityMethodNote",
        `Included: ${fixed.map((item) => describeEquipmentOption(/** @type {Record<string, unknown>} */ (item))).join(", ")}`);
    }
    optionGroups.forEach((group, groupIndex) => {
      if (!isPlainObject(group)) return;
      const groupKey = `${source.key}:${groupIndex}`;
      const options = Array.isArray(group.options) ? group.options.filter(isPlainObject) : [];
      if (!options.length) return;
      const field = el(section, "div", "builderIdentityField builderChoiceField");
      el(field, "span", "", cleanString(group.desc) || `Choose ${group.choose ?? 1}`);
      const selectOptions = options.map((option, optionIndex) => ({
        value: String(optionIndex),
        label: describeEquipmentOption(option)
      }));
      const storedRaw = /** @type {Record<string, unknown>} */ (equipment.startingChoices)[groupKey];
      const storedIndex = isPlainObject(storedRaw) ? cleanString(storedRaw.optionIndex) : "";
      const groupSelect = makeSelect(field, selectOptions, storedIndex, "Choose option");
      /** @type {HTMLSelectElement | null} */
      let categorySelect = null;

      const persistGroup = () => {
        const optionIndex = cleanString(groupSelect.value);
        if (!optionIndex) {
          delete /** @type {Record<string, unknown>} */ (equipment.startingChoices)[groupKey];
          ctx.onDraftChanged();
          return;
        }
        const option = options[Number(optionIndex)];
        /** @type {Record<string, unknown>} */
        const record = { optionIndex, label: describeEquipmentOption(option) };
        if (categorySelect && cleanString(categorySelect.value)) {
          record.itemId = cleanString(categorySelect.value);
          const itemOptions = Array.isArray(option.itemOptions) ? option.itemOptions : [];
          const item = itemOptions.find((it) => isPlainObject(it) && it.itemId === record.itemId);
          if (item) record.label = cleanString(/** @type {Record<string, unknown>} */ (item).name) || record.label;
        }
        /** @type {Record<string, unknown>} */ (equipment.startingChoices)[groupKey] = record;
        ctx.onDraftChanged();
      };

      const renderCategoryPicker = () => {
        if (categorySelect) {
          categorySelect.remove();
          categorySelect = null;
        }
        const optionIndex = cleanString(groupSelect.value);
        if (!optionIndex) return;
        const option = options[Number(optionIndex)];
        const itemOptions = Array.isArray(option?.itemOptions) ? option.itemOptions.filter(isPlainObject) : [];
        if (!itemOptions.length) return;
        const stored = isPlainObject(/** @type {Record<string, unknown>} */ (equipment.startingChoices)[groupKey])
          ? cleanString(/** @type {Record<string, Record<string, unknown>>} */ (equipment.startingChoices)[groupKey].itemId)
          : "";
        categorySelect = makeSelect(field, itemOptions.map((item) => ({
          value: cleanString(/** @type {Record<string, unknown>} */ (item).itemId),
          label: cleanString(/** @type {Record<string, unknown>} */ (item).name) || cleanString(/** @type {Record<string, unknown>} */ (item).itemId)
        })), stored, "Choose item");
        categorySelect.addEventListener("change", persistGroup, { signal: ctx.signal });
        ctx.enhanceSelect(categorySelect);
      };

      groupSelect.addEventListener("change", () => {
        renderCategoryPicker();
        persistGroup();
      }, { signal: ctx.signal });
      ctx.enhanceSelect(groupSelect);
      renderCategoryPicker();
    });
  }

  // Free-form notes.
  const notesSection = el(container, "section", "builderEquipmentNotesSection");
  el(notesSection, "h4", "builderWizardSubTitle", "Other Equipment");
  const notes = /** @type {HTMLTextAreaElement} */ (document.createElement("textarea"));
  notes.className = "settingsInput builderEquipmentNotes";
  notes.rows = 3;
  notes.placeholder = "Anything else your character carries…";
  notes.value = equipment.notes;
  notes.addEventListener("input", () => {
    equipment.notes = notes.value;
    ctx.onDraftChanged();
  }, { signal: ctx.signal });
  notesSection.appendChild(notes);

  refreshAc();
}
