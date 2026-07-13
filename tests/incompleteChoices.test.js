// Matrix #1: the creation/edit wizard Summary lists every count-bearing
// choice the draft has not finished — guidance only, Finish stays allowed.
import { describe, expect, it } from "vitest";

import { makeDefaultCharacterBuild } from "../js/domain/characterHelpers.js";
import { getIncompleteChoiceSummaries } from "../js/pages/character/builderWizardSteps.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;

function makeBuild({
  levels = [{ classId: "fighter", hp: null }],
  subclassByClass = {},
  choicesByLevel = {},
  spellcasting = {}
} = {}) {
  const build = makeDefaultCharacterBuild();
  build.raceId = "human";
  build.backgroundId = "acolyte";
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
    const build = makeBuild({
      choicesByLevel: {
        "1": {
          "class-skill-fighter": ["athletics", "perception"],
          "feature-fighter-fighting-style": "fighter-fighting-style-defense"
        }
      }
    });
    expect(getIncompleteChoiceSummaries(build, registry)).toEqual([]);
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
