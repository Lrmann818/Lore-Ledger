// Shared drag-to-reorder helper for horizontal pill/tab strips.
// Stable-midpoint, commit-on-drop, no DOM mutation during drag.

const DRAG_START_THRESHOLD_PX = 14;
const TOUCH_DRAG_HOLD_MS = 420;
const TOUCH_DRAG_ARM_SLOP_PX = 10;
const DROP_CUE_WIDTH_PX = 3;
const DROP_CUE_EDGE_OFFSET_PX = 8;

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
 * @param {HTMLElement | null} [config.wrapEl] - scroll parent; kept for existing call sites
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
  const dropCueEl = doc.createElement("div");
  dropCueEl.className = "tabReorderDropCue";
  dropCueEl.setAttribute("aria-hidden", "true");

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

  function captureStableLayout(dragState) {
    const allTabs = /** @type {HTMLElement[]} */ (Array.from(tabsEl.querySelectorAll(tabSelector)));
    dragState.stableOrder = allTabs.map((el) => getTabId(el)).filter(Boolean);
    const midpoints = new Map();
    const rects = new Map();
    allTabs.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const id = getTabId(el);
      if (!id) return;
      midpoints.set(id, rect.left + rect.width / 2);
      rects.set(id, {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        height: rect.height,
      });
    });
    dragState.stableMidpoints = midpoints;
    dragState.stableRects = rects;
    dragState.tabsRect = tabsEl.getBoundingClientRect();
    dragState.provisionalIndex = dragState.stableOrder.indexOf(dragState.tabId);
  }

  function getCueLeft(dragState) {
    const stableOrder = dragState.stableOrder || [];
    const stableRects = dragState.stableRects;
    if (!stableOrder.length || !stableRects) return null;

    const remaining = stableOrder.filter((id) => id !== dragState.tabId);
    if (!remaining.length) return null;

    if (dragState.provisionalIndex <= 0) {
      const nextRect = stableRects.get(remaining[0]);
      return nextRect ? nextRect.left - DROP_CUE_EDGE_OFFSET_PX : null;
    }

    if (dragState.provisionalIndex >= remaining.length) {
      const prevRect = stableRects.get(remaining[remaining.length - 1]);
      return prevRect ? prevRect.right + DROP_CUE_EDGE_OFFSET_PX : null;
    }

    const prevRect = stableRects.get(remaining[dragState.provisionalIndex - 1]);
    const nextRect = stableRects.get(remaining[dragState.provisionalIndex]);
    if (!prevRect || !nextRect) return null;
    return (prevRect.right + nextRect.left) / 2;
  }

  function updateDropCue(dragState) {
    const cueLeft = getCueLeft(dragState);
    const tabsRect = dragState.tabsRect;
    const draggedRect = dragState.stableRects?.get(dragState.tabId);
    if (cueLeft == null || !tabsRect || !draggedRect) {
      dropCueEl.remove();
      return;
    }

    if (!dropCueEl.isConnected) tabsEl.appendChild(dropCueEl);
    dropCueEl.style.left = `${cueLeft - tabsRect.left}px`;
    dropCueEl.style.top = `${draggedRect.top - tabsRect.top}px`;
    dropCueEl.style.height = `${draggedRect.height}px`;
  }

  function lockWrapScroll(dragState) {
    if (!wrapEl) return;
    dragState.lockedScrollLeft = wrapEl.scrollLeft;

    const handleScroll = () => {
      if (!activeDrag || activeDrag !== dragState || !dragState.started) return;
      if (wrapEl.scrollLeft !== dragState.lockedScrollLeft) {
        wrapEl.scrollLeft = dragState.lockedScrollLeft;
      }
    };
    const handleWheel = (event) => {
      if (!activeDrag || activeDrag !== dragState || !dragState.started) return;
      event.preventDefault();
    };

    wrapEl.addEventListener("scroll", handleScroll, { passive: true });
    wrapEl.addEventListener("wheel", handleWheel, { passive: false });
    wrapEl.classList.add("isReorderScrollLocked");
    dragState.releaseWrapLock = () => {
      wrapEl.removeEventListener("scroll", handleScroll);
      wrapEl.removeEventListener("wheel", handleWheel);
      wrapEl.classList.remove("isReorderScrollLocked");
    };
  }

  function markDragStarted(dragState) {
    dragState.started = true;
    captureStableLayout(dragState);
    dragState.prevTabsInlinePosition = tabsEl.style.position;
    tabsEl.style.position = "relative";
    dragState.buttonEl.classList.add(draggingClass);
    tabsEl.classList.add(containerDraggingClass);
    if (bodyDraggingClass) doc.body?.classList.add(bodyDraggingClass);
    lockWrapScroll(dragState);
    updateDropCue(dragState);
  }

  function finishDrag({ commit }) {
    const drag = activeDrag;
    if (!drag) return;

    if (drag.armTimer) clearTimeout(drag.armTimer);
    drag.cleanup?.();
    drag.releaseWrapLock?.();
    dropCueEl.remove();
    drag.buttonEl.classList.remove(draggingClass);
    drag.buttonEl.style.transform = "";
    tabsEl.classList.remove(containerDraggingClass);
    tabsEl.style.position = drag.prevTabsInlinePosition || "";
    if (bodyDraggingClass) doc.body?.classList.remove(bodyDraggingClass);
    activeDrag = null;

    if (!drag.started) {
      if (drag.armed) suppressNextClick = true;
      return;
    }

    suppressNextClick = true;
    if (!commit || !drag.stableOrder) return;

    const finalOrder = computeFinalOrder(drag.stableOrder, drag.tabId, drag.provisionalIndex);
    onCommit(finalOrder);
  }

  function beginPointerDrag(event, buttonEl, tabId) {
    if (!buttonEl || !tabId) return;
    if (Array.from(tabsEl.querySelectorAll(tabSelector)).length <= 1) return;
    if ((event.pointerType || "") === "touch") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (activeDrag) finishDrag({ commit: false });

    const dragState = {
      inputType: "pointer",
      pointerId: event.pointerId,
      buttonEl,
      tabId,
      startX: event.clientX,
      startY: event.clientY,
      armTimer: null,
      armed: false,
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

      if (!dragState.started) {
        if (absY > DRAG_START_THRESHOLD_PX && absY > absX) { finishDrag({ commit: false }); return; }
        if (absX < DRAG_START_THRESHOLD_PX || absX <= absY) return;

        markDragStarted(dragState);
        try { dragState.buttonEl.setPointerCapture?.(dragState.pointerId); } catch { /* noop */ }
      }

      moveEvent.preventDefault();
      buttonEl.style.transform = `translateX(${deltaX}px)`;
      dragState.provisionalIndex = calcProvisionalIndex(dragState, deltaX);
      updateDropCue(dragState);
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

    const handleKeyDown = (keyEvent) => {
      if (!activeDrag || activeDrag !== dragState) return;
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      finishDrag({ commit: false });
    };

    doc.addEventListener("pointermove", handleMove);
    doc.addEventListener("pointerup", handleUp);
    doc.addEventListener("pointercancel", handleCancel);
    doc.addEventListener("keydown", handleKeyDown);
    dragState.cleanup = () => {
      doc.removeEventListener("pointermove", handleMove);
      doc.removeEventListener("pointerup", handleUp);
      doc.removeEventListener("pointercancel", handleCancel);
      doc.removeEventListener("keydown", handleKeyDown);
    };

    activeDrag = dragState;
  }

  function getTouchById(touchList, touchId) {
    if (!touchList) return null;
    for (let i = 0; i < touchList.length; i += 1) {
      if (touchList[i]?.identifier === touchId) return touchList[i];
    }
    return null;
  }

  function beginTouchDrag(event, buttonEl, tabId) {
    if (!buttonEl || !tabId) return;
    if (Array.from(tabsEl.querySelectorAll(tabSelector)).length <= 1) return;
    if ((event.touches?.length || 0) !== 1) return;
    if (activeDrag) finishDrag({ commit: false });

    const doc = buttonEl.ownerDocument || document;
    const startTouch = event.changedTouches?.[0];
    if (!startTouch) return;

    const dragState = {
      inputType: "touch",
      touchId: startTouch.identifier,
      buttonEl,
      tabId,
      startX: startTouch.clientX,
      startY: startTouch.clientY,
      currentX: startTouch.clientX,
      currentY: startTouch.clientY,
      dragOriginX: startTouch.clientX,
      dragOriginY: startTouch.clientY,
      armTimer: null,
      armed: false,
      started: false,
      cleanup: null,
      stableOrder: null,
      stableMidpoints: null,
      provisionalIndex: 0,
    };

    const handleMove = (moveEvent) => {
      if (!activeDrag || activeDrag !== dragState) return;
      if ((moveEvent.touches?.length || 0) > 1) {
        finishDrag({ commit: false });
        return;
      }

      const touch = getTouchById(moveEvent.changedTouches, dragState.touchId)
        || getTouchById(moveEvent.touches, dragState.touchId);
      if (!touch) return;

      dragState.currentX = touch.clientX;
      dragState.currentY = touch.clientY;

      if (!dragState.armed) {
        const armDeltaX = dragState.currentX - dragState.startX;
        const armDeltaY = dragState.currentY - dragState.startY;
        if (Math.abs(armDeltaX) > TOUCH_DRAG_ARM_SLOP_PX || Math.abs(armDeltaY) > TOUCH_DRAG_ARM_SLOP_PX) {
          finishDrag({ commit: false });
        }
        return;
      }

      const deltaX = dragState.currentX - dragState.dragOriginX;
      const deltaY = dragState.currentY - dragState.dragOriginY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (!dragState.started) {
        if (absY > DRAG_START_THRESHOLD_PX && absY > absX) {
          finishDrag({ commit: false });
          return;
        }
        if (absX < DRAG_START_THRESHOLD_PX || absX <= absY) return;
        markDragStarted(dragState);
      }

      moveEvent.preventDefault();
      buttonEl.style.transform = `translateX(${deltaX}px)`;
      dragState.provisionalIndex = calcProvisionalIndex(dragState, deltaX);
      updateDropCue(dragState);
    };

    const handleEnd = (endEvent) => {
      if (!activeDrag || activeDrag !== dragState) return;
      if (!getTouchById(endEvent.changedTouches, dragState.touchId)) return;
      finishDrag({ commit: true });
    };

    const handleCancel = (cancelEvent) => {
      if (!activeDrag || activeDrag !== dragState) return;
      if (!getTouchById(cancelEvent.changedTouches, dragState.touchId)) return;
      finishDrag({ commit: false });
    };

    const handleKeyDown = (keyEvent) => {
      if (!activeDrag || activeDrag !== dragState) return;
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      finishDrag({ commit: false });
    };

    doc.addEventListener("touchmove", handleMove, { passive: false });
    doc.addEventListener("touchend", handleEnd);
    doc.addEventListener("touchcancel", handleCancel);
    doc.addEventListener("keydown", handleKeyDown);
    dragState.cleanup = () => {
      doc.removeEventListener("touchmove", handleMove);
      doc.removeEventListener("touchend", handleEnd);
      doc.removeEventListener("touchcancel", handleCancel);
      doc.removeEventListener("keydown", handleKeyDown);
    };
    dragState.armTimer = setTimeout(() => {
      if (!activeDrag || activeDrag !== dragState || dragState.started) return;
      dragState.armed = true;
      dragState.dragOriginX = dragState.currentX;
      dragState.dragOriginY = dragState.currentY;
    }, TOUCH_DRAG_HOLD_MS);

    activeDrag = dragState;
  }

  const handlePointerDown = (event) => {
    const btn = event.target?.closest?.(tabSelector);
    if (!btn || !tabsEl.contains(btn)) return;
    const tabId = getTabId(btn);
    if (!tabId) return;
    beginPointerDrag(event, btn, tabId);
  };

  const handleTouchStart = (event) => {
    const btn = event.target?.closest?.(tabSelector);
    if (!btn || !tabsEl.contains(btn)) return;
    const tabId = getTabId(btn);
    if (!tabId) return;
    beginTouchDrag(event, btn, tabId);
  };

  tabsEl.addEventListener("pointerdown", handlePointerDown);
  tabsEl.addEventListener("touchstart", handleTouchStart, { passive: true });

  return {
    destroy() {
      doc.removeEventListener("click", clickSuppressor, true);
      tabsEl.removeEventListener("pointerdown", handlePointerDown);
      tabsEl.removeEventListener("touchstart", handleTouchStart);
      if (activeDrag) {
        activeDrag.cleanup?.();
        activeDrag = null;
      }
    },
  };
}
