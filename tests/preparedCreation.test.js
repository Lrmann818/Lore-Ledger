// @vitest-environment jsdom
//
// Prepared Correctness C2-A: character creation consumes the shared
// prepared-spell plan instead of deriving its own candidates and capacity, and
// cannot persist a prepared list that Long Rest would reject.
//
// Two surfaces are covered here:
//
//   1. the creation picker (`renderSpellsStep`) — candidates, granted
//      exclusion, per-class multiclass ceilings, spellbook limits, effective
//      capacity display, and cap enforcement;
//   2. the defensive pre-Finish guard (`getDraftPreparedValidationMessage`).
//
// Every negative test carries a positive control so it cannot pass merely
// because the prepared group failed to render at all.

import { beforeEach, describe, expect, it } from "vitest";

import {
  makeDefaultBuilderCharacterEntry,
  makeDefaultCharacterBuild
} from "../js/domain/characterHelpers.js";
import {
  getDraftPreparedSpellPlan,
  getDraftPreparedValidationMessage,
  renderSpellsStep
} from "../js/pages/character/builderWizardSteps.js";
import { getBuilderFinishSheetSeedPatch } from "../js/domain/builderSheetSeeding.js";
import { getPreparedSpellPlan } from "../js/domain/rules/preparedSpells.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function nLevels(classId, n) {
  return Array.from({ length: n }, () => ({ classId, hp: null }));
}

function makeBuild({
  levels = nLevels("cleric", 3),
  subclassByClass = {},
  abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
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

/** A Life Domain Cleric — the only SRD 5.1 cleric subclass, and it grants spells. */
function lifeClericBuild(level = 3, extra = {}) {
  return makeBuild({
    levels: nLevels("cleric", level),
    subclassByClass: { cleric: "life" },
    ...extra
  });
}

function selectionFor(build, classId) {
  if (!build.spellcasting[classId]) {
    build.spellcasting[classId] = { cantripIds: [], knownIds: [], preparedIds: [] };
  }
  return build.spellcasting[classId];
}

function spellIdsOnClassList(classId, level) {
  return registry.byKind.get("spell")
    .filter((entry) => Number(entry.data?.level) === level &&
      (entry.data?.classIds || []).includes(classId))
    .map((entry) => entry.id);
}

function spellName(id) {
  return registry.byKind.get("spell").find((entry) => entry.id === id)?.name || id;
}

/* ------------------------------------------------------------------ */
/* renderSpellsStep harness                                            */
/* ------------------------------------------------------------------ */

let validationMessage = "";

function renderStep(build) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const rendered = renderSpellsStep({
    getDraft: () => ({ name: "Probe", build }),
    getRegistry: () => registry,
    signal: new AbortController().signal,
    enhanceSelect: () => {},
    onDraftChanged: () => {},
    getPreparedValidationMessage: () => validationMessage
  }, container);
  return { container, rendered };
}

function groups(container) {
  return [...container.querySelectorAll(".builderSpellGroup")];
}

function groupTitled(container, title) {
  return groups(container)
    .find((node) => node.querySelector(".builderSpellGroupTitle")?.textContent === title) || null;
}

function countText(groupEl) {
  return groupEl.querySelector(".builderSpellGroupCount")?.textContent || "";
}

/** Checkbox rows in a group, keyed by the spell name shown to the player. */
function rows(groupEl) {
  return [...groupEl.querySelectorAll(".builderSpellCheckItem")].map((label) => ({
    // Names carry " (ritual)" / " (conc.)" suffixes; strip for lookup.
    name: (label.querySelector("span")?.textContent || "").replace(/ \((ritual|conc\.)\)/g, ""),
    input: label.querySelector("input")
  }));
}

function rowNamed(groupEl, name) {
  return rows(groupEl).find((row) => row.name === name) || null;
}

function toggle(row, checked) {
  row.input.checked = checked;
  row.input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  validationMessage = "";
  document.body.innerHTML = "";
});

/* ------------------------------------------------------------------ */
/* 1-2. Granted spells are read-only and consume no capacity           */
/* ------------------------------------------------------------------ */

