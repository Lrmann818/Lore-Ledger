import { describe, expect, it } from "vitest";

import { getBuilderFinishSheetSeedPatch, getLevelUpSheetSeedPatch } from "../js/domain/builderSheetSeeding.js";
import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { normalizeSpellcastingCalc, getSpellcastingDisplayModel } from "../js/domain/spellcastingCalculation.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import { sanitizeForSave } from "../js/state.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

function makeCleric({ levels = 1, wis = 16 } = {}) {
  const character = makeDefaultBuilderCharacterEntry("Cleric");
  character.build.raceId = "human";
  character.build.levels = Array.from({ length: levels }, () => ({ classId: "cleric", hp: null }));
  character.build.backgroundId = "acolyte";
  character.build.abilities.base = { str: 10, dex: 12, con: 14, int: 10, wis, cha: 10 };
  return character;
}

function makeFighter() {
  const character = makeDefaultBuilderCharacterEntry("Fighter");
  character.build.raceId = "human";
  character.build.levels = [{ classId: "fighter", hp: null }];
  character.build.backgroundId = "acolyte";
  character.build.abilities.base = { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  return character;
}

describe("spell DC / attack seeding (F2)", () => {
  it("stamps a derived spellcastingCalc block and mirrors the flat fields for a caster", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeCleric({ wis: 16 }));
    expect(patch.spellcastingCalc).toBeTruthy();
    expect(patch.spellcastingCalc.mode).toBe("derived");
    // Wis 16 (+3), prof +2 → DC 13, attack +5.
    expect(patch.spellDC).toBe(13);
    expect(patch.spellAttack).toBe(5);
  });

  it("does not stamp a calc block for a non-caster with no spellcasting source", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeFighter());
    expect(patch.spellcastingCalc).toBeUndefined();
    expect(patch.spellDC).toBeUndefined();
    expect(patch.spellAttack).toBeUndefined();
  });

  it("never overwrites an existing (adopted) spellcastingCalc on re-seed", () => {
    const character = makeCleric({ wis: 16 });
    character.spellcastingCalc = { mode: "fixed", bySource: {}, freeform: [], fixed: { dc: 20, attack: 11 } };
    character.spellDC = 20;
    character.spellAttack = 11;
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.spellcastingCalc).toBeUndefined(); // existing block preserved
    expect(patch.spellDC).toBeUndefined(); // flat fields already set → fill-when-empty no-op
  });

  it("does not stamp a calc block over a diverged legacy value (manual 99 stays a snapshot)", () => {
    const character = makeCleric({ wis: 16 });
    character.spellDC = 99; // manual edit under the old snapshot model
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.spellDC).toBeUndefined();
    // Stamping would visibly flip the tile from 99 to the derived 13 without
    // the user choosing adoption — so the character stays legacy.
    expect(patch.spellcastingCalc).toBeUndefined();
  });

  it("stamps the calc block on re-seed when the stored value already matches the derivation", () => {
    const character = makeCleric({ wis: 16 });
    character.spellDC = 13; // untouched seeded value (Wis 16, prof +2)
    character.spellAttack = 5;
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.spellcastingCalc?.mode).toBe("derived"); // display unchanged at stamp time
  });

  it("refreshes the flat mirror on re-seed for an existing derived block", () => {
    const character = makeCleric({ wis: 16 });
    character.spellcastingCalc = {
      mode: "derived",
      bySource: { wis: { dcAdjustment: 1, attackAdjustment: 0 } },
      freeform: [],
      fixed: { dc: null, attack: null }
    };
    character.spellDC = 13; // stale mirror: derived 13 + adj 1 = 14
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.spellDC).toBe(14);
  });

  it("survives sanitizeForSave without a schema migration (open-shape passthrough)", () => {
    const character = makeCleric({ wis: 16 });
    character.id = "c1";
    character.spellcastingCalc = { mode: "derived", bySource: { wis: { dcAdjustment: 1, attackAdjustment: 0 } }, freeform: [], fixed: { dc: null, attack: null } };
    const state = { characters: { activeId: "c1", entries: [character] } };
    const saved = sanitizeForSave(state);
    const roundTripped = saved.characters.entries[0].spellcastingCalc;
    expect(normalizeSpellcastingCalc(roundTripped)).toEqual({
      mode: "derived",
      bySource: { wis: { dcAdjustment: 1, attackAdjustment: 0 } },
      freeform: [],
      fixed: { dc: null, attack: null }
    });
  });

  it("a seeded caster then derives live: raising Wisdom moves the DC with no re-seed", () => {
    const character = makeCleric({ wis: 16 });
    const patch = getBuilderFinishSheetSeedPatch(character);
    character.spellcastingCalc = patch.spellcastingCalc;
    const registry = BUILTIN_CONTENT_REGISTRY;
    expect(getSpellcastingDisplayModel(character, deriveCharacter(character, registry)).profiles[0].dc).toBe(13);
    character.build.abilities.base.wis = 20; // +5
    expect(getSpellcastingDisplayModel(character, deriveCharacter(character, registry)).profiles[0].dc).toBe(15);
  });
});

