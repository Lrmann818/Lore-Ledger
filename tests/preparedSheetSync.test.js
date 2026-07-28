// Prepared Sheet Synchronization (C1.1).
//
// C1 made `rest.preparedByClass` authoritative and correct, but sheet seeding
// stayed additive-only: a deselected ordinary spell simply stopped appearing in
// the seed set, so its row kept `prepared: true` forever. These tests pin the
// projection that closes that gap, and the spells-only scope of the Long Rest
// patch that carries it.
import { afterEach, describe, expect, it } from "vitest";

import {
  getBuilderFinishSheetSeedPatch,
  getLongRestPreparedSheetPatch
} from "../js/domain/builderSheetSeeding.js";
import { makeDefaultBuilderCharacterEntry, makeDefaultCharacterEntry } from "../js/domain/characterHelpers.js";
import { applyLongRest } from "../js/domain/characterRest.js";
import { setActiveCustomContent } from "../js/domain/rules/registry.js";

/** Seed a fresh builder sheet exactly the way creation Finish does. */
function finish(character) {
  return { ...character, ...getBuilderFinishSheetSeedPatch(character) };
}

function rows(character) {
  return (character.spells?.levels || []).flatMap((level) => level.spells || []);
}

function row(character, name) {
  return rows(character).find((spell) => spell.name === name);
}

function preparedNames(character) {
  return rows(character).filter((spell) => spell.prepared).map((spell) => spell.name).sort();
}

/**
 * Replays the production Long Rest transaction
 * (characterPage.js -> runCharacterRestAction).
 */
function longRest(character, selection = {}) {
  const result = applyLongRest(character, selection);
  if (result.error || !result.changed) return { ...result, character };
  let next = result.character;
  const submitted = selection.preparedByClass;
  const classIds = submitted && typeof submitted === "object" && !Array.isArray(submitted)
    ? Object.keys(submitted)
    : [];
  if (classIds.length) {
    const patch = getLongRestPreparedSheetPatch(next, classIds);
    if (patch) next = { ...next, ...patch };
  }
  return { ...result, character: next };
}

/**
 * Cleric 3 (no subclass, so nothing is granted and every pick is ordinary).
 * The Life domain deliberately is *not* used here: its bless / cure-wounds /
 * lesser-restoration / spiritual-weapon are grants, which the sync must never
 * touch — they get their own cases below.
 */
function cleric(preparedIds = ["cure-wounds", "healing-word", "shield-of-faith"]) {
  const character = makeDefaultBuilderCharacterEntry("Cleric Mira");
  character.id = "char_cleric";
  character.build.raceId = "human";
  character.build.backgroundId = "acolyte";
  character.build.levels = Array.from({ length: 3 }, () => ({ classId: "cleric", hp: 5 }));
  character.build.abilities.base = { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 10 };
  character.build.spellcasting = { cleric: { cantripIds: ["guidance"], knownIds: [], preparedIds: [] } };
  character.hpCur = 10;
  character.hpMax = 24;
  character.rest = { hitDiceSpent: {}, preparedByClass: { cleric: preparedIds } };
  return character;
}

/** Cleric 3 / Druid 3 — both prepare Cure Wounds, so rows are shared. */
function clericDruid() {
  const character = makeDefaultBuilderCharacterEntry("Shared Vex");
  character.id = "char_shared";
  character.build.raceId = "human";
  character.build.backgroundId = "acolyte";
  character.build.levels = [
    ...Array.from({ length: 3 }, () => ({ classId: "cleric", hp: 5 })),
    ...Array.from({ length: 3 }, () => ({ classId: "druid", hp: 5 }))
  ];
  character.build.abilities.base = { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 10 };
  character.build.spellcasting = {
    cleric: { cantripIds: [], knownIds: [], preparedIds: [] },
    druid: { cantripIds: [], knownIds: [], preparedIds: [] }
  };
  character.hpCur = 10;
  character.hpMax = 30;
  character.rest = {
    hitDiceSpent: {},
    preparedByClass: {
      cleric: ["cure-wounds", "healing-word"],
      druid: ["cure-wounds", "entangle"]
    }
  };
  return character;
}

const grantingSubclass = {
  id: "storm-custom",
  kind: "subclass",
  name: "Storm (custom)",
  classId: "cleric",
  grantedSpells: [{ spellId: "bless", classLevel: 1, grantType: "always_prepared" }]
};

afterEach(() => {
  setActiveCustomContent([]);
});

