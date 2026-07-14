import { describe, expect, it } from "vitest";

import {
  ATTACK_WEAPON_SEED_PREFIX,
  attackWeaponSeedMarker,
  buildSeededWeaponAttack,
  buildWeaponAttackCalc,
  deriveWeaponAttack,
  getAttackDisplayModel,
  getAttackSourceWeaponId,
  isWeaponProficient,
  normalizeAttackCalc
} from "../js/domain/attackCalculation.js";
import { makeDefaultBuilderCharacterEntry, makeDefaultCharacterEntry } from "../js/domain/characterHelpers.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import { BUILTIN_CONTENT } from "../js/domain/rules/builtinContent.js";
import {
  BUILTIN_CONTENT_REGISTRY,
  createContentRegistry,
  getContentByKind,
  normalizeCustomContent
} from "../js/domain/rules/registry.js";

function makeFighter({ levels = 1, str = 16, dex = 14, weaponIds = [] } = {}) {
  const character = makeDefaultBuilderCharacterEntry("Attack Tester");
  character.build.levels = Array.from({ length: levels }, () => ({ classId: "fighter", hp: null }));
  character.build.abilities.base = { str, dex, con: 14, int: 10, wis: 10, cha: 8 };
  character.build.equipment = { armorId: null, shield: false, weaponIds, startingChoices: {}, notes: "" };
  return character;
}

function makeWizard({ levels = 1, int = 16, dex = 14 } = {}) {
  const character = makeDefaultBuilderCharacterEntry("Spell Tester");
  character.build.levels = Array.from({ length: levels }, () => ({ classId: "wizard", hp: null }));
  character.build.abilities.base = { str: 8, dex, con: 12, int, wis: 10, cha: 10 };
  return character;
}

const registry = BUILTIN_CONTENT_REGISTRY;
const weapon = (id) => getContentByKind(registry, "weapon", id);
const derivedFor = (character, reg = registry) => deriveCharacter(character, reg);

describe("attack source markers", () => {
  it("round-trips a weapon id through the builderSeed marker", () => {
    const marker = attackWeaponSeedMarker("longsword");
    expect(marker).toBe(`${ATTACK_WEAPON_SEED_PREFIX}longsword`);
    expect(getAttackSourceWeaponId({ builderSeed: marker })).toBe("longsword");
  });

  it("returns no source for unmarked, foreign-marked, or malformed attacks", () => {
    expect(getAttackSourceWeaponId({ name: "Longsword" })).toBe("");
    expect(getAttackSourceWeaponId({ builderSeed: "class-resource:rage" })).toBe("");
    expect(getAttackSourceWeaponId(null)).toBe("");
  });
});

describe("normalizeAttackCalc", () => {
  it("returns null for legacy rows with no calc block", () => {
    expect(normalizeAttackCalc(undefined)).toBeNull();
    expect(normalizeAttackCalc({})).toBeNull();
    expect(normalizeAttackCalc({ mode: "bogus" })).toBeNull();
  });

  it("normalizes every field defensively", () => {
    const calc = normalizeAttackCalc({
      mode: "weapon",
      weaponId: " longsword ",
      ability: "STR",
      proficient: "yes",
      attackAdjustment: "3",
      damageAdjustment: 1.5,
      addAbilityToDamage: true
    });
    expect(calc).toMatchObject({
      mode: "weapon",
      weaponId: "longsword",
      ability: "",
      proficient: false,
      attackAdjustment: 3,
      damageAdjustment: 1.5,
      addAbilityToDamage: true
    });
  });

  it("accepts a valid explicit ability and drops an invalid one", () => {
    expect(normalizeAttackCalc({ mode: "ability", ability: "dex" }).ability).toBe("dex");
    expect(normalizeAttackCalc({ mode: "ability", ability: "luck" }).ability).toBe("");
  });
});

