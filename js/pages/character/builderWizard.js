// @ts-check
// Minimal in-memory builder creation wizard for Phase 2A.

import { CHARACTER_ABILITY_KEYS, makeDefaultCharacterBuild } from "../../domain/characterHelpers.js";
import { deriveCharacter } from "../../domain/rules/deriveCharacter.js";
import {
  BUILTIN_CONTENT_REGISTRY,
  getContentById,
  listContentByKind
} from "../../domain/rules/registry.js";
import { enhanceSelectDropdown } from "../../ui/selectDropdown.js";
import { getNoopDestroyApi, requireMany } from "../../utils/domGuards.js";

const MIN_LEVEL = 1;
const MAX_LEVEL = 20;
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

/**
 * @typedef {{
 *   name: string,
 *   build: import("../../state.js").CharacterBuildState
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
 * @param {import("../../domain/rules/builtinContent.js").BuiltinContentKind} kind
 * @returns {string | null}
 */
function normalizeContentId(value, kind) {
  const id = cleanString(value);
  if (!id) return null;
  return getContentById(BUILTIN_CONTENT_REGISTRY, id)?.kind === kind ? id : null;
}

/**
 * @param {HTMLSelectElement} select
 * @param {import("../../domain/rules/builtinContent.js").BuiltinContentKind} kind
 * @param {unknown} selectedId
 * @returns {void}
 */
