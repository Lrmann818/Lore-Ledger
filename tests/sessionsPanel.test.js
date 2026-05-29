// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../js/ui/searchHighlightOverlay.js", () => ({
  attachSearchHighlightOverlay: vi.fn(() => ({
    update: vi.fn(),
    destroy: vi.fn()
  }))
}));

function setupDom() {
  document.body.innerHTML = `
    <div class="sessionTabsWrap"><div id="sessionTabs" class="sessionTabs"></div></div>
    <textarea id="sessionNotesBox"></textarea>
    <input id="sessionSearch" />
    <button id="addSessionBtn" type="button">Add</button>
    <button id="renameSessionBtn" type="button">Rename</button>
    <button id="deleteSessionBtn" type="button">Delete</button>
  `;

  const wrap = document.querySelector(".sessionTabsWrap");
  Object.defineProperty(wrap, "scrollLeft", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: 0
  });
}

function layoutSessionTabs() {
  const buttons = Array.from(document.querySelectorAll("#sessionTabs .sessionTab"));
  buttons.forEach((button) => {
    button.setPointerCapture = vi.fn();
    button.releasePointerCapture = vi.fn();
    Object.defineProperty(button, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const siblings = Array.from(button.parentElement?.querySelectorAll(".sessionTab") || []);
        const index = siblings.indexOf(button);
        const translateMatch = button.style.transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
        const translateX = translateMatch ? Number(translateMatch[1]) : 0;
        const left = (index * 110) + translateX;
        return {
          x: left,
          y: 0,
          left,
          top: 0,
          right: left + 100,
          bottom: 32,
          width: 100,
          height: 32,
          toJSON() {
            return this;
          }
        };
      }
    });
  });
}

function dispatchPointer(target, type, props = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX: 0,
    clientY: 0,
    ...props
  });
  target.dispatchEvent(event);
  return event;
}

function makeState() {
  return {
    tracker: {
      sessions: [
        { id: "session_a", title: "Session A", notes: "A notes" },
        { id: "session_b", title: "Session B", notes: "B notes" },
        { id: "session_c", title: "Session C", notes: "C notes" }
      ],
      sessionSearch: "",
      activeSessionIndex: 0
    }
  };
}

async function loadSessionsPanel() {
  vi.resetModules();
  return import("../js/pages/tracker/panels/sessions.js");
}

