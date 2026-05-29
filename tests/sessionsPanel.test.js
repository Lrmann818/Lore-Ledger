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