describe("getAttackDisplayModel — weapon mode", () => {
  it("derives STR + proficiency for a plain melee weapon", () => {
    const calc = buildWeaponAttackCalc("longsword");
    const model = getAttackDisplayModel({ calc }, derivedFor(makeFighter()), registry);
    expect(model).toMatchObject({
      derived: true, bonus: "+5", damage: "1d8+3", range: "Melee", type: "Slashing"
    });
  });

  it("derives DEX for a ranged weapon and formats the range", () => {
    const calc = buildWeaponAttackCalc("longbow");
    const model = getAttackDisplayModel({ calc }, derivedFor(makeFighter()), registry);
    expect(model.bonus).toBe("+4"); // DEX 14 (+2) + prof +2
    expect(model.damage).toBe("1d8+2");
    expect(model.range).toMatch(/^\d+\/\d+ ft\.$/);
  });

  it("uses the better of STR/DEX for finesse weapons", () => {
    const calc = buildWeaponAttackCalc("dagger");
    const model = getAttackDisplayModel({ calc }, derivedFor(makeFighter({ str: 10, dex: 18 })), registry);
    expect(model.bonus).toBe("+6"); // DEX +4, prof +2
    expect(model.damage).toBe("1d4+4");
  });

  it("updates automatically when STR changes (no recalc action)", () => {
    const calc = buildWeaponAttackCalc("longsword");
    const before = getAttackDisplayModel({ calc }, derivedFor(makeFighter({ str: 16 })), registry);
    const after = getAttackDisplayModel({ calc }, derivedFor(makeFighter({ str: 18 })), registry);
    expect(before.bonus).toBe("+5");
    expect(after.bonus).toBe("+6"); // STR 18 (+4) + prof +2
    expect(after.damage).toBe("1d8+4");
  });

  it("updates automatically when proficiency bonus changes on level up", () => {
    const calc = buildWeaponAttackCalc("longsword");
    const level1 = getAttackDisplayModel({ calc }, derivedFor(makeFighter({ levels: 1 })), registry);
    const level5 = getAttackDisplayModel({ calc }, derivedFor(makeFighter({ levels: 5 })), registry);
    expect(level1.bonus).toBe("+5"); // prof +2
    expect(level5.bonus).toBe("+6"); // prof +3
  });

  it("does not add proficiency for a non-proficient weapon", () => {
    const calc = { ...buildWeaponAttackCalc("longsword"), proficient: false };
    const model = getAttackDisplayModel({ calc }, derivedFor(makeFighter()), registry);
    expect(model.bonus).toBe("+3"); // STR +3, no proficiency
    expect(model.breakdown.proficient).toBe(false);
  });

  it("omits the ability modifier from damage when addAbilityToDamage is false", () => {
    const calc = { ...buildWeaponAttackCalc("longsword"), addAbilityToDamage: false };
    const model = getAttackDisplayModel({ calc }, derivedFor(makeFighter()), registry);
    expect(model.bonus).toBe("+5");
    expect(model.damage).toBe("1d8"); // no +3
  });

  it("applies explicit attack and damage adjustments on top of the derived base", () => {
    const calc = { ...buildWeaponAttackCalc("longsword"), attackAdjustment: 1, damageAdjustment: 2 };
    const model = getAttackDisplayModel({ calc }, derivedFor(makeFighter()), registry);
    expect(model.bonus).toBe("+6"); // +5 calculated, +1 adjustment
    expect(model.damage).toBe("1d8+5"); // 1d8, +3 ability, +2 adjustment
  });

  it("falls back to stored strings and warns when the linked weapon is missing", () => {
    const calc = buildWeaponAttackCalc("removed-blade");
    const attack = { calc, bonus: "+9", damage: "2d6", range: "Melee", type: "Force" };
    const model = getAttackDisplayModel(attack, derivedFor(makeFighter()), registry);
    expect(model.derived).toBe(false);
    expect(model.bonus).toBe("+9");
    expect(model.warnings[0]).toContain("isn't available");
  });

  it("falls back to the stored bonus and warns when the ability score is unset", () => {
    const character = makeFighter();
    character.build.abilities.base = { dex: 14, con: 14, int: 10, wis: 10, cha: 8 }; // no STR
    const calc = buildWeaponAttackCalc("longsword");
    const attack = { calc, bonus: "+5" };
    const model = getAttackDisplayModel(attack, derivedFor(character), registry);
    expect(model.bonus).toBe("+5");
    expect(model.warnings.some((w) => w.includes("STR"))).toBe(true);
  });
});

