// @vitest-environment jsdom
// B2 spell detail seeding: builder-managed spell rows (stable builderSpellId
// marker) show a live-derived SRD detail block above the user-owned notes
// textarea. Details resolve from the registry at render time — never copied
// into character state — and manual rows render no block.

import { afterEach, describe, expect, it, vi } from "vitest";

import { initSpellsPanel } from "../js/pages/character/panels/spellsPanel.js";
import { enhanceNumberSteppers } from "../js/features/numberSteppers.js";
import { getActiveCharacter } from "../js/domain/characterHelpers.js";

function makeState(levels) {
  return {
    appShell: { activeCampaignId: "camp1" },
    characters: {
      activeId: "c1",
      entries: [{ id: "c1", name: "Tester", spells: { levels } }]
    }
  };
}

function setupDom() {
  document.body.innerHTML = `
    <section class="panel" id="charSpellsPanel">
      <div id="spellLevels"></div>
      <button id="addSpellLevelBtn" type="button">+ Level</button>
    </section>
  `;
}

function initPanel(state) {
  const SaveManager = { markDirty: vi.fn() };
  const api = initSpellsPanel({ state, SaveManager, enhanceNumberSteppers });
  return { api, SaveManager };
}

function spellLevelRow(spells) {
  return [{
    id: "lvl3",
    label: "3rd Level",
    hasSlots: true,
    used: 1,
    total: 1,
    collapsed: false,
    spells
  }];
}

let panels = [];

afterEach(() => {
  panels.forEach((api) => api?.destroy?.());
  panels = [];
  document.body.innerHTML = "";
});

describe("spell SRD details", () => {
  it("shows the full SRD detail block for an expanded builder-managed spell", () => {
    setupDom();
    const state = makeState(spellLevelRow([
      {
        id: "sp1", name: "Fireball", notesCollapsed: false,
        known: true, prepared: true, expended: false,
        builderSpellId: "fireball"
      }
    ]));
    const { api } = initPanel(state);
    panels.push(api);

    const details = document.querySelector(".spellSrdDetails");
    expect(details).toBeTruthy();
    expect(details.querySelector(".spellSrdHead").textContent).toBe("Level 3 Evocation");
    const metaText = details.querySelector(".spellSrdMeta").textContent;
    expect(metaText).toContain("Casting Time1 action");
    expect(metaText).toContain("Range150 feet");
    expect(metaText).toContain("ComponentsV, S, M (A tiny ball of bat guano and sulfur.)");
    expect(metaText).toContain("DurationInstantaneous");
    expect(details.querySelector(".spellSrdDesc").textContent).toContain("20-foot-radius sphere");
    expect(details.querySelector(".spellSrdHigher").textContent)
      .toContain("At Higher Levels. When you cast this spell using a spell slot of 4th level");
    // The user-owned notes textarea still renders below the details.
    expect(document.querySelector(".spellNotes textarea")).toBeTruthy();
  });

  it("marks ritual and concentration spells in the head line", () => {
    setupDom();
    const state = makeState(spellLevelRow([
      {
        id: "sp1", name: "Detect Magic", notesCollapsed: false,
        known: true, prepared: false, expended: false,
        builderSpellId: "detect-magic"
      }
    ]));
    const { api } = initPanel(state);
    panels.push(api);

    const head = document.querySelector(".spellSrdHead").textContent;
    expect(head).toContain("Ritual");
    expect(head).toContain("Concentration");
  });

  it("labels cantrips by school", () => {
    setupDom();
    const state = makeState([{
      id: "lvl0", label: "Cantrips", hasSlots: false, used: null, total: null, collapsed: false,
      spells: [{
        id: "sp1", name: "Fire Bolt", notesCollapsed: false,
        known: true, prepared: false, expended: false,
        builderSpellId: "fire-bolt"
      }]
    }]);
    const { api } = initPanel(state);
    panels.push(api);

    expect(document.querySelector(".spellSrdHead").textContent).toBe("Evocation cantrip");
  });

  it("renders no detail block for manual spells or unknown registry ids", () => {
    setupDom();
    const state = makeState(spellLevelRow([
      {
        id: "sp1", name: "My Homebrew Zap", notesCollapsed: false,
        known: true, prepared: false, expended: false
      },
      {
        id: "sp2", name: "Ghost Spell", notesCollapsed: false,
        known: true, prepared: false, expended: false,
        builderSpellId: "not-a-real-spell"
      }
    ]));
    const { api } = initPanel(state);
    panels.push(api);

    expect(document.querySelectorAll(".spellSrdDetails")).toHaveLength(0);
    // Both rows still render their notes textareas normally.
    expect(document.querySelectorAll(".spellNotes textarea")).toHaveLength(2);
  });

  it("shows no details while the row is collapsed and never writes state", () => {
    setupDom();
    const levels = spellLevelRow([
      {
        id: "sp1", name: "Fireball", notesCollapsed: true,
        known: true, prepared: true, expended: false,
        builderSpellId: "fireball"
      }
    ]);
    const state = makeState(levels);
    const before = JSON.stringify(getActiveCharacter(state).spells);
    const { api, SaveManager } = initPanel(state);
    panels.push(api);

    expect(document.querySelectorAll(".spellSrdDetails")).toHaveLength(0);
    expect(JSON.stringify(getActiveCharacter(state).spells)).toBe(before);
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
  });
});
