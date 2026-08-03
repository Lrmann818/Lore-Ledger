// @vitest-environment jsdom
//
// Max-level spellbook correction wiring: mounts the REAL character page
// controller with the REAL Spells panel and the REAL correction flow, and
// proves the whole seam end to end — the Spells header ⋯ menu reaches the
// dialog, and Apply commits through the page's own canonical
// `createStateActions().mutateCharacter` with one dirty mark and one rerender.
//
// The flow's own decisions are covered by tests/spellbookChoices.test.js and
// the panel's menu by tests/spellsPanelOverflowMenu.test.js; what is under test
// here is that characterPage.js actually connects them.

import { afterEach, describe, expect, it, vi } from "vitest";

// Panels irrelevant to this wiring are stubbed so mounting stays cheap. The
// Spells panel and the correction flow are deliberately NOT stubbed.
vi.mock("../js/pages/character/panels/equipmentPanel.js", () => ({ initEquipmentPanel: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/panels/attackPanel.js", () => ({ initAttacksPanel: () => ({ destroy() {} }) }));
vi.mock("../js/pages/character/characterSectionReorder.js", () => ({ setupCharacterSectionReorder: () => ({ destroy() {} }) }));
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
vi.mock("../js/pages/character/restoreCharacterDialog.js", () => ({ initRestoreCharacterDialog: () => ({ open() {}, destroy() {} }) }));
vi.mock("../js/pages/character/completeChoicesFlow.js", () => ({ initCompleteChoicesFlow: () => ({ refresh() {}, open() {}, close() {}, destroy() {} }) }));

import { initCharacterPageUI, destroyActiveCharacterPageUI } from "../js/pages/character/characterPage.js";
import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { getActiveContentRegistry } from "../js/domain/rules/registry.js";
import { migrateState } from "../js/state.js";

const PAGE_HTML = `
  <section id="page-character">
    <select id="charSelector"></select>
    <span id="charBuilderModeBadge" hidden></span>
    <button type="button" id="charActionMenuBtn"></button>
    <div class="dropdownMenu charActionDropdownMenu" id="charActionDropdownMenu" hidden aria-hidden="true"></div>

    <section class="panel" id="charSpellsPanel">
      <div class="row between items-center spellsHeader">
        <h2 class="m0">Spells</h2>
        <div class="spellsOptionsDropdown" id="spellsOptionsDropdown">
          <button id="spellsOptionsBtn" type="button" class="moveBtn" aria-haspopup="true"
            aria-expanded="false" title="Spell options">&#8943;</button>
          <div class="spellsOptionsMenu" id="spellsOptionsMenu" hidden>
            <button type="button" class="swatchOption spellsOptionsItem" id="addSpellLevelBtn">Add spell level</button>
            <button type="button" class="swatchOption spellsOptionsItem" id="addSpellbookChoicesBtn">Add Spellbook Choices</button>
          </div>
        </div>
      </div>
      <div id="spellLevels" class="spellLevels"></div>
    </section>
  </section>

  <div id="spellbookChoicesOverlay" class="modalOverlay" hidden aria-hidden="true">
    <div class="modalPanel spellbookChoicesPanel" id="spellbookChoicesPanel" role="dialog" aria-modal="true"
      aria-labelledby="spellbookChoicesTitle" tabindex="-1">
      <div class="spellbookChoicesHeader">
        <div class="modalTitle" id="spellbookChoicesTitle">Add Spellbook Choices</div>
        <button type="button" id="spellbookChoicesClose" aria-label="Close">x</button>
      </div>
      <div class="spellbookChoicesScroll">
        <p class="spellbookChoicesIntro" id="spellbookChoicesIntro">intro</p>
        <div class="spellbookChoicesBody" id="spellbookChoicesBody"></div>
        <div class="spellbookChoicesStatus" id="spellbookChoicesStatus" role="status" hidden></div>
      </div>
      <div class="spellbookChoicesFooter">
        <button type="button" id="spellbookChoicesCancel">Cancel</button>
        <button type="button" id="spellbookChoicesApply">Apply</button>
      </div>
    </div>
  </div>
`;

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { await tick(); await tick(); await tick(); }

function classSpellIdsAtLevel(classId, spellLevel) {
  return getActiveContentRegistry().byKind.get("spell")
    .filter((entry) => Number(entry.data?.level) === spellLevel &&
      (entry.data?.classIds || []).includes(classId))
    .map((entry) => entry.id);
}

/** A level-20 wizard with an underfilled spellbook, at the level cap. */
function makeWizard20() {
  const character = makeDefaultBuilderCharacterEntry("Ada");
  character.id = "char_a";
  character.build.levels = Array.from({ length: 20 }, () => ({ classId: "wizard", hp: 5 }));
  character.build.abilities.base = { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 };
  character.build.spellcasting = {
    wizard: { cantripIds: [], knownIds: classSpellIdsAtLevel("wizard", 1).slice(0, 2), preparedIds: [] }
  };
  character.rest = { hitDiceSpent: {}, preparedByClass: { wizard: ["magic-missile"] } };
  return character;
}

function makeState(character) {
  return {
    appShell: { activeCampaignId: "camp_1" },
    characters: { activeId: character.id, entries: [character], snapshots: [] },
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
    getText: vi.fn().mockResolvedValue(""),
    putText: vi.fn(),
    deleteText: vi.fn(),
    dataUrlToBlob: vi.fn(),
    uiAlert: vi.fn().mockResolvedValue(undefined),
    uiConfirm: vi.fn().mockResolvedValue(true),
    uiPrompt: vi.fn(),
    setStatus: vi.fn(),
    enhanceNumberSteppers: vi.fn(),
    applyTextareaSize: vi.fn(),
    autoSizeInput: vi.fn(),
    textKey_spellNotes: (campaignId, spellId) => `spell_notes_${campaignId}__${spellId}`
  };
}

const overlay = () => document.getElementById("spellbookChoicesOverlay");
const body = () => document.getElementById("spellbookChoicesBody");
const boxes = () => Array.from(body().querySelectorAll("input[type=checkbox]"));

afterEach(() => {
  destroyActiveCharacterPageUI();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Add Spellbook Choices wiring", () => {
  it("reaches the dialog from the Spells menu and commits through the page mutation", async () => {
    document.body.innerHTML = PAGE_HTML;
    const character = makeWizard20();
    const state = makeState(character);
    const deps = makeDeps(state);
    const knownBefore = [...character.build.spellcasting.wizard.knownIds];
    const preparedBefore = JSON.parse(JSON.stringify(character.rest.preparedByClass));

    initCharacterPageUI(deps);
    await settle();

    // The panel got the correction handle and the item is offered.
    const item = document.getElementById("addSpellbookChoicesBtn");
    expect(item.hidden).toBe(false);

    item.click();
    await settle();
    expect(overlay().hidden).toBe(false);
    expect(body().querySelector(".builderSpellGroupCount").textContent)
      .toBe(`${knownBefore.length} / 44 in spellbook`);

    // Pick one and apply through the real page mutation path.
    const box = boxes()[0];
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("spellbookChoicesApply").click();
    await settle();

    const updated = state.characters.entries[0];
    expect(updated.build.spellcasting.wizard.knownIds).toHaveLength(knownBefore.length + 1);
    expect(updated.build.spellcasting.wizard.knownIds.slice(0, knownBefore.length))
      .toEqual(knownBefore);
    // One user action, one dirty mark.
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);
    // Prepared play-state and the acknowledgement record are untouched.
    expect(updated.rest.preparedByClass).toEqual(preparedBefore);
    expect(updated.underCapAckLevels).toBeUndefined();
    expect(state.characters.snapshots).toEqual([]);
    expect(overlay().hidden).toBe(true);

    // The new spell is on the canonical sheet, rendered by the Spells panel.
    const names = Array.from(document.querySelectorAll("#spellLevels input.spellName"))
      .map((el) => el.value)
      .filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
  });

  it("does not offer the action for a character below the level cap", async () => {
    document.body.innerHTML = PAGE_HTML;
    const character = makeWizard20();
    character.build.levels = Array.from({ length: 19 }, () => ({ classId: "wizard", hp: 5 }));
    const deps = makeDeps(makeState(character));

    initCharacterPageUI(deps);
    await settle();

    expect(document.getElementById("addSpellbookChoicesBtn").hidden).toBe(true);
    // Positive control: the add-level item is always offered.
    expect(document.getElementById("addSpellLevelBtn").hidden).toBe(false);
  });

  it("does not offer the action for a freeform character", async () => {
    document.body.innerHTML = PAGE_HTML;
    const character = makeWizard20();
    character.build = null;
    const deps = makeDeps(makeState(character));

    initCharacterPageUI(deps);
    await settle();

    expect(document.getElementById("addSpellbookChoicesBtn").hidden).toBe(true);
  });
});
