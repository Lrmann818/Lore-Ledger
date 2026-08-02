// R5-B2: the shared under-cap descriptors and the persisted acknowledgement
// model.
//
// Two things are pinned here. First, that the permitted under-cap categories
// (class cantrips, known spells, wizard spellbook) are reported through the one
// choice-completion traversal, with the counts and allowances every consumer
// caps against — so a picker cap and a Summary shortfall can never disagree.
// Second, that `underCapAckLevels` normalization is defensive: malformed,
// duplicate, non-integer, negative, and out-of-range values fail soft, and a
// record is only ever appended, never inferred.
import { describe, expect, it } from "vitest";

import { makeDefaultCharacterBuild } from "../js/domain/characterHelpers.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";
import {
  appendUnderCapAckLevel,
  CHOICE_REQUIREMENT,
  formatChoiceShortfall,
  getChoiceCompletionReport,
  getResultingCharacterLevel,
  getUnderCapChoiceDescriptors,
  hasUnderCapAckLevel,
  hasUnresolvedRequiredChoices,
  normalizeUnderCapAckLevels,
  UNDER_CAP_KIND
} from "../js/domain/rules/choiceCompletion.js";

const registry = BUILTIN_CONTENT_REGISTRY;

function nLevels(classId, n) {
  return Array.from({ length: n }, () => ({ classId, hp: null }));
}

function makeBuild({
  raceId = "human",
  backgroundId = "acolyte",
  levels = [{ classId: "wizard", hp: null }],
  subclassByClass = {},
  spellcasting = {}
} = {}) {
  const build = makeDefaultCharacterBuild();
  build.raceId = raceId;
  build.backgroundId = backgroundId;
  build.levels = levels;
  build.subclassByClass = subclassByClass;
  build.spellcasting = spellcasting;
  return build;
}

/** @param {object} build @param {string} classId @param {string} kind */
function descriptorFor(build, classId, kind) {
  return getUnderCapChoiceDescriptors(build, registry)
    .find((entry) => entry.classId === classId && entry.kind === kind) || null;
}

/* ------------------------------------------------------------------ */
/* Descriptors and counts                                              */
/* ------------------------------------------------------------------ */

