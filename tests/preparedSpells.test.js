import { afterEach, describe, expect, it } from "vitest";

import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import {
  getPreparedSpellPlan,
  getPreparedSpellUnderfillShortfalls,
  isPreparedCasterMode,
  PREPARED_LIMITED_BY,
  samePreparedSelection
} from "../js/domain/rules/preparedSpells.js";
import { getActiveContentRegistry, setActiveCustomContent } from "../js/domain/rules/registry.js";

function registry() {
  return getActiveContentRegistry();
}

function planFor(character, classId) {
  return getPreparedSpellPlan(character, registry()).find((entry) => entry.classId === classId);
}

/**
 * A single-classed builder caster with a neutral 10 in every ability except
 * the one named.
 */
function caster(classId, ability, score, level) {
  const character = makeDefaultBuilderCharacterEntry(`${classId} ${level}`);
  character.build.levels = Array.from({ length: level }, () => ({ classId, hp: 5 }));
  character.build.abilities.base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, [ability]: score };
  character.build.spellcasting = { [classId]: { cantripIds: [], knownIds: [], preparedIds: [] } };
  character.rest = { hitDiceSpent: {}, preparedByClass: {} };
  return character;
}

/** Spell ids on one class's list at exactly one spell level. */
function classSpellIdsAtLevel(classId, spellLevel) {
  return registry().byKind.get("spell")
    .filter((entry) => Number(entry.data?.level) === spellLevel &&
      (entry.data?.classIds || []).includes(classId))
    .map((entry) => entry.id);
}

afterEach(() => {
  setActiveCustomContent([]);
});

describe("prepared spell plan — formula capacity", () => {
  it.each([
    ["cleric", "wis", 16, 3, 6],
    ["druid", "wis", 16, 3, 6],
    ["paladin", "cha", 16, 4, 5],
    ["wizard", "int", 16, 3, 6]
  ])("derives %s formula capacity from canonical spellcasting data", (classId, ability, score, level, expected) => {
    const entry = planFor(caster(classId, ability, score, level), classId);
    expect(entry.formulaCapacity).toBe(expected);
    expect(entry.preparationMode).toBe(classId === "wizard" ? "spellbook" : "prepared");
  });

  it("clamps a punishing ability modifier to a minimum of one", () => {
    expect(planFor(caster("cleric", "wis", 6, 1), "cleric").formulaCapacity).toBe(1);
  });

  it("keeps an unknown capacity null rather than coercing it to zero", () => {
    const character = caster("cleric", "wis", 16, 3);
    character.build.abilities.base.wis = null;

    const entry = planFor(character, "cleric");
    expect(entry.formulaCapacity).toBeNull();
    expect(entry.effectiveCapacity).toBeNull();
    expect(entry.limitedBy).toBe(PREPARED_LIMITED_BY.UNKNOWN);
    expect(entry.ordinaryCandidateIds.length).toBeGreaterThan(0);
  });

  it("reports no plan entry for known-spell casters or freeform characters", () => {
    expect(getPreparedSpellPlan(caster("bard", "cha", 16, 3), registry())).toEqual([]);
    expect(getPreparedSpellPlan(caster("sorcerer", "cha", 16, 3), registry())).toEqual([]);
    expect(getPreparedSpellPlan({ id: "c", build: null }, registry())).toEqual([]);
    expect(getPreparedSpellPlan(null, registry())).toEqual([]);
  });

  it("classifies preparation modes", () => {
    expect(isPreparedCasterMode("prepared")).toBe(true);
    expect(isPreparedCasterMode("spellbook")).toBe(true);
    expect(isPreparedCasterMode("known")).toBe(false);
    expect(isPreparedCasterMode(undefined)).toBe(false);
  });
});