describe("spell DC / attack at Level Up (calc-aware policies)", () => {
  const registry = BUILTIN_CONTENT_REGISTRY;

  /** Clones `before` and appends one cleric level. */
  function levelUp(before) {
    const after = JSON.parse(JSON.stringify(before));
    after.build.levels.push({ classId: "cleric", hp: null });
    return after;
  }

  it("derived mode: refreshes the flat mirror across a proficiency threshold, adjustment included", () => {
    // Cleric 4 → 5: proficiency +2 → +3. Wis 16 (+3), DC adj +1, attack adj +2.
    const before = makeCleric({ levels: 4, wis: 16 });
    before.spellcastingCalc = {
      mode: "derived",
      bySource: { wis: { dcAdjustment: 1, attackAdjustment: 2 } },
      freeform: [],
      fixed: { dc: null, attack: null }
    };
    before.spellDC = 14; // (8+2+3) + 1
    before.spellAttack = 7; // (2+3) + 2
    const { patch, preserved } = getLevelUpSheetSeedPatch(before, levelUp(before), registry);
    expect(patch.spellDC).toBe(15); // (8+3+3) + 1 — adjustment survived
    expect(patch.spellAttack).toBe(8); // (3+3) + 2
    expect(preserved.filter((line) => /Spell/.test(line))).toEqual([]);
  });

  it("fixed mode: flat values are left alone and reported as preserved", () => {
    const before = makeCleric({ levels: 4, wis: 16 });
    before.spellcastingCalc = { mode: "fixed", bySource: {}, freeform: [], fixed: { dc: 17, attack: 9 } };
    before.spellDC = 17;
    before.spellAttack = 9;
    const { patch, preserved } = getLevelUpSheetSeedPatch(before, levelUp(before), registry);
    expect(patch.spellDC).toBeUndefined();
    expect(patch.spellAttack).toBeUndefined();
    expect(preserved).toContain("Spell Save DC 17 — fixed value kept");
    expect(preserved).toContain("Spell Attack +9 — fixed value kept".replace("+9", "9"));
  });

  it("legacy (no calc block): keeps the recompute-if-untouched snapshot policy", () => {
    const before = makeCleric({ levels: 4, wis: 16 });
    before.spellDC = 13; // matches the old derived value → untouched → recompute
    before.spellAttack = 99; // diverged manual value → kept + reported
    const { patch, preserved } = getLevelUpSheetSeedPatch(before, levelUp(before), registry);
    expect(patch.spellDC).toBe(14); // 8 + 3 + 3
    expect(patch.spellAttack).toBeUndefined();
    expect(preserved).toContain("Spell Attack 99 — manual value kept");
  });
});
