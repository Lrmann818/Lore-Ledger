// R5-B1: the domain-owned choice-completion model.
//
// This is the single traversal behind the creation Summary, the
// incomplete-required-choices banner, and the Complete Choices dialog. The
// central invariant under test is the required / under-cap split: a required
// choice has a fixed legal count, an under-cap spell category is a permitted
// maximum, and only the former may ever raise the banner.
import { describe, expect, it } from "vitest";

import { makeDefaultCharacterBuild } from "../js/domain/characterHelpers.js";
import { BUILTIN_CONTENT } from "../js/domain/rules/builtinContent.js";
import {
  BUILTIN_CONTENT_REGISTRY,
  createContentRegistry
} from "../js/domain/rules/registry.js";
import {
  CHOICE_REQUIREMENT,
  formatChoiceShortfall,
  getChoiceCompletionReport,
  hasUnresolvedRequiredChoices,
  resolveChoiceOptions
} from "../js/domain/rules/choiceCompletion.js";

const registry = BUILTIN_CONTENT_REGISTRY;

function nLevels(classId, n) {
  return Array.from({ length: n }, () => ({ classId, hp: null }));
}

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

/** @param {object} build @returns {Map<string, any>} */
function byKey(build, reg = registry) {
  return new Map(getChoiceCompletionReport(build, reg).descriptors.map((d) => [d.key, d]));
}

describe("choice completion report — required classification", () => {
  it("classifies every required category and never marks one under-cap", () => {
    const build = makeBuild({
      raceId: "dragonborn",
      levels: [...nLevels("rogue", 4)],
      subclassByClass: { rogue: "thief" }
    });
    const map = byKey(build);

    const requiredKeys = [
      "choice:dragonborn-ancestry",   // ancestry
      "choice:acolyte-language",      // background languages
      "choice:class-skill-rogue",     // first-class skills
      "subclass:rogue",               // reached subclass
      "choice:feature-rogue-expertise-1", // expertise
      "choice:asi-4"                  // reached ASI slot
    ];
    for (const key of requiredKeys) {
      expect(map.has(key), `missing descriptor ${key}`).toBe(true);
      expect(map.get(key).requirement).toBe(CHOICE_REQUIREMENT.REQUIRED);
    }

    // Negative control: the fixture really does produce required work, so a
    // report that silently returned nothing could not pass the loop above.
    // Every required key except the already-chosen subclass is unresolved.
    const report = getChoiceCompletionReport(build, registry);
    expect(report.hasUnresolvedRequired).toBe(true);
    expect(report.unresolvedRequired.map((d) => d.key).sort())
      .toEqual(requiredKeys.filter((key) => key !== "subclass:rogue").sort());
    // Rogue 4 has a subclass chosen, so that one is satisfied and excluded.
    expect(map.get("subclass:rogue").satisfied).toBe(true);
  });

  it("covers feature subfeature options and a reached-but-unchosen subclass", () => {
    const map = byKey(makeBuild({ levels: nLevels("fighter", 3) }));
    const fightingStyle = map.get("choice:feature-fighter-fighting-style");
    expect(fightingStyle.kind).toBe("feature-option");
    expect(fightingStyle.requirement).toBe(CHOICE_REQUIREMENT.REQUIRED);
    expect(fightingStyle.allowed).toBe(1);
    expect(fightingStyle.chosen).toBe(0);
    expect(fightingStyle.featureId).toBe("fighter-fighting-style");
    expect(fightingStyle.source).toEqual({ kind: "feature", id: "fighter-fighting-style" });

    const subclass = map.get("subclass:fighter");
    expect(subclass.kind).toBe("subclass");
    expect(subclass.target).toBe("subclass");
    expect(subclass.choiceId).toBeNull();
    expect(subclass.satisfied).toBe(false);

    // Negative control: below the subclass level there is no subclass row.
    expect(byKey(makeBuild({ levels: nLevels("fighter", 2) })).has("subclass:fighter")).toBe(false);
  });

  it("counts a multi-pick required choice as partially done", () => {
    const map = byKey(makeBuild({
      choicesByLevel: { "1": { "class-skill-fighter": ["athletics"] } }
    }));
    const skills = map.get("choice:class-skill-fighter");
    expect(skills.chosen).toBe(1);
    expect(skills.allowed).toBe(2);
    expect(skills.satisfied).toBe(false);

    const done = byKey(makeBuild({
      choicesByLevel: { "1": { "class-skill-fighter": ["athletics", "perception"] } }
    })).get("choice:class-skill-fighter");
    expect(done.chosen).toBe(2);
    expect(done.satisfied).toBe(true);
  });

  it("reports every ASI state structurally", () => {
    const base = { levels: nLevels("fighter", 4), subclassByClass: { fighter: "champion" } };

    const unset = byKey(makeBuild(base)).get("choice:asi-4");
    expect(unset.asiState).toBe("unset");
    expect(unset.assignedPoints).toBe(0);
    expect(unset.satisfied).toBe(false);

    const partial = byKey(makeBuild({
      ...base, choicesByLevel: { "4": { "asi-4": { type: "asi", increases: { str: 1 } } } }
    })).get("choice:asi-4");
    expect(partial.asiState).toBe("partial");
    expect(partial.assignedPoints).toBe(1);
    expect(partial.allowed).toBe(2);
    expect(partial.satisfied).toBe(false);

    const full = byKey(makeBuild({
      ...base, choicesByLevel: { "4": { "asi-4": { type: "asi", increases: { str: 2 } } } }
    })).get("choice:asi-4");
    expect(full.asiState).toBeNull();
    expect(full.satisfied).toBe(true);

    const featMissing = byKey(makeBuild({
      ...base, choicesByLevel: { "4": { "asi-4": { type: "feat" } } }
    })).get("choice:asi-4");
    expect(featMissing.asiState).toBe("feat-missing");
    expect(featMissing.satisfied).toBe(false);

    const feat = byKey(makeBuild({
      ...base, choicesByLevel: { "4": { "asi-4": { type: "feat", featId: "grappler" } } }
    })).get("choice:asi-4");
    expect(feat.asiState).toBeNull();
    expect(feat.satisfied).toBe(true);
  });
});