describe("initSessionsPanel", () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("keeps normal tab clicks selecting the requested session", async () => {
    const { initSessionsPanel } = await loadSessionsPanel();
    const state = makeState();
    const markDirty = vi.fn();

    initSessionsPanel({
      state,
      tabsEl: document.getElementById("sessionTabs"),
      notesBox: document.getElementById("sessionNotesBox"),
      searchEl: document.getElementById("sessionSearch"),
      addBtn: document.getElementById("addSessionBtn"),
      renameBtn: document.getElementById("renameSessionBtn"),
      deleteBtn: document.getElementById("deleteSessionBtn"),
      SaveManager: { markDirty },
      uiPrompt: vi.fn(),
      uiAlert: vi.fn(),
      uiConfirm: vi.fn(),
      setStatus: vi.fn()
    });

    const secondTab = document.querySelectorAll("#sessionTabs .sessionTab")[1];
    secondTab.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(state.tracker.activeSessionIndex).toBe(1);
    expect(document.getElementById("sessionNotesBox").value).toBe("B notes");
    expect(markDirty).toHaveBeenCalledTimes(1);
  });

  it("reorders sessions by stable ids and suppresses the release click after a drag", async () => {
    const { initSessionsPanel } = await loadSessionsPanel();
    const state = makeState();
    const markDirty = vi.fn();

    initSessionsPanel({
      state,
      tabsEl: document.getElementById("sessionTabs"),
      notesBox: document.getElementById("sessionNotesBox"),
      searchEl: document.getElementById("sessionSearch"),
      addBtn: document.getElementById("addSessionBtn"),
      renameBtn: document.getElementById("renameSessionBtn"),
      deleteBtn: document.getElementById("deleteSessionBtn"),
      SaveManager: { markDirty },
      uiPrompt: vi.fn(),
      uiAlert: vi.fn(),
      uiConfirm: vi.fn(),
      setStatus: vi.fn()
    });

    layoutSessionTabs();

    const firstTab = document.querySelectorAll("#sessionTabs .sessionTab")[0];
    dispatchPointer(firstTab, "pointerdown", { clientX: 50, clientY: 16 });
    dispatchPointer(document, "pointermove", { clientX: 190, clientY: 16 });
    dispatchPointer(document, "pointerup", { clientX: 190, clientY: 16 });

    expect(state.tracker.sessions.map((session) => session.id)).toEqual([
      "session_b",
      "session_a",
      "session_c"
    ]);
    expect(state.tracker.activeSessionIndex).toBe(1);
    expect(markDirty).toHaveBeenCalledTimes(1);

    layoutSessionTabs();

    const releaseClickTarget = document.querySelectorAll("#sessionTabs .sessionTab")[0];
    const suppressedClick = new Event("click", { bubbles: true, cancelable: true });
    expect(releaseClickTarget.dispatchEvent(suppressedClick)).toBe(false);
    expect(state.tracker.activeSessionIndex).toBe(1);

    const intentionalClick = new Event("click", { bubbles: true, cancelable: true });
    expect(releaseClickTarget.dispatchEvent(intentionalClick)).toBe(true);
    expect(state.tracker.activeSessionIndex).toBe(0);
  });

  it("sub-threshold pointer movement does not reorder tabs or suppress the following click", async () => {
    const { initSessionsPanel } = await loadSessionsPanel();
    const state = makeState();
    const markDirty = vi.fn();

    initSessionsPanel({
      state,
      tabsEl: document.getElementById("sessionTabs"),
      notesBox: document.getElementById("sessionNotesBox"),
      searchEl: document.getElementById("sessionSearch"),
      addBtn: document.getElementById("addSessionBtn"),
      renameBtn: document.getElementById("renameSessionBtn"),
      deleteBtn: document.getElementById("deleteSessionBtn"),
      SaveManager: { markDirty },
      uiPrompt: vi.fn(),
      uiAlert: vi.fn(),
      uiConfirm: vi.fn(),
      setStatus: vi.fn()
    });

    layoutSessionTabs();

    // Move 8px — below the 14px DRAG_START_THRESHOLD_PX. Drag must not start.
    const firstTab = document.querySelectorAll("#sessionTabs .sessionTab")[0];
    dispatchPointer(firstTab, "pointerdown", { clientX: 50, clientY: 16 });
    dispatchPointer(document, "pointermove", { clientX: 58, clientY: 16 });
    dispatchPointer(document, "pointerup", { clientX: 58, clientY: 16 });

    expect(state.tracker.sessions.map((s) => s.id)).toEqual([
      "session_a", "session_b", "session_c"
    ]);
    expect(markDirty).not.toHaveBeenCalled();

    // Click suppression must NOT be active — the next click works normally.
    const secondTab = document.querySelectorAll("#sessionTabs .sessionTab")[1];
    const click = new Event("click", { bubbles: true, cancelable: true });
    expect(secondTab.dispatchEvent(click)).toBe(true);
    expect(state.tracker.activeSessionIndex).toBe(1);
  });

  it("drag reorder followed by rename preserves the reordered position via stable id", async () => {
    const { initSessionsPanel } = await loadSessionsPanel();
    const state = makeState();
    const markDirty = vi.fn();
    const uiPrompt = vi.fn(async () => "Session A Renamed");

    initSessionsPanel({
      state,
      tabsEl: document.getElementById("sessionTabs"),
      notesBox: document.getElementById("sessionNotesBox"),
      searchEl: document.getElementById("sessionSearch"),
      addBtn: document.getElementById("addSessionBtn"),
      renameBtn: document.getElementById("renameSessionBtn"),
      deleteBtn: document.getElementById("deleteSessionBtn"),
      SaveManager: { markDirty },
      uiPrompt,
      uiAlert: vi.fn(),
      uiConfirm: vi.fn(),
      setStatus: vi.fn()
    });

    layoutSessionTabs();

    // Drag session A past session B's midpoint → [B, A, C].
    const firstTab = document.querySelectorAll("#sessionTabs .sessionTab")[0];
    dispatchPointer(firstTab, "pointerdown", { clientX: 50, clientY: 16 });
    dispatchPointer(document, "pointermove", { clientX: 190, clientY: 16 });
    dispatchPointer(document, "pointerup", { clientX: 190, clientY: 16 });

    expect(state.tracker.sessions.map((s) => s.id)).toEqual([
      "session_b", "session_a", "session_c"
    ]);
    // Active session (A) is now at index 1 after the reorder.
    expect(state.tracker.activeSessionIndex).toBe(1);

    // The drag sets _suppressNextSessionTabClick=true. Drain it with a dummy click
    // so the subsequent toolbar button click is not caught and blocked.
    document.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    // Rename the active session (session_a at index 1).
    document.getElementById("renameSessionBtn").dispatchEvent(
      new Event("click", { bubbles: true, cancelable: true })
    );
    await vi.waitFor(() => {
      expect(state.tracker.sessions[1].title).toBe("Session A Renamed");
    });

    // Renaming must not shift position — ordering uses stable IDs, not labels.
    expect(state.tracker.sessions.map((s) => s.id)).toEqual([
      "session_b", "session_a", "session_c"
    ]);
  });

  it("drag reorder followed by delete removes the correct session and leaves no stale tab entries", async () => {
    const { initSessionsPanel } = await loadSessionsPanel();
    const state = makeState();
    const markDirty = vi.fn();
    const uiConfirm = vi.fn(async () => true);

    initSessionsPanel({
      state,
      tabsEl: document.getElementById("sessionTabs"),
      notesBox: document.getElementById("sessionNotesBox"),
      searchEl: document.getElementById("sessionSearch"),
      addBtn: document.getElementById("addSessionBtn"),
      renameBtn: document.getElementById("renameSessionBtn"),
      deleteBtn: document.getElementById("deleteSessionBtn"),
      SaveManager: { markDirty },
      uiPrompt: vi.fn(),
      uiAlert: vi.fn(),
      uiConfirm,
      setStatus: vi.fn()
    });

    layoutSessionTabs();

    // Drag session A past session B's midpoint → [B, A, C]; active = A at index 1.
    const firstTab = document.querySelectorAll("#sessionTabs .sessionTab")[0];
    dispatchPointer(firstTab, "pointerdown", { clientX: 50, clientY: 16 });
    dispatchPointer(document, "pointermove", { clientX: 190, clientY: 16 });
    dispatchPointer(document, "pointerup", { clientX: 190, clientY: 16 });

    expect(state.tracker.sessions.map((s) => s.id)).toEqual([
      "session_b", "session_a", "session_c"
    ]);
    expect(state.tracker.activeSessionIndex).toBe(1);

    // The drag sets _suppressNextSessionTabClick=true. Drain it with a dummy click
    // so the subsequent toolbar button click is not caught and blocked.
    document.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    // Delete the active session (session_a at index 1).
    document.getElementById("deleteSessionBtn").dispatchEvent(
      new Event("click", { bubbles: true, cancelable: true })
    );
    await vi.waitFor(() => {
      expect(state.tracker.sessions).toHaveLength(2);
    });

    // B and C remain with no stale A entry.
    expect(state.tracker.sessions.map((s) => s.id)).toEqual(["session_b", "session_c"]);
    // Active moves to index 0 (Math.max(0, deletedIndex - 1) = Math.max(0, 0) = 0).
    expect(state.tracker.activeSessionIndex).toBe(0);

    // DOM must show exactly two tabs, no blank placeholder.
    const tabs = document.querySelectorAll("#sessionTabs .sessionTab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].dataset.sessionId).toBe("session_b");
    expect(tabs[1].dataset.sessionId).toBe("session_c");
  });

  it("appends new sessions and keeps id-based order stable across rename and delete", async () => {
    const { initSessionsPanel } = await loadSessionsPanel();
    const state = makeState();
    state.tracker.sessions = state.tracker.sessions.slice(0, 2);
    const markDirty = vi.fn();
    const uiPrompt = vi.fn(async () => "Renamed Session");
    const uiConfirm = vi.fn(async () => true);

    initSessionsPanel({
      state,
      tabsEl: document.getElementById("sessionTabs"),
      notesBox: document.getElementById("sessionNotesBox"),
      searchEl: document.getElementById("sessionSearch"),
      addBtn: document.getElementById("addSessionBtn"),
      renameBtn: document.getElementById("renameSessionBtn"),
      deleteBtn: document.getElementById("deleteSessionBtn"),
      SaveManager: { markDirty },
      uiPrompt,
      uiAlert: vi.fn(),
      uiConfirm,
      setStatus: vi.fn()
    });

    document.getElementById("addSessionBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    expect(state.tracker.sessions).toHaveLength(3);
    const appendedSessionId = state.tracker.sessions[2].id;
    expect(state.tracker.sessions.map((session) => session.id)).toEqual([
      "session_a",
      "session_b",
      appendedSessionId
    ]);

    document.getElementById("renameSessionBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(state.tracker.sessions[2].title).toBe("Renamed Session");
    });
    expect(state.tracker.sessions.map((session) => session.id)).toEqual([
      "session_a",
      "session_b",
      appendedSessionId
    ]);

    document.getElementById("deleteSessionBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(state.tracker.sessions).toHaveLength(2);
    });
    expect(state.tracker.sessions.map((session) => session.id)).toEqual([
      "session_a",
      "session_b"
    ]);
    expect(state.tracker.activeSessionIndex).toBe(1);
    expect(markDirty).toHaveBeenCalled();
  });
});
