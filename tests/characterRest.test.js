import { describe, expect, it } from "vitest";

import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { recoverCharacterForRest } from "../js/domain/characterRest.js";

function makeCharacter(resources) {
  return {
    id: "char_rest",
    name: "Rest Tester",
    build: null,
    resources
  };
}

function makeDragonbornCharacter(current = 0) {
  const character = makeDefaultBuilderCharacterEntry("Dragonborn Rest Tester");
  character.id = "char_dragonborn_rest";
  character.build.raceId = "dragonborn";
  character.build.classId = "class_fighter";
  character.build.level = 5;
  character.build.abilities.base = { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 };
  character.build.choicesByLevel = { "1": { "dragonborn-ancestry": "blue" } };
  character.featureUses = {
    "dragonborn-breath-weapon": { current }
  };
  return character;
}

describe("recoverCharacterForRest", () => {
  it("shortRest recovers entries tagged shortRest", () => {
    const character = makeCharacter([{ id: "ki", name: "Ki", cur: 1, max: 3, recovery: "shortRest" }]);

    const result = recoverCharacterForRest(character, "shortRest");

    expect(result.changed).toBe(true);
    expect(result.character.resources[0].cur).toBe(3);
  });

  it("shortRest recovers entries tagged shortOrLongRest", () => {
    const character = makeCharacter([{ id: "breath", name: "Breath Weapon", cur: 0, max: 1, recovery: "shortOrLongRest" }]);

    const result = recoverCharacterForRest(character, "shortRest");

    expect(result.changed).toBe(true);
    expect(result.character.resources[0].cur).toBe(1);
  });

  it("shortRest does not recover entries tagged longRest", () => {
    const character = makeCharacter([{ id: "rage", name: "Rage", cur: 1, max: 2, recovery: "longRest" }]);

    const result = recoverCharacterForRest(character, "shortRest");

    expect(result.changed).toBe(false);
    expect(result.character.resources[0].cur).toBe(1);
  });

  it("longRest recovers entries tagged longRest", () => {
    const character = makeCharacter([{ id: "rage", name: "Rage", cur: 1, max: 2, recovery: "longRest" }]);

    const result = recoverCharacterForRest(character, "longRest");

    expect(result.changed).toBe(true);
    expect(result.character.resources[0].cur).toBe(2);
  });

  it("longRest recovers entries tagged shortOrLongRest", () => {
    const character = makeCharacter([{ id: "breath", name: "Breath Weapon", cur: 0, max: 1, recovery: "shortOrLongRest" }]);

    const result = recoverCharacterForRest(character, "longRest");

    expect(result.changed).toBe(true);
    expect(result.character.resources[0].cur).toBe(1);
  });

  it("longRest does not recover entries tagged shortRest", () => {
    const character = makeCharacter([{ id: "ki", name: "Ki", cur: 1, max: 3, recovery: "shortRest" }]);

    const result = recoverCharacterForRest(character, "longRest");

    expect(result.changed).toBe(false);
    expect(result.character.resources[0].cur).toBe(1);
  });

  it("leaves entries with missing, manual, none, or unknown recovery metadata unchanged", () => {
    const resources = [
      { id: "missing", name: "Missing", cur: 1, max: 3 },
      { id: "manual", name: "Manual", cur: 1, max: 3, recovery: "manual" },
      { id: "none", name: "None", cur: 1, max: 3, recovery: "none" },
      { id: "unknown", name: "Unknown", cur: 1, max: 3, recovery: "daily" }
    ];
    const character = makeCharacter(resources);

    const result = recoverCharacterForRest(character, "shortRest");

    expect(result.changed).toBe(false);
    expect(result.character.resources).toEqual(resources);
  });

  it("reports changed false when matching entries are already recovered", () => {
    const character = makeCharacter([{ id: "ki", name: "Ki", cur: 3, max: 3, recovery: "shortRest" }]);

    const result = recoverCharacterForRest(character, "shortRest");

    expect(result.changed).toBe(false);
    expect(result.character).toBe(character);
  });

  it("reports changed true only when at least one value is actually recovered", () => {
    const character = makeCharacter([
      { id: "full", name: "Full", cur: 2, max: 2, recovery: "shortRest" },
      { id: "spent", name: "Spent", cur: 0, max: 1, recovery: "shortRest" },
      { id: "manual", name: "Manual", cur: 0, max: 1, recovery: "manual" }
    ]);

    const result = recoverCharacterForRest(character, "shortRest");

    expect(result.changed).toBe(true);
    expect(result.character.resources.map((resource) => resource.cur)).toEqual([2, 1, 0]);
    expect(character.resources.map((resource) => resource.cur)).toEqual([2, 0, 0]);
  });

  it("shortRest recovers eligible manual feature limited-use counters", () => {
    const character = {
      ...makeCharacter([]),
      manualFeatureCards: [
        {
          id: "feature_second_wind",
          name: "Second Wind",
          sourceType: "Class Feature",
          activation: "Bonus Action",
          rangeArea: "Self",
          saveDc: "",
          damageEffect: "",
          description: "",
          limitedUse: { enabled: true, label: "Second Wind", current: 0, max: 1, recovery: "shortRest" }
        },
        {
          id: "feature_long",
          name: "Long Rest Feature",
          sourceType: "",
          activation: "",
          rangeArea: "",
          saveDc: "",
          damageEffect: "",
          description: "",
          limitedUse: { enabled: true, label: "", current: 0, max: 1, recovery: "longRest" }
        }
      ]
    };

    const result = recoverCharacterForRest(character, "shortRest");

    expect(result.changed).toBe(true);
    expect(result.character.manualFeatureCards.map((card) => card.limitedUse?.current)).toEqual([1, 0]);
    expect(character.manualFeatureCards.map((card) => card.limitedUse?.current)).toEqual([0, 0]);
  });

  it("longRest recovers shortOrLongRest manual feature limited-use counters", () => {
    const character = {
      ...makeCharacter([]),
      manualFeatureCards: [{
        id: "feature_bite",
        name: "Vampiric Bite",
        sourceType: "Lineage",
        activation: "Action",
        rangeArea: "5 ft.",
        saveDc: "",
        damageEffect: "",
        description: "",
        limitedUse: { enabled: true, label: "Empowered Bite", current: 1, max: 2, recovery: "shortOrLongRest" }
      }]
    };

    const result = recoverCharacterForRest(character, "longRest");

    expect(result.changed).toBe(true);
    expect(result.character.manualFeatureCards[0].limitedUse.current).toBe(2);
  });

  it("does not recover manual, none, missing, or disabled manual feature limited-use counters", () => {
    const cards = [
      { id: "manual", name: "Manual", sourceType: "", activation: "", rangeArea: "", saveDc: "", damageEffect: "", description: "", limitedUse: { enabled: true, label: "", current: 0, max: 1, recovery: "manual" } },
      { id: "none", name: "None", sourceType: "", activation: "", rangeArea: "", saveDc: "", damageEffect: "", description: "", limitedUse: { enabled: true, label: "", current: 0, max: 1, recovery: "none" } },
      { id: "missing", name: "Missing", sourceType: "", activation: "", rangeArea: "", saveDc: "", damageEffect: "", description: "" },
      { id: "disabled", name: "Disabled", sourceType: "", activation: "", rangeArea: "", saveDc: "", damageEffect: "", description: "", limitedUse: { enabled: false, label: "", current: 0, max: 1, recovery: "shortRest" } }
    ];
    const character = { ...makeCharacter([]), manualFeatureCards: cards };

    const result = recoverCharacterForRest(character, "shortRest");

    expect(result.changed).toBe(false);
    expect(result.character).toBe(character);
  });

  it("shortRest recovers derived Dragonborn Breath Weapon feature uses", () => {
    const character = makeDragonbornCharacter(0);

    const result = recoverCharacterForRest(character, "shortRest");

    expect(result.changed).toBe(true);
    expect(result.character.featureUses["dragonborn-breath-weapon"].current).toBe(1);
    expect(result.character.manualFeatureCards).toEqual([]);
    expect(result.character.resources).toEqual([]);
    expect(character.featureUses["dragonborn-breath-weapon"].current).toBe(0);
  });

  it("longRest recovers derived Dragonborn Breath Weapon feature uses", () => {
    const character = makeDragonbornCharacter(0);

    const result = recoverCharacterForRest(character, "longRest");

    expect(result.changed).toBe(true);
    expect(result.character.featureUses["dragonborn-breath-weapon"].current).toBe(1);
  });

  it("leaves stale or unavailable feature use entries inert during rest", () => {
    const character = {
      ...makeCharacter([]),
      featureUses: {
        "dragonborn-breath-weapon": { current: 0 },
        "future-feature": { current: 0 }
      }
    };

    const result = recoverCharacterForRest(character, "shortRest");

    expect(result.changed).toBe(false);
    expect(result.character).toBe(character);
  });
});

