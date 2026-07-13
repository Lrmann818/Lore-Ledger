// @ts-check
// Builder Abilities panel (B1 rework): a read-only view of the guarded base
// ability scores with an "Edit in Builder" action routing to the wizard.
// Base scores are structural build data (the output of the guarded
// ability-generation choice); play-state adjustments remain quick-editable
// through the Abilities & Skills panel's override controls.

import {
  ACTIVE_CHARACTER_CHANGED_EVENT
} from "../../../domain/characterEvents.js";
import {
  CHARACTER_ABILITY_KEYS,
  getActiveCharacter,
  isBuilderCharacter
} from "../../../domain/characterHelpers.js";
import { subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";
import { getNoopDestroyApi, requireMany } from "../../../utils/domGuards.js";

const EMPTY_VALUE = "—";

/** @type {Readonly<Record<string, string>>} */
const VALUE_ID_BY_ABILITY = Object.freeze({
  str: "#charBuilderAbilityStrValue",
  dex: "#charBuilderAbilityDexValue",
  con: "#charBuilderAbilityConValue",
  int: "#charBuilderAbilityIntValue",
  wis: "#charBuilderAbilityWisValue",
  cha: "#charBuilderAbilityChaValue"
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {{
 *   state?: import("../../../state.js").State,
 *   root?: ParentNode,
 *   setStatus?: (message: string, options?: Record<string, unknown>) => void,
 *   openBuilderWizard?: (character: import("../../../state.js").CharacterEntry) => void
 * }} [deps]
 * @returns {{ destroy: () => void }}
 */
export function initBuilderAbilitiesPanel(deps = {}) {
  const {
    state,
    root = document,
    setStatus,
    openBuilderWizard
  } = deps;

  if (!state) return getNoopDestroyApi();

  const guard = requireMany(
    {
      panel: "#charBuilderAbilitiesPanel",
      str: VALUE_ID_BY_ABILITY.str,
      dex: VALUE_ID_BY_ABILITY.dex,
      con: VALUE_ID_BY_ABILITY.con,
      int: VALUE_ID_BY_ABILITY.int,
      wis: VALUE_ID_BY_ABILITY.wis,
      cha: VALUE_ID_BY_ABILITY.cha,
      editBtn: "#charBuilderAbilitiesEditBtn"
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
  const editBtn = /** @type {HTMLButtonElement} */ (guard.els.editBtn);
  /** @type {Record<string, HTMLElement>} */
  const valueEls = {
    str: /** @type {HTMLElement} */ (guard.els.str),
    dex: /** @type {HTMLElement} */ (guard.els.dex),
    con: /** @type {HTMLElement} */ (guard.els.con),
    int: /** @type {HTMLElement} */ (guard.els.int),
    wis: /** @type {HTMLElement} */ (guard.els.wis),
    cha: /** @type {HTMLElement} */ (guard.els.cha)
  };

  const destroyFns = [];
  const listenerController = new AbortController();
  const listenerSignal = listenerController.signal;
  let destroyed = false;
  destroyFns.push(() => listenerController.abort());

  function hide() {
    panelEl.hidden = true;
    panelEl.setAttribute("aria-hidden", "true");
  }

  function refresh() {
    if (destroyed) return;
    const character = getActiveCharacter(state);
    if (!isBuilderCharacter(character)) {
      hide();
      return;
    }
    const build = isPlainObject(character) && isPlainObject(character.build) ? character.build : {};
    const abilities = isPlainObject(build.abilities) ? build.abilities : {};
    const base = isPlainObject(abilities.base) ? abilities.base : {};
    for (const key of CHARACTER_ABILITY_KEYS) {
      const value = Number(base[key]);
      valueEls[key].textContent = Number.isFinite(value) ? String(value) : EMPTY_VALUE;
    }
    editBtn.disabled = typeof openBuilderWizard !== "function";
    panelEl.hidden = false;
    panelEl.setAttribute("aria-hidden", "false");
  }

  editBtn.addEventListener("click", () => {
    const character = getActiveCharacter(state);
    if (!character || !isBuilderCharacter(character)) return;
    openBuilderWizard?.(character);
  }, { signal: listenerSignal });

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