describe("prepared spell plan — effective capacity", () => {
  it("uses the formula when enough candidates exist", () => {
    const entry = planFor(caster("cleric", "wis", 16, 3), "cleric");
    expect(entry.effectiveCapacity).toBe(entry.formulaCapacity);
    expect(entry.limitedBy).toBe(PREPARED_LIMITED_BY.FORMULA);
    expect(entry.ordinaryCandidateIds.length).toBeGreaterThan(entry.formulaCapacity);
  });

  it("a wizard spellbook smaller than the formula bounds the effective capacity", () => {
    const wizard = caster("wizard", "int", 16, 3);
    wizard.build.spellcasting.wizard.knownIds = ["magic-missile", "shield"];

    const entry = planFor(wizard, "wizard");
    expect(entry.formulaCapacity).toBe(6);
    expect(entry.ordinaryCandidateIds).toEqual(["magic-missile", "shield"]);
    expect(entry.effectiveCapacity).toBe(2);
    expect(entry.limitedBy).toBe(PREPARED_LIMITED_BY.CANDIDATES);
  });

  it("a level 20 wizard whose spellbook never grew stays limited by candidates", () => {
    const wizard = caster("wizard", "int", 20, 20);
    wizard.build.spellcasting.wizard.knownIds = ["magic-missile", "shield", "fireball"];

    const entry = planFor(wizard, "wizard");
    expect(entry.formulaCapacity).toBe(25);
    expect(entry.effectiveCapacity).toBe(3);
    expect(entry.limitedBy).toBe(PREPARED_LIMITED_BY.CANDIDATES);
  });

  it("builtin prepared casters are never candidate-limited at level 20", () => {
    for (const [classId, ability] of [["cleric", "wis"], ["druid", "wis"], ["paladin", "cha"]]) {
      const entry = planFor(caster(classId, ability, 20, 20), classId);
      expect(entry.limitedBy).toBe(PREPARED_LIMITED_BY.FORMULA);
      expect(entry.effectiveCapacity).toBe(entry.formulaCapacity);
    }
  });
});

describe("prepared spell underfill — transient confirmation decision", () => {
  it("reports the current legal list against effective capacity", () => {
    const cleric = caster("cleric", "wis", 16, 3);
    cleric.rest.preparedByClass = { cleric: ["bless", "command"] };
    const plan = getPreparedSpellPlan(cleric, registry());

    expect(getPreparedSpellUnderfillShortfalls(plan)).toEqual([{
      classId: "cleric",
      className: "Cleric",
      selectedIds: ["bless", "command"],
      selectedCount: 2,
      effectiveCapacity: 6
    }]);
  });

  it("evaluates an in-progress resulting list without mutating the plan", () => {
    const cleric = caster("cleric", "wis", 6, 1);
    const plan = getPreparedSpellPlan(cleric, registry());
    const before = structuredClone(plan);

    expect(getPreparedSpellUnderfillShortfalls(plan, { cleric: [] })).toEqual([{
      classId: "cleric",
      className: "Cleric",
      selectedIds: [],
      selectedCount: 0,
      effectiveCapacity: 1
    }]);
    expect(getPreparedSpellUnderfillShortfalls(plan, { cleric: ["bless"] })).toEqual([]);
    expect(plan).toEqual(before);
  });

  it("does not confirm full, zero-capacity, or unknown-capacity lists", () => {
    const full = caster("cleric", "wis", 6, 1);
    full.rest.preparedByClass = { cleric: ["bless"] };
    expect(getPreparedSpellUnderfillShortfalls(getPreparedSpellPlan(full, registry()))).toEqual([]);

    const unknown = caster("cleric", "wis", 16, 1);
    unknown.build.abilities.base.wis = null;
    expect(getPreparedSpellUnderfillShortfalls(getPreparedSpellPlan(unknown, registry()))).toEqual([]);

    setActiveCustomContent([{
      id: "oracle",
      kind: "class",
      name: "Oracle",
      hitDie: 8,
      spellcasting: {
        ability: "wis",
        preparationMode: "prepared",
        progression: "full",
        startLevel: 1,
        slotsByLevel: [[2, 0, 0, 0, 0, 0, 0, 0, 0]]
      }
    }]);
    const zero = caster("oracle", "wis", 16, 1);
    expect(planFor(zero, "oracle").effectiveCapacity).toBe(0);
    expect(getPreparedSpellUnderfillShortfalls(getPreparedSpellPlan(zero, registry()))).toEqual([]);
  });

  it("counts only eligible ordinary candidates from supplied selections", () => {
    const cleric = caster("cleric", "wis", 6, 1);
    const plan = getPreparedSpellPlan(cleric, registry());

    expect(getPreparedSpellUnderfillShortfalls(plan, {
      cleric: ["magic-missile", "bless", "bless", " "]
    })).toEqual([]);
    expect(getPreparedSpellUnderfillShortfalls(plan, {
      cleric: ["magic-missile"]
    })[0]).toMatchObject({
      selectedIds: [],
      selectedCount: 0,
      effectiveCapacity: 1
    });
  });
});

