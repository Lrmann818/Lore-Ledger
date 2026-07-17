import { describe, expect, it } from "vitest";

import {
  HP_MAX_CALC_MODES,
  buildDerivedHpMaxCalc,
  clampCurrentHpToMax,
  describeHpBreakdown,
  getDisplayedHpMax,
  getHpMaxDisplayModel,
  getHpMaxManagedMode,
  normalizeHpMaxCalc
} from "../js/domain/hpMaxCalculation.js";
import { makeDefaultBuilderCharacterEntry, makeDefaultCharacterEntry } from "../js/domain/characterHelpers.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;
const derivedFor = (character) => deriveCharacter(character, registry);

// Human fighter, base Con 13 (+1 human = 14 → +2 per level).
// L1 = 10 (max die) + 2 = 12; later fighter levels average 6 + 2 = 8.
function makeFighter({ levels = [{ classId: "fighter", hp: null }], con = 13, raceId = "human", subraceId = null } = {}) {
  const character = makeDefaultBuilderCharacterEntry("HP Fighter");
  character.build.raceId = raceId;
  character.build.subraceId = subraceId;
  character.build.levels = levels;
  character.build.backgroundId = "acolyte";
  character.build.abilities.base = { str: 15, dex: 12, con, int: 10, wis: 10, cha: 8 };
  return character;
}

describe("normalizeHpMaxCalc", () => {
  it("returns null for anything unstructured", () => {
    expect(normalizeHpMaxCalc(undefined)).toBeNull();
    expect(normalizeHpMaxCalc({})).toBeNull();
    expect(normalizeHpMaxCalc({ mode: "bogus" })).toBeNull();
    expect([...HP_MAX_CALC_MODES]).toEqual(["derived", "fixed"]);
  });

  it("normalizes mode and adjustment", () => {
    expect(normalizeHpMaxCalc({ mode: "derived", adjustment: "3" })).toEqual({ mode: "derived", adjustment: 3 });
    expect(normalizeHpMaxCalc({ mode: "fixed" })).toEqual({ mode: "fixed", adjustment: 0 });
  });
});

describe("getHpMaxDisplayModel — legacy", () => {
  it("shows the stored flat snapshot verbatim (never decomposed into guessed rolls)", () => {
    const character = makeDefaultCharacterEntry("Legacy");
    character.hpMax = 31;
    const model = getHpMaxDisplayModel(character, derivedFor(character));
    expect(model.mode).toBe("legacy");
    expect(model.value).toBe(31);
    expect(model.canDerive).toBe(false); // freeform: no level history
  });
});