describe("recoverCharacterForRest — spell slot recovery", () => {
  function makeSpellCharacter(levels) {
    return { ...makeCharacter([]), spells: { levels } };
  }

  it("longRest refills spent slots and clears cast flags without touching known/prepared", () => {
    const character = makeSpellCharacter([
      {
        id: "cantrips", label: "Cantrips", hasSlots: false, used: null, total: null,
        spells: [{ id: "fb", name: "Fire Bolt", expended: true, known: true, prepared: false }]
      },
      {
        id: "l1", label: "1st Level", hasSlots: true, used: 1, total: 4,
        spells: [{ id: "mm", name: "Magic Missile", expended: true, known: true, prepared: true }]
      }
    ]);

    const result = recoverCharacterForRest(character, "longRest");

    expect(result.changed).toBe(true);
    const first = result.character.spells.levels.find((level) => level.label === "1st Level");
    expect(first.used).toBe(4);
    expect(first.spells[0].expended).toBe(false);
    // Known/prepared selections survive the rest.
    expect(first.spells[0].known).toBe(true);
    expect(first.spells[0].prepared).toBe(true);
    // The original character object is not mutated.
    expect(character.spells.levels.find((level) => level.label === "1st Level").used).toBe(1);
  });

  it("longRest leaves slot totals and labels intact (refills to full, not zero)", () => {
    const character = makeSpellCharacter([
      { id: "l2", label: "2nd Level", hasSlots: true, used: 0, total: 3, spells: [] }
    ]);

    const result = recoverCharacterForRest(character, "longRest");

    const second = result.character.spells.levels.find((level) => level.label === "2nd Level");
    expect(second.used).toBe(3);
    expect(second.total).toBe(3);
    expect(second.label).toBe("2nd Level");
  });

  it("shortRest refills only Pact Magic slots, not regular slots", () => {
    const character = makeSpellCharacter([
      { id: "l1", label: "1st Level", hasSlots: true, used: 0, total: 4, spells: [] },
      { id: "pact", label: "Pact Magic (1st Level)", hasSlots: true, used: 0, total: 2, spells: [] }
    ]);

    const result = recoverCharacterForRest(character, "shortRest");

    expect(result.changed).toBe(true);
    const levels = result.character.spells.levels;
    expect(levels.find((level) => level.label === "Pact Magic (1st Level)").used).toBe(2);
    // Regular slots do not recover on a short rest.
    expect(levels.find((level) => level.label === "1st Level").used).toBe(0);
  });

  it("reports no change when all slot levels are already full", () => {
    const character = makeSpellCharacter([
      { id: "l1", label: "1st Level", hasSlots: true, used: 4, total: 4, spells: [] }
    ]);

    const result = recoverCharacterForRest(character, "longRest");

    expect(result.changed).toBe(false);
    expect(result.character).toBe(character);
  });

  it("does not create spell data or report change for characters without slots", () => {
    const character = makeCharacter([]);

    const result = recoverCharacterForRest(character, "longRest");

    expect(result.changed).toBe(false);
    expect(result.character).toBe(character);
  });
});