describe("creation picker — granted spells", () => {
  it("shows Life Domain grants as read-only and keeps them out of the ordinary candidates", () => {
    const build = lifeClericBuild(3);
    const { container } = renderStep(build);

    const plan = getDraftPreparedSpellPlan(build, registry)
      .find((entry) => entry.classId === "cleric");
    // Positive control: the shipped subclass really does grant these.
    expect(plan.grantedIds).toEqual(
      expect.arrayContaining(["bless", "cure-wounds", "lesser-restoration", "spiritual-weapon"])
    );

    const grantedRow = container.querySelector(".builderGrantedSpells");
    expect(grantedRow.textContent).toContain("Always Prepared");
    for (const id of plan.grantedIds) {
      expect(grantedRow.textContent).toContain(spellName(id));
    }

    const prepared = groupTitled(container, "Prepared Spells");
    // Positive control: the prepared group rendered real, selectable content.
    expect(rows(prepared).length).toBeGreaterThan(5);
    const preparedNames = rows(prepared).map((row) => row.name);
    for (const id of plan.grantedIds) {
      expect(preparedNames).not.toContain(spellName(id));
    }
  });

  it("does not let a granted spell consume ordinary prepared capacity", () => {
    const build = lifeClericBuild(3);
    const { container } = renderStep(build);
    const prepared = groupTitled(container, "Prepared Spells");

    // Capacity is 3 (cleric level) + 3 (WIS 16) = 6, and grants do not reduce it.
    expect(countText(prepared)).toBe("0 / 6 prepared");

    const plan = getDraftPreparedSpellPlan(build, registry)
      .find((entry) => entry.classId === "cleric");
    expect(plan.formulaCapacity).toBe(6);
    expect(plan.effectiveCapacity).toBe(6);
    // Grants are reported separately and are not in the candidate set.
    for (const id of plan.grantedIds) {
      expect(plan.ordinaryCandidateIds).not.toContain(id);
    }

    const first = rows(prepared)[0];
    toggle(first, true);
    expect(countText(prepared)).toBe("1 / 6 prepared");
  });
});

/* ------------------------------------------------------------------ */
/* 3. Multiclass uses each class's own table                           */
/* ------------------------------------------------------------------ */

