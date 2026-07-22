// @vitest-environment jsdom
//
// Restore Character dialog (R3) behavior. Drives the controller with injected
// fake deps (the R2 engine, SaveManager.flush, and the finalize seam are all
// stubbed) so every dialog rule — grouping/ordering, empty state, confirmation,
// the persistence-confirmation "Retry Save" lock, close-blocking after commit,
// focus, and the strict "restore-only, never delete a snapshot" contract — is
// tested independently of the engine.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  groupSnapshotsForDisplay,
  initRestoreCharacterDialog
} from "../js/pages/character/restoreCharacterDialog.js";

const RESTORE_OVERLAY_HTML = `
  <button type="button" id="charActionRestoreBtn">Restore Character</button>
  <div id="restoreCharacterOverlay" class="modalOverlay" hidden aria-hidden="true">
    <div class="modalPanel restoreCharacterPanel" id="restoreCharacterPanel" role="dialog" aria-modal="true"
      aria-labelledby="restoreCharacterTitle" tabindex="-1">
      <div class="restoreCharacterHeader">
        <div class="modalTitle" id="restoreCharacterTitle">Restore Character</div>
        <button type="button" class="npcSmallBtn" id="restoreCharacterClose" aria-label="Close">✕</button>
      </div>
      <div class="restoreCharacterBody" id="restoreCharacterBody">
        <p class="restoreCharacterIntro" id="restoreCharacterIntro">intro</p>
        <div class="restoreCharacterEmpty" id="restoreCharacterEmpty" hidden>
          No snapshots yet. Lore Ledger automatically saves a snapshot of a character right before
          every Level Up. Level a character up and its pre-Level-Up state will appear here.
        </div>
        <div class="restoreCharacterList" id="restoreCharacterList"></div>
        <div class="restoreCharacterPending" id="restoreCharacterPending" role="alert" aria-live="assertive" hidden>
          <p class="restoreCharacterPendingMsg" id="restoreCharacterPendingMsg"></p>
        </div>
      </div>
      <div class="restoreCharacterFooter">
        <button type="button" class="npcSmallBtn" id="restoreCharacterRetrySave" hidden>Retry Save</button>
        <button type="button" class="npcSmallBtn" id="restoreCharacterCancel">Close</button>
      </div>
    </div>
  </div>
`;

let dialogs = [];
function track(api) { dialogs.push(api); return api; }

beforeEach(() => {
  document.body.innerHTML = RESTORE_OVERLAY_HTML;
});

