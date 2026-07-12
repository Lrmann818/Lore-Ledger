// Generalized class-resource derivation (Level Up Phase 2): definitions
// synthesize from shipped classSpecificByLevel data + featuresByLevel grants,
// explicit custom-class `resources` arrays are authoritative, and derivation
// merges shared pools across a multiclass per the SRD rule.
import { describe, expect, it } from "vitest";

import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import {
  classResourceSeedMarker,
  getClassResourceDefinitions,
  getDerivedClassResources
} from "../js/domain/rules/classResources.js";
import { BUILTIN_CONTENT_REGISTRY, getContentByKind } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;
const NO_MODS = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };

function levelsOf(...classIds) {
  return classIds.map((classId) => ({ classId, hp: null }));
}

function derive(levels, abilityModifiers = NO_MODS) {
  return getDerivedClassResources(levels, registry, abilityModifiers);
}

function poolAt(levels, id, abilityModifiers = NO_MODS) {
  return derive(levels, abilityModifiers).resources.find((resource) => resource.id === id) ?? null;
}

function nLevels(classId, n) {
  return Array.from({ length: n }, () => ({ classId, hp: null }));
}

describe("builtin definition synthesis", () => {
  it("synthesizes the expected pools for every SRD class", () => {
    const expected = {
      barbarian: ["rage"],
      bard: ["bardic-inspiration"],
      cleric: ["channel-divinity"],
      druid: ["wild-shape"],
      fighter: ["action-surge", "indomitable", "second-wind"],
      monk: ["ki-points"],
      paladin: ["lay-on-hands", "channel-divinity"],
      ranger: [],
      rogue: [],
      sorcerer: ["sorcery-points"],
      warlock: ["mystic-arcanum-6th", "mystic-arcanum-7th", "mystic-arcanum-8th", "mystic-arcanum-9th"],
      wizard: ["arcane-recovery"]
    };
    for (const [classId, poolIds] of Object.entries(expected)) {
      const classEntry = getContentByKind(registry, "class", classId);
      const { definitions, warnings } = getClassResourceDefinitions(classEntry);
      expect(warnings).toEqual([]);
      expect(definitions.map((definition) => definition.id).sort())
        .toEqual([...poolIds].sort());
    }
  });

  it("static progression values never become pools", () => {
    const ids = ["barbarian", "bard", "rogue", "ranger"].flatMap((classId) => {
      const classEntry = getContentByKind(registry, "class", classId);
      return getClassResourceDefinitions(classEntry).definitions.map((definition) => definition.id);
    });
    // Rage damage, Bardic die size, Sneak Attack dice, favored enemies/terrain
    // are display/progression values, not limited-use pools.
    expect(ids).not.toContain("rage-damage");
    expect(ids.filter((id) => /sneak|favored|die/.test(id))).toEqual([]);
  });
});

