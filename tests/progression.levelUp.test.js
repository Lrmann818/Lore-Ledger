// Pure Level Up planning coverage: getLevelUpPlan() computes exactly what one
// appended class level newly unlocks, as a before/after diff with no state,
// no DOM, and no prepared-spell selection anywhere in the result.
import { describe, expect, it } from "vitest";

import { makeDefaultCharacterBuild } from "../js/domain/characterHelpers.js";
import {
  getLevelUpPlan,
  MAX_CHARACTER_LEVEL,
  MULTICLASS_SPELL_SLOTS,
  SPELLBOOK_INITIAL_SPELLS,
  SPELLBOOK_SPELLS_PER_LEVEL
} from "../js/domain/rules/progression.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;

function levelsOf(...classIds) {
  return classIds.map((classId) => ({ classId, hp: null }));
}

function makeBuild({
  levels = levelsOf("fighter"),
  base = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  raceId = "human",
  subclassByClass = {},
  choicesByLevel = {}
} = {}) {
  const build = makeDefaultCharacterBuild();
  build.raceId = raceId;
  build.backgroundId = "acolyte";
  build.levels = levels;
  build.subclassByClass = subclassByClass;
  build.choicesByLevel = choicesByLevel;
  build.abilities.base = { ...base };
  return build;
}

describe("one-level append invariant", () => {
  it("plans exactly one appended level", () => {
    const plan = getLevelUpPlan(makeBuild({ levels: levelsOf("fighter", "fighter") }), "fighter", registry);
    expect(plan).not.toBeNull();
    expect(plan.fromLevel).toBe(2);
    expect(plan.toLevel).toBe(3);
    expect(plan.classLevel).toBe(3);
    expect(plan.isNewClass).toBe(false);
  });

  it("never mutates the input build", () => {
    const build = makeBuild({ levels: levelsOf("fighter", "fighter") });
    const snapshot = JSON.stringify(build);
    getLevelUpPlan(build, "wizard", registry);
    expect(JSON.stringify(build)).toBe(snapshot);
  });

  it("plans level 19 → 20 but refuses level 20 → 21", () => {
    const nineteen = makeBuild({ levels: Array.from({ length: 19 }, () => ({ classId: "fighter", hp: null })) });
    const plan = getLevelUpPlan(nineteen, "fighter", registry);
    expect(plan?.toLevel).toBe(MAX_CHARACTER_LEVEL);

    const twenty = makeBuild({ levels: Array.from({ length: 20 }, () => ({ classId: "fighter", hp: null })) });
    expect(getLevelUpPlan(twenty, "fighter", registry)).toBeNull();
  });

  it("refuses a blank or unknown class", () => {
    expect(getLevelUpPlan(makeBuild(), "", registry)).toBeNull();
    expect(getLevelUpPlan(makeBuild(), "artificer", registry)).toBeNull();
    expect(getLevelUpPlan(null, "fighter", registry)).toBeNull();
  });
});

describe("subclass deltas", () => {
  it("Fighter 2 → 3 requires a subclass; the options come from the registry", () => {
    const plan = getLevelUpPlan(makeBuild({ levels: levelsOf("fighter", "fighter") }), "fighter", registry);
    expect(plan.subclassRequired).toEqual({ classId: "fighter", options: ["champion"] });
  });

  it("Cleric 1 → 2 does not require a subclass (cleric picks at 1)", () => {
    const plan = getLevelUpPlan(
      makeBuild({ levels: levelsOf("cleric"), subclassByClass: { cleric: "life" } }),
      "cleric",
      registry
    );
    expect(plan.subclassRequired).toBeNull();
  });

  it("does not re-ask when the subclass is already stored", () => {
    const plan = getLevelUpPlan(
      makeBuild({ levels: levelsOf("fighter", "fighter"), subclassByClass: { fighter: "champion" } }),
      "fighter",
      registry
    );
    expect(plan.subclassRequired).toBeNull();
    // Champion grants Improved Critical at fighter 3.
    expect(plan.newFeatureIds).toContain("improved-critical");
  });
});

