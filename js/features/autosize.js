// @ts-check
// Autosize helpers for number inputs and persisted textarea sizing.
import { createStateActions } from "../domain/stateActions.js";

/** @typedef {import("../state.js").State} State */
/**
 * @typedef {{
 *   min?: number,
 *   max?: number,
 *   extra?: number
 * }} AutosizeInputOptions
 */
/**
 * @typedef {{
 *   state?: State,
 *   markDirty?: () => void,
 *   saveAll?: () => unknown,
 *   setStatus?: (message: string, opts?: { stickyMs?: number }) => void,
 *   maxHeight?: number
 * }} TextareaSizingDeps
 */
/**
 * @typedef {{
 *   applyTextareaSize: (el: HTMLTextAreaElement | null | undefined) => void
 * }} TextareaSizingApi
 */

// NOTE: many inputs are created *before* being inserted into the DOM.
// getComputedStyle() returns incomplete values for disconnected elements, so we defer measuring
// until the input is connected + styles/fonts are applied.

const __autosizeInputMeasurer = (() => {
  const span = document.createElement("span");
  span.style.position = "absolute";
  span.style.visibility = "hidden";
  span.style.whiteSpace = "pre";
  span.style.height = "0";
  span.style.overflow = "hidden";
  span.style.left = "-99999px";
  return span;
})();

/**
 * @param {HTMLInputElement | null | undefined} el
 * @param {AutosizeInputOptions} [options]
 * @returns {void}
 */
export function autoSizeInput(el, { min = 0, max = 300, extra = 0 } = {}) {
  if (!el) return;

  // Ensure the measurer is in the DOM (only once)
  if (!__autosizeInputMeasurer.isConnected) document.body.appendChild(__autosizeInputMeasurer);

  /** @returns {void} */
  const measure = () => {
    if (!el.isConnected) return; // wait until inserted into DOM
    const cs = getComputedStyle(el);

    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const borderL = parseFloat(cs.borderLeftWidth) || 0;
    const borderR = parseFloat(cs.borderRightWidth) || 0;

    __autosizeInputMeasurer.style.font = cs.font;
    __autosizeInputMeasurer.style.letterSpacing = cs.letterSpacing;
    __autosizeInputMeasurer.textContent = el.value || el.placeholder || "";

    const textW = __autosizeInputMeasurer.getBoundingClientRect().width;
    const raw = textW + padL + padR + borderL + borderR + extra;
    const next = Math.min(max, Math.max(min, Math.ceil(raw)));

    // Clamp target:
    // - Most inputs: clamp to immediate parent (the grid/flex cell)
    // - Number inputs: they get wrapped in .numWrap by steppers, which is content-sized;
    //   so clamp to .numWrap's parent (the real cell)
    let clampHost = el.parentElement;

    if (clampHost?.classList?.contains("numWrap")) {
      clampHost = clampHost.parentElement || clampHost;
    }

    const maxHost = (clampHost?.clientWidth || 0) - 4;

    if (maxHost > 0) {
      el.style.width = Math.min(next, maxHost) + "px";
    } else {
      el.style.width = next + "px";
    }

  };

  // Small scheduler so we measure after layout/styles apply.
  // (requestAnimationFrame also handles the "created then appended" case cleanly.)
  /** @returns {number} */
  const schedule = () => requestAnimationFrame(measure);

  el.addEventListener("input", schedule);
  el.addEventListener("blur", schedule);

  // Re-measure when the layout around the input changes (card/grid resize)
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => schedule());

    /** @type {HTMLElement | HTMLInputElement | null} */
    let observed = null;

    /** @returns {void} */
    const ensureObserved = () => {
      if (!el.isConnected) return;

      // Prefer the immediate parent cell (grid/flex item)
      let target = el.parentElement || el;

      if (target?.classList?.contains("numWrap")) {
        target = target.parentElement || target;
      }


      if (target === observed) return;

      try {
        if (observed) ro.unobserve(observed);
      } catch (_) { }

      observed = target;
      ro.observe(target);
    };

    // Try now (may be disconnected), and again after layout
    ensureObserved();
    requestAnimationFrame(ensureObserved);
  }


  // Initial sizing: run a few times to catch late font/style application.
  schedule();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(schedule).catch(() => { });
  }
  window.addEventListener("load", schedule, { once: true });
}

/**
 * @param {Document | Element} [root]
 * @returns {void}
 */
export function autosizeAllNumbers(root = document) {
  root.querySelectorAll('input[type="number"]').forEach((el) => {
    if (!(el instanceof HTMLInputElement)) return;
    el.classList.add("autosize");
    autoSizeInput(el, { min: 30, max: 80 });
  });
}

/**
 * @param {HTMLTextAreaElement | null | undefined} el
 * @returns {void}
 */
