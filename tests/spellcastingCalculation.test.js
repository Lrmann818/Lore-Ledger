import { describe, expect, it } from "vitest";

import {
  abilityLabel,
  buildDerivedSpellcastingCalc,
  collectDerivedSpellcastingSources,
  getSpellcastingDisplayModel,
  normalizeSpellcastingCalc,
  SPELLCASTING_CALC_MODES
} from "../js/domain/spellcastingCalculation.js";
import { makeDefaultBuilderCharacterEntry, makeDefaultCharacterEntry } from "../js/domain/characterHelpers.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;
const derivedFor = (character) => deriveCharacter(character, registry);

function makeCaster(classId, { levels = 1, scores = {} } = {}) {
  const character = makeDefaultBuilderCharacterEntry("Caster");
  character.build.levels = Array.from({ length: levels }, () => ({ classId, hp: null }));
  character.build.abilities.base = { str: 8, dex: 12, con: 14, int: 10, wis: 10, cha: 10, ...scores };
  return character;
}

/**
 * Synthetic derived object for the calculator's logic tests (the calculator
 * only reads abilities + proficiencyBonus + spellcasting.classes + grantedSpells).
 */
function synthDerived({ prof = 2, mods = {}, classes = [], grantedSpells = [] } = {}) {
  const abilities = {};
  for (const key of ["str", "dex", "con", "int", "wis", "cha"]) {
    abilities[key] = { modifier: mods[key] ?? null };
  }
  return {
    proficiencyBonus: prof,
    abilities,
    spellcasting: classes.length ? { classes } : null,
    grantedSpells
  };
}

describe("normalizeSpellcastingCalc", () => {
  it("returns null for legacy characters with no calc block", () => {
    expect(normalizeSpellcastingCalc(undefined)).toBeNull();
    expect(normalizeSpellcastingCalc({})).toBeNull();
    expect(normalizeSpellcastingCalc({ mode: "bogus" })).toBeNull();
  });

  it("normalizes a derived block with per-source adjustments", () => {
    const calc = normalizeSpellcastingCalc({
      mode: "derived",
      bySource: { wis: { dcAdjustment: 1, attackAdjustment: 2 }, zzz: { dcAdjustment: 9 } },
      freeform: [{ ability: "int", dcAdjustment: "3", attackAdjustment: 0 }, { ability: "int" }],
      fixed: { dc: 17, attack: "9" }
    });
    expect(calc.mode).toBe("derived");
    expect(calc.bySource.wis).toEqual({ dcAdjustment: 1, attackAdjustment: 2 });
    expect(calc.bySource.zzz).toBeUndefined(); // invalid ability dropped
    expect(calc.freeform).toEqual([{ ability: "int", dcAdjustment: 3, attackAdjustment: 0 }]); // dedup by ability
    expect(calc.fixed).toEqual({ dc: 17, attack: 9 });
  });

  it("exposes the closed mode vocabulary", () => {
    expect([...SPELLCASTING_CALC_MODES]).toEqual(["derived", "fixed"]);
  });
});

describe("collectDerivedSpellcastingSources", () => {
  it("groups class casters and choice-granted spells by ability with provenance", () => {
    const derived = synthDerived({
      classes: [
        { classId: "cleric", className: "Cleric", ability: "wis" },
        { classId: "wizard", className: "Wizard", ability: "int" }
      ],
      grantedSpells: [
        { spellId: "fire-bolt", spellcastingAbility: "int", source: "High Elf" },
        { spellId: "guidance", classId: "cleric" } // class grant, no own ability → ignored here
      ]
    });
    const sources = collectDerivedSpellcastingSources(derived);
    const wis = sources.find((s) => s.ability === "wis");
    const int = sources.find((s) => s.ability === "int");
    expect(wis.sources).toEqual(["Cleric"]);
    expect(int.sources).toEqual(expect.arrayContaining(["Wizard", "High Elf"]));
  });
});