describe("feature and choice deltas", () => {
  it("Fighter 4 → 5 reports Extra Attack with no ASI and no subclass", () => {
    const plan = getLevelUpPlan(
      makeBuild({
        levels: levelsOf("fighter", "fighter", "fighter", "fighter"),
        subclassByClass: { fighter: "champion" }
      }),
      "fighter",
      registry
    );
    expect(plan.newFeatureIds).toContain("extra-attack-1");
    expect(plan.asiSlot).toBeNull();
    expect(plan.subclassRequired).toBeNull();
  });

  it("Fighter 3 → 4 reports an ASI slot", () => {
    const plan = getLevelUpPlan(
      makeBuild({
        levels: levelsOf("fighter", "fighter", "fighter"),
        subclassByClass: { fighter: "champion" }
      }),
      "fighter",
      registry
    );
    expect(plan.asiSlot).toEqual({ characterLevel: 4, classId: "fighter", classLevel: 4 });
  });

  it("multiclassing into Fighter unlocks the Fighting Style choice", () => {
    const plan = getLevelUpPlan(makeBuild({ levels: levelsOf("rogue") }), "fighter", registry);
    expect(plan.isNewClass).toBe(true);
    expect(plan.newFeatureIds).toContain("fighter-fighting-style");
    expect(plan.featureChoiceIds).toContain("feature-fighter-fighting-style");
  });

  it("Bard 2 → 3 unlocks the Expertise choice", () => {
    const plan = getLevelUpPlan(makeBuild({ levels: levelsOf("bard", "bard") }), "bard", registry);
    expect(plan.featureChoiceIds).toContain("feature-bard-expertise-1");
  });

  it("earlier levels' features are not re-reported", () => {
    const plan = getLevelUpPlan(
      makeBuild({ levels: levelsOf("fighter", "fighter", "fighter"), subclassByClass: { fighter: "champion" } }),
      "fighter",
      registry
    );
    expect(plan.newFeatureIds).not.toContain("fighter-fighting-style");
    expect(plan.newFeatureIds).not.toContain("second-wind");
  });
});

describe("proficiency bonus thresholds", () => {
  it.each([
    [4, 5, 2, 3],
    [8, 9, 3, 4],
    [12, 13, 4, 5],
    [16, 17, 5, 6]
  ])("crossing %i → %i moves proficiency %i → %i", (from, to, profBefore, profAfter) => {
    const build = makeBuild({
      levels: Array.from({ length: from }, () => ({ classId: "fighter", hp: null })),
      subclassByClass: { fighter: "champion" }
    });
    const plan = getLevelUpPlan(build, "fighter", registry);
    expect(plan.toLevel).toBe(to);
    expect(plan.proficiencyBonusBefore).toBe(profBefore);
    expect(plan.proficiencyBonusAfter).toBe(profAfter);
  });
});

describe("multiclass prerequisites and skill choices", () => {
  it("warns when Fighter 5 → Wizard 1 lacks INT 13", () => {
    const plan = getLevelUpPlan(
      makeBuild({
        levels: levelsOf("fighter", "fighter", "fighter", "fighter", "fighter"),
        subclassByClass: { fighter: "champion" },
        base: { str: 15, dex: 14, con: 13, int: 10, wis: 10, cha: 8 }
      }),
      "wizard",
      registry
    );
    expect(plan.isNewClass).toBe(true);
    expect(plan.prerequisiteWarnings.join(" ")).toContain("Wizard");
    expect(plan.prerequisiteWarnings.join(" ")).toContain("INT 13");
  });

  it("does not warn when prerequisites are met", () => {
    const plan = getLevelUpPlan(
      makeBuild({
        levels: levelsOf("fighter", "fighter"),
        base: { str: 15, dex: 14, con: 13, int: 14, wis: 10, cha: 8 }
      }),
      "wizard",
      registry
    );
    expect(plan.prerequisiteWarnings).toEqual([]);
  });

  it("checks the existing class's own prerequisites too", () => {
    // Fighter requires STR 13 or DEX 13; human +1 keeps both below 13 here.
    const plan = getLevelUpPlan(
      makeBuild({
        levels: levelsOf("fighter", "fighter"),
        base: { str: 10, dex: 10, con: 13, int: 14, wis: 10, cha: 8 }
      }),
      "wizard",
      registry
    );
    expect(plan.prerequisiteWarnings.join(" ")).toContain("Fighter");
  });

  it("a new class with an SRD multiclass skill choice reports its choice id", () => {
    const plan = getLevelUpPlan(makeBuild({ levels: levelsOf("fighter") }), "rogue", registry);
    expect(plan.multiclassSkillChoiceId).toBe("multiclass-skill-rogue");
  });

  it("a new class without a multiclass skill choice reports null", () => {
    const plan = getLevelUpPlan(makeBuild({ levels: levelsOf("fighter") }), "wizard", registry);
    expect(plan.multiclassSkillChoiceId).toBeNull();
  });

  it("continuing an existing class never reopens skill choices", () => {
    const plan = getLevelUpPlan(makeBuild({ levels: levelsOf("rogue") }), "rogue", registry);
    expect(plan.multiclassSkillChoiceId).toBeNull();
  });
});

