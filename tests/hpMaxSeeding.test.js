// Max HP under the calculation contract (F2 batch 4): Finish seeding stamps a
// derived hpMaxCalc only when it cannot change what the user sees; Level Up
// is calc-aware (derived re-derives, fixed preserved, legacy accumulates);
// linked tracker cards resolve the displayed value and never overwrite a
// calc-managed max; current HP stays play-state.
import { describe, expect, it } from "vitest";

import { getBuilderFinishSheetSeedPatch, getLevelUpSheetSeedPatch } from "../js/domain/builderSheetSeeding.js";
import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { resolveCardDisplayData, writeCardLinkedField, snapshotLinkedFieldsToCard } from "../js/domain/cardLinking.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;

// Human fighter, Con 13 (+1 human → +2/level): L1 = 12, L2 = +8 → 20.
function makeFighter({ levels = 1, sheet = {} } = {}) {
  const character = makeDefaultBuilderCharacterEntry("HP Seed Fighter");
  character.build.raceId = "human";
  character.build.levels = Array.from({ length: levels }, () => ({ classId: "fighter", hp: null }));
  character.build.backgroundId = "acolyte";
  character.build.abilities.base = { str: 15, dex: 12, con: 13, int: 10, wis: 10, cha: 8 };
  Object.assign(character, sheet);
  return character;
}

describe("max HP Finish seeding (calc stamp + mirror)", () => {
  it("stamps a derived hpMaxCalc and fills the flat mirror for a new builder character", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeFighter());
    expect(patch.hpMaxCalc).toEqual({ mode: "derived", adjustment: 0 });
    expect(patch.hpMax).toBe(12);
    expect(patch.hpCur).toBe(12);
  });

  it("stamps on re-seed when the stored max already equals the derivation", () => {
    const character = makeFighter({ sheet: { hpMax: 12, hpCur: 12 } });
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.hpMaxCalc).toEqual({ mode: "derived", adjustment: 0 });
    expect(patch.hpMax).toBeUndefined();
    expect(patch.hpCur).toBeUndefined();
  });

  it("does not stamp over a diverged legacy max (manual 99 stays a snapshot)", () => {
    const character = makeFighter({ sheet: { hpMax: 99, hpCur: 99 } });
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.hpMaxCalc).toBeUndefined();
    expect(patch.hpMax).toBeUndefined();
  });

  it("refreshes the derived mirror on re-seed and clamps current HP to a lowered max", () => {
    const character = makeFighter({ sheet: { hpMax: 30, hpCur: 30 } }); // stale high mirror
    character.hpMaxCalc = { mode: "derived", adjustment: 0 };
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.hpMax).toBe(12);
    expect(patch.hpCur).toBe(12); // clamped down with the max
  });

  it("does not touch current HP when the refreshed mirror is higher (no auto-heal)", () => {
    const character = makeFighter({ sheet: { hpMax: 10, hpCur: 4 } });
    character.hpMaxCalc = { mode: "derived", adjustment: 0 };
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.hpMax).toBe(12);
    expect(patch.hpCur).toBeUndefined(); // wounded stays wounded
  });

  it("leaves a fixed-mode max alone on re-seed", () => {
    const character = makeFighter({ sheet: { hpMax: 50, hpCur: 50 } });
    character.hpMaxCalc = { mode: "fixed", adjustment: 0 };
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.hpMaxCalc).toBeUndefined();
    expect(patch.hpMax).toBeUndefined();
  });
});

describe("max HP at Level Up (calc-aware policies)", () => {
  function levelUp(before) {
    const after = JSON.parse(JSON.stringify(before));
    after.build.levels.push({ classId: "fighter", hp: null });
    return after;
  }

  it("derived mode: re-derives the mirror (adjustment included) and moves current HP by the delta", () => {
    const before = makeFighter({ sheet: { hpMax: 17, hpCur: 9 } }); // 12 + adj 5, wounded by 8
    before.hpMaxCalc = { mode: "derived", adjustment: 5 };
    const { patch, preserved } = getLevelUpSheetSeedPatch(before, levelUp(before), registry);
    expect(patch.hpMax).toBe(20 + 5); // derived after (20) + adjustment
    expect(patch.hpCur).toBe(9 + 8); // moved by the max delta; wound gap kept
    expect(preserved.filter((line) => /HP/.test(line))).toEqual([]);
  });

  it("fixed mode: max and current are left alone and reported as preserved", () => {
    const before = makeFighter({ sheet: { hpMax: 50, hpCur: 44 } });
    before.hpMaxCalc = { mode: "fixed", adjustment: 0 };
    const { patch, preserved } = getLevelUpSheetSeedPatch(before, levelUp(before), registry);
    expect(patch.hpMax).toBeUndefined();
    expect(patch.hpCur).toBeUndefined();
    expect(preserved).toContain("Max HP 50 — fixed value kept");
  });

  it("legacy: keeps the accumulate-by-delta policy exactly", () => {
    const before = makeFighter({ sheet: { hpMax: 99, hpCur: 90 } });
    const { patch } = getLevelUpSheetSeedPatch(before, levelUp(before), registry);
    expect(patch.hpMax).toBe(99 + 8);
    expect(patch.hpCur).toBe(90 + 8);
  });
});

describe("tracker card linking (calc-managed max HP)", () => {
  function makeLinkedState({ hpMaxCalc = null, hpMax = 12, hpCur = 12 } = {}) {
    const character = makeFighter({ sheet: { hpMax, hpCur } });
    character.id = "char-1";
    if (hpMaxCalc) character.hpMaxCalc = hpMaxCalc;
    const card = { id: "card-1", characterId: "char-1", name: "", hpMax: null, hpCurrent: null };
    const state = {
      characters: { activeId: "char-1", entries: [character] },
      tracker: { npcs: [], party: [card] }
    };
    return { state, card, character };
  }

  it("resolves the derived max for a managed character (stale mirror does not win)", () => {
    const { state, card } = makeLinkedState({ hpMaxCalc: { mode: "derived", adjustment: 3 }, hpMax: 1 });
    const display = resolveCardDisplayData(card, state);
    expect(display.hpMax).toBe(12 + 3);
    expect(display.hpMaxManaged).toBe("derived");
  });

  it("declines linked hpMax writes for managed characters; current HP stays writable", () => {
    const { state, card, character } = makeLinkedState({ hpMaxCalc: { mode: "derived", adjustment: 0 } });
    expect(writeCardLinkedField(card, "hpMax", 40, state).written).toBe(false);
    expect(character.hpMax).toBe(12);
    expect(writeCardLinkedField(card, "hpCurrent", 7, state).written).toBe(true);
    expect(character.hpCur).toBe(7);
  });

  it("legacy characters keep the linked write-through behavior", () => {
    const { state, card, character } = makeLinkedState();
    expect(writeCardLinkedField(card, "hpMax", 40, state).written).toBe(true);
    expect(character.hpMax).toBe(40);
  });

  it("snapshots the displayed (derived) max into the card when unlinking", () => {
    const { state, card } = makeLinkedState({ hpMaxCalc: { mode: "derived", adjustment: 3 }, hpMax: 1 });
    expect(snapshotLinkedFieldsToCard(card, state)).toBe(true);
    expect(card.hpMax).toBe(12 + 3);
    expect(card.characterId).toBeNull();
  });
});