describe("getSpellcastingDisplayModel — legacy", () => {
  it("shows the stored flat snapshot verbatim and never derives", () => {
    const character = makeDefaultCharacterEntry("Legacy");
    character.spellDC = 15;
    character.spellAttack = 7;
    const model = getSpellcastingDisplayModel(character, derivedFor(character));
    expect(model.mode).toBe("legacy");
    expect(model.profiles).toEqual([]);
    expect(model.flat).toEqual({ dc: 15, attack: 7 });
  });

  it("flags that a builder caster has derivable sources (offer adoption)", () => {
    const character = makeCaster("cleric", { scores: { wis: 16 } });
    const model = getSpellcastingDisplayModel(character, derivedFor(character));
    expect(model.mode).toBe("legacy"); // no calc block yet
    expect(model.hasDerivableSources).toBe(true);
  });
});

describe("getSpellcastingDisplayModel — derived (builder)", () => {
  it("derives a single Cleric DC/attack from Wisdom + proficiency", () => {
    const character = makeCaster("cleric", { scores: { wis: 16 } }); // +3, prof +2
    character.spellcastingCalc = buildDerivedSpellcastingCalc();
    const model = getSpellcastingDisplayModel(character, derivedFor(character));
    expect(model.mode).toBe("derived");
    expect(model.profiles).toHaveLength(1);
    const [wis] = model.profiles;
    expect(wis.ability).toBe("wis");
    expect(wis.dc).toBe(13); // 8 + 2 + 3
    expect(wis.attack).toBe(5); // 2 + 3
    expect(wis.attackLabel).toBe("+5");
    expect(wis.label).toContain("Wisdom");
    expect(model.flat).toEqual({ dc: 13, attack: 5 });
  });

  it("auto-updates when the ability changes (no recalc action)", () => {
    const character = makeCaster("cleric", { scores: { wis: 16 } });
    character.spellcastingCalc = buildDerivedSpellcastingCalc();
    expect(getSpellcastingDisplayModel(character, derivedFor(character)).profiles[0].dc).toBe(13);
    character.build.abilities.base.wis = 20; // +5
    expect(getSpellcastingDisplayModel(character, derivedFor(character)).profiles[0].dc).toBe(15);
  });

  it("auto-updates when proficiency crosses a threshold (level 4 → 5)", () => {
    const character = makeCaster("cleric", { levels: 4, scores: { wis: 16 } });
    character.spellcastingCalc = buildDerivedSpellcastingCalc();
    expect(getSpellcastingDisplayModel(character, derivedFor(character)).profiles[0].dc).toBe(13); // prof +2
    character.build.levels = Array.from({ length: 5 }, () => ({ classId: "cleric", hp: null }));
    expect(getSpellcastingDisplayModel(character, derivedFor(character)).profiles[0].dc).toBe(14); // prof +3
  });

  it("represents two spellcasting sources with different abilities", () => {
    const character = makeCaster("cleric", { scores: { wis: 16, int: 14 } });
    character.build.levels = [{ classId: "cleric", hp: null }, { classId: "wizard", hp: null }];
    character.spellcastingCalc = buildDerivedSpellcastingCalc();
    const model = getSpellcastingDisplayModel(character, derivedFor(character));
    expect(model.profiles.map((p) => p.ability).sort()).toEqual(["int", "wis"]);
    const wis = model.profiles.find((p) => p.ability === "wis");
    const int = model.profiles.find((p) => p.ability === "int");
    expect(wis.dc).toBe(13); // 8 + 2 + 3
    expect(int.dc).toBe(12); // 8 + 2 + 2
  });

  it("keeps an explicit DC/attack adjustment applied across an ability change", () => {
    const character = makeCaster("cleric", { scores: { wis: 16 } });
    const calc = buildDerivedSpellcastingCalc();
    calc.bySource.wis = { dcAdjustment: 1, attackAdjustment: 2 };
    character.spellcastingCalc = calc;
    let model = getSpellcastingDisplayModel(character, derivedFor(character));
    expect(model.profiles[0].dc).toBe(14); // 13 + 1
    expect(model.profiles[0].attack).toBe(7); // 5 + 2
    character.build.abilities.base.wis = 20; // +5
    model = getSpellcastingDisplayModel(character, derivedFor(character));
    expect(model.profiles[0].dc).toBe(16); // (8+2+5) + 1
    expect(model.profiles[0].attack).toBe(9); // (2+5) + 2 — adjustment survived
  });

  it("uses Intelligence for a choice-granted racial cantrip source (High Elf pattern)", () => {
    const character = makeCaster("fighter"); // non-caster class
    character.spellcastingCalc = buildDerivedSpellcastingCalc();
    const derived = synthDerived({
      prof: 2,
      mods: { int: 3 },
      classes: [],
      grantedSpells: [{ spellId: "fire-bolt", spellcastingAbility: "int", source: "High Elf" }]
    });
    const model = getSpellcastingDisplayModel(character, derived);
    expect(model.profiles).toHaveLength(1);
    expect(model.profiles[0].ability).toBe("int");
    expect(model.profiles[0].dc).toBe(13); // 8 + 2 + 3
    expect(model.profiles[0].label).toContain("High Elf");
  });
});

