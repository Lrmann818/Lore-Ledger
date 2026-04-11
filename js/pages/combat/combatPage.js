// @ts-check
// js/pages/combat/combatPage.js
//
// Combat Workspace shell and Slice 5 encounter controls.

import { setupCombatSectionReorder } from "./combatSectionReorder.js";
import { COMBAT_ENCOUNTER_CHANGED_EVENT, notifyCombatEncounterChanged } from "./combatEvents.js";
import {
  advanceCombatTurn,
  applyCombatParticipantHpAction,
  clearCombat,
  moveCombatParticipant,
  removeCombatParticipant,
  setActiveCombatParticipant,
  setCombatParticipantRole,
  setCombatSecondsPerTurn,
  undoCombatTurn
} from "../../domain/combatEncounterActions.js";
import { COMBAT_ROLES, normalizeCombatEncounter } from "../../domain/combat.js";
import { getNoopDestroyApi, requireMany } from "../../utils/domGuards.js";
import { DEV_MODE } from "../../utils/dev.js";

/** @typedef {import("../../state.js").State} State */
/** @typedef {{ markDirty?: () => void }} SaveManagerLike */
/** @typedef {(message: string, opts?: { title?: string, okText?: string, cancelText?: string }) => Promise<boolean> | boolean} UiConfirmFn */
/** @typedef {(message: string, opts?: { stickyMs?: number }) => void} CombatPageStatusFn */
/**
 * @typedef {{
 *   state?: State,
 *   SaveManager?: SaveManagerLike,
 *   uiConfirm?: UiConfirmFn,
 *   setStatus?: CombatPageStatusFn
 * }} CombatPageDeps
 */
/** @typedef {{ destroy: () => void, render: () => void }} CombatPageApi */
/** @typedef {{ panelOrder?: string[], embeddedPanels?: string[], panelCollapsed?: Record<string, boolean> }} CombatWorkspaceLike */
/** @typedef {{ round?: unknown, activeParticipantId?: unknown, elapsedSeconds?: unknown, secondsPerTurn?: unknown, participants?: unknown, undoStack?: unknown }} CombatEncounterLike */
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
/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   role: "party" | "enemy" | "npc",
 *   roleLabel: string,
 *   orderLabel: string,
 *   isActive: boolean,
 *   canMoveUp: boolean,
 *   canMoveDown: boolean,
 *   hpCurrentLabel: string,
 *   hpMaxLabel: string,
 *   tempHp: number,
 *   hasTempHp: boolean,
 *   statusEffects: Array<{ id: string, label: string, detail: string, expired: boolean }>
 * }} CombatCardViewModel
 */
/**
 * @typedef {{
 *   canNextTurn: boolean,
 *   canUndo: boolean,
 *   canClear: boolean
 * }} CombatRoundControlsViewModel
 */

export const COMBAT_CORE_PANEL_IDS = Object.freeze(["combatCardsPanel", "combatRoundPanel"]);
export const COMBAT_ROLE_OPTIONS = Object.freeze([
  { value: COMBAT_ROLES.PARTY, label: "Party" },
  { value: COMBAT_ROLES.ENEMY, label: "Enemy" },
  { value: COMBAT_ROLES.NPC, label: "NPC" }
]);

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
 * @param {unknown} value
 * @returns {string | null}
 */
function cleanIdOrNull(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return id || null;
}

/**
 * @param {unknown} remaining
 * @param {unknown} mode
 * @returns {string}
 */
function formatStatusEffectDetail(remaining, mode) {
  if (mode === "rounds") return `(${Number(remaining) || 0} rd)`;
  if (mode === "time") return `(${Number(remaining) || 0}s)`;
  return "";
}

/**
 * @param {unknown} state
 * @returns {CombatCardViewModel[]}
 */
export function getCombatCardViewModels(state) {
  const encounter = normalizeCombatEncounter(objectOrEmpty(objectOrEmpty(state).combat).encounter);
  return encounter.participants.map((participant, index) => {
    const hpCurrent = participant.hpCurrent == null ? "--" : String(participant.hpCurrent);
    const hpMax = participant.hpMax == null ? "--" : String(participant.hpMax);
    return {
      id: participant.id,
      name: participant.name || "Unnamed participant",
      role: participant.role,
      roleLabel: COMBAT_ROLE_OPTIONS.find((option) => option.value === participant.role)?.label || "NPC",
      orderLabel: String(index + 1),
      isActive: participant.id === encounter.activeParticipantId,
      canMoveUp: index > 0,
      canMoveDown: index < encounter.participants.length - 1,
      hpCurrentLabel: hpCurrent,
      hpMaxLabel: hpMax,
      tempHp: Math.max(0, Math.trunc(Number(participant.tempHp) || 0)),
      hasTempHp: Number(participant.tempHp) > 0,
      statusEffects: participant.statusEffects.map((effect) => ({
        id: effect.id,
        label: effect.label,
        detail: formatStatusEffectDetail(effect.remaining, effect.durationMode),
        expired: effect.expired === true
      }))
    };
  });
}

