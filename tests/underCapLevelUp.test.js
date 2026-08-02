// @vitest-environment jsdom
//
// R5-B2, Level Up side: every Level Up gives the player a genuine opportunity
// to fill both the choices the appended level unlocks and any earlier cantrip,
// known-spell, or wizard-spellbook shortfall, and finishing short requires one
// explicit acknowledgement at the resulting total character level.
//
// Before R5-B2 the Spells step offered only the delta — the count the appended
// level added — so a caster who came in under at an earlier level had no route
// back to it except Edit in Builder, which R5-C retires.
//
// Every negative case carries a positive control, so none can pass merely
// because the Spells step failed to render.

import { afterEach, describe, expect, it, vi } from "vitest";

import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { initLevelUpWizard } from "../js/pages/character/levelUpWizard.js";

/* ------------------------------------------------------------------ */
/* Fixtures + DOM harness (mirrors the #levelUpOverlay markup)         */
/* ------------------------------------------------------------------ */

function nLevels(classId, count) {
  return Array.from({ length: count }, () => ({ classId, hp: 5 }));
}

function builderCharacter({
  levels = nLevels("wizard", 2),
  base = {},
  // Wizard picks its subclass at level 2, so every wizard fixture below is
  // already past that gate: the appended level must not raise the unrelated
  // "choose a subclass" block that would stop the flow before the Summary.
  subclassByClass = { wizard: "evocation" },
  spellcasting = {}
} = {}) {
  const character = makeDefaultBuilderCharacterEntry("Under Cap Probe");
  character.id = "char_undercap";
  character.build.levels = levels;
  character.build.subclassByClass = subclassByClass;
  character.build.spellcasting = spellcasting;
  character.build.choicesByLevel = {};
  character.build.abilities.base = {
    str: 10, dex: 10, con: 10, int: 16, wis: 16, cha: 16, ...base
  };
  character.rest = { hitDiceSpent: {}, preparedByClass: {} };
  return character;
}

const STEP_IDS = Object.freeze([
  "levelUpStepClass", "levelUpStepSubclass", "levelUpStepFeatures",
  "levelUpStepAsi", "levelUpStepSpells", "levelUpStepHp", "levelUpStepSummary"
]);

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

function isVisible(stepId) {
  return document.getElementById(stepId).hidden === false;
}

function advanceTo(stepId) {
  for (let i = 0; i < STEP_IDS.length + 1 && !isVisible(stepId); i += 1) click("levelUpNext");
  return isVisible(stepId);
}

function spellGroups() {
  return [...document.querySelectorAll("#levelUpSpellsBody .builderSpellGroup")];
}

function groupTitled(title) {
  return spellGroups()
    .find((node) => node.querySelector(".builderSpellGroupTitle")?.textContent === title) || null;
}

function countText(groupEl) {
  return groupEl?.querySelector(".builderSpellGroupCount")?.textContent || "";
}

function rows(groupEl) {
  return [...groupEl.querySelectorAll(".builderSpellCheckItem")].map((label) => ({
    name: (label.querySelector("span")?.textContent || ""),
    input: label.querySelector("input"),
    row: label
  }));
}

function toggle(row, checked) {
  row.input.checked = checked;
  row.input.dispatchEvent(new Event("change", { bubbles: true }));
}

function summaryText() {
  return document.getElementById("levelUpSummaryBody").textContent || "";
}

/* ------------------------------------------------------------------ */

