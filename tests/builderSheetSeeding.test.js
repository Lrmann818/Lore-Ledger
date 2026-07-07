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