describe("prepared spell plan — granted spells", () => {
  const grantingSubclass = {
    id: "storm-custom",
    kind: "subclass",
    name: "Storm (custom)",
    classId: "cleric",
    grantedSpells: [
      { spellId: "bless", classLevel: 1, grantType: "always_prepared" },
      { spellId: "guiding-bolt", classLevel: 1, grantType: "always_prepared" }
    ]
  };

  function grantedCleric() {
    setActiveCustomContent([grantingSubclass]);
    const cleric = caster("cleric", "wis", 16, 3);
    cleric.build.subclassByClass = { cleric: "storm-custom" };
    return cleric;
  }

  it("reports grants separately and excludes them from ordinary candidates", () => {
    const entry = planFor(grantedCleric(), "cleric");

    expect(entry.grantedIds).toEqual(["bless", "guiding-bolt"]);
    expect(entry.ordinaryCandidateIds).not.toContain("bless");
    expect(entry.ordinaryCandidateIds).not.toContain("guiding-bolt");
  });

  it("does not count a stored granted id toward the ordinary selection", () => {
    const cleric = grantedCleric();
    cleric.rest.preparedByClass = { cleric: ["bless", "guiding-bolt", "cure-wounds"] };

    expect(planFor(cleric, "cleric").selectedIds).toEqual(["cure-wounds"]);
  });

  it("leaves the full formula capacity available for ordinary spells", () => {
    const withGrants = planFor(grantedCleric(), "cleric");
    setActiveCustomContent([]);
    const without = planFor(caster("cleric", "wis", 16, 3), "cleric");

    expect(withGrants.formulaCapacity).toBe(without.formulaCapacity);
    expect(withGrants.effectiveCapacity).toBe(without.effectiveCapacity);
    expect(withGrants.ordinaryCandidateIds).toHaveLength(without.ordinaryCandidateIds.length - 2);
  });

  it("a race-granted cantrip belongs to no class and never enters a prepared list", () => {
    const cleric = caster("cleric", "wis", 16, 3);
    cleric.build.raceId = "elf";
    cleric.build.subraceId = "high-elf";
    cleric.build.choicesByLevel = { 1: { "high-elf-cantrip": "fire-bolt" } };

    const entry = planFor(cleric, "cleric");
    expect(entry.grantedIds).toEqual([]);
    expect(entry.ordinaryCandidateIds).not.toContain("fire-bolt");
  });
});