describe("choice completion report — languages", () => {
  it("reports race and background language choices with their real counts", () => {
    const map = byKey(makeBuild());
    const human = map.get("choice:human-language");
    const acolyte = map.get("choice:acolyte-language");

    expect(human.kind).toBe("origin-language");
    expect(human.requirement).toBe(CHOICE_REQUIREMENT.REQUIRED);
    expect(human.allowed).toBe(1);
    expect(human.source).toEqual({ kind: "race", id: "human" });
    expect(human.levelKey).toBe("1");

    expect(acolyte.kind).toBe("origin-language");
    expect(acolyte.allowed).toBe(2);
    expect(acolyte.source).toEqual({ kind: "background", id: "acolyte" });

    // Half-Elf carries its own single language choice.
    expect(byKey(makeBuild({ raceId: "half-elf" })).get("choice:half-elf-language").allowed).toBe(1);
  });

  it("satisfies a language choice only when its full count is stored", () => {
    const partial = byKey(makeBuild({
      choicesByLevel: { "1": { "acolyte-language": ["elvish"] } }
    })).get("choice:acolyte-language");
    expect(partial.chosen).toBe(1);
    expect(partial.satisfied).toBe(false);

    const full = byKey(makeBuild({
      choicesByLevel: { "1": { "acolyte-language": ["elvish", "giant"] } }
    })).get("choice:acolyte-language");
    expect(full.chosen).toBe(2);
    expect(full.satisfied).toBe(true);
  });

  it("uses the registry choice id as the stable descriptor key", () => {
    const map = byKey(makeBuild({ raceId: "half-elf" }));
    for (const [key, descriptor] of map) {
      if (descriptor.choiceId) expect(key).toBe(`choice:${descriptor.choiceId}`);
    }
    expect(map.has("choice:half-elf-language")).toBe(true);
    expect(map.has("choice:acolyte-language")).toBe(true);
  });
});