describe("creation picker — multiclass spell-level ceilings", () => {
  it("offers a Cleric 3 / Wizard 3 only each class's own legal spell levels", () => {
    const build = makeBuild({
      levels: [...nLevels("cleric", 3), ...nLevels("wizard", 3)],
      abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 16, cha: 10 }
    });
    // Give the wizard a spellbook so its prepared group has candidates.
    selectionFor(build, "wizard").knownIds = [
      ...spellIdsOnClassList("wizard", 1).slice(0, 3),
      ...spellIdsOnClassList("wizard", 2).slice(0, 2)
    ];
    const { container } = renderStep(build);

    // Positive control: combined caster level 6 really does grant 3rd-level slots,
    // which is exactly what the old creation code used as the ceiling.
    const slotsRow = container.querySelector(".builderSpellSlotsRow");
    expect(slotsRow.textContent).toContain("3rd Level:");

    const clericPrepared = groupTitled(container, "Prepared Spells");
    const levelHeadings = [...clericPrepared.querySelectorAll("summary")].map((node) => node.textContent);
    expect(levelHeadings.some((text) => text.startsWith("1st Level"))).toBe(true);
    expect(levelHeadings.some((text) => text.startsWith("2nd Level"))).toBe(true);
    // Cleric 3's own table stops at 2nd level; combined slots must not widen it.
    expect(levelHeadings.some((text) => text.startsWith("3rd Level"))).toBe(false);

    const plan = getDraftPreparedSpellPlan(build, registry);
    expect(plan.find((entry) => entry.classId === "cleric").maxSpellLevel).toBe(2);
    expect(plan.find((entry) => entry.classId === "wizard").maxSpellLevel).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Wizard effective capacity is bounded by the spellbook            */
/* ------------------------------------------------------------------ */

describe("creation picker — wizard spellbook", () => {
  it("bounds effective capacity by the draft spellbook and explains the limit", () => {
    const build = makeBuild({
      levels: nLevels("wizard", 3),
      abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 }
    });
    const bookIds = spellIdsOnClassList("wizard", 1).slice(0, 2);
    selectionFor(build, "wizard").knownIds = [...bookIds];
    const { container } = renderStep(build);

    const prepared = groupTitled(container, "Prepared Spells (from spellbook)");
    // Formula capacity is 3 + 3 = 6, but only 2 spells exist to prepare.
    expect(countText(prepared)).toBe("0 / 2 prepared");
    expect(prepared.textContent).toContain("Limited by the spellbook");
    expect(prepared.textContent).toContain("though this class allows 6");

    // Only the spellbook's spells are offered.
    expect(rows(prepared).map((row) => row.name).sort())
      .toEqual(bookIds.map(spellName).sort());
  });

  it("recomputes the prepared candidates and cap when the spellbook changes", () => {
    const build = makeBuild({
      levels: nLevels("wizard", 3),
      abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 }
    });
    const bookIds = spellIdsOnClassList("wizard", 1).slice(0, 2);
    selectionFor(build, "wizard").knownIds = [bookIds[0]];
    const { container } = renderStep(build);

    const prepared = groupTitled(container, "Prepared Spells (from spellbook)");
    expect(countText(prepared)).toBe("0 / 1 prepared");

    const spellbook = groupTitled(container, "Spellbook");
    toggle(rowNamed(spellbook, spellName(bookIds[1])), true);

    // The prepared group was rebuilt in place against the new plan.
    const preparedAfter = groupTitled(container, "Prepared Spells (from spellbook)");
    expect(countText(preparedAfter)).toBe("0 / 2 prepared");
    expect(rowNamed(preparedAfter, spellName(bookIds[1]))).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 5-6. Cap enforcement                                                */
/* ------------------------------------------------------------------ */

describe("creation picker — effective capacity enforcement", () => {
  it("blocks further ordinary selections at the cap but keeps chosen spells deselectable", () => {
    // Cleric 1 with WIS 12 => capacity max(1, 1 + 1) = 2.
    const build = makeBuild({
      levels: nLevels("cleric", 1),
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 12, cha: 10 }
    });
    const { container } = renderStep(build);
    const prepared = groupTitled(container, "Prepared Spells");
    expect(countText(prepared)).toBe("0 / 2 prepared");

    const all = rows(prepared);
    expect(all.length).toBeGreaterThan(3); // positive control
    expect(all.every((row) => row.input.disabled === false)).toBe(true);

    toggle(all[0], true);
    toggle(all[1], true);
    expect(countText(prepared)).toBe("2 / 2 prepared");

    // At the cap: unchosen candidates are blocked...
    const current = rows(prepared);
    expect(current[2].input.disabled).toBe(true);
    // ...but the chosen ones stay operable so the player is never trapped.
    expect(current[0].input.disabled).toBe(false);
    expect(current[1].input.disabled).toBe(false);

    toggle(current[0], false);
    expect(countText(prepared)).toBe("1 / 2 prepared");
    expect(rows(prepared)[2].input.disabled).toBe(false);

    // The draft never exceeded the cap.
    expect(build.spellcasting.cleric.preparedIds.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Unknown capacity                                                 */
/* ------------------------------------------------------------------ */

describe("creation picker — unknown capacity", () => {
  it("keeps capacity unknown (never zero) and cannot build an invalid list", () => {
    const build = makeBuild({
      levels: nLevels("cleric", 3),
      abilities: { str: 10, dex: 10, con: 10, int: 10, cha: 10 } // no WIS score
    });
    const { container } = renderStep(build);

    const plan = getDraftPreparedSpellPlan(build, registry)
      .find((entry) => entry.classId === "cleric");
    expect(plan.formulaCapacity).toBeNull();
    expect(plan.effectiveCapacity).toBeNull();
    expect(plan.limitedBy).toBe("unknown");

    const prepared = groupTitled(container, "Prepared Spells");
    expect(countText(prepared)).toBe("0 prepared");
    expect(countText(prepared)).not.toContain("/ 0");
    expect(prepared.textContent).toContain("Prepared capacity is unavailable");

    const all = rows(prepared);
    expect(all.length).toBeGreaterThan(3); // positive control: the list still renders
    expect(all.every((row) => row.input.disabled === true)).toBe(true);
    expect(build.spellcasting.cleric.preparedIds).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 17. Cantrip / known-spell groups are untouched by C2-A              */
/* ------------------------------------------------------------------ */

describe("creation picker — non-prepared groups are unchanged", () => {
  it("keeps the cleric cantrip group on the full class list with its known label", () => {
    const build = lifeClericBuild(3);
    const { container } = renderStep(build);
    const cantrips = groupTitled(container, "Cantrips");
    expect(countText(cantrips)).toBe("0 / 3 known");
    expect(rows(cantrips).map((row) => row.name).sort())
      .toEqual(spellIdsOnClassList("cleric", 0).map(spellName).sort());
  });

  it("keeps a known-spell caster's group on combined slot levels with no cap enforcement", () => {
    const build = makeBuild({
      levels: nLevels("bard", 3),
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16 }
    });
    const { container } = renderStep(build);
    expect(groupTitled(container, "Prepared Spells")).toBeNull();
    const known = groupTitled(container, "Known Spells");
    expect(countText(known)).toBe("0 / 6 known");

    // Over-cap on a known-spell caster is still permitted: out of C2-A scope,
    // recorded for R5-B2. Pinned so the behavior cannot change unnoticed.
    const all = rows(known);
    for (let i = 0; i < 7; i += 1) toggle(all[i], true);
    expect(build.spellcasting.bard.knownIds.length).toBe(7);
    expect(rows(known).every((row) => row.input.disabled === false)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 8-12. Defensive pre-Finish validation                               */
/* ------------------------------------------------------------------ */

describe("pre-Finish prepared validation", () => {
  it("passes a valid full list and a valid underfilled list (no confirmation in C2-A)", () => {
    const build = lifeClericBuild(3);
    const candidates = getDraftPreparedSpellPlan(build, registry)
      .find((entry) => entry.classId === "cleric").ordinaryCandidateIds;

    selectionFor(build, "cleric").preparedIds = candidates.slice(0, 6);
    expect(getDraftPreparedValidationMessage(build, registry)).toBe("");

    // Underfilled — allowed, and silent.
    selectionFor(build, "cleric").preparedIds = candidates.slice(0, 2);
    expect(getDraftPreparedValidationMessage(build, registry)).toBe("");

    // Empty — allowed.
    selectionFor(build, "cleric").preparedIds = [];
    expect(getDraftPreparedValidationMessage(build, registry)).toBe("");
  });

  it("rejects an id outside the class's ordinary candidate set", () => {
    const build = lifeClericBuild(3);
    const valid = getDraftPreparedSpellPlan(build, registry)
      .find((entry) => entry.classId === "cleric").ordinaryCandidateIds[0];

    selectionFor(build, "cleric").preparedIds = [valid];
    expect(getDraftPreparedValidationMessage(build, registry)).toBe(""); // positive control

    // Within the level ceiling (1st level) but not on the cleric list, so this
    // isolates the class-list rule from the spell-level rule below.
    const offList = spellIdsOnClassList("wizard", 1)
      .find((id) => !spellIdsOnClassList("cleric", 1).includes(id));
    expect(offList).toBeTruthy(); // positive control

    selectionFor(build, "cleric").preparedIds = [valid, offList];
    const message = getDraftPreparedValidationMessage(build, registry);
    expect(message).toContain(spellName(offList));
    expect(message).toContain("not on this class's spell list");
  });

  it("rejects a granted id stored redundantly as an ordinary selection", () => {
    const build = lifeClericBuild(3);
    const plan = getDraftPreparedSpellPlan(build, registry)
      .find((entry) => entry.classId === "cleric");

    selectionFor(build, "cleric").preparedIds = [plan.ordinaryCandidateIds[0]];
    expect(getDraftPreparedValidationMessage(build, registry)).toBe(""); // positive control

    selectionFor(build, "cleric").preparedIds = [plan.ordinaryCandidateIds[0], "cure-wounds"];
    const message = getDraftPreparedValidationMessage(build, registry);
    expect(message).toContain("Cure Wounds");
    expect(message).toContain("always prepared");
  });

  it("rejects an id above the class's own spell-level ceiling", () => {
    const build = makeBuild({
      levels: [...nLevels("cleric", 3), ...nLevels("wizard", 3)],
      abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 16, cha: 10 }
    });
    const plan = getDraftPreparedSpellPlan(build, registry)
      .find((entry) => entry.classId === "cleric");
    expect(plan.maxSpellLevel).toBe(2); // positive control

    selectionFor(build, "cleric").preparedIds = [plan.ordinaryCandidateIds[0]];
    expect(getDraftPreparedValidationMessage(build, registry)).toBe("");

    // A 3rd-level cleric spell — reachable only through the combined-slot bug.
    const thirdLevel = spellIdsOnClassList("cleric", 3)[0];
    selectionFor(build, "cleric").preparedIds = [plan.ordinaryCandidateIds[0], thirdLevel];
    const message = getDraftPreparedValidationMessage(build, registry);
    expect(message).toContain(spellName(thirdLevel));
    expect(message).toContain("above the highest spell level");
  });

  it("rejects a list longer than effective capacity", () => {
    const build = makeBuild({
      levels: nLevels("cleric", 1),
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 12, cha: 10 }
    });
    const candidates = getDraftPreparedSpellPlan(build, registry)
      .find((entry) => entry.classId === "cleric").ordinaryCandidateIds;

    selectionFor(build, "cleric").preparedIds = candidates.slice(0, 2);
    expect(getDraftPreparedValidationMessage(build, registry)).toBe(""); // at the cap: fine

    selectionFor(build, "cleric").preparedIds = candidates.slice(0, 3);
    const message = getDraftPreparedValidationMessage(build, registry);
    expect(message).toContain("can prepare at most 2 spells");
    expect(message).toContain("3 are selected");
  });

  it("rejects a non-empty list when capacity is unknown, and accepts an empty one", () => {
    const build = makeBuild({
      levels: nLevels("cleric", 3),
      abilities: { str: 10, dex: 10, con: 10, int: 10, cha: 10 }
    });
    selectionFor(build, "cleric").preparedIds = [];
    expect(getDraftPreparedValidationMessage(build, registry)).toBe("");

    selectionFor(build, "cleric").preparedIds = ["bless"];
    expect(getDraftPreparedValidationMessage(build, registry))
      .toContain("spellcasting ability score");
  });

  it("rejects a spellbook-mode id the draft spellbook does not contain", () => {
    const build = makeBuild({
      levels: nLevels("wizard", 3),
      abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 }
    });
    const bookIds = spellIdsOnClassList("wizard", 1).slice(0, 2);
    const selection = selectionFor(build, "wizard");
    selection.knownIds = [...bookIds];

    selection.preparedIds = [bookIds[0]];
    expect(getDraftPreparedValidationMessage(build, registry)).toBe(""); // positive control

    const outsideBook = spellIdsOnClassList("wizard", 1).find((id) => !bookIds.includes(id));
    selection.preparedIds = [bookIds[0], outsideBook];
    expect(getDraftPreparedValidationMessage(build, registry))
      .toContain("not in this character's spellbook");
  });

  it("fails soft for unresolvable and non-prepared classes instead of blocking Finish", () => {
    // A known-spell caster with a stray prepared list must not block Finish.
    const bard = makeBuild({
      levels: nLevels("bard", 3),
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16 }
    });
    selectionFor(bard, "bard").preparedIds = ["fireball", "not-a-spell"];
    expect(getDraftPreparedValidationMessage(bard, registry)).toBe("");

    // A class that is not in the registry at all yields no plan entry.
    const ghost = makeBuild({ levels: nLevels("artificer", 3) });
    selectionFor(ghost, "artificer").preparedIds = ["bless"];
    expect(getDraftPreparedValidationMessage(ghost, registry)).toBe("");

    // A freeform character has no build at all.
    expect(getDraftPreparedValidationMessage(null, registry)).toBe("");
    expect(getDraftPreparedSpellPlan(null, registry)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 14. Granted access survives adoption without entering rest state    */
/* ------------------------------------------------------------------ */

describe("creation seeding — granted spells", () => {
  it("seeds grants as always-prepared rows without storing them in rest.preparedByClass", () => {
    const character = makeDefaultBuilderCharacterEntry("Life Cleric");
    character.build = lifeClericBuild(3);
    const plan = getPreparedSpellPlan(character, registry)
      .find((entry) => entry.classId === "cleric");
    expect(plan.grantedIds.length).toBeGreaterThan(0); // positive control

    // What C2-A adoption stores: the validated ordinary selection only.
    const ordinary = plan.ordinaryCandidateIds.slice(0, 2);
    selectionFor(character.build, "cleric").preparedIds = [...ordinary];
    character.rest = { hitDiceSpent: {}, preparedByClass: { cleric: [...ordinary] } };

    const patch = getBuilderFinishSheetSeedPatch(character, registry);
    const seededRows = patch.spells.levels.flatMap((level) => level.spells);

    for (const id of plan.grantedIds) {
      const row = seededRows.find((spell) => spell.builderSpellId === id);
      expect(row, `expected a seeded row for granted spell ${id}`).toBeTruthy();
      expect(row.builderGranted).toBe(true);
      expect(row.prepared).toBe(true);
      // Granted access flows from derived.grantedSpells, never from rest state.
      expect(character.rest.preparedByClass.cleric).not.toContain(id);
    }

    // The ordinary picks are prepared too, and they are the only rest-owned ids.
    for (const id of ordinary) {
      expect(seededRows.find((spell) => spell.builderSpellId === id).prepared).toBe(true);
    }
    expect(character.rest.preparedByClass.cleric).toEqual(ordinary);
  });
});

/* ------------------------------------------------------------------ */
/* Draft view stays a view, never a second store                       */
/* ------------------------------------------------------------------ */

describe("draft prepared plan", () => {
  it("reads the draft's own preparedIds as the current selection without writing state", () => {
    const build = lifeClericBuild(3);
    const candidates = getDraftPreparedSpellPlan(build, registry)
      .find((entry) => entry.classId === "cleric").ordinaryCandidateIds;
    selectionFor(build, "cleric").preparedIds = candidates.slice(0, 2);

    const entry = getDraftPreparedSpellPlan(build, registry)
      .find((item) => item.classId === "cleric");
    expect(entry.selectedIds).toEqual(candidates.slice(0, 2));
    // The adapter adds no rest state to the draft build.
    expect(build.rest).toBeUndefined();
  });
});