describe("derived pools per class level", () => {
  it("Barbarian Rage follows the data and goes unlimited at 20", () => {
    expect(poolAt(nLevels("barbarian", 1), "rage")).toMatchObject({ max: 2, unlimited: false, recovery: "longRest" });
    expect(poolAt(nLevels("barbarian", 3), "rage")).toMatchObject({ max: 3 });
    expect(poolAt(nLevels("barbarian", 17), "rage")).toMatchObject({ max: 6 });
    expect(poolAt(nLevels("barbarian", 20), "rage")).toMatchObject({ max: null, unlimited: true });
  });

  it("Fighter pools unlock at their data-driven levels", () => {
    const atOne = derive(nLevels("fighter", 1)).resources.map((resource) => resource.id);
    expect(atOne).toContain("second-wind");
    expect(atOne).not.toContain("action-surge");
    expect(atOne).not.toContain("indomitable");
    expect(poolAt(nLevels("fighter", 2), "action-surge")).toMatchObject({ max: 1, recovery: "shortOrLongRest" });
    expect(poolAt(nLevels("fighter", 8), "indomitable")).toBeNull();
    expect(poolAt(nLevels("fighter", 9), "indomitable")).toMatchObject({ max: 1, recovery: "longRest" });
    expect(poolAt(nLevels("fighter", 17), "action-surge")).toMatchObject({ max: 2 });
    expect(poolAt(nLevels("fighter", 1), "second-wind")).toMatchObject({ max: 1, recovery: "shortOrLongRest" });
  });

  it("Monk Ki tracks class level from 2 and recovers on any rest", () => {
    expect(poolAt(nLevels("monk", 1), "ki-points")).toBeNull();
    expect(poolAt(nLevels("monk", 2), "ki-points")).toMatchObject({ max: 2, recovery: "shortOrLongRest" });
    expect(poolAt(nLevels("monk", 11), "ki-points")).toMatchObject({ max: 11 });
  });

  it("Paladin Lay on Hands scales five per level; Channel Divinity arrives at 3", () => {
    expect(poolAt(nLevels("paladin", 1), "lay-on-hands")).toMatchObject({ max: 5, recovery: "longRest" });
    expect(poolAt(nLevels("paladin", 7), "lay-on-hands")).toMatchObject({ max: 35 });
    expect(poolAt(nLevels("paladin", 2), "channel-divinity")).toBeNull();
    expect(poolAt(nLevels("paladin", 3), "channel-divinity")).toMatchObject({ max: 1, recovery: "shortOrLongRest" });
  });

  it("Bardic Inspiration uses the Charisma modifier with a minimum of 1", () => {
    expect(poolAt(nLevels("bard", 1), "bardic-inspiration", { ...NO_MODS, cha: 3 })).toMatchObject({ max: 3 });
    expect(poolAt(nLevels("bard", 1), "bardic-inspiration", { ...NO_MODS, cha: -1 })).toMatchObject({ max: 1 });
    expect(poolAt(nLevels("bard", 1), "bardic-inspiration", { ...NO_MODS, cha: null })).toMatchObject({ max: 1 });
  });

  it("Bardic Inspiration recovery upgrades at bard 5 (Font of Inspiration)", () => {
    expect(poolAt(nLevels("bard", 4), "bardic-inspiration", { ...NO_MODS, cha: 2 }).recovery).toBe("longRest");
    expect(poolAt(nLevels("bard", 5), "bardic-inspiration", { ...NO_MODS, cha: 2 }).recovery).toBe("shortOrLongRest");
  });

  it("Cleric Channel Divinity follows the charge data", () => {
    expect(poolAt(nLevels("cleric", 1), "channel-divinity")).toBeNull();
    expect(poolAt(nLevels("cleric", 2), "channel-divinity")).toMatchObject({ max: 1 });
    expect(poolAt(nLevels("cleric", 6), "channel-divinity")).toMatchObject({ max: 2 });
    expect(poolAt(nLevels("cleric", 18), "channel-divinity")).toMatchObject({ max: 3 });
  });

  it("Warlock Mystic Arcanum pools appear one per spell level", () => {
    const at11 = derive(nLevels("warlock", 11)).resources.map((resource) => resource.id);
    expect(at11).toContain("mystic-arcanum-6th");
    expect(at11).not.toContain("mystic-arcanum-7th");
    const at17 = derive(nLevels("warlock", 17)).resources.filter((resource) => resource.id.startsWith("mystic-arcanum"));
    expect(at17).toHaveLength(4);
    expect(at17.every((resource) => resource.max === 1 && resource.recovery === "longRest")).toBe(true);
  });

  it("Wizard Arcane Recovery is one use per day, not the recovered slot levels", () => {
    expect(poolAt(nLevels("wizard", 1), "arcane-recovery")).toMatchObject({ max: 1, recovery: "longRest" });
    expect(poolAt(nLevels("wizard", 20), "arcane-recovery")).toMatchObject({ max: 1 });
  });

  it("Druid Wild Shape is two uses on a short or long rest from druid 2", () => {
    expect(poolAt(nLevels("druid", 1), "wild-shape")).toBeNull();
    expect(poolAt(nLevels("druid", 2), "wild-shape")).toMatchObject({ max: 2, recovery: "shortOrLongRest" });
  });
});

