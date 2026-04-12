// @ts-check
// js/pages/combat/combatSectionReorder.js

import { getNoopDestroyApi } from "../../utils/domGuards.js";
import { flipSwapTwo } from "../../ui/flipSwap.js";

export const COMBAT_CARDS_PANEL_ID = "combatCardsPanel";
export const COMBAT_ROUND_PANEL_ID = "combatRoundPanel";
export const COMBAT_EMBEDDED_PANEL_HOST_ID = "combatEmbeddedPanels";
export const COMBAT_COLUMN_OWNER_PANEL_ORDER = Object.freeze([COMBAT_CARDS_PANEL_ID, COMBAT_ROUND_PANEL_ID]);

/** @typedef {{ panelOrder?: string[] }} CombatWorkspaceLayoutState */
/** @typedef {{ workspace?: CombatWorkspaceLayoutState | undefined }} CombatStateWithWorkspace */
/** @typedef {{ combat?: CombatStateWithWorkspace | undefined }} CombatSectionReorderState */
/** @typedef {{ markDirty?: () => void }} SaveManagerLike */
/** @typedef {-1 | 1} CombatPanelMoveDirection */
/**
 * @typedef {{
 *   state?: CombatSectionReorderState,
 *   SaveManager?: SaveManagerLike,
 *   setStatus?: (message: string, opts?: { stickyMs?: number }) => void
 * }} CombatSectionReorderDeps
 */

/**
 * @param {Element | null} value
 * @returns {HTMLElement | null}
 */
function asHtmlElement(value) {
  return value instanceof HTMLElement ? value : null;
}

/**
 * @param {unknown} value
 * @returns {CombatSectionReorderState | null}
 */
function asCombatSectionReorderState(value) {
  return value && typeof value === "object"
    ? /** @type {CombatSectionReorderState} */ (value)
    : null;
}

/**
 * Combat Cards owns a whole column, but the saved core order still chooses
 * which side it owns. Unknown ids are discarded and a missing core panel is
 * repaired without forcing valid reversed layouts back to the default side.
 * @param {unknown} panelOrder
 * @returns {string[]}
 */
export function normalizeCombatColumnOwnerPanelOrder(panelOrder) {
  const validIds = new Set(COMBAT_COLUMN_OWNER_PANEL_ORDER);
  /** @type {string[]} */
  const cleaned = [];

  if (Array.isArray(panelOrder)) {
    panelOrder.forEach((id) => {
      if (typeof id === "string" && validIds.has(id) && !cleaned.includes(id)) {
        cleaned.push(id);
      }
    });
  }

  if (cleaned.length === 0) return [...COMBAT_COLUMN_OWNER_PANEL_ORDER];

  COMBAT_COLUMN_OWNER_PANEL_ORDER.forEach((id) => {
    if (!cleaned.includes(id)) cleaned.push(id);
  });

  return cleaned;
}

/**
 * @param {CombatSectionReorderDeps} [deps]
 * @returns {{ applyOrder?: () => void, destroy: () => void }}
 */
