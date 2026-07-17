// AC under the calculation contract (F2 batch 3): Finish seeding stamps a
// derived acCalc only when it cannot change what the user sees; Level Up is
// calc-aware; tracker cards and combat resolve the same displayed value and
// never overwrite a calc-managed AC.
import { describe, expect, it } from "vitest";

import { getBuilderFinishSheetSeedPatch, getLevelUpSheetSeedPatch } from "../js/domain/builderSheetSeeding.js";
import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { resolveCardDisplayData, writeCardLinkedField, snapshotLinkedFieldsToCard } from "../js/domain/cardLinking.js";
import { setCombatParticipantAc } from "../js/domain/combatEncounterActions.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;

function makeFighter({ dex = 14, armorId = "leather-armor", shield = false, sheet = {} } = {}) {
  const character = makeDefaultBuilderCharacterEntry("Seed Fighter");
  character.build.raceId = "human";
  character.build.levels = [{ classId: "fighter", hp: null }];
  character.build.backgroundId = "acolyte";
  character.build.abilities.base = { str: 15, dex, con: 13, int: 10, wis: 10, cha: 8 };
  character.build.equipment = { armorId, shield, weaponIds: [], packId: null };
  Object.assign(character, sheet);
  return character;
}

// Human fighter, dex 14 (+1 human = 15 → +2): leather 11 + 2 = 13.
const LEATHER_AC = 13;

describe("AC Finish seeding (calc stamp + mirror)", () => {
  it("stamps a derived acCalc and fills the flat mirror for a new builder character", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeFighter());
    expect(patch.acCalc).toEqual({ mode: "derived", adjustment: 0 });
    expect(patch.ac).toBe(LEATHER_AC);
  });

  it("stamps on re-seed when the stored AC already equals the derivation (display unchanged)", () => {
    const character = makeFighter({ sheet: { ac: LEATHER_AC } });
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.acCalc).toEqual({ mode: "derived", adjustment: 0 });
    expect(patch.ac).toBeUndefined();
  });

  it("does not stamp over a diverged legacy AC (manual 18 stays a snapshot)", () => {
    const character = makeFighter({ sheet: { ac: 18 } });
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.acCalc).toBeUndefined();
    expect(patch.ac).toBeUndefined();
  });

  it("never overwrites an existing calc block, and refreshes the derived mirror", () => {
    const character = makeFighter({ sheet: { ac: 5 } }); // stale mirror
    character.acCalc = { mode: "derived", adjustment: 1 };
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.acCalc).toBeUndefined();
    expect(patch.ac).toBe(LEATHER_AC + 1); // derived + adjustment
  });

  it("leaves a fixed-mode AC alone on re-seed", () => {
    const character = makeFighter({ sheet: { ac: 18 } });
    character.acCalc = { mode: "fixed", adjustment: 0 };
    const patch = getBuilderFinishSheetSeedPatch(character);
    expect(patch.acCalc).toBeUndefined();
    expect(patch.ac).toBeUndefined();
  });
});

describe("AC at Level Up (calc-aware policies)", () => {
  function levelUp(before) {
    const after = JSON.parse(JSON.stringify(before));
    after.build.levels.push({ classId: "fighter", hp: null });
    return after;
  }

  it("derived mode: refreshes the flat mirror (adjustment included), no preserved noise", () => {
    const before = makeFighter({ sheet: { ac: 5 } }); // stale mirror
    before.acCalc = { mode: "derived", adjustment: 2 };
    const { patch, preserved } = getLevelUpSheetSeedPatch(before, levelUp(before), registry);
    expect(patch.ac).toBe(LEATHER_AC + 2);
    expect(preserved.filter((line) => /Armor/.test(line))).toEqual([]);
  });

  it("fixed mode: left alone and reported as preserved", () => {
    const before = makeFighter({ sheet: { ac: 18 } });
    before.acCalc = { mode: "fixed", adjustment: 0 };
    const { patch, preserved } = getLevelUpSheetSeedPatch(before, levelUp(before), registry);
    expect(patch.ac).toBeUndefined();
    expect(preserved).toContain("Armor Class 18 — fixed value kept");
  });

  it("legacy: keeps the recompute-if-untouched snapshot policy", () => {
    const before = makeFighter({ sheet: { ac: 99 } }); // diverged manual value
    const { patch, preserved } = getLevelUpSheetSeedPatch(before, levelUp(before), registry);
    expect(patch.ac).toBeUndefined();
    expect(preserved).toContain("Armor Class 99 — manual value kept");
  });
});

