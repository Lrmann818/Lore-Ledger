import { describe, expect, it } from "vitest";

import { getBuilderFinishSheetSeedPatch } from "../js/domain/builderSheetSeeding.js";
import { makeDefaultBuilderCharacterEntry, makeDefaultCharacterEntry } from "../js/domain/characterHelpers.js";

function makeDragonbornBuilder({ ancestryId = "red", features = "", languages = "" } = {}) {
  const character = makeDefaultBuilderCharacterEntry("Dragon Mira");
  character.build.raceId = "dragonborn";
  character.build.levels = [{ classId: "fighter", hp: null }];
  character.build.backgroundId = "acolyte";
  character.build.choicesByLevel = {
    "1": {
      "dragonborn-ancestry": ancestryId
    }
  };
  character.features = features;
  character.languages = languages;
  return character;
}

describe("builder finish sheet seeding", () => {
  it("seeds Dragonborn passive trait text and fixed languages", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeDragonbornBuilder({ ancestryId: "red" }));

    // The Dragonborn slice leads the seeded text; class features follow.
    expect(patch.features.startsWith([
      "Dragonborn Traits",
      "Draconic Ancestry: Red",
      "Damage Resistance: You have resistance to fire damage."
    ].join("\n"))).toBe(true);
    expect(patch.features).toContain("Second Wind (Fighter 1)");
    expect(patch.languages).toBe("Common\nDraconic");
    // The Dragonborn slice owns the ancestry presentation; the generic
    // draconic-ancestry trait text (which restates the breath weapon) is not
    // seeded again.
    expect(patch.features.toLowerCase()).not.toContain("breath weapon");
    expect(patch.features.match(/Draconic Ancestry/g)).toHaveLength(1);
  });

  it("uses the selected ancestry damage type from derivation", () => {
    const bluePatch = getBuilderFinishSheetSeedPatch(makeDragonbornBuilder({ ancestryId: "blue" }));
    const whitePatch = getBuilderFinishSheetSeedPatch(makeDragonbornBuilder({ ancestryId: "white" }));

    expect(bluePatch.features).toContain("Damage Resistance: You have resistance to lightning damage.");
    expect(whitePatch.features).toContain("Damage Resistance: You have resistance to cold damage.");
  });

  it("preserves existing text and appends only missing feature lines", () => {
    const existing = "Custom note  \nDraconic Ancestry: Ruby\nDamage Resistance: House rule";
    const patch = getBuilderFinishSheetSeedPatch(makeDragonbornBuilder({ features: existing }));

    expect(patch.features.startsWith(`${existing}\nDragonborn Traits`)).toBe(true);
    expect(patch.features.match(/Draconic Ancestry:/g)).toHaveLength(1);
    expect(patch.features.match(/Damage Resistance:/g)).toHaveLength(1);
  });

  it("does not duplicate existing languages across case or separators", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeDragonbornBuilder({
      languages: "common, Elvish; DRACONIC\nDwarvish"
    }));

    expect(patch.languages).toBeUndefined();
  });

  it("seeds race languages for non-Dragonborn builders and skips freeform characters", () => {
    const builder = makeDefaultBuilderCharacterEntry("Human Mira");
    builder.build.raceId = "race_human";

    const patch = getBuilderFinishSheetSeedPatch(builder);
    expect(patch.languages).toBe("Common");
    expect(patch.features).toBeUndefined();
    expect(getBuilderFinishSheetSeedPatch(makeDefaultCharacterEntry("Freeform Mira"))).toEqual({});
  });
});

describe("builder finish seeding — feature descriptions", () => {
  function makeDwarfBuilder() {
    const character = makeDefaultBuilderCharacterEntry("Durin");
    character.build.raceId = "dwarf";
    character.build.backgroundId = "acolyte";
    character.build.levels = [{ classId: "fighter", hp: null }];
    return character;
  }

  it("seeds Darkvision with its SRD description, not just the name", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeDwarfBuilder());
    expect(patch.features).toContain("Darkvision (Dwarf)");
    // Description text should ride along on the same line.
    expect(patch.features).toContain("superior vision in dark and dim");
    expect(patch.features).toMatch(/Darkvision \(Dwarf\) — .+superior vision/);
  });

  it("seeds descriptions for class and racial features where the data exists", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeDwarfBuilder());
    // Class feature carries a description.
    expect(patch.features).toMatch(/Second Wind \(Fighter 1\) — .+/);
    // Another racial trait carries a description.
    expect(patch.features).toMatch(/Dwarven Resilience \(Dwarf\) — .+/);
  });

  it("does not duplicate features or overwrite user-edited descriptions on re-seed", () => {
    const character = makeDwarfBuilder();
    const first = getBuilderFinishSheetSeedPatch(character);
    expect(first.features).toBeTruthy();

    // Apply the seed, then let the user rewrite the Darkvision description.
    character.features = first.features.replace(
      /Darkvision \(Dwarf\) — [^\n]*/,
      "Darkvision (Dwarf) — My house-ruled 120 ft darkvision"
    );

    const second = getBuilderFinishSheetSeedPatch(character);
    // Nothing missing → no feature patch, so no duplication and no overwrite.
    expect(second.features).toBeUndefined();
    expect(character.features.match(/Darkvision \(Dwarf\)/g)).toHaveLength(1);
    expect(character.features).toContain("My house-ruled 120 ft darkvision");
  });
});