export function setupCombatSectionReorder({ state, SaveManager, setStatus } = {}) {
  const pageEl = asHtmlElement(document.getElementById("page-combat"));
  const col0 = asHtmlElement(document.getElementById("combatCol0"));
  const col1 = asHtmlElement(document.getElementById("combatCol1"));
  const cardsPanel = asHtmlElement(document.getElementById(COMBAT_CARDS_PANEL_ID));
  const roundPanel = asHtmlElement(document.getElementById(COMBAT_ROUND_PANEL_ID));
  const embeddedPanels = asHtmlElement(document.getElementById(COMBAT_EMBEDDED_PANEL_HOST_ID));

  if (!pageEl || !col0 || !col1 || !cardsPanel || !roundPanel || !embeddedPanels) {
    setStatus?.("Combat layout unavailable (missing expected column elements).", { stickyMs: 5000 });
    return getNoopDestroyApi();
  }

  const reorderState = asCombatSectionReorderState(state);
  const workspace = reorderState?.combat?.workspace;
  if (!workspace) return getNoopDestroyApi();

  const normalizedOrder = normalizeCombatColumnOwnerPanelOrder(workspace.panelOrder);
  const didChangeOrder = (
    Array.isArray(workspace.panelOrder)
    && workspace.panelOrder.length > 0
    && JSON.stringify(workspace.panelOrder) !== JSON.stringify(normalizedOrder)
  );
  workspace.panelOrder = normalizedOrder;
  if (didChangeOrder) SaveManager?.markDirty?.();

  const ac = new AbortController();
  const { signal } = ac;
  /** @type {HTMLElement[]} */
  const createdMoveWraps = [];

  /**
   * @returns {string[]}
   */
  function getOrder() {
    const nextOrder = normalizeCombatColumnOwnerPanelOrder(workspace?.panelOrder);
    workspace.panelOrder = nextOrder;
    return nextOrder;
  }

  /**
   * @returns {void}
   */
  function applyOrder() {
    const cardsOwnsLeftColumn = getOrder()[0] === COMBAT_CARDS_PANEL_ID;
    const cardsColumn = cardsOwnsLeftColumn ? col0 : col1;
    const otherColumn = cardsOwnsLeftColumn ? col1 : col0;

    cardsColumn.appendChild(cardsPanel);
    otherColumn.appendChild(roundPanel);
    otherColumn.appendChild(embeddedPanels);
  }

  /**
   * @param {string} panelId
   * @param {CombatPanelMoveDirection} direction
   * @returns {void}
   */
  function movePanel(panelId, direction) {
    const order = getOrder();
    const index = order.indexOf(panelId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;

    const adjacentId = order[nextIndex];
    const panelEl = asHtmlElement(document.getElementById(panelId));
    const adjacentEl = asHtmlElement(document.getElementById(adjacentId));

    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
    workspace.panelOrder = order;
    SaveManager?.markDirty?.();

    if (!panelEl || !adjacentEl || !pageEl.contains(panelEl) || !pageEl.contains(adjacentEl)) {
      applyOrder();
      return;
    }

    const didSwap = flipSwapTwo(panelEl, adjacentEl, {
      durationMs: 260,
      easing: "cubic-bezier(.22,1,.36,1)",
      swap: applyOrder
    });
    if (!didSwap) applyOrder();
  }

  /**
   * @param {string} label
   * @param {string} title
   * @param {(button: HTMLButtonElement) => void} onClick
   * @returns {HTMLButtonElement}
   */
  function makeMoveButton(label, title, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "moveBtn";
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(btn);
    }, { signal });
    return btn;
  }

  /**
   * @param {HTMLElement} panelEl
   * @returns {void}
   */
  function attachMoveControls(panelEl) {
    const panelId = panelEl.id;
    if (!panelId) return;

    const headerEl = asHtmlElement(panelEl.querySelector(":scope > .panelHeader"));
    if (!headerEl) return;

    headerEl.querySelector(`[data-section-moves="${panelId}"]`)?.remove();

    const wrap = document.createElement("div");
    wrap.className = "sectionMoves";
    wrap.dataset.sectionMoves = panelId;
    wrap.appendChild(makeMoveButton("↑", "Move section up", (btn) => {
      movePanel(panelId, -1);
      requestAnimationFrame(() => {
        try { btn.focus({ preventScroll: true }); } catch { btn.focus(); }
      });
    }));
    wrap.appendChild(makeMoveButton("↓", "Move section down", (btn) => {
      movePanel(panelId, 1);
      requestAnimationFrame(() => {
        try { btn.focus({ preventScroll: true }); } catch { btn.focus(); }
      });
    }));

    headerEl.appendChild(wrap);
    createdMoveWraps.push(wrap);
  }

  applyOrder();
  attachMoveControls(cardsPanel);
  attachMoveControls(roundPanel);

  return {
    applyOrder,
    destroy: () => {
      ac.abort();
      createdMoveWraps.forEach((wrap) => wrap.remove());
      createdMoveWraps.length = 0;
    }
  };
}
