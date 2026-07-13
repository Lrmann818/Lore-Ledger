import { describe, expect, it } from "vitest";

import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import {
  appendLevel,
  checkMulticlassPrerequisites,
  collectAsiChoices,
  collectFeatEffects,
  computeArmorClass,
  computeMaxHp,
  getAsiSlots,
  getBuildFeatures,
  getClassLevelTotals,
  getCombinedSpellSlots,
  getSavingThrowProficiencies,
  getSpellcastingClasses,
  materializeLevels,
  normalizeBuildLevels,
  removeLevelAt,
  setLevelClassAt,
  setLevelHpAt,
  setSingleClassId,
  setSingleClassTotalLevel
} from "../js/domain/rules/progression.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;

function levelsOf(...classIds) {
  return classIds.map((classId) => ({ classId, hp: null }));
}

function makeBuilder({ raceId = "human", levels = levelsOf("fighter"), base, subclassByClass = {}, choicesByLevel = {}, equipment, backgroundId = "acolyte" } = {}) {
  const character = makeDefaultBuilderCharacterEntry("Rules Mira");
  character.build.raceId = raceId;
  character.build.backgroundId = backgroundId;
  character.build.levels = levels;
  character.build.subclassByClass = subclassByClass;
  character.build.choicesByLevel = choicesByLevel;
  if (base) character.build.abilities.base = { ...base };
  if (equipment) character.build.equipment = { ...character.build.equipment, ...equipment };
  return character;
}

describe("multiclass level totals and proficiency bonus", () => {
  it("totals class levels in acquisition order", () => {
    const levels = levelsOf("fighter", "fighter", "wizard", "fighter", "wizard");
    expect(getClassLevelTotals(levels)).toEqual([
      { classId: "fighter", level: 3 },
      { classId: "wizard", level: 2 }
    ]);
  });

  it("derives total level and proficiency bonus from the level plan", () => {
    const derived = deriveCharacter(makeBuilder({
      levels: levelsOf("fighter", "fighter", "fighter", "wizard", "wizard")
    }));
    expect(derived.totalLevel).toBe(5);
    expect(derived.proficiencyBonus).toBe(3);
    expect(derived.labels.classLevel).toBe("Fighter 3 / Wizard 2");
  });

  it("caps the level plan at 20 levels", () => {
    const build = { levels: Array.from({ length: 30 }, () => ({ classId: "fighter" })) };
    expect(normalizeBuildLevels(build)).toHaveLength(20);
  });
});

describe("saving throws (multiclass first-class rule)", () => {
  it("grants saves only from the first class", () => {
    expect(getSavingThrowProficiencies(levelsOf("fighter", "wizard"), registry)).toEqual(["str", "con"]);
    expect(getSavingThrowProficiencies(levelsOf("wizard", "fighter"), registry)).toEqual(["int", "wis"]);
  });

  it("computes save totals with proficiency", () => {
    const derived = deriveCharacter(makeBuilder({
      levels: levelsOf("fighter", "fighter", "fighter", "fighter", "fighter"),
      base: { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 10 }
    }));
    // Human +1 all: STR 17 (+3) + prof 3 = +6; DEX 11 (+0), not proficient.
    expect(derived.saves.str).toMatchObject({ proficient: true, total: 6 });
    expect(derived.saves.dex).toMatchObject({ proficient: false, total: 0 });
  });
});

describe("hit points", () => {
  it("uses max die at level 1 and averages afterwards", () => {
    // Fighter d10: L1 = 10, L2-3 average 6 each; CON mod +2 per level.
    const result = computeMaxHp(levelsOf("fighter", "fighter", "fighter"), 2, registry);
    expect(result.max).toBe(10 + 6 + 6 + 3 * 2);
    expect(result.breakdown.map((row) => row.source)).toEqual(["max", "roll" === "x" ? "roll" : "average", "average"]);
  });

  it("uses recorded rolls when present", () => {
    const levels = [
      { classId: "fighter", hp: null },
      { classId: "fighter", hp: 7 },
      { classId: "wizard", hp: 3 }
    ];
    const result = computeMaxHp(levels, 1, registry);
    expect(result.max).toBe(10 + 7 + 3 + 3 * 1);
    expect(result.breakdown[1].source).toBe("roll");
    expect(result.breakdown[2].die).toBe(6);
  });

  it("applies per-level bonuses from custom feat effects", () => {
    const result = computeMaxHp(levelsOf("wizard", "wizard"), 0, registry, { perLevelBonus: 2 });
    expect(result.max).toBe(6 + 4 + 2 * 2);
  });

  it("derives hp.max on the character (con applied per level)", () => {
    const derived = deriveCharacter(makeBuilder({
      levels: levelsOf("barbarian", "barbarian"),
      base: { str: 15, dex: 10, con: 15, int: 10, wis: 10, cha: 10 }
    }));
    // Human CON 16 → +3. Barbarian d12: 12 + 7 + 2×3 = 25.
    expect(derived.hp.max).toBe(25);
    expect(derived.hitDice).toEqual([{ classId: "barbarian", die: 12, count: 2 }]);
  });
});

