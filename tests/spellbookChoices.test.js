// @vitest-environment jsdom
// Max-level spellbook correction ("Add Spellbook Choices").
//
// A character at MAX_CHARACTER_LEVEL can never Level Up again, so R5-B2's Level
// Up opportunity can never offer its unused spellbook allowance. This flow is
// that allowance's replacement home. What is pinned here:
//
//   1. Eligibility is exactly the three live conditions (builder, at the level
//      cap, at least one unsatisfied spellbook descriptor) and is driven by
//      registry-backed descriptors, never by a hard-coded "wizard".
//   2. The candidate ceiling is the class's OWN maxSpellLevel from the shared
//      prepared plan — never the combined multiclass slot array. A Wizard 1 /
//      Cleric 19 has 9th-level combined slots and may still only add 1st-level
//      wizard spells.
//   3. Allowance and counts come from the same choice-completion descriptor the
//      creation Summary and both wizards count against.
//   4. Apply is additive-only, guarded, and spells-only: one mutation, one
//      dirty mark, one rerender, and prepared state / acknowledgements /
//      snapshots / unrelated fields are byte-identical.
//
// Every negative case carries a positive control, so none of them can pass
// because the dialog simply failed to render.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSpellbookCorrectionTargets,
  initSpellbookChoicesFlow
} from "../js/pages/character/spellbookChoicesFlow.js";
import { initSpellsPanel } from "../js/pages/character/panels/spellsPanel.js";
import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { getUnderCapChoiceDescriptors, UNDER_CAP_KIND } from "../js/domain/rules/choiceCompletion.js";
import { getPreparedSpellPlan } from "../js/domain/rules/preparedSpells.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import { getActiveContentRegistry, setActiveCustomContent } from "../js/domain/rules/registry.js";

const registry = () => getActiveContentRegistry();

/** Spell ids on one class's list at exactly one spell level. */
function classSpellIdsAtLevel(classId, spellLevel) {
  return registry().byKind.get("spell")
    .filter((entry) => Number(entry.data?.level) === spellLevel &&
      (entry.data?.classIds || []).includes(classId))
    .map((entry) => entry.id);
}

/**
 * A builder character whose levels are the supplied `[classId, count]` pairs,
 * in order, with a usable spellcasting ability.
 */
function makeCharacter(levelPairs, { spellcasting = {}, name = "Tester" } = {}) {
  const character = makeDefaultBuilderCharacterEntry(name);
  character.build.levels = levelPairs.flatMap(([classId, count]) =>
    Array.from({ length: count }, () => ({ classId, hp: 5 })));
  character.build.abilities.base = { str: 10, dex: 10, con: 10, int: 16, wis: 16, cha: 16 };
  character.build.spellcasting = spellcasting;
  character.rest = { hitDiceSpent: {}, preparedByClass: {} };
  return character;
}

/** A level-20 wizard whose spellbook holds `filled` real 1st-level spells. */
function wizard20({ filled = 3 } = {}) {
  const knownIds = classSpellIdsAtLevel("wizard", 1).slice(0, filled);
  return makeCharacter([["wizard", 20]], {
    spellcasting: { wizard: { cantripIds: [], knownIds, preparedIds: [] } }
  });
}

function spellbookDescriptor(build, classId) {
  return getUnderCapChoiceDescriptors(build, registry())
    .find((entry) => entry.classId === classId && entry.kind === UNDER_CAP_KIND.SPELLBOOK) || null;
}

/* ------------------------------------------------------------------ */
/* Eligibility                                                         */
/* ------------------------------------------------------------------ */

