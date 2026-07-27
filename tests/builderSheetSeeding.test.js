import { afterEach, describe, expect, it } from "vitest";

import { getBuilderFinishSheetSeedPatch } from "../js/domain/builderSheetSeeding.js";
import { makeDefaultBuilderCharacterEntry, makeDefaultCharacterEntry } from "../js/domain/characterHelpers.js";
import { setActiveCustomContent } from "../js/domain/rules/registry.js";

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

    // Loose gear lands in the general Inventory pocket (this cleric picked no pack).
    const gear = patch.inventoryItems.find((item) => item.builderSeed === "starting-gear");
    expect(gear.title).toBe("Inventory");
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

  it("uses rest prepared state over legacy builder prepared ids and marks new managed spell rows", () => {
    const character = makeCasterBuilder();
    character.rest = { hitDiceSpent: {}, preparedByClass: { cleric: ["cure-wounds"] } };

    const patch = getBuilderFinishSheetSeedPatch(character);
    const firstLevel = patch.spells.levels.find((level) => level.label === "1st Level");
    const cureWounds = firstLevel.spells.find((spell) => spell.name === "Cure Wounds");
    const healingWord = firstLevel.spells.find((spell) => spell.name === "Healing Word");

    expect(cureWounds).toMatchObject({ prepared: true, builderSpellId: "cure-wounds" });
    expect(healingWord).toBeUndefined();
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

  it("does not duplicate a renamed seeded weapon attack on re-seed (marker, not name)", () => {
    const character = makeCasterBuilder(); // weaponIds: ["mace"]
    // A previously seeded mace attack the user renamed. The stable marker,
    // not the display name, identifies its source.
    character.attacks = [
      {
        id: "atk_seeded", name: "Blessed Cudgel", bonus: "+4", damage: "1d6+2",
        range: "Melee", type: "Bludgeoning",
        calc: { mode: "weapon", weaponId: "mace", ability: "", proficient: true,
          baseDamage: "", damageAbility: "", addAbilityToDamage: true,
          damageType: "", range: "", attackAdjustment: 0, damageAdjustment: 0 },
        builderSeed: "weapon:mace"
      }
    ];

    const patch = getBuilderFinishSheetSeedPatch(character);
    // No re-seed: the marked attack already covers the mace, so attacks is
    // left untouched (the rename survives, no duplicate is added).
    expect(patch.attacks).toBeUndefined();
  });
});