describe("choice completion report — under-cap categories", () => {
  it("classifies cantrips, known spells, and the wizard spellbook as under-cap", () => {
    const sorcerer = byKey(makeBuild({ levels: nLevels("sorcerer", 1) }));
    expect(sorcerer.get("spells:sorcerer:cantrips").requirement).toBe(CHOICE_REQUIREMENT.UNDER_CAP);
    expect(sorcerer.get("spells:sorcerer:cantrips").allowed).toBe(4);
    expect(sorcerer.get("spells:sorcerer:known").requirement).toBe(CHOICE_REQUIREMENT.UNDER_CAP);
    expect(sorcerer.get("spells:sorcerer:known").allowed).toBe(2);

    const wizard = byKey(makeBuild({ levels: nLevels("wizard", 2) }));
    const spellbook = wizard.get("spells:wizard:spellbook");
    expect(spellbook.requirement).toBe(CHOICE_REQUIREMENT.UNDER_CAP);
    expect(spellbook.allowed).toBe(8); // 6 + 2 x (2 - 1)
    expect(spellbook.target).toBe("spellSelection");
    expect(spellbook.choiceId).toBeNull();
    // A spellbook caster has no "known spells" category.
    expect(wizard.has("spells:wizard:known")).toBe(false);
  });

  it("never lets an under-cap shortfall raise the banner", () => {
    // Every required choice satisfied, spells deliberately left short.
    const build = makeBuild({
      raceId: "dragonborn",
      backgroundId: null,
      levels: nLevels("sorcerer", 1),
      subclassByClass: { sorcerer: "draconic" },
      choicesByLevel: {
        "1": {
          "dragonborn-ancestry": "red",
          "class-skill-sorcerer": ["arcana", "deception"],
          // Draconic Bloodline's own required pick, granted at sorcerer 1.
          "feature-dragon-ancestor": "dragon-ancestor-red-fire-damage"
        }
      },
      spellcasting: { sorcerer: { cantripIds: [], knownIds: [], preparedIds: [] } }
    });
    const report = getChoiceCompletionReport(build, registry);

    expect(report.unresolvedRequired).toEqual([]);
    expect(report.hasUnresolvedRequired).toBe(false);
    expect(hasUnresolvedRequiredChoices(build, registry)).toBe(false);
    // Negative control: the under-cap shortfall is genuinely present, so the
    // clean banner result above is a classification decision, not an empty report.
    expect(report.underCapShortfalls.map((d) => d.key)).toEqual([
      "spells:sorcerer:cantrips",
      "spells:sorcerer:known"
    ]);
  });

  it("excludes prepared-spell capacity entirely", () => {
    const report = getChoiceCompletionReport(
      makeBuild({ levels: nLevels("cleric", 3), subclassByClass: { cleric: "life-domain" } }),
      registry
    );
    const kinds = report.descriptors.map((d) => d.kind);
    expect(kinds).not.toContain("prepared");
    expect(report.descriptors.some((d) => /prepared/i.test(d.label))).toBe(false);
    expect(report.descriptors.some((d) => /prepared/i.test(d.key))).toBe(false);
    // Negative control: the cleric's own under-cap cantrip row is present, so
    // the traversal did run over this caster.
    expect(report.descriptors.some((d) => d.key === "spells:cleric:cantrips")).toBe(true);
  });

  it("excludes build equipment choices", () => {
    const build = makeBuild();
    build.equipment = { armorId: null, shield: false, weaponIds: [], startingChoices: {}, notes: "" };
    const report = getChoiceCompletionReport(build, registry);
    expect(report.descriptors.some((d) => /equipment/i.test(d.key + d.label))).toBe(false);
  });
});

