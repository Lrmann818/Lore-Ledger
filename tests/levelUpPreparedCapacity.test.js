// @vitest-environment jsdom
//
// Accurate Level Up prepared capacity (C2-C).
//
// Level Up used to derive prepared capacity from build abilities alone inside
// `getLevelUpPlan()`. That number could disagree with the one Long Rest
// enforces, because it ignored `overrides.abilities`, excluded the ASI or
// ability-granting feat being chosen in the very same flow, reported the raw
// formula instead of the candidate-bounded `effectiveCapacity`, and never saw a
// wizard's actual spellbook. It also could not notice a capacity change to a
// prepared class the appended level does not belong to.
//
// Two surfaces are covered here:
//
//   1. `getPreparedSpellCapacityChanges()` — the pure before/after comparison,
//      derived through `getPreparedSpellPlan()` on both sides;
//   2. the real Level Up wizard — which capacity it displays, when the
//      informational Spells step becomes available, that the value tracks
//      pending spellbook picks live, and that prepared play-state is never
//      touched.
//
// Every negative case carries a positive control, so none of them can pass
// merely because no prepared caster was resolved at all.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { getPreparedSpellCapacityChanges } from "../js/domain/rules/preparedSpells.js";
import { getLevelUpPlan } from "../js/domain/rules/progression.js";
import { getActiveContentRegistry, setActiveCustomContent } from "../js/domain/rules/registry.js";
import { initLevelUpWizard } from "../js/pages/character/levelUpWizard.js";

// The wizard reads the active registry, so tests that add custom content must
// compare against the same registry the wizard sees.
function registry() {
  return getActiveContentRegistry();
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** @param {string} classId @param {number} count */
function nLevels(classId, count) {
  return Array.from({ length: count }, () => ({ classId, hp: 5 }));
}

/**
 * A builder character with no race (so ability arithmetic is exactly the base
 * score plus whatever the test adds) and empty rest play-state.
 */
function builderCharacter({
  levels = nLevels("cleric", 3),
  base = {},
  subclassByClass = {},
  spellcasting = {},
  overrides = null,
  choicesByLevel = {},
  rest = { hitDiceSpent: {}, preparedByClass: {} }
} = {}) {
  const character = makeDefaultBuilderCharacterEntry("Capacity Probe");
  character.id = "char_capacity";
  character.build.levels = levels;
  character.build.subclassByClass = subclassByClass;
  character.build.spellcasting = spellcasting;
  character.build.choicesByLevel = choicesByLevel;
  character.build.abilities.base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...base };
  character.rest = rest;
  if (overrides) character.overrides = overrides;
  return character;
}

/** The same character shell carrying a projected build — Level Up's after view. */
function withBuild(character, mutate) {
  const build = JSON.parse(JSON.stringify(character.build));
  mutate(build);
  return { ...JSON.parse(JSON.stringify(character)), build };
}

/** @param {string} classId @param {number} characterLevel @param {Record<string, number>} increases */
function asiChoice(build, classId, characterLevel, increases) {
  build.choicesByLevel = {
    ...build.choicesByLevel,
    [String(characterLevel)]: {
      ...(build.choicesByLevel?.[String(characterLevel)] || {}),
      [`asi-${characterLevel}`]: { type: "asi", increases }
    }
  };
  return build;
}

function changesFor(before, after) {
  return getPreparedSpellCapacityChanges(before, after, registry());
}

function changeOf(changes, classId) {
  return changes.find((change) => change.classId === classId);
}

afterEach(() => {
  setActiveCustomContent([]);
});

/* ------------------------------------------------------------------ */
/* 1. The pure before/after comparison                                 */
/* ------------------------------------------------------------------ */

