import { describe, expect, it } from "vitest";

import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import {
  applyLongRest,
  applyShortRest,
  getBuilderPreparedSpellOptions,
  getLongRestHitDiceRecovery,
  getPreparedSpellCapacity,
  recoverCharacterForRest,
  validateBuilderPreparedSpellSelections
} from "../js/domain/characterRest.js";

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

describe("rest Hit Dice and Long Rest state", () => {
  it("spends available Hit Dice, adds Constitution, and clamps healing at maximum HP", () => {
    const character = {
      ...makeCharacter([]),
      hpCur: 5,
      hpMax: 10,
      hitDieAmt: 3,
      hitDieSize: 8,
      abilities: { con: { mod: 2 } },
      rest: { hitDiceSpent: {}, preparedByClass: {} }
    };

    const result = applyShortRest(character, { spendByPool: { manual: 2 } }, { rollDie: () => 4 });

    expect(result.changed).toBe(true);
    expect(result.character.hpCur).toBe(10);
    expect(result.character.rest.hitDiceSpent).toEqual({ manual: 2 });
    expect(result.summary).toMatchObject({ healing: 5, spentByPool: { manual: 2 } });
    expect(character.hpCur).toBe(5);
  });

  it("rejects unavailable Hit Dice without recovering resources or changing HP", () => {
    const character = {
      ...makeCharacter([{ id: "ki", name: "Ki", cur: 0, max: 1, recovery: "shortRest" }]),
      hpCur: 5,
      hpMax: 10,
      hitDieAmt: 1,
      hitDieSize: 8,
      rest: { hitDiceSpent: { manual: 1 }, preparedByClass: {} }
    };

    const result = applyShortRest(character, { spendByPool: { manual: 1 } });

    expect(result).toMatchObject({ changed: false, error: "unavailable-hit-dice" });
    expect(result.character).toBe(character);
    expect(character.resources[0].cur).toBe(0);
  });

  it("auto-recovers Long Rest Hit Dice when one spent pool can receive them", () => {
    const character = {
      ...makeCharacter([]),
      hpCur: 3,
      hpMax: 12,
      hitDieAmt: 5,
      hitDieSize: 8,
      deathSaves: { successes: 2, failures: 1 },
      rest: { hitDiceSpent: { manual: 3 }, preparedByClass: {} },
      spells: { levels: [{ id: "l1", label: "1st Level", hasSlots: true, used: 0, total: 2, spells: [] }] }
    };

    const recovery = getLongRestHitDiceRecovery(character);
    expect(recovery).toMatchObject({ recoveryCap: 2, requiresAllocation: false, automaticRecoveryByPool: { manual: 2 } });

    const result = applyLongRest(character);
    expect(result.changed).toBe(true);
    expect(result.character.hpCur).toBe(12);
    expect(result.character.rest.hitDiceSpent).toEqual({ manual: 1 });
    expect(result.character.deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(result.character.spells.levels[0].used).toBe(2);
  });

  it("requires an allocation only when multiple spent pools leave a real recovery choice", () => {
    const character = makeDefaultBuilderCharacterEntry("Multiclass Rest");
    character.build.levels = [
      { classId: "fighter", hp: 10 },
      { classId: "fighter", hp: 6 },
      { classId: "wizard", hp: 4 },
      { classId: "wizard", hp: 4 }
    ];
    character.build.abilities.base = { str: 10, dex: 10, con: 12, int: 16, wis: 10, cha: 10 };
    character.hpCur = 4;
    character.hpMax = 20;
    character.rest = { hitDiceSpent: { "class:fighter": 2, "class:wizard": 2 }, preparedByClass: {} };

    expect(getLongRestHitDiceRecovery(character)).toMatchObject({ recoveryCap: 2, requiresAllocation: true });
    expect(applyLongRest(character)).toMatchObject({ changed: false, error: "incomplete-hit-dice-allocation" });

    const result = applyLongRest(character, { recoverByPool: { "class:fighter": 1, "class:wizard": 1 } });
    expect(result.changed).toBe(true);
    expect(result.character.rest.hitDiceSpent).toEqual({ "class:fighter": 1, "class:wizard": 1 });
  });

  it("does not let a character at 0 HP gain Long Rest benefits", () => {
    const character = {
      ...makeCharacter([{ id: "rage", name: "Rage", cur: 0, max: 2, recovery: "longRest" }]),
      hpCur: 0,
      hpMax: 12,
      deathSaves: { successes: 1, failures: 2 }
    };
    const result = applyLongRest(character);
    expect(result).toMatchObject({ changed: false, error: "long-rest-requires-positive-hp" });
    expect(result.character).toBe(character);
  });
});

describe("builder prepared spell capacity", () => {
  function preparedCaster(classId, ability, abilityScore, level) {
    const character = makeDefaultBuilderCharacterEntry(`${classId} capacity`);
    character.build.levels = Array.from({ length: level }, () => ({ classId, hp: 4 }));
    character.build.abilities.base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, [ability]: abilityScore };
    character.build.spellcasting = { [classId]: { cantripIds: [], knownIds: [], preparedIds: [] } };
    return character;
  }

  it.each([
    ["cleric", "wis", 16, 3, 6],
    ["druid", "wis", 16, 3, 6],
    ["paladin", "cha", 16, 4, 5],
    ["wizard", "int", 16, 3, 6]
  ])("derives %s prepared capacity from canonical spellcasting data", (classId, ability, score, level, expected) => {
    expect(getPreparedSpellCapacity(preparedCaster(classId, ability, score, level), classId)).toBe(expected);
  });

  it("validates wizard selections against the spellbook and capacity without touching sheet spells", () => {
    const wizard = preparedCaster("wizard", "int", 16, 3);
    wizard.build.spellcasting.wizard.knownIds = ["magic-missile", "shield"];
    wizard.rest = { hitDiceSpent: {}, preparedByClass: { wizard: ["magic-missile"] } };
    wizard.spells = {
      levels: [{ label: "1st Level", spells: [{ name: "Magic Missile", notes: "Keep this note", known: true, prepared: true }] }]
    };

    const options = getBuilderPreparedSpellOptions(wizard).find((entry) => entry.classId === "wizard");
    expect(options.candidateIds).toEqual(expect.arrayContaining(["magic-missile", "shield"]));
    expect(validateBuilderPreparedSpellSelections(wizard, { wizard: ["magic-missile", "shield"] }).ok).toBe(true);
    expect(validateBuilderPreparedSpellSelections(wizard, { wizard: ["fireball"] })).toMatchObject({ ok: false, error: "invalid-prepared-spell:wizard" });
    expect(applyLongRest(wizard, { preparedByClass: { wizard: ["shield"] } }).character.spells).toEqual(wizard.spells);
  });

  it("rejects selections above each prepared caster's derived capacity", () => {
    for (const [classId, ability, score, level] of [
      ["cleric", "wis", 16, 3],
      ["druid", "wis", 16, 3],
      ["paladin", "cha", 16, 4],
      ["wizard", "int", 16, 3]
    ]) {
      const character = preparedCaster(classId, ability, score, level);
      if (classId === "wizard") {
        character.build.spellcasting.wizard.knownIds = [
          "alarm", "burning-hands", "charm-person", "detect-magic",
          "disguise-self", "feather-fall", "find-familiar"
        ];
      }
      const option = getBuilderPreparedSpellOptions(character).find((entry) => entry.classId === classId);
      const overCapacity = option.candidateIds.slice(0, option.capacity + 1);
      expect(overCapacity).toHaveLength(option.capacity + 1);
      expect(validateBuilderPreparedSpellSelections(character, { [classId]: overCapacity }))
        .toMatchObject({ ok: false, error: `prepared-capacity:${classId}` });
    }
  });
});