describe("choice completion report — multiclass ownership", () => {
  it("keeps per-class category identity stable across a multiclass caster", () => {
    const build = makeBuild({
      levels: [...nLevels("wizard", 2), ...nLevels("sorcerer", 1)],
      spellcasting: {
        wizard: { cantripIds: ["fire-bolt"], knownIds: [], preparedIds: [] },
        sorcerer: { cantripIds: [], knownIds: ["shield"], preparedIds: [] }
      }
    });
    const map = byKey(build);

    expect(map.get("spells:wizard:cantrips").classId).toBe("wizard");
    expect(map.get("spells:wizard:cantrips").chosen).toBe(1);
    expect(map.get("spells:wizard:spellbook").classId).toBe("wizard");
    expect(map.get("spells:sorcerer:cantrips").classId).toBe("sorcerer");
    expect(map.get("spells:sorcerer:known").chosen).toBe(1);

    // Both classes own an independent, non-colliding subclass descriptor.
    expect(map.get("subclass:wizard").classId).toBe("wizard");
    expect(map.get("subclass:sorcerer").classId).toBe("sorcerer");

    // Only the FIRST class contributes a full skill choice. No SRD 5.1 class
    // defines multiclassing.skillChoices, so the later class contributes none.
    expect(map.get("choice:class-skill-wizard").kind).toBe("class-skill");
    expect(map.has("choice:class-skill-sorcerer")).toBe(false);
    expect(map.has("choice:multiclass-skill-sorcerer")).toBe(false);
  });

  it("reports a later class's multiclass skill choice when the class grants one", () => {
    // Reachable only through custom content today: no shipped SRD 5.1 class
    // defines multiclassing.skillChoices. Pinned so the branch the Level Up
    // wizard also relies on cannot rot.
    const customClass = {
      id: "sellsword",
      kind: "class",
      name: "Sellsword",
      source: "custom",
      data: {
        hitDie: 10,
        asiLevels: [],
        featuresByLevel: {},
        skillChoices: { choose: 2, from: ["athletics", "intimidation", "perception"] },
        multiclassing: { skillChoices: { choose: 1, from: ["athletics", "intimidation"] } }
      }
    };
    const customRegistry = createContentRegistry([...BUILTIN_CONTENT, customClass]);
    const build = makeBuild({
      raceId: null,
      backgroundId: null,
      levels: [...nLevels("fighter", 1), ...nLevels("sellsword", 1)]
    });
    const map = byKey(build, customRegistry);

    const multiclass = map.get("choice:multiclass-skill-sellsword");
    expect(multiclass).toBeTruthy();
    expect(multiclass.kind).toBe("multiclass-skill");
    expect(multiclass.requirement).toBe(CHOICE_REQUIREMENT.REQUIRED);
    expect(multiclass.allowed).toBe(1);
    expect(multiclass.classId).toBe("sellsword");
    expect(multiclass.levelKey).toBe("1");
    // Negative control: taken as the FIRST class the same record yields the
    // full class-skill choice instead, so the branch is order-driven.
    const firstClassMap = byKey(
      makeBuild({ raceId: null, backgroundId: null, levels: nLevels("sellsword", 1) }),
      customRegistry
    );
    expect(firstClassMap.get("choice:class-skill-sellsword").allowed).toBe(2);
    expect(firstClassMap.has("choice:multiclass-skill-sellsword")).toBe(false);
  });
});

describe("choice completion report — ordering", () => {
  it("emits descriptors in the canonical order", () => {
    const build = makeBuild({
      raceId: "dragonborn",
      levels: [...nLevels("wizard", 4)],
      subclassByClass: {}
    });
    const keys = getChoiceCompletionReport(build, registry).descriptors.map((d) => d.key);
    expect(keys).toEqual([
      // origin: race choices, then background choices
      "choice:dragonborn-ancestry",
      "choice:acolyte-language",
      // class skills
      "choice:class-skill-wizard",
      // reached subclass
      "subclass:wizard",
      // ASI slots
      "choice:asi-4",
      // under-cap spell categories last
      "spells:wizard:cantrips",
      "spells:wizard:spellbook"
    ]);
  });
});