describe("builder finish seeding — full-sheet integration and edit preservation", () => {
  function makeCasterBuilder() {
    const character = makeDefaultBuilderCharacterEntry("Cleric Mira");
    character.build.raceId = "human";
    character.build.backgroundId = "acolyte";
    character.build.levels = [
      { classId: "cleric", hp: null },
      { classId: "cleric", hp: null },
      { classId: "cleric", hp: null }
    ];
    character.build.subclassByClass = { cleric: "life" };
    character.build.abilities.base = { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 10 };
    character.build.spellcasting = {
      cleric: { cantripIds: ["guidance", "sacred-flame"], knownIds: [], preparedIds: ["healing-word"] }
    };
    character.build.equipment = {
      armorId: "chain-mail",
      shield: true,
      weaponIds: ["mace"],
      startingChoices: {},
      notes: "Holy symbol of the dawn"
    };
    return character;
  }

  it("seeds vitals, spells, attacks, gear, and proficiencies for a caster", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeCasterBuilder());

    // Human CON 15 → +2; cleric d8 ×3 → 8 + 5 + 5 + 6 = 24.
    expect(patch.hpMax).toBe(24);
    expect(patch.hpCur).toBe(24);
    // Chain mail 16 + shield 2.
    expect(patch.ac).toBe(18);
    // WIS 17 → +3, prof +2 → DC 13, attack +5.
    expect(patch.spellDC).toBe(13);
    expect(patch.spellAttack).toBe(5);

    const attack = patch.attacks.find((row) => row.name === "Mace");
    expect(attack).toMatchObject({ bonus: "+4", damage: "1d6+2", type: "Bludgeoning" });

    const labels = patch.spells.levels.map((level) => level.label);
    expect(labels).toContain("Cantrips");
    expect(labels).toContain("1st Level");
    // Cantrips first, then ascending spell levels.
    expect(labels[0]).toBe("Cantrips");
    expect(labels.indexOf("Cantrips")).toBeLessThan(labels.indexOf("1st Level"));
    expect(labels.indexOf("1st Level")).toBeLessThan(labels.indexOf("2nd Level"));
    const firstLevel = patch.spells.levels.find((level) => level.label === "1st Level");
    expect(firstLevel.total).toBe(4);
    const spellNames = firstLevel.spells.map((spell) => spell.name);
    expect(spellNames).toContain("Healing Word");
    // Life domain grants Bless + Cure Wounds as always prepared.
    expect(spellNames).toContain("Bless");
    expect(spellNames).toContain("Cure Wounds");

    const gear = patch.inventoryItems.find((item) => item.title === "Starting Gear");
    expect(gear.notes).toContain("Chain Mail");
    expect(gear.notes).toContain("Shield");
    expect(gear.notes).toContain("Mace");
    expect(gear.notes).toContain("Holy symbol of the dawn");

    // Cleric base proficiencies; Life domain's heavy armor arrives as a
    // prose Bonus Proficiency feature, not structured data (see report).
    expect(patch.armorProf).toContain("Medium armor");
    expect(patch.armorProf).toContain("Shields");
    expect(patch.weaponProf).toContain("Simple weapons");
  });

  it("preserves user data when re-seeding an edited character", () => {
    const character = makeCasterBuilder();
    // Simulate an existing sheet with user-owned values and content.
    character.hpMax = 40;
    character.hpCur = 12;
    character.ac = 20;
    character.spellDC = 19;
    character.features = "My custom note";
    character.attacks = [
      { id: "atk_custom", name: "Mace", bonus: "+9", damage: "1d6+5", range: "Melee", type: "Bludgeoning" }
    ];
    character.spells = {
      levels: [{
        id: "lvl_user",
        label: "1st Level",
        hasSlots: true,
        used: 1,
        total: 2,
        collapsed: false,
        spells: [{ id: "sp_user", name: "Healing Word", known: true, prepared: true, expended: true }]
      }]
    };
    character.inventoryItems = [
      { id: "inv_main", title: "Inventory", notes: "50 ft rope" },
      { id: "inv_gear", title: "Starting Gear", notes: "Chain Mail" }
    ];

    const patch = getBuilderFinishSheetSeedPatch(character);

    // Filled vitals are never overwritten.
    expect(patch.hpMax).toBeUndefined();
    expect(patch.hpCur).toBeUndefined();
    expect(patch.ac).toBeUndefined();
    expect(patch.spellDC).toBeUndefined();

    // Existing attack with the same name is kept, not duplicated.
    expect(patch.attacks).toBeUndefined();

    // Existing spell level keeps its slot usage and spell flags; only
    // missing spells are appended.
    const firstLevel = patch.spells.levels.find((level) => level.label === "1st Level");
    expect(firstLevel.used).toBe(1);
    expect(firstLevel.total).toBe(2);
    const healingWords = firstLevel.spells.filter((spell) => spell.name === "Healing Word");
    expect(healingWords).toHaveLength(1);
    expect(healingWords[0].expended).toBe(true);
    expect(firstLevel.spells.map((spell) => spell.name)).toContain("Bless");

    // The gear tab appends only missing lines; other tabs are untouched.
    const gear = patch.inventoryItems.find((item) => item.title === "Starting Gear");
    expect(gear.notes.startsWith("Chain Mail")).toBe(true);
    expect(gear.notes.match(/Chain Mail/g)).toHaveLength(1);
    const main = patch.inventoryItems.find((item) => item.title === "Inventory");
    expect(main.notes).toBe("50 ft rope");

    // Existing feature text is preserved at the start.
    expect(patch.features.startsWith("My custom note")).toBe(true);
  });
});