export function applyAutosize(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

/**
 * Textarea sizing: autosize + persisted height
 *
 * Pass dependencies so this module stays pure-ish and doesn't rely on globals.
 */
/**
 * @param {TextareaSizingDeps} [deps]
 * @returns {TextareaSizingApi}
 */
export function setupTextareaSizing({
  state,
  markDirty,
  saveAll,
  setStatus,
  maxHeight = 900
} = {}) {
  if (!state) throw new Error("setupTextareaSizing requires { state }");
  const hasMarkDirty = (typeof markDirty === "function");
  const hasLegacySave = (typeof saveAll === "function" && typeof setStatus === "function");
  if (!hasMarkDirty && !hasLegacySave) {
    throw new Error("setupTextareaSizing requires { markDirty } or legacy { saveAll, setStatus }");
  }

  const actions = createStateActions({
    state,
    SaveManager: hasMarkDirty ? { markDirty } : undefined
  });

  // One place to store all textarea heights (root UI so it survives imports cleanly)
  if (!state.ui?.textareaHeights || typeof state.ui.textareaHeights !== "object") {
    actions.setPath(["ui", "textareaHeights"], {}, { queueSave: false });
  }
  const store = state.ui.textareaHeights;

  // Back-compat: if older saves stored it under tracker.ui, pull it forward once
  if (state.tracker?.ui?.textareaHeights && Object.keys(store).length === 0) {
    actions.mutateState((s) => {
      Object.assign(s.ui.textareaHeights, s.tracker.ui.textareaHeights);
    }, { queueSave: false });
  }

  /** @type {WeakSet<HTMLTextAreaElement>} */
  const seen = new WeakSet();

  // Debounced save (so we don't spam saveAll)
  /** @type {ReturnType<typeof setTimeout> | null} */
  let saveTimer = null;
  /** @returns {void} */
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (typeof markDirty === "function") {
        markDirty();
      } else {
        // Legacy fallback for callers that still pass saveAll/setStatus.
        setStatus("Saving...");
        saveAll();
      }
    }, 150);
  }

  /**
   * @param {Element | null | undefined} el
   * @returns {void}
   */
  function applySize(el) {
    if (!(el instanceof HTMLTextAreaElement)) return;
    if (!el.hasAttribute("data-persist-size")) return;
    if (!el.id) return;

    const saved = store[el.id];
    const savedPx = Number.isFinite(saved) ? saved : 0;

    // If we have a saved manual height, respect it exactly
    if (savedPx > 0) {
      el.style.height = savedPx + "px";
      return;
    }

    // Otherwise autosize to content
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  /** @type {(el: HTMLTextAreaElement | null | undefined) => void} */
  const applyTextareaSize = (el) => {
    try { applySize(el); } catch (_) { }
  };

  /**
   * @param {HTMLTextAreaElement} el
   * @returns {void}
   */
  function bind(el) {
    if (seen.has(el)) return;
    seen.add(el);

    // Restore/apply immediately
    applySize(el);

    // Helper: ignore layout changes that happen because a whole page/tab was hidden.
    // When we switch between top-level pages, some CSS/layout changes can briefly
    // resize textareas and would otherwise trigger a save even though the user
    // didn't edit anything.
    /** @returns {boolean} */
    function isInHiddenUI() {
      // If the element (or any ancestor) is explicitly hidden, treat it as not user-driven.
      if (el.closest?.('[hidden]')) return true;
      // If detached or not in layout, bail.
      if (!document.body.contains(el)) return true;
      if (el.offsetParent === null) return true;
      return false;
    }

    // Autosize as user types (and save)
    el.addEventListener("input", () => {
      applySize(el);

      if (isInHiddenUI()) return;

      const h = Math.min(Math.round(el.getBoundingClientRect().height), maxHeight);
      if (h <= 0) return;

      actions.setPath(["ui", "textareaHeights", el.id], h, { queueSave: false });
      scheduleSave();
    });

    // Persist manual resizes (drag handle)
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (isInHiddenUI()) return;

        const h = Math.min(Math.round(el.getBoundingClientRect().height), maxHeight);
        if (h <= 0) return;

        actions.setPath(["ui", "textareaHeights", el.id], h, { queueSave: false });
        scheduleSave();
      });
      ro.observe(el);
    }
  }

  /**
   * @param {Document | Element} [root]
   * @returns {void}
   */
  function scan(root = document) {
    root.querySelectorAll("textarea[data-persist-size]").forEach((el) => {
      if (el instanceof HTMLTextAreaElement) bind(el);
    });
  }

  // Initial pass
  scan(document);

  // Fonts can load after DOMContentLoaded and change line-height, which affects scrollHeight.
  // Re-scan once fonts are ready so heights are correct on refresh.
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => scan(document)).catch(() => { });
  }

  // Catch textareas created later (spells/npcs/party/locations renders, etc.)
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of Array.from(m.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.matches("textarea[data-persist-size]") && node instanceof HTMLTextAreaElement) bind(node);
        scan(node);
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  return { applyTextareaSize };
}