describe("choice completion report — defensive behavior", () => {
  it("returns an empty report for non-builds and never throws", () => {
    for (const value of [null, undefined, 42, "build", [], true]) {
      expect(() => getChoiceCompletionReport(value, registry)).not.toThrow();
      const report = getChoiceCompletionReport(value, registry);
      expect(report.descriptors).toEqual([]);
      expect(report.hasUnresolvedRequired).toBe(false);
    }
    expect(getChoiceCompletionReport(makeDefaultCharacterBuild(), registry).descriptors).toEqual([]);
  });

  it("treats malformed stored selections as nothing chosen", () => {
    const build = makeBuild({
      levels: nLevels("fighter", 4),
      subclassByClass: { fighter: "champion" },
      choicesByLevel: { "4": { "asi-4": "garbage" } }
    });
    expect(() => getChoiceCompletionReport(build, registry)).not.toThrow();
    expect(byKey(build).get("choice:asi-4").asiState).toBe("unset");

    const brokenChoices = makeBuild();
    brokenChoices.choicesByLevel = "nope";
    expect(byKey(brokenChoices).get("choice:class-skill-fighter").chosen).toBe(0);

    const brokenSpells = makeBuild({ levels: nLevels("sorcerer", 1) });
    brokenSpells.spellcasting = { sorcerer: "nope" };
    expect(byKey(brokenSpells).get("spells:sorcerer:cantrips").chosen).toBe(0);
  });

  it("degrades soft when referenced content is missing and raises no false banner", () => {
    const missingClass = makeBuild({ raceId: null, backgroundId: null, levels: nLevels("ghost-class", 3) });
    const classReport = getChoiceCompletionReport(missingClass, registry);
    expect(classReport.descriptors).toEqual([]);
    expect(classReport.hasUnresolvedRequired).toBe(false);
    expect(classReport.warnings.join(" ")).toContain("ghost-class");

    const missingRace = makeBuild({ raceId: "ghost-race", backgroundId: null, levels: [] });
    const raceReport = getChoiceCompletionReport(missingRace, registry);
    expect(raceReport.descriptors).toEqual([]);
    expect(raceReport.hasUnresolvedRequired).toBe(false);
    expect(raceReport.warnings.join(" ")).toContain("ghost-race");

    // Negative control: with the real ids the same shapes DO produce required
    // descriptors, so "no descriptors" above is caused by the missing content.
    expect(hasUnresolvedRequiredChoices(
      makeBuild({ raceId: "human", backgroundId: null, levels: nLevels("fighter", 3) }),
      registry
    )).toBe(true);
  });

  it("omits a custom caster's category when its class table is absent", () => {
    const customClass = {
      id: "chronomancer",
      kind: "class",
      name: "Chronomancer",
      source: "custom",
      data: {
        hitDie: 6,
        asiLevels: [4],
        featuresByLevel: {},
        // A caster with no cantrip/known tables at all.
        spellcasting: { ability: "int", preparationMode: "known", progression: "full", startLevel: 1 }
      }
    };
    const customRegistry = createContentRegistry([...BUILTIN_CONTENT, customClass]);
    const build = makeBuild({ raceId: null, backgroundId: null, levels: nLevels("chronomancer", 2) });
    const report = getChoiceCompletionReport(build, customRegistry);

    expect(report.warnings).toEqual([]);
    expect(report.descriptors.some((d) => d.key.startsWith("spells:chronomancer"))).toBe(false);
    expect(report.hasUnresolvedRequired).toBe(false);

    // Negative control: adding the cantrip table makes the category appear, so
    // the omission above is table-driven and not a blanket custom-class skip.
    const withTable = createContentRegistry([...BUILTIN_CONTENT, {
      ...customClass,
      data: {
        ...customClass.data,
        spellcasting: { ...customClass.data.spellcasting, cantripsKnownByLevel: [2, 2] }
      }
    }]);
    const tableMap = byKey(build, withTable);
    expect(tableMap.get("spells:chronomancer:cantrips").allowed).toBe(2);
    expect(tableMap.get("spells:chronomancer:cantrips").requirement).toBe(CHOICE_REQUIREMENT.UNDER_CAP);
  });
});

