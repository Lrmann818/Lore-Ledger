// Matrix #1: the creation/edit wizard Summary lists every count-bearing
// choice the draft has not finished — guidance only, Finish stays allowed.
//
// R5-B1 moved the traversal into js/domain/rules/choiceCompletion.js and made
// this function a thin formatter over it. The suite therefore doubles as the
// refactor pin: every pre-existing non-language row must stay byte-identical
// and in unchanged relative order. Language choices are the ONE intentional
// output change (they are required and were previously reported nowhere).
import { describe, expect, it } from "vitest";

import { makeDefaultCharacterBuild } from "../js/domain/characterHelpers.js";
import { getIncompleteChoiceSummaries } from "../js/pages/character/builderWizardSteps.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;

/** Every language row the shipped SRD 5.1 data can produce. */
const LANGUAGE_ROW = /^(Human|Half-Elf|Acolyte) languages?: \d+ of \d+ chosen$/;

function makeBuild({
  raceId = "human",
  subraceId = null,
  backgroundId = "acolyte",
  levels = [{ classId: "fighter", hp: null }],
  subclassByClass = {},
  choicesByLevel = {},
  spellcasting = {}
} = {}) {
  const build = makeDefaultCharacterBuild();
  build.raceId = raceId;
  build.subraceId = subraceId;
  build.backgroundId = backgroundId;
  build.levels = levels;
  build.subclassByClass = subclassByClass;
  build.choicesByLevel = choicesByLevel;
  build.spellcasting = spellcasting;
  return build;
}

function nLevels(classId, n) {
  return Array.from({ length: n }, () => ({ classId, hp: null }));
}

