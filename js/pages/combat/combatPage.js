// @ts-check
// js/pages/combat/combatPage.js
//
// Combat Workspace shell — corrective pass for card UI/interaction.
// Slice 5/6 corrections: HP modal, status modal, portrait, compact status,
// moveBtn ordering, role tint, no initiative counter.

import { setupCombatSectionReorder } from "./combatSectionReorder.js";
import { initCombatEmbeddedPanels } from "./combatEmbeddedPanels.js";
import { COMBAT_ENCOUNTER_CHANGED_EVENT, notifyCombatEncounterChanged } from "./combatEvents.js";
import {
  advanceCombatTurn,
  addCombatParticipantStatusEffect,
  applyCombatParticipantHpAction,
  clearCombat,
  moveCombatParticipant,
  removeCombatParticipantStatusEffect,
  removeCombatParticipant,
  setActiveCombatParticipant,
  setCombatParticipantRole,
  setCombatSecondsPerTurn,
  updateCombatParticipantStatusEffect,
  undoCombatTurn
} from "../../domain/combatEncounterActions.js";
import {
  COMBAT_ROLES,
  STATUS_DURATION_MODES,
  findCombatSource,
  getCombatHpFromSource,
  normalizeCombatEncounter
} from "../../domain/combat.js";
import { resolveCardDisplayData } from "../../domain/cardLinking.js";
import { notifyPanelDataChanged, subscribePanelDataChanged } from "../../ui/panelInvalidation.js";
import { flipSwapTwo } from "../../ui/flipSwap.js";
import { enhanceSelectDropdown } from "../../ui/selectDropdown.js";
import { getNoopDestroyApi, requireMany } from "../../utils/domGuards.js";
import { DEV_MODE } from "../../utils/dev.js";

/** @typedef {import("../../state.js").State} State */
/** @typedef {{ markDirty?: () => void }} SaveManagerLike */
/** @typedef {(message: string, opts?: { title?: string, okText?: string, cancelText?: string }) => Promise<boolean> | boolean} UiConfirmFn */
/** @typedef {(message: string, opts?: { stickyMs?: number }) => void} CombatPageStatusFn */
/** @typedef {typeof import("../../storage/blobs.js").blobIdToObjectUrl} BlobIdToObjectUrlFn */
/**
 * @typedef {{
 *   state?: State,
 *   SaveManager?: SaveManagerLike,
 *   uiConfirm?: UiConfirmFn,
 *   uiPrompt?: Function,
 *   setStatus?: CombatPageStatusFn,
 *   Popovers?: unknown,
 *   blobIdToObjectUrl?: BlobIdToObjectUrlFn,
 *   textKey_spellNotes?: Function,
 *   putText?: Function,
 *   getText?: Function,
 *   deleteText?: Function,
 *   autoSizeInput?: Function,
 *   enhanceNumberSteppers?: Function,
 *   applyTextareaSize?: Function
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
 *   isActive: boolean,
 *   canMoveUp: boolean,
 *   canMoveDown: boolean,
 *   hpCurrentLabel: string,
 *   hpMaxLabel: string,
 *   hpDisplayLabel: string,
 *   tempHp: number,
 *   hasTempHp: boolean,
 *   hpState: "normal" | "temp" | "zero",
 *   portraitBlobId: string | null,
 *   statusEffects: Array<{
 *     id: string,
 *     label: string,
 *     detail: string,
 *     durationMode: "none" | "rounds" | "seconds",
 *     durationInputValue: string,
 *     remainingLabel: string,
 *     expired: boolean
 *   }>
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
export const COMBAT_STATUS_DURATION_OPTIONS = Object.freeze([
  { value: STATUS_DURATION_MODES.NONE, label: "No duration" },
  { value: STATUS_DURATION_MODES.ROUNDS, label: "Rounds" },
  { value: STATUS_DURATION_MODES.SECONDS, label: "Seconds" },
  { value: STATUS_DURATION_MODES.MINUTES, label: "Minutes" },
  { value: STATUS_DURATION_MODES.HOURS, label: "Hours" }
]);

export const COMBAT_ROLE_SELECT_CLASSES = "panelSelect combatRoleSelect";
export const COMBAT_STATUS_MODE_SELECT_CLASSES = "settingsSelect combatStatusModalModeSelect";

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
 * @returns {string}
 */