describe("resolveChoiceOptions", () => {
  it("resolves each picker kind through the canonical registry helpers", () => {
    const map = byKey(makeBuild({
      raceId: "dragonborn",
      levels: [...nLevels("rogue", 4)],
      subclassByClass: { rogue: "thief" }
    }));

    const ancestry = resolveChoiceOptions(map.get("choice:dragonborn-ancestry"), registry);
    expect(ancestry.length).toBeGreaterThan(0);
    expect(ancestry.some((option) => option.id === "red")).toBe(true);

    const languages = resolveChoiceOptions(map.get("choice:acolyte-language"), registry);
    expect(languages.length).toBeGreaterThan(0);
    expect(languages.every((option) => option.id && option.name)).toBe(true);

    const skills = resolveChoiceOptions(map.get("choice:class-skill-rogue"), registry);
    expect(skills.some((option) => option.id === "stealth")).toBe(true);

    // Expertise offers every skill, not just the class list.
    const expertise = resolveChoiceOptions(map.get("choice:feature-rogue-expertise-1"), registry);
    expect(expertise.length).toBeGreaterThan(skills.length);

    // ASI builds its own ability/feat lists inside renderAsiSlot.
    expect(resolveChoiceOptions(map.get("choice:asi-4"), registry)).toEqual([]);
  });

  it("resolves subclass and filtered-spell pickers", () => {
    const subclassOptions = resolveChoiceOptions(
      byKey(makeBuild({ levels: nLevels("fighter", 3) })).get("subclass:fighter"),
      registry
    );
    expect(subclassOptions.length).toBeGreaterThan(0);
    expect(subclassOptions.some((option) => option.id === "champion")).toBe(true);
    // Negative control: another class's subclasses are not offered.
    expect(subclassOptions.some((option) => option.id === "thief")).toBe(false);

    const cantrip = resolveChoiceOptions(
      byKey(makeBuild({ raceId: "elf", subraceId: "high-elf" })).get("choice:high-elf-cantrip"),
      registry
    );
    expect(cantrip.length).toBeGreaterThan(0);
    expect(cantrip.some((option) => option.id === "fire-bolt")).toBe(true);
    // The High Elf choice is filtered to wizard cantrips: no leveled spells.
    expect(cantrip.some((option) => option.id === "shield")).toBe(false);
  });

  it("returns an empty list for descriptors without a picker", () => {
    const spellbook = byKey(makeBuild({ levels: nLevels("wizard", 2) })).get("spells:wizard:spellbook");
    expect(spellbook.picker).toBeNull();
    expect(resolveChoiceOptions(spellbook, registry)).toEqual([]);
    expect(resolveChoiceOptions(null, registry)).toEqual([]);
    expect(resolveChoiceOptions(undefined, registry)).toEqual([]);
  });
});

describe("formatChoiceShortfall", () => {
  it("produces the shipped wording for every kind", () => {
    const map = byKey(makeBuild({
      raceId: "dragonborn",
      levels: nLevels("rogue", 4),
      choicesByLevel: {
        "1": { "feature-rogue-expertise-1": ["stealth"] },
        "4": { "asi-4": { type: "asi", increases: { dex: 1 } } }
      }
    }));

    expect(formatChoiceShortfall(map.get("choice:dragonborn-ancestry")))
      .toBe("Draconic Ancestry: not chosen");
    expect(formatChoiceShortfall(map.get("choice:acolyte-language")))
      .toBe("Acolyte languages: 0 of 2 chosen");
    expect(formatChoiceShortfall(map.get("choice:class-skill-rogue")))
      .toBe("Rogue skills: 0 of 4 chosen");
    expect(formatChoiceShortfall(map.get("subclass:rogue")))
      .toBe("Rogue: subclass not chosen");
    expect(formatChoiceShortfall(map.get("choice:feature-rogue-expertise-1")))
      .toBe("Expertise (Level 1): 1 of 2 skills chosen");
    expect(formatChoiceShortfall(map.get("choice:asi-4")))
      .toBe("Level 4 Ability Score Improvement: 1 of 2 points assigned");
    expect(formatChoiceShortfall(
      byKey(makeBuild({ levels: nLevels("wizard", 2) })).get("spells:wizard:spellbook")
    )).toBe("Wizard spellbook: 0 of 8 spells chosen");
    expect(formatChoiceShortfall(null)).toBe("");
  });
});
