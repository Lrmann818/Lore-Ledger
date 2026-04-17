// @ts-check
// Manual builder ability editor for Step 3 Phase 3C builder characters.

import {
  ACTIVE_CHARACTER_CHANGED_EVENT
} from "../../../domain/characterEvents.js";
import {
  CHARACTER_ABILITY_KEYS,
  getActiveCharacter,
  isBuilderCharacter
} from "../../../domain/characterHelpers.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { notifyPanelDataChanged, subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";
import { getNoopDestroyApi, requireMany } from "../../../utils/domGuards.js";

const MIN_ABILITY_SCORE = 1;
const MAX_ABILITY_SCORE = 20;

/** @type {Readonly<Record<string, string>>} */
const INPUT_ID_BY_ABILITY = Object.freeze({
  str: "charBuilderAbilityStr",
  dex: "charBuilderAbilityDex",
  con: "charBuilderAbilityCon",
  int: "charBuilderAbilityInt",
  wis: "charBuilderAbilityWis",
  cha: "charBuilderAbilityCha"
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isEditableAbilityScore(value) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_ABILITY_SCORE &&
    value <= MAX_ABILITY_SCORE;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parseAbilityInput(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return isEditableAbilityScore(n) ? n : null;
}

/**
 * @param {unknown} character
 * @returns {Record<string, number> | null}
 */
function getEditableAbilityBase(character) {
  if (!isBuilderCharacter(character) || !isPlainObject(character)) return null;
  const build = character.build;
  if (!isPlainObject(build) || !isPlainObject(build.abilities)) return null;
  const base = build.abilities.base;
  if (!isPlainObject(base)) return null;

  for (const key of CHARACTER_ABILITY_KEYS) {
    if (!isEditableAbilityScore(base[key])) return null;
  }
  return /** @type {Record<string, number>} */ (base);
}

/**
 * @param {{
 *   state?: import("../../../state.js").State,
 *   SaveManager?: { markDirty?: () => void },
 *   root?: ParentNode,
 *   setStatus?: (message: string, options?: Record<string, unknown>) => void
 * }} [deps]
 * @returns {{ destroy: () => void }}
 */
export function initBuilderAbilitiesPanel(deps = {}) {
  const {
    state,
    SaveManager,
    root = document,
    setStatus
  } = deps;

  if (!state) return getNoopDestroyApi();

  const guard = requireMany(
    {
      panel: "#charBuilderAbilitiesPanel",
      content: "#charBuilderAbilitiesContent",
      unavailable: "#charBuilderAbilitiesUnavailable",
      grid: "#charBuilderAbilitiesGrid",
      str: "#charBuilderAbilityStr",
      dex: "#charBuilderAbilityDex",
      con: "#charBuilderAbilityCon",
      int: "#charBuilderAbilityInt",
      wis: "#charBuilderAbilityWis",
      cha: "#charBuilderAbilityCha"
    },
    {
      root,
      setStatus,
      context: "Builder abilities panel",
      devAssert: false,
      warn: false
    }
  );
  if (!guard.ok) return guard.destroy;

  const panelEl = /** @type {HTMLElement} */ (guard.els.panel);
  const contentEl = /** @type {HTMLElement} */ (guard.els.content);
  const unavailableEl = /** @type {HTMLElement} */ (guard.els.unavailable);
  const gridEl = /** @type {HTMLElement} */ (guard.els.grid);
  /** @type {Record<string, HTMLInputElement>} */
  const inputs = {
    str: /** @type {HTMLInputElement} */ (guard.els.str),
    dex: /** @type {HTMLInputElement} */ (guard.els.dex),
    con: /** @type {HTMLInputElement} */ (guard.els.con),
    int: /** @type {HTMLInputElement} */ (guard.els.int),
    wis: /** @type {HTMLInputElement} */ (guard.els.wis),
    cha: /** @type {HTMLInputElement} */ (guard.els.cha)
  };

  const { updateCharacterField } = createStateActions({ state, SaveManager });
  const destroyFns = [];
  const listenerController = new AbortController();
  const listenerSignal = listenerController.signal;
  const panelSource = { panelId: "builder-abilities" };
  let destroyed = false;

  destroyFns.push(() => listenerController.abort());

  function resetControls() {
    for (const key of CHARACTER_ABILITY_KEYS) {
      inputs[key].value = "";
    }
  }

  /**
   * @param {Record<string, number>} base
   */
  function syncControls(base) {
    for (const key of CHARACTER_ABILITY_KEYS) {
      const input = inputs[key];
      input.value = String(base[key]);
      input.min = String(MIN_ABILITY_SCORE);
      input.max = String(MAX_ABILITY_SCORE);
      input.step = "1";
    }
  }

  function showPanel() {
    panelEl.hidden = false;
    panelEl.setAttribute("aria-hidden", "false");
  }

  function hide() {
    panelEl.hidden = true;
    panelEl.setAttribute("aria-hidden", "true");
    unavailableEl.hidden = true;
    gridEl.hidden = true;
    contentEl.removeAttribute("aria-disabled");
    resetControls();
  }

  function showUnavailable() {
    resetControls();
    unavailableEl.hidden = false;
    gridEl.hidden = true;
    contentEl.setAttribute("aria-disabled", "true");
    showPanel();
  }

  /**
   * @param {Record<string, number>} base
   */
  function showEditable(base) {
    unavailableEl.hidden = true;
    gridEl.hidden = false;
    contentEl.removeAttribute("aria-disabled");
    syncControls(base);
    showPanel();
  }

  function refresh() {
    if (destroyed) return;
    const character = getActiveCharacter(state);
    const base = getEditableAbilityBase(character);
    if (base) {
      showEditable(base);
      return;
    }
    if (isBuilderCharacter(character)) {
      showUnavailable();
      return;
    }
    hide();
  }

  /**
   * @param {string} key
   * @param {unknown} rawValue
   */
  function updateAbility(key, rawValue) {
    const base = getEditableAbilityBase(getActiveCharacter(state));
    if (!base || !Object.hasOwn(INPUT_ID_BY_ABILITY, key)) {
      refresh();
      return;
    }

    const nextValue = parseAbilityInput(rawValue);
    if (nextValue == null) {
      refresh();
      return;
    }

    const updated = updateCharacterField(`build.abilities.base.${key}`, nextValue, { queueSave: false });
    if (!updated) {
      refresh();
      return;
    }

    SaveManager?.markDirty?.();
    notifyPanelDataChanged("character-fields", { source: panelSource });
    refresh();
  }

  for (const key of CHARACTER_ABILITY_KEYS) {
    inputs[key].addEventListener("change", () => updateAbility(key, inputs[key].value), {
      signal: listenerSignal
    });
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, refresh, {
      signal: listenerSignal
    });
  }

  destroyFns.push(subscribePanelDataChanged("character-fields", refresh));
  refresh();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (let i = destroyFns.length - 1; i >= 0; i--) {
        destroyFns[i]?.();
      }
    }
  };
}