function formatStatusTimeRemaining(remaining) {
  const safeSeconds = Math.max(0, Math.trunc(Number(remaining) || 0));
  if (safeSeconds < 60) return `${safeSeconds}s`;
  const totalMinutes = Math.floor(safeSeconds / 60);
  if (safeSeconds < 3600) {
    const seconds = safeSeconds % 60;
    return `${String(totalMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * @param {unknown} remaining
 * @param {unknown} mode
 * @returns {string}
 */
export function formatStatusEffectDetail(remaining, mode) {
  if (mode === "rounds") return `(${Number(remaining) || 0} rd)`;
  if (mode === "time") return `(${formatStatusTimeRemaining(remaining)})`;
  return "";
}

/**
 * @param {unknown} remaining
 * @param {unknown} mode
 * @returns {string}
 */
function formatStatusRemainingLabel(remaining, mode) {
  if (mode === "rounds") return `${Number(remaining) || 0} rd`;
  if (mode === "time") return formatStatusTimeRemaining(remaining);
  return "";
}

/**
 * @param {unknown} remaining
 * @param {unknown} mode
 * @returns {string}
 */
function formatStatusDurationInputValue(remaining, mode) {
  if (mode !== "rounds" && mode !== "time") return "";
  const value = Math.max(0, Math.trunc(Number(remaining) || 0));
  return String(value);
}

/**
 * @param {unknown} state
 * @returns {CombatCardViewModel[]}
 */
export function getCombatCardViewModels(state) {
  const s = objectOrEmpty(state);
  const encounter = normalizeCombatEncounter(objectOrEmpty(s.combat).encounter);
  const tracker = s.tracker;

  return encounter.participants.map((participant, index) => {
    // Resolve portrait blob ID from canonical source — never copied into encounter state.
    let portraitBlobId = /** @type {string | null} */ (null);
    const source = findCombatSource(
      tracker != null && typeof tracker === "object" && !Array.isArray(tracker)
        ? /** @type {Record<string, unknown>} */ (tracker)
        : null,
      participant.source
    );
    const sourceDisplay = source ? resolveCardDisplayData(source.card, /** @type {Record<string, unknown>} */ (s)) : null;
    const sourceBlobId = sourceDisplay?.imgBlobId;
    if (typeof sourceBlobId === "string" && sourceBlobId) {
      portraitBlobId = sourceBlobId;
    }

    const sourceHp = sourceDisplay ? getCombatHpFromSource(sourceDisplay) : null;
    const canonicalMax = sourceHp?.hpMax ?? participant.hpMax;
    const currentHp = participant.hpCurrent;
    const tempHp = Math.max(0, Math.trunc(Number(participant.tempHp) || 0));
    const displayHp = currentHp == null ? null : currentHp + tempHp;
    const hpCurrent = currentHp == null ? "--" : String(currentHp);
    const hpMax = canonicalMax == null ? "--" : String(canonicalMax);
    const hpDisplay = displayHp == null ? "--" : String(displayHp);
    const hpState = tempHp > 0 ? "temp" : displayHp === 0 ? "zero" : "normal";

    return {
      id: participant.id,
      name: (sourceDisplay?.name || participant.name) || "Unnamed participant",
      role: participant.role,
      roleLabel: COMBAT_ROLE_OPTIONS.find((option) => option.value === participant.role)?.label || "NPC",
      isActive: participant.id === encounter.activeParticipantId,
      canMoveUp: index > 0,
      canMoveDown: index < encounter.participants.length - 1,
      hpCurrentLabel: hpCurrent,
      hpMaxLabel: hpMax,
      hpDisplayLabel: hpDisplay,
      tempHp,
      hasTempHp: tempHp > 0,
      hpState,
      portraitBlobId,
      statusEffects: participant.statusEffects.map((effect) => ({
        id: effect.id,
        label: effect.label,
        detail: formatStatusEffectDetail(effect.remaining, effect.durationMode),
        durationMode: effect.durationMode === "time" ? "seconds" : effect.durationMode,
        durationInputValue: formatStatusDurationInputValue(effect.remaining, effect.durationMode),
        remainingLabel: formatStatusRemainingLabel(effect.remaining, effect.durationMode),
        expired: effect.expired === true
      }))
    };
  });
}

/**
 * @param {HTMLSelectElement} select
 * @param {unknown} Popovers
 * @param {{
 *   buttonClass: string,
 *   preferRight?: boolean,
 *   exclusive?: boolean
 * }} opts
 * @returns {ReturnType<typeof enhanceSelectDropdown> | null}
 */
function enhanceCombatSelect(select, Popovers, opts) {
  if (!Popovers) return null;
  return enhanceSelectDropdown({
    select,
    Popovers,
    buttonClass: opts.buttonClass,
    optionClass: "swatchOption",
    groupLabelClass: "dropdownGroupLabel",
    preferRight: opts.preferRight !== false,
    exclusive: opts.exclusive
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
 * Syncs the duration input's enabled state and placeholder with the mode select.
 * @param {HTMLSelectElement} select
 * @param {HTMLInputElement} input
 * @returns {void}
 */
function syncStatusDurationInput(select, input) {
  const hasDuration = select.value === "rounds"
    || select.value === "time"
    || select.value === "seconds"
    || select.value === "minutes"
    || select.value === "hours";
  input.disabled = !hasDuration;
  input.placeholder = select.value === "minutes"
    ? "Minutes"
    : select.value === "hours"
      ? "Hours"
      : select.value === "rounds"
        ? "Rounds"
        : "Seconds";
  if (!hasDuration) input.value = "";
}

/**
 * Renders a compact status effect row: gear button, label box, duration box.
 * Replaces the Slice 6 inline editor rows with a modal-based editing flow.
 * @param {CombatCardViewModel["statusEffects"][number]} effect
 * @returns {HTMLElement}
 */
function renderCompactStatusEffect(effect) {
  const row = document.createElement("div");
  row.className = "combatStatusCompactRow";
  row.classList.toggle("isExpired", effect.expired);
  row.dataset.combatStatusEffectId = effect.id;

  const gearBtn = document.createElement("button");
  gearBtn.type = "button";
  gearBtn.className = "moveBtn combatStatusGearBtn";
  gearBtn.dataset.combatAction = "status-modal-open-edit";
  gearBtn.title = `Edit ${effect.label}`;
  gearBtn.setAttribute("aria-label", `Edit status: ${effect.label}`);
  gearBtn.textContent = "⚙";
  row.appendChild(gearBtn);

  const nameBox = document.createElement("span");
  nameBox.className = "combatStatusNameBox combatStatusChip";
  nameBox.classList.toggle("isExpired", effect.expired);
  nameBox.textContent = effect.label;
  row.appendChild(nameBox);

  if (effect.remainingLabel) {
    const durationBox = document.createElement("span");
    durationBox.className = "combatStatusDurationBox";
    durationBox.textContent = effect.remainingLabel;
    row.appendChild(durationBox);
  }

  if (effect.expired) {
    row.appendChild(createTextEl("Expired", "combatStatusExpiredLabel"));
  }

  return row;
}

/**
 * Renders a small portrait area for the left column of a combat card.
 * Uses a canonical blob ID — no image data is copied into encounter state.
 * Falls back to an initials avatar when no portrait is set.
 * @param {string | null} blobId
 * @param {string} name
 * @param {BlobIdToObjectUrlFn | undefined} blobIdToObjectUrl
 * @returns {HTMLElement}
 */
function renderCombatPortrait(blobId, name, blobIdToObjectUrl) {
  const wrap = document.createElement("div");
  wrap.className = "combatCardPortrait";
  wrap.setAttribute("aria-hidden", "true");

  if (blobId && typeof blobIdToObjectUrl === "function") {
    const img = document.createElement("img");
    img.className = "combatCardPortraitImg";
    img.alt = "";
    wrap.appendChild(img);
    blobIdToObjectUrl(blobId).then((url) => {
      if (url) img.src = url;
    }).catch(() => { /* ignore stale blob errors */ });
  } else {
    const avatar = document.createElement("div");
    avatar.className = "combatCardPortraitAvatar";
    avatar.textContent = (name || "?").trim().charAt(0).toUpperCase();
    wrap.appendChild(avatar);
  }

  return wrap;
}

/**
 * Renders a single combat card article element.
 * - No initiative/order counter (removed per v1 spec)
 * - Portrait on the left (canonical, read-only)
 * - Single clickable HP area → opens HP modal
 * - Compact status chips + gear buttons + "+ Status Effect" → opens status modal
 * - ↑/↓ move buttons using the existing moveBtn style
 * - Role tint via combatRole-{role} class (already wired in CSS)
 * @param {CombatCardViewModel} card
 * @param {BlobIdToObjectUrlFn | undefined} blobIdToObjectUrl
 * @param {unknown} Popovers
 * @returns {HTMLElement}
 */
function renderCombatCard(card, blobIdToObjectUrl, Popovers) {
  const article = document.createElement("article");
  article.className = `combatCard combatRole-${card.role}`;
  article.dataset.combatParticipantId = card.id;
  article.classList.toggle("isActive", card.isActive);
  article.setAttribute("aria-label", `${card.name} combat card`);

  // Left column: portrait
  article.appendChild(renderCombatPortrait(card.portraitBlobId, card.name, blobIdToObjectUrl));

  // Right column: all card content
  const content = document.createElement("div");
  content.className = "combatCardContent";

  // Header row: name + active badge + role select
  const header = document.createElement("div");
  header.className = "combatCardHeader";

  const titleWrap = document.createElement("div");
  titleWrap.className = "combatCardTitleWrap";
  const nameEl = document.createElement("div");
  nameEl.className = "combatCardName";
  nameEl.textContent = card.name;
  titleWrap.appendChild(nameEl);
  if (card.isActive) titleWrap.appendChild(createTextEl("Active", "combatActiveBadge"));

  const roleSelect = document.createElement("select");
  roleSelect.className = COMBAT_ROLE_SELECT_CLASSES;
  roleSelect.dataset.combatRole = "true";
  roleSelect.title = `Combat role for ${card.name}`;
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
  enhanceCombatSelect(roleSelect, Popovers, {
    buttonClass: "panelSelectBtn",
    preferRight: true
  });

  // HP area: single clickable button — opens HP modal
  const hpBtn = document.createElement("button");
  hpBtn.type = "button";
  hpBtn.className = "combatHpBtn";
  hpBtn.classList.toggle("hasTempHp", card.hasTempHp);
  hpBtn.classList.toggle("isZeroHp", card.hpState === "zero");
  hpBtn.dataset.combatAction = "hp-modal";
  hpBtn.setAttribute("aria-label", `Adjust HP for ${card.name}`);
  const hpLabel = document.createElement("span");
  hpLabel.className = "combatHpLabel";
  hpLabel.textContent = "HP";
  const hpValue = document.createElement("span");
  hpValue.className = "combatHpValue";
  hpValue.textContent = card.hpDisplayLabel;
  hpBtn.appendChild(hpLabel);
  hpBtn.appendChild(hpValue);

  // Status row: compact chips with gear buttons + add button
  const statusRow = document.createElement("div");
  statusRow.className = "combatStatusRow";
  if (card.statusEffects.length === 0) {
    statusRow.appendChild(createTextEl("No status effects", "combatNoStatus"));
  } else {
    card.statusEffects.forEach((effect) => {
      statusRow.appendChild(renderCompactStatusEffect(effect));
    });
  }
  statusRow.appendChild(
    createCombatActionButton({
      action: "status-modal-open-add",
      text: "+ Status Effect",
      className: "panelBtn panelBtnSm combatAddStatusBtn"
    })
  );

  // Controls row: ↑/↓ move buttons (reuse moveBtn style) + make active + remove
  const controlRow = document.createElement("div");
  controlRow.className = "combatCardControls";

  const movesWrap = document.createElement("div");
  movesWrap.className = "combatCardMoves";

  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "moveBtn";
  upBtn.dataset.combatAction = "move-up";
  upBtn.textContent = "↑";
  upBtn.title = "Move earlier in order";
  upBtn.disabled = !card.canMoveUp;
  movesWrap.appendChild(upBtn);

  const downBtn = document.createElement("button");
  downBtn.type = "button";
  downBtn.className = "moveBtn";
  downBtn.dataset.combatAction = "move-down";
  downBtn.textContent = "↓";
  downBtn.title = "Move later in order";
  downBtn.disabled = !card.canMoveDown;
  movesWrap.appendChild(downBtn);

  controlRow.appendChild(movesWrap);
  controlRow.appendChild(
    createCombatActionButton({
      action: "make-active",
      text: "Active",
      disabled: card.isActive,
      title: "Set as active combatant"
    })
  );
  controlRow.appendChild(
    createCombatActionButton({
      action: "remove",
      text: "Remove",
      className: "danger panelBtn panelBtnSm"
    })
  );

  content.appendChild(header);
  content.appendChild(hpBtn);
  content.appendChild(statusRow);
  content.appendChild(controlRow);
  article.appendChild(content);
  return article;
}

/**
 * @param {HTMLElement} cardsShell
 * @param {CombatCardViewModel[]} cards
 * @param {BlobIdToObjectUrlFn | undefined} blobIdToObjectUrl
 * @param {unknown} Popovers
 * @returns {void}
 */
function renderCombatCards(cardsShell, cards, blobIdToObjectUrl, Popovers) {
  cardsShell.replaceChildren();
  cards.forEach((card) => cardsShell.appendChild(renderCombatCard(card, blobIdToObjectUrl, Popovers)));
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
 * Creates the shared HP adjustment modal overlay element and appends it to document.body.
 * Any previously-created instance is removed first.
 * @returns {{
 *   overlay: HTMLElement,
 *   titleEl: HTMLElement,
 *   infoEl: HTMLElement,
 *   input: HTMLInputElement
 * }}
 */
function createCombatHpModal() {
  document.getElementById("combatHpModal")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "modalOverlay";
  overlay.id = "combatHpModal";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");

  const panel = document.createElement("div");
  panel.className = "modalPanel combatModalPanel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "combatHpModalTitle");
  panel.setAttribute("tabindex", "-1");
  // Static template — no user-controlled text is set via innerHTML.
  panel.innerHTML = `
    <div class="combatModalHeader">
      <div class="modalTitle combatModalTitle" id="combatHpModalTitle">Adjust HP</div>
      <button type="button" class="npcSmallBtn" data-combat-hp-close aria-label="Close">✕</button>
    </div>
    <div class="combatModalBody">
      <p class="combatHpModalInfo m0 mutedSmall"></p>
      <input type="number" min="0" step="1" inputmode="numeric" placeholder="Amount"
             class="combatHpModalInput" aria-label="HP amount" />
    </div>
    <div class="combatModalFooter">
      <button type="button" class="danger panelBtn panelBtnSm" data-combat-hp-action="damage">Damage</button>
      <button type="button" class="panelBtn panelBtnSm" data-combat-hp-action="heal">Heal</button>
      <button type="button" class="panelBtn panelBtnSm" data-combat-hp-action="temp">Temp HP</button>
      <button type="button" class="panelBtn panelBtnSm" data-combat-hp-close>Cancel</button>
    </div>
  `;

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  return {
    overlay,
    titleEl: /** @type {HTMLElement} */ (panel.querySelector(".combatModalTitle")),
    infoEl: /** @type {HTMLElement} */ (panel.querySelector(".combatHpModalInfo")),
    input: /** @type {HTMLInputElement} */ (panel.querySelector(".combatHpModalInput"))
  };
}

/**
 * Creates the turn-length modal overlay and appends it to document.body.
 * Any previously-created instance is removed first.
 * @returns {{
 *   overlay: HTMLElement,
 *   input: HTMLInputElement,
 *   saveBtn: HTMLButtonElement
 * }}
 */
function createCombatTurnSecondsModal() {
  document.getElementById("combatTurnSecondsModal")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "modalOverlay";
  overlay.id = "combatTurnSecondsModal";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");

  const panel = document.createElement("div");
  panel.className = "modalPanel combatModalPanel combatTurnSecondsModalPanel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "combatTurnSecondsModalTitle");
  panel.setAttribute("tabindex", "-1");
  panel.innerHTML = `
    <div class="combatModalHeader">
      <div class="modalTitle combatModalTitle" id="combatTurnSecondsModalTitle">Seconds Per Turn</div>
      <button type="button" class="npcSmallBtn" data-combat-turn-seconds-close aria-label="Close">✕</button>
    </div>
    <div class="combatModalBody">
      <label class="combatTurnSecondsModalLabel" for="combatTurnSecondsModalInput">Turn length in seconds</label>
      <input id="combatTurnSecondsModalInput" type="number" min="1" step="1" inputmode="numeric"
             class="combatTurnSecondsModalInput" aria-label="Seconds per turn" />
    </div>
    <div class="combatModalFooter">
      <button type="button" class="panelBtn panelBtnSm" data-combat-turn-seconds-save>Save</button>
      <button type="button" class="panelBtn panelBtnSm" data-combat-turn-seconds-close>Cancel</button>
    </div>
  `;

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  return {
    overlay,
    input: /** @type {HTMLInputElement} */ (panel.querySelector(".combatTurnSecondsModalInput")),
    saveBtn: /** @type {HTMLButtonElement} */ (panel.querySelector("[data-combat-turn-seconds-save]"))
  };
}

/**
 * Creates the shared status effect modal overlay element and appends it to document.body.
 * Any previously-created instance is removed first.
 * @returns {{
 *   overlay: HTMLElement,
 *   titleEl: HTMLElement,
 *   labelInput: HTMLInputElement,
 *   modeSelect: HTMLSelectElement,
 *   durationInput: HTMLInputElement,
 *   applyBtn: HTMLButtonElement,
 *   removeBtn: HTMLButtonElement
 * }}
 */
function createCombatStatusModal(Popovers) {
  document.getElementById("combatStatusModal")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "modalOverlay";
  overlay.id = "combatStatusModal";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");

  const panel = document.createElement("div");
  panel.className = "modalPanel combatModalPanel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "combatStatusModalTitle");
  panel.setAttribute("tabindex", "-1");
  // Static template — user-controlled values are set via .value / .textContent, not innerHTML.
  panel.innerHTML = `
    <div class="combatModalHeader">
      <div class="modalTitle combatModalTitle" id="combatStatusModalTitle">Add Status Effect</div>
      <button type="button" class="npcSmallBtn" data-combat-status-close aria-label="Close">✕</button>
    </div>
    <div class="combatModalBody">
      <input type="text" placeholder="Status label" class="combatStatusModalLabelInput"
             aria-label="Status label" />
      <div class="combatStatusModalDuration">
        <select class="${COMBAT_STATUS_MODE_SELECT_CLASSES}" aria-label="Duration mode" title="Duration mode"></select>
        <input type="number" min="0" step="1" inputmode="numeric" placeholder="Rounds"
               class="combatStatusModalDurationInput" aria-label="Duration amount" disabled />
      </div>
    </div>
    <div class="combatModalFooter">
      <button type="button" class="panelBtn panelBtnSm" data-combat-status-apply>Apply</button>
      <button type="button" class="danger panelBtn panelBtnSm" data-combat-status-remove hidden>Remove</button>
      <button type="button" class="panelBtn panelBtnSm" data-combat-status-close>Cancel</button>
    </div>
  `;

  // Populate the duration mode select with standard options.
  const modeSelect = /** @type {HTMLSelectElement} */ (panel.querySelector(".combatStatusModalModeSelect"));
  COMBAT_STATUS_DURATION_OPTIONS.forEach((option) => {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    modeSelect.appendChild(optionEl);
  });

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  enhanceCombatSelect(modeSelect, Popovers, {
    buttonClass: "settingsSelectBtn",
    preferRight: true,
    exclusive: false
  });

  return {
    overlay,
    titleEl: /** @type {HTMLElement} */ (panel.querySelector(".combatModalTitle")),
    labelInput: /** @type {HTMLInputElement} */ (panel.querySelector(".combatStatusModalLabelInput")),
    modeSelect,
    durationInput: /** @type {HTMLInputElement} */ (panel.querySelector(".combatStatusModalDurationInput")),
    applyBtn: /** @type {HTMLButtonElement} */ (panel.querySelector("[data-combat-status-apply]")),
    removeBtn: /** @type {HTMLButtonElement} */ (panel.querySelector("[data-combat-status-remove]"))
  };
}

/**
 * @param {CombatPageDeps} [deps]
 * @returns {CombatPageApi}
 */
export function initCombatPage(deps = {}) {
  activeCombatPageController?.destroy?.();
  activeCombatPageController = null;

  const {
    state,
    SaveManager,
    uiConfirm,
    uiPrompt,
    setStatus,
    Popovers,
    blobIdToObjectUrl,
    textKey_spellNotes,
    putText,
    getText,
    deleteText,
    autoSizeInput,
    enhanceNumberSteppers,
    applyTextareaSize
  } = deps;
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
      turnSecondsButton: "#combatTurnSecondsButton",
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
  const turnSecondsButton = /** @type {HTMLButtonElement} */ (guard.els.turnSecondsButton);
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

  // ── Shared modals ──────────────────────────────────────────────────────────

  const hpModal = createCombatHpModal();
  addDestroy(() => hpModal.overlay.remove());

  const turnSecondsModal = createCombatTurnSecondsModal();
  addDestroy(() => turnSecondsModal.overlay.remove());

  const statusModal = createCombatStatusModal(Popovers);
  addDestroy(() => statusModal.overlay.remove());

  // Modal context: which participant / effect is currently being edited.
  let _hpParticipantId = /** @type {string | null} */ (null);
  let _statusParticipantId = /** @type {string | null} */ (null);
  let _statusEffectId = /** @type {string | null} */ (null);

  /**
   * @param {string} participantId
   * @param {CombatCardViewModel} card
   * @returns {void}
   */
  const openHpModal = (participantId, card) => {
    _hpParticipantId = participantId;
    hpModal.titleEl.textContent = `Adjust HP — ${card.name}`;
    hpModal.infoEl.textContent = card.hasTempHp
      ? `Current: ${card.hpCurrentLabel} / ${card.hpMaxLabel}  ·  Temp HP: +${card.tempHp}`
      : `Current: ${card.hpCurrentLabel} / ${card.hpMaxLabel}`;
    hpModal.input.value = "";
    hpModal.overlay.hidden = false;
    hpModal.overlay.setAttribute("aria-hidden", "false");
    queueMicrotask(() => { try { hpModal.input.focus(); } catch { /* ignore */ } });
  };

  const closeHpModal = () => {
    hpModal.overlay.hidden = true;
    hpModal.overlay.setAttribute("aria-hidden", "true");
    _hpParticipantId = null;
  };

  const openTurnSecondsModal = () => {
    const vm = getCombatShellViewModel(state);
    turnSecondsModal.input.value = String(vm.secondsPerTurn);
    turnSecondsModal.overlay.hidden = false;
    turnSecondsModal.overlay.setAttribute("aria-hidden", "false");
    queueMicrotask(() => {
      try {
        turnSecondsModal.input.focus();
        turnSecondsModal.input.select();
      } catch { /* ignore */ }
    });
  };

  const closeTurnSecondsModal = () => {
    turnSecondsModal.overlay.hidden = true;
    turnSecondsModal.overlay.setAttribute("aria-hidden", "true");
  };

  /**
   * @param {string} participantId
   * @param {string | null} effectId  null = add mode
   * @param {CombatCardViewModel["statusEffects"][number] | null} [effect]
   * @returns {void}
   */
  const openStatusModal = (participantId, effectId, effect = null) => {
    _statusParticipantId = participantId;
    _statusEffectId = effectId;

    const isEdit = !!effectId;
    statusModal.titleEl.textContent = isEdit ? "Edit Status Effect" : "Add Status Effect";
    statusModal.labelInput.value = effect?.label ?? "";
    statusModal.modeSelect.value = effect?.durationMode ?? "none";
    try { statusModal.modeSelect.dispatchEvent(new Event("selectDropdown:sync")); } catch { /* noop */ }
    statusModal.durationInput.value = effect?.durationInputValue ?? "";
    syncStatusDurationInput(statusModal.modeSelect, statusModal.durationInput);
    statusModal.removeBtn.hidden = !isEdit;

    statusModal.overlay.hidden = false;
    statusModal.overlay.setAttribute("aria-hidden", "false");
    queueMicrotask(() => { try { statusModal.labelInput.focus(); } catch { /* ignore */ } });
  };

  const closeStatusModal = () => {
    statusModal.overlay.hidden = true;
    statusModal.overlay.setAttribute("aria-hidden", "true");
    _statusParticipantId = null;
    _statusEffectId = null;
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

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
   * @param {{ changed?: boolean }} result
   * @param {HTMLElement | null} movedEl
   * @param {HTMLElement | null} adjacentEl
   * @param {-1 | 1} direction
   * @param {string} [message]
   * @returns {boolean}
   */
  const commitCombatMoveResult = (result, movedEl, adjacentEl, direction, message = "") => {
    if (!result?.changed) return false;
    SaveManager.markDirty?.();
    if (message) setStatus(message, { stickyMs: 2000 });

    const canAnimate = movedEl instanceof HTMLElement
      && adjacentEl instanceof HTMLElement
      && movedEl.parentElement === cardsShell
      && adjacentEl.parentElement === cardsShell;

    if (!canAnimate) {
      render();
      return true;
    }

    const didSwap = flipSwapTwo(movedEl, adjacentEl, {
      durationMs: 260,
      easing: "cubic-bezier(.22,1,.36,1)",
      swap: () => {
        if (direction < 0) cardsShell.insertBefore(movedEl, adjacentEl);
        else cardsShell.insertBefore(adjacentEl, movedEl);
      }
    });

    if (!didSwap) {
      render();
      return true;
    }
    window.setTimeout(render, 320);
    return true;
  };

  /**
   * Reads and validates the HP modal's amount input.
   * @returns {number | null}
   */
  const getHpModalAmount = () => {
    const value = Number(hpModal.input.value);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.trunc(value);
  };

  /**
   * Reads and validates the status modal's fields.
   * @returns {{ input: { label: string, durationMode: string, duration: number | null, remaining: number | null } | null, error: string }}
   */
  const readStatusModalInput = () => {
    const label = statusModal.labelInput.value.trim();
    if (!label) return { input: null, error: "Status effects need a label." };

    const durationMode = statusModal.modeSelect.value;
    if (
      durationMode !== "rounds"
      && durationMode !== "time"
      && durationMode !== "seconds"
      && durationMode !== "minutes"
      && durationMode !== "hours"
    ) {
      return { input: { label, durationMode: "none", duration: null, remaining: null }, error: "" };
    }

    if (statusModal.durationInput.value.trim() === "") {
      return { input: null, error: "Enter a duration for timed status effects." };
    }

    const duration = Number(statusModal.durationInput.value);
    if (!Number.isFinite(duration) || duration < 0) {
      return { input: null, error: "Status duration must be zero or more." };
    }

    const remaining = Math.max(0, Math.trunc(duration));
    if (durationMode === "rounds") {
      return { input: { label, durationMode, duration: remaining, remaining }, error: "" };
    }
    const multiplier = durationMode === "minutes" ? 60 : durationMode === "hours" ? 3600 : 1;
    const seconds = remaining * multiplier;
    return { input: { label, durationMode: "time", duration: seconds, remaining: seconds }, error: "" };
  };

  // ── Event handlers ─────────────────────────────────────────────────────────

  /**
   * Handles clicks delegated from the cardsShell.
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
      const adjacentEl = cardEl.previousElementSibling instanceof HTMLElement ? cardEl.previousElementSibling : null;
      commitCombatMoveResult(moveCombatParticipant(state, participantId, -1), cardEl, adjacentEl, -1, "Combat order updated.");
      return;
    }
    if (action === "move-down") {
      const adjacentEl = cardEl.nextElementSibling instanceof HTMLElement ? cardEl.nextElementSibling : null;
      commitCombatMoveResult(moveCombatParticipant(state, participantId, 1), cardEl, adjacentEl, 1, "Combat order updated.");
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
    if (action === "hp-modal") {
      const cards = getCombatCardViewModels(state);
      const card = cards.find((c) => c.id === participantId);
      if (card) openHpModal(participantId, card);
      return;
    }
    if (action === "status-modal-open-add") {
      openStatusModal(participantId, null, null);
      return;
    }
    if (action === "status-modal-open-edit") {
      const statusEl = button.closest("[data-combat-status-effect-id]");
      if (!(statusEl instanceof HTMLElement)) return;
      const effectId = cleanIdOrNull(statusEl.dataset.combatStatusEffectId);
      if (!effectId) return;
      const cards = getCombatCardViewModels(state);
      const card = cards.find((c) => c.id === participantId);
      const effect = card?.statusEffects.find((e) => e.id === effectId) ?? null;
      openStatusModal(participantId, effectId, effect);
      return;
    }
  };

  /**
   * Handles role select changes on combat cards.
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
  const saveTurnSecondsModal = () => {
    const value = Number(turnSecondsModal.input.value);
    if (!Number.isFinite(value) || value < 1) {
      setStatus("Turn length must be at least 1 second.", { stickyMs: 2500 });
      return;
    }
    const result = setCombatSecondsPerTurn(state, value);
    if (result.changed) {
      commitCombatResult(result, "Turn length updated.");
    }
    closeTurnSecondsModal();
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

  // ── HP modal wiring ────────────────────────────────────────────────────────

  hpModal.overlay.addEventListener("click", (e) => {
    if (e.target === hpModal.overlay) closeHpModal();
  }, { signal });

  hpModal.overlay.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;

    if (target?.closest("[data-combat-hp-close]")) {
      closeHpModal();
      return;
    }

    const actionBtn = target?.closest("[data-combat-hp-action]");
    if (!(actionBtn instanceof HTMLButtonElement)) return;
    const action = /** @type {"damage" | "heal" | "temp"} */ (actionBtn.dataset.combatHpAction || "");
    if (action !== "damage" && action !== "heal" && action !== "temp") return;

    if (!_hpParticipantId) return;
    const amount = getHpModalAmount();
    if (amount == null) {
      setStatus("Enter a positive HP amount.", { stickyMs: 2000 });
      return;
    }
    const result = applyCombatParticipantHpAction(state, _hpParticipantId, action, amount);
    if (commitCombatResult(result, "Combat HP updated.")) {
      closeHpModal();
    }
  }, { signal });

  // ── Seconds-per-turn modal wiring ─────────────────────────────────────────

  turnSecondsModal.overlay.addEventListener("click", (e) => {
    if (e.target === turnSecondsModal.overlay) closeTurnSecondsModal();
  }, { signal });

  turnSecondsModal.overlay.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest("[data-combat-turn-seconds-close]")) {
      closeTurnSecondsModal();
      return;
    }
    if (target?.closest("[data-combat-turn-seconds-save]")) {
      saveTurnSecondsModal();
    }
  }, { signal });

  turnSecondsModal.input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    saveTurnSecondsModal();
  }, { signal });

  // ── Status modal wiring ────────────────────────────────────────────────────

  statusModal.overlay.addEventListener("click", (e) => {
    if (e.target === statusModal.overlay) closeStatusModal();
  }, { signal });

  statusModal.overlay.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest("[data-combat-status-close]")) {
      closeStatusModal();
    }
  }, { signal });

  statusModal.modeSelect.addEventListener("change", () => {
    syncStatusDurationInput(statusModal.modeSelect, statusModal.durationInput);
  }, { signal });

  statusModal.applyBtn.addEventListener("click", () => {
    if (!_statusParticipantId) return;
    const { input, error } = readStatusModalInput();
    if (!input) {
      setStatus(error || "Status could not be saved.", { stickyMs: 2500 });
      return;
    }
    if (_statusEffectId) {
      // Edit mode
      const result = updateCombatParticipantStatusEffect(state, _statusParticipantId, _statusEffectId, input);
      if (!commitCombatResult(result, "Status effect updated.")) {
        setStatus("No status changes to save.", { stickyMs: 1800 });
        return;
      }
      if (result.wroteCanonical) notifyPanelDataChanged("character-fields", { source: "combat-page" });
    } else {
      // Add mode
      const result = addCombatParticipantStatusEffect(state, _statusParticipantId, input);
      if (!commitCombatResult(result, "Status effect added.")) return;
      if (result.wroteCanonical) notifyPanelDataChanged("character-fields", { source: "combat-page" });
    }
    closeStatusModal();
  }, { signal });

  statusModal.removeBtn.addEventListener("click", () => {
    if (!_statusParticipantId || !_statusEffectId) return;
    const result = removeCombatParticipantStatusEffect(state, _statusParticipantId, _statusEffectId);
    commitCombatResult(result, "Status effect removed.");
    if (result.wroteCanonical) notifyPanelDataChanged("character-fields", { source: "combat-page" });
    closeStatusModal();
  }, { signal });

  // Close either modal on Escape.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!hpModal.overlay.hidden) { closeHpModal(); return; }
    if (!turnSecondsModal.overlay.hidden) { closeTurnSecondsModal(); return; }
    if (!statusModal.overlay.hidden) { closeStatusModal(); }
  }, { signal });

  // ── Main render ────────────────────────────────────────────────────────────

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
    turnSecondsButton.setAttribute("aria-label", `Edit seconds per turn, currently ${vm.secondsPerTurn} seconds`);
    nextTurnBtn.disabled = !controls.canNextTurn;
    undoBtn.disabled = !controls.canUndo;
    clearBtn.disabled = !controls.canClear;
    renderCombatCards(cardsShell, cards, blobIdToObjectUrl, Popovers);
  };

  // ── Init ───────────────────────────────────────────────────────────────────

  runShellInit("Combat layout persistence", () => setupCombatSectionReorder({ state, SaveManager, setStatus }));
  runShellInit("Combat panel collapse", () => initCombatPanelCollapse({ state, SaveManager, root }));
  runShellInit("Combat embedded panels", () => initCombatEmbeddedPanels({
    state,
    SaveManager,
    setStatus,
    root,
    uiConfirm,
    uiPrompt,
    Popovers,
    textKey_spellNotes,
    putText,
    getText,
    deleteText,
    autoSizeInput,
    enhanceNumberSteppers,
    applyTextareaSize
  }));

  cardsShell.addEventListener("click", handleCombatCardClick, { signal });
  cardsShell.addEventListener("change", handleCombatRoleChange, { signal });

  turnSecondsButton.addEventListener("click", openTurnSecondsModal, { signal });

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
  addDestroy(subscribePanelDataChanged("vitals", render));
  addDestroy(subscribePanelDataChanged("character-fields", render));
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