/**
 * @param {unknown} state
 * @returns {CombatRoundControlsViewModel}
 */
export function getCombatRoundControlsViewModel(state) {
  const combat = /** @type {CombatStateLike} */ (objectOrEmpty(objectOrEmpty(state).combat));
  const encounter = normalizeCombatEncounter(objectOrEmpty(combat.encounter));
  const hasParticipants = encounter.participants.length > 0;
  const hasDisposableState = hasParticipants
    || encounter.round !== 1
    || encounter.elapsedSeconds > 0
    || !!encounter.activeParticipantId
    || encounter.undoStack.length > 0;

  return {
    canNextTurn: hasParticipants,
    canUndo: encounter.undoStack.length > 0,
    canClear: hasDisposableState
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
 * @param {string} text
 * @param {string} [className]
 * @returns {HTMLElement}
 */
function createTextEl(text, className = "") {
  const el = document.createElement("span");
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

/**
 * @param {{
 *   action: string,
 *   text: string,
 *   className?: string,
 *   disabled?: boolean,
 *   title?: string
 * }} opts
 * @returns {HTMLButtonElement}
 */
function createCombatActionButton({ action, text, className = "", disabled = false, title = "" }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "panelBtn panelBtnSm";
  button.dataset.combatAction = action;
  button.textContent = text;
  button.disabled = disabled;
  if (title) button.title = title;
  return button;
}

/**
 * @param {CombatCardViewModel} card
 * @returns {HTMLElement}
 */
function renderCombatCard(card) {
  const article = document.createElement("article");
  article.className = `combatCard combatRole-${card.role}`;
  article.dataset.combatParticipantId = card.id;
  article.classList.toggle("isActive", card.isActive);
  article.setAttribute("aria-label", `${card.name} combat card`);

  const header = document.createElement("div");
  header.className = "combatCardHeader";

  const titleWrap = document.createElement("div");
  titleWrap.className = "combatCardTitleWrap";
  titleWrap.appendChild(createTextEl(card.orderLabel, "combatOrderBadge"));

  const nameEl = document.createElement("div");
  nameEl.className = "combatCardName";
  nameEl.textContent = card.name;
  titleWrap.appendChild(nameEl);
  if (card.isActive) titleWrap.appendChild(createTextEl("Active", "combatActiveBadge"));

  const roleSelect = document.createElement("select");
  roleSelect.className = "combatRoleSelect";
  roleSelect.dataset.combatRole = "true";
  roleSelect.setAttribute("aria-label", `Combat role for ${card.name}`);
  COMBAT_ROLE_OPTIONS.forEach((option) => {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    optionEl.selected = option.value === card.role;
    roleSelect.appendChild(optionEl);
  });

  header.appendChild(titleWrap);
  header.appendChild(roleSelect);

  const hpRow = document.createElement("div");
  hpRow.className = "combatHpRow";
  const hpLabel = document.createElement("div");
  hpLabel.className = "combatHpLabel";
  hpLabel.textContent = "HP";
  const hpValue = document.createElement("div");
  hpValue.className = "combatHpValue";
  hpValue.classList.toggle("hasTempHp", card.hasTempHp);
  hpValue.textContent = `${card.hpCurrentLabel} / ${card.hpMaxLabel}`;
  hpRow.appendChild(hpLabel);
  hpRow.appendChild(hpValue);
  hpRow.appendChild(createTextEl(`Temp ${card.tempHp}`, "combatTempHp"));

  const statusRow = document.createElement("div");
  statusRow.className = "combatStatusRow";
  if (card.statusEffects.length === 0) {
    statusRow.appendChild(createTextEl("No status effects", "combatNoStatus"));
  } else {
    card.statusEffects.forEach((effect) => {
      const chip = document.createElement("span");
      chip.className = "combatStatusChip";
      chip.classList.toggle("isExpired", effect.expired);
      chip.textContent = effect.detail ? `${effect.label} ${effect.detail}` : effect.label;
      statusRow.appendChild(chip);
    });
  }

  const amountRow = document.createElement("div");
  amountRow.className = "combatHpActionRow";
  const amountInput = document.createElement("input");
  amountInput.className = "combatHpAmountInput";
  amountInput.type = "number";
  amountInput.min = "0";
  amountInput.step = "1";
  amountInput.inputMode = "numeric";
  amountInput.placeholder = "Amt";
  amountInput.setAttribute("aria-label", `HP amount for ${card.name}`);
  amountRow.appendChild(amountInput);
  amountRow.appendChild(createCombatActionButton({ action: "damage", text: "Damage", className: "panelBtn panelBtnSm" }));
  amountRow.appendChild(createCombatActionButton({ action: "heal", text: "Heal", className: "panelBtn panelBtnSm" }));
  amountRow.appendChild(createCombatActionButton({ action: "temp", text: "Temp", className: "panelBtn panelBtnSm" }));

  const controlRow = document.createElement("div");
  controlRow.className = "combatCardControls";
  controlRow.appendChild(createCombatActionButton({
    action: "move-up",
    text: "Up",
    disabled: !card.canMoveUp,
    title: "Move earlier"
  }));
  controlRow.appendChild(createCombatActionButton({
    action: "move-down",
    text: "Down",
    disabled: !card.canMoveDown,
    title: "Move later"
  }));
  controlRow.appendChild(createCombatActionButton({
    action: "make-active",
    text: "Make Active",
    disabled: card.isActive
  }));
  controlRow.appendChild(createCombatActionButton({
    action: "remove",
    text: "Remove",
    className: "danger panelBtn panelBtnSm"
  }));

  article.appendChild(header);
  article.appendChild(hpRow);
  article.appendChild(statusRow);
  article.appendChild(amountRow);
  article.appendChild(controlRow);
  return article;
}

/**
 * @param {HTMLElement} cardsShell
 * @param {CombatCardViewModel[]} cards
 * @returns {void}
 */
function renderCombatCards(cardsShell, cards) {
  cardsShell.replaceChildren();
  cards.forEach((card) => cardsShell.appendChild(renderCombatCard(card)));
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

  const { state, SaveManager, uiConfirm, setStatus } = deps;
  if (!state) throw new Error("initCombatPage: state is required");
  if (!SaveManager) throw new Error("initCombatPage: SaveManager is required");
  if (!setStatus) throw new Error("initCombatPage requires setStatus");

  const guard = requireMany(
    {
      root: "#page-combat",
      emptyState: "#combatEmptyState",
      cardsShell: "#combatCardsShell",
      cardsStatus: "#combatCardsStatus",
      roundValue: "#combatRoundValue",
      elapsedValue: "#combatElapsedValue",
      turnSecondsValue: "#combatTurnSecondsValue",
      turnSecondsInput: "#combatTurnSecondsInput",
      nextTurnBtn: "#combatNextTurnBtn",
      undoBtn: "#combatUndoBtn",
      clearBtn: "#combatClearBtn"
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
  const cardsShell = /** @type {HTMLElement} */ (guard.els.cardsShell);
  const cardsStatus = /** @type {HTMLElement} */ (guard.els.cardsStatus);
  const roundValue = /** @type {HTMLElement} */ (guard.els.roundValue);
  const elapsedValue = /** @type {HTMLElement} */ (guard.els.elapsedValue);
  const turnSecondsValue = /** @type {HTMLElement} */ (guard.els.turnSecondsValue);
  const turnSecondsInput = /** @type {HTMLInputElement} */ (guard.els.turnSecondsInput);
  const nextTurnBtn = /** @type {HTMLButtonElement} */ (guard.els.nextTurnBtn);
  const undoBtn = /** @type {HTMLButtonElement} */ (guard.els.undoBtn);
  const clearBtn = /** @type {HTMLButtonElement} */ (guard.els.clearBtn);

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
  const { signal } = listenerController;

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

  /**
   * @param {{ changed?: boolean }} result
   * @param {string} [message]
   * @returns {boolean}
   */
  const commitCombatResult = (result, message = "") => {
    if (!result?.changed) return false;
    SaveManager.markDirty?.();
    render();
    const canonicalWriteback = "wroteCanonical" in result && result.wroteCanonical === true;
    notifyCombatEncounterChanged({
      source: "combat-page",
      canonicalWriteback
    });
    if (message) setStatus(message, { stickyMs: 2000 });
    return true;
  };

  /**
   * @param {HTMLElement} cardEl
   * @returns {number | null}
   */
  const getCardAmount = (cardEl) => {
    const input = cardEl.querySelector(".combatHpAmountInput");
    if (!(input instanceof HTMLInputElement)) return null;
    const amount = Number(input.value);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return Math.trunc(amount);
  };

  /**
   * @param {Event} event
   * @returns {void}
   */
  const handleCombatCardClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("button[data-combat-action]");
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;

    const cardEl = button.closest("[data-combat-participant-id]");
    if (!(cardEl instanceof HTMLElement)) return;
    const participantId = cleanIdOrNull(cardEl.dataset.combatParticipantId);
    if (!participantId) return;

    const action = button.dataset.combatAction || "";
    if (action === "move-up") {
      commitCombatResult(moveCombatParticipant(state, participantId, -1), "Combat order updated.");
      return;
    }
    if (action === "move-down") {
      commitCombatResult(moveCombatParticipant(state, participantId, 1), "Combat order updated.");
      return;
    }
    if (action === "make-active") {
      commitCombatResult(setActiveCombatParticipant(state, participantId), "Active combatant updated.");
      return;
    }
    if (action === "remove") {
      const result = removeCombatParticipant(state, participantId);
      commitCombatResult(result, result.removed ? `${result.removed.name} removed from combat.` : "Combatant removed.");
      return;
    }
    if (action === "damage" || action === "heal" || action === "temp") {
      const amount = getCardAmount(cardEl);
      if (amount == null) {
        setStatus("Enter an HP amount first.", { stickyMs: 2000 });
        return;
      }
      const result = applyCombatParticipantHpAction(state, participantId, action, amount);
      if (commitCombatResult(result, "Combat HP updated.")) {
        const input = cardEl.querySelector(".combatHpAmountInput");
        if (input instanceof HTMLInputElement) input.value = "";
      }
    }
  };

  /**
   * @param {Event} event
   * @returns {void}
   */
  const handleCombatRoleChange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.dataset.combatRole !== "true") return;
    const cardEl = target.closest("[data-combat-participant-id]");
    if (!(cardEl instanceof HTMLElement)) return;
    const participantId = cleanIdOrNull(cardEl.dataset.combatParticipantId);
    if (!participantId) return;
    commitCombatResult(setCombatParticipantRole(state, participantId, target.value), "Combat role updated.");
  };

  /**
   * @returns {void}
   */
  const handleSecondsChange = () => {
    const value = Number(turnSecondsInput.value);
    if (!Number.isFinite(value) || value < 1) {
      turnSecondsInput.value = String(getCombatShellViewModel(state).secondsPerTurn);
      setStatus("Turn length must be at least 1 second.", { stickyMs: 2500 });
      return;
    }
    commitCombatResult(setCombatSecondsPerTurn(state, value), "Turn length updated.");
  };

  /**
   * @returns {Promise<void>}
   */
  const handleClearCombat = async () => {
    const ok = typeof uiConfirm === "function"
      ? await uiConfirm("Clear this combat encounter? Workspace layout stays as-is.", {
          title: "Clear Combat",
          okText: "Clear Combat",
          cancelText: "Cancel"
        })
      : true;
    if (!ok) return;
    commitCombatResult(clearCombat(state), "Combat cleared.");
  };

  const render = () => {
    const vm = getCombatShellViewModel(state);
    const controls = getCombatRoundControlsViewModel(state);
    const cards = getCombatCardViewModels(state);
    emptyState.toggleAttribute("hidden", !vm.isEmpty);
    cardsShell.hidden = vm.isEmpty;
    cardsStatus.textContent = vm.isEmpty
      ? "Add combatants from Tracker to begin."
      : `${vm.participantCount} combatant${vm.participantCount === 1 ? "" : "s"} in combat.`;
    roundValue.textContent = String(vm.round);
    elapsedValue.textContent = vm.elapsedLabel;
    turnSecondsValue.textContent = `${vm.secondsPerTurn}s`;
    if (document.activeElement !== turnSecondsInput) turnSecondsInput.value = String(vm.secondsPerTurn);
    nextTurnBtn.disabled = !controls.canNextTurn;
    undoBtn.disabled = !controls.canUndo;
    clearBtn.disabled = !controls.canClear;
    renderCombatCards(cardsShell, cards);
  };

  runShellInit("Combat layout persistence", () => setupCombatSectionReorder({ state, SaveManager, setStatus }));
  runShellInit("Combat panel collapse", () => initCombatPanelCollapse({ state, SaveManager, root }));
  cardsShell.addEventListener("click", handleCombatCardClick, { signal });
  cardsShell.addEventListener("change", handleCombatRoleChange, { signal });
  turnSecondsInput.addEventListener("change", handleSecondsChange, { signal });
  turnSecondsInput.addEventListener("blur", handleSecondsChange, { signal });
  nextTurnBtn.addEventListener("click", () => {
    const result = advanceCombatTurn(state);
    if (!result.didAdvance) {
      setStatus("Add combatants before advancing turns.", { stickyMs: 2500 });
      return;
    }
    commitCombatResult(result, result.roundAdvanced ? "Next round started." : "Turn advanced.");
  }, { signal });
  undoBtn.addEventListener("click", () => {
    const result = undoCombatTurn(state);
    if (!result.applied) {
      setStatus("No turn advance to undo.", { stickyMs: 2500 });
      return;
    }
    commitCombatResult(result, "Turn advance undone.");
  }, { signal });
  clearBtn.addEventListener("click", () => {
    void handleClearCombat();
  }, { signal });
  window.addEventListener(COMBAT_ENCOUNTER_CHANGED_EVENT, render, { signal });
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
