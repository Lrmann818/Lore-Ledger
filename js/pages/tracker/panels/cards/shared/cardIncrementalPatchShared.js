import { renderCardPortrait } from "./cardPortraitRenderShared.js";
import * as masonry from "../../../../../ui/masonryLayout.js";

/** @typedef {typeof import("../../../../../storage/blobs.js").blobIdToObjectUrl} BlobIdToObjectUrlFn */
/**
 * @typedef {{
 *   cardsEl?: HTMLElement | null,
 *   blobIdToObjectUrl?: BlobIdToObjectUrlFn
 * }} CardIncrementalDomPatcherOptions
 */
/**
 * @template TItem
 * @typedef {{
 *   cardId: string,
 *   hidden: boolean,
 *   focusEl?: HTMLElement | null,
 *   getItemById: (itemId: string) => TItem | null,
 *   getBlobId: (item: TItem) => string | null | undefined,
 *   getAltText: (item: TItem) => string,
 *   onPick: (item: TItem) => unknown,
 *   onToggleHidden: (item: TItem, hidden: boolean) => unknown
 * }} PatchPortraitOptions
 */

/**
 * @param {CardIncrementalDomPatcherOptions} [options]
 */
export function createCardIncrementalDomPatcher({
  cardsEl,
  blobIdToObjectUrl,
} = {}) {
  /**
   * @param {HTMLElement | null | undefined} el
   * @returns {void}
   */
  function focusWithoutScroll(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch { el.focus?.(); }
  }

  /**
   * @param {string} cardId
   * @returns {HTMLElement | null}
   */
  function findCardElById(cardId) {
    return /** @type {HTMLElement | null} */ (
      cardsEl?.querySelector(`.trackerCard[data-card-id="${cardId}"]`) || null
    );
  }

  /**
   * @param {HTMLElement | null | undefined} el
   * @returns {void}
   */
  function focusElementWithoutScroll(el) {
    if (!el) return;
    requestAnimationFrame(() => {
      focusWithoutScroll(el);
    });
  }

  function scheduleMasonryRelayout() {
    if (!cardsEl) return;
    requestAnimationFrame(() => masonry.relayout(cardsEl));
  }

  function focusCollapseButton(cardId, fallbackEl = null) {
    requestAnimationFrame(() => {
      const btn = findCardElById(cardId)?.querySelector(".cardCollapseBtn") || fallbackEl;
      focusWithoutScroll(btn);
    });
  }

  function focusMoveButton(cardId, dir) {
    requestAnimationFrame(() => {
      const card = findCardElById(cardId);
      if (!card) return;
      const buttons = /** @type {NodeListOf<HTMLButtonElement>} */ (card.querySelectorAll(".moveBtn"));
      const btn = buttons[dir < 0 ? 0 : 1] || buttons[0] || null;
      focusWithoutScroll(btn);
    });
  }

  function patchReorder(cardId, adjacentId, dir) {
    if (!cardsEl) return false;
    const cardEl = findCardElById(cardId);
    const adjacentEl = findCardElById(adjacentId);
    if (!cardEl || !adjacentEl) return false;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

    const firstRectA = cardEl.getBoundingClientRect();
    const firstRectB = adjacentEl.getBoundingClientRect();

    const prevScroll = cardsEl.scrollTop;
    if (dir < 0) cardsEl.insertBefore(cardEl, adjacentEl);
    else cardsEl.insertBefore(adjacentEl, cardEl);
    cardsEl.scrollTop = prevScroll;

    masonry.relayout(cardsEl);
    if (!prefersReducedMotion) {
      const lastRectA = cardEl.getBoundingClientRect();
      const lastRectB = adjacentEl.getBoundingClientRect();
      const baseA = cardEl.style.transform || "";
      const baseB = adjacentEl.style.transform || "";
      const deltaAX = firstRectA.left - lastRectA.left;
      const deltaAY = firstRectA.top - lastRectA.top;
      const deltaBX = firstRectB.left - lastRectB.left;
      const deltaBY = firstRectB.top - lastRectB.top;

      cardEl.style.transform = baseA
        ? `${baseA} translate(${deltaAX}px, ${deltaAY}px)`
        : `translate(${deltaAX}px, ${deltaAY}px)`;
      adjacentEl.style.transform = baseB
        ? `${baseB} translate(${deltaBX}px, ${deltaBY}px)`
        : `translate(${deltaBX}px, ${deltaBY}px)`;
      cardEl.offsetHeight; // Force reflow so FLIP transition starts from inverted position.

      cardEl.style.transition = "transform 260ms cubic-bezier(.2,.8,.2,1)";
      adjacentEl.style.transition = "transform 260ms cubic-bezier(.2,.8,.2,1)";
      cardEl.style.transform = baseA;
      adjacentEl.style.transform = baseB;

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        cardEl.style.transition = "";
        adjacentEl.style.transition = "";
        cardEl.removeEventListener("transitionend", onEndA);
        adjacentEl.removeEventListener("transitionend", onEndB);
      };
      const onEndA = (evt) => { if (evt.propertyName === "transform") cleanup(); };
      const onEndB = (evt) => { if (evt.propertyName === "transform") cleanup(); };
      cardEl.addEventListener("transitionend", onEndA);
      adjacentEl.addEventListener("transitionend", onEndB);
      setTimeout(cleanup, 260);
    }

    focusMoveButton(cardId, dir);
    return true;
  }

  function patchCollapsed(cardId, collapsed, focusEl = null) {
    const card = findCardElById(cardId);
    if (!card) return false;

    card.classList.toggle("collapsed", !!collapsed);
    const collapsible = /** @type {HTMLElement | null} */ (card.querySelector(".npcCollapsible"));
    if (collapsible) collapsible.hidden = !!collapsed;
    const footer = /** @type {HTMLElement | null} */ (card.querySelector(".npcCardFooter"));
    if (footer) footer.hidden = !!collapsed;

    const toggle = /** @type {HTMLButtonElement | null} */ (card.querySelector(".cardCollapseBtn"));
    if (toggle) {
      toggle.setAttribute("aria-label", collapsed ? "Expand card" : "Collapse card");
      toggle.setAttribute("aria-expanded", (!collapsed).toString());
      toggle.textContent = collapsed ? "\u25bc" : "\u25b2";
    }

    scheduleMasonryRelayout();
    focusCollapseButton(cardId, focusEl || toggle);
    return true;
  }

  /**
   * @template TItem
   * @param {PatchPortraitOptions<TItem>} options
   * @returns {boolean}
   */
  function patchPortrait({
    cardId,
    hidden,
    focusEl = null,
    getItemById,
    getBlobId,
    getAltText,
    onPick,
    onToggleHidden,
  }) {
    const card = findCardElById(cardId);
    if (!card) return false;

    const item = typeof getItemById === "function" ? getItemById(cardId) : null;
    if (!item) return false;

    const headerRow = /** @type {HTMLElement | null} */ (card.querySelector(".npcHeaderRow"));
    const body = /** @type {HTMLElement | null} */ (card.querySelector(".npcCardBodyStack"));
    if (!headerRow || !body) return false;

    headerRow.querySelectorAll(".cardPortraitToggleBtnHeader").forEach((btn) => btn.remove());
    card.querySelector(".npcPortraitTop")?.remove();

    const portrait = renderCardPortrait({
      blobId: typeof getBlobId === "function" ? getBlobId(item) : undefined,
      altText: typeof getAltText === "function" ? getAltText(item) : "",
      blobIdToObjectUrl,
      onPick: typeof onPick === "function" ? () => onPick(item) : undefined,
      isHidden: !!hidden,
      onToggleHidden: typeof onToggleHidden === "function"
        ? (nextHidden) => onToggleHidden(item, nextHidden)
        : undefined,
      headerControlsEl: headerRow,
      onImageLoad: scheduleMasonryRelayout,
    });
    if (portrait) card.insertBefore(portrait, body);

    const nextFocusEl = focusEl && focusEl.isConnected
      ? focusEl
      : (hidden
        ? /** @type {HTMLElement | null} */ (headerRow.querySelector(".cardPortraitToggleBtnHeader"))
        : /** @type {HTMLElement | null} */ (card.querySelector(".npcPortraitTop .cardPortraitToggleBtnOverlay")));

    scheduleMasonryRelayout();
    focusElementWithoutScroll(nextFocusEl);
    return true;
  }

  return {
    findCardElById,
    scheduleMasonryRelayout,
    focusElementWithoutScroll,
    focusCollapseButton,
    focusMoveButton,
    patchReorder,
    patchCollapsed,
    patchPortrait,
  };
}