describe("builder finish seeding — inventory pockets", () => {
  // Barbarian ships an Explorer's Pack plus loose javelins as fixed starting
  // equipment; Acolyte adds common clothes and a pouch.
  function makeBarbarianBuilder() {
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

  const findPocket = (patch, marker) => patch.inventoryItems.find((item) => item.builderSeed === marker);

  it("seeds loose starting gear into the general Inventory pocket", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeBarbarianBuilder());
    const inventory = findPocket(patch, "starting-gear");

    expect(inventory.title).toBe("Inventory");
    const lines = inventory.notes.split("\n");
    expect(lines).toContain("Javelin ×4");
    expect(lines).toContain("Greataxe");
    expect(lines).toContain("Clothes, common");
    expect(lines).toContain("Pouch");
    // The pack is a container, not a loose inventory line.
    expect(inventory.notes).not.toContain("Explorer's Pack");
  });

  it("gives each equipment pack its own pocket listing its SRD contents", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeBarbarianBuilder());
    const pack = findPocket(patch, "pack:explorers-pack");

    expect(pack.title).toBe("Explorer's Pack");
    expect(pack.notes.split("\n")).toEqual([
      "Backpack",
      "Bedroll",
      "Mess Kit",
      "Tinderbox",
      "Torch ×10",
      "Rations (1 day) ×10",
      "Waterskin",
      "Rope, hempen (50 feet)"
    ]);
  });

  it("expands a pack chosen from a starting-equipment option", () => {
    const character = makeBarbarianBuilder();
    character.build.levels = [{ classId: "fighter", hp: null }];
    character.build.equipment = {
      armorId: null,
      shield: false,
      weaponIds: [],
      // Option choices persist only the option label, not an itemId.
      startingChoices: { "class:fighter:1": { optionIndex: "1", label: "Dungeoneer's Pack" } },
      notes: ""
    };

    const patch = getBuilderFinishSheetSeedPatch(character);
    const pack = findPocket(patch, "pack:dungeoneers-pack");

    expect(pack.title).toBe("Dungeoneer's Pack");
    expect(pack.notes).toContain("Crowbar");
    expect(pack.notes).toContain("Piton ×10");
    // The chosen pack label is not also dumped into loose inventory.
    expect(findPocket(patch, "starting-gear")?.notes ?? "").not.toContain("Dungeoneer's Pack");
  });

  it("creates no pack pocket when the build includes no pack", () => {
    const character = makeBarbarianBuilder();
    character.build.levels = [{ classId: "fighter", hp: null }];
    character.build.equipment = {
      armorId: "chain-mail",
      shield: false,
      weaponIds: ["longsword"],
      startingChoices: {},
      notes: ""
    };

    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.inventoryItems.some((item) => String(item.builderSeed || "").startsWith("pack:"))).toBe(false);
    const inventory = findPocket(patch, "starting-gear");
    expect(inventory.title).toBe("Inventory");
    expect(inventory.notes).toContain("Chain Mail");
    expect(inventory.notes).toContain("Longsword");
  });

  it("re-seeds into renamed pockets without duplicating or renaming them", () => {
    const character = makeBarbarianBuilder();
    const first = getBuilderFinishSheetSeedPatch(character);

    // User renames both seeded pockets and clears their notes.
    character.inventoryItems = first.inventoryItems.map((item) => {
      if (item.builderSeed === "starting-gear") return { ...item, title: "Backpack Contents", notes: "" };
      if (item.builderSeed === "pack:explorers-pack") return { ...item, title: "My Kit", notes: "" };
      return item;
    });

    const second = getBuilderFinishSheetSeedPatch(character);
    expect(second.inventoryItems).toHaveLength(character.inventoryItems.length);

    const loose = findPocket(second, "starting-gear");
    const pack = findPocket(second, "pack:explorers-pack");
    // Found again by marker: titles preserved, contents re-appended, no duplicates.
    expect(loose.title).toBe("Backpack Contents");
    expect(loose.notes).toContain("Greataxe");
    expect(pack.title).toBe("My Kit");
    expect(pack.notes).toContain("Bedroll");
    expect(second.inventoryItems.filter((item) => item.builderSeed === "pack:explorers-pack")).toHaveLength(1);
  });

  it("is idempotent on an unchanged re-seed", () => {
    const character = makeBarbarianBuilder();
    character.inventoryItems = getBuilderFinishSheetSeedPatch(character).inventoryItems;

    // Nothing missing → no inventory patch at all.
    expect(getBuilderFinishSheetSeedPatch(character).inventoryItems).toBeUndefined();
  });

  it("does not touch or rename user-created pockets", () => {
    const character = makeBarbarianBuilder();
    character.inventoryItems = [{ id: "inv_user", title: "My Loot", notes: "trinket" }];

    const patch = getBuilderFinishSheetSeedPatch(character);
    const userPocket = patch.inventoryItems.find((item) => item.id === "inv_user");

    expect(userPocket.title).toBe("My Loot");
    expect(userPocket.notes).toBe("trinket");
    expect(userPocket.builderSeed).toBeUndefined();
    // Seeded pockets are created alongside it.
    expect(findPocket(patch, "starting-gear").title).toBe("Inventory");
    expect(findPocket(patch, "pack:explorers-pack").title).toBe("Explorer's Pack");
  });

  it("adopts a legacy 'Starting Gear' pocket as the loose-gear pocket", () => {
    const character = makeBarbarianBuilder();
    character.inventoryItems = [
      { id: "inv_main", title: "Inventory", notes: "50 ft rope" },
      { id: "inv_gear", title: "Starting Gear", notes: "Greataxe" }
    ];

    const patch = getBuilderFinishSheetSeedPatch(character);
    const loose = findPocket(patch, "starting-gear");

    expect(loose.id).toBe("inv_gear");
    expect(loose.title).toBe("Starting Gear");
    expect(loose.notes.match(/Greataxe/g)).toHaveLength(1);
    // The user's own general pocket is left alone.
    expect(patch.inventoryItems.find((item) => item.id === "inv_main").notes).toBe("50 ft rope");
  });
});

