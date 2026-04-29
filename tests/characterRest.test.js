import { describe, expect, it } from "vitest";

import { recoverCharacterForRest } from "../js/domain/characterRest.js";

function makeCharacter(resources) {
  return {
    id: "char_rest",
    name: "Rest Tester",
    build: null,
    resources
  };
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
});
