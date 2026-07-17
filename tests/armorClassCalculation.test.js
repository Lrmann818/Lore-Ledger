import { describe, expect, it } from "vitest";

import {
  AC_CALC_MODES,
  buildDerivedAcCalc,
  getAcManagedMode,
  getArmorClassDisplayModel,
  getDisplayedArmorClass,
  normalizeAcCalc
} from "../js/domain/armorClassCalculation.js";
import { makeDefaultBuilderCharacterEntry, makeDefaultCharacterEntry } from "../js/domain/characterHelpers.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;
const derivedFor = (character) => deriveCharacter(character, registry);

function makeFighter({ dex = 14, armorId = null, shield = false } = {}) {
  const character = makeDefaultBuilderCharacterEntry("Fighter");
  character.build.raceId = "human";
  character.build.levels = [{ classId: "fighter", hp: null }];
  character.build.backgroundId = "acolyte";
  character.build.abilities.base = { str: 15, dex, con: 13, int: 10, wis: 10, cha: 8 };
  character.build.equipment = { armorId, shield, weaponIds: [], packId: null };
  return character;
}

describe("normalizeAcCalc", () => {
  it("returns null for anything unstructured", () => {
    expect(normalizeAcCalc(undefined)).toBeNull();
    expect(normalizeAcCalc({})).toBeNull();
    expect(normalizeAcCalc({ mode: "bogus" })).toBeNull();
    expect(normalizeAcCalc("derived")).toBeNull();
  });

  it("normalizes mode and adjustment", () => {
    expect(normalizeAcCalc({ mode: "derived", adjustment: "2" })).toEqual({ mode: "derived", adjustment: 2 });
    expect(normalizeAcCalc({ mode: "fixed" })).toEqual({ mode: "fixed", adjustment: 0 });
    expect([...AC_CALC_MODES]).toEqual(["derived", "fixed"]);
  });
});

describe("getArmorClassDisplayModel — legacy", () => {
  it("shows the stored flat snapshot verbatim (never reinterpreted)", () => {
    const character = makeDefaultCharacterEntry("Legacy");
    character.ac = 16;
    const model = getArmorClassDisplayModel(character, derivedFor(character));
    expect(model.mode).toBe("legacy");
    expect(model.value).toBe(16);
    expect(model.canDerive).toBe(false); // freeform: no structured armor
  });

  it("flags a builder character as derivable (adoption offer)", () => {
    const character = makeFighter({ armorId: "chain-mail" });
    character.ac = 99;
    const model = getArmorClassDisplayModel(character, derivedFor(character));
    expect(model.mode).toBe("legacy");
    expect(model.value).toBe(99); // stored value stands until adoption
    expect(model.canDerive).toBe(true);
  });
});

describe("getArmorClassDisplayModel — derived", () => {
  it("derives from worn armor and refreshes when Dex or armor changes", () => {
    // Human fighter: base dex 14 +1 human = 15 → +2 mod.
    const character = makeFighter({ dex: 14, armorId: "leather-armor" });
    character.acCalc = buildDerivedAcCalc();
    let model = getArmorClassDisplayModel(character, derivedFor(character));
    expect(model.value).toBe(11 + 2); // leather 11 + Dex 2
    expect(model.formula).toContain("Leather");

    character.build.abilities.base.dex = 18; // +1 human = 19 → +4
    model = getArmorClassDisplayModel(character, derivedFor(character));
    expect(model.value).toBe(11 + 4);

    character.build.equipment.armorId = "chain-mail"; // heavy: no Dex
    model = getArmorClassDisplayModel(character, derivedFor(character));
    expect(model.value).toBe(16);
    expect(model.formula).toContain("Chain Mail");
  });

  it("applies the medium-armor Dex cap", () => {
    const character = makeFighter({ dex: 18, armorId: "breastplate" }); // 19 → +4, cap 2
    character.acCalc = buildDerivedAcCalc();
    const model = getArmorClassDisplayModel(character, derivedFor(character));
    expect(model.value).toBe(14 + 2);
  });

  it("adds the shield only when equipped", () => {
    const noShield = makeFighter({ armorId: "leather-armor", shield: false });
    noShield.acCalc = buildDerivedAcCalc();
    const withShield = makeFighter({ armorId: "leather-armor", shield: true });
    withShield.acCalc = buildDerivedAcCalc();
    const base = getArmorClassDisplayModel(noShield, derivedFor(noShield)).value;
    const shielded = getArmorClassDisplayModel(withShield, derivedFor(withShield)).value;
    expect(shielded).toBe(base + 2);
  });

  it("keeps an explicit adjustment applied across a dependency change", () => {
    const character = makeFighter({ dex: 14, armorId: "leather-armor" });
    character.acCalc = { mode: "derived", adjustment: 1 };
    let model = getArmorClassDisplayModel(character, derivedFor(character));
    expect(model.value).toBe(13 + 1);
    character.build.equipment.shield = true;
    model = getArmorClassDisplayModel(character, derivedFor(character));
    expect(model.value).toBe(15 + 1); // adjustment survived
  });

  it("fails soft to the stored value when no base is derivable (freeform)", () => {
    const character = makeDefaultCharacterEntry("Freeform");
    character.ac = 15;
    character.acCalc = buildDerivedAcCalc(); // defensive: block without build data
    const model = getArmorClassDisplayModel(character, derivedFor(character));
    expect(model.mode).toBe("derived");
    expect(model.canDerive).toBe(false);
    expect(model.value).toBe(15);
    expect(model.warnings.length).toBeGreaterThan(0);
  });
});

describe("getArmorClassDisplayModel — fixed override", () => {
  it("shows the stored flat value and ignores derivation entirely", () => {
    const character = makeFighter({ dex: 18, armorId: "chain-mail", shield: true });
    character.ac = 12;
    character.acCalc = { mode: "fixed", adjustment: 0 };
    const model = getArmorClassDisplayModel(character, derivedFor(character));
    expect(model.mode).toBe("fixed");
    expect(model.value).toBe(12);
    character.build.abilities.base.dex = 20;
    expect(getArmorClassDisplayModel(character, derivedFor(character)).value).toBe(12);
  });
});

describe("getDisplayedArmorClass / getAcManagedMode", () => {
  it("resolves legacy and fixed from the flat field without deriving", () => {
    const legacy = makeDefaultCharacterEntry("L");
    legacy.ac = 14;
    expect(getDisplayedArmorClass(legacy)).toBe(14);
    expect(getAcManagedMode(legacy)).toBeNull();

    const fixed = makeDefaultCharacterEntry("F");
    fixed.ac = 18;
    fixed.acCalc = { mode: "fixed", adjustment: 0 };
    expect(getDisplayedArmorClass(fixed)).toBe(18);
    expect(getAcManagedMode(fixed)).toBe("fixed");
  });

  it("derives for a managed builder character (registry-aware)", () => {
    const character = makeFighter({ dex: 14, armorId: "leather-armor" });
    character.acCalc = { mode: "derived", adjustment: 1 };
    character.ac = 5; // stale mirror must not win
    expect(getDisplayedArmorClass(character, { registry })).toBe(11 + 2 + 1);
    expect(getAcManagedMode(character)).toBe("derived");
  });
});
