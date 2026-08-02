// @vitest-environment jsdom
//
// R5-B2, creation side: the cantrip / known-spell / wizard-spellbook pickers
// enforce the allowance the shared descriptors report.
//
// Before R5-B2 the generic group handler enforced nothing: a level-1 wizard
// could tick every cantrip on the list and the Summary would still describe the
// selection as "fewer than the maximum". These cases pin the fix, including the
// synthetic over-cap event that a rendered `disabled` attribute alone cannot
// stop, and the invariant that a chosen entry always stays removable.
//
// Every negative case carries a positive control, so none of them can pass
// merely because a group failed to render.

import { beforeEach, describe, expect, it } from "vitest";

import { makeDefaultCharacterBuild } from "../js/domain/characterHelpers.js";
import { renderSpellsStep } from "../js/pages/character/builderWizardSteps.js";
import { getUnderCapChoiceDescriptors, UNDER_CAP_KIND } from "../js/domain/rules/choiceCompletion.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;

function nLevels(classId, n) {
  return Array.from({ length: n }, () => ({ classId, hp: null }));
}

function makeBuild({
  levels = nLevels("wizard", 1),
  subclassByClass = {},
  abilities = { str: 10, dex: 10, con: 10, int: 16, wis: 16, cha: 16 },
  spellcasting = {}
} = {}) {
  const build = makeDefaultCharacterBuild();
  build.raceId = "human";
  build.backgroundId = "acolyte";
  build.levels = levels;
  build.subclassByClass = subclassByClass;
  build.abilities.base = abilities;
  build.spellcasting = spellcasting;
  return build;
}

function renderStep(build) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  renderSpellsStep({
    getDraft: () => ({ name: "Probe", build }),
    getRegistry: () => registry,
    signal: new AbortController().signal,
    enhanceSelect: () => {},
    onDraftChanged: () => {},
    getPreparedValidationMessage: () => ""
  }, container);
  return container;
}

function groupTitled(container, title) {
  return [...container.querySelectorAll(".builderSpellGroup")]
    .find((node) => node.querySelector(".builderSpellGroupTitle")?.textContent === title) || null;
}

function countText(groupEl) {
  return groupEl.querySelector(".builderSpellGroupCount")?.textContent || "";
}

function rows(groupEl) {
  return [...groupEl.querySelectorAll(".builderSpellCheckItem")].map((label) => ({
    name: (label.querySelector("span")?.textContent || "").replace(/ \((ritual|conc\.)\)/g, ""),
    input: label.querySelector("input"),
    row: label
  }));
}