describe("spellbook correction eligibility", () => {
  afterEach(() => setActiveCustomContent([]));

  it("offers a level-20 wizard with an underfilled spellbook", () => {
    const targets = getSpellbookCorrectionTargets(wizard20({ filled: 3 }), registry());

    expect(targets).toHaveLength(1);
    expect(targets[0].classId).toBe("wizard");
    // 6 to start, +2 per wizard level after the first.
    expect(targets[0].allowed).toBe(44);
    expect(targets[0].chosen).toBe(3);
    expect(targets[0].remaining).toBe(41);
    expect(targets[0].resolvable).toBe(true);
  });

  it("offers nothing for a freeform character", () => {
    const freeform = wizard20({ filled: 3 });
    freeform.build = null;
    expect(getSpellbookCorrectionTargets(freeform, registry())).toEqual([]);
  });

  it("offers nothing for a non-spellbook caster at the level cap", () => {
    const cleric = makeCharacter([["cleric", 20]], {
      spellcasting: { cleric: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });
    // Positive control: the cleric really is a max-level prepared caster.
    expect(getPreparedSpellPlan(cleric, registry())[0].classId).toBe("cleric");
    expect(getSpellbookCorrectionTargets(cleric, registry())).toEqual([]);
  });

  it("offers nothing below the level cap, where Level Up still can", () => {
    const wizard19 = makeCharacter([["wizard", 19]], {
      spellcasting: { wizard: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });
    // Positive control: the shortfall exists — it is simply not stranded yet.
    expect(spellbookDescriptor(wizard19.build, "wizard").satisfied).toBe(false);
    expect(getSpellbookCorrectionTargets(wizard19, registry())).toEqual([]);
  });

  it("offers nothing once the spellbook is full", () => {
    const full = wizard20({ filled: 0 });
    const allIds = [
      ...classSpellIdsAtLevel("wizard", 1),
      ...classSpellIdsAtLevel("wizard", 2),
      ...classSpellIdsAtLevel("wizard", 3)
    ].slice(0, 44);
    expect(allIds).toHaveLength(44);
    full.build.spellcasting.wizard.knownIds = allIds;

    expect(spellbookDescriptor(full.build, "wizard").satisfied).toBe(true);
    expect(getSpellbookCorrectionTargets(full, registry())).toEqual([]);
  });

  it("offers a multiclass Wizard 5 / Fighter 15 its own smaller allowance", () => {
    const character = makeCharacter([["wizard", 5], ["fighter", 15]], {
      spellcasting: { wizard: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });
    const targets = getSpellbookCorrectionTargets(character, registry());

    expect(targets).toHaveLength(1);
    // 6 + 2 * 4 wizard levels after the first — not a level-20 allowance.
    expect(targets[0].allowed).toBe(14);
  });
});

/* ------------------------------------------------------------------ */
/* Class-specific ceiling                                              */
/* ------------------------------------------------------------------ */

describe("spellbook correction candidate ceiling", () => {
  afterEach(() => setActiveCustomContent([]));

  it("bounds a Wizard 1 / Cleric 19 at 1st level despite 9th-level combined slots", () => {
    const character = makeCharacter([["wizard", 1], ["cleric", 19]], {
      spellcasting: {
        wizard: { cantripIds: [], knownIds: [], preparedIds: [] },
        cleric: { cantripIds: [], knownIds: [], preparedIds: [] }
      }
    });

    // Positive control for the hazard, measured directly rather than assumed:
    // the character's COMBINED multiclass slot array really does reach 9th
    // level, so a combined-slot ceiling would have offered 9th-level wizard
    // spells. This is the exact value the pre-correction design would have used.
    const combinedSlots = deriveCharacter(character, registry()).spellcasting.slots;
    const combinedCeiling = combinedSlots.reduce(
      (max, count, index) => (count > 0 ? index + 1 : max), 0
    );
    expect(combinedCeiling).toBe(9);

    const wizardPlan = getPreparedSpellPlan(character, registry())
      .find((entry) => entry.classId === "wizard");
    expect(wizardPlan.maxSpellLevel).toBe(1);

    const target = getSpellbookCorrectionTargets(character, registry())
      .find((entry) => entry.classId === "wizard");
    expect(target).toBeTruthy();
    expect(target.maxSpellLevel).toBe(1);
    expect(target.candidates.length).toBeGreaterThan(0);
    expect(target.candidates.every((candidate) => candidate.level === 1)).toBe(true);

    const ninth = new Set(classSpellIdsAtLevel("wizard", 9));
    expect(target.candidates.some((candidate) => ninth.has(candidate.id))).toBe(false);
  });

  it("offers the full 1st-to-9th range to a wizard whose own table reaches it", () => {
    const target = getSpellbookCorrectionTargets(wizard20({ filled: 3 }), registry())[0];

    expect(target.maxSpellLevel).toBe(9);
    const levels = new Set(target.candidates.map((candidate) => candidate.level));
    expect(levels.has(1)).toBe(true);
    expect(levels.has(9)).toBe(true);
    // Cantrips are never spellbook candidates.
    expect(levels.has(0)).toBe(false);
  });

  it("never offers a spell already in the spellbook", () => {
    const character = wizard20({ filled: 3 });
    const stored = new Set(character.build.spellcasting.wizard.knownIds);
    const target = getSpellbookCorrectionTargets(character, registry())[0];

    expect(stored.size).toBe(3);
    expect(target.storedIds).toEqual([...stored]);
    expect(target.candidates.some((candidate) => stored.has(candidate.id))).toBe(false);
  });

  it("fails visibly when the class-specific ceiling cannot be resolved", () => {
    // A spellbook class whose registry record is present for the descriptor but
    // whose slot table yields no preparable level.
    // A spellbook class that still produces an under-cap descriptor but whose
    // record carries no slot table, so no class-specific ceiling exists.
    setActiveCustomContent([{
      id: "runescribe",
      kind: "class",
      name: "Runescribe",
      hitDie: 6,
      spellcasting: {
        ability: "int", preparationMode: "spellbook", progression: "full", startLevel: 1
      }
    }]);
    const character = makeCharacter([["runescribe", 20]], {
      spellcasting: { runescribe: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });

    // Positive control: the shortfall is real and the descriptor exists.
    expect(spellbookDescriptor(character.build, "runescribe").satisfied).toBe(false);

    const target = getSpellbookCorrectionTargets(character, registry())
      .find((entry) => entry.classId === "runescribe");
    expect(target).toBeTruthy();
    expect(target.resolvable).toBe(false);
    expect(target.maxSpellLevel).toBeNull();
    expect(target.candidates).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Dialog behavior and Apply                                           */
/* ------------------------------------------------------------------ */

function setupDom() {
  document.body.innerHTML = `
    <div id="spellbookChoicesOverlay" class="modalOverlay" hidden aria-hidden="true">
      <div class="modalPanel" id="spellbookChoicesPanel" role="dialog" aria-modal="true" tabindex="-1">
        <button type="button" id="spellbookChoicesClose">x</button>
        <div id="spellbookChoicesBody"></div>
        <div id="spellbookChoicesStatus" role="status" hidden></div>
        <button type="button" id="spellbookChoicesCancel">Cancel</button>
        <button type="button" id="spellbookChoicesApply">Apply</button>
      </div>
    </div>
    <button type="button" id="menuTrigger">...</button>
  `;
}

function makeHarness(character, { campaignId = "camp1" } = {}) {
  const state = {
    appShell: { activeCampaignId: campaignId },
    characters: { activeId: character.id, entries: [character], snapshots: [] }
  };
  const markDirty = vi.fn();
  const rerender = vi.fn();
  const setStatus = vi.fn();
  const uiAlert = vi.fn().mockResolvedValue(true);
  // Mirrors createStateActions().mutateCharacter closely enough for the flow's
  // contract: run the mutator against the live active entry, mark dirty exactly
  // once on a truthy result, and never on a falsy one.
  const mutateCharacter = vi.fn((mutator) => {
    const active = state.characters.entries.find((entry) => entry.id === state.characters.activeId);
    if (!active) return false;
    const result = mutator(active, state);
    if (result === false) return false;
    markDirty();
    return true;
  });

  const flow = initSpellbookChoicesFlow({
    root: document, state, mutateCharacter, rerender, setStatus, uiAlert
  });
  return { state, flow, markDirty, rerender, setStatus, uiAlert, mutateCharacter };
}

const overlay = () => document.getElementById("spellbookChoicesOverlay");
const body = () => document.getElementById("spellbookChoicesBody");
const applyBtn = () => document.getElementById("spellbookChoicesApply");
const cancelBtn = () => document.getElementById("spellbookChoicesCancel");
const rows = () => Array.from(body().querySelectorAll(".builderSpellCheckItem"));
const boxes = () => Array.from(body().querySelectorAll("input[type=checkbox]"));
const countText = () => body().querySelector(".builderSpellGroupCount").textContent;

/** Checks a candidate row the way a real click does. */
function toggle(input, checked) {
  input.checked = checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("Add Spellbook Choices dialog", () => {
  let harness;

  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    harness?.flow.destroy();
    harness = undefined;
    setActiveCustomContent([]);
    document.body.innerHTML = "";
  });

  it("reports availability from the live character", () => {
    harness = makeHarness(wizard20({ filled: 3 }));
    expect(harness.flow.isAvailable()).toBe(true);

    harness.state.characters.entries[0].build.levels =
      Array.from({ length: 19 }, () => ({ classId: "wizard", hp: 5 }));
    expect(harness.flow.isAvailable()).toBe(false);
  });

  it("shows the shared descriptor's count and the stored entries as locked context", () => {
    const character = wizard20({ filled: 3 });
    harness = makeHarness(character);
    harness.flow.open();

    expect(overlay().hidden).toBe(false);
    expect(countText()).toBe("3 / 44 in spellbook");
    const locked = body().querySelector(".levelUpLockedContext").textContent;
    expect(locked).toMatch(/^Already in spellbook: /);
    // Locked entries are text, never checkboxes.
    expect(boxes().every((input) => !input.checked)).toBe(true);
  });

  it("adds picks, keeps them removable, and moves the live count", () => {
    harness = makeHarness(wizard20({ filled: 3 }));
    harness.flow.open();

    toggle(boxes()[0], true);
    expect(countText()).toBe("4 / 44 in spellbook");
    toggle(boxes()[1], true);
    expect(countText()).toBe("5 / 44 in spellbook");

    toggle(boxes()[0], false);
    expect(countText()).toBe("4 / 44 in spellbook");
  });

  it("disables unselected candidates at the allowance and keeps picks removable", () => {
    // One slot left: 43 of 44 already stored.
    const character = wizard20({ filled: 0 });
    const stored = [
      ...classSpellIdsAtLevel("wizard", 1),
      ...classSpellIdsAtLevel("wizard", 2),
      ...classSpellIdsAtLevel("wizard", 3)
    ].slice(0, 43);
    character.build.spellcasting.wizard.knownIds = stored;
    harness = makeHarness(character);
    harness.flow.open();

    expect(countText()).toBe("43 / 44 in spellbook");
    // Positive control: nothing is disabled before the cap is reached.
    expect(boxes().every((input) => !input.disabled)).toBe(true);

    const picked = boxes()[0];
    toggle(picked, true);
    expect(countText()).toBe("44 / 44 in spellbook");
    expect(picked.disabled).toBe(false);
    expect(boxes().filter((input) => input !== picked).every((input) => input.disabled)).toBe(true);
    expect(rows().filter((row) => row.querySelector("input") !== picked)
      .every((row) => row.classList.contains("isDisabled"))).toBe(true);

    // The pick can still be removed, so the cap can never strand a selection.
    toggle(picked, false);
    expect(countText()).toBe("43 / 44 in spellbook");
    expect(boxes().every((input) => !input.disabled)).toBe(true);
  });

  it("refuses a synthetic over-cap change event and restores the input state", () => {
    const character = wizard20({ filled: 0 });
    character.build.spellcasting.wizard.knownIds = [
      ...classSpellIdsAtLevel("wizard", 1),
      ...classSpellIdsAtLevel("wizard", 2),
      ...classSpellIdsAtLevel("wizard", 3)
    ].slice(0, 44 - 1);
    harness = makeHarness(character);
    harness.flow.open();

    toggle(boxes()[0], true);
    expect(countText()).toBe("44 / 44 in spellbook");

    // A replayed/synthetic event on a disabled row must not push past the cap.
    const blocked = boxes()[1];
    toggle(blocked, true);
    expect(blocked.checked).toBe(false);
    expect(countText()).toBe("44 / 44 in spellbook");
  });

  it("applies the picks in one mutation, one dirty mark, and one rerender", () => {
    const character = wizard20({ filled: 3 });
    const before = JSON.parse(JSON.stringify(character));
    harness = makeHarness(character);
    harness.flow.open();

    const firstId = rows()[0].querySelector("input");
    const chosen = getSpellbookCorrectionTargets(character, registry())[0].candidates[0].id;
    toggle(firstId, true);
    applyBtn().click();

    return Promise.resolve().then(() => {
      const updated = harness.state.characters.entries[0];
      expect(harness.mutateCharacter).toHaveBeenCalledTimes(1);
      expect(harness.markDirty).toHaveBeenCalledTimes(1);
      expect(harness.rerender).toHaveBeenCalledTimes(1);

      // Appended at the end; every pre-existing id keeps its exact value/order.
      expect(updated.build.spellcasting.wizard.knownIds)
        .toEqual([...before.build.spellcasting.wizard.knownIds, chosen]);

      // The new spell reached the sheet through the spells-only patch.
      const seeded = updated.spells.levels
        .flatMap((level) => level.spells || [])
        .find((spell) => spell.builderSpellId === chosen);
      expect(seeded).toBeTruthy();
      expect(seeded.builderGranted).toBeUndefined();
      expect(overlay().hidden).toBe(true);
    });
  });

  it("seeds only spells — no features, proficiencies, attacks, inventory, or vitals", () => {
    const character = wizard20({ filled: 3 });
    // Content the player deleted after creation. A full Finish patch would
    // restore all of it (the C1.1 defect); a spells-only patch must not.
    character.features = "";
    character.languages = "";
    character.attacks = [];
    character.inventoryItems = [];
    character.resources = [];
    character.hpMax = null;
    character.ac = null;
    harness = makeHarness(character);
    harness.flow.open();
    toggle(boxes()[0], true);
    applyBtn().click();

    return Promise.resolve().then(() => {
      const updated = harness.state.characters.entries[0];
      // Positive control: the spells bucket really was written.
      expect(updated.spells.levels.length).toBeGreaterThan(0);
      expect(updated.features).toBe("");
      expect(updated.languages).toBe("");
      expect(updated.attacks).toEqual([]);
      expect(updated.inventoryItems).toEqual([]);
      expect(updated.resources).toEqual([]);
      expect(updated.hpMax).toBeNull();
      expect(updated.ac).toBeNull();
    });
  });

  it("leaves prepared state, acknowledgements, snapshots, and unrelated build keys byte-identical", () => {
    const character = wizard20({ filled: 3 });
    character.rest.preparedByClass = { wizard: ["magic-missile"] };
    character.build.spellcasting.wizard.preparedIds = ["shield"];
    character.build.spellcasting.wizard.cantripIds = ["fire-bolt"];
    character.underCapAckLevels = [20];
    character.build.subclassByClass = { wizard: "evocation" };
    const before = JSON.parse(JSON.stringify(character));

    harness = makeHarness(character);
    harness.state.characters.snapshots = [{ id: "csnap_x", kind: "pre-level-up" }];
    const snapshotsBefore = JSON.parse(JSON.stringify(harness.state.characters.snapshots));

    harness.flow.open();
    toggle(boxes()[0], true);
    applyBtn().click();

    return Promise.resolve().then(() => {
      const updated = harness.state.characters.entries[0];
      // Positive control: the spellbook really did grow.
      expect(updated.build.spellcasting.wizard.knownIds.length)
        .toBe(before.build.spellcasting.wizard.knownIds.length + 1);

      expect(updated.rest.preparedByClass).toEqual(before.rest.preparedByClass);
      expect(updated.build.spellcasting.wizard.preparedIds)
        .toEqual(before.build.spellcasting.wizard.preparedIds);
      expect(updated.build.spellcasting.wizard.cantripIds)
        .toEqual(before.build.spellcasting.wizard.cantripIds);
      expect(updated.underCapAckLevels).toEqual([20]);
      expect(updated.build.subclassByClass).toEqual(before.build.subclassByClass);
      expect(updated.build.levels).toEqual(before.build.levels);
      expect(updated.build.abilities).toEqual(before.build.abilities);
      expect(harness.state.characters.snapshots).toEqual(snapshotsBefore);
    });
  });

  it("never records an under-cap acknowledgement, even leaving the spellbook short", () => {
    const character = wizard20({ filled: 3 });
    expect(character.underCapAckLevels).toBeUndefined();
    harness = makeHarness(character);
    harness.flow.open();
    toggle(boxes()[0], true);
    applyBtn().click();

    return Promise.resolve().then(() => {
      const updated = harness.state.characters.entries[0];
      // Still far below the allowance, and still nothing acknowledged.
      expect(updated.build.spellcasting.wizard.knownIds).toHaveLength(4);
      expect(updated.underCapAckLevels).toBeUndefined();
    });
  });

  it("mutates nothing on Cancel", () => {
    const character = wizard20({ filled: 3 });
    const before = JSON.parse(JSON.stringify(character));
    harness = makeHarness(character);
    harness.flow.open();
    toggle(boxes()[0], true);
    cancelBtn().click();

    expect(overlay().hidden).toBe(true);
    expect(harness.mutateCharacter).not.toHaveBeenCalled();
    expect(harness.markDirty).not.toHaveBeenCalled();
    expect(harness.state.characters.entries[0]).toEqual(before);
  });

  it("mutates nothing on a no-op Apply", () => {
    const character = wizard20({ filled: 3 });
    const before = JSON.parse(JSON.stringify(character));
    harness = makeHarness(character);
    harness.flow.open();
    applyBtn().click();

    return Promise.resolve().then(() => {
      expect(harness.mutateCharacter).not.toHaveBeenCalled();
      expect(harness.markDirty).not.toHaveBeenCalled();
      expect(harness.state.characters.entries[0]).toEqual(before);
      expect(overlay().hidden).toBe(true);
    });
  });

  it("mutates nothing when the active character changed before Apply", () => {
    const character = wizard20({ filled: 3 });
    const before = JSON.parse(JSON.stringify(character));
    harness = makeHarness(character);
    harness.flow.open();
    toggle(boxes()[0], true);

    const other = wizard20({ filled: 1 });
    other.id = "char_other";
    harness.state.characters.entries.push(other);
    harness.state.characters.activeId = other.id;
    const otherBefore = JSON.parse(JSON.stringify(other));

    applyBtn().click();
    return Promise.resolve().then(() => {
      expect(harness.mutateCharacter).not.toHaveBeenCalled();
      expect(harness.markDirty).not.toHaveBeenCalled();
      expect(harness.state.characters.entries[0]).toEqual(before);
      expect(harness.state.characters.entries[1]).toEqual(otherBefore);
    });
  });

  it("mutates nothing when the active campaign changed before Apply", () => {
    const character = wizard20({ filled: 3 });
    const before = JSON.parse(JSON.stringify(character));
    harness = makeHarness(character);
    harness.flow.open();
    toggle(boxes()[0], true);

    harness.state.appShell.activeCampaignId = "camp2";
    applyBtn().click();

    return Promise.resolve().then(() => {
      expect(harness.mutateCharacter).not.toHaveBeenCalled();
      expect(harness.markDirty).not.toHaveBeenCalled();
      expect(harness.state.characters.entries[0]).toEqual(before);
      expect(harness.uiAlert).toHaveBeenCalled();
    });
  });

  it("mutates nothing when eligibility lapsed while the dialog was open", () => {
    const character = wizard20({ filled: 3 });
    harness = makeHarness(character);
    harness.flow.open();
    toggle(boxes()[0], true);

    // The spellbook filled up by another route while the dialog was open.
    character.build.spellcasting.wizard.knownIds = [
      ...classSpellIdsAtLevel("wizard", 1),
      ...classSpellIdsAtLevel("wizard", 2),
      ...classSpellIdsAtLevel("wizard", 3)
    ].slice(0, 44);
    const before = JSON.parse(JSON.stringify(character));

    applyBtn().click();
    return Promise.resolve().then(() => {
      expect(harness.mutateCharacter).not.toHaveBeenCalled();
      expect(harness.markDirty).not.toHaveBeenCalled();
      expect(harness.state.characters.entries[0]).toEqual(before);
      expect(harness.uiAlert).toHaveBeenCalled();
      // The dialog stays open so the failure is visible.
      expect(overlay().hidden).toBe(false);
    });
  });

  it("mutates nothing when a picked spell left the registry before Apply", () => {
    setActiveCustomContent([
      { id: "custom-ward", kind: "spell", name: "Custom Ward", level: 1, classIds: ["wizard"] }
    ]);
    const character = wizard20({ filled: 3 });
    harness = makeHarness(character);
    harness.flow.open();

    const customRow = rows().find((row) => row.textContent.includes("Custom Ward"));
    expect(customRow).toBeTruthy();
    toggle(customRow.querySelector("input"), true);

    // The custom spell is deleted from the campaign before Apply.
    setActiveCustomContent([]);
    const before = JSON.parse(JSON.stringify(character));

    applyBtn().click();
    return Promise.resolve().then(() => {
      expect(harness.mutateCharacter).not.toHaveBeenCalled();
      expect(harness.markDirty).not.toHaveBeenCalled();
      expect(harness.state.characters.entries[0]).toEqual(before);
      expect(harness.uiAlert).toHaveBeenCalled();
    });
  });

  it("renders a section per eligible spellbook class and applies each explicitly", () => {
    setActiveCustomContent([
      {
        id: "runescribe",
        kind: "class",
        name: "Runescribe",
        hitDie: 6,
        spellcasting: {
          ability: "int",
          preparationMode: "spellbook",
          progression: "full",
          startLevel: 1,
          slotsByLevel: Array.from({ length: 10 }, () => [2, 0, 0, 0, 0, 0, 0, 0, 0])
        }
      },
      { id: "rune-bolt", kind: "spell", name: "Rune Bolt", level: 1, classIds: ["runescribe"] }
    ]);
    const character = makeCharacter([["wizard", 10], ["runescribe", 10]], {
      spellcasting: {
        wizard: { cantripIds: [], knownIds: [], preparedIds: [] },
        runescribe: { cantripIds: [], knownIds: [], preparedIds: [] }
      }
    });
    harness = makeHarness(character);

    const targets = getSpellbookCorrectionTargets(character, registry());
    // Both spellbook classes are reported — never just the first.
    expect(targets.map((target) => target.classId).sort()).toEqual(["runescribe", "wizard"]);

    harness.flow.open();
    const sections = Array.from(body().querySelectorAll(".spellbookChoicesClass"));
    expect(sections.map((section) => section.dataset.classId).sort())
      .toEqual(["runescribe", "wizard"]);

    const runeSection = sections.find((section) => section.dataset.classId === "runescribe");
    const runeRow = Array.from(runeSection.querySelectorAll(".builderSpellCheckItem"))
      .find((row) => row.textContent.includes("Rune Bolt"));
    expect(runeRow).toBeTruthy();
    toggle(runeRow.querySelector("input"), true);

    const wizardSection = sections.find((section) => section.dataset.classId === "wizard");
    const wizardBox = wizardSection.querySelector("input[type=checkbox]");
    toggle(wizardBox, true);

    applyBtn().click();
    return Promise.resolve().then(() => {
      const updated = harness.state.characters.entries[0];
      expect(harness.mutateCharacter).toHaveBeenCalledTimes(1);
      expect(harness.markDirty).toHaveBeenCalledTimes(1);
      expect(updated.build.spellcasting.runescribe.knownIds).toEqual(["rune-bolt"]);
      expect(updated.build.spellcasting.wizard.knownIds).toHaveLength(1);
    });
  });

  it("restores focus to the invoking trigger on cancel", () => {
    harness = makeHarness(wizard20({ filled: 3 }));
    const trigger = document.getElementById("menuTrigger");
    harness.flow.open({ returnFocusTo: trigger });
    cancelBtn().click();

    return Promise.resolve().then(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("closes without mutating when the active character changes while open", () => {
    const character = wizard20({ filled: 3 });
    const before = JSON.parse(JSON.stringify(character));
    harness = makeHarness(character);
    harness.flow.open();
    toggle(boxes()[0], true);

    window.dispatchEvent(new CustomEvent("loreledger:active-character-changed", {
      detail: { previousId: character.id, activeId: "char_other" }
    }));

    expect(overlay().hidden).toBe(true);
    expect(harness.mutateCharacter).not.toHaveBeenCalled();
    expect(harness.state.characters.entries[0]).toEqual(before);
  });

  it("is inert after destroy", () => {
    harness = makeHarness(wizard20({ filled: 3 }));
    harness.flow.destroy();
    harness.flow.open();
    expect(overlay().hidden).toBe(true);
    expect(harness.flow.isAvailable()).toBe(false);
  });

  it("shows a visible explanation, and no picker, when the ceiling is unresolvable", () => {
    setActiveCustomContent([{
      id: "runescribe",
      kind: "class",
      name: "Runescribe",
      hitDie: 6,
      spellcasting: {
        ability: "int", preparationMode: "spellbook", progression: "full", startLevel: 1
      }
    }]);
    const character = makeCharacter([["runescribe", 20]], {
      spellcasting: { runescribe: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });
    harness = makeHarness(character);
    harness.flow.open();

    const section = body().querySelector('.spellbookChoicesClass[data-class-id="runescribe"]');
    expect(section).toBeTruthy();
    // Fails visibly: a rendered sentence naming the class, no checkboxes, and
    // Apply disabled so nothing can be committed.
    const message = section.querySelector(".builderWizardValidation");
    expect(message).toBeTruthy();
    expect(message.textContent).toMatch(/Runescribe/);
    expect(message.textContent).toMatch(/could not be read/i);
    expect(section.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
    expect(applyBtn().disabled).toBe(true);
    expect(harness.mutateCharacter).not.toHaveBeenCalled();
  });

  it("makes a malformed second class abort the whole Apply, leaving the first untouched", () => {
    setActiveCustomContent([
      {
        id: "runescribe",
        kind: "class",
        name: "Runescribe",
        hitDie: 6,
        spellcasting: {
          ability: "int", preparationMode: "spellbook", progression: "full", startLevel: 1,
          slotsByLevel: Array.from({ length: 10 }, () => [2, 0, 0, 0, 0, 0, 0, 0, 0])
        }
      },
      { id: "rune-bolt", kind: "spell", name: "Rune Bolt", level: 1, classIds: ["runescribe"] }
    ]);
    const character = makeCharacter([["wizard", 10], ["runescribe", 10]], {
      spellcasting: {
        wizard: { cantripIds: [], knownIds: [], preparedIds: [] },
        runescribe: { cantripIds: [], knownIds: [], preparedIds: [] }
      }
    });
    harness = makeHarness(character);
    harness.flow.open();

    const sections = Array.from(body().querySelectorAll(".spellbookChoicesClass"));
    for (const section of sections) {
      const box = section.querySelector("input[type=checkbox]");
      if (box) toggle(box, true);
    }

    // The second class's stored list turns malformed between open and Apply —
    // a shape this action must refuse rather than normalize.
    character.build.spellcasting.runescribe.knownIds = "not-an-array";
    const before = JSON.parse(JSON.stringify(character));

    applyBtn().click();
    return Promise.resolve().then(() => {
      // The mutation ran and rejected, so nothing was written and nothing
      // was marked dirty — in particular the wizard append did not survive.
      expect(harness.markDirty).not.toHaveBeenCalled();
      expect(harness.rerender).not.toHaveBeenCalled();
      expect(harness.state.characters.entries[0]).toEqual(before);
      expect(harness.state.characters.entries[0].build.spellcasting.wizard.knownIds).toEqual([]);
      expect(harness.uiAlert).toHaveBeenCalled();
    });
  });

  it("creates a missing selection bucket transactionally rather than rejecting", () => {
    // Eligibility counts a missing bucket as "0 chosen", so Apply must agree.
    const character = wizard20({ filled: 0 });
    delete character.build.spellcasting.wizard;
    harness = makeHarness(character);

    // Positive control: the class is still offered.
    expect(harness.flow.isAvailable()).toBe(true);
    harness.flow.open();
    toggle(boxes()[0], true);
    applyBtn().click();

    return Promise.resolve().then(() => {
      const updated = harness.state.characters.entries[0];
      expect(harness.markDirty).toHaveBeenCalledTimes(1);
      expect(updated.build.spellcasting.wizard.knownIds).toHaveLength(1);
      // Created in the shape both wizards write.
      expect(updated.build.spellcasting.wizard.cantripIds).toEqual([]);
      expect(updated.build.spellcasting.wizard.preparedIds).toEqual([]);
    });
  });

  it("updates an already-mounted Combat Spells panel live, with no re-init", () => {
    const character = wizard20({ filled: 0 });
    harness = makeHarness(character);

    // A Combat-shaped embedded Spells panel mounted BEFORE the correction.
    const host = document.createElement("div");
    host.id = "combatHost";
    host.innerHTML = `
      <section class="panel" id="combatEmbeddedSpellsSource">
        <button id="combatEmbeddedAddSpellLevelBtn" type="button">+ Level</button>
        <div id="combatEmbeddedSpellLevels" class="spellLevels"></div>
      </section>
    `;
    document.body.appendChild(host);
    const combat = initSpellsPanel({
      state: harness.state,
      SaveManager: { markDirty: () => {} },
      root: host,
      selectors: {
        panelEl: "#combatEmbeddedSpellsSource",
        containerEl: "#combatEmbeddedSpellLevels",
        addLevelBtnEl: "#combatEmbeddedAddSpellLevelBtn"
      }
    });

    const combatNames = () => Array.from(
      host.querySelectorAll("#combatEmbeddedSpellLevels input.spellName")
    ).map((node) => node.value);

    harness.flow.open();
    const target = getSpellbookCorrectionTargets(character, registry())[0];
    const chosen = target.candidates[0];
    expect(combatNames()).not.toContain(chosen.name);

    toggle(boxes()[0], true);
    applyBtn().click();

    return Promise.resolve().then(() => {
      // No reload, no removal, no re-add — the mounted panel re-rendered from
      // the established "spells" invalidation.
      expect(combatNames()).toContain(chosen.name);
      combat.destroy();
      host.remove();
    });
  });

  it("lets derived prepared capacity rise while writing no prepared state", () => {
    // A wizard prepares from its spellbook, so an empty spellbook bounds the
    // candidate-derived capacity at 0. Adding a candidate legitimately raises
    // it — a derivation, not a write.
    const character = wizard20({ filled: 0 });
    harness = makeHarness(character);
    const planBefore = getPreparedSpellPlan(character, registry())
      .find((entry) => entry.classId === "wizard");
    expect(planBefore.effectiveCapacity).toBe(0);

    harness.flow.open();
    toggle(boxes()[0], true);
    applyBtn().click();

    return Promise.resolve().then(() => {
      const updated = harness.state.characters.entries[0];
      const planAfter = getPreparedSpellPlan(updated, registry())
        .find((entry) => entry.classId === "wizard");
      expect(planAfter.effectiveCapacity).toBe(1);
      // The stored prepared map itself was never touched.
      expect(updated.rest.preparedByClass).toEqual({});
      expect(updated.build.spellcasting.wizard.preparedIds).toEqual([]);
    });
  });

  it("leaves no custom-registry state behind between cases", () => {
    // Guards the suite itself: an earlier case that installed custom content
    // must not leak a class into this one's registry view.
    const ids = registry().byKind.get("class").map((entry) => entry.id);
    expect(ids).not.toContain("runescribe");
    expect(registry().byKind.get("spell").map((entry) => entry.id))
      .not.toContain("rune-bolt");

    const character = wizard20({ filled: 3 });
    expect(getSpellbookCorrectionTargets(character, registry()).map((t) => t.classId))
      .toEqual(["wizard"]);
  });
});