describe("getSpellcastingDisplayModel — derived (freeform)", () => {
  it("derives from a user-declared ability + manual proficiency", () => {
    const character = makeDefaultCharacterEntry("Freeform Caster");
    character.proficiency = 3;
    character.abilities = { cha: { score: 18 } }; // +4
    character.spellcastingCalc = {
      mode: "derived",
      bySource: {},
      freeform: [{ ability: "cha", dcAdjustment: 0, attackAdjustment: 0 }],
      fixed: { dc: null, attack: null }
    };
    const model = getSpellcastingDisplayModel(character, derivedFor(character));
    expect(model.mode).toBe("derived");
    expect(model.profiles[0].ability).toBe("cha");
    expect(model.profiles[0].dc).toBe(15); // 8 + 3 + 4
    expect(model.profiles[0].attack).toBe(7); // 3 + 4
  });
});

describe("getSpellcastingDisplayModel — fixed override", () => {
  it("shows the stored fixed values and never derives", () => {
    const character = makeCaster("cleric", { scores: { wis: 20 } });
    character.spellcastingCalc = {
      mode: "fixed",
      bySource: {},
      freeform: [],
      fixed: { dc: 17, attack: 9 }
    };
    const model = getSpellcastingDisplayModel(character, derivedFor(character));
    expect(model.mode).toBe("fixed");
    expect(model.profiles[0].dc).toBe(17);
    expect(model.profiles[0].attack).toBe(9);
    expect(model.flat).toEqual({ dc: 17, attack: 9 });
    // A big Wisdom does not move a fixed value.
    character.build.abilities.base.wis = 8;
    expect(getSpellcastingDisplayModel(character, derivedFor(character)).profiles[0].dc).toBe(17);
  });

  it("falls back to the flat mirror when fixed values are absent", () => {
    const character = makeDefaultCharacterEntry("Fixed Legacy");
    character.spellDC = 14;
    character.spellAttack = 6;
    character.spellcastingCalc = { mode: "fixed", bySource: {}, freeform: [], fixed: { dc: null, attack: null } };
    const model = getSpellcastingDisplayModel(character, derivedFor(character));
    expect(model.flat).toEqual({ dc: 14, attack: 6 });
  });
});

describe("getSpellcastingDisplayModel — missing inputs", () => {
  it("warns rather than throwing when the ability score is unset", () => {
    const character = makeDefaultCharacterEntry("Unset");
    character.proficiency = 2;
    character.spellcastingCalc = {
      mode: "derived", bySource: {}, freeform: [{ ability: "wis", dcAdjustment: 0, attackAdjustment: 0 }], fixed: { dc: null, attack: null }
    };
    const model = getSpellcastingDisplayModel(character, derivedFor(character));
    expect(model.profiles[0].derived).toBe(false);
    expect(model.profiles[0].dc).toBeNull();
    expect(model.profiles[0].warnings.length).toBeGreaterThan(0);
  });
});

describe("abilityLabel", () => {
  it("maps ability keys to full names", () => {
    expect(abilityLabel("int")).toBe("Intelligence");
    expect(abilityLabel("")).toBe("");
  });
});
