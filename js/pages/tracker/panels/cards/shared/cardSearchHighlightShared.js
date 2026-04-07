// Shared search highlight attachment for tracker cards.

/** @typedef {typeof import("../../../../../ui/searchHighlightOverlay.js").attachSearchHighlightOverlay} AttachSearchHighlightOverlayFn */
/**
 * @typedef {{
 *   cardEl: HTMLElement,
 *   getQuery: () => string,
 *   attachSearchHighlightOverlay: AttachSearchHighlightOverlayFn,
 *   selector?: string
 * }} AttachCardSearchHighlightsOptions
 */

/**
 * Attach in-field search highlight overlays for matching card inputs.
 *
 * @param {AttachCardSearchHighlightsOptions | undefined} options
 */
export function attachCardSearchHighlights({
  cardEl,
  getQuery,
  attachSearchHighlightOverlay,
  selector = "input:not(.npcHpInput), textarea",
} = /** @type {AttachCardSearchHighlightsOptions} */ ({
  cardEl: document.createElement("div"),
  getQuery: () => "",
  attachSearchHighlightOverlay: () => ({ update() {}, destroy() {} }),
})) {
  if (!cardEl || typeof cardEl.querySelectorAll !== "function") return;
  if (typeof getQuery !== "function") return;
  if (typeof attachSearchHighlightOverlay !== "function") return;
  cardEl.querySelectorAll(selector).forEach((el) => {
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
    attachSearchHighlightOverlay(el, getQuery);
  });
}