describe("under-cap descriptors", () => {
  it("reports cantrips and the spellbook for a wizard with their real allowances", () => {
    const build = makeBuild({ levels: nLevels("wizard", 3) });
    const descriptors = getUnderCapChoiceDescriptors(build, registry);

    // Positive control: the accessor really produced the two wizard rows.
    expect(descriptors.map((entry) => entry.key)).toEqual([
      "spells:wizard:cantrips",
      "spells:wizard:spellbook"
    ]);
    for (const entry of descriptors) {
      expect(entry.requirement).toBe(CHOICE_REQUIREMENT.UNDER_CAP);
    }
    expect(descriptorFor(build, "wizard", UNDER_CAP_KIND.CANTRIPS).allowed).toBe(3);
    // 6 to start, +2 per wizard level after the first.
    expect(descriptorFor(build, "wizard", UNDER_CAP_KIND.SPELLBOOK).allowed).toBe(10);
  });

  it("reports a known-spell caster's known allowance and no spellbook row", () => {
    const build = makeBuild({ levels: nLevels("bard", 3) });
    expect(descriptorFor(build, "bard", UNDER_CAP_KIND.KNOWN_SPELLS).allowed).toBe(6);
    expect(descriptorFor(build, "bard", UNDER_CAP_KIND.SPELLBOOK)).toBeNull();
  });

  it("counts stored selections and marks a full category satisfied", () => {
    const short = makeBuild({
      levels: nLevels("wizard", 1),
      spellcasting: { wizard: { cantripIds: ["fire-bolt"], knownIds: [], preparedIds: [] } }
    });
    const shortCantrips = descriptorFor(short, "wizard", UNDER_CAP_KIND.CANTRIPS);
    expect(shortCantrips.chosen).toBe(1);
    expect(shortCantrips.allowed).toBe(3);
    expect(shortCantrips.satisfied).toBe(false);
    expect(formatChoiceShortfall(shortCantrips)).toBe("Wizard cantrips: 1 of 3 chosen");

    const full = makeBuild({
      levels: nLevels("wizard", 1),
      spellcasting: {
        wizard: { cantripIds: ["fire-bolt", "light", "mage-hand"], knownIds: [], preparedIds: [] }
      }
    });
    const fullCantrips = descriptorFor(full, "wizard", UNDER_CAP_KIND.CANTRIPS);
    expect(fullCantrips.chosen).toBe(3);
    expect(fullCantrips.satisfied).toBe(true);
    expect(getChoiceCompletionReport(full, registry).underCapShortfalls.map((d) => d.key))
      .toEqual(["spells:wizard:spellbook"]);
  });

  it("never lets an under-cap shortfall raise the required-choice banner", () => {
    // A wizard with every required choice made but nothing chosen in either
    // under-cap category. Positive control: the shortfalls really exist.
    const build = makeBuild({
      raceId: "elf",
      levels: nLevels("wizard", 1),
      spellcasting: { wizard: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });
    build.choicesByLevel = {
      1: {
        "class-skill-wizard": ["arcana", "history"],
        "acolyte-language": ["dwarvish", "elvish"]
      }
    };
    expect(getChoiceCompletionReport(build, registry).underCapShortfalls).toHaveLength(2);
    expect(hasUnresolvedRequiredChoices(build, registry)).toBe(false);
  });

  it("excludes prepared spells from the under-cap categories entirely", () => {
    const build = makeBuild({
      levels: nLevels("cleric", 5),
      subclassByClass: { cleric: "life" },
      spellcasting: { cleric: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });
    const kinds = getUnderCapChoiceDescriptors(build, registry).map((entry) => entry.kind);
    expect(kinds).toEqual([UNDER_CAP_KIND.CANTRIPS]);
    expect(kinds).not.toContain("prepared");
  });

  it("produces nothing for a non-caster or a malformed build", () => {
    expect(getUnderCapChoiceDescriptors(makeBuild({ levels: nLevels("fighter", 5) }), registry))
      .toEqual([]);
    expect(getUnderCapChoiceDescriptors(null, registry)).toEqual([]);
    expect(getUnderCapChoiceDescriptors({ levels: "nope" }, registry)).toEqual([]);
  });
});

describe("resulting character level", () => {
  it("counts the build's level rows", () => {
    expect(getResultingCharacterLevel(makeBuild({ levels: nLevels("wizard", 4) }))).toBe(4);
    expect(getResultingCharacterLevel(makeBuild({
      levels: [...nLevels("wizard", 2), ...nLevels("cleric", 3)]
    }))).toBe(5);
  });

  it("fails soft to 0 for a malformed or class-less build", () => {
    expect(getResultingCharacterLevel(null)).toBe(0);
    expect(getResultingCharacterLevel({})).toBe(0);
    expect(getResultingCharacterLevel({ levels: [{ classId: "" }] })).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Persisted acknowledgement record                                    */
/* ------------------------------------------------------------------ */

describe("underCapAckLevels normalization", () => {
  it("keeps valid integer levels, deduplicated and ascending", () => {
    expect(normalizeUnderCapAckLevels([5, 3, 5, 1, 20])).toEqual([1, 3, 5, 20]);
  });

  it("drops every malformed value while keeping the valid ones", () => {
    // Positive control: 4 and 7 survive, so the drops below are real filtering
    // rather than a normalizer that returns nothing.
    expect(normalizeUnderCapAckLevels([
      4, 0, -1, 21, 3.5, NaN, Infinity, "3", null, undefined, {}, [], true, 7
    ])).toEqual([4, 7]);
  });

  it("treats a non-array container as nothing acknowledged", () => {
    for (const value of [null, undefined, 3, "3", {}, { 0: 3 }, new Set([3])]) {
      expect(normalizeUnderCapAckLevels(value)).toEqual([]);
    }
  });

  it("answers membership only for genuine integer levels", () => {
    expect(hasUnderCapAckLevel([3, 4], 3)).toBe(true);
    expect(hasUnderCapAckLevel([3, 4], 5)).toBe(false);
    expect(hasUnderCapAckLevel([3, 4], "3")).toBe(false);
    expect(hasUnderCapAckLevel([3, 4], 3.0)).toBe(true);
    expect(hasUnderCapAckLevel([3, 4], 3.5)).toBe(false);
    expect(hasUnderCapAckLevel("nope", 3)).toBe(false);
  });

  it("appends idempotently and never stores an invalid level", () => {
    expect(appendUnderCapAckLevel([3], 4)).toEqual([3, 4]);
    expect(appendUnderCapAckLevel([3, 4], 4)).toEqual([3, 4]);
    expect(appendUnderCapAckLevel(undefined, 2)).toEqual([2]);
    // Invalid levels are ignored; the existing record is still normalized so a
    // caller can write the result back safely.
    expect(appendUnderCapAckLevel([3, 3, 99, "4"], null)).toEqual([3]);
    expect(appendUnderCapAckLevel([3], 0)).toEqual([3]);
    expect(appendUnderCapAckLevel([3], 21)).toEqual([3]);
    expect(appendUnderCapAckLevel([3], 2.5)).toEqual([3]);
  });

  it("never infers acknowledgement from the existence of a shortfall", () => {
    const build = makeBuild({ levels: nLevels("wizard", 2) });
    expect(getChoiceCompletionReport(build, registry).underCapShortfalls.length)
      .toBeGreaterThan(0);
    // Nothing in the domain model turns a shortfall into a recorded level.
    expect(normalizeUnderCapAckLevels(undefined)).toEqual([]);
    expect(hasUnderCapAckLevel(undefined, getResultingCharacterLevel(build))).toBe(false);
  });
});