describe("skills and passive perception", () => {
  it("derives class, background, and expertise skill proficiency", () => {
    const derived = deriveCharacter(makeBuilder({
      levels: levelsOf("rogue"),
      base: { str: 10, dex: 16, con: 10, int: 10, wis: 12, cha: 10 },
      choicesByLevel: {
        "1": {
          "class-skill-rogue": ["stealth", "acrobatics", "athletics", "deception"],
          "feature-rogue-expertise-1": ["stealth", "athletics"]
        }
      }
    }));
    // Dex 17 (+3), prof +2 → stealth expertise = 3 + 4 = 7.
    expect(derived.skills.stealth).toMatchObject({ level: "expert", total: 7 });
    expect(derived.skills.acrobatics).toMatchObject({ level: "prof", total: 5 });
    // Acolyte background grants Insight + Religion.
    expect(derived.skills.insight.level).toBe("prof");
    expect(derived.skills.religion.level).toBe("prof");
    // Passive perception = 10 + perception total (Wis 13 → +1, no prof).
    expect(derived.passivePerception).toBe(11);
  });
});

describe("armor class", () => {
  const mods = (overrides = {}) => ({ str: 0, dex: 2, con: 3, int: 0, wis: 1, cha: 0, ...overrides });

  it("computes armored AC with dex caps and shields", () => {
    const chainMail = registry.byKindId.get("armor:chain-mail");
    const leather = registry.byKindId.get("armor:leather-armor");
    const halfPlate = registry.byKindId.get("armor:half-plate-armor");
    const shield = registry.byKindId.get("armor:shield");
    expect(computeArmorClass({ abilityModifiers: mods(), armorEntry: chainMail, hasShield: false, featureIds: [] }).value).toBe(16);
    expect(computeArmorClass({ abilityModifiers: mods(), armorEntry: leather, hasShield: true, shieldEntry: shield, featureIds: [] }).value).toBe(11 + 2 + 2);
    expect(computeArmorClass({ abilityModifiers: mods({ dex: 4 }), armorEntry: halfPlate, hasShield: false, featureIds: [] }).value).toBe(15 + 2);
  });

  it("applies unarmored defense formulas", () => {
    expect(computeArmorClass({
      abilityModifiers: mods(), armorEntry: null, hasShield: false,
      featureIds: ["barbarian-unarmored-defense"]
    }).value).toBe(10 + 2 + 3);
    expect(computeArmorClass({
      abilityModifiers: mods(), armorEntry: null, hasShield: false,
      featureIds: ["monk-unarmored-defense"]
    }).value).toBe(10 + 2 + 1);
  });

  it("ignores shields for Monk Unarmored Defense but not Barbarian", () => {
    const monk = computeArmorClass({
      abilityModifiers: mods(), armorEntry: null, hasShield: true, shieldEntry: null,
      featureIds: ["monk-unarmored-defense"]
    });
    const barbarian = computeArmorClass({
      abilityModifiers: mods(), armorEntry: null, hasShield: true, shieldEntry: null,
      featureIds: ["barbarian-unarmored-defense"]
    });
    // Monk 10+2+1 = 13 vs base 10+2+2 = 14 with shield → best is 14 (base+shield).
    expect(monk.value).toBe(14);
    expect(barbarian.value).toBe(10 + 2 + 3 + 2);
  });

  it("falls back to 10 + dex", () => {
    expect(computeArmorClass({ abilityModifiers: mods(), armorEntry: null, hasShield: false, featureIds: [] }).value).toBe(12);
  });

  it("derives AC from build equipment on the character", () => {
    const derived = deriveCharacter(makeBuilder({
      levels: levelsOf("fighter"),
      base: { str: 15, dex: 13, con: 13, int: 10, wis: 10, cha: 10 },
      equipment: { armorId: "chain-mail", shield: true }
    }));
    expect(derived.ac.value).toBe(16 + 2);
  });
});