describe("prepared spell plan — multiclass spell levels", () => {
  function multiclass(levels, abilities) {
    const character = makeDefaultBuilderCharacterEntry("Multiclass");
    character.build.levels = levels;
    character.build.abilities.base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...abilities };
    character.build.spellcasting = {
      cleric: { cantripIds: [], knownIds: [], preparedIds: [] },
      wizard: { cantripIds: [], knownIds: [], preparedIds: [] }
    };
    character.rest = { hitDiceSpent: {}, preparedByClass: {} };
    return character;
  }

  it("each class uses its own table at its own class level", () => {
    // Fighter 4 / Cleric 1 / Wizard 5: combined slots reach 3rd level, but the
    // cleric's own table at cleric level 1 reaches only 1st.
    const character = multiclass([
      ...Array.from({ length: 4 }, () => ({ classId: "fighter", hp: 6 })),
      { classId: "cleric", hp: 5 },
      ...Array.from({ length: 5 }, () => ({ classId: "wizard", hp: 4 }))
    ], { wis: 16, int: 16 });
    character.build.spellcasting.wizard.knownIds = ["magic-missile", "scorching-ray", "fireball"];

    const cleric = planFor(character, "cleric");
    const wizard = planFor(character, "wizard");

    expect(cleric.maxSpellLevel).toBe(1);
    expect(wizard.maxSpellLevel).toBe(3);
    expect(cleric.formulaCapacity).toBe(4);
    expect(wizard.formulaCapacity).toBe(8);
  });

  it("combined higher-level slots never widen a class's candidate levels", () => {
    const character = multiclass([
      { classId: "cleric", hp: 5 },
      ...Array.from({ length: 5 }, () => ({ classId: "wizard", hp: 4 }))
    ], { wis: 16, int: 16 });

    const cleric = planFor(character, "cleric");
    const firstLevelOnly = classSpellIdsAtLevel("cleric", 1);
    const secondLevel = classSpellIdsAtLevel("cleric", 2);

    expect(cleric.ordinaryCandidateIds.sort()).toEqual([...firstLevelOnly].sort());
    for (const id of secondLevel) expect(cleric.ordinaryCandidateIds).not.toContain(id);
  });

  it("a paladin below its spellcasting start level is not a prepared caster yet", () => {
    const paladin = caster("paladin", "cha", 16, 1);
    expect(planFor(paladin, "paladin")).toBeUndefined();

    const paladin2 = caster("paladin", "cha", 16, 2);
    const entry = planFor(paladin2, "paladin");
    expect(entry.maxSpellLevel).toBe(1);
    expect(entry.formulaCapacity).toBe(4);
  });
});