describe("builder finish seeding — inventory pocket naming", () => {
  function makeBarbarianBuilder() {
    // Barbarian ships an Explorer's Pack as fixed starting equipment.
    const character = makeDefaultBuilderCharacterEntry("Grog");
    character.build.raceId = "human";
    character.build.backgroundId = "acolyte";
    character.build.levels = [{ classId: "barbarian", hp: null }];
    character.build.equipment = {
      armorId: null,
      shield: false,
      weaponIds: ["greataxe"],
      startingChoices: {},
      notes: ""
    };
    return character;
  }

  it("names the starting-gear pocket after the pack when one is known", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeBarbarianBuilder());
    const pocket = patch.inventoryItems.find((item) => item.builderSeed === "starting-gear");
    expect(pocket).toBeTruthy();
    expect(pocket.title).toBe("Explorer's Pack");
    expect(pocket.notes).toContain("Explorer's Pack");
  });

  it("falls back to a generic pocket name when no pack is present", () => {
    const character = makeBarbarianBuilder();
    // A wizard-less build with only armor/weapon and no pack source.
    character.build.levels = [{ classId: "fighter", hp: null }];
    character.build.equipment = {
      armorId: "chain-mail",
      shield: false,
      weaponIds: ["longsword"],
      startingChoices: {},
      notes: ""
    };
    const patch = getBuilderFinishSheetSeedPatch(character);
    const pocket = patch.inventoryItems.find((item) => item.builderSeed === "starting-gear");
    expect(pocket.title).toBe("Starting Gear");
  });

  it("names a pocket after a pack chosen from a starting-equipment option", () => {
    const character = makeBarbarianBuilder();
    character.build.levels = [{ classId: "fighter", hp: null }];
    character.build.equipment = {
      armorId: null,
      shield: false,
      weaponIds: [],
      startingChoices: { "class:fighter:1": { optionIndex: "1", label: "Dungeoneer's Pack" } },
      notes: ""
    };
    const patch = getBuilderFinishSheetSeedPatch(character);
    const pocket = patch.inventoryItems.find((item) => item.builderSeed === "starting-gear");
    expect(pocket.title).toBe("Dungeoneer's Pack");
  });

  it("preserves a user-renamed pocket and appends to it on re-seed without duplicating", () => {
    const character = makeBarbarianBuilder();
    const first = getBuilderFinishSheetSeedPatch(character);
    character.inventoryItems = first.inventoryItems;

    // User renames the seeded pocket and clears its notes.
    const pocketIndex = character.inventoryItems.findIndex((item) => item.builderSeed === "starting-gear");
    character.inventoryItems[pocketIndex] = {
      ...character.inventoryItems[pocketIndex],
      title: "My Backpack",
      notes: ""
    };

    const second = getBuilderFinishSheetSeedPatch(character);
    expect(second.inventoryItems).toBeDefined();
    const seededPockets = second.inventoryItems.filter((item) => item.builderSeed === "starting-gear");
    // Found again by marker — appended to the renamed pocket, not duplicated.
    expect(seededPockets).toHaveLength(1);
    expect(seededPockets[0].title).toBe("My Backpack");
    expect(seededPockets[0].notes).toContain("Explorer's Pack");
    expect(second.inventoryItems).toHaveLength(character.inventoryItems.length);
  });

  it("does not rename existing user-created pockets", () => {
    const character = makeBarbarianBuilder();
    character.inventoryItems = [
      { id: "inv_user", title: "My Loot", notes: "trinket" }
    ];
    const patch = getBuilderFinishSheetSeedPatch(character);
    const userPocket = patch.inventoryItems.find((item) => item.id === "inv_user");
    expect(userPocket.title).toBe("My Loot");
    expect(userPocket.notes).toBe("trinket");
    expect(userPocket.builderSeed).toBeUndefined();
    // A separate seeded pocket is created instead.
    expect(patch.inventoryItems.some((item) => item.builderSeed === "starting-gear")).toBe(true);
  });
});