function populateContentSelect(select, kind, selectedId) {
  const selected = cleanString(selectedId);
  const entries = listContentByKind(BUILTIN_CONTENT_REGISTRY, kind);
  select.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = NOT_SELECTED_LABEL;
  select.appendChild(emptyOption);

  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.name;
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
 * @returns {{ open: () => void, close: () => void, destroy: () => void }}
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
      class: "#builderWizardClass",
      background: "#builderWizardBackground",
      level: "#builderWizardLevel",
      identityValidation: "#builderWizardIdentityValidation",
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
  const closeBtn = /** @type {HTMLButtonElement} */ (guard.els.closeBtn);
  const nameInput = /** @type {HTMLInputElement} */ (guard.els.name);
  const raceSelect = /** @type {HTMLSelectElement} */ (guard.els.race);
  const classSelect = /** @type {HTMLSelectElement} */ (guard.els.class);
  const backgroundSelect = /** @type {HTMLSelectElement} */ (guard.els.background);
  const levelDisplay = /** @type {HTMLElement} */ (guard.els.level);
  const identityValidation = /** @type {HTMLElement} */ (guard.els.identityValidation);
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
  let stepIndex = 0;
  let abilityMethod = "manual";
  let identityValidationAttempted = false;
  let abilityValidationAttempted = false;
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
  /** @type {BuilderWizardResult} */
  let draft = {
    name: DEFAULT_NAME,
    build: makeDefaultCharacterBuild()
  };

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

  function syncAbilityBaseToDraft() {
    const base = getActiveAbilityBaseOrNull();
    if (!base) return false;
    draft.build.abilities.base = { ...base };
    return true;
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
    return true;
  }

  function syncDraftFromControls() {
    const summaryNameInput = /** @type {HTMLInputElement | null} */ (root.querySelector?.("#builderWizardSummaryName"));
    const summaryName = stepIndex === 2 && !stepSummary.hidden ? cleanString(summaryNameInput?.value) : "";
    draft.name = summaryName || cleanString(nameInput.value) || DEFAULT_NAME;
    nameInput.value = draft.name;
    draft.build.raceId = normalizeContentId(raceSelect.value, "race");
    draft.build.classId = normalizeContentId(classSelect.value, "class");
    draft.build.backgroundId = normalizeContentId(backgroundSelect.value, "background");
    draft.build.level = MIN_LEVEL;
    if (!draft.build.abilities || typeof draft.build.abilities !== "object") {
      draft.build.abilities = { base: {} };
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
  }

  function syncControlsFromDraft() {
    nameInput.value = draft.name;
    populateContentSelect(raceSelect, "race", draft.build.raceId);
    populateContentSelect(classSelect, "class", draft.build.classId);
    populateContentSelect(backgroundSelect, "background", draft.build.backgroundId);
    syncEnhancedSelects();
    draft.build.level = MIN_LEVEL;
    levelDisplay.textContent = "Level 1";
    manualAbilityBase = { ...getDefaultAbilityBase(), ...draft.build.abilities.base };
    pointBuyAbilityBase = getDefaultPointBuyBase();
    standardArrayAssignments = {};
    rollMode = ROLL_MODE_4D6_DROP_LOWEST;
    rollPool = [];
    rollAssignments = {};
    rollGeneration = 0;
    for (const key of CHARACTER_ABILITY_KEYS) {
      const input = abilityInputs[key];
      if (!input) continue;
      manualAbilityBase[key] = clampInteger(draft.build.abilities.base[key], MIN_ABILITY_SCORE, MAX_ABILITY_SCORE, 10);
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
    abilityValidationAttempted = false;
    showIdentityValidation("");
    methodManualInput.checked = true;
    renderAbilityControlsForMethod();
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
        methodNote.textContent = "Enter final base scores manually.";
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
    showAbilityValidation(getAbilityValidationMessage({ showIncomplete: abilityValidationAttempted }));
  }

  function renderSummary() {
    syncDraftFromControls();
    levelDisplay.textContent = `Level ${MIN_LEVEL}`;
    for (const key of CHARACTER_ABILITY_KEYS) {
      if (abilityInputs[key]) abilityInputs[key].value = String(draft.build.abilities.base[key]);
    }

    const derived = deriveCharacter({
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
    [
      ["Name", draft.name],
      ["Class / Level", cleanString(labels.classLevel) || NOT_SELECTED_LABEL],
      ["Race", cleanString(labels.race) || NOT_SELECTED_LABEL],
      ["Background", cleanString(labels.background) || NOT_SELECTED_LABEL],
      ["Proficiency Bonus", derived.proficiencyBonus == null ? "" : signedNumber(derived.proficiencyBonus)]
    ].forEach(([label, value]) => {
      const row = appendDiv(rows, "builderSummaryRow", "");
      appendDiv(row, "builderSummaryLabel", label);
      appendDiv(row, "builderSummaryValue", value || NOT_SELECTED_LABEL);
    });

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

  function syncStep() {
    renderAbilityMethods();
    stepIdentity.hidden = stepIndex !== 0;
    stepAbilities.hidden = stepIndex !== 1;
    stepSummary.hidden = stepIndex !== 2;
    backBtn.hidden = stepIndex === 0;
    nextBtn.hidden = stepIndex === 2;
    finishBtn.hidden = stepIndex !== 2;
    if (stepIndex === 2) renderSummary();
  }

  function close() {
    for (const enhanced of enhancedSelects) {
      try { enhanced.close?.(); } catch { /* noop */ }
    }
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

  function open() {
    draft = {
      name: DEFAULT_NAME,
      build: makeDefaultCharacterBuild()
    };
    draft.build.level = MIN_LEVEL;
    stepIndex = 0;
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
      build: structuredClone(draft.build)
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
    if (stepIndex === 0) {
      identityValidationAttempted = true;
      const identityMessage = getIdentityValidationMessage();
      showIdentityValidation(identityMessage);
      if (identityMessage) return;
    }
    if (stepIndex === 1) abilityValidationAttempted = true;
    const validationMessage = getAbilityValidationMessage({ showIncomplete: abilityValidationAttempted });
    if (stepIndex === 1 && validationMessage) {
      showAbilityValidation(validationMessage);
      return;
    }
    stepIndex = Math.min(2, stepIndex + 1);
    syncStep();
  }, { signal });
  backBtn.addEventListener("click", () => {
    syncDraftFromControls();
    stepIndex = Math.max(0, stepIndex - 1);
    syncStep();
  }, { signal });
  finishBtn.addEventListener("click", () => {
    syncDraftFromControls();
    abilityValidationAttempted = true;
    const validationMessage = getAbilityValidationMessage({ showIncomplete: true });
    if (validationMessage) {
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
  rollButton?.addEventListener("click", handleRollButtonClick, { signal });
  rollModeSelect?.addEventListener("change", handleRollModeChange, { signal });
  for (const select of [raceSelect, classSelect, backgroundSelect]) {
    select.addEventListener("change", () => {
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
      listenerController.abort();
      close();
    }
  };
}
