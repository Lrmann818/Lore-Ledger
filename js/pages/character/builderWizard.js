// @ts-check
// Builder creation/edit wizard: identity → origin choices → classes &
// levels → class choices → abilities → spells → equipment → summary.
// Steps with nothing to show are skipped. The draft build uses the v2
// level-by-level shape; dynamic steps live in builderWizardSteps.js.

import {
  CHARACTER_ABILITY_KEYS,
  clonePlainBuild,
  isBuilderCharacter,
  makeDefaultCharacterBuild,
  normalizeCharacterBuild
} from "../../domain/characterHelpers.js";

// Re-exported for existing callers/tests; the implementation moved to
// characterHelpers.js so the Level Up wizard can share it.
export { clonePlainBuild };
import { deriveCharacter } from "../../domain/rules/deriveCharacter.js";
import {
  getActiveContentRegistry,
  getContentByKind,
  listContentByKind
} from "../../domain/rules/registry.js";
import {
  collectActiveChoiceIds,
  getRequiredAncestryChoice,
  hasClassChoices,
  hasOriginChoices,
  hasSpellcastingClasses,
  pruneStaleChoices,
  renderClassChoicesStep,
  renderClassesStep,
  renderEquipmentStep,
  renderOriginChoicesStep,
  renderSpellsStep
} from "./builderWizardSteps.js";
import {
  appendLevel,
  normalizeBuildLevels,
  setLevelClassAt
} from "../../domain/rules/progression.js";
import { enhanceSelectDropdown } from "../../ui/selectDropdown.js";
import { getNoopDestroyApi, requireMany } from "../../utils/domGuards.js";

const MIN_ABILITY_SCORE = 1;
const MAX_ABILITY_SCORE = 20;
const DEFAULT_NAME = "New Builder Character";
const NOT_SELECTED_LABEL = "Not selected";
const STANDARD_ARRAY_SCORES = Object.freeze([15, 14, 13, 12, 10, 8]);
const ROLL_MODE_4D6_DROP_LOWEST = "4d6-drop-lowest";
const ROLL_MODE_3D6_STRAIGHT = "3d6-straight";
const ROLL_MODES = Object.freeze([
  { id: ROLL_MODE_4D6_DROP_LOWEST, label: "4d6 drop lowest" },
  { id: ROLL_MODE_3D6_STRAIGHT, label: "3d6 straight" }
]);
const POINT_BUY_BUDGET = 27;
const POINT_BUY_MIN_SCORE = 8;
const POINT_BUY_MAX_SCORE = 15;
const POINT_BUY_COSTS = Object.freeze({
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9
});
const ABILITY_METHODS = Object.freeze([
  { id: "manual", label: "Manual", enabled: true },
  { id: "standard-array", label: "Standard Array", enabled: true },
  { id: "point-buy", label: "Point Buy", enabled: true },
  { id: "roll", label: "Roll", enabled: true }
]);

const ABILITY_META = Object.freeze({
  str: { suffix: "Str", label: "STR" },
  dex: { suffix: "Dex", label: "DEX" },
  con: { suffix: "Con", label: "CON" },
  int: { suffix: "Int", label: "INT" },
  wis: { suffix: "Wis", label: "WIS" },
  cha: { suffix: "Cha", label: "CHA" }
});
const ABILITY_FULL_NAMES = Object.freeze({
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
});

const STEP_IDENTITY = "identity";
const STEP_ORIGIN = "race-choices";
const STEP_CLASSES = "classes";
const STEP_CLASS_CHOICES = "class-choices";
const STEP_ABILITIES = "abilities";
const STEP_SPELLS = "spells";
const STEP_EQUIPMENT = "equipment";
const STEP_SUMMARY = "summary";
const STEP_ORDER = Object.freeze([
  STEP_IDENTITY,
  STEP_ORIGIN,
  STEP_CLASSES,
  STEP_CLASS_CHOICES,
  STEP_ABILITIES,
  STEP_SPELLS,
  STEP_EQUIPMENT,
  STEP_SUMMARY
]);

/**
 * @typedef {{
 *   name: string,
 *   build: import("../../state.js").CharacterBuildState,
 *   characterId: string | null
 * }} BuilderWizardResult
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInteger(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/**
 * @param {unknown} value
 * @param {"race" | "subrace" | "class" | "background"} kind
 * @returns {string | null}
 */
function normalizeContentId(value, kind) {
  const id = cleanString(value);
  if (!id) return null;
  return getContentByKind(getActiveContentRegistry(), kind, id) ? id : null;
}

/**
 * @param {HTMLSelectElement} select
 * @param {"race" | "class" | "background"} kind
 * @param {unknown} selectedId
 * @returns {void}
 */
function populateContentSelect(select, kind, selectedId) {
  const selected = cleanString(selectedId);
  const entries = listContentByKind(getActiveContentRegistry(), kind);
  select.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = NOT_SELECTED_LABEL;
  select.appendChild(emptyOption);

  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.source === "custom" ? `${entry.name} (custom)` : entry.name;
    select.appendChild(option);
  }

  select.value = selected && entries.some((entry) => entry.id === selected) ? selected : "";
}

/**
 * @param {number} value
 * @returns {string}
 */
function signedNumber(value) {
  return value >= 0 ? `+${value}` : String(value);
}

/**
 * @param {string} value
 * @returns {string}
 */
function titleCase(value) {
  const clean = cleanString(value);
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "";
}

/**
 * @param {import("../../domain/rules/deriveCharacter.js").DragonbornAncestryDerived["breathWeapon"]} bw
 * @returns {string}
 */
function formatBreathWeaponArea(bw) {
  if (bw.shape === "cone" && bw.size != null) return `${bw.size} ft. cone`;
  if (bw.shape === "line" && bw.width != null && bw.length != null) {
    return `${bw.width} by ${bw.length} ft. line`;
  }
  return bw.shape;
}

/**
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @returns {Array<[string, string]>}
 */
function getDragonbornAncestryRows(derived) {
  const da = derived.dragonbornAncestry;
  if (!da) return [];
  const saveLabel = /** @type {Record<string, string>} */ (ABILITY_FULL_NAMES)[da.breathWeapon.saveAbility] ?? da.breathWeapon.saveAbility;
  const damageTypeLabel = titleCase(da.damageType);
  const breathSummary = `${formatBreathWeaponArea(da.breathWeapon)}, ${damageTypeLabel}, ${saveLabel} save`;
  const conMod = derived.abilities.con?.modifier;
  const dcDisplay = da.breathWeapon.saveDC != null && conMod != null && derived.proficiencyBonus != null
    ? `8 + ${ABILITY_FULL_NAMES.con} modifier (${signedNumber(conMod)}) + Proficiency Bonus (${signedNumber(derived.proficiencyBonus)}) = ${da.breathWeapon.saveDC}`
    : NOT_SELECTED_LABEL;
  return [
    ["Draconic Ancestry", da.name],
    ["Damage Resistance", damageTypeLabel],
    ["Breath Weapon", breathSummary],
    ["Breath Weapon DC", dcDisplay],
    ["Breath Weapon Damage", da.breathWeapon.damageDice]
  ];
}

/**
 * @param {HTMLElement} parent
 * @param {string} className
 * @param {string} text
 * @returns {HTMLElement}
 */
function appendDiv(parent, className, text) {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

/**
 * @param {string} mode
 * @param {() => number} rollDie
 * @returns {number}
 */
export function rollBuilderAbilityScore(mode, rollDie = () => Math.floor(Math.random() * 6) + 1) {
  const diceCount = mode === ROLL_MODE_3D6_STRAIGHT ? 3 : 4;
  const rolls = [];
  for (let i = 0; i < diceCount; i += 1) {
    const value = Math.trunc(Number(rollDie()));
    if (!Number.isInteger(value) || value < 1 || value > 6) {
      throw new Error("Builder ability roll die result must be an integer from 1 to 6.");
    }
    rolls.push(value);
  }
  if (mode === ROLL_MODE_3D6_STRAIGHT) {
    return rolls.reduce((total, value) => total + value, 0);
  }
  const sorted = [...rolls].sort((a, b) => a - b);
  return sorted.slice(1).reduce((total, value) => total + value, 0);
}

/**
 * @param {string} mode
 * @param {() => number} rollDie
 * @param {number} generation
 * @returns {Array<{ id: string, value: number }>}
 */
export function rollBuilderAbilityScorePool(mode, rollDie = () => Math.floor(Math.random() * 6) + 1, generation = 1) {
  const pool = [];
  for (let i = 0; i < 6; i += 1) {
    pool.push({
      id: `roll-${generation}-${i + 1}`,
      value: rollBuilderAbilityScore(mode, rollDie)
    });
  }
  return pool;
}

/**
 * @param {HTMLElement} panel
 * @returns {HTMLElement[]}
 */
function getFocusable(panel) {
  const selectors = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "a[href]",
    "[tabindex]:not([tabindex='-1'])"
  ];
  return /** @type {HTMLElement[]} */ (Array.from(panel.querySelectorAll(selectors.join(",")))
    .filter((el) => !!el &&
      typeof /** @type {HTMLElement} */ (el).focus === "function" &&
      !/** @type {HTMLElement} */ (el).hidden &&
      !/** @type {HTMLElement} */ (el).closest("[hidden]") &&
      !/** @type {HTMLElement} */ (el).classList.contains("nativeSelectHidden")));
}

