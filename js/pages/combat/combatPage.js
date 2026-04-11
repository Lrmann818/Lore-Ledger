// @ts-check
// js/pages/combat/combatPage.js
//
// Combat Workspace shell wiring. This slice intentionally renders only the
// top-level page, core panel shells, empty state, and layout persistence hooks.

import { setupCombatSectionReorder } from "./combatSectionReorder.js";
import { COMBAT_ENCOUNTER_CHANGED_EVENT } from "./combatEvents.js";
import { getNoopDestroyApi, requireMany } from "../../utils/domGuards.js";
import { DEV_MODE } from "../../utils/dev.js";

/** @typedef {import("../../state.js").State} State */
/** @typedef {{ markDirty?: () => void }} SaveManagerLike */
/** @typedef {(message: string, opts?: { stickyMs?: number }) => void} CombatPageStatusFn */
/**
 * @typedef {{
 *   state?: State,
 *   SaveManager?: SaveManagerLike,
 *   setStatus?: CombatPageStatusFn
 * }} CombatPageDeps
 */
/** @typedef {{ destroy: () => void, render: () => void }} CombatPageApi */
/** @typedef {{ panelOrder?: string[], embeddedPanels?: string[], panelCollapsed?: Record<string, boolean> }} CombatWorkspaceLike */
/** @typedef {{ round?: unknown, elapsedSeconds?: unknown, secondsPerTurn?: unknown, participants?: unknown }} CombatEncounterLike */
/** @typedef {{ workspace?: CombatWorkspaceLike, encounter?: CombatEncounterLike }} CombatStateLike */
/**
 * @typedef {{
 *   isEmpty: boolean,
 *   participantCount: number,
 *   round: number,
 *   elapsedSeconds: number,
 *   elapsedLabel: string,
 *   secondsPerTurn: number
 * }} CombatShellViewModel
 */

export const COMBAT_CORE_PANEL_IDS = Object.freeze(["combatCardsPanel", "combatRoundPanel"]);

/** @type {CombatPageApi | null} */
let activeCombatPageController = null;

/**
 * @param {unknown} value
 * @returns {value is HTMLElement}
 */