describe("spell slots and Pact Magic", () => {
  it("Wizard 1 → 2 grows slot totals without touching pact", () => {
    const plan = getLevelUpPlan(
      makeBuild({ levels: levelsOf("wizard"), base: { str: 8, dex: 14, con: 13, int: 15, wis: 10, cha: 10 } }),
      "wizard",
      registry
    );
    expect(plan.slotsBefore[0]).toBe(2);
    expect(plan.slotsAfter[0]).toBe(3);
    expect(plan.pactBefore).toBeNull();
    expect(plan.pactAfter).toBeNull();
  });

  it("Warlock 1 → 2 grows pact slots, not the standard slot array", () => {
    const plan = getLevelUpPlan(
      makeBuild({ levels: levelsOf("warlock"), base: { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 15 } }),
      "warlock",
      registry
    );
    expect(plan.slotsBefore).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(plan.slotsAfter).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(plan.pactBefore).toEqual({ slots: 1, slotLevel: 1 });
    expect(plan.pactAfter).toEqual({ slots: 2, slotLevel: 1 });
  });

  it("Warlock 2 → 3 reports the new pact slot level", () => {
    const plan = getLevelUpPlan(
      makeBuild({ levels: levelsOf("warlock", "warlock"), base: { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 15 } }),
      "warlock",
      registry
    );
    expect(plan.pactAfter).toEqual({ slots: 2, slotLevel: 2 });
    const warlockDelta = plan.spellcastingDelta.find((delta) => delta.classId === "warlock");
    expect(warlockDelta.newSpellLevels).toEqual([2]);
  });

  it("Wizard 3 / Cleric 1 → Cleric 2 uses the multiclass table at caster level 5", () => {
    const plan = getLevelUpPlan(
      makeBuild({
        levels: levelsOf("wizard", "wizard", "wizard", "cleric"),
        subclassByClass: { cleric: "life" },
        base: { str: 8, dex: 14, con: 13, int: 15, wis: 13, cha: 10 }
      }),
      "cleric",
      registry
    );
    expect(plan.slotsAfter).toEqual(MULTICLASS_SPELL_SLOTS[4]);
    expect(plan.slotsBefore).toEqual(MULTICLASS_SPELL_SLOTS[3]);
  });
});

