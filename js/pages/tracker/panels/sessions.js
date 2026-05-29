// Sessions panel wiring.
// Renders the tab strip + notes box and wires toolbar actions.

import { attachSearchHighlightOverlay } from "../../../ui/searchHighlightOverlay.js";
import { safeAsync } from "../../../ui/safeAsync.js";
import { requireMany, getNoopDestroyApi } from "../../../utils/domGuards.js";

let _tabsEl = null;
let _notesBox = null;
let _searchEl = null;
let _addBtn = null;
let _renameBtn = null;
let _deleteBtn = null;
let _notesHl = null;

// Injected services from page-level wiring.
let _SaveManager = null;
let _uiPrompt = null;
let _uiAlert = null;
let _uiConfirm = null;
let _state = null;
let _setStatus = null;

let _wired = false;
let _suppressNextSessionTabClick = false;
let _activeDrag = null;

const DRAG_START_THRESHOLD_PX = 14;
const SCROLL_CANCEL_THRESHOLD_PX = 6;

function _newSessionId() {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function _normalizeSessions(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return [{ id: _newSessionId(), title: "Session 1", notes: "" }];
  }

  const seenIds = new Set();
  return input.map((entry, index) => {
    const source = entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry
      : {};
    let id = typeof source.id === "string" ? source.id.trim() : "";
    if (!id || seenIds.has(id)) id = _newSessionId();
    seenIds.add(id);
    return {
      ...source,
      id,
      title: typeof source.title === "string" ? source.title : `Session ${index + 1}`,
      notes: typeof source.notes === "string" ? source.notes : ""
    };
  });
}

function _getSessionIndexById(sessionId) {
  if (!sessionId) return -1;
  return (_state?.tracker?.sessions || []).findIndex((session) => session?.id === sessionId);
}

function _saveActiveSessionNotes() {
  const cur = _state?.tracker?.sessions?.[_state?.tracker?.activeSessionIndex];
  if (cur && _notesBox) cur.notes = _notesBox.value;
}

function _getVisibleSessionIdsFromDom() {
  if (!_tabsEl) return [];
  return Array.from(_tabsEl.querySelectorAll(".sessionTab"))
    .map((el) => el.dataset.sessionId || "")
    .filter(Boolean);
}

function _applyVisibleSessionOrder(visibleIds, activeSessionId) {
  const sessions = Array.isArray(_state?.tracker?.sessions) ? _state.tracker.sessions : [];
  if (sessions.length <= 1 || visibleIds.length <= 1) return false;

  const visibleSet = new Set(visibleIds);
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const reorderedVisible = visibleIds
    .map((id) => sessionById.get(id))
    .filter(Boolean);

  let visibleCursor = 0;
  const nextSessions = sessions.map((session) => {
    if (!visibleSet.has(session.id)) return session;
    return reorderedVisible[visibleCursor++] || session;
  });

  const changed = nextSessions.some((session, index) => session?.id !== sessions[index]?.id);
  if (!changed) return false;

  _state.tracker.sessions = nextSessions;
  const nextActiveIndex = _getSessionIndexById(activeSessionId);
  _state.tracker.activeSessionIndex = nextActiveIndex >= 0 ? nextActiveIndex : 0;
  return true;
}

function _clearActiveDragStyles(dragState) {
  if (!dragState?.buttonEl) return;
  dragState.buttonEl.classList.remove("isDragging");
  dragState.buttonEl.style.transform = "";
  _tabsEl?.classList.remove("isDraggingSessions");
  document.body?.classList.remove("isDraggingSessionTabs");
}

function _finishSessionDrag({ commit }) {
  const dragState = _activeDrag;
  if (!dragState) return;

  dragState.cleanup?.();
  _clearActiveDragStyles(dragState);
  _activeDrag = null;

  if (!dragState.started) return;

  _suppressNextSessionTabClick = true;
  if (!commit) {
    renderSessionTabs();
    return;
  }

  _saveActiveSessionNotes();
  const orderChanged = _applyVisibleSessionOrder(
    _getVisibleSessionIdsFromDom(),
    dragState.activeSessionId
  );

  if (orderChanged) markDirty();
  renderSessionTabs();
}

