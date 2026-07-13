// @ts-check
// Builder Identity panel (B1 rework): a read-only view of the guarded
// structural identity choices — race, class levels, background, total level —
// with an "Edit in Builder" action that routes to the guarded wizard flow.
// Structural build edits never happen directly on the sheet; the wizard owns
// validation, choice pruning, and re-seeding (see AGENTS.md → Editing Model).

import {
  ACTIVE_CHARACTER_CHANGED_EVENT
} from "../../../domain/characterEvents.js";
import {
  getActiveCharacter,
  isBuilderCharacter
} from "../../../domain/characterHelpers.js";
import { deriveCharacter } from "../../../domain/rules/deriveCharacter.js";
import { subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";
import { getNoopDestroyApi, requireMany } from "../../../utils/domGuards.js";

const EMPTY_VALUE = "—";

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
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
export function initBuilderIdentityPanel(deps = {}) {
  const {
    state,
    root = document,
    setStatus,
    openBuilderWizard
  } = deps;

  if (!state) return getNoopDestroyApi();

  const guard = requireMany(
    {
      panel: "#charBuilderIdentityPanel",
      race: "#charBuilderRaceValue",
      class: "#charBuilderClassValue",
      background: "#charBuilderBackgroundValue",
      level: "#charBuilderLevelValue",
      editBtn: "#charBuilderIdentityEditBtn"
    },
    {
      root,
      setStatus,
      context: "Builder identity panel",
      devAssert: false,
      warn: false
    }
  );
  if (!guard.ok) return guard.destroy;

  const panelEl = /** @type {HTMLElement} */ (guard.els.panel);
  const raceValueEl = /** @type {HTMLElement} */ (guard.els.race);
  const classValueEl = /** @type {HTMLElement} */ (guard.els.class);
  const backgroundValueEl = /** @type {HTMLElement} */ (guard.els.background);
  const levelValueEl = /** @type {HTMLElement} */ (guard.els.level);
  const editBtn = /** @type {HTMLButtonElement} */ (guard.els.editBtn);

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
    let derived = null;
    try {
      derived = deriveCharacter(character);
    } catch (err) {
      console.warn("Builder identity derivation failed:", err);
    }
    raceValueEl.textContent = cleanString(derived?.labels.race) || EMPTY_VALUE;
    classValueEl.textContent = cleanString(derived?.labels.classLevel) || EMPTY_VALUE;
    backgroundValueEl.textContent = cleanString(derived?.labels.background) || EMPTY_VALUE;
    levelValueEl.textContent = derived?.level != null ? String(derived.level) : EMPTY_VALUE;
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