describe("getAttackDisplayModel — ability and spell modes", () => {
  it("derives a spell attack from the primary spellcasting ability", () => {
    const calc = { ...buildWeaponAttackCalc(""), mode: "spell", baseDamage: "1d10", damageType: "fire", range: "120 feet", addAbilityToDamage: false };
    const model = getAttackDisplayModel({ calc }, derivedFor(makeWizard({ int: 16 })), registry);
    // INT 16 (+3) + prof +2 = +5; spell damage carries no ability modifier
    expect(model.bonus).toBe("+5");
    expect(model.damage).toBe("1d10");
    expect(model.range).toBe("120 feet");
    expect(model.type).toBe("fire");
  });

  it("derives an ability-mode attack with an explicit ability and no weapon", () => {
    const calc = { ...buildWeaponAttackCalc(""), mode: "ability", ability: "dex", proficient: true, baseDamage: "1d6", damageType: "piercing" };
    const model = getAttackDisplayModel({ calc }, derivedFor(makeFighter({ dex: 14 })), registry);
    expect(model.bonus).toBe("+4"); // DEX +2 + prof +2
    expect(model.damage).toBe("1d6+2");
  });

  it("warns and falls back when no spellcasting ability is available", () => {
    const calc = { ...buildWeaponAttackCalc(""), mode: "spell" };
    const attack = { calc, bonus: "+7" };
    const model = getAttackDisplayModel(attack, derivedFor(makeFighter()), registry);
    expect(model.bonus).toBe("+7");
    expect(model.warnings.some((w) => w.includes("spellcasting"))).toBe(true);
  });
});

describe("getAttackDisplayModel — fixed and legacy modes", () => {
  it("returns stored strings verbatim for a fixed override, never deriving", () => {
    const calc = { ...buildWeaponAttackCalc("longsword"), mode: "fixed" };
    const attack = { calc, bonus: "+99", damage: "10d6", range: "Reach", type: "Necrotic" };
    const model = getAttackDisplayModel(attack, derivedFor(makeFighter()), registry);
    expect(model.derived).toBe(false);
    expect(model).toMatchObject({ bonus: "+99", damage: "10d6", range: "Reach", type: "Necrotic" });
  });

  it("returns stored strings for a legacy row with no calc block", () => {
    const attack = { name: "Old Sword", bonus: "+4", damage: "1d8+2", range: "Melee", type: "Slashing" };
    const model = getAttackDisplayModel(attack, derivedFor(makeFighter()), registry);
    expect(model.mode).toBe("legacy");
    expect(model.derived).toBe(false);
    expect(model.bonus).toBe("+4");
  });
});

describe("isWeaponProficient", () => {
  it("recognizes a category proficiency (martial → longsword)", () => {
    expect(isWeaponProficient(derivedFor(makeFighter()), weapon("longsword"))).toBe(true);
  });

  it("recognizes a specific weapon proficiency for a limited list (wizard → dagger)", () => {
    const wiz = derivedFor(makeWizard());
    expect(isWeaponProficient(wiz, weapon("dagger"))).toBe(true);
    expect(isWeaponProficient(wiz, weapon("longsword"))).toBe(false);
  });

  it("returns false when the character has no weapon proficiencies", () => {
    expect(isWeaponProficient(derivedFor(makeDefaultCharacterEntry("Freeform")), weapon("club"))).toBe(false);
  });
});

describe("deriveWeaponAttack + buildSeededWeaponAttack", () => {
  it("deriveWeaponAttack matches the display model", () => {
    const derived = derivedFor(makeFighter());
    expect(deriveWeaponAttack(weapon("longsword"), derived)).toEqual({
      name: "Longsword", bonus: "+5", damage: "1d8+3", range: "Melee", type: "Slashing"
    });
  });

  it("buildSeededWeaponAttack carries the structured calc, marker, and proficient default", () => {
    const seeded = buildSeededWeaponAttack(weapon("longsword"), derivedFor(makeFighter()), registry);
    expect(seeded).toMatchObject({
      name: "Longsword", bonus: "+5", damage: "1d8+3",
      calc: { mode: "weapon", weaponId: "longsword", proficient: true },
      builderSeed: attackWeaponSeedMarker("longsword")
    });
  });

  it("seeds proficient=false when the character lacks the weapon proficiency", () => {
    const wiz = derivedFor(makeWizard());
    const seeded = buildSeededWeaponAttack(weapon("greatsword"), wiz, registry);
    expect(seeded.calc.proficient).toBe(false);
    // STR 8 (−1), no proficiency
    expect(seeded.bonus).toBe("-1");
  });

  it("derives through custom weapon records in the merged registry", () => {
    const customWeapon = {
      id: "star-blade", kind: "weapon", name: "Star Blade", source: "custom",
      weaponCategory: "martial", attackType: "melee", damage: "2d6", damageType: "radiant", properties: []
    };
    const { entries } = normalizeCustomContent([customWeapon]);
    const merged = createContentRegistry([...BUILTIN_CONTENT, ...entries]);
    const calc = buildWeaponAttackCalc("star-blade");
    const model = getAttackDisplayModel({ calc }, derivedFor(makeFighter(), merged), merged);
    expect(model).toMatchObject({ bonus: "+5", damage: "2d6+3", type: "Radiant" });
  });
});