describe("prepared sheet sync — deselect, deselect-all, reselect", () => {
  it("clears the row of a deselected ordinary spell", () => {
    const before = finish(cleric());
    expect(row(before, "Healing Word").prepared).toBe(true);

    const after = longRest(before, { preparedByClass: { cleric: ["cure-wounds", "shield-of-faith"] } }).character;

    expect(after.rest.preparedByClass.cleric).toEqual(["cure-wounds", "shield-of-faith"]);
    expect(row(after, "Healing Word").prepared).toBe(false);
    expect(row(after, "Cure Wounds").prepared).toBe(true);
    expect(row(after, "Shield of Faith").prepared).toBe(true);
  });

  it("clears every ordinary row when the whole class is deselected", () => {
    const before = finish(cleric());
    expect(preparedNames(before)).toEqual(["Cure Wounds", "Healing Word", "Shield of Faith"]);

    const after = longRest(before, { preparedByClass: { cleric: [] } }).character;

    // C1 merge contract: clearing a class drops its key entirely.
    expect(after.rest.preparedByClass.cleric).toBeUndefined();
    expect(preparedNames(after)).toEqual([]);
  });

  it("restores the row when the spell is prepared again", () => {
    const cleared = longRest(finish(cleric()), { preparedByClass: { cleric: [] } }).character;
    expect(row(cleared, "Healing Word").prepared).toBe(false);

    cleared.hpCur = 5;
    const reselected = longRest(cleared, { preparedByClass: { cleric: ["healing-word"] } }).character;

    expect(reselected.rest.preparedByClass.cleric).toEqual(["healing-word"]);
    expect(row(reselected, "Healing Word").prepared).toBe(true);
    expect(row(reselected, "Cure Wounds").prepared).toBe(false);
  });

  it("adds a row for a spell prepared for the first time", () => {
    const before = finish(cleric(["cure-wounds"]));
    expect(row(before, "Command")).toBeUndefined();

    const after = longRest(before, { preparedByClass: { cleric: ["cure-wounds", "command"] } }).character;

    expect(row(after, "Command")).toMatchObject({ prepared: true, builderSpellId: "command", known: true });
  });
});

describe("prepared sheet sync — rows it must never touch", () => {
  it("keeps granted rows prepared even when nothing ordinary is prepared", () => {
    setActiveCustomContent([grantingSubclass]);
    const character = cleric(["cure-wounds"]);
    character.build.subclassByClass = { cleric: "storm-custom" };
    const before = finish(character);
    expect(row(before, "Bless")).toMatchObject({ prepared: true, builderGranted: true });

    const after = longRest(before, { preparedByClass: { cleric: [] } }).character;

    expect(row(after, "Bless")).toMatchObject({ prepared: true, builderGranted: true });
    expect(row(after, "Cure Wounds").prepared).toBe(false);
  });

  it("never clears a granted row whose id also still sits in stored prepared state", () => {
    setActiveCustomContent([grantingSubclass]);
    const character = cleric(["bless", "cure-wounds"]);
    character.build.subclassByClass = { cleric: "storm-custom" };
    const before = finish(character);

    // An active recommit drops the redundant granted id (C1 merge contract).
    const after = longRest(before, { preparedByClass: { cleric: ["cure-wounds"] } }).character;

    expect(after.rest.preparedByClass.cleric).toEqual(["cure-wounds"]);
    expect(row(after, "Bless")).toMatchObject({ prepared: true, builderGranted: true });
  });

  it("never touches a manual row, even when its name collides with a class spell", () => {
    const character = cleric(["cure-wounds"]);
    character.spells = {
      levels: [{
        id: "lvl_user",
        label: "1st Level",
        hasSlots: true,
        used: 3,
        total: 4,
        collapsed: false,
        spells: [{ id: "sp_manual", name: "Healing Word", notesCollapsed: true, known: true, prepared: true, expended: false }]
      }]
    };
    const before = finish(character);
    expect(row(before, "Healing Word")).toMatchObject({ id: "sp_manual", prepared: true });
    expect(row(before, "Healing Word").builderSpellId).toBeUndefined();

    const after = longRest(before, { preparedByClass: { cleric: [] } }).character;

    expect(row(after, "Healing Word")).toMatchObject({ id: "sp_manual", prepared: true });
  });

  it("leaves a freeform character alone entirely", () => {
    const freeform = makeDefaultCharacterEntry("Freeform Mira");
    freeform.hpCur = 10;
    freeform.hpMax = 20;
    freeform.spells = {
      levels: [{
        id: "l1",
        label: "1st Level",
        hasSlots: true,
        used: 1,
        total: 3,
        collapsed: false,
        spells: [{ id: "sp_manual", name: "Cure Wounds", notesCollapsed: true, known: true, prepared: true, expended: false }]
      }]
    };

    expect(getLongRestPreparedSheetPatch(freeform, ["cleric"])).toBeNull();
    const after = longRest(freeform, { preparedByClass: { cleric: [] } }).character;
    expect(row(after, "Cure Wounds")).toMatchObject({ id: "sp_manual", prepared: true });
  });
});