afterEach(() => {
  dialogs.forEach((api) => { try { api?.destroy?.(); } catch { /* noop */ } });
  dialogs = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle() { await tick(); await tick(); await tick(); }

function makeSnapshot(over = {}) {
  return {
    id: "csnap_1",
    kind: "pre-level-up",
    sourceCharacterId: "char_a",
    sourceName: "Ada",
    classSummary: "Wizard 3",
    fromLevel: 3,
    toLevel: 4,
    toClassId: "wizard",
    createdAt: "2026-07-20T10:00:00.000Z",
    schemaVersion: 13,
    payload: { id: "char_a", name: "Ada", build: {}, spells: { levels: [] } },
    ...over
  };
}

function makeState(over = {}) {
  return {
    appShell: { activeCampaignId: "camp_1" },
    characters: {
      activeId: "char_a",
      entries: [{ id: "char_a", name: "Ada" }],
      snapshots: [],
      ...(over.characters || {})
    },
    ...(over.appShell ? { appShell: over.appShell } : {})
  };
}

function initDialog(state, over = {}) {
  const restore = over.restore
    || vi.fn().mockResolvedValue({ characterId: "char_new", name: "Ada — Restored Level 3" });
  const flushSave = over.flushSave || vi.fn().mockResolvedValue(true);
  const finalizeRestore = over.finalizeRestore || vi.fn();
  const uiConfirm = over.uiConfirm || vi.fn().mockResolvedValue(true);
  const uiAlert = over.uiAlert || vi.fn().mockResolvedValue(undefined);
  const setStatus = over.setStatus || vi.fn();
  const api = track(initRestoreCharacterDialog({
    root: document,
    state,
    restore,
    flushSave,
    finalizeRestore,
    uiConfirm,
    uiAlert,
    setStatus,
    formatTimestamp: over.formatTimestamp || ((iso) => (iso ? `DATE(${iso})` : ""))
  }));
  return { api, restore, flushSave, finalizeRestore, uiConfirm, uiAlert, setStatus };
}

const overlay = () => document.getElementById("restoreCharacterOverlay");
const emptyEl = () => document.getElementById("restoreCharacterEmpty");
const listEl = () => document.getElementById("restoreCharacterList");
const pendingEl = () => document.getElementById("restoreCharacterPending");
const retryBtn = () => document.getElementById("restoreCharacterRetrySave");
const closeBtn = () => document.getElementById("restoreCharacterClose");
const cancelBtn = () => document.getElementById("restoreCharacterCancel");
const rowButtons = () => Array.from(document.querySelectorAll("[data-snapshot-id]"));
const rowButton = (id) => document.querySelector(`[data-snapshot-id="${id}"]`);

/* ------------------------ canonical static markup ----------------------- */

describe("Restore Character — index.html markup", () => {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

  it("ships the menu item directly after Level Up", () => {
    const menu = html.match(/id="charActionDropdownMenu"[\s\S]*?<\/div>/)?.[0] || "";
    const actions = Array.from(menu.matchAll(/data-char-action="([^"]+)"/g)).map((m) => m[1]);
    const levelUpIdx = actions.indexOf("level-up");
    expect(levelUpIdx).toBeGreaterThanOrEqual(0);
    expect(actions[levelUpIdx + 1]).toBe("restore-character");
    expect(html).toContain('id="charActionRestoreBtn"');
    expect(html).toContain(">Restore Character</button>");
  });

  it("ships the exact empty-state copy and the dialog anchors", () => {
    const empty = html.match(/id="restoreCharacterEmpty"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
    expect(empty.replace(/\s+/g, " ").trim()).toBe(
      "No snapshots yet. Lore Ledger automatically saves a snapshot of a character right before " +
      "every Level Up. Level a character up and its pre-Level-Up state will appear here."
    );
    for (const id of [
      "restoreCharacterOverlay", "restoreCharacterPanel", "restoreCharacterTitle",
      "restoreCharacterClose", "restoreCharacterList", "restoreCharacterPending",
      "restoreCharacterRetrySave", "restoreCharacterCancel"
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});

/* ----------------------- pure grouping / ordering ----------------------- */

describe("groupSnapshotsForDisplay", () => {
  it("groups by source character, newest-first groups and rows", () => {
    const snapshots = [
      makeSnapshot({ id: "s1", sourceCharacterId: "char_a", sourceName: "Ada", createdAt: "2026-07-20T10:00:00Z", fromLevel: 3 }),
      makeSnapshot({ id: "s2", sourceCharacterId: "char_a", sourceName: "Ada", createdAt: "2026-07-22T10:00:00Z", fromLevel: 4 }),
      makeSnapshot({ id: "s3", sourceCharacterId: "char_b", sourceName: "Bram", createdAt: "2026-07-21T10:00:00Z", fromLevel: 2 })
    ];
    const entries = [{ id: "char_a", name: "Ada" }, { id: "char_b", name: "Bram" }];
    const groups = groupSnapshotsForDisplay(snapshots, entries);
    // char_a's newest (2026-07-22) beats char_b's newest (2026-07-21).
    expect(groups.map((g) => g.sourceCharacterId)).toEqual(["char_a", "char_b"]);
    // Rows within char_a are newest-first.
    expect(groups[0].snapshots.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(groups[0].deleted).toBe(false);
  });

  it("flags a group whose source character was deleted, but keeps it", () => {
    const snapshots = [makeSnapshot({ id: "s1", sourceCharacterId: "char_gone", sourceName: "Ghost" })];
    const groups = groupSnapshotsForDisplay(snapshots, [{ id: "char_a", name: "Ada" }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].deleted).toBe(true);
    expect(groups[0].sourceName).toBe("Ghost");
  });

  it("skips malformed records", () => {
    const groups = groupSnapshotsForDisplay(
      [null, {}, { id: "x" }, makeSnapshot({ id: "ok", sourceCharacterId: "char_a" })],
      []
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].snapshots.map((s) => s.id)).toEqual(["ok"]);
  });
});

/* ------------------------------ empty state ----------------------------- */

describe("Restore Character dialog — empty state", () => {
  it("shows the exact empty-state copy and stays available with zero snapshots", async () => {
    const state = makeState();
    const { api } = initDialog(state);
    api.open();
    await settle();
    expect(overlay().hidden).toBe(false);
    expect(emptyEl().hidden).toBe(false);
    expect(emptyEl().textContent.replace(/\s+/g, " ").trim()).toBe(
      "No snapshots yet. Lore Ledger automatically saves a snapshot of a character right before " +
      "every Level Up. Level a character up and its pre-Level-Up state will appear here."
    );
    expect(listEl().hidden).toBe(true);
    expect(rowButtons()).toHaveLength(0);
  });
});

/* --------------------------- list rendering ----------------------------- */

describe("Restore Character dialog — list rendering", () => {
  it("renders grouped rows newest-first with primary + secondary content", async () => {
    const state = makeState({
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Ada" }],
        snapshots: [
          makeSnapshot({ id: "s1", sourceCharacterId: "char_a", createdAt: "2026-07-20T10:00:00Z", fromLevel: 3, toLevel: 4, classSummary: "Wizard 3" }),
          makeSnapshot({ id: "s2", sourceCharacterId: "char_a", createdAt: "2026-07-22T10:00:00Z", fromLevel: 4, toLevel: 5, classSummary: "Wizard 4" })
        ]
      }
    });
    initDialog(state).api.open();
    await settle();
    const rows = rowButtons();
    expect(rows.map((b) => b.dataset.snapshotId)).toEqual(["s2", "s1"]);
    const primaries = Array.from(document.querySelectorAll(".restoreCharacterRowPrimary")).map((n) => n.textContent);
    expect(primaries).toEqual(["Level 4 — Wizard 4", "Level 3 — Wizard 3"]);
    // Secondary shows a localized date and the "Before Level Up to <N>" line.
    const firstSecondary = document.querySelector(".restoreCharacterRowSecondary").textContent;
    expect(firstSecondary).toContain("Before Level Up to 5");
    expect(firstSecondary).toContain("DATE(");
    // Restore button carries an accessible name identifying the snapshot.
    expect(rows[0].getAttribute("aria-label")).toBe("Restore Ada, level 4, DATE(2026-07-22T10:00:00Z)");
  });

  it("labels a deleted-source group and keeps its rows restorable", async () => {
    const snapshot = makeSnapshot({ id: "s1", sourceCharacterId: "char_gone", sourceName: "Ghost" });
    const state = makeState({ characters: { activeId: null, entries: [], snapshots: [snapshot] } });
    initDialog(state).api.open();
    await settle();
    expect(document.querySelector(".restoreCharacterGroupName").textContent).toBe("Ghost");
    expect(document.querySelector(".restoreCharacterGroupDeleted").textContent).toBe("(character deleted)");
    expect(rowButton("s1")).toBeTruthy();
  });

  it("renders a very long name/summary without truncating or altering stored data", async () => {
    const longName = "Aldarion the Everwandering Chronomancer of the Nineteen Spheres";
    const longSummary = "Wizard 11, Cleric 4, Fighter 3, Rogue 2, Warlock 1";
    const snapshot = makeSnapshot({ id: "s1", sourceName: longName, classSummary: longSummary, fromLevel: 21 });
    const state = makeState({ characters: { activeId: "char_a", entries: [{ id: "char_a", name: "x" }], snapshots: [snapshot] } });
    const before = JSON.stringify(snapshot);
    initDialog(state).api.open();
    await settle();
    expect(document.querySelector(".restoreCharacterRowPrimary").textContent).toBe(`Level 21 — ${longSummary}`);
    expect(document.querySelector(".restoreCharacterGroupName").textContent).toBe(longName);
    // Rendering never mutated the stored snapshot.
    expect(JSON.stringify(state.characters.snapshots[0])).toBe(before);
  });
});

/* ------------------------- confirmation + cancel ------------------------ */

describe("Restore Character dialog — confirmation", () => {
  function oneSnapshotState() {
    return makeState({
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Ada" }],
        snapshots: [makeSnapshot({ id: "s1", sourceName: "Ada", fromLevel: 3 })]
      }
    });
  }

  it("confirms before restoring, with the ratified non-destructive copy", async () => {
    const state = oneSnapshotState();
    const { restore, uiConfirm } = initDialog(state);
    dialogs[0].open();
    await settle();
    rowButton("s1").click();
    await settle();
    expect(uiConfirm).toHaveBeenCalledTimes(1);
    const [message, options] = uiConfirm.mock.calls[0];
    expect(options.title).toBe('Restore "Ada" as it was at Level 3?');
    expect(options.okText).toBe("Restore");
    expect(message).toContain("A separate playable character will be created");
    expect(message).toContain("Existing characters will not be changed");
    expect(message).toContain("snapshot will remain available");
    // Confirm resolved true → engine invoked with the snapshot id and activate.
    expect(restore).toHaveBeenCalledWith({ snapshotId: "s1", activate: true });
  });

  it("cancelling the confirmation performs no restore and no mutation", async () => {
    const state = oneSnapshotState();
    const snapshotsBefore = JSON.stringify(state.characters.snapshots);
    const entriesBefore = JSON.stringify(state.characters.entries);
    const { restore } = initDialog(state, { uiConfirm: vi.fn().mockResolvedValue(false) });
    dialogs[0].open();
    await settle();
    rowButton("s1").click();
    await settle();
    expect(restore).not.toHaveBeenCalled();
    expect(JSON.stringify(state.characters.snapshots)).toBe(snapshotsBefore);
    expect(JSON.stringify(state.characters.entries)).toBe(entriesBefore);
    // Dialog stays open and interactive after a cancel.
    expect(overlay().hidden).toBe(false);
    expect(rowButton("s1").disabled).toBe(false);
  });
});

/* --------------------- engine invocation + submission ------------------- */

describe("Restore Character dialog — submission guards", () => {
  it("passes the selected snapshot id and activate:true to the engine", async () => {
    const state = makeState({
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Ada" }],
        snapshots: [
          makeSnapshot({ id: "sA", createdAt: "2026-07-20T10:00:00Z" }),
          makeSnapshot({ id: "sB", createdAt: "2026-07-22T10:00:00Z" })
        ]
      }
    });
    const { restore } = initDialog(state);
    dialogs[0].open();
    await settle();
    rowButton("sA").click();
    await settle();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith({ snapshotId: "sA", activate: true });
  });

  it("does not redirect the restore when the active character changes while open", async () => {
    const state = makeState({
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Ada" }, { id: "char_b", name: "Bram" }],
        snapshots: [makeSnapshot({ id: "sA", sourceCharacterId: "char_a" })]
      }
    });
    const { restore } = initDialog(state);
    dialogs[0].open();
    await settle();
    // Active character changes underneath the dialog.
    state.characters.activeId = "char_b";
    rowButton("sA").click();
    await settle();
    expect(restore).toHaveBeenCalledWith({ snapshotId: "sA", activate: true });
  });

  it("prevents submission after the active campaign changes", async () => {
    const state = makeState({
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Ada" }],
        snapshots: [makeSnapshot({ id: "sA" })]
      }
    });
    const { restore, uiAlert } = initDialog(state);
    dialogs[0].open();
    await settle();
    state.appShell.activeCampaignId = "camp_2";
    rowButton("sA").click();
    await settle();
    expect(restore).not.toHaveBeenCalled();
    expect(uiAlert).toHaveBeenCalledTimes(1);
    expect(overlay().hidden).toBe(false);
  });

  it("shows an error and refreshes when the snapshot vanishes before submission", async () => {
    const state = makeState({
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Ada" }],
        snapshots: [makeSnapshot({ id: "sA" })]
      }
    });
    // Confirm resolves true, but the snapshot is removed during confirmation.
    const uiConfirm = vi.fn().mockImplementation(async () => {
      state.characters.snapshots = [];
      return true;
    });
    const { restore, uiAlert } = initDialog(state, { uiConfirm });
    dialogs[0].open();
    await settle();
    rowButton("sA").click();
    await settle();
    expect(restore).not.toHaveBeenCalled();
    expect(uiAlert).toHaveBeenCalled();
    expect(overlay().hidden).toBe(false);
    // List refreshed to the empty state without mutating a character.
    expect(emptyEl().hidden).toBe(false);
  });

  it("invokes the engine once for repeated clicks", async () => {
    const state = makeState({
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Ada" }],
        snapshots: [makeSnapshot({ id: "sA" })]
      }
    });
    // A slow restore so both clicks land while the first is in flight.
    let resolveRestore;
    const restore = vi.fn(() => new Promise((r) => { resolveRestore = r; }));
    initDialog(state, { restore });
    dialogs[0].open();
    await settle();
    rowButton("sA").click();
    rowButton("sA").click();
    rowButton("sA").click();
    await settle();
    expect(restore).toHaveBeenCalledTimes(1);
    resolveRestore({ characterId: "char_new", name: "Ada — Restored Level 3" });
    await settle();
  });
});

