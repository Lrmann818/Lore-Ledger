// @ts-nocheck
// js/ui/pagePanelReorder.js
//
// Generic two-column panel reordering with persisted order, mobile single-column,
// and injected ↑/↓ move buttons.
//
// This is intentionally “headless”: page modules provide selectors + header wiring.

import { DEV_MODE } from "../utils/dev.js";
import { requireEl, requireMany, getNoopDestroyApi } from "../utils/domGuards.js";
import { flipSwapTwo } from "./flipSwap.js";

/** @type {Map<string, () => void>} */
const activePagePanelReorderDestroyByPage = new Map();

export function setupPagePanelReorder({
  state,
  SaveManager,

  // DOM wiring
  pageId,
  columnsWrapSelectors, // array of selectors to try, in order
  col0Selector,
  col1Selector,
  panelSelector,

  // State wiring
  getUiState,           // (state) => object (must be stable, creates .ui if needed)
  orderKey = "sectionOrder",

  // Header wiring
  // If provided: (panelId, pageEl, panelEl) => headerEl to append buttons into.
  getHeaderEl = null,

  // Optional: if header not found, a factory to create/normalize one
  // (panelEl) => headerEl | null
  ensureHeaderRow = null,

  // Behavior
  breakpointQuery = "(max-width: 600px)",
  storeApplyFnKey = null, // e.g. "_applySectionOrder" if you want to expose applyOrder
  setStatus = null,
}) {
  const destroyKey = pageId ? String(pageId) : "";
  if (destroyKey) {
    const prevDestroy = activePagePanelReorderDestroyByPage.get(destroyKey);
    if (typeof prevDestroy === "function") prevDestroy();
  }

  const prefix = `setupPagePanelReorder(${pageId || "unknown"})`;
  const pageGuard = requireMany(
    { pageEl: `#${pageId}` },
    { root: document, setStatus, context: `Panel reorder (${pageId || "unknown"})` }
  );
  if (!pageGuard.ok) return pageGuard.destroy;
  const { pageEl } = pageGuard.els;

  let columnsWrap = null;
  for (const sel of (columnsWrapSelectors || [])) {
    columnsWrap = requireEl(sel, pageEl, { prefix, warn: false });
    if (columnsWrap) break;
  }
  if (!columnsWrap) {
    const message = `Panel reorder unavailable (missing columns wrapper; tried selectors: ${(columnsWrapSelectors || []).join(", ")}).`;
    if (DEV_MODE) throw new Error(message);
    if (typeof setStatus === "function") setStatus(message, { stickyMs: 5000 });
    else console.warn(message);
    return getNoopDestroyApi();
  }

  const columnsGuard = requireMany(
    { col0: col0Selector, col1: col1Selector },
    { root: columnsWrap, setStatus, context: `Panel reorder (${pageId || "unknown"})` }
  );
  if (!columnsGuard.ok) return columnsGuard.destroy;
  const { col0, col1 } = columnsGuard.els;

  const ui = getUiState?.(state);
  if (!ui) return getNoopDestroyApi();

  const ac = new AbortController();
  const { signal } = ac;
  let destroyed = false;
  /** @type {HTMLElement[]} */
  const createdMoveWraps = [];

  // Collect panels (wherever they currently live inside wrapper)
  const panels = Array.from(columnsWrap.querySelectorAll(panelSelector));
  const defaultOrder = panels.map(p => p.id).filter(Boolean);

  // Normalize stored order
  if (!Array.isArray(ui[orderKey]) || ui[orderKey].length === 0) {
    ui[orderKey] = defaultOrder.slice();
  } else {
    const set = new Set(defaultOrder);
    const cleaned = ui[orderKey].filter(id => set.has(id));
    for (const id of defaultOrder) if (!cleaned.includes(id)) cleaned.push(id);
    ui[orderKey] = cleaned;
  }

  function clearColumn(col) {
    while (col.firstChild) col.removeChild(col.firstChild);
  }

  function isSingleColumn() {
    return !!(window.matchMedia && window.matchMedia(breakpointQuery).matches);
  }

  function applyOrder() {
    const order = ui[orderKey] || defaultOrder;
    const map = new Map(panels.map(p => [p.id, p]));

    clearColumn(col0);
    clearColumn(col1);

    const single = isSingleColumn();

    order.forEach((id, idx) => {
      const el = map.get(id);
      if (!el) return;
      if (single) col0.appendChild(el);
      else (idx % 2 === 0 ? col0 : col1).appendChild(el);
    });
  }

  function moveSection(id, dir) {
    const order = ui[orderKey];
    const i = order.indexOf(id);
    if (i === -1) return;
    const j = i + dir;
    if (j < 0 || j >= order.length) return;

    const adjacentId = order[j];
    const panelEl = document.getElementById(id);
    const adjacentEl = document.getElementById(adjacentId);

    [order[i], order[j]] = [order[j], order[i]];

    SaveManager?.markDirty?.();
    if (!panelEl || !adjacentEl || !columnsWrap.contains(panelEl) || !columnsWrap.contains(adjacentEl)) {
      applyOrder();
      return;
    }

    const swapInDom = () => {
      const parentA = panelEl.parentNode;
      const parentB = adjacentEl.parentNode;
      if (!parentA || !parentB) return;
      const markerA = document.createComment("swap-panel-a");
      const markerB = document.createComment("swap-panel-b");
      parentA.replaceChild(markerA, panelEl);
      parentB.replaceChild(markerB, adjacentEl);
      parentA.replaceChild(adjacentEl, markerA);
      parentB.replaceChild(panelEl, markerB);
    };

    const didSwap = flipSwapTwo(panelEl, adjacentEl, {
      durationMs: 260,
      easing: "cubic-bezier(.22,1,.36,1)",
      swap: swapInDom,
    });

    if (!didSwap) applyOrder();
  }

  function makeMoveBtn(label, title, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "moveBtn";
    b.textContent = label;
    b.title = title;
    b.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e.currentTarget);
      },
      { signal }
    );
    return b;
  }

  function attachMoves(panelId) {
    if (!panelId) return;

    const panelEl = document.getElementById(panelId);
    if (!panelEl) return;

    let headerEl = null;

    if (getHeaderEl) headerEl = getHeaderEl(panelId, pageEl, panelEl);
    if (!headerEl && ensureHeaderRow) headerEl = ensureHeaderRow(panelEl);

    if (!headerEl) return;

    // Avoid duplicates if setup runs twice
    if (headerEl.querySelector(`[data-section-moves="${panelId}"]`)) return;

    const wrap = document.createElement("div");
    wrap.className = "sectionMoves";
    wrap.dataset.sectionMoves = panelId;

    wrap.appendChild(makeMoveBtn("↑", "Move section up", (btn) => {
      moveSection(panelId, -1);
      requestAnimationFrame(() => {
        try { btn?.focus({ preventScroll: true }); } catch { btn?.focus?.(); }
      });
    }));
    wrap.appendChild(makeMoveBtn("↓", "Move section down", (btn) => {
      moveSection(panelId, +1);
      requestAnimationFrame(() => {
        try { btn?.focus({ preventScroll: true }); } catch { btn?.focus?.(); }
      });
    }));

    headerEl.appendChild(wrap);
    createdMoveWraps.push(wrap);
  }

  // Initial apply
  applyOrder();

  // Inject buttons for panels in the current order (stable + predictable)
  (ui[orderKey] || defaultOrder).forEach(attachMoves);

  // Re-apply on resize breakpoint changes
  let t = null;
  window.addEventListener(
    "resize",
    () => {
      clearTimeout(t);
      t = setTimeout(applyOrder, 120);
    },
    { signal }
  );

  if (storeApplyFnKey) ui[storeApplyFnKey] = applyOrder;

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(t);
    t = null;
    ac.abort();
    createdMoveWraps.forEach((wrap) => {
      wrap?.remove?.();
    });
    createdMoveWraps.length = 0;
    if (storeApplyFnKey && ui[storeApplyFnKey] === applyOrder) {
      delete ui[storeApplyFnKey];
    }
    if (destroyKey && activePagePanelReorderDestroyByPage.get(destroyKey) === destroy) {
      activePagePanelReorderDestroyByPage.delete(destroyKey);
    }
  };

  if (destroyKey) activePagePanelReorderDestroyByPage.set(destroyKey, destroy);

  return { applyOrder, destroy };
}