describe("incomplete choice summaries", () => {
  it("flags unpicked class skills and fighting style for a fresh fighter", () => {
    const summaries = getIncompleteChoiceSummaries(makeBuild(), registry);
    expect(summaries.join(" | ")).toContain("Fighter skills: 0 of 2 chosen");
    expect(summaries.join(" | ")).toContain("Fighting Style: 0 of 1 chosen");
  });

  it("clears entries as choices are completed", () => {
    // Intentional R5-B1 fixture update: this Human/Acolyte build also owes
    // three language picks, which are now required and reported. Completing
    // them alongside the skills and fighting style clears the list entirely.
    const build = makeBuild({
      choicesByLevel: {
        "1": {
          "class-skill-fighter": ["athletics", "perception"],
          "feature-fighter-fighting-style": "fighter-fighting-style-defense",
          "human-language": "dwarvish",
          "acolyte-language": ["elvish", "giant"]
        }
      }
    });
    expect(getIncompleteChoiceSummaries(build, registry)).toEqual([]);
  });

  it("reports fixed-count language choices as required work", () => {
    const summaries = getIncompleteChoiceSummaries(makeBuild(), registry);
    expect(summaries).toContain("Human language: 0 of 1 chosen");
    expect(summaries).toContain("Acolyte languages: 0 of 2 chosen");

    // Partial progress is counted, not treated as done.
    const partial = getIncompleteChoiceSummaries(
      makeBuild({ choicesByLevel: { "1": { "acolyte-language": ["elvish"] } } }),
      registry
    );
    expect(partial).toContain("Acolyte languages: 1 of 2 chosen");

    // Negative control: a race and background with no language choice produce
    // no language row at all, so the rows above cannot be unconditional.
    const noLanguages = getIncompleteChoiceSummaries(
      makeBuild({ raceId: "dragonborn", backgroundId: null }),
      registry
    );
    expect(noLanguages.some((row) => LANGUAGE_ROW.test(row))).toBe(false);
    expect(noLanguages).toContain("Draconic Ancestry: not chosen");
  });

  it("flags a reached but unchosen subclass", () => {
    const summaries = getIncompleteChoiceSummaries(
      makeBuild({ levels: nLevels("fighter", 3) }),
      registry
    );
    expect(summaries.join(" | ")).toContain("Fighter: subclass not chosen");
    const chosen = getIncompleteChoiceSummaries(
      makeBuild({ levels: nLevels("fighter", 3), subclassByClass: { fighter: "champion" } }),
      registry
    );
    expect(chosen.join(" | ")).not.toContain("subclass");
  });

  it("flags missing and partially assigned ASI slots", () => {
    const missing = getIncompleteChoiceSummaries(
      makeBuild({ levels: nLevels("fighter", 4), subclassByClass: { fighter: "champion" } }),
      registry
    );
    expect(missing.join(" | ")).toContain("Level 4 Ability Score Improvement: not chosen");

    const partial = getIncompleteChoiceSummaries(
      makeBuild({
        levels: nLevels("fighter", 4),
        subclassByClass: { fighter: "champion" },
        choicesByLevel: { "4": { "asi-4": { type: "asi", increases: { str: 1 } } } }
      }),
      registry
    );
    expect(partial.join(" | ")).toContain("Level 4 Ability Score Improvement: 1 of 2 points assigned");

    const feat = getIncompleteChoiceSummaries(
      makeBuild({
        levels: nLevels("fighter", 4),
        subclassByClass: { fighter: "champion" },
        choicesByLevel: { "4": { "asi-4": { type: "feat", featId: "grappler" } } }
      }),
      registry
    );
    expect(feat.join(" | ")).not.toContain("Ability Score Improvement");
  });

  it("flags expertise shortfalls", () => {
    const summaries = getIncompleteChoiceSummaries(
      makeBuild({
        levels: nLevels("rogue", 1),
        choicesByLevel: { "1": { "feature-rogue-expertise-1": ["stealth"] } }
      }),
      registry
    );
    expect(summaries.join(" | ")).toContain("Expertise (Level 1): 1 of 2 skills chosen");
  });

  it("flags cantrip, known-spell, and spellbook shortfalls against derived caps", () => {
    const sorcerer = getIncompleteChoiceSummaries(
      makeBuild({
        levels: nLevels("sorcerer", 1),
        spellcasting: { sorcerer: { cantripIds: ["fire-bolt"], knownIds: ["shield"], preparedIds: [] } }
      }),
      registry
    );
    // Sorcerer 1: 4 cantrips, 2 known.
    expect(sorcerer.join(" | ")).toContain("Sorcerer cantrips: 1 of 4 chosen");
    expect(sorcerer.join(" | ")).toContain("Sorcerer known spells: 1 of 2 chosen");

    const wizard = getIncompleteChoiceSummaries(
      makeBuild({
        levels: nLevels("wizard", 2),
        spellcasting: { wizard: { cantripIds: ["fire-bolt", "light", "mage-hand"], knownIds: ["shield"], preparedIds: [] } }
      }),
      registry
    );
    // Wizard 2 spellbook target: 6 + 2 = 8.
    expect(wizard.join(" | ")).toContain("Wizard spellbook: 1 of 8 spells chosen");
    expect(wizard.join(" | ")).not.toContain("Wizard cantrips");
  });

  // R5-B1 refactor pin. PARENT_SUMMARIES was captured by running the pre-R5-B1
  // implementation (HEAD 643df64) against these exact fixtures. Filtering the
  // language rows out of today's output must reproduce it byte-for-byte,
  // including row order — so the traversal move cannot have altered any
  // pre-existing wording, count, or position.
  describe("summary compatibility with the pre-R5-B1 traversal", () => {
    const nl = (classId, n) => nLevels(classId, n);
    /** @type {Array<[string, object, string[]]>} */
    const PARENT_SUMMARIES = [
      ["fighter 1, nothing chosen", {}, [
        "Fighter skills: 0 of 2 chosen",
        "Fighting Style: 0 of 1 chosen"
      ]],
      ["fighter 3, subclass reached", { levels: nl("fighter", 3) }, [
        "Fighter skills: 0 of 2 chosen",
        "Fighter: subclass not chosen",
        "Fighting Style: 0 of 1 chosen"
      ]],
      ["fighter 4, ASI unset", {
        levels: nl("fighter", 4), subclassByClass: { fighter: "champion" }
      }, [
        "Fighter skills: 0 of 2 chosen",
        "Fighting Style: 0 of 1 chosen",
        "Level 4 Ability Score Improvement: not chosen"
      ]],
      ["fighter 4, ASI partial", {
        levels: nl("fighter", 4),
        subclassByClass: { fighter: "champion" },
        choicesByLevel: { "4": { "asi-4": { type: "asi", increases: { str: 1 } } } }
      }, [
        "Fighter skills: 0 of 2 chosen",
        "Fighting Style: 0 of 1 chosen",
        "Level 4 Ability Score Improvement: 1 of 2 points assigned"
      ]],
      ["fighter 4, feat chosen without a feat id", {
        levels: nl("fighter", 4),
        subclassByClass: { fighter: "champion" },
        choicesByLevel: { "4": { "asi-4": { type: "feat" } } }
      }, [
        "Fighter skills: 0 of 2 chosen",
        "Fighting Style: 0 of 1 chosen",
        "Level 4 feat: not chosen"
      ]],
      ["rogue 1, one expertise skill", {
        levels: nl("rogue", 1),
        choicesByLevel: { "1": { "feature-rogue-expertise-1": ["stealth"] } }
      }, [
        "Rogue skills: 0 of 4 chosen",
        "Expertise (Level 1): 1 of 2 skills chosen"
      ]],
      ["sorcerer 1, partial spells", {
        levels: nl("sorcerer", 1),
        spellcasting: { sorcerer: { cantripIds: ["fire-bolt"], knownIds: ["shield"], preparedIds: [] } }
      }, [
        "Sorcerer skills: 0 of 2 chosen",
        "Sorcerer: subclass not chosen",
        "Sorcerer cantrips: 1 of 4 chosen",
        "Sorcerer known spells: 1 of 2 chosen"
      ]],
      ["wizard 2, partial spellbook", {
        levels: nl("wizard", 2),
        spellcasting: {
          wizard: { cantripIds: ["fire-bolt", "light", "mage-hand"], knownIds: ["shield"], preparedIds: [] }
        }
      }, [
        "Wizard skills: 0 of 2 chosen",
        "Wizard: subclass not chosen",
        "Wizard spellbook: 1 of 8 spells chosen"
      ]],
      ["cleric 3, prepared caster", {
        levels: nl("cleric", 3), subclassByClass: { cleric: "life-domain" }
      }, [
        "Cleric skills: 0 of 2 chosen",
        "Cleric cantrips: 0 of 3 chosen"
      ]],
      ["dragonborn fighter, no background", { raceId: "dragonborn", backgroundId: null }, [
        "Draconic Ancestry: not chosen",
        "Fighter skills: 0 of 2 chosen",
        "Fighting Style: 0 of 1 chosen"
      ]],
      ["high elf wizard 1, no background", {
        raceId: "elf", subraceId: "high-elf", backgroundId: null, levels: nl("wizard", 1)
      }, [
        "High Elf cantrip: not chosen",
        "Wizard skills: 0 of 2 chosen",
        "Wizard cantrips: 0 of 3 chosen",
        "Wizard spellbook: 0 of 6 spells chosen"
      ]],
      ["multiclass wizard 2 / sorcerer 1", {
        levels: [...nl("wizard", 2), { classId: "sorcerer", hp: null }]
      }, [
        "Wizard skills: 0 of 2 chosen",
        "Wizard: subclass not chosen",
        "Sorcerer: subclass not chosen",
        "Wizard cantrips: 0 of 3 chosen",
        "Wizard spellbook: 0 of 8 spells chosen",
        "Sorcerer cantrips: 0 of 4 chosen",
        "Sorcerer known spells: 0 of 2 chosen"
      ]],
      ["malformed ASI value", {
        levels: nl("fighter", 4),
        subclassByClass: { fighter: "champion" },
        choicesByLevel: { "4": { "asi-4": "garbage" } }
      }, [
        "Fighter skills: 0 of 2 chosen",
        "Fighting Style: 0 of 1 chosen",
        "Level 4 Ability Score Improvement: not chosen"
      ]],
      ["unknown class id", { levels: nl("not-a-real-class", 3) }, []]
    ];

    for (const [name, overrides, parentRows] of PARENT_SUMMARIES) {
      it(`preserves pre-R5-B1 rows and order: ${name}`, () => {
        const rows = getIncompleteChoiceSummaries(makeBuild(overrides), registry);
        expect(rows.filter((row) => !LANGUAGE_ROW.test(row))).toEqual(parentRows);
      });
    }

    it("adds language rows as the only new output", () => {
      // Negative control for the pin above: the filter is doing real work —
      // these fixtures genuinely gained rows, so an accidentally empty
      // LANGUAGE_ROW match would fail the equality assertions instead of
      // passing vacuously.
      const humanAcolyte = getIncompleteChoiceSummaries(makeBuild(), registry);
      expect(humanAcolyte.filter((row) => LANGUAGE_ROW.test(row))).toEqual([
        "Human language: 0 of 1 chosen",
        "Acolyte languages: 0 of 2 chosen"
      ]);
      const dragonborn = getIncompleteChoiceSummaries(
        makeBuild({ raceId: "dragonborn", backgroundId: null }),
        registry
      );
      expect(dragonborn.filter((row) => LANGUAGE_ROW.test(row))).toEqual([]);
    });
  });

  it("returns nothing for empty builds and never throws on malformed data", () => {
    expect(getIncompleteChoiceSummaries(makeDefaultCharacterBuild(), registry)).toEqual([]);
    const malformed = makeBuild({
      choicesByLevel: { "4": { "asi-4": "garbage" } },
      levels: nLevels("fighter", 4),
      subclassByClass: { fighter: "champion" }
    });
    expect(() => getIncompleteChoiceSummaries(malformed, registry)).not.toThrow();
    expect(getIncompleteChoiceSummaries(malformed, registry).join(" | "))
      .toContain("Level 4 Ability Score Improvement: not chosen");
  });
});