/* --------------------- errors before the engine commits ----------------- */

describe("Restore Character dialog — pre-commit errors", () => {
  it("keeps the dialog open and re-enables restore when a note/portrait copy fails", async () => {
    const state = makeState({
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Ada" }],
        snapshots: [makeSnapshot({ id: "sA" })]
      }
    });
    const restore = vi.fn().mockRejectedValue(new Error("Failed to copy spell notes."));
    const { uiAlert, finalizeRestore } = initDialog(state, { restore });
    dialogs[0].open();
    await settle();
    rowButton("sA").click();
    await settle();
    expect(uiAlert).toHaveBeenCalledWith("Failed to copy spell notes.", expect.any(Object));
    expect(overlay().hidden).toBe(false);
    expect(rowButton("sA").disabled).toBe(false);
    expect(finalizeRestore).not.toHaveBeenCalled();
  });
});

/* --------------------- persistence confirmation + retry ----------------- */

describe("Restore Character dialog — persistence confirmation", () => {
  function committedState() {
    return makeState({
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Ada" }],
        snapshots: [makeSnapshot({ id: "sA", fromLevel: 3 })]
      }
    });
  }

  it("finalizes once on a confirmed save: closes, announces the change, and no re-run", async () => {
    const state = committedState();
    const { restore, flushSave, finalizeRestore } = initDialog(state);
    dialogs[0].open();
    await settle();
    rowButton("sA").click();
    await settle();
    expect(flushSave).toHaveBeenCalledTimes(1);
    expect(overlay().hidden).toBe(true);
    expect(finalizeRestore).toHaveBeenCalledTimes(1);
    expect(finalizeRestore).toHaveBeenCalledWith({
      previousId: "char_a",
      characterId: "char_new",
      name: "Ada — Restored Level 3"
    });
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("does not close, rerender, or announce on an unconfirmed save; offers Retry Save", async () => {
    const state = committedState();
    const flushSave = vi.fn().mockResolvedValue(false);
    const { finalizeRestore } = initDialog(state, { flushSave });
    dialogs[0].open();
    await settle();
    rowButton("sA").click();
    await settle();
    expect(overlay().hidden).toBe(false);
    expect(finalizeRestore).not.toHaveBeenCalled();
    expect(pendingEl().hidden).toBe(false);
    expect(retryBtn().hidden).toBe(false);
    expect(retryBtn().disabled).toBe(false);
  });

  it("Retry Save retries only the save and finalizes exactly one restored character", async () => {
    const state = committedState();
    // A realistic engine: activate:true appends one entry and sets active.
    const restore = vi.fn(async ({ snapshotId }) => {
      const entry = { id: "char_new", name: "Ada — Restored Level 3", restoredFromSnapshotId: snapshotId };
      state.characters.entries.push(entry);
      state.characters.activeId = entry.id;
      return { characterId: entry.id, name: entry.name };
    });
    const flushSave = vi.fn()
      .mockResolvedValueOnce(false) // first save unconfirmed
      .mockResolvedValueOnce(true); // retry confirmed
    const { finalizeRestore } = initDialog(state, { restore, flushSave });
    dialogs[0].open();
    await settle();
    rowButton("sA").click();
    await settle();
    expect(retryBtn().hidden).toBe(false);

    retryBtn().click();
    await settle();
    expect(restore).toHaveBeenCalledTimes(1);         // engine never re-run
    expect(flushSave).toHaveBeenCalledTimes(2);        // only flush retried
    expect(finalizeRestore).toHaveBeenCalledTimes(1);
    expect(overlay().hidden).toBe(true);
    // Exactly one restored character exists.
    expect(state.characters.entries.filter((e) => e.id === "char_new")).toHaveLength(1);
  });

  it("blocks close, Escape, overlay click, and further restores after commit before save", async () => {
    const state = committedState();
    const flushSave = vi.fn().mockResolvedValue(false);
    const { restore } = initDialog(state, { flushSave });
    dialogs[0].open();
    await settle();
    rowButton("sA").click();
    await settle();
    expect(pendingEl().hidden).toBe(false);

    // Close button.
    closeBtn().click();
    expect(overlay().hidden).toBe(false);
    // Cancel button.
    cancelBtn().click();
    expect(overlay().hidden).toBe(false);
    // Escape.
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    expect(overlay().hidden).toBe(false);
    // Overlay click.
    overlay().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    // (jsdom: event.target is overlay only if dispatched on it)
    overlay().click();
    expect(overlay().hidden).toBe(false);
    // The engine is never called a second time.
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("never deletes or consumes a snapshot on a successful restore", async () => {
    const state = committedState();
    const snapshotsBefore = JSON.stringify(state.characters.snapshots);
    initDialog(state);
    dialogs[0].open();
    await settle();
    rowButton("sA").click();
    await settle();
    expect(JSON.stringify(state.characters.snapshots)).toBe(snapshotsBefore);
  });
});

/* ----------------------------- focus + close ---------------------------- */

describe("Restore Character dialog — focus and closing", () => {
  it("restores focus to the invoking control on an ordinary cancel", async () => {
    const state = makeState({
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Ada" }],
        snapshots: [makeSnapshot({ id: "sA" })]
      }
    });
    initDialog(state);
    const invoker = document.getElementById("charActionRestoreBtn");
    invoker.focus();
    dialogs[0].open();
    await settle();
    cancelBtn().click();
    await settle();
    expect(overlay().hidden).toBe(true);
    expect(document.activeElement).toBe(invoker);
  });

  it("traps Tab focus within the panel", async () => {
    const state = makeState({
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Ada" }],
        snapshots: [makeSnapshot({ id: "sA" })]
      }
    });
    initDialog(state);
    dialogs[0].open();
    await settle();
    const panel = document.getElementById("restoreCharacterPanel");
    const focusables = Array.from(panel.querySelectorAll("button:not([disabled])"));
    const last = focusables[focusables.length - 1];
    last.focus();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(focusables[0]);
  });

  it("stops responding after destroy (no listener multiplication across rerenders)", async () => {
    const state = makeState({
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Ada" }],
        snapshots: [makeSnapshot({ id: "sA" })]
      }
    });
    const { restore } = initDialog(state);
    dialogs[0].open();
    await settle();
    const stale = rowButton("sA");
    dialogs[0].destroy();
    expect(overlay().hidden).toBe(true);
    // A click on the now-detached controller's button does nothing.
    stale.click();
    await settle();
    expect(restore).not.toHaveBeenCalled();
  });
});