describe("level up prepared capacity — the shared before/after comparison", () => {
  it("counts an existing spellcasting-ability override on both sides", () => {
    // Cleric 3 → 4, base Wis 15 (+2) with a stored +2 ability adjustment, so
    // the real modifier is +3: capacity 6 → 7, not the build-only 5 → 6.
    const overridden = builderCharacter({
      base: { wis: 15 },
      subclassByClass: { cleric: "life" },
      overrides: { abilities: { wis: 2 } }
    });
    const change = changeOf(
      changesFor(overridden, withBuild(overridden, (build) => build.levels.push({ classId: "cleric", hp: 5 }))),
      "cleric"
    );

    expect(change).toBeDefined();
    expect(change.capacityBefore).toBe(6);
    expect(change.capacityAfter).toBe(7);
    expect(change.changed).toBe(true);

    // Positive control: the identical character without the adjustment sits a
    // full point lower on both sides, which is what the build-only formula in
    // getLevelUpPlan() used to display for the overridden character too.
    const plain = builderCharacter({ base: { wis: 15 }, subclassByClass: { cleric: "life" } });
    const plainChange = changeOf(
      changesFor(plain, withBuild(plain, (build) => build.levels.push({ classId: "cleric", hp: 5 }))),
      "cleric"
    );
    expect([plainChange.capacityBefore, plainChange.capacityAfter]).toEqual([5, 6]);
  });

  it("counts an ASI chosen during this Level Up", () => {
    const cleric = builderCharacter({ base: { wis: 15 }, subclassByClass: { cleric: "life" } });
    const withoutAsi = withBuild(cleric, (build) => build.levels.push({ classId: "cleric", hp: 5 }));
    const withAsi = withBuild(cleric, (build) => {
      build.levels.push({ classId: "cleric", hp: 5 });
      asiChoice(build, "cleric", 4, { wis: 2 });
    });

    // Positive control: the same append without the pending ASI.
    expect(changeOf(changesFor(cleric, withoutAsi), "cleric").capacityAfter).toBe(6);
    // Wis 15 → 17 (+3) makes the resulting capacity 4 + 3.
    expect(changeOf(changesFor(cleric, withAsi), "cleric").capacityAfter).toBe(7);
  });

  it("counts an ability-granting feat chosen during this Level Up", () => {
    setActiveCustomContent([{
      id: "gift-of-insight",
      kind: "feat",
      name: "Gift of Insight",
      effects: [{ type: "ability_bonus", ability: "wis", value: 2 }]
    }]);
    const cleric = builderCharacter({ base: { wis: 15 }, subclassByClass: { cleric: "life" } });
    const withFeat = withBuild(cleric, (build) => {
      build.levels.push({ classId: "cleric", hp: 5 });
      build.choicesByLevel = { 4: { "asi-4": { type: "feat", featId: "gift-of-insight" } } };
    });

    expect(changeOf(changesFor(cleric, withFeat), "cleric").capacityBefore).toBe(5);
    expect(changeOf(changesFor(cleric, withFeat), "cleric").capacityAfter).toBe(7);
  });

  it("reports a multiclass ASI that only moves another class's capacity", () => {
    // Cleric 3 / Fighter 3 → Fighter 4. The appended level is non-spellcasting
    // and the cleric gains nothing, so the progression plan has no spellcasting
    // delta at all — but the fighter ASI still moves the cleric's capacity.
    const character = builderCharacter({
      levels: [...nLevels("cleric", 3), ...nLevels("fighter", 3)],
      base: { wis: 15 },
      subclassByClass: { cleric: "life", fighter: "champion" }
    });
    const after = withBuild(character, (build) => {
      build.levels.push({ classId: "fighter", hp: 6 });
      asiChoice(build, "fighter", 7, { wis: 2 });
    });

    const plan = getLevelUpPlan(after.build, "fighter", registry());
    expect(plan).not.toBeNull();
    expect(getLevelUpPlan(character.build, "fighter", registry()).spellcastingDelta).toEqual([]);

    const change = changeOf(changesFor(character, after), "cleric");
    expect(change).toBeDefined();
    expect(change.capacityBefore).toBe(5);
    expect(change.capacityAfter).toBe(6);
    expect(change.changed).toBe(true);
    expect(change.isNewCaster).toBe(false);
  });

  it("gives each prepared class its own class level and casting progression", () => {
    // Cleric 3 (full caster, Wis) alongside Paladin 4 (half caster, Cha).
    const character = builderCharacter({
      levels: [...nLevels("cleric", 3), ...nLevels("paladin", 4)],
      base: { wis: 15, cha: 16 },
      subclassByClass: { cleric: "life" }
    });
    const after = withBuild(character, (build) => build.levels.push({ classId: "cleric", hp: 5 }));
    const changes = changesFor(character, after);

    // Cleric 3 → 4 with Wis +2: 3 + 2 = 5 → 4 + 2 = 6.
    expect(changeOf(changes, "cleric")).toMatchObject({
      capacityBefore: 5,
      capacityAfter: 6,
      changed: true
    });
    // Paladin stays at class level 4, and half casters use floor(level / 2):
    // 2 + 3 = 5 on both sides, from the paladin's own table and ability.
    expect(changeOf(changes, "paladin")).toMatchObject({
      capacityBefore: 5,
      capacityAfter: 5,
      changed: false
    });
  });

  it("bounds a wizard by its actual spellbook rather than the formula", () => {
    const wizard = builderCharacter({
      levels: nLevels("wizard", 3),
      base: { int: 16 },
      spellcasting: { wizard: { cantripIds: [], knownIds: ["magic-missile", "shield"], preparedIds: [] } }
    });
    const after = withBuild(wizard, (build) => build.levels.push({ classId: "wizard", hp: 4 }));
    const change = changeOf(changesFor(wizard, after), "wizard");

    // The formula reads 6 → 7; the two-spell spellbook is the real limit.
    expect(change.capacityBefore).toBe(2);
    expect(change.capacityAfter).toBe(2);
    expect(change.limitedByAfter).toBe("candidates");
    expect(change.changed).toBe(false);

    // Positive control: a spellbook large enough to clear the formula reports
    // the formula values instead, so the assertion above is about the bound and
    // not about the wizard failing to resolve.
    const stocked = builderCharacter({
      levels: nLevels("wizard", 3),
      base: { int: 16 },
      spellcasting: {
        wizard: {
          cantripIds: [],
          knownIds: ["magic-missile", "shield", "burning-hands", "detect-magic",
            "mage-armor", "sleep", "scorching-ray"],
          preparedIds: []
        }
      }
    });
    const stockedChange = changeOf(
      changesFor(stocked, withBuild(stocked, (build) => build.levels.push({ classId: "wizard", hp: 4 }))),
      "wizard"
    );
    expect([stockedChange.capacityBefore, stockedChange.capacityAfter]).toEqual([6, 7]);
    expect(stockedChange.limitedByAfter).toBe("formula");
  });

  it("raises a wizard's resulting capacity with pending spellbook additions, never past the formula", () => {
    const wizard = builderCharacter({
      levels: nLevels("wizard", 3),
      base: { int: 16 },
      spellcasting: { wizard: { cantripIds: [], knownIds: ["magic-missile", "shield"], preparedIds: [] } }
    });
    /** @param {string[]} additions */
    const capacityWith = (additions) => changeOf(changesFor(wizard, withBuild(wizard, (build) => {
      build.levels.push({ classId: "wizard", hp: 4 });
      build.spellcasting.wizard.knownIds.push(...additions);
    })), "wizard").capacityAfter;

    expect(capacityWith([])).toBe(2);
    expect(capacityWith(["burning-hands"])).toBe(3);
    expect(capacityWith(["burning-hands", "detect-magic"])).toBe(4);

    // A low-Intelligence wizard is formula-bound, so additions stop mattering
    // once the formula is reached (Int 10, wizard 4 → 5: capacity 5).
    const lowInt = builderCharacter({
      levels: nLevels("wizard", 4),
      base: { int: 10 },
      spellcasting: {
        wizard: {
          cantripIds: [],
          knownIds: ["magic-missile", "shield", "burning-hands", "detect-magic"],
          preparedIds: []
        }
      }
    });
    /** @param {string[]} additions */
    const lowIntCapacity = (additions) => changeOf(changesFor(lowInt, withBuild(lowInt, (build) => {
      build.levels.push({ classId: "wizard", hp: 4 });
      build.spellcasting.wizard.knownIds.push(...additions);
    })), "wizard").capacityAfter;

    expect(lowIntCapacity([])).toBe(4);
    expect(lowIntCapacity(["mage-armor"])).toBe(5);
    expect(lowIntCapacity(["mage-armor", "sleep"])).toBe(5);
  });

  it("keeps an unknown capacity unknown instead of turning it into zero", () => {
    const cleric = builderCharacter({ base: {}, subclassByClass: { cleric: "life" } });
    cleric.build.abilities.base.wis = null;
    const change = changeOf(
      changesFor(cleric, withBuild(cleric, (build) => build.levels.push({ classId: "cleric", hp: 5 }))),
      "cleric"
    );

    // Positive control: the caster resolved, so null really is "unknown".
    expect(change).toBeDefined();
    expect(change.capacityBefore).toBeNull();
    expect(change.capacityAfter).toBeNull();
    expect(change.capacityAfter).not.toBe(0);
    expect(change.limitedByAfter).toBe("unknown");
    expect(change.changed).toBe(false);
  });

  it("reports a newly multiclassed prepared caster as new rather than as a change from zero", () => {
    const fighter = builderCharacter({
      levels: nLevels("fighter", 3),
      base: { wis: 15 },
      subclassByClass: { fighter: "champion" }
    });
    const after = withBuild(fighter, (build) => {
      build.levels.push({ classId: "cleric", hp: 5 });
      build.subclassByClass.cleric = "life";
    });
    const change = changeOf(changesFor(fighter, after), "cleric");

    expect(change.isNewCaster).toBe(true);
    expect(change.capacityBefore).toBeNull();
    expect(change.capacityAfter).toBe(3); // cleric 1 + Wis +2
    expect(change.changed).toBe(true);
  });

  it("is pure, fails soft, and reports nothing for non-prepared characters", () => {
    const cleric = builderCharacter({ base: { wis: 15 }, subclassByClass: { cleric: "life" } });
    const before = JSON.stringify(cleric);
    const after = withBuild(cleric, (build) => build.levels.push({ classId: "cleric", hp: 5 }));
    changesFor(cleric, after);
    expect(JSON.stringify(cleric)).toBe(before);

    const fighter = builderCharacter({ levels: nLevels("fighter", 2), subclassByClass: { fighter: "champion" } });
    expect(changesFor(
      fighter,
      withBuild(fighter, (build) => build.levels.push({ classId: "fighter", hp: 6 }))
    )).toEqual([]);

    expect(changesFor(null, null)).toEqual([]);
    expect(changesFor({ id: "c", build: null }, { id: "c", build: null })).toEqual([]);
    expect(() => changesFor(
      { id: "c", build: { levels: [null, { classId: 42 }], spellcasting: "nope" } },
      { id: "c", build: { levels: "broken" } }
    )).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* 2. The Level Up wizard                                              */
/* ------------------------------------------------------------------ */

const STEP_IDS = Object.freeze([
  "levelUpStepClass", "levelUpStepSubclass", "levelUpStepFeatures",
  "levelUpStepAsi", "levelUpStepSpells", "levelUpStepHp", "levelUpStepSummary"
]);

/** Mirrors the #levelUpOverlay markup in index.html. */
function installLevelUpDom() {
  document.body.innerHTML = "";
  const overlay = document.createElement("div");
  overlay.id = "levelUpOverlay";
  overlay.hidden = true;
  document.body.appendChild(overlay);
  const panel = document.createElement("div");
  panel.id = "levelUpPanel";
  panel.setAttribute("tabindex", "-1");
  overlay.appendChild(panel);

  const header = document.createElement("div");
  panel.appendChild(header);
  for (const [tag, id] of [["div", "levelUpTitle"], ["button", "levelUpClose"]]) {
    const node = document.createElement(tag);
    node.id = id;
    header.appendChild(node);
  }

  const body = document.createElement("div");
  body.className = "levelUpBody";
  panel.appendChild(body);
  const bodies = {
    levelUpStepClass: ["levelUpClassBody", "levelUpClassValidation"],
    levelUpStepSubclass: ["levelUpSubclassBody", "levelUpSubclassValidation"],
    levelUpStepFeatures: ["levelUpFeaturesBody", null],
    levelUpStepAsi: ["levelUpAsiBody", null],
    levelUpStepSpells: ["levelUpSpellsBody", "levelUpSpellsValidation"],
    levelUpStepHp: ["levelUpHpBody", "levelUpHpValidation"],
    levelUpStepSummary: ["levelUpSummaryBody", null]
  };
  STEP_IDS.forEach((stepId, index) => {
    const step = document.createElement("section");
    step.id = stepId;
    step.hidden = index !== 0;
    body.appendChild(step);
    const [bodyId, validationId] = bodies[stepId];
    const dynamic = document.createElement("div");
    dynamic.id = bodyId;
    step.appendChild(dynamic);
    if (validationId) {
      const validation = document.createElement("div");
      validation.id = validationId;
      validation.hidden = true;
      step.appendChild(validation);
    }
  });

  const footer = document.createElement("div");
  panel.appendChild(footer);
  for (const id of ["levelUpCancel", "levelUpBack", "levelUpNext", "levelUpApply"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    footer.appendChild(button);
  }
}

function click(id) {
  document.getElementById(id).dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
}

function dispatchChange(node) {
  node.dispatchEvent(new Event("change", { bubbles: true }));
}

function isVisible(stepId) {
  return document.getElementById(stepId).hidden === false;
}

/** Clicks Next until `stepId` is showing, or gives up (a blocked step stays put). */
function advanceTo(stepId) {
  for (let i = 0; i < STEP_IDS.length + 1 && !isVisible(stepId); i += 1) click("levelUpNext");
  return isVisible(stepId);
}

/** The rendered capacity value for one class on the Spells step. */
function capacityText(classId) {
  const node = document.querySelector(
    `#levelUpSpellsBody .levelUpPreparedCapacityValue[data-class-id="${classId}"]`
  );
  return node ? node.textContent : null;
}

function spellsBodyText() {
  return document.getElementById("levelUpSpellsBody").textContent || "";
}

/** Sets an ASI slot to +1/+1 on the given abilities. */
function chooseAsi(first, second) {
  const selects = [...document.getElementById("levelUpAsiBody").querySelectorAll("select")];
  expect(selects.length).toBeGreaterThanOrEqual(3);
  selects[1].value = first;
  dispatchChange(selects[1]);
  selects[2].value = second;
  dispatchChange(selects[2]);
}

/** Spellbook-addition checkbox rows, keyed by the spell name shown. */
function spellbookRows() {
  const group = [...document.querySelectorAll("#levelUpSpellsBody .builderSpellGroup")]
    .find((node) => (node.querySelector(".builderSpellGroupTitle")?.textContent || "")
      .startsWith("Spellbook additions"));
  if (!group) return [];
  return [...group.querySelectorAll(".builderSpellCheckItem")].map((label) => ({
    name: (label.querySelector("span")?.textContent || "").replace(/ — .*$/, ""),
    input: label.querySelector("input")
  }));
}

function toggle(row) {
  row.input.checked = !row.input.checked;
  dispatchChange(row.input);
}

describe("level up wizard — prepared capacity display", () => {
  /** @type {ReturnType<typeof initLevelUpWizard> | null} */
  let wizard = null;
  let applied = [];
  let setStatus = null;

  function openFor(character) {
    installLevelUpDom();
    applied = [];
    setStatus = vi.fn();
    wizard = initLevelUpWizard({
      root: document,
      Popovers: null,
      rollDie: () => 3,
      onApply: (result) => applied.push(result),
      setStatus
    });
    wizard.open({ character });
    expect(document.getElementById("levelUpOverlay").hidden).toBe(false);
  }

  beforeEach(() => {
    installLevelUpDom();
  });

  afterEach(() => {
    wizard?.destroy();
    wizard = null;
    setActiveCustomContent([]);
  });

  it("shows the override-aware current capacity and the ASI-aware resulting capacity", () => {
    const cleric = builderCharacter({
      base: { wis: 15 },
      subclassByClass: { cleric: "life" },
      overrides: { abilities: { wis: 2 } }
    });
    openFor(cleric);

    expect(advanceTo("levelUpStepAsi")).toBe(true);
    chooseAsi("wis", "wis");
    expect(advanceTo("levelUpStepSpells")).toBe(true);

    // Real Wis 17 (+3) before, 19 (+4) after: 6 → 7 + 1 from the pending ASI.
    expect(capacityText("cleric")).toBe("6 → 8");
    expect(spellsBodyText()).toContain("Prepared capacity");
    expect(spellsBodyText()).toContain("Prepared spells are chosen when finishing a Long Rest, not here.");
  });

  it("makes the informational Spells step available for a multiclass ASI on a class the new level does not touch", () => {
    const character = builderCharacter({
      levels: [...nLevels("cleric", 3), ...nLevels("fighter", 3)],
      base: { wis: 15 },
      subclassByClass: { cleric: "life", fighter: "champion" },
      // A full cantrip list (cleric 3 allows 3), so the *only* thing that can
      // make the Spells step appear is the capacity change — R5-B2 would
      // otherwise open it for the cantrip shortfall and mask what this pins.
      spellcasting: {
        cleric: { cantripIds: ["sacred-flame", "guidance", "light"], knownIds: [], preparedIds: [] }
      }
    });
    openFor(character);

    expect(advanceTo("levelUpStepAsi")).toBe(true);
    // Before the ASI is chosen the appended fighter level changes nothing about
    // spellcasting, so the Spells step is correctly skipped.
    click("levelUpNext");
    expect(isVisible("levelUpStepSpells")).toBe(false);
    expect(isVisible("levelUpStepHp")).toBe(true);

    click("levelUpBack");
    expect(isVisible("levelUpStepAsi")).toBe(true);
    chooseAsi("wis", "wis");
    click("levelUpNext");

    expect(isVisible("levelUpStepSpells")).toBe(true);
    expect(capacityText("cleric")).toBe("5 → 6");
    expect(spellsBodyText()).toContain("Cleric Spellcasting");
  });

  it("shows each prepared class its own capacity in one multiclass flow", () => {
    // Cleric last, so the default "continue as Cleric" appends cleric 4 while
    // the paladin stays at class level 4 with its own half-caster formula.
    const character = builderCharacter({
      levels: [...nLevels("paladin", 4), ...nLevels("cleric", 3)],
      base: { wis: 15, cha: 16 },
      subclassByClass: { cleric: "life" }
    });
    openFor(character);

    expect(advanceTo("levelUpStepSpells")).toBe(true);
    // The cleric's own level advanced; the paladin's did not.
    expect(capacityText("cleric")).toBe("5 → 6");
    expect(capacityText("paladin")).toBeNull();
    expect(spellsBodyText()).toContain("Cleric Spellcasting");
  });

  it("tracks pending wizard spellbook additions live, bounded by the formula", () => {
    const wizardChar = builderCharacter({
      levels: nLevels("wizard", 3),
      base: { int: 16 },
      spellcasting: { wizard: { cantripIds: [], knownIds: ["magic-missile", "shield"], preparedIds: [] } }
    });
    openFor(wizardChar);

    expect(advanceTo("levelUpStepSpells")).toBe(true);
    // Formula 6 → 7, but the two-spell spellbook bounds both sides at 2.
    expect(capacityText("wizard")).toBe("2");

    const rows = spellbookRows();
    expect(rows.length).toBeGreaterThan(2);
    toggle(rows[0]);
    expect(capacityText("wizard")).toBe("2 → 3");
    toggle(rows[1]);
    expect(capacityText("wizard")).toBe("2 → 4");
    toggle(rows[1]);
    expect(capacityText("wizard")).toBe("2 → 3");
    toggle(rows[0]);
    expect(capacityText("wizard")).toBe("2");
  });

  it("stops a formula-bound wizard's capacity at the formula as additions are picked", () => {
    const wizardChar = builderCharacter({
      levels: nLevels("wizard", 4),
      base: { int: 10 },
      spellcasting: {
        wizard: {
          cantripIds: [],
          knownIds: ["magic-missile", "shield", "burning-hands", "detect-magic"],
          preparedIds: []
        }
      }
    });
    openFor(wizardChar);

    expect(advanceTo("levelUpStepSpells")).toBe(true);
    expect(capacityText("wizard")).toBe("4"); // min(formula 4, book 4)

    const rows = spellbookRows();
    expect(rows.length).toBeGreaterThan(1);
    toggle(rows[0]);
    expect(capacityText("wizard")).toBe("4 → 5"); // formula at wizard 5
    toggle(rows[1]);
    expect(capacityText("wizard")).toBe("4 → 5"); // capped, not 6
  });

  it("renders an unknown capacity as unknown, never as zero", () => {
    const cleric = builderCharacter({ subclassByClass: { cleric: "life" } });
    cleric.build.abilities.base.wis = null;
    openFor(cleric);

    expect(advanceTo("levelUpStepSpells")).toBe(true);
    // Positive control: the section rendered, so "unknown" is a real report.
    expect(spellsBodyText()).toContain("Cleric Spellcasting");
    expect(capacityText("cleric")).toBe("unknown");
    expect(capacityText("cleric")).not.toBe("0");
  });

  it("never reads, writes, or offers a prepared selection", () => {
    const cleric = builderCharacter({
      base: { wis: 15 },
      subclassByClass: { cleric: "life" },
      spellcasting: {
        cleric: { cantripIds: ["sacred-flame"], knownIds: [], preparedIds: ["bless"] }
      },
      rest: { hitDiceSpent: { 8: 1 }, preparedByClass: { cleric: ["bless", "command"] } }
    });
    const restBefore = JSON.stringify(cleric.rest);
    const preparedIdsBefore = JSON.stringify(cleric.build.spellcasting.cleric.preparedIds);
    openFor(cleric);

    expect(advanceTo("levelUpStepSpells")).toBe(true);
    // No prepared picker, and the informational note stands in for one.
    expect(spellsBodyText()).not.toContain("Prepared spells (");
    expect(document.querySelectorAll("#levelUpSpellsBody .builderSpellGroup").length).toBeGreaterThan(0);
    expect([...document.querySelectorAll("#levelUpSpellsBody .builderSpellGroupTitle")]
      .map((node) => node.textContent)
      .some((title) => /^Prepared/.test(title))).toBe(false);

    expect(advanceTo("levelUpStepSummary")).toBe(true);
    // R5-B2: one cantrip of the four this level allows, so the first Apply is
    // the under-cap acknowledgement and applies nothing.
    click("levelUpApply");
    expect(applied).toHaveLength(0);
    click("levelUpApply");

    expect(applied).toHaveLength(1);
    const draft = applied[0].build;
    expect(draft.levels).toHaveLength(4);
    expect(JSON.stringify(draft.spellcasting.cleric.preparedIds)).toBe(preparedIdsBefore);
    expect(JSON.stringify(draft)).not.toContain("preparedByClass");
    // The wizard itself mutates nothing: rest play-state is byte-identical
    // after a full run through Apply, and after a cancelled run.
    expect(JSON.stringify(cleric.rest)).toBe(restBefore);

    openFor(cleric);
    expect(advanceTo("levelUpStepSpells")).toBe(true);
    click("levelUpCancel");
    expect(JSON.stringify(cleric.rest)).toBe(restBefore);
  });
});