describe("initiative and spell stats", () => {
  it("derives initiative from dex and overrides", () => {
    const character = makeBuilder({ base: { str: 10, dex: 15, con: 10, int: 10, wis: 10, cha: 10 } });
    character.overrides.initiative = 2;
    // Human dex 16 → +3, override +2.
    expect(deriveCharacter(character).initiative).toBe(5);
  });

  it("derives spell save DC and attack per class", () => {
    const derived = deriveCharacter(makeBuilder({
      levels: levelsOf("wizard", "wizard", "wizard", "wizard", "wizard"),
      base: { str: 10, dex: 10, con: 10, int: 17, wis: 10, cha: 10 }
    }));
    // Human INT 18 → +4, prof +3 → DC 15, attack +7.
    const wizard = derived.spellcasting.classes.find((info) => info.classId === "wizard");
    expect(wizard.saveDc).toBe(15);
    expect(wizard.attackBonus).toBe(7);
    expect(wizard.preparationMode).toBe("spellbook");
    expect(wizard.preparedMax).toBe(5 + 4);
    expect(wizard.cantripsKnownMax).toBe(4);
  });
});

describe("spell slots", () => {
  it("uses the class table for a single full caster", () => {
    const result = getCombinedSpellSlots(levelsOf("wizard", "wizard", "wizard", "wizard", "wizard"), registry);
    expect(result.slots).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
    expect(result.pact).toBeNull();
  });

  it("gives half casters no slots at level 1 and slots at level 2", () => {
    expect(getCombinedSpellSlots(levelsOf("paladin"), registry).slots).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(getCombinedSpellSlots(levelsOf("paladin", "paladin"), registry).slots).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("tracks warlock pact magic separately", () => {
    const result = getCombinedSpellSlots(levelsOf("warlock", "warlock", "warlock"), registry);
    expect(result.slots).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(result.pact).toEqual({ slots: 2, slotLevel: 2 });
  });

  it("combines multiclass casters on the shared table", () => {
    // Wizard 3 + Cleric 2 → caster level 5 → 4/3/2.
    const result = getCombinedSpellSlots(
      levelsOf("wizard", "wizard", "wizard", "cleric", "cleric"), registry);
    expect(result.casterLevel).toBe(5);
    expect(result.slots).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
  });

  it("rounds half casters down in multiclass caster level", () => {
    // Wizard 3 + Paladin 3 → 3 + floor(3/2) = 4 → 4/3.
    const result = getCombinedSpellSlots(
      levelsOf("wizard", "wizard", "wizard", "paladin", "paladin", "paladin"), registry);
    expect(result.casterLevel).toBe(4);
    expect(result.slots).toEqual([4, 3, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("keeps pact magic separate alongside multiclass slots", () => {
    const result = getCombinedSpellSlots(
      levelsOf("wizard", "wizard", "warlock", "warlock"), registry);
    expect(result.casterLevel).toBe(2);
    expect(result.slots).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(result.pact).toEqual({ slots: 2, slotLevel: 1 });
  });

  it("reports known-spell caps for known casters", () => {
    const [bard] = getSpellcastingClasses(levelsOf("bard", "bard", "bard"), registry);
    expect(bard.spellsKnownMax).toBe(6);
    expect(bard.preparationMode).toBe("known");
  });
});

describe("ASI slots and feats", () => {
  it("finds ASI slots at class-specific levels", () => {
    const levels = levelsOf(...Array(6).fill("fighter"));
    expect(getAsiSlots(levels, registry).map((slot) => slot.characterLevel)).toEqual([4, 6]);
  });

  it("locates ASI slots per class in multiclass builds", () => {
    // Fighter 4 then wizard 4: fighter ASI at character level 4,
    // wizard ASI when wizard hits class level 4 (character level 8).
    const levels = levelsOf("fighter", "fighter", "fighter", "fighter", "wizard", "wizard", "wizard", "wizard");
    expect(getAsiSlots(levels, registry)).toEqual([
      { characterLevel: 4, classId: "fighter", classLevel: 4 },
      { characterLevel: 8, classId: "wizard", classLevel: 4 }
    ]);
  });

  it("collects ASI increases and feat picks from choices", () => {
    const { abilityIncreases, featIds } = collectAsiChoices({
      "asi-4": { type: "asi", increases: { str: 2 } },
      "asi-6": { type: "asi", increases: { str: 1, con: 1 } },
      "asi-8": { type: "feat", featId: "grappler" }
    });
    expect(abilityIncreases).toEqual({ str: 3, con: 1 });
    expect(featIds).toEqual(["grappler"]);
  });

  it("applies ASI increases to derived ability totals", () => {
    const derived = deriveCharacter(makeBuilder({
      levels: levelsOf("fighter", "fighter", "fighter", "fighter"),
      base: { str: 15, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      choicesByLevel: { "4": { "asi-4": { type: "asi", increases: { str: 2 } } } }
    }));
    // 15 base + 1 human + 2 ASI = 18.
    expect(derived.abilities.str).toMatchObject({ total: 18, modifier: 4 });
  });

  it("interprets the custom feat effects vocabulary", () => {
    const effects = collectFeatEffects([
      {
        id: "custom-tough", kind: "feat", name: "Tough", source: "custom",
        data: {
          effects: [
            { type: "hp_per_level_bonus", value: 2 },
            { type: "ability_bonus", ability: "con", value: 1 },
            { type: "speed_bonus", value: 5 },
            { type: "ac_bonus", value: 1 },
            { type: "initiative_bonus", value: 2 },
            { type: "save_proficiency", ability: "wis" },
            { type: "skill_proficiency", skill: "athletics" },
            { type: "unknown_effect", value: 99 }
          ]
        }
      }
    ]);
    expect(effects.hpPerLevelBonus).toBe(2);
    expect(effects.abilityBonuses).toEqual({ con: 1 });
    expect(effects.speedBonus).toBe(5);
    expect(effects.acBonus).toBe(1);
    expect(effects.initiativeBonus).toBe(2);
    expect(effects.saveProficiencies).toEqual(["wis"]);
    expect(effects.skillProficiencies).toEqual(["athletics"]);
  });
});

describe("multiclass prerequisites", () => {
  it("checks AND prerequisites", () => {
    expect(checkMulticlassPrerequisites("wizard", { int: 13 }, registry).ok).toBe(true);
    expect(checkMulticlassPrerequisites("wizard", { int: 12 }, registry)).toMatchObject({ ok: false });
    expect(checkMulticlassPrerequisites("paladin", { str: 13, cha: 13 }, registry).ok).toBe(true);
    expect(checkMulticlassPrerequisites("paladin", { str: 13, cha: 12 }, registry).ok).toBe(false);
  });

  it("checks OR prerequisites (fighter STR 13 or DEX 13)", () => {
    expect(checkMulticlassPrerequisites("fighter", { str: 13, dex: 8 }, registry).ok).toBe(true);
    expect(checkMulticlassPrerequisites("fighter", { str: 8, dex: 13 }, registry).ok).toBe(true);
    expect(checkMulticlassPrerequisites("fighter", { str: 8, dex: 8 }, registry).ok).toBe(false);
  });
});

describe("subclass features and granted spells", () => {
  it("derives subclass features and always-prepared domain spells", () => {
    const derived = deriveCharacter(makeBuilder({
      levels: levelsOf("cleric", "cleric", "cleric"),
      base: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
      subclassByClass: { cleric: "life" }
    }));
    expect(derived.labels.classLevel).toBe("Cleric (Life) 3");
    expect(derived.features.some((feature) => feature.featureId === "disciple-of-life")).toBe(true);
    const grantedIds = derived.grantedSpells.map((grant) => grant.spellId);
    expect(grantedIds).toContain("bless");
    expect(grantedIds).toContain("cure-wounds");
    expect(grantedIds).toContain("lesser-restoration");
  });
});

describe("ordered level operations preserve exact multiclass order", () => {
  // Concrete interleaved build: Fighter 1 → Wizard 1 → Fighter 2.
  function interleaved() {
    return {
      version: 2,
      ruleset: "srd-5.1",
      raceId: "human",
      backgroundId: "acolyte",
      levels: [
        { classId: "fighter", hp: null },
        { classId: "wizard", hp: 4 },
        { classId: "fighter", hp: 7 }
      ],
      subclassByClass: {},
      spellcasting: {},
      choicesByLevel: {}
    };
  }

  it("appendLevel keeps the interleaved order and appends at the end", () => {
    const build = interleaved();
    expect(appendLevel(build, "wizard")).toBe(true);
    expect(build.levels.map((row) => row.classId)).toEqual(["fighter", "wizard", "fighter", "wizard"]);
    // Existing HP rolls stay attached to their original character levels.
    expect(build.levels[1].hp).toBe(4);
    expect(build.levels[2].hp).toBe(7);
    expect(build.levels[3].hp).toBeNull();
  });

  it("setLevelHpAt updates one level in place without reordering", () => {
    const build = interleaved();
    expect(setLevelHpAt(build, 2, 9)).toBe(true);
    expect(build.levels.map((row) => row.classId)).toEqual(["fighter", "wizard", "fighter"]);
    expect(build.levels[2].hp).toBe(9);
    expect(build.levels[1].hp).toBe(4);
    // Blank clears back to average.
    expect(setLevelHpAt(build, 2, "")).toBe(true);
    expect(build.levels[2].hp).toBeNull();
  });

  it("setLevelClassAt changes only the targeted level", () => {
    const build = interleaved();
    expect(setLevelClassAt(build, 1, "rogue")).toBe(true);
    expect(build.levels.map((row) => row.classId)).toEqual(["fighter", "rogue", "fighter"]);
    // No-op when unchanged.
    expect(setLevelClassAt(build, 0, "fighter")).toBe(false);
  });

  it("removeLevelAt removes one level and preserves the order of the rest", () => {
    const build = interleaved();
    expect(removeLevelAt(build, 1)).toBe(true);
    expect(build.levels.map((row) => row.classId)).toEqual(["fighter", "fighter"]);
    expect(build.levels[1].hp).toBe(7);
  });

  it("keeps HP dice associated with the correct character level under interleaving", () => {
    // Level 3 is the SECOND Fighter level (d10), not a Wizard level (d6).
    const build = interleaved();
    setLevelHpAt(build, 2, 9); // record a d10-range roll at character level 3
    const levels = normalizeBuildLevels(build);
    const result = computeMaxHp(levels, 0, registry);
    // Breakdown walks in order: F(max 10), W(roll 4), F(roll 9).
    expect(result.breakdown.map((row) => row.die)).toEqual([10, 6, 10]);
    expect(result.breakdown.map((row) => row.value)).toEqual([10, 4, 9]);
    expect(result.max).toBe(10 + 4 + 9);
  });

  it("derives feature timing from the interleaved order, not a collapsed order", () => {
    const build = interleaved();
    const levels = normalizeBuildLevels(build);
    const features = getBuildFeatures(levels, {}, registry);
    // Wizard's Arcane Recovery (wizard class level 1) lands at character level 2.
    const arcaneRecovery = features.find((f) => f.featureId === "arcane-recovery");
    expect(arcaneRecovery?.characterLevel).toBe(2);
    // Fighter's Action Surge (fighter class level 2) lands at character level 3
    // (the second Fighter level), because order is preserved.
    const actionSurge = features.find((f) => f.featureId === "action-surge-1-use");
    expect(actionSurge?.characterLevel).toBe(3);
  });

  it("keeps ASI slots at their true character level under interleaving", () => {
    // Fighter 1 → Wizard 1 → Fighter 2 → Fighter 3 → Fighter 4: the 4th
    // Fighter level (its ASI) is character level 5.
    const build = {
      version: 2, ruleset: "srd-5.1", levels: [
        { classId: "fighter", hp: null },
        { classId: "wizard", hp: null },
        { classId: "fighter", hp: null },
        { classId: "fighter", hp: null },
        { classId: "fighter", hp: null }
      ], subclassByClass: {}, spellcasting: {}, choicesByLevel: {}
    };
    const slots = getAsiSlots(normalizeBuildLevels(build), registry);
    expect(slots.map((s) => s.characterLevel)).toEqual([5]);
    expect(slots[0]).toMatchObject({ classId: "fighter", classLevel: 4 });
  });

  it("materializeLevels expands a legacy build and clears scalar fields", () => {
    const build = { version: 1, ruleset: "srd-5.1", classId: "fighter", level: 3 };
    const levels = materializeLevels(build);
    expect(levels.map((row) => row.classId)).toEqual(["fighter", "fighter", "fighter"]);
    expect(build.classId).toBeUndefined();
    expect(build.level).toBeUndefined();
    expect(build.levels).toBe(levels);
  });

  it("prunes subclass/spell selections for removed classes only", () => {
    const build = {
      version: 2, ruleset: "srd-5.1", levels: [
        { classId: "fighter", hp: null },
        { classId: "wizard", hp: null }
      ],
      subclassByClass: { fighter: "champion", wizard: "evocation" },
      spellcasting: { wizard: { cantripIds: ["fire-bolt"], knownIds: [], preparedIds: [] } },
      choicesByLevel: {}
    };
    // Remove the only Wizard level → wizard subclass/spells pruned, fighter kept.
    removeLevelAt(build, 1);
    expect(build.subclassByClass).toEqual({ fighter: "champion" });
    expect(build.spellcasting).toEqual({});
  });

  it("setSingleClassId and setSingleClassTotalLevel keep single-class order trivially", () => {
    const build = { version: 2, ruleset: "srd-5.1", levels: [], subclassByClass: {}, spellcasting: {}, choicesByLevel: {} };
    expect(setSingleClassTotalLevel(build, 3, "fighter")).toBe(true);
    expect(build.levels.map((row) => row.classId)).toEqual(["fighter", "fighter", "fighter"]);
    expect(setSingleClassId(build, "wizard")).toBe(true);
    expect(build.levels.map((row) => row.classId)).toEqual(["wizard", "wizard", "wizard"]);
    // Truncate keeps the leading levels (order preserved).
    build.levels[1].hp = 5;
    expect(setSingleClassTotalLevel(build, 2, "wizard")).toBe(true);
    expect(build.levels).toHaveLength(2);
    expect(build.levels[1].hp).toBe(5);
    // Clear empties the plan.
    expect(setSingleClassId(build, "")).toBe(true);
    expect(build.levels).toEqual([]);
  });
});

describe("granted spells (class-level and subclass)", () => {
  it("collects class-record grantedSpells for custom classes at their unlock level", async () => {
    const { createContentRegistry } = await import("../js/domain/rules/registry.js");
    const { getGrantedSpells } = await import("../js/domain/rules/progression.js");
    const { BUILTIN_CONTENT } = await import("../js/domain/rules/builtinContent.js");
    const customClass = {
      id: "runeweaver",
      kind: "class",
      name: "Runeweaver",
      source: "custom",
      data: {
        id: "runeweaver",
        kind: "class",
        name: "Runeweaver",
        hitDie: 8,
        grantedSpells: [
          { level: 1, spellId: "mage-armor", grantType: "always_prepared" },
          { classLevel: 3, spellId: "misty-step", grantType: "known" }
        ]
      }
    };
    const registry = createContentRegistry([...BUILTIN_CONTENT, customClass]);

    const atOne = getGrantedSpells(levelsOf("runeweaver"), {}, registry);
    expect(atOne).toEqual([
      { spellId: "mage-armor", classId: "runeweaver", subclassId: "", grantType: "always_prepared" }
    ]);

    const atThree = getGrantedSpells(levelsOf("runeweaver", "runeweaver", "runeweaver"), {}, registry);
    expect(atThree.map((grant) => grant.spellId).sort()).toEqual(["mage-armor", "misty-step"]);
  });

  it("keeps subclass grants unchanged alongside class grants", async () => {
    const { getGrantedSpells } = await import("../js/domain/rules/progression.js");
    const grants = getGrantedSpells(
      levelsOf("cleric", "cleric", "cleric"),
      { cleric: "life" },
      registry
    );
    expect(grants.map((grant) => grant.spellId)).toEqual(
      expect.arrayContaining(["bless", "cure-wounds", "lesser-restoration", "spiritual-weapon"])
    );
    expect(grants.every((grant) => grant.subclassId === "life")).toBe(true);
  });
});
