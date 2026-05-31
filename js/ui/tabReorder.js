// Shared drag-to-reorder helper for horizontal pill/tab strips.
// Stable-midpoint, commit-on-drop, no DOM mutation during drag.

const DRAG_START_THRESHOLD_PX = 14;
const SCROLL_CANCEL_THRESHOLD_PX = 6;
const TOUCH_DRAG_HOLD_MS = 180;
const TOUCH_DRAG_ARM_SLOP_PX = 8;

/**
 * Apply a partial (visible-only) tab reorder back into a full items array.
 *
 * @template T
 * @param {T[]} allItems - full source array
 * @param {string[]} visibleOrder - new stable-ID order for the visible slice
 * @param {(item: T) => string} getId
 * @returns {{ items: T[], changed: boolean }}
 */
export function applyTabReorder(allItems, visibleOrder, getId) {
  if (allItems.length <= 1 || visibleOrder.length <= 1) {
    return { items: allItems, changed: false };
  }

  const visibleSet = new Set(visibleOrder);
  const itemById = new Map(allItems.map((item) => [getId(item), item]));
  const reorderedVisible = visibleOrder.map((id) => itemById.get(id)).filter(Boolean);

  let visibleCursor = 0;
  const nextItems = allItems.map((item) => {
    if (!visibleSet.has(getId(item))) return item;
    return reorderedVisible[visibleCursor++] || item;
  });

  const changed = nextItems.some((item, i) => getId(item) !== getId(allItems[i]));
  return { items: nextItems, changed };
}

/**
 * Wire pointer-based drag-to-reorder on a horizontal tab strip.
 *
 * Uses event delegation on tabsEl so re-renders that rebuild the tab DOM
 * don't break pointer handling.
 *
 * @param {Object} config
 * @param {HTMLElement} config.tabsEl - flex container holding the tab buttons
 * @param {HTMLElement | null} [config.wrapEl] - scroll parent; used for scroll-cancel detection
 * @param {string} config.tabSelector - CSS selector for draggable buttons (e.g. ".npcTab")
 * @param {(el: HTMLElement) => string} config.getTabId - read stable ID from a tab element
 * @param {(visibleIds: string[]) => void} config.onCommit - called with new visible order after a real drag
 * @param {string} [config.draggingClass="isDragging"]
 * @param {string} [config.containerDraggingClass="isDraggingSessions"]
 * @param {string | null} [config.bodyDraggingClass="isDraggingSessionTabs"]
 * @returns {{ destroy: () => void }}
 */