function toggle(row, checked) {
  row.input.checked = checked;
  row.input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Bypasses the rendered `disabled` state the way a replayed event would. */
function forceCheck(row) {
  row.input.disabled = false;
  row.input.checked = true;
  row.input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

/* ------------------------------------------------------------------ */
/* Cantrips                                                            */
/* ------------------------------------------------------------------ */

describe("creation cantrip cap", () => {
  it("stops at the allowance and disables only the unchosen rows", () => {
    const build = makeBuild();
    const container = renderStep(build);
    const cantrips = groupTitled(container, "Cantrips");
    expect(countText(cantrips)).toBe("0 / 3 known");
    // Positive control: a real candidate list, longer than the allowance.
    expect(rows(cantrips).length).toBeGreaterThan(4);

    const all = rows(cantrips);
    for (let i = 0; i < 5; i += 1) toggle(all[i], true);
    expect(build.spellcasting.wizard.cantripIds).toHaveLength(3);
    expect(countText(cantrips)).toBe("3 / 3 known");

    const after = rows(cantrips);
    expect(after.filter((row) => row.input.checked)).toHaveLength(3);
    for (const row of after) {
      expect(row.input.disabled).toBe(!row.input.checked);
      expect(row.row.classList.contains("isDisabled")).toBe(!row.input.checked);
    }
  });

  it("refuses a synthetic over-cap change event and restores the rendered state", () => {
    const build = makeBuild();
    const container = renderStep(build);
    const cantrips = groupTitled(container, "Cantrips");
    const all = rows(cantrips);
    for (let i = 0; i < 3; i += 1) toggle(all[i], true);
    expect(build.spellcasting.wizard.cantripIds).toHaveLength(3);

    const blocked = rows(cantrips).find((row) => !row.input.checked);
    // Positive control: the row exists and the picker did disable it.
    expect(blocked.input.disabled).toBe(true);
    forceCheck(blocked);
    expect(build.spellcasting.wizard.cantripIds).toHaveLength(3);
    // The DOM never disagrees with the draft.
    expect(rows(cantrips).find((row) => row.name === blocked.name).input.checked).toBe(false);
  });

  it("keeps a chosen cantrip removable at the cap and re-opens the alternatives", () => {
    const build = makeBuild();
    const container = renderStep(build);
    const cantrips = groupTitled(container, "Cantrips");
    const all = rows(cantrips);
    for (let i = 0; i < 3; i += 1) toggle(all[i], true);
    const blockedName = rows(cantrips).find((row) => !row.input.checked).name;

    toggle(rows(cantrips).find((row) => row.name === all[0].name), false);
    expect(build.spellcasting.wizard.cantripIds).toHaveLength(2);
    expect(countText(cantrips)).toBe("2 / 3 known");
    expect(rows(cantrips).find((row) => row.name === blockedName).input.disabled).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Wizard spellbook                                                    */
/* ------------------------------------------------------------------ */

describe("creation spellbook cap", () => {
  it("shows the allowance in its label and enforces it", () => {
    const build = makeBuild({ levels: nLevels("wizard", 2) });
    const container = renderStep(build);
    const spellbook = groupTitled(container, "Spellbook");
    // 6 to start, +2 per wizard level after the first.
    expect(countText(spellbook)).toBe("0 / 8 in spellbook (start with 6, +2 per wizard level)");

    const all = rows(spellbook);
    expect(all.length).toBeGreaterThan(9); // positive control
    for (let i = 0; i < 10; i += 1) toggle(all[i], true);
    expect(build.spellcasting.wizard.knownIds).toHaveLength(8);
    expect(countText(spellbook)).toBe("8 / 8 in spellbook (start with 6, +2 per wizard level)");
    expect(getUnderCapChoiceDescriptors(build, registry)
      .find((entry) => entry.kind === UNDER_CAP_KIND.SPELLBOOK).satisfied).toBe(true);
  });

  it("frees a slot again when a spellbook spell is removed", () => {
    const build = makeBuild({ levels: nLevels("wizard", 1) });
    const container = renderStep(build);
    const spellbook = groupTitled(container, "Spellbook");
    const all = rows(spellbook);
    for (let i = 0; i < 6; i += 1) toggle(all[i], true);
    expect(build.spellcasting.wizard.knownIds).toHaveLength(6);

    toggle(rows(spellbook).find((row) => row.name === all[0].name), false);
    expect(build.spellcasting.wizard.knownIds).toHaveLength(5);
    const blocked = rows(spellbook).find((row) => !row.input.checked);
    expect(blocked.input.disabled).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Known spells and non-regression                                     */
/* ------------------------------------------------------------------ */

describe("creation known-spell cap", () => {
  it("enforces the class table's known allowance", () => {
    const build = makeBuild({
      levels: nLevels("bard", 2),
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16 }
    });
    const container = renderStep(build);
    const known = groupTitled(container, "Known Spells");
    expect(countText(known)).toBe("0 / 5 known");
    const all = rows(known);
    expect(all.length).toBeGreaterThan(6); // positive control
    for (let i = 0; i < 7; i += 1) toggle(all[i], true);
    expect(build.spellcasting.bard.knownIds).toHaveLength(5);
  });

  it("leaves the prepared group's own capacity rules untouched", () => {
    // A prepared caster has no known/spellbook category, and its prepared group
    // keeps reporting the effective capacity C1 owns — not an under-cap count.
    const build = makeBuild({
      levels: nLevels("cleric", 1),
      subclassByClass: { cleric: "life" },
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 }
    });
    const container = renderStep(build);
    expect(groupTitled(container, "Known Spells")).toBeNull();
    expect(groupTitled(container, "Spellbook")).toBeNull();
    const prepared = groupTitled(container, "Prepared Spells");
    expect(countText(prepared)).toBe("0 / 4 prepared");
  });

  it("leaves a class with no derivable allowance uncapped rather than guessing one", () => {
    // Paladin 1 is not yet a spellcaster; Ranger/Paladin have no cantrip table
    // at all, so no cantrip descriptor exists and no cap is invented.
    const build = makeBuild({
      levels: nLevels("ranger", 2),
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 16, cha: 10 }
    });
    const container = renderStep(build);
    expect(groupTitled(container, "Cantrips")).toBeTruthy(); // rendered, but empty
    expect(rows(groupTitled(container, "Cantrips"))).toHaveLength(0);
    const known = groupTitled(container, "Known Spells");
    expect(countText(known)).toBe("0 / 2 known"); // positive control: ranger 2 knows 2
  });
});
