// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSpellsPanel } from "../js/pages/character/panels/spellsPanel.js";
import { enhanceNumberSteppers } from "../js/features/numberSteppers.js";
import { getActiveCharacter } from "../js/domain/characterHelpers.js";

/**
 * Builds a minimal state with a single active character whose spell levels are
 * the provided array. Matches the v2 spells shape consumed by the panel.
 */
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
  const api = initSpellsPanel({
    state,
    SaveManager,
    enhanceNumberSteppers
  });
  return { api, SaveManager };
}

/** Returns the per-level "Reset" button for the Nth rendered level. */
function getResetButton(levelIndex = 0) {
  const actions = document.querySelectorAll("#spellLevels .spellLevelActions");
  const buttons = Array.from(actions[levelIndex]?.querySelectorAll("button") || []);
  return buttons.find((btn) => btn.textContent.trim() === "Reset") || null;
}

let panels = [];

afterEach(() => {
  panels.forEach((api) => api?.destroy?.());
  panels = [];
  document.body.innerHTML = "";
});

describe("spell slot reset", () => {
  it("copies max (total) into current (used) and clears cast flags", () => {
    setupDom();
    const state = makeState([
      {
        id: "lvl1",
        label: "1st Level",
        hasSlots: true,
        used: 1,
        total: 4,
        collapsed: false,
        spells: [
          { id: "sp1", name: "Magic Missile", expended: true, known: true, prepared: false, notesCollapsed: true }
        ]
      }
    ]);
    const { api, SaveManager } = initPanel(state);
    panels.push(api);

    const resetBtn = getResetButton(0);
    expect(resetBtn).toBeTruthy();

    resetBtn.click();

    const level = getActiveCharacter(state).spells.levels[0];
    expect(level.used).toBe(4);
    expect(level.total).toBe(4);
    expect(level.spells[0].expended).toBe(false);
    expect(SaveManager.markDirty).toHaveBeenCalled();
  });

  it("handles a blank max safely (current clears to null, no NaN)", () => {
    setupDom();
    const state = makeState([
      { id: "lvl1", label: "1st Level", hasSlots: true, used: 3, total: null, collapsed: false, spells: [] }
    ]);
    const { api } = initPanel(state);
    panels.push(api);

    getResetButton(0).click();

    const level = getActiveCharacter(state).spells.levels[0];
    expect(level.used).toBeNull();
    expect(Number.isNaN(level.used)).toBe(false);
  });

  it("handles a zero max safely (current becomes 0)", () => {
    setupDom();
    const state = makeState([
      { id: "lvl1", label: "1st Level", hasSlots: true, used: 5, total: 0, collapsed: false, spells: [] }
    ]);
    const { api } = initPanel(state);
    panels.push(api);

    getResetButton(0).click();

    expect(getActiveCharacter(state).spells.levels[0].used).toBe(0);
  });

  it("leaves slot-less (cantrip) levels' slot fields untouched but still clears cast flags", () => {
    setupDom();
    const state = makeState([
      {
        id: "lvl0",
        label: "Cantrips",
        hasSlots: false,
        used: null,
        total: null,
        collapsed: false,
        spells: [{ id: "c1", name: "Fire Bolt", expended: true, known: true, prepared: false, notesCollapsed: true }]
      }
    ]);
    const { api } = initPanel(state);
    panels.push(api);

    getResetButton(0).click();

    const level = getActiveCharacter(state).spells.levels[0];
    expect(level.used).toBeNull();
    expect(level.spells[0].expended).toBe(false);
  });
});

describe("number stepper controls", () => {
  it("increments and decrements the input value when the stepper buttons are clicked", async () => {
    setupDom();
    const host = document.getElementById("spellLevels");
    const input = document.createElement("input");
    input.type = "number";
    input.value = "2";
    host.appendChild(input);

    await enhanceNumberSteppers(host);

    const wrap = input.closest(".numWrap");
    expect(wrap).toBeTruthy();
    const stepBtns = wrap.querySelectorAll(".numStepBtn");
    expect(stepBtns.length).toBe(2);
    const [up, down] = stepBtns;

    up.click();
    expect(input.value).toBe("3");

    down.click();
    down.click();
    expect(input.value).toBe("1");
  });

  it("fires an input event so bound save/state wiring stays in sync", async () => {
    setupDom();
    const host = document.getElementById("spellLevels");
    const input = document.createElement("input");
    input.type = "number";
    input.value = "0";
    host.appendChild(input);

    const onInput = vi.fn();
    input.addEventListener("input", onInput);

    await enhanceNumberSteppers(host);
    const up = host.querySelector(".numStepBtn");
    up.click();

    expect(input.value).toBe("1");
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it("does not double-wrap an input that already has a stepper", async () => {
    setupDom();
    const host = document.getElementById("spellLevels");
    const input = document.createElement("input");
    input.type = "number";
    input.value = "1";
    host.appendChild(input);

    await enhanceNumberSteppers(host);
    await enhanceNumberSteppers(host);

    expect(host.querySelectorAll(".numWrap").length).toBe(1);
    expect(host.querySelectorAll(".numStepper").length).toBe(1);
  });
});

describe("stepper touch-safety contract (styles.css)", () => {
  it("keeps the steppers visible and tappable on coarse/touch pointers", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

    // A coarse/no-hover media block must re-enable the steppers that are hidden
    // (opacity:0; pointer-events:none) by default for the desktop hover reveal.
    const coarseBlock = css.match(
      /@media \(hover: none\), \(pointer: coarse\) \{[\s\S]*?\n\}/
    );
    expect(coarseBlock, "expected a coarse/touch pointer media block").toBeTruthy();
    const block = coarseBlock[0];
    expect(block).toContain(".numStepper");
    expect(block).toMatch(/pointer-events:\s*auto/);
    expect(block).toMatch(/opacity:\s*1/);
  });
});