describe("known spells, cantrips, and the wizard spellbook", () => {
  it("Bard 1 → 2 asks for exactly the known-spell delta", () => {
    const plan = getLevelUpPlan(
      makeBuild({ levels: levelsOf("bard"), base: { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 15 } }),
      "bard",
      registry
    );
    const bardDelta = plan.spellcastingDelta.find((delta) => delta.classId === "bard");
    expect(bardDelta.knownGained).toBe(1); // 4 known → 5 known
    expect(bardDelta.cantripsGained).toBe(0); // 2 → 2
    expect(bardDelta.spellbookGained).toBe(0);
  });

  it("Bard 3 → 4 asks for exactly the cantrip delta", () => {
    const plan = getLevelUpPlan(
      makeBuild({ levels: levelsOf("bard", "bard", "bard"), base: { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 15 } }),
      "bard",
      registry
    );
    const bardDelta = plan.spellcastingDelta.find((delta) => delta.classId === "bard");
    expect(bardDelta.cantripsGained).toBe(1); // 2 → 3
  });

  it("Fighter 1 → 2 offers no spell choices at all", () => {
    const plan = getLevelUpPlan(makeBuild({ levels: levelsOf("fighter") }), "fighter", registry);
    expect(plan.spellcastingDelta).toEqual([]);
  });

  it("Wizard 1 → 2 reports spellbook additions, never a prepared list or capacity", () => {
    const plan = getLevelUpPlan(
      makeBuild({ levels: levelsOf("wizard"), base: { str: 8, dex: 14, con: 13, int: 15, wis: 10, cha: 10 } }),
      "wizard",
      registry
    );
    const wizardDelta = plan.spellcastingDelta.find((delta) => delta.classId === "wizard");
    expect(wizardDelta.spellbookGained).toBe(SPELLBOOK_SPELLS_PER_LEVEL);
    expect(wizardDelta.cantripsGained).toBe(0); // 3 → 3
    expect(wizardDelta.knownGained).toBe(0); // spellbook mode never uses knownGained
    // C2-C: prepared capacity is not this plan's to report. A build alone
    // cannot answer it (overrides.abilities, spellbook candidates), so
    // getPreparedSpellCapacityChanges() owns it over character-shaped views.
    expect(wizardDelta).not.toHaveProperty("preparedCapacityBefore");
    expect(wizardDelta).not.toHaveProperty("preparedCapacityAfter");
    // No field in the plan carries a prepared-spell selection.
    expect(JSON.stringify(plan)).not.toContain("preparedIds");
    expect(JSON.stringify(plan)).not.toContain("preparedByClass");
    expect(JSON.stringify(plan)).not.toContain("preparedCapacity");
  });

  it("multiclassing into Wizard grants the initial spellbook", () => {
    const plan = getLevelUpPlan(
      makeBuild({
        levels: levelsOf("fighter", "fighter"),
        base: { str: 15, dex: 14, con: 13, int: 14, wis: 10, cha: 8 }
      }),
      "wizard",
      registry
    );
    const wizardDelta = plan.spellcastingDelta.find((delta) => delta.classId === "wizard");
    expect(wizardDelta.spellbookGained).toBe(SPELLBOOK_INITIAL_SPELLS);
    expect(wizardDelta.cantripsGained).toBe(3);
  });

  it("prepared casters report new slot levels only, never a prepared capacity", () => {
    const plan = getLevelUpPlan(
      makeBuild({
        levels: levelsOf("cleric", "cleric"),
        subclassByClass: { cleric: "life" },
        base: { str: 8, dex: 14, con: 13, int: 10, wis: 15, cha: 10 }
      }),
      "cleric",
      registry
    );
    const clericDelta = plan.spellcastingDelta.find((delta) => delta.classId === "cleric");
    expect(clericDelta.newSpellLevels).toEqual([2]); // cleric 3 unlocks 2nd level
    expect(clericDelta.knownGained).toBe(0);
    expect(clericDelta.spellbookGained).toBe(0);
    expect(clericDelta).not.toHaveProperty("preparedCapacityBefore");
    expect(clericDelta).not.toHaveProperty("preparedCapacityAfter");
  });

  it("a prepared caster whose only change would be capacity gets no delta entry", () => {
    // Cleric 5 → 6 grants no cantrip, no new spell level, and no Life Domain
    // grant. Before C2-C the build-only capacity formula manufactured a delta
    // entry here; capacity now lives in the shared prepared-spell plan.
    const plan = getLevelUpPlan(
      makeBuild({
        levels: levelsOf("cleric", "cleric", "cleric", "cleric", "cleric"),
        subclassByClass: { cleric: "life" },
        base: { str: 8, dex: 14, con: 13, int: 10, wis: 15, cha: 10 }
      }),
      "cleric",
      registry
    );
    expect(plan.toLevel).toBe(6);
    expect(plan.spellcastingDelta).toEqual([]);
  });

  it("newly reached granted subclass spells appear as granted, not choices", () => {
    const plan = getLevelUpPlan(
      makeBuild({
        levels: levelsOf("cleric", "cleric"),
        subclassByClass: { cleric: "life" },
        base: { str: 8, dex: 14, con: 13, int: 10, wis: 15, cha: 10 }
      }),
      "cleric",
      registry
    );
    const clericDelta = plan.spellcastingDelta.find((delta) => delta.classId === "cleric");
    expect(clericDelta.grantedSpellIds).toEqual(
      expect.arrayContaining(["lesser-restoration", "spiritual-weapon"])
    );
  });

  it("a half-caster reaching its start level gains its first spells", () => {
    const plan = getLevelUpPlan(
      makeBuild({ levels: levelsOf("ranger"), base: { str: 8, dex: 15, con: 13, int: 10, wis: 14, cha: 10 } }),
      "ranger",
      registry
    );
    const rangerDelta = plan.spellcastingDelta.find((delta) => delta.classId === "ranger");
    expect(rangerDelta).toBeTruthy();
    expect(rangerDelta.knownGained).toBe(2); // 0 → 2 known at ranger 2
    expect(rangerDelta.newSpellLevels).toEqual([1]);
  });

  it("reports the appended class's hit die", () => {
    expect(getLevelUpPlan(makeBuild({ levels: levelsOf("fighter") }), "fighter", registry).hitDie).toBe(10);
    expect(getLevelUpPlan(makeBuild({ levels: levelsOf("fighter") }), "wizard", registry).hitDie).toBe(6);
  });
});
