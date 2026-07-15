import { describe, expect, it } from "vitest";

import {
  collectChoiceGrantedSpells,
  getSpellListChoices,
  resolveSpellChoiceOptions
} from "../js/domain/rules/spellChoices.js";
import {
  collectActiveChoiceIds,
  getIncompleteChoiceSummaries,
  getRequiredOriginChoices,
  hasOriginChoices,
  pruneStaleChoices,
  writeChoice
} from "../js/pages/character/builderWizardSteps.js";
import { getBuilderFinishSheetSeedPatch } from "../js/domain/builderSheetSeeding.js";
import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import { BUILTIN_CONTENT_REGISTRY, getContentByKind } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;

function highElfWizard({ cantripChoice, level = 1, classId = "wizard" } = {}) {
  const character = makeDefaultBuilderCharacterEntry("Aelar");
  character.build.raceId = "elf";
  character.build.subraceId = "high-elf";
  character.build.levels = Array.from({ length: level }, () => ({ classId, hp: null }));
  character.build.abilities.base = { str: 10, dex: 14, con: 12, int: 15, wis: 10, cha: 8 };
  if (cantripChoice !== undefined) {
    character.build.choicesByLevel = { 1: { "high-elf-cantrip": cantripChoice } };
  }
  return character;
}

const subraceEntry = () => getContentByKind(registry, "subrace", "high-elf");
const raceEntry = () => getContentByKind(registry, "race", "elf");

describe("resolveSpellChoiceOptions", () => {
  it("returns only wizard cantrips for the High Elf filter", () => {
    const choice = subraceEntry().data.choices.find((c) => c.id === "high-elf-cantrip");
    const options = resolveSpellChoiceOptions(registry, choice.from);
    expect(options.length).toBeGreaterThan(0);
    for (const spell of options) {
      expect(spell.data.level).toBe(0);
      expect(spell.data.classIds).toContain("wizard");
    }
    // A leveled wizard spell and a non-wizard cantrip are both excluded.
    const ids = options.map((entry) => entry.id);
    expect(ids).toContain("fire-bolt");
    expect(ids).not.toContain("magic-missile"); // level 1
    expect(ids).not.toContain("sacred-flame"); // cleric cantrip, not wizard
  });
});

describe("getSpellListChoices", () => {
  it("finds the cantrip choice on the High Elf subrace and none on plain Elf", () => {
    expect(getSpellListChoices([subraceEntry()]).map((c) => c.choice.id)).toEqual(["high-elf-cantrip"]);
    expect(getSpellListChoices([raceEntry()])).toEqual([]);
  });
});

describe("origin-choice gating", () => {
  it("plain Elf (no subrace) has no required origin choice", () => {
    const elf = highElfWizard();
    elf.build.subraceId = null;
    expect(hasOriginChoices(elf.build, registry)).toBe(false);
    expect(getRequiredOriginChoices(elf.build, registry)).toEqual([]);
  });

  it("High Elf creates exactly one required, unfilled cantrip choice", () => {
    const required = getRequiredOriginChoices(highElfWizard().build, registry);
    expect(required).toHaveLength(1);
    expect(required[0]).toMatchObject({ choiceId: "high-elf-cantrip", filled: false });
    expect(hasOriginChoices(highElfWizard().build, registry)).toBe(true);
  });

  it("marks the choice filled once a cantrip is chosen", () => {
    const required = getRequiredOriginChoices(highElfWizard({ cantripChoice: "fire-bolt" }).build, registry);
    expect(required[0].filled).toBe(true);
  });

  it("keeps the subrace cantrip through choice pruning (does not treat it as stale)", () => {
    const build = highElfWizard().build;
    writeChoice(build, "1", "high-elf-cantrip", "fire-bolt");
    const active = collectActiveChoiceIds(build, registry);
    expect(active.has("high-elf-cantrip")).toBe(true);
    pruneStaleChoices(build, active);
    expect(build.choicesByLevel["1"]["high-elf-cantrip"]).toBe("fire-bolt");
  });

  it("lists the unfilled cantrip in the incomplete-choice summary", () => {
    const summaries = getIncompleteChoiceSummaries(highElfWizard().build, registry);
    expect(summaries.some((line) => /cantrip: not chosen/i.test(line))).toBe(true);
  });
});

describe("collectChoiceGrantedSpells + derivation", () => {
  it("resolves the chosen cantrip with Intelligence provenance", () => {
    const build = highElfWizard({ cantripChoice: "fire-bolt" }).build;
    const grants = collectChoiceGrantedSpells([raceEntry(), subraceEntry()], { "high-elf-cantrip": "fire-bolt" }, registry);
    expect(grants).toEqual([
      expect.objectContaining({
        spellId: "fire-bolt",
        source: "subrace:high-elf",
        spellcastingAbility: "int",
        grantType: "known_cantrip"
      })
    ]);
    // deriveCharacter surfaces it in grantedSpells.
    const derived = deriveCharacter(highElfWizard({ cantripChoice: "fire-bolt" }), registry);
    expect(derived.grantedSpells).toContainEqual(
      expect.objectContaining({ spellId: "fire-bolt", spellcastingAbility: "int", source: "subrace:high-elf" })
    );
  });

  it("ignores an ineligible stored id (never seeds a bad spell)", () => {
    const grants = collectChoiceGrantedSpells([subraceEntry()], { "high-elf-cantrip": "magic-missile" }, registry);
    expect(grants).toEqual([]);
  });

  it("does not count the granted cantrip against class cantrips known", () => {
    // A High Elf Wizard's granted cantrip is separate from the wizard's own
    // chosen cantrips; the incomplete-choice summary still shows the wizard's
    // 3-cantrip requirement independent of the race grant.
    const character = highElfWizard({ cantripChoice: "fire-bolt" });
    character.build.spellcasting = { wizard: { cantripIds: [], knownIds: [], preparedIds: [] } };
    const summaries = getIncompleteChoiceSummaries(character.build, registry);
    expect(summaries.some((line) => /Wizard cantrips: 0 of 3/i.test(line))).toBe(true);
  });
});

describe("seeding the granted cantrip", () => {
  it("adds the wizard cantrip to a High Elf Fighter (a non-caster)", () => {
    const fighter = highElfWizard({ cantripChoice: "fire-bolt", classId: "fighter" });
    const patch = getBuilderFinishSheetSeedPatch(fighter, registry);
    const cantrips = patch.spells?.levels?.find((level) => /cantrip/i.test(level.label));
    expect(cantrips).toBeTruthy();
    const fireBolt = cantrips.spells.find((spell) => spell.builderSpellId === "fire-bolt");
    expect(fireBolt).toMatchObject({ name: "Fire Bolt", builderGranted: true });
    // A cantrip is always-known, not "prepared".
    expect(fireBolt.prepared).toBe(false);
  });

  it("seeds the cantrip for a High Elf Wizard without touching class cantrips", () => {
    const wizard = highElfWizard({ cantripChoice: "light" });
    wizard.build.spellcasting = { wizard: { cantripIds: ["fire-bolt"], knownIds: [], preparedIds: [] } };
    const patch = getBuilderFinishSheetSeedPatch(wizard, registry);
    const cantrips = patch.spells.levels.find((level) => /cantrip/i.test(level.label));
    const names = cantrips.spells.map((spell) => spell.builderSpellId);
    expect(names).toContain("light"); // granted (race)
    expect(names).toContain("fire-bolt"); // class-chosen
  });
});