describe("tracker card linking (calc-managed AC)", () => {
  function makeLinkedState({ acCalc = null, ac = 5 } = {}) {
    const character = makeFighter({ sheet: { ac } });
    character.id = "char-1";
    if (acCalc) character.acCalc = acCalc;
    const card = { id: "card-1", characterId: "char-1", name: "", ac: null };
    const state = {
      characters: { activeId: "char-1", entries: [character] },
      tracker: { npcs: [], party: [card] }
    };
    return { state, card, character };
  }

  it("resolves the derived value for a managed character (stale mirror does not win)", () => {
    const { state, card } = makeLinkedState({ acCalc: { mode: "derived", adjustment: 0 }, ac: 5 });
    const display = resolveCardDisplayData(card, state);
    expect(display.ac).toBe(LEATHER_AC);
    expect(display.acManaged).toBe("derived");
  });

  it("declines linked AC writes for managed characters and allows them for legacy", () => {
    const managed = makeLinkedState({ acCalc: { mode: "derived", adjustment: 0 } });
    const write = writeCardLinkedField(managed.card, "ac", 18, managed.state);
    expect(write.written).toBe(false);
    expect(managed.character.ac).toBe(5); // untouched

    const fixed = makeLinkedState({ acCalc: { mode: "fixed", adjustment: 0 }, ac: 18 });
    expect(writeCardLinkedField(fixed.card, "ac", 12, fixed.state).written).toBe(false);
    expect(fixed.character.ac).toBe(18); // fixed stays fixed

    const legacy = makeLinkedState();
    expect(writeCardLinkedField(legacy.card, "ac", 17, legacy.state).written).toBe(true);
    expect(legacy.character.ac).toBe(17);
  });

  it("snapshots the displayed (derived) AC into the card when unlinking", () => {
    const { state, card } = makeLinkedState({ acCalc: { mode: "derived", adjustment: 1 }, ac: 5 });
    expect(snapshotLinkedFieldsToCard(card, state)).toBe(true);
    expect(card.ac).toBe(LEATHER_AC + 1);
    expect(card.characterId).toBeNull();
  });
});

describe("combat participant AC (temporary over calculated base)", () => {
  function makeCombatState({ acCalc = null, ac = LEATHER_AC } = {}) {
    const character = makeFighter({ sheet: { ac } });
    character.id = "char-1";
    if (acCalc) character.acCalc = acCalc;
    const card = { id: "card-1", characterId: "char-1", name: "", ac: null };
    const state = {
      characters: { activeId: "char-1", entries: [character] },
      tracker: { npcs: [], party: [card] },
      combat: {
        encounter: {
          participants: [{
            id: "p-1",
            name: "Seed Fighter",
            role: "pc",
            source: { type: "party", id: "card-1", sectionId: "", group: "" },
            hpCurrent: 10,
            hpMax: 10,
            ac: null,
            tempHp: 0,
            deathSaves: { successes: 0, failures: 0 },
            statusEffects: []
          }]
        }
      }
    };
    return { state, character };
  }

  it("keeps a combat AC edit participant-local for a managed character", () => {
    const { state, character } = makeCombatState({ acCalc: { mode: "derived", adjustment: 0 } });
    const result = setCombatParticipantAc(state, "p-1", 18);
    expect(result.changed).toBe(true);
    expect(result.wroteCanonical).toBe(false);
    expect(result.participant?.ac).toBe(18); // temporary combat value
    expect(character.ac).toBe(LEATHER_AC); // durable base untouched
  });

  it("clearing the temporary value returns to the calculated base", () => {
    const { state } = makeCombatState({ acCalc: { mode: "derived", adjustment: 0 } });
    setCombatParticipantAc(state, "p-1", 18);
    const cleared = setCombatParticipantAc(state, "p-1", null);
    expect(cleared.changed).toBe(true);
    expect(cleared.participant?.ac).toBeNull();
  });

  it("legacy characters keep the canonical write-through behavior", () => {
    const { state, character } = makeCombatState();
    const result = setCombatParticipantAc(state, "p-1", 18);
    expect(result.changed).toBe(true);
    expect(result.wroteCanonical).toBe(true);
    expect(character.ac).toBe(18);
  });
});