function _updateDraggedTabPosition(dragState) {
  if (!dragState?.buttonEl || !_tabsEl) return;
  const draggedRect = dragState.buttonEl.getBoundingClientRect();
  const draggedCenter = draggedRect.left + (draggedRect.width / 2);
  const siblings = Array.from(_tabsEl.querySelectorAll(".sessionTab"))
    .filter((el) => el !== dragState.buttonEl);

  let insertBeforeEl = null;
  for (const sibling of siblings) {
    const rect = sibling.getBoundingClientRect();
    const center = rect.left + (rect.width / 2);
    if (draggedCenter < center) {
      insertBeforeEl = sibling;
      break;
    }
  }

  if (insertBeforeEl) _tabsEl.insertBefore(dragState.buttonEl, insertBeforeEl);
  else _tabsEl.appendChild(dragState.buttonEl);
}

function _beginSessionTabDrag(event, buttonEl, sessionId) {
  if (!buttonEl || !sessionId || !_tabsEl) return;
  if ((_state?.tracker?.sessions?.length || 0) <= 1) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (_activeDrag) _finishSessionDrag({ commit: false });

  const doc = buttonEl.ownerDocument || document;
  const wrapEl = _tabsEl.parentElement;
  const dragState = {
    pointerId: event.pointerId,
    buttonEl,
    sessionId,
    activeSessionId: _state?.tracker?.sessions?.[_state?.tracker?.activeSessionIndex]?.id || sessionId,
    startX: event.clientX,
    startY: event.clientY,
    startScrollLeft: wrapEl?.scrollLeft || 0,
    started: false,
    cleanup: null
  };

  const handlePointerMove = (moveEvent) => {
    if (!_activeDrag || moveEvent.pointerId !== dragState.pointerId) return;

    const deltaX = moveEvent.clientX - dragState.startX;
    const deltaY = moveEvent.clientY - dragState.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const scrolledBy = Math.abs((wrapEl?.scrollLeft || 0) - dragState.startScrollLeft);

    if (!dragState.started) {
      if (scrolledBy > SCROLL_CANCEL_THRESHOLD_PX) {
        _finishSessionDrag({ commit: false });
        return;
      }
      if (absY > DRAG_START_THRESHOLD_PX && absY > absX) {
        _finishSessionDrag({ commit: false });
        return;
      }
      if (absX < DRAG_START_THRESHOLD_PX || absX <= absY) return;

      dragState.started = true;
      try { dragState.buttonEl.setPointerCapture?.(dragState.pointerId); } catch { /* noop */ }
      dragState.buttonEl.classList.add("isDragging");
      _tabsEl.classList.add("isDraggingSessions");
      document.body?.classList.add("isDraggingSessionTabs");
    }

    moveEvent.preventDefault();
    dragState.buttonEl.style.transform = `translateX(${deltaX}px)`;
    _updateDraggedTabPosition(dragState);
  };

  const handlePointerUp = (upEvent) => {
    if (!_activeDrag || upEvent.pointerId !== dragState.pointerId) return;
    try { dragState.buttonEl.releasePointerCapture?.(dragState.pointerId); } catch { /* noop */ }
    _finishSessionDrag({ commit: true });
  };

  const handlePointerCancel = (cancelEvent) => {
    if (!_activeDrag || cancelEvent.pointerId !== dragState.pointerId) return;
    _finishSessionDrag({ commit: false });
  };

  doc.addEventListener("pointermove", handlePointerMove);
  doc.addEventListener("pointerup", handlePointerUp);
  doc.addEventListener("pointercancel", handlePointerCancel);
  dragState.cleanup = () => {
    doc.removeEventListener("pointermove", handlePointerMove);
    doc.removeEventListener("pointerup", handlePointerUp);
    doc.removeEventListener("pointercancel", handlePointerCancel);
  };

  _activeDrag = dragState;
}

function _escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function _appendHighlightedText(parentEl, text, query) {
  const source = String(text ?? "");
  const q = String(query ?? "").trim();
  if (!q) {
    parentEl.replaceChildren(document.createTextNode(source));
    return;
  }

  const re = new RegExp(_escapeRegExp(q), "gi");
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match = re.exec(source);

  while (match) {
    const start = match.index;
    const end = start + match[0].length;

    if (start > lastIndex) {
      fragment.appendChild(document.createTextNode(source.slice(lastIndex, start)));
    }

    const mark = document.createElement("mark");
    mark.className = "searchMark";
    mark.textContent = source.slice(start, end);
    fragment.appendChild(mark);

    lastIndex = end;
    match = re.exec(source);
  }

  if (lastIndex < source.length) {
    fragment.appendChild(document.createTextNode(source.slice(lastIndex)));
  }

  parentEl.replaceChildren(fragment);
}