describe("level up wizard — under-cap opportunity and acknowledgement", () => {
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

  afterEach(() => {
    wizard?.destroy();
    wizard = null;
  });

  /* ---------------- offering earlier shortfalls ---------------- */

  it("offers this level's new choices AND the earlier ones left unchosen", () => {
    // A wizard 3 → 4 who took only 4 of the 10 spellbook spells and 1 of the 3
    // cantrips it was entitled to. Level 4 allows 12 and 4: this step must let
    // the player fill the 2 the level adds *and* the 6 never taken.
    const character = builderCharacter({
      levels: nLevels("wizard", 3),
      spellcasting: {
        wizard: {
          cantripIds: ["fire-bolt"],
          knownIds: ["magic-missile", "shield", "burning-hands", "detect-magic"],
          preparedIds: []
        }
      }
    });
    openFor(character);
    expect(advanceTo("levelUpStepSpells")).toBe(true);

    const spellbook = groupTitled("Spellbook additions (2)");
    expect(spellbook).toBeTruthy(); // positive control
    expect(countText(spellbook)).toBe("4 / 12 chosen");
    expect(spellbook.textContent).toContain("6 choices are still unused from earlier levels");
    expect(spellbook.textContent).toContain("Choosing fewer than the maximum is allowed");

    const cantrips = groupTitled("New cantrips (1)");
    expect(countText(cantrips)).toBe("1 / 4 chosen");
    expect(cantrips.textContent).toContain("2 choices are still unused from earlier levels");

    // Eight spellbook picks are genuinely accepted; the ninth is refused.
    const all = rows(spellbook);
    expect(all.length).toBeGreaterThan(9); // positive control
    for (let i = 0; i < 9; i += 1) toggle(all[i], true);
    expect(countText(spellbook)).toBe("12 / 12 chosen");
    // The source character is never touched by the draft.
    expect(character.build.spellcasting.wizard.knownIds).toHaveLength(4);
  });

  it("offers an earlier shortfall on a level that grants no new spell choices", () => {
    // Cleric 1 → 2 adds no cantrip (3 → 3) and no known/spellbook category, so
    // before R5-B2 there was nothing to pick here at all.
    const short = builderCharacter({
      levels: nLevels("cleric", 1),
      base: { wis: 14 },
      subclassByClass: { cleric: "life" },
      spellcasting: { cleric: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });
    openFor(short);
    expect(advanceTo("levelUpStepSpells")).toBe(true);
    const cantrips = groupTitled("Cantrips");
    expect(cantrips).toBeTruthy();
    expect(countText(cantrips)).toBe("0 / 3 chosen");
    expect(rows(cantrips).length).toBeGreaterThan(3);
    wizard.destroy();

    // Negative control: the same level with the cantrips already full offers no
    // picker at all. (The step itself still exists for the C2-C capacity row.)
    const full = builderCharacter({
      levels: nLevels("cleric", 1),
      base: { wis: 14 },
      subclassByClass: { cleric: "life" },
      spellcasting: {
        cleric: {
          cantripIds: ["sacred-flame", "guidance", "light"], knownIds: [], preparedIds: []
        }
      }
    });
    openFor(full);
    expect(advanceTo("levelUpStepSpells")).toBe(true);
    expect(groupTitled("Cantrips")).toBeNull();
    expect(spellGroups()).toHaveLength(0);
  });

  it("keeps earlier picks locked while letting new ones be removed", () => {
    const character = builderCharacter({
      levels: nLevels("wizard", 2),
      spellcasting: {
        wizard: { cantripIds: ["fire-bolt"], knownIds: [], preparedIds: [] }
      }
    });
    openFor(character);
    expect(advanceTo("levelUpStepSpells")).toBe(true);
    const cantrips = groupTitled("Cantrips");
    expect(cantrips.textContent).toContain("Already chosen: Fire Bolt");
    // The locked pick is context only — never offered as a removable row.
    expect(rows(cantrips).some((row) => row.name.startsWith("Fire Bolt"))).toBe(false);
    expect(countText(cantrips)).toBe("1 / 3 chosen");

    const pick = rows(cantrips)[0];
    toggle(pick, true);
    expect(countText(cantrips)).toBe("2 / 3 chosen");
    toggle(rows(cantrips).find((row) => row.name === pick.name), false);
    expect(countText(cantrips)).toBe("1 / 3 chosen");
  });

  it("refuses a synthetic over-cap change event on the Level Up picker", () => {
    const character = builderCharacter({
      levels: nLevels("wizard", 2),
      spellcasting: { wizard: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });
    openFor(character);
    expect(advanceTo("levelUpStepSpells")).toBe(true);
    const cantrips = groupTitled("Cantrips");
    const all = rows(cantrips);
    for (let i = 0; i < 3; i += 1) toggle(all[i], true);
    expect(countText(cantrips)).toBe("3 / 3 chosen");

    const blocked = rows(cantrips).find((row) => !row.input.checked);
    expect(blocked.input.disabled).toBe(true); // positive control
    expect(blocked.row.classList.contains("isDisabled")).toBe(true);
    blocked.input.disabled = false;
    toggle(blocked, true);
    expect(countText(cantrips)).toBe("3 / 3 chosen");
    expect(rows(cantrips).find((row) => row.name === blocked.name).input.checked).toBe(false);
  });

  /* ---------------- acknowledgement before Apply ---------------- */

  it("requires one acknowledgement before Apply and reports the resulting level", () => {
    const character = builderCharacter({
      levels: nLevels("wizard", 2),
      spellcasting: { wizard: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });

    openFor(character);
    expect(advanceTo("levelUpStepSummary")).toBe(true);
    expect(summaryText()).toContain("Fewer than the maximum chosen at level 3");
    expect(document.getElementById("levelUpApply").textContent).toBe("Apply");

    click("levelUpApply");
    expect(applied).toHaveLength(0);
    expect(isVisible("levelUpStepSummary")).toBe(true);
    const alert = document.querySelector(".builderUnderCapConfirmation");
    expect(alert).toBeTruthy();
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("this is allowed");
    expect(alert.textContent).toContain("level 3");
    expect(document.getElementById("levelUpApply").textContent).toBe("Apply Anyway");

    click("levelUpApply");
    expect(applied).toHaveLength(1);
    expect(applied[0].underCapAckLevel).toBe(3);
    expect(applied[0].toLevel).toBe(3);
  });

  it("applies with no acknowledgement when every allowance is filled", () => {
    // Wizard 2 → 3 already holding 3 cantrips of 3 and 10 spellbook spells of
    // the 10 level 3 allows.
    const character = builderCharacter({
      levels: nLevels("wizard", 2),
      spellcasting: {
        wizard: {
          cantripIds: ["fire-bolt", "light", "mage-hand"],
          knownIds: [
            "magic-missile", "shield", "burning-hands", "detect-magic",
            "sleep", "charm-person", "mage-armor", "thunderwave",
            "identify", "feather-fall"
          ],
          preparedIds: []
        }
      }
    });
    openFor(character);
    expect(advanceTo("levelUpStepSummary")).toBe(true);
    expect(summaryText()).not.toContain("Fewer than the maximum chosen");
    click("levelUpApply");
    expect(applied).toHaveLength(1);
    expect(applied[0].underCapAckLevel).toBeNull();
    expect(document.querySelector(".builderUnderCapConfirmation")).toBeNull();
  });

  it("invalidates the acknowledgement when a pick changes the resulting shortfall", () => {
    const character = builderCharacter({
      levels: nLevels("wizard", 2),
      spellcasting: { wizard: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });
    openFor(character);
    expect(advanceTo("levelUpStepSummary")).toBe(true);
    click("levelUpApply");
    expect(applied).toHaveLength(0);
    expect(document.getElementById("levelUpApply").textContent).toBe("Apply Anyway");

    // Returning to the Spells step and choosing one more cantrip changes the
    // resulting shortfall, so the acknowledgement no longer applies.
    document.querySelector(".builderSummaryReviewUnderCap")
      .dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    expect(isVisible("levelUpStepSpells")).toBe(true);
    toggle(rows(groupTitled("Cantrips"))[0], true);
    expect(advanceTo("levelUpStepSummary")).toBe(true);
    expect(document.getElementById("levelUpApply").textContent).toBe("Apply");

    click("levelUpApply");
    expect(applied).toHaveLength(0);
    click("levelUpApply");
    expect(applied).toHaveLength(1);
    expect(applied[0].underCapAckLevel).toBe(3);
  });

  it("prompts again at the next level when the character is still short", () => {
    const first = builderCharacter({
      levels: nLevels("wizard", 2),
      spellcasting: { wizard: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });
    openFor(first);
    expect(advanceTo("levelUpStepSummary")).toBe(true);
    click("levelUpApply");
    click("levelUpApply");
    expect(applied[0].underCapAckLevel).toBe(3);
    const leveledBuild = applied[0].build;
    wizard.destroy();

    // The same character one level on, still short, and already carrying the
    // level-3 acknowledgement: it must not silence the level-4 prompt.
    const second = builderCharacter({ levels: nLevels("wizard", 2) });
    second.build = leveledBuild;
    second.underCapAckLevels = [3];
    openFor(second);
    expect(advanceTo("levelUpStepSummary")).toBe(true);
    click("levelUpApply");
    expect(applied).toHaveLength(0);
    expect(document.querySelector(".builderUnderCapConfirmation").textContent)
      .toContain("level 4");
    click("levelUpApply");
    expect(applied).toHaveLength(1);
    expect(applied[0].underCapAckLevel).toBe(4);
  });

  it("writes no acknowledgement on open, navigation, Back, or Cancel", () => {
    const character = builderCharacter({
      levels: nLevels("wizard", 2),
      spellcasting: { wizard: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });
    const before = JSON.stringify(character);
    openFor(character);
    expect(advanceTo("levelUpStepSummary")).toBe(true);
    click("levelUpApply"); // acknowledgement rendered, nothing applied
    click("levelUpBack");
    click("levelUpCancel");

    expect(applied).toHaveLength(0);
    expect(JSON.stringify(character)).toBe(before);
    expect(character.underCapAckLevels).toBeUndefined();
  });

  it("clears the pending acknowledgement when the flow is reopened", () => {
    const character = builderCharacter({
      levels: nLevels("wizard", 2),
      spellcasting: { wizard: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });
    openFor(character);
    expect(advanceTo("levelUpStepSummary")).toBe(true);
    click("levelUpApply");
    expect(document.getElementById("levelUpApply").textContent).toBe("Apply Anyway");
    click("levelUpCancel");

    wizard.open({ character });
    expect(document.getElementById("levelUpApply").textContent).toBe("Apply");
    expect(advanceTo("levelUpStepSummary")).toBe(true);
    click("levelUpApply");
    expect(applied).toHaveLength(0);
  });
});