describe("prepared sheet sync — multiclass", () => {
  it("keeps a shared spell prepared while the other class still prepares it", () => {
    const before = finish(clericDruid());
    expect(row(before, "Cure Wounds").prepared).toBe(true);

    // The cleric drops Cure Wounds; the druid still holds it.
    const after = longRest(before, { preparedByClass: { cleric: ["healing-word"] } }).character;

    expect(after.rest.preparedByClass).toEqual({
      cleric: ["healing-word"],
      druid: ["cure-wounds", "entangle"]
    });
    expect(row(after, "Cure Wounds").prepared).toBe(true);
  });

  it("clears a shared spell only once every prepared caster has dropped it", () => {
    const first = longRest(finish(clericDruid()), { preparedByClass: { cleric: ["healing-word"] } }).character;
    first.hpCur = 5;
    const second = longRest(first, { preparedByClass: { druid: ["entangle"] } }).character;

    expect(second.rest.preparedByClass).toEqual({ cleric: ["healing-word"], druid: ["entangle"] });
    expect(row(second, "Cure Wounds").prepared).toBe(false);
    expect(row(second, "Healing Word").prepared).toBe(true);
    expect(row(second, "Entangle").prepared).toBe(true);
  });

  it("a recommitted class never rewrites rows owned only by an untouched class", () => {
    const before = finish(clericDruid());
    const entangle = row(before, "Entangle");

    const after = longRest(before, { preparedByClass: { cleric: [] } }).character;

    // Entangle is not a cleric spell, so the cleric recommit cannot reach it.
    expect(row(after, "Entangle")).toEqual(entangle);
    expect(row(after, "Entangle").prepared).toBe(true);
  });
});

describe("prepared sheet sync — identity, user-owned fields, row count", () => {
  it("preserves row id, name, marker, known, notes flag and expended state", () => {
    const before = finish(cleric());
    const target = rows(before).find((spell) => spell.builderSpellId === "healing-word");
    target.notesCollapsed = false;
    target.known = true;
    target.expended = true;
    const snapshot = { ...target };

    const patch = getLongRestPreparedSheetPatch(
      { ...before, rest: { hitDiceSpent: {}, preparedByClass: { cleric: ["cure-wounds"] } } },
      ["cleric"]
    );
    const after = { ...before, ...patch };
    const synced = row(after, "Healing Word");

    expect(synced.prepared).toBe(false);
    // Every other field is byte-identical — only the boolean moved.
    expect({ ...synced, prepared: snapshot.prepared }).toEqual(snapshot);
  });

  it("creates and deletes no rows while synchronizing", () => {
    const before = finish(cleric());
    const beforeIds = rows(before).map((spell) => spell.id);

    const after = longRest(before, { preparedByClass: { cleric: [] } }).character;

    expect(rows(after).map((spell) => spell.id)).toEqual(beforeIds);
  });

  it("does not disturb slot rows, totals or usage", () => {
    const before = finish(cleric());
    const patch = getLongRestPreparedSheetPatch(
      { ...before, rest: { hitDiceSpent: {}, preparedByClass: { cleric: [] } } },
      ["cleric"]
    );

    expect(patch.spells.levels.map((level) => ({ label: level.label, total: level.total })))
      .toEqual(before.spells.levels.map((level) => ({ label: level.label, total: level.total })));
  });
});

describe("prepared sheet sync — fail-soft and scope guards", () => {
  it("returns null when no class was recommitted", () => {
    const character = finish(cleric());
    expect(getLongRestPreparedSheetPatch(character, [])).toBeNull();
    expect(getLongRestPreparedSheetPatch(character, null)).toBeNull();
    expect(getLongRestPreparedSheetPatch(character, ["   "])).toBeNull();
  });

  it("returns null when nothing changed", () => {
    const character = finish(cleric());
    expect(getLongRestPreparedSheetPatch(character, ["cleric"])).toBeNull();
  });

  it("fails soft for a class with no resolvable plan entry", () => {
    const before = finish(cleric());
    expect(() => getLongRestPreparedSheetPatch(before, ["no-such-class", "bard"])).not.toThrow();
    expect(getLongRestPreparedSheetPatch(before, ["no-such-class", "bard"])).toBeNull();
  });

  it("fails soft when a custom prepared class is deleted mid-session", () => {
    setActiveCustomContent([{
      id: "oracle",
      kind: "class",
      name: "Oracle",
      hitDie: 8,
      spellcasting: { ability: "wis", progression: "full", preparationMode: "prepared" }
    }]);
    const character = makeDefaultBuilderCharacterEntry("Oracle Sim");
    character.build.levels = Array.from({ length: 3 }, () => ({ classId: "oracle", hp: 5 }));
    character.build.abilities.base = { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 10 };
    character.build.spellcasting = { oracle: { cantripIds: [], knownIds: [], preparedIds: [] } };
    character.hpCur = 5;
    character.hpMax = 20;
    character.rest = { hitDiceSpent: {}, preparedByClass: { oracle: ["star-ward"] } };
    const seeded = finish(character);

    setActiveCustomContent([]);
    expect(() => getLongRestPreparedSheetPatch(seeded, ["oracle"])).not.toThrow();
    expect(getLongRestPreparedSheetPatch(seeded, ["oracle"])).toBeNull();
    expect(seeded.rest.preparedByClass).toEqual({ oracle: ["star-ward"] });
  });
});