describe("multiclass merging", () => {
  it("shares Channel Divinity between Cleric and Paladin at the higher maximum", () => {
    const levels = [...nLevels("cleric", 6), ...nLevels("paladin", 3)];
    const pools = derive(levels).resources.filter((resource) => resource.id === "channel-divinity");
    expect(pools).toHaveLength(1);
    expect(pools[0].max).toBe(2); // cleric 6 grants 2; paladin's 1 does not add
    expect(pools[0].classIds.sort()).toEqual(["cleric", "paladin"]);
  });

  it("keeps distinct pools separate in a multiclass", () => {
    const levels = [...nLevels("barbarian", 3), ...nLevels("monk", 2)];
    const { resources } = derive(levels);
    expect(resources.find((resource) => resource.id === "rage")).toMatchObject({ max: 3 });
    expect(resources.find((resource) => resource.id === "ki-points")).toMatchObject({ max: 2 });
  });
});

describe("explicit custom-class resource definitions", () => {
  function customClassEntry(resources) {
    return {
      id: "runeweaver",
      kind: "class",
      name: "Runeweaver",
      source: "custom",
      data: { hitDie: 8, resources }
    };
  }

  it("consumes byClassLevel, constant, multiple, and abilityModifier shapes", () => {
    const { definitions, warnings } = getClassResourceDefinitions(customClassEntry([
      { id: "runes", name: "Runes", max: { type: "byClassLevel", values: [2, 2, 3] }, recovery: "longRest" },
      { id: "focus", name: "Focus", max: { type: "constant", value: 1, startLevel: 2 }, recovery: "shortOrLongRest" },
      { id: "reservoir", name: "Reservoir", max: { type: "classLevelMultiple", multiplier: 3 }, recovery: "longRest" },
      {
        id: "insight-pool", name: "Insight Pool",
        max: { type: "abilityModifier", ability: "wis", minimum: 1 },
        recovery: [{ minClassLevel: 1, recovery: "longRest" }, { minClassLevel: 3, recovery: "shortOrLongRest" }]
      }
    ]));
    expect(warnings).toEqual([]);
    expect(definitions).toHaveLength(4);
  });

  it("an explicit resources array is authoritative, including empty", () => {
    const { definitions } = getClassResourceDefinitions(customClassEntry([]));
    expect(definitions).toEqual([]);
  });

  it("skips malformed definitions with a warning instead of crashing", () => {
    const { definitions, warnings } = getClassResourceDefinitions(customClassEntry([
      { id: "Bad Id!", name: "Broken", max: { type: "constant", value: 1 }, recovery: "longRest" },
      { id: "no-max", name: "No Max", recovery: "longRest" },
      { id: "bad-recovery", name: "Bad Recovery", max: { type: "constant", value: 1 }, recovery: "daily" },
      { id: "good", name: "Good", max: { type: "constant", value: 2 }, recovery: "manual" }
    ]));
    expect(definitions.map((definition) => definition.id)).toEqual(["good"]);
    expect(warnings).toHaveLength(3);
  });
});

describe("deriveCharacter integration", () => {
  it("exposes derivedResources for builder characters", () => {
    const character = makeDefaultBuilderCharacterEntry("Resource Mira");
    character.build.raceId = "human";
    character.build.backgroundId = "acolyte";
    character.build.levels = nLevels("barbarian", 3);
    character.build.abilities.base = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
    const derived = deriveCharacter(character, registry);
    expect(derived.derivedResources.find((resource) => resource.id === "rage"))
      .toMatchObject({ max: 3, recovery: "longRest" });
  });

  it("returns no derived resources for freeform characters", () => {
    const derived = deriveCharacter({ id: "c1", name: "Manual", build: null }, registry);
    expect(derived.derivedResources).toEqual([]);
  });

  it("feature-specific counters stay out of resources (Breath Weapon owns featureUses)", () => {
    const character = makeDefaultBuilderCharacterEntry("Dragonborn Mira");
    character.build.raceId = "dragonborn";
    character.build.backgroundId = "acolyte";
    character.build.levels = nLevels("fighter", 1);
    character.build.choicesByLevel = { "1": { "dragonborn-ancestry": "red" } };
    character.build.abilities.base = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
    const derived = deriveCharacter(character, registry);
    expect(derived.derivedResources.map((resource) => resource.id)).not.toContain("dragonborn-breath-weapon");
    expect(derived.derivedFeatureActions.map((action) => action.id)).toContain("dragonborn-breath-weapon");
  });
});

describe("seed marker", () => {
  it("is stable and keyed by pool id", () => {
    expect(classResourceSeedMarker("rage")).toBe("class-resource:rage");
  });
});
