// @ts-check
// js/pages/character/characterSectionReorder.js

import { setupPagePanelReorder } from "../../ui/pagePanelReorder.js";
import { getActiveCharacter } from "../../domain/characterHelpers.js";

/** @typedef {{ sectionOrder?: string[], _applySectionOrder?: () => void }} CharacterPanelOrderUiState */
/** @typedef {{ ui?: CharacterPanelOrderUiState | undefined }} CharacterSectionUiState */
/** @typedef {{ characters?: { activeId?: string | null, entries?: CharacterSectionUiState[] } | undefined }} CharacterSectionReorderState */
/** @typedef {{ markDirty?: () => void }} SaveManagerLike */
/**
 * @typedef {{
 *   state?: CharacterSectionReorderState,
 *   SaveManager?: SaveManagerLike
 * }} CharacterSectionReorderDeps
 */
/** @typedef {".panelHeader" | ".row" | ".panelTop" | ".sessionHeader" | ".npcHeader" | ".partyHeader" | ".locHeader"} CharacterHeaderRowSelector */

/** @type {readonly CharacterHeaderRowSelector[]} */
const CHARACTER_HEADER_ROW_SELECTORS = [
  ".panelHeader",
  ".row",
  ".panelTop",
  ".sessionHeader",
  ".npcHeader",
  ".partyHeader",
  ".locHeader",
];

/**
 * @param {Element | null} value
 * @returns {HTMLElement | null}
 */
function asHtmlElement(value) {
  return value instanceof HTMLElement ? value : null;
}

/**
 * @param {HTMLElement} panelEl
 * @param {CharacterHeaderRowSelector} selector
 * @returns {HTMLElement | null}
 */
function queryHeaderRow(panelEl, selector) {
  return asHtmlElement(panelEl.querySelector(`:scope > ${selector}`));
}

/**
 * @param {HTMLElement} panelEl
 * @returns {HTMLElement | null}
 */
function findExistingHeaderRow(panelEl) {
  for (const selector of CHARACTER_HEADER_ROW_SELECTORS) {
    const headerRow = queryHeaderRow(panelEl, selector);
    if (headerRow) return headerRow;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {CharacterSectionReorderState | null}
 */
function asCharacterSectionReorderState(value) {
  return value && typeof value === "object"
    ? /** @type {CharacterSectionReorderState} */ (value)
    : null;
}

/**
 * @param {CharacterSectionReorderDeps} [deps]
 * @returns {ReturnType<typeof setupPagePanelReorder>}
 */
export function setupCharacterSectionReorder({ state, SaveManager } = {}) {
  return setupPagePanelReorder({
    state,
    SaveManager,

    pageId: "page-character",
    columnsWrapSelectors: ["#charColumns", ".charColumns"],
    col0Selector: "#charCol0",
    col1Selector: "#charCol1",
    panelSelector: "section.panel",

    getUiState: (s) => {
      const reorderState = asCharacterSectionReorderState(s);
      const activeCharacter = getActiveCharacter(/** @type {any} */ (reorderState));
      if (!activeCharacter) return null;
      const character = /** @type {CharacterSectionUiState} */ (activeCharacter);
      if (!character.ui) character.ui = {};
      return character.ui;
    },

    // Character-specific: panels sometimes start as <section><h2>...</h2>...</section>
    // We normalize to a header row to host the move buttons.
    ensureHeaderRow: (panelEl) => {
      const existing = findExistingHeaderRow(panelEl);
      if (existing) return existing;

      const h2 = panelEl.querySelector(":scope > h2");
      if (h2 instanceof HTMLHeadingElement) {
        const wrap = document.createElement("div");
        wrap.className = "panelHeader";
        panelEl.insertBefore(wrap, h2);
        wrap.appendChild(h2);
        return wrap;
      }

      return null;
    },

    // Expose a stable hook used by modules that need to re-apply stored order.
    storeApplyFnKey: "_applySectionOrder",
  });
}