describe("Long Rest patch scope — spells only", () => {
  /** A builder cleric whose sheet the player has since edited down. */
  function editedSheet() {
    const source = cleric();
    source.build.equipment = {
      armorId: "chain-mail",
      shield: true,
      weaponIds: ["mace"],
      startingChoices: {},
      notes: "Holy symbol of the dawn"
    };
    const character = finish(source);
    character.features = "My own note";
    character.languages = "";
    character.armorProf = "";
    character.weaponProf = "";
    character.toolProf = "";
    character.attacks = [];
    character.inventoryItems = [];
    character.resources = [];
    character.ac = 11;
    character.hpMax = 24;
    character.hpCur = 6;
    return character;
  }

  it("returns a patch containing nothing but spells", () => {
    const character = editedSheet();
    const patch = getLongRestPreparedSheetPatch(
      { ...character, rest: { hitDiceSpent: {}, preparedByClass: { cleric: [] } } },
      ["cleric"]
    );

    expect(Object.keys(patch)).toEqual(["spells"]);
  });

  it("does not restore deleted features, proficiencies, attacks, inventory or resources", () => {
    const before = editedSheet();

    const after = longRest(before, { preparedByClass: { cleric: [] } }).character;

    expect(after.features).toBe("My own note");
    expect(after.languages).toBe("");
    expect(after.armorProf).toBe("");
    expect(after.weaponProf).toBe("");
    expect(after.toolProf).toBe("");
    expect(after.attacks).toEqual([]);
    expect(after.inventoryItems).toEqual([]);
    expect(after.resources).toEqual([]);
    // The prepared change still applied.
    expect(preparedNames(after)).toEqual([]);
  });

  it("does not rewrite AC or calculation metadata", () => {
    const before = editedSheet();
    const acBefore = before.ac;
    const acCalcBefore = before.acCalc;
    const spellDCBefore = before.spellDC;

    const after = longRest(before, { preparedByClass: { cleric: [] } }).character;

    expect(after.ac).toBe(acBefore);
    expect(after.acCalc).toEqual(acCalcBefore);
    expect(after.spellDC).toBe(spellDCBefore);
    // HP still restores — that is Long Rest's own rule, not seeding.
    expect(after.hpCur).toBe(24);
  });

  it("the full Finish patch, by contrast, would restore all of it", () => {
    // Pins *why* the Long Rest patch had to be narrowed: the Finish patch is
    // still the creation/edit contract and is intentionally unchanged.
    const patch = getBuilderFinishSheetSeedPatch(editedSheet());

    expect(patch.features).toContain("My own note");
    expect(patch.armorProf).toBeTruthy();
    expect(patch.attacks?.length).toBeGreaterThan(0);
    expect(patch.inventoryItems?.length).toBeGreaterThan(0);
  });
});

describe("default seeding callers stay byte-identical", () => {
  it("the Finish patch still ignores a deselected spell (additive-only)", () => {
    const seeded = finish(cleric());
    const deselected = { ...seeded, rest: { hitDiceSpent: {}, preparedByClass: { cleric: [] } } };

    // No sync ids -> no projection -> no spells patch at all, exactly as before.
    expect(getBuilderFinishSheetSeedPatch(deselected).spells).toBeUndefined();
    expect(row(deselected, "Healing Word").prepared).toBe(true);
  });

  it("re-running the Finish patch on a synced sheet changes nothing", () => {
    const synced = longRest(finish(cleric()), { preparedByClass: { cleric: [] } }).character;
    const before = JSON.parse(JSON.stringify(synced.spells));

    const patch = getBuilderFinishSheetSeedPatch(synced);

    expect(patch.spells).toBeUndefined();
    expect(synced.spells).toEqual(before);
  });
});