describe("builder finish seeding — class resources", () => {
  function makeBarbarian(level = 1) {
    const character = makeDefaultBuilderCharacterEntry("Barb Mira");
    character.build.raceId = "human";
    character.build.backgroundId = "acolyte";
    character.build.levels = Array.from({ length: level }, () => ({ classId: "barbarian", hp: null }));
    character.build.abilities.base = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
    return character;
  }

  it("seeds Rage full with recovery metadata and the stable marker", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeBarbarian(1));
    const rage = patch.resources.find((resource) => resource.builderSeed === "class-resource:rage");
    expect(rage).toMatchObject({ name: "Rage", cur: 2, max: 2, recovery: "longRest" });
  });

  it("adopts a hand-made name-matching tracker instead of duplicating it", () => {
    const character = makeBarbarian(1);
    character.resources = [{ id: "r1", name: "rage", cur: 1, max: 2 }];
    const patch = getBuilderFinishSheetSeedPatch(character);
    const rageEntries = patch.resources.filter((resource) => String(resource.name).toLowerCase() === "rage");
    expect(rageEntries).toHaveLength(1);
    expect(rageEntries[0]).toMatchObject({ id: "r1", cur: 1, max: 2, builderSeed: "class-resource:rage" });
  });

  it("never overwrites user-set max, cur, or recovery on re-seed", () => {
    const character = makeBarbarian(3);
    character.resources = [{
      id: "r1", name: "Rage", cur: 0, max: 99, recovery: "manual", builderSeed: "class-resource:rage"
    }];
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.resources).toBeUndefined();
  });

  it("is idempotent once seeded", () => {
    const character = makeBarbarian(1);
    const first = getBuilderFinishSheetSeedPatch(character);
    const seeded = { ...character, ...first };
    const second = getBuilderFinishSheetSeedPatch(seeded);
    expect(second.resources).toBeUndefined();
  });

  it("seeds ability-formula pools from the derived modifier", () => {
    const character = makeDefaultBuilderCharacterEntry("Bard Mira");
    character.build.raceId = "human";
    character.build.backgroundId = "acolyte";
    character.build.levels = [{ classId: "bard", hp: null }];
    character.build.abilities.base = { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 15 };
    const patch = getBuilderFinishSheetSeedPatch(character);
    const inspiration = patch.resources.find((resource) => resource.builderSeed === "class-resource:bardic-inspiration");
    // Human Cha 16 → +3.
    expect(inspiration).toMatchObject({ cur: 3, max: 3, recovery: "longRest" });
  });

  it("seeds unlimited pools without writing a false maximum", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeBarbarian(20));
    const rage = patch.resources.find((resource) => resource.builderSeed === "class-resource:rage");
    expect(rage).toMatchObject({ max: null, cur: null });
  });

  it("leaves unrelated manual trackers untouched", () => {
    const character = makeBarbarian(1);
    character.resources = [{ id: "r1", name: "Luck Points", cur: 2, max: 3 }];
    const patch = getBuilderFinishSheetSeedPatch(character);
    const luck = patch.resources.find((resource) => resource.name === "Luck Points");
    expect(luck).toMatchObject({ id: "r1", cur: 2, max: 3 });
    expect(luck.builderSeed).toBeUndefined();
    expect(patch.resources.some((resource) => resource.builderSeed === "class-resource:rage")).toBe(true);
  });
});

describe("granted spell access is independent of the prepared list (C1)", () => {
  const grantingSubclass = {
    id: "storm-custom",
    kind: "subclass",
    name: "Storm (custom)",
    classId: "cleric",
    grantedSpells: [{ spellId: "bless", classLevel: 1, grantType: "always_prepared" }]
  };

  function grantedCleric(preparedByClass) {
    const character = makeDefaultBuilderCharacterEntry("Storm Cleric");
    character.build.raceId = "human";
    character.build.backgroundId = "acolyte";
    character.build.levels = Array.from({ length: 3 }, () => ({ classId: "cleric", hp: 5 }));
    character.build.abilities.base = { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 10 };
    character.build.spellcasting = { cleric: { cantripIds: [], knownIds: [], preparedIds: [] } };
    character.build.subclassByClass = { cleric: "storm-custom" };
    character.rest = { hitDiceSpent: {}, preparedByClass };
    return character;
  }

  function seededSpell(character, name) {
    const patch = getBuilderFinishSheetSeedPatch(character);
    return (patch.spells?.levels || [])
      .flatMap((level) => level.spells || [])
      .find((spell) => spell.name === name);
  }

  afterEach(() => {
    setActiveCustomContent([]);
  });

  it("seeds a granted spell as always-prepared whether or not it is in preparedByClass", () => {
    setActiveCustomContent([grantingSubclass]);

    // Legacy save: the redundant granted id is still stored.
    expect(seededSpell(grantedCleric({ cleric: ["bless", "cure-wounds"] }), "Bless"))
      .toMatchObject({ prepared: true, builderGranted: true, known: true });

    // After an active recommit dropped the redundant id, access is unchanged.
    expect(seededSpell(grantedCleric({ cleric: ["cure-wounds"] }), "Bless"))
      .toMatchObject({ prepared: true, builderGranted: true, known: true });

    // And with nothing prepared at all.
    expect(seededSpell(grantedCleric({}), "Bless"))
      .toMatchObject({ prepared: true, builderGranted: true, known: true });
  });

  it("keeps ordinary prepared selections marked prepared alongside the grant", () => {
    setActiveCustomContent([grantingSubclass]);
    const character = grantedCleric({ cleric: ["cure-wounds"] });

    expect(seededSpell(character, "Cure Wounds")).toMatchObject({ prepared: true });
    expect(seededSpell(character, "Cure Wounds").builderGranted).toBeUndefined();
  });
});