/**
 * @param {unknown} value
 * @param {string} tagName
 * @returns {boolean}
 */
function hasTagName(value, tagName) {
  return !!value &&
    typeof value === "object" &&
    String(/** @type {{ tagName?: unknown }} */ (value).tagName || "").toUpperCase() === tagName.toUpperCase();
}

/**
 * @param {{
 *   root?: ParentNode,
 *   Popovers?: import("../../ui/popovers.js").PopoversApi | null,
 *   rollDie?: () => number,
 *   onFinish?: (result: BuilderWizardResult) => void,
 *   setStatus?: (message: string, options?: Record<string, unknown>) => void
 * }} [deps]
 * @returns {{ open: (options?: { character?: import("../../state.js").CharacterEntry | null }) => void, close: () => void, destroy: () => void }}
 */
export function initBuilderWizard(deps = {}) {
  const {
    root = document,
    Popovers = null,
    rollDie = () => Math.floor(Math.random() * 6) + 1,
    onFinish,
    setStatus
  } = deps;

  const guard = requireMany(
    {
      overlay: "#builderWizardOverlay",
      panel: "#builderWizardPanel",
      title: "#builderWizardTitle",
      closeBtn: "#builderWizardClose",
      name: "#builderWizardName",
      race: "#builderWizardRace",
      subraceField: "#builderWizardSubraceField",
      subrace: "#builderWizardSubrace",
      class: "#builderWizardClass",
      background: "#builderWizardBackground",
      level: "#builderWizardLevel",
      identityValidation: "#builderWizardIdentityValidation",
      stepRaceChoices: "#builderWizardStepRaceChoices",
      originChoicesBody: "#builderWizardOriginChoices",
      raceChoicesValidation: "#builderWizardRaceChoicesValidation",
      stepClasses: "#builderWizardStepClasses",
      classesBody: "#builderWizardClassesBody",
      classesValidation: "#builderWizardClassesValidation",
      stepClassChoices: "#builderWizardStepClassChoices",
      classChoicesBody: "#builderWizardClassChoicesBody",
      stepSpells: "#builderWizardStepSpells",
      spellsBody: "#builderWizardSpellsBody",
      stepEquipment: "#builderWizardStepEquipment",
      equipmentBody: "#builderWizardEquipmentBody",
      methodManual: "#builderWizardAbilityMethodManual",
      stepIdentity: "#builderWizardStepIdentity",
      stepAbilities: "#builderWizardStepAbilities",
      stepSummary: "#builderWizardStepSummary",
      summary: "#builderWizardSummary",
      backBtn: "#builderWizardBack",
      nextBtn: "#builderWizardNext",
      finishBtn: "#builderWizardFinish",
      cancelBtn: "#builderWizardCancel"
    },
    {
      root,
      setStatus,
      context: "Builder wizard",
      devAssert: false,
      warn: false
    }
  );
  if (!guard.ok) {
    const noop = getNoopDestroyApi();
    return {
      open() {},
      close() {},
      destroy: noop.destroy
    };
  }

  const overlay = /** @type {HTMLElement} */ (guard.els.overlay);
  const panel = /** @type {HTMLElement} */ (guard.els.panel);
  const titleEl = /** @type {HTMLElement} */ (guard.els.title);
  const closeBtn = /** @type {HTMLButtonElement} */ (guard.els.closeBtn);
  const nameInput = /** @type {HTMLInputElement} */ (guard.els.name);
  const raceSelect = /** @type {HTMLSelectElement} */ (guard.els.race);
  const subraceField = /** @type {HTMLElement} */ (guard.els.subraceField);
  const subraceSelect = /** @type {HTMLSelectElement} */ (guard.els.subrace);
  const classSelect = /** @type {HTMLSelectElement} */ (guard.els.class);
  const backgroundSelect = /** @type {HTMLSelectElement} */ (guard.els.background);
  const levelDisplay = /** @type {HTMLElement} */ (guard.els.level);
  const identityValidation = /** @type {HTMLElement} */ (guard.els.identityValidation);
  const stepRaceChoices = /** @type {HTMLElement} */ (guard.els.stepRaceChoices);
  const originChoicesBody = /** @type {HTMLElement} */ (guard.els.originChoicesBody);
  const raceChoicesValidation = /** @type {HTMLElement} */ (guard.els.raceChoicesValidation);
  const stepClasses = /** @type {HTMLElement} */ (guard.els.stepClasses);
  const classesBody = /** @type {HTMLElement} */ (guard.els.classesBody);
  const classesValidation = /** @type {HTMLElement} */ (guard.els.classesValidation);
  const stepClassChoices = /** @type {HTMLElement} */ (guard.els.stepClassChoices);
  const classChoicesBody = /** @type {HTMLElement} */ (guard.els.classChoicesBody);
  const stepSpells = /** @type {HTMLElement} */ (guard.els.stepSpells);
  const spellsBody = /** @type {HTMLElement} */ (guard.els.spellsBody);
  const stepEquipment = /** @type {HTMLElement} */ (guard.els.stepEquipment);
  const equipmentBody = /** @type {HTMLElement} */ (guard.els.equipmentBody);
  let raceChoicePreview = /** @type {HTMLElement | null} */ (root.querySelector?.("#builderWizardRaceChoicePreview"));
  if (!raceChoicePreview) {
    raceChoicePreview = document.createElement("section");
    raceChoicePreview.id = "builderWizardRaceChoicePreview";
    raceChoicePreview.className = "builderChoicePreview";
    raceChoicePreview.setAttribute("aria-labelledby", "builderWizardRaceChoicePreviewTitle");
    raceChoicePreview.setAttribute("aria-describedby", "builderWizardRaceChoicePreviewBody");
    originChoicesBody.insertAdjacentElement("afterend", raceChoicePreview);
  }
  const methodManualInput = /** @type {HTMLInputElement} */ (guard.els.methodManual);
  const stepIdentity = /** @type {HTMLElement} */ (guard.els.stepIdentity);
  const stepAbilities = /** @type {HTMLElement} */ (guard.els.stepAbilities);
  const stepSummary = /** @type {HTMLElement} */ (guard.els.stepSummary);
  const summaryEl = /** @type {HTMLElement} */ (guard.els.summary);
  const backBtn = /** @type {HTMLButtonElement} */ (guard.els.backBtn);
  const nextBtn = /** @type {HTMLButtonElement} */ (guard.els.nextBtn);
  const finishBtn = /** @type {HTMLButtonElement} */ (guard.els.finishBtn);
  const cancelBtn = /** @type {HTMLButtonElement} */ (guard.els.cancelBtn);

  /** @type {Record<string, HTMLInputElement>} */
  const abilityInputs = {};
  for (const key of CHARACTER_ABILITY_KEYS) {
    const suffix = ABILITY_META[key]?.suffix || key;
    const input = root.querySelector?.(`#builderWizardAbility${suffix}`);
    if (hasTagName(input, "input")) abilityInputs[key] = /** @type {HTMLInputElement} */ (input);
  }
  const manualAbilityGrid = /** @type {HTMLElement | null} */ (root.querySelector?.("#builderWizardManualAbilityGrid"));
  const standardArrayGrid = /** @type {HTMLElement | null} */ (root.querySelector?.("#builderWizardStandardArrayGrid"));
  const pointBuyGrid = /** @type {HTMLElement | null} */ (root.querySelector?.("#builderWizardPointBuyGrid"));
  const rollSection = /** @type {HTMLElement | null} */ (root.querySelector?.("#builderWizardRollSection"));
  const rollModeSelect = /** @type {HTMLSelectElement | null} */ (root.querySelector?.("#builderWizardRollMode"));
  const rollButton = /** @type {HTMLButtonElement | null} */ (root.querySelector?.("#builderWizardRollButton"));
  const rollPoolEl = /** @type {HTMLElement | null} */ (root.querySelector?.("#builderWizardRollPool"));
  const rollAssignmentGrid = /** @type {HTMLElement | null} */ (root.querySelector?.("#builderWizardRollAssignmentGrid"));
  const pointBuyRemaining = /** @type {HTMLElement | null} */ (root.querySelector?.("#builderWizardPointBuyRemaining"));
  const abilityValidation = /** @type {HTMLElement | null} */ (root.querySelector?.("#builderWizardAbilityValidation"));
  const methodNote = /** @type {HTMLElement | null} */ (root.querySelector?.("#builderWizardAbilityMethodNote"));
  let raceAbilityBonusPreview = /** @type {HTMLElement | null} */ (root.querySelector?.("#builderWizardRaceAbilityBonusPreview"));
  if (!raceAbilityBonusPreview) {
    raceAbilityBonusPreview = document.createElement("section");
    raceAbilityBonusPreview.id = "builderWizardRaceAbilityBonusPreview";
    raceAbilityBonusPreview.className = "builderAbilityBonusPreview";
    raceAbilityBonusPreview.setAttribute("aria-live", "polite");
    methodNote?.insertAdjacentElement?.("afterend", raceAbilityBonusPreview);
  }
  /** @type {Record<string, HTMLSelectElement>} */
  const standardArraySelects = {};
  for (const key of CHARACTER_ABILITY_KEYS) {
    const suffix = ABILITY_META[key]?.suffix || key;
    const select = root.querySelector?.(`#builderWizardStandardArray${suffix}`);
    if (hasTagName(select, "select")) standardArraySelects[key] = /** @type {HTMLSelectElement} */ (select);
  }
  /** @type {Record<string, HTMLSelectElement>} */
  const rollAssignmentSelects = {};
  for (const key of CHARACTER_ABILITY_KEYS) {
    const suffix = ABILITY_META[key]?.suffix || key;
    const select = root.querySelector?.(`#builderWizardRoll${suffix}`);
    if (hasTagName(select, "select")) rollAssignmentSelects[key] = /** @type {HTMLSelectElement} */ (select);
  }
  /** @type {Record<string, HTMLElement>} */
  const pointBuyValues = {};
  /** @type {Record<string, HTMLButtonElement>} */
  const pointBuyDecreaseButtons = {};
  /** @type {Record<string, HTMLButtonElement>} */
  const pointBuyIncreaseButtons = {};
  for (const key of CHARACTER_ABILITY_KEYS) {
    const suffix = ABILITY_META[key]?.suffix || key;
    const value = root.querySelector?.(`#builderWizardPointBuy${suffix}Value`);
    if (value && typeof value === "object" && "textContent" in value) {
      pointBuyValues[key] = /** @type {HTMLElement} */ (value);
    }
    const decrease = root.querySelector?.(`#builderWizardPointBuy${suffix}Decrease`);
    if (hasTagName(decrease, "button")) pointBuyDecreaseButtons[key] = /** @type {HTMLButtonElement} */ (decrease);
    const increase = root.querySelector?.(`#builderWizardPointBuy${suffix}Increase`);
    if (hasTagName(increase, "button")) pointBuyIncreaseButtons[key] = /** @type {HTMLButtonElement} */ (increase);
  }

  const listenerController = new AbortController();
  const signal = listenerController.signal;
  /** @type {Element | null} */
  let previousFocus = null;
  let currentStep = STEP_IDENTITY;
  let abilityMethod = "manual";
  let identityValidationAttempted = false;
  let raceChoicesValidationAttempted = false;
  let abilityValidationAttempted = false;
  /** @type {string | null} */
  let editingCharacterId = null;
  /** @type {Record<string, number>} */
  let manualAbilityBase = {};
  /** @type {Record<string, string>} */
  let standardArrayAssignments = {};
  /** @type {Record<string, number>} */
  let pointBuyAbilityBase = {};
  /** @type {string} */
  let rollMode = ROLL_MODE_4D6_DROP_LOWEST;
  /** @type {Array<{ id: string, value: number }>} */
  let rollPool = [];
  /** @type {Record<string, string>} */
  let rollAssignments = {};
  let rollGeneration = 0;
  /** @type {Array<{ rebuild?: () => void, close?: () => void, destroy?: () => void }>} */
  const enhancedSelects = [];
  /** @type {Array<{ select: HTMLSelectElement, api: { rebuild?: () => void, close?: () => void, destroy?: () => void } }>} */
  const dynamicEnhancedSelects = [];
  /** @type {{ name: string, build: import("../../state.js").CharacterBuildState }} */
  let draft = {
    name: DEFAULT_NAME,
    build: makeDefaultCharacterBuild()
  };

  /**
   * Enhance a dynamically created select; stale instances (whose select was
   * removed by a re-render) are destroyed lazily on the next call.
   * @param {HTMLSelectElement} select
   */
  function enhanceDynamicSelect(select) {
    for (let i = dynamicEnhancedSelects.length - 1; i >= 0; i -= 1) {
      if (!dynamicEnhancedSelects[i].select.isConnected) {
        try { dynamicEnhancedSelects[i].api.destroy?.(); } catch { /* noop */ }
        dynamicEnhancedSelects.splice(i, 1);
      }
    }
    if (!Popovers) return;
    const api = enhanceSelectDropdown({
      select,
      Popovers,
      buttonClass: "settingsSelectBtn builderWizardSelectBtn",
      optionClass: "swatchOption",
      groupLabelClass: "dropdownGroupLabel",
      preferRight: false
    });
    if (api) dynamicEnhancedSelects.push({ select, api });
  }

  /** @type {import("./builderWizardSteps.js").WizardStepContext} */
  const stepCtx = {
    getDraft: () => draft,
    getRegistry: () => getActiveContentRegistry(),
    signal,
    enhanceSelect: enhanceDynamicSelect,
    onDraftChanged: () => {
      updateLevelDisplay();
      syncStartingClassControl();
    }
  };

  /**
   * @param {unknown} value
   * @returns {value is number}
   */
  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function getDefaultAbilityBase() {
    /** @type {Record<string, number>} */
    const base = {};
    for (const key of CHARACTER_ABILITY_KEYS) base[key] = 10;
    return base;
  }

  function getDefaultPointBuyBase() {
    /** @type {Record<string, number>} */
    const base = {};
    for (const key of CHARACTER_ABILITY_KEYS) base[key] = POINT_BUY_MIN_SCORE;
    return base;
  }

  /**
   * @param {unknown} score
   * @returns {number}
   */
  function getPointBuyCost(score) {
    const value = Number(score);
    return POINT_BUY_COSTS[/** @type {keyof typeof POINT_BUY_COSTS} */ (value)] ?? Number.POSITIVE_INFINITY;
  }

  /**
   * @param {Record<string, number>} base
   * @returns {number}
   */
  function getPointBuySpent(base) {
    return CHARACTER_ABILITY_KEYS.reduce((total, key) => total + getPointBuyCost(base[key]), 0);
  }

  function getPointBuyRemainingPoints() {
    return POINT_BUY_BUDGET - getPointBuySpent(pointBuyAbilityBase);
  }

  function syncManualDraftFromControls() {
    for (const key of CHARACTER_ABILITY_KEYS) {
      manualAbilityBase[key] = clampInteger(
        abilityInputs[key]?.value,
        MIN_ABILITY_SCORE,
        MAX_ABILITY_SCORE,
        Number(manualAbilityBase[key]) || 10
      );
    }
  }

  function syncStandardArrayDraftFromControls() {
    for (const key of CHARACTER_ABILITY_KEYS) {
      const value = standardArraySelects[key]?.value || "";
      standardArrayAssignments[key] = STANDARD_ARRAY_SCORES.includes(Number(value)) ? value : "";
    }
  }

  function syncPointBuyDraftFromControls() {
    for (const key of CHARACTER_ABILITY_KEYS) {
      const raw = pointBuyValues[key]?.textContent;
      const value = Number(raw);
      pointBuyAbilityBase[key] = Number.isInteger(value) ? value : Number.NaN;
    }
  }

  function syncRollDraftFromControls() {
    if (rollModeSelect && ROLL_MODES.some((mode) => mode.id === rollModeSelect.value)) {
      rollMode = rollModeSelect.value;
    }
    for (const key of CHARACTER_ABILITY_KEYS) {
      const value = rollAssignmentSelects[key]?.value || "";
      rollAssignments[key] = rollPool.some((score) => score.id === value) ? value : "";
    }
  }

  function getStandardArrayDuplicateScore() {
    const seen = new Set();
    for (const key of CHARACTER_ABILITY_KEYS) {
      const value = standardArrayAssignments[key];
      if (!value) continue;
      if (seen.has(value)) return value;
      seen.add(value);
    }
    return "";
  }

  function getStandardArrayBaseOrNull() {
    if (getStandardArrayDuplicateScore()) return null;
    /** @type {Record<string, number>} */
    const base = {};
    for (const key of CHARACTER_ABILITY_KEYS) {
      const value = Number(standardArrayAssignments[key]);
      if (!STANDARD_ARRAY_SCORES.includes(value)) return null;
      base[key] = value;
    }
    return base;
  }

  function getRollDuplicateAssignment() {
    const seen = new Set();
    for (const key of CHARACTER_ABILITY_KEYS) {
      const id = rollAssignments[key];
      if (!id) continue;
      if (seen.has(id)) return id;
      seen.add(id);
    }
    return "";
  }

  function getRollBaseOrNull() {
    if (rollPool.length !== 6) return null;
    if (getRollDuplicateAssignment()) return null;
    const scoresById = new Map(rollPool.map((score) => [score.id, score.value]));
    /** @type {Record<string, number>} */
    const base = {};
    for (const key of CHARACTER_ABILITY_KEYS) {
      const id = rollAssignments[key];
      const value = scoresById.get(id);
      if (!id || !Number.isInteger(value) || value < 3 || value > 18) return null;
      base[key] = value;
    }
    return base;
  }

  function getPointBuyBaseOrNull() {
    const spent = getPointBuySpent(pointBuyAbilityBase);
    if (spent < 0 || spent > POINT_BUY_BUDGET) return null;
    /** @type {Record<string, number>} */
    const base = {};
    for (const key of CHARACTER_ABILITY_KEYS) {
      const value = Number(pointBuyAbilityBase[key]);
      if (!Number.isInteger(value) || value < POINT_BUY_MIN_SCORE || value > POINT_BUY_MAX_SCORE) return null;
      base[key] = value;
    }
    return base;
  }

  function getActiveAbilityBaseOrNull() {
    if (abilityMethod === "standard-array") return getStandardArrayBaseOrNull();
    if (abilityMethod === "point-buy") return getPointBuyBaseOrNull();
    if (abilityMethod === "roll") return getRollBaseOrNull();
    return { ...manualAbilityBase };
  }

  /**
   * @param {{ showIncomplete?: boolean }} [options]
   */
  function getAbilityValidationMessage(options = {}) {
    if (abilityMethod === "standard-array") {
      const duplicate = getStandardArrayDuplicateScore();
      if (duplicate) return `Standard Array score ${duplicate} is already assigned. Each score can be used once.`;
      const incomplete = CHARACTER_ABILITY_KEYS.some((key) => !standardArrayAssignments[key]);
      if (incomplete && !options.showIncomplete) return "";
      return incomplete ? "Assign each Standard Array score before continuing." : "";
    }
    if (abilityMethod === "point-buy" && !getPointBuyBaseOrNull()) {
      return "Point Buy scores must stay between 8 and 15 and spend no more than 27 points.";
    }
    if (abilityMethod === "roll") {
      const duplicate = getRollDuplicateAssignment();
      if (duplicate) {
        const score = rollPool.find((item) => item.id === duplicate)?.value;
        return `Rolled score${score ? ` ${score}` : ""} is already assigned. Each rolled score can be used once.`;
      }
      if (rollPool.length !== 6) {
        return options.showIncomplete ? "Roll scores before continuing." : "";
      }
      const incomplete = CHARACTER_ABILITY_KEYS.some((key) => !rollAssignments[key]);
      if (incomplete && !options.showIncomplete) return "";
      if (incomplete) return "Assign each rolled score before continuing.";
      return getRollBaseOrNull() ? "" : "Roll assignments must use valid scores from 3 to 18.";
    }
    return "";
  }

  function getIdentityValidationMessage() {
    const missing = [];
    if (!normalizeContentId(raceSelect.value, "race")) missing.push("race");
    if (!normalizeContentId(classSelect.value, "class")) missing.push("class");
    if (!normalizeContentId(backgroundSelect.value, "background")) missing.push("background");
    return missing.length
      ? "Race, class, and background are required before continuing."
      : "";
  }

  /**
   * @param {{ showIncomplete?: boolean }} [options]
   */
  function getRaceChoicesValidationMessage(options = {}) {
    const required = getRequiredAncestryChoice(draft.build, getActiveContentRegistry());
    if (!required) return "";
    if (!required.value && !options.showIncomplete) return "";
    return required.value ? "" : "Draconic Ancestry is required before continuing.";
  }

  /**
   * @param {string} message
   */
  function showIdentityValidation(message) {
    identityValidation.textContent = message;
    identityValidation.hidden = !message;
    if (message) setStatus?.(message, { stickyMs: 2500 });
  }

  /**
   * @param {string} message
   */
  function showAbilityValidation(message) {
    if (abilityValidation) {
      abilityValidation.textContent = message;
      abilityValidation.hidden = !message;
    }
    if (message) setStatus?.(message, { stickyMs: 2500 });
  }

  /**
   * @param {string} message
   */
  function showRaceChoicesValidation(message) {
    raceChoicesValidation.textContent = message;
    raceChoicesValidation.hidden = !message;
    if (message) setStatus?.(message, { stickyMs: 2500 });
  }

  /**
   * @param {string} message
   */
  function showClassesValidation(message) {
    classesValidation.textContent = message;
    classesValidation.hidden = !message;
    if (message) setStatus?.(message, { stickyMs: 2500 });
  }

  function syncAbilityBaseToDraft() {
    const base = getActiveAbilityBaseOrNull();
    if (!base) return false;
    if (!draft.build.abilities || typeof draft.build.abilities !== "object") {
      draft.build.abilities = { method: abilityMethod, base: {} };
    }
    draft.build.abilities.method = abilityMethod;
    draft.build.abilities.base = { ...base };
    return true;
  }

  function updateLevelDisplay() {
    const total = normalizeBuildLevels(draft.build).length;
    levelDisplay.textContent = `Level ${total || 1}`;
  }

  /**
   * @returns {Record<string, number | null>}
   */
  function getActiveAbilityPreviewBase() {
    /** @type {Record<string, number | null>} */
    const base = {};
    if (abilityMethod === "standard-array") {
      for (const key of CHARACTER_ABILITY_KEYS) {
        const value = Number(standardArrayAssignments[key]);
        base[key] = STANDARD_ARRAY_SCORES.includes(value) ? value : null;
      }
      return base;
    }
    if (abilityMethod === "point-buy") {
      for (const key of CHARACTER_ABILITY_KEYS) {
        const value = Number(pointBuyAbilityBase[key]);
        base[key] = Number.isInteger(value) ? value : null;
      }
      return base;
    }
    if (abilityMethod === "roll") {
      const scoresById = new Map(rollPool.map((score) => [score.id, score.value]));
      for (const key of CHARACTER_ABILITY_KEYS) {
        const id = rollAssignments[key];
        const value = scoresById.get(id);
        base[key] = id && Number.isInteger(value) ? value : null;
      }
      return base;
    }
    for (const key of CHARACTER_ABILITY_KEYS) {
      base[key] = clampInteger(
        abilityInputs[key]?.value,
        MIN_ABILITY_SCORE,
        MAX_ABILITY_SCORE,
        Number(manualAbilityBase[key]) || 10
      );
    }
    return base;
  }

  /**
   * @returns {ReturnType<typeof deriveCharacter>}
   */
  function getAbilityPreviewDerivedCharacter() {
    const previewBase = getActiveAbilityPreviewBase();
    return deriveCharacter({
      id: "builder_wizard_ability_preview",
      name: draft.name,
      build: {
        ...draft.build,
        abilities: {
          base: previewBase
        }
      },
      overrides: {
        abilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
        saves: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
        skills: {},
        initiative: 0
      },
      abilities: {},
      skills: {}
    });
  }

  /**
   * @param {string} key
   * @param {string} method
   * @returns {HTMLElement | null}
   */
  function ensureAbilityPreviewEl(key, method) {
    const suffix = ABILITY_META[key]?.suffix || key;
    const id = `builderWizard${method}Ability${suffix}Preview`;
    const existing = root.querySelector?.(`#${id}`);
    if (existing && typeof existing === "object" && "appendChild" in existing) {
      return /** @type {HTMLElement} */ (existing);
    }
    let parent = null;
    if (method === "Manual") parent = abilityInputs[key]?.closest?.(".builderAbilitiesField") || abilityInputs[key]?.parentElement || null;
    else if (method === "StandardArray") parent = standardArraySelects[key]?.closest?.(".builderAbilitiesField") || standardArraySelects[key]?.parentElement || null;
    else if (method === "PointBuy") parent = pointBuyValues[key]?.closest?.(".builderPointBuyField") || null;
    else if (method === "Roll") parent = rollAssignmentSelects[key]?.closest?.(".builderAbilitiesField") || rollAssignmentSelects[key]?.parentElement || null;
    if (!parent || typeof parent !== "object" || !("appendChild" in parent)) return null;
    const el = document.createElement("div");
    el.id = id;
    el.className = "builderAbilityTotalPreview";
    parent.appendChild(el);
    return el;
  }

  /**
   * @param {string} key
   * @param {ReturnType<typeof deriveCharacter>["abilities"][string] | undefined} ability
   * @param {number} raceBonus
   * @returns {string}
   */
  function formatAbilityPreviewText(key, ability, raceBonus) {
    const label = ABILITY_META[key]?.label || key.toUpperCase();
    if (!ability || !isFiniteNumber(ability.base) || !isFiniteNumber(ability.total)) {
      return `${label}: choose a base score`;
    }
    if (raceBonus) {
      const sign = raceBonus >= 0 ? "+" : "-";
      return `${label}: Base ${ability.base} ${sign} Race ${Math.abs(raceBonus)} = Total ${ability.total}`;
    }
    return `${label}: Base ${ability.base} = Total ${ability.total}`;
  }

  function renderAbilityPreview() {
    const derived = getAbilityPreviewDerivedCharacter();
    const bonusParts = CHARACTER_ABILITY_KEYS
      .map((key) => [key, derived.raceAbilityBonuses[key] || 0])
      .filter(([, bonus]) => bonus !== 0)
      .map(([key, bonus]) => `${signedNumber(/** @type {number} */ (bonus))} ${ABILITY_META[/** @type {string} */ (key)]?.label || String(key).toUpperCase()}`);
    if (raceAbilityBonusPreview) {
      raceAbilityBonusPreview.hidden = bonusParts.length === 0;
      raceAbilityBonusPreview.textContent = bonusParts.length
        ? `Race Ability Bonus: ${bonusParts.join(", ")}`
        : "";
    }

    const methodMap = [
      ["Manual", manualAbilityGrid],
      ["StandardArray", standardArrayGrid],
      ["PointBuy", pointBuyGrid],
      ["Roll", rollAssignmentGrid]
    ];
    for (const [method, container] of methodMap) {
      if (!container) continue;
      for (const key of CHARACTER_ABILITY_KEYS) {
        const el = ensureAbilityPreviewEl(key, /** @type {string} */ (method));
        if (!el) continue;
        const ability = derived.abilities[key];
        const raceBonus = derived.raceAbilityBonuses[key] || 0;
        el.textContent = formatAbilityPreviewText(key, ability, raceBonus);
      }
    }
  }

  function renderAbilityControlsForMethod() {
    if (manualAbilityGrid) manualAbilityGrid.hidden = abilityMethod !== "manual";
    if (standardArrayGrid) standardArrayGrid.hidden = abilityMethod !== "standard-array";
    if (pointBuyGrid) pointBuyGrid.hidden = abilityMethod !== "point-buy";
    if (rollSection) rollSection.hidden = abilityMethod !== "roll";
    for (const key of CHARACTER_ABILITY_KEYS) {
      const input = abilityInputs[key];
      if (input) input.value = String(manualAbilityBase[key] ?? 10);
    }
    renderStandardArraySelects();
    renderPointBuyControls();
    renderRollControls();
    renderAbilityPreview();
    showAbilityValidation(getAbilityValidationMessage({ showIncomplete: abilityValidationAttempted }));
  }

  function renderPointBuyControls() {
    const remaining = getPointBuyRemainingPoints();
    if (pointBuyRemaining) {
      pointBuyRemaining.textContent = String(remaining);
      pointBuyRemaining.setAttribute("aria-label", `${remaining} point buy points remaining`);
    }
    for (const key of CHARACTER_ABILITY_KEYS) {
      const score = Number(pointBuyAbilityBase[key]);
      const currentCost = getPointBuyCost(score);
      const nextCost = getPointBuyCost(score + 1);
      const canDecrease = Number.isInteger(score) && score > POINT_BUY_MIN_SCORE;
      const canIncrease = Number.isInteger(score) &&
        score < POINT_BUY_MAX_SCORE &&
        nextCost - currentCost <= remaining;
      if (pointBuyValues[key]) pointBuyValues[key].textContent = Number.isFinite(score) ? String(score) : "Invalid";
      if (pointBuyDecreaseButtons[key]) pointBuyDecreaseButtons[key].disabled = !canDecrease;
      if (pointBuyIncreaseButtons[key]) pointBuyIncreaseButtons[key].disabled = !canIncrease;
    }
    renderAbilityPreview();
  }

  function renderStandardArraySelects() {
    for (const key of CHARACTER_ABILITY_KEYS) {
      const select = standardArraySelects[key];
      if (!select) continue;
      const current = standardArrayAssignments[key] || "";
      select.innerHTML = "";

      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Choose score";
      select.appendChild(emptyOption);

      for (const score of STANDARD_ARRAY_SCORES) {
        const value = String(score);
        const usedByOtherAbility = CHARACTER_ABILITY_KEYS.some((otherKey) =>
          otherKey !== key && standardArrayAssignments[otherKey] === value
        );
        if (usedByOtherAbility && value !== current) continue;

        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      }

      select.value = current;
    }
    syncEnhancedSelects();
    renderAbilityPreview();
  }

  function renderRollControls() {
    if (rollModeSelect) {
      rollModeSelect.innerHTML = "";
      for (const mode of ROLL_MODES) {
        const option = document.createElement("option");
        option.value = mode.id;
        option.textContent = mode.label;
        rollModeSelect.appendChild(option);
      }
      rollModeSelect.value = ROLL_MODES.some((mode) => mode.id === rollMode) ? rollMode : ROLL_MODE_4D6_DROP_LOWEST;
    }
    if (rollButton) rollButton.textContent = rollPool.length ? "Reroll Scores" : "Roll Scores";
    if (rollPoolEl) {
      rollPoolEl.textContent = rollPool.length
        ? `Generated scores: ${rollPool.map((score) => score.value).join(", ")}`
        : "No scores rolled yet.";
    }
    if (rollAssignmentGrid) rollAssignmentGrid.hidden = rollPool.length !== 6;
    for (const key of CHARACTER_ABILITY_KEYS) {
      const select = rollAssignmentSelects[key];
      if (!select) continue;
      const current = rollAssignments[key] || "";
      select.innerHTML = "";

      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Choose score";
      select.appendChild(emptyOption);

      for (const score of rollPool) {
        const usedByOtherAbility = CHARACTER_ABILITY_KEYS.some((otherKey) =>
          otherKey !== key && rollAssignments[otherKey] === score.id
        );
        if (usedByOtherAbility && score.id !== current) continue;

        const option = document.createElement("option");
        option.value = score.id;
        option.textContent = String(score.value);
        select.appendChild(option);
      }

      select.value = current;
    }
    syncEnhancedSelects();
    renderAbilityPreview();
  }

  function getDraftDerivedCharacter() {
    return deriveCharacter({
      id: "builder_wizard_preview",
      name: draft.name,
      build: draft.build,
      overrides: {
        abilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
        saves: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
        skills: {},
        initiative: 0
      },
      abilities: {},
      skills: {}
    });
  }

  function renderRaceChoicePreview() {
    if (!raceChoicePreview) return;
    raceChoicePreview.innerHTML = "";
    const title = document.createElement("h4");
    title.id = "builderWizardRaceChoicePreviewTitle";
    title.textContent = "Choice Preview";
    raceChoicePreview.appendChild(title);

    const body = document.createElement("div");
    body.id = "builderWizardRaceChoicePreviewBody";
    body.className = "builderChoicePreviewBody";
    raceChoicePreview.appendChild(body);

    if (!getRequiredAncestryChoice(draft.build, getActiveContentRegistry())) {
      raceChoicePreview.hidden = true;
      return;
    }

    raceChoicePreview.hidden = false;
    const derived = getDraftDerivedCharacter();
    const rows = getDragonbornAncestryRows(derived);
    if (!rows.length) {
      body.classList.add("isEmpty");
      body.textContent = "Choose a Draconic Ancestry to preview its breath weapon and resistance.";
      return;
    }

    const rowsEl = appendDiv(body, "builderWizardSummaryRows", "");
    rows.forEach(([label, value]) => {
      const row = appendDiv(rowsEl, "builderSummaryRow", "");
      appendDiv(row, "builderSummaryLabel", label);
      appendDiv(row, "builderSummaryValue", value || NOT_SELECTED_LABEL);
    });
  }

  function renderOriginChoices() {
    renderOriginChoicesStep(stepCtx, originChoicesBody, {
      onAncestryChanged: () => {
        renderRaceChoicePreview();
        renderAbilityPreview();
        showRaceChoicesValidation(getRaceChoicesValidationMessage({ showIncomplete: raceChoicesValidationAttempted }));
      }
    });
    renderRaceChoicePreview();
  }

  function renderSubraceSelect() {
    const registry = getActiveContentRegistry();
    const raceEntry = getContentByKind(registry, "race", cleanString(draft.build.raceId));
    const subraceIds = Array.isArray(raceEntry?.data?.subraceIds)
      ? raceEntry.data.subraceIds.map(cleanString).filter(Boolean)
      : [];
    subraceField.hidden = subraceIds.length === 0;
    subraceSelect.innerHTML = "";
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = subraceIds.length ? "Choose subrace" : NOT_SELECTED_LABEL;
    subraceSelect.appendChild(emptyOption);
    for (const subraceId of subraceIds) {
      const entry = getContentByKind(registry, "subrace", subraceId);
      const option = document.createElement("option");
      option.value = subraceId;
      option.textContent = entry?.name || subraceId;
      subraceSelect.appendChild(option);
    }
    const stored = cleanString(draft.build.subraceId);
    subraceSelect.value = subraceIds.includes(stored) ? stored : "";
    if (!subraceIds.includes(stored)) draft.build.subraceId = null;
    syncEnhancedSelects();
  }

  /**
   * @param {string} nextMethod
   * @returns {boolean}
   */
  function switchAbilityMethod(nextMethod) {
    if (nextMethod === abilityMethod) return true;
    if (abilityMethod === "manual") syncManualDraftFromControls();
    else if (abilityMethod === "standard-array") syncStandardArrayDraftFromControls();
    else if (abilityMethod === "point-buy") syncPointBuyDraftFromControls();
    else if (abilityMethod === "roll") syncRollDraftFromControls();
    abilityMethod = nextMethod;
    syncAbilityBaseToDraft();
    renderAbilityControlsForMethod();
    renderAbilityPreview();
    return true;
  }

  // The Identity "Starting Class" select and the Classes step's level-1 row
  // both edit levels[0].classId — the single source of truth. This applies
  // the Identity control's value to level 1 only, never touching later
  // levels, so interleaved multiclass order is preserved.
  function syncStartingClassToDraft() {
    const classId = normalizeContentId(classSelect.value, "class");
    if (!classId) return;
    const levels = normalizeBuildLevels(draft.build);
    if (!levels.length) {
      appendLevel(draft.build, classId);
      return;
    }
    if (levels[0].classId === classId) return;
    setLevelClassAt(draft.build, 0, classId);
  }

  // Keeps the Identity starting-class control in step with levels[0] after
  // Classes-step edits, so navigation never reads a stale value and
  // reverts level 1.
  function syncStartingClassControl() {
    const levels = normalizeBuildLevels(draft.build);
    const startingClassId = levels.length ? levels[0].classId : "";
    if (classSelect.value !== startingClassId) {
      populateContentSelect(classSelect, "class", startingClassId);
      syncEnhancedSelects();
    }
  }

  function syncDraftFromControls() {
    const summaryNameInput = /** @type {HTMLInputElement | null} */ (root.querySelector?.("#builderWizardSummaryName"));
    const summaryName = currentStep === STEP_SUMMARY && !stepSummary.hidden ? cleanString(summaryNameInput?.value) : "";
    draft.name = summaryName || cleanString(nameInput.value) || DEFAULT_NAME;
    nameInput.value = draft.name;
    draft.build.raceId = normalizeContentId(raceSelect.value, "race");
    draft.build.subraceId = normalizeContentId(subraceSelect.value, "subrace");
    draft.build.backgroundId = normalizeContentId(backgroundSelect.value, "background");
    syncStartingClassToDraft();
    if (!draft.build.abilities || typeof draft.build.abilities !== "object") {
      draft.build.abilities = { method: abilityMethod, base: {} };
    }
    if (!draft.build.abilities.base || typeof draft.build.abilities.base !== "object") {
      draft.build.abilities.base = {};
    }
    if (abilityMethod === "manual") {
      syncManualDraftFromControls();
    } else if (abilityMethod === "standard-array") {
      syncStandardArrayDraftFromControls();
    } else if (abilityMethod === "point-buy") {
      syncPointBuyDraftFromControls();
    } else if (abilityMethod === "roll") {
      syncRollDraftFromControls();
    }
    syncAbilityBaseToDraft();
    pruneStaleChoices(draft.build, collectActiveChoiceIds(draft.build, getActiveContentRegistry()));
    updateLevelDisplay();
  }

  function syncControlsFromDraft() {
    nameInput.value = draft.name;
    populateContentSelect(raceSelect, "race", draft.build.raceId);
    const orderedLevels = normalizeBuildLevels(draft.build);
    populateContentSelect(classSelect, "class", orderedLevels.length ? orderedLevels[0].classId : "");
    populateContentSelect(backgroundSelect, "background", draft.build.backgroundId);
    renderSubraceSelect();
    syncEnhancedSelects();
    updateLevelDisplay();
    manualAbilityBase = { ...getDefaultAbilityBase(), ...draft.build.abilities?.base };
    pointBuyAbilityBase = getDefaultPointBuyBase();
    standardArrayAssignments = {};
    rollMode = ROLL_MODE_4D6_DROP_LOWEST;
    rollPool = [];
    rollAssignments = {};
    rollGeneration = 0;
    for (const key of CHARACTER_ABILITY_KEYS) {
      const input = abilityInputs[key];
      if (!input) continue;
      manualAbilityBase[key] = clampInteger(draft.build.abilities?.base?.[key], MIN_ABILITY_SCORE, MAX_ABILITY_SCORE, 10);
      input.value = String(manualAbilityBase[key]);
      input.min = String(MIN_ABILITY_SCORE);
      input.max = String(MAX_ABILITY_SCORE);
      input.step = "1";
    }
    for (const key of CHARACTER_ABILITY_KEYS) {
      const select = standardArraySelects[key];
      if (!select) continue;
      select.innerHTML = "";
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Choose score";
      select.appendChild(emptyOption);
      for (const score of STANDARD_ARRAY_SCORES) {
        const option = document.createElement("option");
        option.value = String(score);
        option.textContent = String(score);
        select.appendChild(option);
      }
      select.value = "";
    }
    abilityMethod = "manual";
    identityValidationAttempted = false;
    raceChoicesValidationAttempted = false;
    abilityValidationAttempted = false;
    showIdentityValidation("");
    showRaceChoicesValidation("");
    showClassesValidation("");
    renderOriginChoices();
    methodManualInput.checked = true;
    renderAbilityControlsForMethod();
    renderAbilityPreview();
  }

  function syncEnhancedSelects() {
    for (const enhanced of enhancedSelects) {
      try { enhanced.rebuild?.(); } catch { /* noop */ }
    }
  }

  function renderAbilityMethods() {
    for (const method of ABILITY_METHODS) {
      const input = /** @type {HTMLInputElement | null} */ (
        root.querySelector?.(`input[name="builderWizardAbilityMethod"][value="${method.id}"]`)
      );
      if (!input) continue;
      input.checked = method.id === abilityMethod;
      if (method.enabled) {
        input.removeAttribute("aria-disabled");
        input.removeAttribute("tabindex");
      } else {
        input.setAttribute("aria-disabled", "true");
        input.setAttribute("tabindex", "-1");
      }
      const label = input.closest?.(".builderAbilityMethodOption");
      label?.classList?.toggle?.("isDisabled", !method.enabled);
      const note = label?.querySelector?.("small");
      if (note) note.textContent = method.enabled ? "" : "Coming soon";
    }
    if (methodNote) {
      if (abilityMethod === "standard-array") {
        methodNote.textContent = "Assign each Standard Array score to exactly one ability.";
      } else if (abilityMethod === "point-buy") {
        methodNote.textContent = "Adjust scores from 8 to 15 with a 27 point budget. Unspent points are allowed.";
      } else if (abilityMethod === "roll") {
        methodNote.textContent = "Roll six scores, then assign each rolled score to exactly one ability.";
      } else {
        methodNote.textContent = "Enter base scores manually.";
      }
    }
  }

  /**
   * @param {Event} event
   */
  function handleAbilityMethodActivation(event) {
    const target = event.target;
    if (!hasTagName(target, "input")) return;
    const input = /** @type {HTMLInputElement} */ (target);
    if (input.name !== "builderWizardAbilityMethod") return;
    if (input.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      event.stopPropagation();
      renderAbilityMethods();
      return;
    }
    const nextMethod = input.value === "standard-array" || input.value === "point-buy" || input.value === "roll"
      ? input.value
      : "manual";
    switchAbilityMethod(nextMethod);
    renderAbilityMethods();
  }

  /**
   * @param {Event} event
   */
  function handleStandardArrayChange(event) {
    const target = event.target;
    if (!hasTagName(target, "select")) return;
    const key = CHARACTER_ABILITY_KEYS.find((abilityKey) => standardArraySelects[abilityKey] === target);
    if (!key) return;
    const nextValue = /** @type {HTMLSelectElement} */ (target).value;
    const duplicate = nextValue && CHARACTER_ABILITY_KEYS.some((abilityKey) =>
      abilityKey !== key && standardArrayAssignments[abilityKey] === nextValue
    );
    if (duplicate) {
      /** @type {HTMLSelectElement} */ (target).value = "";
      standardArrayAssignments[key] = "";
      renderStandardArraySelects();
      showAbilityValidation(`Standard Array score ${nextValue} is already assigned. Each score can be used once.`);
      return;
    }
    standardArrayAssignments[key] = nextValue;
    syncAbilityBaseToDraft();
    renderStandardArraySelects();
    renderAbilityPreview();
    showAbilityValidation(getAbilityValidationMessage({ showIncomplete: abilityValidationAttempted }));
  }

  /**
   * @param {Event} event
   */
  function handlePointBuyClick(event) {
    const target = event.target;
    const button = hasTagName(target, "button")
      ? /** @type {HTMLButtonElement} */ (target)
      : target && typeof target === "object" && "closest" in target
        ? /** @type {HTMLButtonElement | null} */ (
          /** @type {{ closest?: (selector: string) => Element | null }} */ (target)
            .closest?.("button[data-point-buy-ability][data-point-buy-action]") || null
        )
        : null;
    if (!button || button.disabled) return;
    const key = button.dataset.pointBuyAbility || "";
    if (!CHARACTER_ABILITY_KEYS.includes(/** @type {typeof CHARACTER_ABILITY_KEYS[number]} */ (key))) return;
    const action = button.dataset.pointBuyAction;
    const current = Number(pointBuyAbilityBase[key]);
    const next = action === "increase" ? current + 1 : current - 1;
    if (!Number.isInteger(next) || next < POINT_BUY_MIN_SCORE || next > POINT_BUY_MAX_SCORE) return;
    if (action === "increase") {
      const extraCost = getPointBuyCost(next) - getPointBuyCost(current);
      if (extraCost > getPointBuyRemainingPoints()) return;
    }
    pointBuyAbilityBase[key] = next;
    syncAbilityBaseToDraft();
    renderPointBuyControls();
    renderAbilityPreview();
    showAbilityValidation(getAbilityValidationMessage({ showIncomplete: abilityValidationAttempted }));
  }

  function handleRollButtonClick() {
    if (rollModeSelect && ROLL_MODES.some((mode) => mode.id === rollModeSelect.value)) {
      rollMode = rollModeSelect.value;
    }
    rollGeneration += 1;
    try {
      rollPool = rollBuilderAbilityScorePool(rollMode, rollDie, rollGeneration);
    } catch (err) {
      rollPool = [];
      rollAssignments = {};
      const message = err instanceof Error ? err.message : "Unable to roll ability scores.";
      showAbilityValidation(message);
      return;
    }
    rollAssignments = {};
    abilityValidationAttempted = false;
    renderRollControls();
    renderAbilityPreview();
    showAbilityValidation("");
  }

  /**
   * @param {Event} event
   */
  function handleRollModeChange(event) {
    const target = event.target;
    if (target !== rollModeSelect || !rollModeSelect) return;
    rollMode = ROLL_MODES.some((mode) => mode.id === rollModeSelect.value)
      ? rollModeSelect.value
      : ROLL_MODE_4D6_DROP_LOWEST;
    syncEnhancedSelects();
  }

  /**
   * @param {Event} event
   */
  function handleRollAssignmentChange(event) {
    const target = event.target;
    if (!hasTagName(target, "select")) return;
    const key = CHARACTER_ABILITY_KEYS.find((abilityKey) => rollAssignmentSelects[abilityKey] === target);
    if (!key) return;
    const nextValue = /** @type {HTMLSelectElement} */ (target).value;
    const duplicate = nextValue && CHARACTER_ABILITY_KEYS.some((abilityKey) =>
      abilityKey !== key && rollAssignments[abilityKey] === nextValue
    );
    if (duplicate) {
      /** @type {HTMLSelectElement} */ (target).value = "";
      rollAssignments[key] = "";
      renderRollControls();
      const score = rollPool.find((item) => item.id === nextValue)?.value;
      showAbilityValidation(`Rolled score${score ? ` ${score}` : ""} is already assigned. Each rolled score can be used once.`);
      return;
    }
    rollAssignments[key] = rollPool.some((score) => score.id === nextValue) ? nextValue : "";
    syncAbilityBaseToDraft();
    renderRollControls();
    renderAbilityPreview();
    showAbilityValidation(getAbilityValidationMessage({ showIncomplete: abilityValidationAttempted }));
  }

  /**
   * @param {Event} event
   */
  function handleManualAbilityInput(event) {
    const target = event.target;
    if (!Object.values(abilityInputs).includes(/** @type {HTMLInputElement} */ (target))) return;
    syncManualDraftFromControls();
    syncAbilityBaseToDraft();
    renderAbilityPreview();
  }

  /**
   * @param {HTMLElement} rowsEl
   * @param {Array<[string, string]>} rows
   */
  function appendSummaryRows(rowsEl, rows) {
    rows.forEach(([label, value]) => {
      const row = appendDiv(rowsEl, "builderSummaryRow", "");
      appendDiv(row, "builderSummaryLabel", label);
      appendDiv(row, "builderSummaryValue", value || NOT_SELECTED_LABEL);
    });
  }

  function renderSummary() {
    syncDraftFromControls();
    for (const key of CHARACTER_ABILITY_KEYS) {
      if (abilityInputs[key]) abilityInputs[key].value = String(draft.build.abilities?.base?.[key] ?? 10);
    }

    const registry = getActiveContentRegistry();
    const derived = getDraftDerivedCharacter();

    summaryEl.innerHTML = "";
    const nameReview = document.createElement("label");
    nameReview.className = "builderSummaryNameField";
    nameReview.setAttribute("for", "builderWizardSummaryName");

    const nameLabel = document.createElement("span");
    nameLabel.textContent = "Character Name";
    nameReview.appendChild(nameLabel);

    const summaryNameInput = document.createElement("input");
    summaryNameInput.id = "builderWizardSummaryName";
    summaryNameInput.className = "settingsInput";
    summaryNameInput.value = draft.name;
    summaryNameInput.addEventListener("input", () => {
      draft.name = cleanString(summaryNameInput.value) || DEFAULT_NAME;
      nameInput.value = draft.name;
    }, { signal });
    nameReview.appendChild(summaryNameInput);
    summaryEl.appendChild(nameReview);

    const rows = appendDiv(summaryEl, "builderWizardSummaryRows", "");
    const labels = /** @type {{ classLevel?: unknown, race?: unknown, background?: unknown }} */ (derived.labels || {});
    /** @type {Array<[string, string]>} */
    const summaryRows = [
      ["Name", draft.name],
      ["Class / Level", cleanString(labels.classLevel) || NOT_SELECTED_LABEL],
      ["Race", cleanString(labels.race) || NOT_SELECTED_LABEL],
      ["Background", cleanString(labels.background) || NOT_SELECTED_LABEL],
      ["Proficiency Bonus", derived.proficiencyBonus == null ? "" : signedNumber(derived.proficiencyBonus)],
      ["Max HP", derived.hp?.max != null ? String(derived.hp.max) : NOT_SELECTED_LABEL],
      ["Armor Class", derived.ac?.value != null
        ? `${derived.ac.value}${derived.ac.formula ? ` (${derived.ac.formula})` : ""}`
        : NOT_SELECTED_LABEL],
      ["Speed", derived.speed != null ? `${derived.speed} ft.` : NOT_SELECTED_LABEL],
      ["Initiative", derived.initiative != null ? signedNumber(derived.initiative) : NOT_SELECTED_LABEL],
      ["Passive Perception", derived.passivePerception != null ? String(derived.passivePerception) : NOT_SELECTED_LABEL],
      ["Hit Dice", derived.hitDice.length
        ? derived.hitDice.map((pool) => `${pool.count}d${pool.die ?? "?"}`).join(" + ")
        : NOT_SELECTED_LABEL]
    ];
    const ancestryRows = getDragonbornAncestryRows(derived);
    if (ancestryRows.length) summaryRows.push(...ancestryRows);
    appendSummaryRows(rows, summaryRows);

    // Saving throws + skills.
    const savesLine = CHARACTER_ABILITY_KEYS
      .map((key) => {
        const save = derived.saves[key];
        if (save?.total == null) return null;
        return `${ABILITY_META[key].label} ${signedNumber(save.total)}${save.proficient ? "*" : ""}`;
      })
      .filter(Boolean)
      .join(", ");
    const proficientSkills = Object.entries(derived.skills)
      .filter(([, skill]) => skill.level === "prof" || skill.level === "expert")
      .map(([key, skill]) => {
        const entry = getContentByKind(registry, "skill", key) ||
          getContentByKind(registry, "skill", key === "animal" ? "animal-handling" : key === "sleight" ? "sleight-of-hand" : key);
        const name = entry?.name || key;
        return `${name}${skill.total != null ? ` ${signedNumber(skill.total)}` : ""}${skill.level === "expert" ? " (expertise)" : ""}`;
      })
      .join(", ");
    const languageNames = derived.proficiencies.languages
      .map((id) => getContentByKind(registry, "language", id)?.name || id)
      .join(", ");
    const featNames = derived.featIds
      .map((id) => getContentByKind(registry, "feat", id)?.name || id)
      .join(", ");
    /** @type {Array<[string, string]>} */
    const detailRows = [];
    if (savesLine) detailRows.push(["Saving Throws (* prof)", savesLine]);
    if (proficientSkills) detailRows.push(["Skill Proficiencies", proficientSkills]);
    if (languageNames) detailRows.push(["Languages", languageNames]);
    if (featNames) detailRows.push(["Feats", featNames]);
    if (detailRows.length) {
      const detailWrap = appendDiv(summaryEl, "builderWizardSummaryRows", "");
      appendSummaryRows(detailWrap, detailRows);
    }

    // Spellcasting.
    if (derived.spellcasting) {
      const spellWrap = appendDiv(summaryEl, "builderSummarySpells", "");
      appendDiv(spellWrap, "builderSummarySubhead", "Spellcasting");
      const spellRows = appendDiv(spellWrap, "builderWizardSummaryRows", "");
      for (const casterInfo of derived.spellcasting.classes) {
        appendSummaryRows(spellRows, [[
          casterInfo.className,
          `DC ${casterInfo.saveDc ?? "—"}, attack ${casterInfo.attackBonus != null ? signedNumber(casterInfo.attackBonus) : "—"}, ${ABILITY_FULL_NAMES[/** @type {keyof typeof ABILITY_FULL_NAMES} */ (casterInfo.ability)] || casterInfo.ability}`
        ]]);
      }
      const slotParts = derived.spellcasting.slots
        .map((count, index) => (count > 0 ? `L${index + 1}: ${count}` : null))
        .filter(Boolean);
      if (derived.spellcasting.pact) {
        slotParts.push(`Pact: ${derived.spellcasting.pact.slots} × L${derived.spellcasting.pact.slotLevel}`);
      }
      if (slotParts.length) appendSummaryRows(spellRows, [["Spell Slots", slotParts.join(", ")]]);
    }

    // Warnings.
    if (derived.warnings.length) {
      const warningsEl = appendDiv(summaryEl, "builderWizardValidation builderSummaryWarnings", "");
      warningsEl.hidden = false;
      warningsEl.textContent = `Warnings: ${derived.warnings.join("; ")}`;
    }

    const abilities = appendDiv(summaryEl, "builderSummaryAbilities", "");
    appendDiv(abilities, "builderSummarySubhead", "Ability Totals");
    const abilityGrid = appendDiv(abilities, "builderAbilityGrid", "");
    for (const key of CHARACTER_ABILITY_KEYS) {
      const ability = derived.abilities[key];
      const row = appendDiv(abilityGrid, "builderAbilityRow", "");
      row.dataset.ability = key;
      appendDiv(row, "builderAbilityLabel", ABILITY_META[key]?.label || key.toUpperCase());
      const total = typeof ability?.total === "number" ? ability.total : null;
      const mod = typeof ability?.modifier === "number" ? ability.modifier : null;
      appendDiv(row, "builderAbilityValue", total == null || mod == null ? NOT_SELECTED_LABEL : `${total} (${signedNumber(mod)})`);
    }
  }

  /**
   * @param {string} step
   * @returns {boolean}
   */
  function isStepAvailable(step) {
    const registry = getActiveContentRegistry();
    if (step === STEP_ORIGIN) return hasOriginChoices(draft.build, registry);
    if (step === STEP_CLASS_CHOICES) return hasClassChoices(draft.build, registry);
    if (step === STEP_SPELLS) return hasSpellcastingClasses(draft.build, registry);
    return true;
  }

  function getNextStep(step) {
    const index = STEP_ORDER.indexOf(step);
    for (let i = index + 1; i < STEP_ORDER.length; i += 1) {
      if (isStepAvailable(STEP_ORDER[i])) return STEP_ORDER[i];
    }
    return STEP_SUMMARY;
  }

  function getPreviousStep(step) {
    const index = STEP_ORDER.indexOf(step);
    for (let i = index - 1; i >= 0; i -= 1) {
      if (isStepAvailable(STEP_ORDER[i])) return STEP_ORDER[i];
    }
    return STEP_IDENTITY;
  }

  function syncStep() {
    renderAbilityMethods();
    stepIdentity.hidden = currentStep !== STEP_IDENTITY;
    stepRaceChoices.hidden = currentStep !== STEP_ORIGIN;
    stepClasses.hidden = currentStep !== STEP_CLASSES;
    stepClassChoices.hidden = currentStep !== STEP_CLASS_CHOICES;
    stepAbilities.hidden = currentStep !== STEP_ABILITIES;
    stepSpells.hidden = currentStep !== STEP_SPELLS;
    stepEquipment.hidden = currentStep !== STEP_EQUIPMENT;
    stepSummary.hidden = currentStep !== STEP_SUMMARY;
    backBtn.hidden = currentStep === STEP_IDENTITY;
    nextBtn.hidden = currentStep === STEP_SUMMARY;
    finishBtn.hidden = currentStep !== STEP_SUMMARY;
    if (currentStep === STEP_ORIGIN) renderOriginChoices();
    if (currentStep === STEP_CLASSES) renderClassesStep(stepCtx, classesBody);
    if (currentStep === STEP_CLASS_CHOICES) renderClassChoicesStep(stepCtx, classChoicesBody);
    if (currentStep === STEP_ABILITIES) renderAbilityPreview();
    if (currentStep === STEP_SPELLS) renderSpellsStep(stepCtx, spellsBody);
    if (currentStep === STEP_EQUIPMENT) renderEquipmentStep(stepCtx, equipmentBody);
    if (currentStep === STEP_SUMMARY) renderSummary();
  }

  function close() {
    for (const enhanced of enhancedSelects) {
      try { enhanced.close?.(); } catch { /* noop */ }
    }
    for (const enhanced of dynamicEnhancedSelects) {
      try { enhanced.api.destroy?.(); } catch { /* noop */ }
    }
    dynamicEnhancedSelects.length = 0;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    const target = previousFocus && typeof /** @type {HTMLElement} */ (previousFocus).focus === "function"
      ? /** @type {HTMLElement} */ (previousFocus)
      : null;
    previousFocus = null;
    queueMicrotask(() => {
      try {
        target?.focus?.({ preventScroll: true });
      } catch {
        target?.focus?.();
      }
    });
  }

  /**
   * Opens the wizard. Pass `options.character` (a builder character entry)
   * to edit its build in place; omit to create a new builder character.
   * @param {{ character?: import("../../state.js").CharacterEntry | null }} [options]
   */
  function open(options = {}) {
    const character = options.character ?? null;
    if (character && isBuilderCharacter(character)) {
      editingCharacterId = typeof character.id === "string" ? character.id : null;
      const normalized = normalizeCharacterBuild(clonePlainBuild(character.build));
      draft = {
        name: cleanString(character.name) || DEFAULT_NAME,
        build: normalized || makeDefaultCharacterBuild()
      };
      titleEl.textContent = "Edit with Builder";
    } else {
      editingCharacterId = null;
      draft = {
        name: DEFAULT_NAME,
        build: makeDefaultCharacterBuild()
      };
      titleEl.textContent = "Create with Builder";
    }
    currentStep = STEP_IDENTITY;
    previousFocus = document.activeElement;
    summaryEl.innerHTML = "";
    syncControlsFromDraft();
    syncStep();
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    queueMicrotask(() => {
      try {
        nameInput.focus({ preventScroll: true });
      } catch {
        nameInput.focus();
      }
    });
  }

  function finish() {
    syncDraftFromControls();
    onFinish?.({
      name: draft.name,
      build: structuredClone(draft.build),
      characterId: editingCharacterId
    });
    close();
  }

  function handleKeydown(event) {
    const e = /** @type {KeyboardEvent} */ (event);
    if (overlay.hidden) return;
    if (e.key === "Escape") {
      const target = /** @type {{ closest?: (selector: string) => Element | null } | null} */ (
        e.target && typeof e.target === "object" ? e.target : null
      );
      if (target?.closest?.(".selectDropdown, .dropdownMenu")) return;
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = getFocusable(panel);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  nextBtn.addEventListener("click", () => {
    syncDraftFromControls();
    if (currentStep === STEP_IDENTITY) {
      identityValidationAttempted = true;
      const identityMessage = getIdentityValidationMessage();
      showIdentityValidation(identityMessage);
      if (identityMessage) return;
    }
    if (currentStep === STEP_ORIGIN) {
      raceChoicesValidationAttempted = true;
      const raceChoicesMessage = getRaceChoicesValidationMessage({ showIncomplete: true });
      showRaceChoicesValidation(raceChoicesMessage);
      if (raceChoicesMessage) return;
    }
    if (currentStep === STEP_ABILITIES) abilityValidationAttempted = true;
    const validationMessage = getAbilityValidationMessage({ showIncomplete: abilityValidationAttempted });
    if (currentStep === STEP_ABILITIES && validationMessage) {
      showAbilityValidation(validationMessage);
      return;
    }
    currentStep = getNextStep(currentStep);
    syncStep();
  }, { signal });
  backBtn.addEventListener("click", () => {
    syncDraftFromControls();
    currentStep = getPreviousStep(currentStep);
    syncStep();
  }, { signal });
  finishBtn.addEventListener("click", () => {
    syncDraftFromControls();
    const raceChoicesMessage = getRaceChoicesValidationMessage({ showIncomplete: true });
    if (raceChoicesMessage) {
      currentStep = STEP_ORIGIN;
      raceChoicesValidationAttempted = true;
      syncStep();
      showRaceChoicesValidation(raceChoicesMessage);
      return;
    }
    abilityValidationAttempted = true;
    const validationMessage = getAbilityValidationMessage({ showIncomplete: true });
    if (validationMessage) {
      currentStep = STEP_ABILITIES;
      syncStep();
      showAbilityValidation(validationMessage);
      return;
    }
    finish();
  }, { signal });
  cancelBtn.addEventListener("click", close, { signal });
  closeBtn.addEventListener("click", close, { signal });
  panel.addEventListener("click", handleAbilityMethodActivation, { signal });
  panel.addEventListener("click", handlePointBuyClick, { signal });
  panel.addEventListener("change", handleAbilityMethodActivation, { signal });
  panel.addEventListener("input", handleManualAbilityInput, { signal });
  rollButton?.addEventListener("click", handleRollButtonClick, { signal });
  rollModeSelect?.addEventListener("change", handleRollModeChange, { signal });
  for (const select of [raceSelect, subraceSelect, classSelect, backgroundSelect]) {
    select.addEventListener("change", () => {
      syncDraftFromControls();
      if (select === raceSelect) {
        raceChoicesValidationAttempted = false;
        showRaceChoicesValidation("");
        renderSubraceSelect();
        renderOriginChoices();
        renderAbilityPreview();
      }
      if (select === subraceSelect) {
        renderAbilityPreview();
      }
      if (select === backgroundSelect) {
        renderOriginChoices();
      }
      if (!identityValidationAttempted) return;
      showIdentityValidation(getIdentityValidationMessage());
    }, { signal });
  }
  for (const select of Object.values(standardArraySelects)) {
    select.addEventListener("change", handleStandardArrayChange, { signal });
  }
  for (const select of Object.values(rollAssignmentSelects)) {
    select.addEventListener("change", handleRollAssignmentChange, { signal });
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  }, { signal });
  document.addEventListener("keydown", handleKeydown, { signal });

  if (Popovers) {
    for (const select of [
      raceSelect,
      subraceSelect,
      classSelect,
      backgroundSelect,
      ...(rollModeSelect ? [rollModeSelect] : []),
      ...Object.values(standardArraySelects),
      ...Object.values(rollAssignmentSelects)
    ]) {
      const enhanced = enhanceSelectDropdown({
        select,
        Popovers,
        buttonClass: "settingsSelectBtn builderWizardSelectBtn",
        optionClass: "swatchOption",
        groupLabelClass: "dropdownGroupLabel",
        preferRight: false
      });
      if (enhanced) enhancedSelects.push(enhanced);
    }
  }

  return {
    open,
    close,
    destroy() {
      for (const enhanced of enhancedSelects) {
        try { enhanced.destroy?.(); } catch { /* noop */ }
      }
      enhancedSelects.length = 0;
      for (const enhanced of dynamicEnhancedSelects) {
        try { enhanced.api.destroy?.(); } catch { /* noop */ }
      }
      dynamicEnhancedSelects.length = 0;
      listenerController.abort();
      close();
    }
  };
}