export function createTabReorder({
  tabsEl,
  wrapEl = null,
  tabSelector,
  getTabId,
  onCommit,
  draggingClass = "isDragging",
  containerDraggingClass = "isDraggingSessions",
  bodyDraggingClass = "isDraggingSessionTabs",
}) {
  if (!tabsEl || typeof onCommit !== "function") return { destroy() {} };

  const doc = tabsEl.ownerDocument || document;
  let activeDrag = null;
  let suppressNextClick = false;

  const clickSuppressor = (event) => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
  };
  doc.addEventListener("click", clickSuppressor, true);

  function calcProvisionalIndex(dragState, deltaX) {
    const { stableOrder, stableMidpoints, tabId } = dragState;
    if (!stableOrder || !stableMidpoints) return 0;
    const originalMidX = stableMidpoints.get(tabId) || 0;
    const currentMidX = originalMidX + deltaX;
    let count = 0;
    for (const id of stableOrder) {
      if (id === tabId) continue;
      if (currentMidX > (stableMidpoints.get(id) || 0)) count++;
    }
    return count;
  }

  function computeFinalOrder(stableOrder, tabId, provisionalIndex) {
    const without = stableOrder.filter((id) => id !== tabId);
    without.splice(provisionalIndex, 0, tabId);
    return without;
  }

  function applyTouchScroll(dragState, deltaX) {
    if (!wrapEl) return;
    wrapEl.scrollLeft = Math.max(0, dragState.startScrollLeft - deltaX);
  }

  function finishDrag({ commit }) {
    const drag = activeDrag;
    if (!drag) return;

    drag.cleanup?.();
    drag.buttonEl.classList.remove(draggingClass);
    drag.buttonEl.style.transform = "";
    tabsEl.classList.remove(containerDraggingClass);
    if (bodyDraggingClass) doc.body?.classList.remove(bodyDraggingClass);
    activeDrag = null;

    if (!drag.started) {
      if (drag.touchScrolling) suppressNextClick = true;
      return;
    }

    suppressNextClick = true;
    if (!commit || !drag.stableOrder) return;

    const finalOrder = computeFinalOrder(drag.stableOrder, drag.tabId, drag.provisionalIndex);
    onCommit(finalOrder);
  }

  function beginDrag(event, buttonEl, tabId) {
    if (!buttonEl || !tabId) return;
    if (Array.from(tabsEl.querySelectorAll(tabSelector)).length <= 1) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (activeDrag) finishDrag({ commit: false });

    const dragState = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "",
      buttonEl,
      tabId,
      startX: event.clientX,
      startY: event.clientY,
      startTimeStamp: event.timeStamp,
      startScrollLeft: wrapEl?.scrollLeft || 0,
      touchScrolling: false,
      started: false,
      cleanup: null,
      stableOrder: null,
      stableMidpoints: null,
      provisionalIndex: 0,
    };

    const handleMove = (moveEvent) => {
      if (!activeDrag || moveEvent.pointerId !== dragState.pointerId) return;

      const deltaX = moveEvent.clientX - dragState.startX;
      const deltaY = moveEvent.clientY - dragState.startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      const scrolledBy = Math.abs((wrapEl?.scrollLeft || 0) - dragState.startScrollLeft);
      const isTouchPointer = dragState.pointerType === "touch";
      const pointerAgeMs = moveEvent.timeStamp - dragState.startTimeStamp;

      if (!dragState.started) {
        if (absY > DRAG_START_THRESHOLD_PX && absY > absX) { finishDrag({ commit: false }); return; }
        if (isTouchPointer && pointerAgeMs < TOUCH_DRAG_HOLD_MS) {
          if (absX > TOUCH_DRAG_ARM_SLOP_PX && absX > absY) {
            dragState.touchScrolling = true;
          }
          if (dragState.touchScrolling) applyTouchScroll(dragState, deltaX);
          return;
        }
        if (dragState.touchScrolling) {
          applyTouchScroll(dragState, deltaX);
          return;
        }
        if (scrolledBy > SCROLL_CANCEL_THRESHOLD_PX) { finishDrag({ commit: false }); return; }
        if (absX < DRAG_START_THRESHOLD_PX || absX <= absY) return;

        dragState.started = true;
        try { dragState.buttonEl.setPointerCapture?.(dragState.pointerId); } catch { /* noop */ }

        const allTabs = /** @type {HTMLElement[]} */ (Array.from(tabsEl.querySelectorAll(tabSelector)));
        dragState.stableOrder = allTabs.map((el) => getTabId(el)).filter(Boolean);
        const midpoints = new Map();
        allTabs.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const id = getTabId(el);
          if (id) midpoints.set(id, rect.left + rect.width / 2);
        });
        dragState.stableMidpoints = midpoints;
        dragState.provisionalIndex = dragState.stableOrder.indexOf(tabId);

        buttonEl.classList.add(draggingClass);
        tabsEl.classList.add(containerDraggingClass);
        if (bodyDraggingClass) doc.body?.classList.add(bodyDraggingClass);
      }

      moveEvent.preventDefault();
      buttonEl.style.transform = `translateX(${deltaX}px)`;
      dragState.provisionalIndex = calcProvisionalIndex(dragState, deltaX);
    };

    const handleUp = (upEvent) => {
      if (!activeDrag || upEvent.pointerId !== dragState.pointerId) return;
      try { dragState.buttonEl.releasePointerCapture?.(dragState.pointerId); } catch { /* noop */ }
      finishDrag({ commit: true });
    };

    const handleCancel = (cancelEvent) => {
      if (!activeDrag || cancelEvent.pointerId !== dragState.pointerId) return;
      finishDrag({ commit: false });
    };

    doc.addEventListener("pointermove", handleMove);
    doc.addEventListener("pointerup", handleUp);
    doc.addEventListener("pointercancel", handleCancel);
    dragState.cleanup = () => {
      doc.removeEventListener("pointermove", handleMove);
      doc.removeEventListener("pointerup", handleUp);
      doc.removeEventListener("pointercancel", handleCancel);
    };

    activeDrag = dragState;
  }

  const handlePointerDown = (event) => {
    const btn = event.target?.closest?.(tabSelector);
    if (!btn || !tabsEl.contains(btn)) return;
    const tabId = getTabId(btn);
    if (!tabId) return;
    beginDrag(event, btn, tabId);
  };

  tabsEl.addEventListener("pointerdown", handlePointerDown);

  return {
    destroy() {
      doc.removeEventListener("click", clickSuppressor, true);
      tabsEl.removeEventListener("pointerdown", handlePointerDown);
      if (activeDrag) {
        activeDrag.cleanup?.();
        activeDrag = null;
      }
    },
  };
}