describe("getHpMaxDisplayModel — derived (builder level history)", () => {
  it("uses max die at first level and SRD averages for unrecorded later levels", () => {
    const character = makeFighter({ levels: [
      { classId: "fighter", hp: null },
      { classId: "fighter", hp: null }
    ] });
    character.hpMaxCalc = buildDerivedHpMaxCalc();
    const model = getHpMaxDisplayModel(character, derivedFor(character));
    expect(model.value).toBe(12 + 8); // 10+2, then 6+2
  });

  it("uses recorded rolls verbatim (rolled vs fixed-average stays distinguishable)", () => {
    const character = makeFighter({ levels: [
      { classId: "fighter", hp: null },
      { classId: "fighter", hp: 10 } // recorded roll
    ] });
    character.hpMaxCalc = buildDerivedHpMaxCalc();
    const model = getHpMaxDisplayModel(character, derivedFor(character));
    expect(model.value).toBe(12 + 12); // 10+2, then 10+2
    expect(model.formula).toContain("(rolled)");
    expect(model.formula).toContain("(max)");
  });

  it("applies a Constitution change across every level (retroactive)", () => {
    const character = makeFighter({ levels: [
      { classId: "fighter", hp: null },
      { classId: "fighter", hp: null },
      { classId: "fighter", hp: null }
    ] });
    character.hpMaxCalc = buildDerivedHpMaxCalc();
    expect(getHpMaxDisplayModel(character, derivedFor(character)).value).toBe(12 + 8 + 8);
    character.build.abilities.base.con = 17; // +1 human = 18 → +4 (was +2)
    expect(getHpMaxDisplayModel(character, derivedFor(character)).value).toBe(12 + 8 + 8 + 3 * 2);
  });

  it("scales Hill Dwarf Dwarven Toughness (+1 per level) structurally", () => {
    const dwarf = makeFighter({ raceId: "dwarf", subraceId: "hill-dwarf", con: 12, levels: [
      { classId: "fighter", hp: null },
      { classId: "fighter", hp: null }
    ] });
    // Dwarf +2 Con: 12 → 14 → +2 mod. L1 = 10+2+1 = 13; L2 = 6+2+1 = 9.
    dwarf.hpMaxCalc = buildDerivedHpMaxCalc();
    expect(getHpMaxDisplayModel(dwarf, derivedFor(dwarf)).value).toBe(13 + 9);
  });

  it("computes multiclass history with per-class hit dice", () => {
    const character = makeFighter({ levels: [
      { classId: "fighter", hp: null }, // 10 + 2
      { classId: "wizard", hp: null }   // avg d6 = 4 + 2
    ] });
    character.hpMaxCalc = buildDerivedHpMaxCalc();
    expect(getHpMaxDisplayModel(character, derivedFor(character)).value).toBe(12 + 6);
  });

  it("keeps an explicit adjustment applied across a Con change", () => {
    const character = makeFighter();
    character.hpMaxCalc = { mode: "derived", adjustment: 5 };
    expect(getHpMaxDisplayModel(character, derivedFor(character)).value).toBe(12 + 5);
    character.build.abilities.base.con = 17; // → +4
    expect(getHpMaxDisplayModel(character, derivedFor(character)).value).toBe(14 + 5);
  });

  it("fails soft to the stored value when no history is derivable (freeform)", () => {
    const character = makeDefaultCharacterEntry("Freeform");
    character.hpMax = 25;
    character.hpMaxCalc = buildDerivedHpMaxCalc(); // defensive: block without build
    const model = getHpMaxDisplayModel(character, derivedFor(character));
    expect(model.canDerive).toBe(false);
    expect(model.value).toBe(25);
    expect(model.warnings.length).toBeGreaterThan(0);
  });
});

describe("getHpMaxDisplayModel — fixed override", () => {
  it("shows the stored flat value and ignores derivation entirely", () => {
    const character = makeFighter();
    character.hpMax = 50;
    character.hpMaxCalc = { mode: "fixed", adjustment: 0 };
    expect(getHpMaxDisplayModel(character, derivedFor(character)).value).toBe(50);
    character.build.abilities.base.con = 20;
    expect(getHpMaxDisplayModel(character, derivedFor(character)).value).toBe(50);
  });
});

describe("getDisplayedHpMax / getHpMaxManagedMode / clamp", () => {
  it("resolves legacy and fixed from the flat field, derived through the registry", () => {
    const legacy = makeDefaultCharacterEntry("L");
    legacy.hpMax = 20;
    expect(getDisplayedHpMax(legacy)).toBe(20);
    expect(getHpMaxManagedMode(legacy)).toBeNull();

    const managed = makeFighter();
    managed.hpMaxCalc = { mode: "derived", adjustment: 2 };
    managed.hpMax = 1; // stale mirror must not win
    expect(getDisplayedHpMax(managed, { registry })).toBe(12 + 2);
    expect(getHpMaxManagedMode(managed)).toBe("derived");
  });

  it("clamps current HP to a lowered max and never auto-heals on a raise", () => {
    expect(clampCurrentHpToMax(18, 12)).toBe(12);
    expect(clampCurrentHpToMax(8, 12)).toBe(8);
    expect(clampCurrentHpToMax(8, 20)).toBe(8);
    expect(clampCurrentHpToMax(null, 12)).toBeNull();
    expect(clampCurrentHpToMax(8, null)).toBe(8);
  });
});

describe("describeHpBreakdown", () => {
  it("summarizes level sources and the Con modifier", () => {
    const character = makeFighter({ levels: [
      { classId: "fighter", hp: null },
      { classId: "fighter", hp: 9 }
    ] });
    const text = describeHpBreakdown(derivedFor(character));
    expect(text).toContain("L1 10 (max)");
    expect(text).toContain("L2 9 (rolled)");
    expect(text).toContain("Con +2/level");
  });
});