/**
 * Initialize Sessions UI.
 *
 * deps = {
 *   tabsEl, notesBox, searchEl, addBtn, renameBtn, deleteBtn,
 *   SaveManager, uiPrompt, uiAlert, uiConfirm
 * }
 */
export function initSessionsPanel(deps = {}) {
  _state = deps.state;
  _tabsEl = deps.tabsEl || null;
  _notesBox = deps.notesBox || null;
  _searchEl = deps.searchEl || null;
  _addBtn = deps.addBtn || null;
  _renameBtn = deps.renameBtn || null;
  _deleteBtn = deps.deleteBtn || null;

  _SaveManager = deps.SaveManager;
  _uiPrompt = deps.uiPrompt;
  _uiAlert = deps.uiAlert;
  _uiConfirm = deps.uiConfirm;
  _setStatus = deps.setStatus;

  const required = {};
  if (!_tabsEl) required.tabsEl = "#sessionTabs";
  if (!_notesBox) required.notesBox = "#sessionNotesBox";
  if (!_searchEl) required.searchEl = "#sessionSearch";
  if (!_addBtn) required.addBtn = "#addSessionBtn";
  if (!_renameBtn) required.renameBtn = "#renameSessionBtn";
  if (!_deleteBtn) required.deleteBtn = "#deleteSessionBtn";
  if (Object.keys(required).length) {
    const guard = requireMany(required, { root: document, setStatus: _setStatus, context: "Sessions panel" });
    if (!guard.ok) return guard.destroy;
    _tabsEl = _tabsEl || guard.els.tabsEl;
    _notesBox = _notesBox || guard.els.notesBox;
    _searchEl = _searchEl || guard.els.searchEl;
    _addBtn = _addBtn || guard.els.addBtn;
    _renameBtn = _renameBtn || guard.els.renameBtn;
    _deleteBtn = _deleteBtn || guard.els.deleteBtn;
  }

  if (!_state) {
    console.warn("Sessions UI: missing required dependency (state).");
    return getNoopDestroyApi();
  }

  const missingCritical =
    !_tabsEl || !_notesBox || !_searchEl || !_addBtn || !_renameBtn || !_deleteBtn;
  if (missingCritical) {
    const message = "Sessions panel unavailable (missing expected UI elements).";
    if (typeof _setStatus === "function") _setStatus(message, { stickyMs: 5000 });
    else console.warn(message);
    return getNoopDestroyApi();
  }

  ensureSessionDefaults();

  // True in-field highlight inside the session notes box
  _notesHl = attachSearchHighlightOverlay(_notesBox, () => (_state.tracker.sessionSearch || ""));

  // Wire handlers only once (setupTracker can run more than once in some refactors)
  if (!_wired) {
    wireHandlers();
    _wired = true;
  }

  renderSessionTabs();
}

function renderSessionTabs() {
  if (!_tabsEl || !_notesBox) return;

  _tabsEl.replaceChildren();

  const query = (_state.tracker.sessionSearch || "").trim().toLowerCase();
  const activeSessionId = _state.tracker.sessions?.[_state.tracker.activeSessionIndex]?.id || "";

  // Decide which sessions to show in the tab strip
  const sessionsToShow = (_state.tracker.sessions || [])
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => {
      if (!query) return true;
      const title = (s.title || "").toLowerCase();
      const notes = (s.notes || "").toLowerCase();
      return title.includes(query) || notes.includes(query);
    });

  sessionsToShow.forEach(({ s, idx }) => {
    const btn = document.createElement("button");
    btn.className = "sessionTab" + (s.id === activeSessionId ? " active" : "");
    btn.type = "button";
    btn.dataset.sessionId = s.id;
    _appendHighlightedText(btn, (s.title || `Session ${idx + 1}`), _state.tracker.sessionSearch || "");
    btn.addEventListener("pointerdown", (event) => _beginSessionTabDrag(event, btn, s.id));
    btn.addEventListener("click", () => switchSessionById(s.id));
    _tabsEl.appendChild(btn);
  });

  // Load current notes into box
  const current = _state.tracker.sessions?.[_state.tracker.activeSessionIndex];
  _notesBox.value = current?.notes || "";
  if (_notesHl) _notesHl.update();

  // Optional: if there are no matches, show a tiny hint
  if (sessionsToShow.length === 0) {
    const hint = document.createElement("div");
    hint.className = "mutedSmall";
    hint.style.marginLeft = "6px";
    hint.textContent = "No matching sessions.";
    _tabsEl.appendChild(hint);
  }
}