describe("rest after a Level Up", () => {
  function leveledCaster() {
    // Wizard 2 → 3 applied through the Level Up sheet patch: 1st-level slots
    // grew 3 → 4 with two spent, and 2nd-level slots arrived as a new row.
    const character = makeDefaultBuilderCharacterEntry("Leveled Wizard");
    character.id = "char_leveled_wizard";
    character.build.raceId = "human";
    character.build.backgroundId = "acolyte";
    character.build.levels = [
      { classId: "wizard", hp: null },
      { classId: "wizard", hp: null },
      { classId: "wizard", hp: null }
    ];
    character.build.abilities.base = { str: 8, dex: 14, con: 13, int: 16, wis: 10, cha: 10 };
    character.hpCur = 10;
    character.hpMax = 17;
    character.rest = { hitDiceSpent: {}, preparedByClass: { wizard: ["magic-missile"] } };
    character.spells = {
      levels: [
        { id: "l1", label: "1st Level", hasSlots: true, used: 2, total: 4, collapsed: false, spells: [] },
        { id: "l2", label: "2nd Level", hasSlots: true, used: 0, total: 2, collapsed: false, spells: [] }
      ]
    };
    return character;
  }

  it("Long Rest refills to the new post-level-up slot totals and keeps prepared state", () => {
    const character = leveledCaster();
    const result = applyLongRest(character);

    expect(result.changed).toBe(true);
    const first = result.character.spells.levels.find((level) => level.label === "1st Level");
    const second = result.character.spells.levels.find((level) => level.label === "2nd Level");
    expect(first).toMatchObject({ used: 4, total: 4 });
    expect(second).toMatchObject({ used: 2, total: 2 });
    expect(result.character.rest.preparedByClass).toEqual({ wizard: ["magic-missile"] });
    expect(result.character.hpCur).toBe(17);
  });

  it("Short Rest refills grown Pact Magic slots but not regular slots", () => {
    // Warlock 1 → 2 applied: pact row grew to 2 slots, both spent.
    const character = makeDefaultBuilderCharacterEntry("Leveled Warlock");
    character.id = "char_leveled_warlock";
    character.build.raceId = "human";
    character.build.backgroundId = "acolyte";
    character.build.levels = [
      { classId: "warlock", hp: null },
      { classId: "warlock", hp: null }
    ];
    character.build.abilities.base = { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 16 };
    character.spells = {
      levels: [
        { id: "pact", label: "Pact Magic (1st Level)", hasSlots: true, used: 0, total: 2, collapsed: false, spells: [] },
        { id: "l1", label: "1st Level", hasSlots: true, used: 0, total: 1, collapsed: false, spells: [] }
      ]
    };

    const result = applyShortRest(character);

    expect(result.changed).toBe(true);
    const pact = result.character.spells.levels.find((level) => level.label.includes("Pact"));
    const regular = result.character.spells.levels.find((level) => level.label === "1st Level");
    expect(pact).toMatchObject({ used: 2, total: 2 });
    expect(regular).toMatchObject({ used: 0, total: 1 });
  });
});
