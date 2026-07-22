// @vitest-environment jsdom
//
// Restore Character wiring (R3): mounts the real character page controller and
// proves the menu action opens the dialog and that a confirmed row restore
// calls the R2 engine (restoreCharacterFromSnapshot) with the FULL canonical
// dependency set — migration boundary, live state, mutation, and every blob /
// text storage seam — plus `activate: true`; and that a confirmed save
// finalizes exactly once (active-character notification + success status).
//
// The engine itself is exercised by tests/characterSnapshots.restore.test.js;
// here it is mocked so the wiring (not the engine internals) is under test.

import { afterEach, describe, expect, it, vi } from "vitest";

// Panels are irrelevant to this wiring; stub them so mounting is cheap.
vi.mock("../js/pages/character/panels/equipmentPanel.js", () => ({ initEquipmentPanel: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/panels/attackPanel.js", () => ({ initAttacksPanel: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/characterSectionReorder.js", () => ({ setupCharacterSectionReorder: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/panels/spellsPanel.js", () => ({ initSpellsPanel: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/panels/vitalsPanel.js", () => ({ initVitalsPanel: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/panels/basicsPanel.js", () => ({ initBasicsPanel: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/panels/proficienciesPanel.js", () => ({ initProficienciesPanel: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/panels/abilitiesPanel.js", () => ({ initAbilitiesPanel: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/panels/abilitiesFeaturesPanel.js", () => ({ initAbilitiesFeaturesPanel: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/panels/personalityPanel.js", () => ({
  initPersonalityPanel: () => ({ destroy() {} }),
  setupCharacterCollapsibleTextareas: () => ({ destroy() {} })
}));
vi.mock("../js/pages/character/panels/builderIdentityPanel.js", () => ({ initBuilderIdentityPanel: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/panels/builderAbilitiesPanel.js", () => ({ initBuilderAbilitiesPanel: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/panels/builderSummaryPanel.js", () => ({ initBuilderSummaryPanel: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/builderWizard.js", () => ({ initBuilderWizard: () => ({ open() {}, destroy() {} }) }));
vi.mock("../js/pages/character/levelUpWizard.js", () => ({ initLevelUpWizard: () => ({ open() {}, close() {}, destroy() {} }) }));

// Keep the real snapshot module except for the engine orchestrator.
vi.mock("../js/domain/characterSnapshots.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, restoreCharacterFromSnapshot: vi.fn() };
});

import { initCharacterPageUI, destroyActiveCharacterPageUI } from "../js/pages/character/characterPage.js";
import { restoreCharacterFromSnapshot } from "../js/domain/characterSnapshots.js";
import { migrateState } from "../js/state.js";
import { ACTIVE_CHARACTER_CHANGED_EVENT } from "../js/domain/characterEvents.js";

const MENU_HTML = `
  <section id="page-character">
    <select id="charSelector"></select>
    <span id="charBuilderModeBadge" hidden></span>
    <button type="button" id="charActionMenuBtn"></button>
    <div class="dropdownMenu charActionDropdownMenu" id="charActionDropdownMenu" hidden aria-hidden="true">
      <button type="button" class="swatchOption charActionMenuItem" data-char-action="level-up">Level Up</button>
      <button type="button" class="swatchOption charActionMenuItem" id="charActionRestoreBtn"
        data-char-action="restore-character">Restore Character</button>
    </div>
  </section>
  <div id="restoreCharacterOverlay" class="modalOverlay" hidden aria-hidden="true">
    <div class="modalPanel restoreCharacterPanel" id="restoreCharacterPanel" role="dialog" aria-modal="true"
      aria-labelledby="restoreCharacterTitle" tabindex="-1">
      <div class="restoreCharacterHeader">
        <div class="modalTitle" id="restoreCharacterTitle">Restore Character</div>
        <button type="button" id="restoreCharacterClose" aria-label="Close">✕</button>
      </div>
      <div class="restoreCharacterBody" id="restoreCharacterBody">
        <p class="restoreCharacterIntro" id="restoreCharacterIntro">intro</p>
        <div class="restoreCharacterEmpty" id="restoreCharacterEmpty" hidden>empty</div>
        <div class="restoreCharacterList" id="restoreCharacterList"></div>
        <div class="restoreCharacterPending" id="restoreCharacterPending" role="alert" hidden>
          <p class="restoreCharacterPendingMsg" id="restoreCharacterPendingMsg"></p>
        </div>
      </div>
      <div class="restoreCharacterFooter">
        <button type="button" id="restoreCharacterRetrySave" hidden>Retry Save</button>
        <button type="button" id="restoreCharacterCancel">Close</button>
      </div>
    </div>
  </div>
`;

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { await tick(); await tick(); await tick(); }

function makeSnapshot() {
  return {
    id: "sA",
    kind: "pre-level-up",
    sourceCharacterId: "char_a",
    sourceName: "Ada",
    classSummary: "Wizard 3",
    fromLevel: 3,
    toLevel: 4,
    toClassId: "wizard",
    createdAt: "2026-07-20T10:00:00.000Z",
    schemaVersion: 13,
    payload: { id: "char_a", name: "Ada", build: {}, spells: { levels: [] } }
  };
}

function makeState() {
  return {
    appShell: { activeCampaignId: "camp_1" },
    characters: {
      activeId: "char_a",
      entries: [{ id: "char_a", name: "Ada" }],
      snapshots: [makeSnapshot()]
    },
    tracker: { npcs: [], party: [], locationsList: [], npcActiveSectionId: "n", partyActiveSectionId: "p" },
    combat: { workspace: {} }
  };
}

function makeDeps(state) {
  return {
    state,
    SaveManager: { markDirty: vi.fn(), flush: vi.fn().mockResolvedValue(true) },
    Popovers: null,
    migrateState,
    getBlob: vi.fn(),
    putBlob: vi.fn(),
    deleteBlob: vi.fn(),
    getText: vi.fn(),
    putText: vi.fn(),
    deleteText: vi.fn(),
    dataUrlToBlob: vi.fn(),
    uiAlert: vi.fn().mockResolvedValue(undefined),
    uiConfirm: vi.fn().mockResolvedValue(true),
    uiPrompt: vi.fn(),
    setStatus: vi.fn()
  };
}

afterEach(() => {
  destroyActiveCharacterPageUI();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Restore Character wiring", () => {
  it("supplies the full engine dependency set and finalizes on a confirmed save", async () => {
    document.body.innerHTML = MENU_HTML;
    const state = makeState();
    const deps = makeDeps(state);
    restoreCharacterFromSnapshot.mockResolvedValue({ characterId: "char_new", name: "Ada — Restored Level 3" });

    /** @type {any[]} */
    const activeChangeEvents = [];
    const onChange = (e) => activeChangeEvents.push(e.detail);
    window.addEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, onChange);

    try {
      initCharacterPageUI(deps);

      // Open the dialog through the real action menu.
      document.getElementById("charActionRestoreBtn").click();
      await settle();
      expect(document.getElementById("restoreCharacterOverlay").hidden).toBe(false);

      // Confirmed restore of the rendered row.
      document.querySelector('[data-snapshot-id="sA"]').click();
      await settle();

      expect(restoreCharacterFromSnapshot).toHaveBeenCalledTimes(1);
      const arg = restoreCharacterFromSnapshot.mock.calls[0][0];
      expect(arg.snapshotId).toBe("sA");
      expect(arg.activate).toBe(true);
      expect(arg.migrateState).toBe(migrateState);
      expect(arg.state).toBe(state);
      expect(arg.SaveManager).toBe(deps.SaveManager);
      expect(typeof arg.mutateState).toBe("function");
      expect(arg.getBlob).toBe(deps.getBlob);
      expect(arg.putBlob).toBe(deps.putBlob);
      expect(arg.deleteBlob).toBe(deps.deleteBlob);
      expect(arg.getText).toBe(deps.getText);
      expect(arg.putText).toBe(deps.putText);
      expect(arg.deleteText).toBe(deps.deleteText);

      // Confirmed save → flush, notify once, success status; dialog closed.
      expect(deps.SaveManager.flush).toHaveBeenCalledTimes(1);
      expect(document.getElementById("restoreCharacterOverlay").hidden).toBe(true);
      expect(activeChangeEvents).toEqual([{ previousId: "char_a", activeId: "char_new" }]);
      expect(deps.setStatus).toHaveBeenCalledWith('Restored "Ada — Restored Level 3"', expect.any(Object));
    } finally {
      window.removeEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, onChange);
    }
  });

  it("does not finalize or notify when the save is not confirmed", async () => {
    document.body.innerHTML = MENU_HTML;
    const state = makeState();
    const deps = makeDeps(state);
    deps.SaveManager.flush = vi.fn().mockResolvedValue(false);
    restoreCharacterFromSnapshot.mockResolvedValue({ characterId: "char_new", name: "Ada — Restored Level 3" });

    /** @type {any[]} */
    const activeChangeEvents = [];
    const onChange = (e) => activeChangeEvents.push(e.detail);
    window.addEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, onChange);

    try {
      initCharacterPageUI(deps);
      document.getElementById("charActionRestoreBtn").click();
      await settle();
      document.querySelector('[data-snapshot-id="sA"]').click();
      await settle();

      expect(restoreCharacterFromSnapshot).toHaveBeenCalledTimes(1);
      expect(deps.SaveManager.flush).toHaveBeenCalledTimes(1);
      // Locked open: no notify, no success status, Retry Save available.
      expect(document.getElementById("restoreCharacterOverlay").hidden).toBe(false);
      expect(activeChangeEvents).toEqual([]);
      expect(document.getElementById("restoreCharacterRetrySave").hidden).toBe(false);
      expect(deps.setStatus).not.toHaveBeenCalledWith('Restored "Ada — Restored Level 3"', expect.any(Object));
    } finally {
      window.removeEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, onChange);
    }
  });
});