function ensureSessionDefaults() {
  _state.tracker.sessions = _normalizeSessions(_state.tracker.sessions);
  if (typeof _state.tracker.activeSessionIndex !== "number") {
    _state.tracker.activeSessionIndex = 0;
  }
  if (_state.tracker.activeSessionIndex < 0) _state.tracker.activeSessionIndex = 0;
  if (_state.tracker.activeSessionIndex >= _state.tracker.sessions.length) {
    _state.tracker.activeSessionIndex = _state.tracker.sessions.length - 1;
  }
}

function markDirty() {
  try {
    _SaveManager?.markDirty?.();
  } catch {
    // ignore
  }
}

function wireHandlers() {
  document.addEventListener("click", (event) => {
    if (!_suppressNextSessionTabClick) return;
    _suppressNextSessionTabClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  // Search
  if (_searchEl) {
    _searchEl.value = _state.tracker.sessionSearch || "";
    _searchEl.addEventListener("input", () => {
      _state.tracker.sessionSearch = _searchEl.value;
      markDirty();
      renderSessionTabs();
    });
  }

  // Notes typing saves into active session
  _notesBox.addEventListener("input", () => {
    const cur = _state.tracker.sessions?.[_state.tracker.activeSessionIndex];
    if (!cur) return;
    cur.notes = _notesBox.value;
    markDirty();
  });

  // Add session
  _addBtn?.addEventListener("click", () => {
    // Save current first
    _saveActiveSessionNotes();

    const nextNum = (_state.tracker.sessions?.length || 0) + 1;
    _state.tracker.sessions.push({ id: _newSessionId(), title: `Session ${nextNum}`, notes: "" });
    _state.tracker.activeSessionIndex = _state.tracker.sessions.length - 1;

    markDirty();
    renderSessionTabs();
    _notesBox.focus();
  });

  // Rename session
  _renameBtn?.addEventListener(
    "click",
    safeAsync(async () => {
      const cur = _state.tracker.sessions?.[_state.tracker.activeSessionIndex];
      if (!cur) return;

      const proposed = await _uiPrompt?.("Rename session tab to:", {
        defaultValue: cur.title || "",
        title: "Rename Session"
      });
      if (proposed === null || proposed === undefined) return; // cancelled

      cur.title = String(proposed).trim() || cur.title || `Session ${_state.tracker.activeSessionIndex + 1}`;
      markDirty();
      renderSessionTabs();
    }, (err) => {
      console.error(err);
      if (typeof _setStatus === "function") _setStatus("Rename session failed.");
      else console.warn("Rename session failed.");
    })
  );

  // Delete session
  _deleteBtn?.addEventListener(
    "click",
    safeAsync(async (e) => {
      if ((_state.tracker.sessions?.length || 0) <= 1) {
        await _uiAlert?.("You need at least one session.", { title: "Notice" });
        // Defensive: some click targets expose a value field; clearing it is harmless.
        if (e?.target && "value" in e.target) e.target.value = "";
        return;
      }

      const ok = await _uiConfirm?.("Delete this session? This cannot be undone.", {
        title: "Delete Session",
        okText: "Delete"
      });
      if (!ok) return;

      const idx = _state.tracker.activeSessionIndex;
      _state.tracker.sessions.splice(idx, 1);
      _state.tracker.activeSessionIndex = Math.max(0, idx - 1);

      markDirty();
      renderSessionTabs();
    }, (err) => {
      console.error(err);
      if (typeof _setStatus === "function") _setStatus("Delete session failed.");
      else console.warn("Delete session failed.");
    })
  );
}

function switchSessionById(sessionId) {
  const newIndex = _getSessionIndexById(sessionId);
  if (newIndex < 0 || newIndex === _state.tracker.activeSessionIndex) return;

  _saveActiveSessionNotes();
  _state.tracker.activeSessionIndex = newIndex;
  markDirty();
  renderSessionTabs();
}