describe("prepared spell plan — custom and malformed content", () => {
  it("a custom prepared class with no spells on its list reports zero candidates", () => {
    setActiveCustomContent([{
      id: "oracle",
      kind: "class",
      name: "Oracle",
      hitDie: 8,
      spellcasting: {
        ability: "wis",
        preparationMode: "prepared",
        progression: "full",
        startLevel: 1,
        slotsByLevel: [[2, 0, 0, 0, 0, 0, 0, 0, 0]]
      }
    }]);
    const character = caster("oracle", "wis", 16, 1);

    const entry = planFor(character, "oracle");
    expect(entry.formulaCapacity).toBe(4);
    expect(entry.ordinaryCandidateIds).toEqual([]);
    expect(entry.effectiveCapacity).toBe(0);
    expect(entry.limitedBy).toBe(PREPARED_LIMITED_BY.CANDIDATES);
  });

  it("a custom spell listing the custom class becomes an ordinary candidate", () => {
    setActiveCustomContent([
      {
        id: "oracle",
        kind: "class",
        name: "Oracle",
        hitDie: 8,
        spellcasting: {
          ability: "wis",
          preparationMode: "prepared",
          progression: "full",
          startLevel: 1,
          slotsByLevel: [[2, 0, 0, 0, 0, 0, 0, 0, 0]]
        }
      },
      { id: "star-ward", kind: "spell", name: "Star Ward", level: 1, classIds: ["oracle"] },
      { id: "star-blast", kind: "spell", name: "Star Blast", level: 2, classIds: ["oracle"] }
    ]);
    const character = caster("oracle", "wis", 16, 1);

    const entry = planFor(character, "oracle");
    // Level 2 is beyond this class level's own table and stays out.
    expect(entry.ordinaryCandidateIds).toEqual(["star-ward"]);
    expect(entry.effectiveCapacity).toBe(1);
  });

  it("a class record with no slot table fails soft to no candidates", () => {
    setActiveCustomContent([{
      id: "seer",
      kind: "class",
      name: "Seer",
      hitDie: 8,
      spellcasting: { ability: "wis", preparationMode: "prepared", progression: "full", startLevel: 1 }
    }]);
    const character = caster("seer", "wis", 16, 1);

    const entry = planFor(character, "seer");
    expect(entry.maxSpellLevel).toBe(0);
    expect(entry.ordinaryCandidateIds).toEqual([]);
  });

  it("a deleted custom class produces no plan entry and no prompt", () => {
    setActiveCustomContent([{
      id: "oracle",
      kind: "class",
      name: "Oracle",
      hitDie: 8,
      spellcasting: {
        ability: "wis",
        preparationMode: "prepared",
        progression: "full",
        startLevel: 1,
        slotsByLevel: [[2, 0, 0, 0, 0, 0, 0, 0, 0]]
      }
    }]);
    const character = caster("oracle", "wis", 16, 1);
    character.rest.preparedByClass = { oracle: ["star-ward"] };
    expect(planFor(character, "oracle")).toBeDefined();

    setActiveCustomContent([]);
    expect(getPreparedSpellPlan(character, registry())).toEqual([]);
    // Stored play-state is untouched by merely reading the plan.
    expect(character.rest.preparedByClass).toEqual({ oracle: ["star-ward"] });
  });

  it("malformed and unresolvable stored ids are ignored without being rewritten", () => {
    const cleric = caster("cleric", "wis", 16, 3);
    cleric.rest.preparedByClass = { cleric: ["bless", "no-such-spell", "  ", "bless"] };
    cleric.rest.preparedByClass.cleric.push(42, null);

    const entry = planFor(cleric, "cleric");
    expect(entry.selectedIds).toEqual(["bless"]);
    expect(cleric.rest.preparedByClass.cleric).toContain("no-such-spell");
  });

  it("a spellbook holding unresolvable ids yields only resolvable candidates", () => {
    const wizard = caster("wizard", "int", 16, 3);
    wizard.build.spellcasting.wizard.knownIds = ["magic-missile", "not-a-spell", ""];

    expect(planFor(wizard, "wizard").ordinaryCandidateIds).toEqual(["magic-missile"]);
  });

  it("falls back to the legacy build preparedIds only when no rest state exists", () => {
    const cleric = caster("cleric", "wis", 16, 3);
    cleric.build.spellcasting.cleric.preparedIds = ["bless"];
    cleric.rest = { hitDiceSpent: {}, preparedByClass: {} };
    expect(planFor(cleric, "cleric").selectedIds).toEqual(["bless"]);

    cleric.rest.preparedByClass = { cleric: ["command"] };
    expect(planFor(cleric, "cleric").selectedIds).toEqual(["command"]);
  });

  it("never throws on a malformed build", () => {
    const broken = makeDefaultBuilderCharacterEntry("Broken");
    broken.build.levels = [{ classId: "cleric", hp: 5 }, null, { classId: 42 }];
    broken.build.spellcasting = { cleric: "not-an-object" };
    broken.rest = { hitDiceSpent: {}, preparedByClass: "nope" };

    expect(() => getPreparedSpellPlan(broken, registry())).not.toThrow();
  });
});

describe("samePreparedSelection", () => {
  it("ignores order but not membership", () => {
    expect(samePreparedSelection(["a", "b"], ["b", "a"])).toBe(true);
    expect(samePreparedSelection(["a"], ["a"])).toBe(true);
    expect(samePreparedSelection([], [])).toBe(true);
    expect(samePreparedSelection(["a", "b"], ["a"])).toBe(false);
    expect(samePreparedSelection(["a", "b"], ["a", "c"])).toBe(false);
    expect(samePreparedSelection(undefined, [])).toBe(true);
  });
});