function isHtmlElement(value) {
  return value instanceof HTMLElement;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {{ min?: number, integer?: boolean }} [opts]
 * @returns {number}
 */
function finiteNumberOr(value, fallback, opts = {}) {
  const parsed = Number(value);
  const min = Number.isFinite(opts.min) ? Number(opts.min) : null;
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = opts.integer === false ? parsed : Math.trunc(parsed);
  if (min !== null && normalized < min) return fallback;
  return normalized;
}

/**
 * @param {number | null | undefined} elapsedSeconds
 * @returns {string}
 */
export function formatCombatElapsedTime(elapsedSeconds) {
  const safeSeconds = Math.max(0, Math.trunc(Number(elapsedSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * @param {unknown} state
 * @returns {CombatShellViewModel}
 */
export function getCombatShellViewModel(state) {
  const combat = /** @type {CombatStateLike} */ (objectOrEmpty(objectOrEmpty(state).combat));
  const encounter = /** @type {CombatEncounterLike} */ (objectOrEmpty(combat.encounter));
  const participants = Array.isArray(encounter.participants) ? encounter.participants : [];
  const elapsedSeconds = finiteNumberOr(encounter.elapsedSeconds, 0, { min: 0, integer: false });

  return {
    isEmpty: participants.length === 0,
    participantCount: participants.length,
    round: finiteNumberOr(encounter.round, 1, { min: 1 }),
    elapsedSeconds,
    elapsedLabel: formatCombatElapsedTime(elapsedSeconds),
    secondsPerTurn: finiteNumberOr(encounter.secondsPerTurn, 6, { min: 1 })
  };
}

/**
 * @param {State} state
 * @returns {NonNullable<State["combat"]>}
 */
function ensureCombatState(state) {
  if (!state.combat || typeof state.combat !== "object" || Array.isArray(state.combat)) {
    state.combat = /** @type {State["combat"]} */ ({});
  }

  const combat = /** @type {NonNullable<State["combat"]> & Record<string, unknown>} */ (state.combat);
  if (!combat.workspace || typeof combat.workspace !== "object" || Array.isArray(combat.workspace)) {
    combat.workspace = { panelOrder: [], embeddedPanels: [], panelCollapsed: {} };
  }
  if (!combat.encounter || typeof combat.encounter !== "object" || Array.isArray(combat.encounter)) {
    combat.encounter = {
      id: null,
      createdAt: null,
      updatedAt: null,
      round: 1,
      activeParticipantId: null,
      elapsedSeconds: 0,
      secondsPerTurn: 6,
      participants: [],
      undoStack: []
    };
  }

  const workspace = /** @type {CombatWorkspaceLike} */ (combat.workspace);
  if (!Array.isArray(workspace.panelOrder)) workspace.panelOrder = [];
  if (!Array.isArray(workspace.embeddedPanels)) workspace.embeddedPanels = [];
  if (!workspace.panelCollapsed || typeof workspace.panelCollapsed !== "object" || Array.isArray(workspace.panelCollapsed)) {
    workspace.panelCollapsed = {};
  }

  const encounter = /** @type {CombatEncounterLike & Record<string, unknown>} */ (combat.encounter);
  if (!Array.isArray(encounter.participants)) encounter.participants = [];
  if (!Array.isArray(encounter.undoStack)) encounter.undoStack = [];
  encounter.round = finiteNumberOr(encounter.round, 1, { min: 1 });
  encounter.elapsedSeconds = finiteNumberOr(encounter.elapsedSeconds, 0, { min: 0, integer: false });
  encounter.secondsPerTurn = finiteNumberOr(encounter.secondsPerTurn, 6, { min: 1 });

  return /** @type {NonNullable<State["combat"]>} */ (combat);
}

/**
 * @param {HTMLElement} panelEl
 * @param {boolean} collapsed
 * @returns {void}
 */
function applyCombatPanelCollapsedUi(panelEl, collapsed) {
  panelEl.dataset.collapsed = collapsed ? "true" : "false";
  panelEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

/**
 * @param {{
 *   state: State,
 *   SaveManager?: SaveManagerLike,
 *   root: HTMLElement,
 * }} deps
 * @returns {{ destroy: () => void }}
 */
function initCombatPanelCollapse({ state, SaveManager, root }) {
  const combat = ensureCombatState(state);
  const ac = new AbortController();
  const { signal } = ac;
  /** @type {HTMLElement[]} */
  const boundHeaders = [];

  COMBAT_CORE_PANEL_IDS.forEach((panelId) => {
    const panelEl = root.querySelector(`#${panelId}`);
    if (!isHtmlElement(panelEl)) return;
    const headerEl = panelEl.querySelector(":scope > .panelHeader");
    if (!isHtmlElement(headerEl)) return;
    headerEl.setAttribute("data-panel-header", "");
    headerEl.classList.add("panelHeaderClickable");
    boundHeaders.push(headerEl);

    applyCombatPanelCollapsedUi(panelEl, combat.workspace.panelCollapsed?.[panelId] === true);
    headerEl.addEventListener(
      "click",
      (event) => {
        if (event.target instanceof Element && event.target.closest("button, input, select, textarea, a, label")) {
          return;
        }
        const next = combat.workspace.panelCollapsed?.[panelId] !== true;
        combat.workspace.panelCollapsed = {
          ...(combat.workspace.panelCollapsed || {}),
          [panelId]: next
        };
        applyCombatPanelCollapsedUi(panelEl, next);
        SaveManager?.markDirty?.();
      },
      { signal }
    );
  });

  return {
    destroy() {
      ac.abort();
      boundHeaders.forEach((headerEl) => {
        headerEl.classList.remove("panelHeaderClickable");
      });
      boundHeaders.length = 0;
    }
  };
}

/**
 * @param {CombatPageDeps} [deps]
 * @returns {CombatPageApi}
 */
export function initCombatPage(deps = {}) {
  activeCombatPageController?.destroy?.();
  activeCombatPageController = null;

  const { state, SaveManager, setStatus } = deps;
  if (!state) throw new Error("initCombatPage: state is required");
  if (!SaveManager) throw new Error("initCombatPage: SaveManager is required");
  if (!setStatus) throw new Error("initCombatPage requires setStatus");

  const guard = requireMany(
    {
      root: "#page-combat",
      emptyState: "#combatEmptyState",
      cardsStatus: "#combatCardsStatus",
      roundValue: "#combatRoundValue",
      elapsedValue: "#combatElapsedValue",
      turnSecondsValue: "#combatTurnSecondsValue"
    },
    {
      root: document,
      setStatus,
      context: "Combat page",
      stickyMs: 5000
    }
  );
  if (!guard.ok) {
    return /** @type {CombatPageApi} */ (guard.destroy || getNoopDestroyApi());
  }

  const root = /** @type {HTMLElement} */ (guard.els.root);
  const emptyState = /** @type {HTMLElement} */ (guard.els.emptyState);
  const cardsStatus = /** @type {HTMLElement} */ (guard.els.cardsStatus);
  const roundValue = /** @type {HTMLElement} */ (guard.els.roundValue);
  const elapsedValue = /** @type {HTMLElement} */ (guard.els.elapsedValue);
  const turnSecondsValue = /** @type {HTMLElement} */ (guard.els.turnSecondsValue);

  ensureCombatState(state);

  /** @type {Array<() => void>} */
  const destroyFns = [];
  /**
   * @param {(() => void) | undefined} destroyFn
   * @returns {void}
   */
  const addDestroy = (destroyFn) => {
    if (typeof destroyFn === "function") destroyFns.push(destroyFn);
  };
  const listenerController = new AbortController();
  addDestroy(() => listenerController.abort());

  /**
   * @param {string} featureName
   * @param {() => ({ destroy?: () => void } | null | undefined | void)} initFn
   * @returns {{ destroy: () => void }}
   */
  const runShellInit = (featureName, initFn) => {
    try {
      const featureApi = initFn();
      if (featureApi && typeof featureApi === "object" && typeof featureApi.destroy === "function") {
        addDestroy(() => featureApi.destroy());
      }
      return /** @type {{ destroy: () => void }} */ (featureApi || getNoopDestroyApi());
    } catch (err) {
      console.error(`${featureName} init failed:`, err);
      const message = DEV_MODE
        ? `${featureName} failed in DEV mode. Check console for details.`
        : `${featureName} failed to initialize. Check console for details.`;
      setStatus(message, { stickyMs: 5000 });
      return getNoopDestroyApi();
    }
  };

  const render = () => {
    const vm = getCombatShellViewModel(state);
    emptyState.toggleAttribute("hidden", !vm.isEmpty);
    cardsStatus.textContent = vm.isEmpty
      ? "Add combatants from Tracker to begin."
      : `${vm.participantCount} combatant${vm.participantCount === 1 ? "" : "s"} ready for cards.`;
    roundValue.textContent = String(vm.round);
    elapsedValue.textContent = vm.elapsedLabel;
    turnSecondsValue.textContent = `${vm.secondsPerTurn}s`;
  };

  runShellInit("Combat layout persistence", () => setupCombatSectionReorder({ state, SaveManager, setStatus }));
  runShellInit("Combat panel collapse", () => initCombatPanelCollapse({ state, SaveManager, root }));
  window.addEventListener(COMBAT_ENCOUNTER_CHANGED_EVENT, render, { signal: listenerController.signal });
  render();

  const api = {
    destroy() {
      for (let i = destroyFns.length - 1; i >= 0; i--) {
        destroyFns[i]?.();
      }
      if (activeCombatPageController === api) {
        activeCombatPageController = null;
      }
    },
    render
  };

  activeCombatPageController = api;
  return api;
}
