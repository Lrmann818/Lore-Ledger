import { describe, expect, it } from "vitest";

import {
  FEAT_EFFECT_TYPES,
  collectOrphanedTraitIds,
  createFeatDraft,
  createRaceDraft,
  createSpellDraft,
  featDraftFromRecord,
  generateContentId,
  normalizeFeatDraft,
  normalizeRaceDraft,
  normalizeSpellDraft,
  raceDraftFromRecord,
  slugifyContentName,
  spellDraftFromRecord
} from "../js/domain/customContentAuthoring.js";
import { collectFeatEffects } from "../js/domain/rules/progression.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import {
  addCustomContentRecords,
  listCustomContent,
  updateCustomContentRecord,
  validateCustomContentRecord
} from "../js/domain/customContent.js";
import { findCharactersReferencingContent } from "../js/domain/characterPortability.js";
import { BUILTIN_CONTENT } from "../js/domain/rules/builtinContent.js";
import {
  BUILTIN_CONTENT_REGISTRY,
  createContentRegistry,
  getContentByKind,
  listContentByKind,
  normalizeCustomContent
} from "../js/domain/rules/registry.js";
import { migrateState } from "../js/state.js";

function makeState() {
  return migrateState({ schemaVersion: 10 });
}

function makeValidSpellDraft(overrides = {}) {
  return {
    ...createSpellDraft(),
    name: "Stellar Flare",
    level: "2",
    school: "evocation",
    classIds: ["wizard"],
    range: "60 feet",
    duration: "Instantaneous",
    desc: "A lance of starlight burns one creature you can see.",
    damageType: "radiant",
    saveAbility: "dex",
    ...overrides
  };
}

const context = () => ({ registry: BUILTIN_CONTENT_REGISTRY, existing: [] });

describe("content id generation", () => {
  it("slugifies display names into registry-safe ids", () => {
    expect(slugifyContentName("Stellar Flare")).toBe("stellar-flare");
    expect(slugifyContentName("  Mordenkainen's 7th Symphony!  ")).toBe("mordenkainen-s-7th-symphony");
    expect(slugifyContentName("!!!")).toBe("");
  });

  it("falls back to a kind-based id when the name has no usable characters", () => {
    expect(generateContentId("spell", "★★★")).toBe("custom-spell");
  });

  it("suffixes past builtin and custom collisions instead of shadowing", () => {
    // "shield" is a builtin SRD spell; the generated id must not shadow it.
    expect(generateContentId("spell", "Shield")).toBe("shield-2");
    const existing = [
      { id: "shield-2", kind: "spell", name: "Shield 2" },
      { id: "stellar-flare", kind: "spell", name: "Stellar Flare" }
    ];
    expect(generateContentId("spell", "Shield", existing)).toBe("shield-3");
    expect(generateContentId("spell", "Stellar Flare", existing)).toBe("stellar-flare-2");
    // Collisions are kind-aware: a custom race named Shield is fine.
    expect(generateContentId("race", "Shield", existing)).toBe("shield");
  });
});

describe("spell draft normalization", () => {
  it("normalizes a valid draft into a canonical custom spell record", () => {
    const result = normalizeSpellDraft(makeValidSpellDraft(), context());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.record).toEqual({
      id: "stellar-flare",
      kind: "spell",
      name: "Stellar Flare",
      source: "custom",
      level: 2,
      school: "evocation",
      classIds: ["wizard"],
      subclassIds: [],
      castingTime: "1 action",
      range: "60 feet",
      duration: "Instantaneous",
      components: ["V"],
      material: null,
      ritual: false,
      concentration: false,
      desc: "A lance of starlight burns one creature you can see.",
      higherLevel: null,
      attackType: null,
      saveAbility: "dex",
      damageType: "radiant"
    });
    // The editor and the import path must agree on validity.
    expect(validateCustomContentRecord(result.record)).toEqual({ ok: true, errors: [] });
  });

  it("reports every missing required field with a field-anchored message", () => {
    const result = normalizeSpellDraft({
      ...createSpellDraft(),
      castingTime: "",
      componentV: false
    }, context());
    expect(result.ok).toBe(false);
    expect(result.record).toBeNull();
    const fields = result.errors.map((error) => error.field);
    for (const field of ["name", "level", "school", "castingTime", "range", "duration", "desc"]) {
      expect(fields).toContain(field);
    }
    for (const error of result.errors) {
      expect(error.message.length).toBeGreaterThan(8);
    }
  });

  it("requires a material description only while the M component is on", () => {
    const missing = normalizeSpellDraft(makeValidSpellDraft({ componentM: true }), context());
    expect(missing.ok).toBe(false);
    expect(missing.errors).toEqual([
      { field: "material", message: expect.stringContaining("material") }
    ]);

    const withText = normalizeSpellDraft(
      makeValidSpellDraft({ componentM: true, material: "A pinch of stardust." }),
      context()
    );
    expect(withText.ok).toBe(true);
    expect(withText.record.components).toEqual(["V", "M"]);
    expect(withText.record.material).toBe("A pinch of stardust.");

    // Leftover material text is not persisted while M is off.
    const offAgain = normalizeSpellDraft(
      makeValidSpellDraft({ componentM: false, material: "A pinch of stardust." }),
      context()
    );
    expect(offAgain.ok).toBe(true);
    expect(offAgain.record.material).toBeNull();
  });

  it("rejects class, subclass, and enum values outside the supported sets", () => {
    const result = normalizeSpellDraft(makeValidSpellDraft({
      classIds: ["wizard", "not-a-class"],
      subclassIds: ["not-a-subclass"],
      attackType: "psychic-scream",
      saveAbility: "luck",
      damageType: "emotional"
    }), context());
    expect(result.ok).toBe(false);
    const byField = Object.fromEntries(result.errors.map((error) => [error.field, error.message]));
    expect(byField.classIds).toContain('"not-a-class"');
    expect(byField.subclassIds).toContain('"not-a-subclass"');
    expect(byField.attackType).toBeTruthy();
    expect(byField.saveAbility).toBeTruthy();
    expect(byField.damageType).toBeTruthy();
  });

  it("accepts spells tied to custom classes through the merged registry", () => {
    const customClass = { id: "runesmith", kind: "class", name: "Runesmith", source: "custom", hitDie: 8 };
    const { entries } = normalizeCustomContent([customClass]);
    const registry = createContentRegistry([...BUILTIN_CONTENT, ...entries]);
    const result = normalizeSpellDraft(
      makeValidSpellDraft({ classIds: ["runesmith"] }),
      { registry, existing: [customClass] }
    );
    expect(result.ok).toBe(true);
    expect(result.record.classIds).toEqual(["runesmith"]);
  });

  it("auto-suffixes ids that would shadow builtin spells", () => {
    const result = normalizeSpellDraft(makeValidSpellDraft({ name: "Fireball" }), context());
    expect(result.ok).toBe(true);
    expect(result.record.id).toBe("fireball-2");
    expect(result.record.name).toBe("Fireball");
  });

  it("keeps the id stable while editing and skips self-collision", () => {
    const existingRecord = normalizeSpellDraft(makeValidSpellDraft(), context()).record;
    const draft = spellDraftFromRecord(existingRecord);
    draft.name = "Stellar Flare, Greater";
    draft.level = "3";
    const result = normalizeSpellDraft(draft, {
      registry: BUILTIN_CONTENT_REGISTRY,
      existing: [existingRecord],
      editingId: "stellar-flare"
    });
    expect(result.ok).toBe(true);
    expect(result.record.id).toBe("stellar-flare");
    expect(result.record.name).toBe("Stellar Flare, Greater");
    expect(result.record.level).toBe(3);
  });

  it("round-trips a record through a draft without losing fields", () => {
    const original = normalizeSpellDraft(makeValidSpellDraft({
      componentM: true,
      componentS: true,
      material: "A silver mirror.",
      higherLevel: "The damage increases by 1d8 per slot level above 2nd.",
      ritual: true,
      concentration: true,
      attackType: "ranged"
    }), context()).record;
    const roundTripped = normalizeSpellDraft(spellDraftFromRecord(original), {
      registry: BUILTIN_CONTENT_REGISTRY,
      existing: [original],
      editingId: original.id
    });
    expect(roundTripped.ok).toBe(true);
    expect(roundTripped.record).toEqual(original);
  });
});

describe("feat draft normalization", () => {
  function makeValidFeatDraft(overrides = {}) {
    return {
      ...createFeatDraft(),
      name: "Iron Will",
      desc: "Your resolve is unshakeable.",
      prerequisites: [{ ability: "wis", minimum: "13" }],
      effects: [
        { type: "save_proficiency", value: "", ability: "wis", skill: "" },
        { type: "hp_per_level_bonus", value: "1", ability: "", skill: "" },
        { type: "skill_proficiency", value: "", ability: "", skill: "insight" }
      ],
      ...overrides
    };
  }

  it("normalizes a valid draft into a canonical feat record the rules engine consumes", () => {
    const result = normalizeFeatDraft(makeValidFeatDraft(), context());
    expect(result.ok).toBe(true);
    expect(result.record).toEqual({
      id: "iron-will",
      kind: "feat",
      name: "Iron Will",
      source: "custom",
      prerequisites: [{ ability: "wis", minimum: 13 }],
      desc: "Your resolve is unshakeable.",
      effects: [
        { type: "save_proficiency", ability: "wis" },
        { type: "hp_per_level_bonus", value: 1 },
        { type: "skill_proficiency", skill: "insight" }
      ]
    });
    expect(validateCustomContentRecord(result.record)).toEqual({ ok: true, errors: [] });

    // The exact rules-engine consumer applies the authored effects.
    const { entries } = normalizeCustomContent([result.record]);
    const collected = collectFeatEffects(entries);
    expect(collected.saveProficiencies).toEqual(["wis"]);
    expect(collected.hpPerLevelBonus).toBe(1);
    expect(collected.skillProficiencies).toEqual(["insight"]);
  });

  it("accepts a minimal feat with no prerequisites or effects", () => {
    const result = normalizeFeatDraft(makeValidFeatDraft({ prerequisites: [], effects: [] }), context());
    expect(result.ok).toBe(true);
    expect(result.record.prerequisites).toEqual([]);
    expect(result.record.effects).toEqual([]);
  });

  it("reports row-numbered errors for malformed prerequisites and effects", () => {
    const result = normalizeFeatDraft(makeValidFeatDraft({
      prerequisites: [
        { ability: "", minimum: "13" },
        { ability: "str", minimum: "45" }
      ],
      effects: [
        { type: "", value: "", ability: "", skill: "" },
        { type: "ability_bonus", value: "0", ability: "str", skill: "" },
        { type: "skill_proficiency", value: "", ability: "", skill: "not-a-skill" }
      ]
    }), context());
    expect(result.ok).toBe(false);
    const messages = result.errors.map((error) => `${error.field}: ${error.message}`);
    expect(messages).toContainEqual(expect.stringContaining("prerequisites: Prerequisite 1"));
    expect(messages).toContainEqual(expect.stringContaining("prerequisites: Prerequisite 2"));
    expect(messages).toContainEqual(expect.stringContaining("effects: Effect 1"));
    expect(messages).toContainEqual(expect.stringContaining("effects: Effect 2"));
    expect(messages).toContainEqual(expect.stringContaining("effects: Effect 3"));
  });

  it("requires name and description", () => {
    const result = normalizeFeatDraft(createFeatDraft(), context());
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.field)).toEqual(
      expect.arrayContaining(["name", "desc"])
    );
  });

  it("round-trips a feat record through a draft without losing fields", () => {
    const original = normalizeFeatDraft(makeValidFeatDraft(), context()).record;
    const roundTripped = normalizeFeatDraft(featDraftFromRecord(original), {
      registry: BUILTIN_CONTENT_REGISTRY,
      existing: [original],
      editingId: original.id
    });
    expect(roundTripped.ok).toBe(true);
    expect(roundTripped.record).toEqual(original);
  });

  it("avoids shadowing the builtin Grappler feat", () => {
    const result = normalizeFeatDraft(makeValidFeatDraft({ name: "Grappler" }), context());
    expect(result.ok).toBe(true);
    expect(result.record.id).toBe("grappler-2");
  });

  it("covers the whole closed effects vocabulary", () => {
    const effects = FEAT_EFFECT_TYPES.map((spec) => ({
      type: spec.type,
      value: spec.needs.includes("value") ? "2" : "",
      ability: spec.needs.includes("ability") ? "dex" : "",
      skill: spec.needs.includes("skill") ? "stealth" : ""
    }));
    const result = normalizeFeatDraft(makeValidFeatDraft({ effects }), context());
    expect(result.ok).toBe(true);
    expect(result.record.effects).toHaveLength(FEAT_EFFECT_TYPES.length);
    for (const effect of result.record.effects) {
      expect(Object.keys(effect)).toContain("type");
    }
  });
});

describe("race draft normalization (with inline trait sub-records)", () => {
  function makeValidRaceDraft(overrides = {}) {
    return {
      ...createRaceDraft(),
      name: "Starfolk",
      speed: "35",
      abilityScoreIncreases: [{ ability: "wis", bonus: "2" }],
      languages: ["common"],
      lore: "Born under wandering stars.",
      traits: [
        { id: "", name: "Starlight Vision", description: "You can see in dim light as if it were bright light." }
      ],
      ...overrides
    };
  }

  it("normalizes a valid draft into a race record plus companion trait records", () => {
    const result = normalizeRaceDraft(makeValidRaceDraft(), context());
    expect(result.ok).toBe(true);
    expect(result.record).toEqual({
      id: "starfolk",
      kind: "race",
      name: "Starfolk",
      source: "custom",
      size: "Medium",
      speed: 35,
      abilityScoreIncreases: [{ ability: "wis", bonus: 2 }],
      traits: ["starlight-vision"],
      subraceIds: [],
      languages: ["common"],
      lore: "Born under wandering stars."
    });
    expect(result.companionRecords).toEqual([{
      id: "starlight-vision",
      kind: "trait",
      name: "Starlight Vision",
      source: "custom",
      description: "You can see in dim light as if it were bright light."
    }]);
    expect(validateCustomContentRecord(result.record)).toEqual({ ok: true, errors: [] });
    expect(validateCustomContentRecord(result.companionRecords[0])).toEqual({ ok: true, errors: [] });
  });

  it("generates unique trait ids across builtin content and sibling rows", () => {
    // "darkvision" is a builtin trait id; two identical row names must also
    // not collide with each other.
    const result = normalizeRaceDraft(makeValidRaceDraft({
      traits: [
        { id: "", name: "Darkvision", description: "See in the dark." },
        { id: "", name: "Darkvision", description: "See even further in the dark." }
      ]
    }), context());
    expect(result.ok).toBe(true);
    expect(result.companionRecords.map((record) => record.id)).toEqual(["darkvision-2", "darkvision-3"]);
    expect(result.record.traits).toEqual(["darkvision-2", "darkvision-3"]);
  });

  it("reports field and row errors in plain language", () => {
    const result = normalizeRaceDraft({
      ...createRaceDraft(),
      name: "",
      size: "Colossal",
      speed: "3",
      abilityScoreIncreases: [{ ability: "", bonus: "2" }],
      languages: ["not-a-language"],
      traits: [{ id: "", name: "Nameless", description: "" }]
    }, context());
    expect(result.ok).toBe(false);
    const byField = {};
    for (const error of result.errors) {
      byField[error.field] = `${byField[error.field] || ""} ${error.message}`;
    }
    expect(byField.name).toContain("name");
    expect(byField.size).toContain("size");
    expect(byField.speed).toContain("speed");
    expect(byField.abilityScoreIncreases).toContain("Ability increase 1");
    expect(byField.languages).toContain("not-a-language");
    expect(byField.traits).toContain("Trait 1");
  });

  it("round-trips a race and its traits through a draft without loss", () => {
    const first = normalizeRaceDraft(makeValidRaceDraft(), context());
    const existing = [first.record, ...first.companionRecords];
    const draft = raceDraftFromRecord(first.record, { existing });
    expect(draft.traits).toEqual([{
      id: "starlight-vision",
      name: "Starlight Vision",
      description: "You can see in dim light as if it were bright light."
    }]);
    const roundTripped = normalizeRaceDraft(draft, {
      registry: BUILTIN_CONTENT_REGISTRY,
      existing,
      editingId: "starfolk"
    });
    expect(roundTripped.ok).toBe(true);
    expect(roundTripped.record).toEqual(first.record);
    expect(roundTripped.companionRecords).toEqual(first.companionRecords);
  });

  it("preserves trait references it cannot edit (builtin or missing records)", () => {
    const record = {
      id: "imported-race",
      kind: "race",
      name: "Imported Race",
      source: "custom",
      size: "Medium",
      speed: 30,
      abilityScoreIncreases: [],
      traits: ["darkvision", "some-missing-trait"],
      subraceIds: [],
      languages: ["common"],
      lore: ""
    };
    const draft = raceDraftFromRecord(record, { existing: [record] });
    expect(draft.traits).toEqual([]);
    expect(draft.preservedTraitIds).toEqual(["darkvision", "some-missing-trait"]);
    const result = normalizeRaceDraft(draft, {
      registry: BUILTIN_CONTENT_REGISTRY,
      existing: [record],
      editingId: "imported-race"
    });
    expect(result.ok).toBe(true);
    expect(result.record.traits).toEqual(["darkvision", "some-missing-trait"]);
  });

  it("derives a builder character from an authored race end-to-end", () => {
    const result = normalizeRaceDraft(makeValidRaceDraft(), context());
    const { entries } = normalizeCustomContent([result.record, ...result.companionRecords]);
    const registry = createContentRegistry([...BUILTIN_CONTENT, ...entries]);
    const character = makeDefaultBuilderCharacterEntry("Authored Race Test");
    character.build.raceId = "starfolk";
    character.build.levels = [{ classId: "fighter", hp: null }];
    character.build.abilities.base = { str: 14, dex: 10, con: 14, int: 10, wis: 14, cha: 10 };
    const derived = deriveCharacter(character, registry);
    expect(derived.labels.race).toBe("Starfolk");
    expect(derived.speed).toBe(35);
    expect(derived.abilities.wis).toMatchObject({ total: 16, modifier: 3 });
    expect(derived.raceTraits).toEqual([
      expect.objectContaining({ id: "starlight-vision", name: "Starlight Vision" })
    ]);
  });

  it("identifies orphaned custom traits only when nothing else references them", () => {
    const trait = { id: "starlight-vision", kind: "trait", name: "Starlight Vision", description: "x" };
    const before = { id: "starfolk", kind: "race", traits: ["starlight-vision", "darkvision"] };
    const afterWithout = { id: "starfolk", kind: "race", traits: [] };
    // Removed and unreferenced elsewhere → orphaned (builtin darkvision is
    // never removable).
    expect(collectOrphanedTraitIds(before, afterWithout, [before, trait])).toEqual(["starlight-vision"]);
    // Another custom race still references it → kept.
    const otherRace = { id: "moonfolk", kind: "race", traits: ["starlight-vision"] };
    expect(collectOrphanedTraitIds(before, afterWithout, [before, trait, otherRace])).toEqual([]);
    // No previous record (create flow) → nothing to clean up.
    expect(collectOrphanedTraitIds(null, afterWithout, [trait])).toEqual([]);
  });
});

describe("authored records in storage and the registry", () => {
  it("registers an authored spell so builder pickers can see it", () => {
    const state = makeState();
    const { record } = normalizeSpellDraft(makeValidSpellDraft(), context());
    const added = addCustomContentRecords(state, [record]);
    expect(added.added).toBe(1);

    const { entries } = normalizeCustomContent(listCustomContent(state));
    const registry = createContentRegistry([...BUILTIN_CONTENT, ...entries]);
    expect(getContentByKind(registry, "spell", "stellar-flare")).toMatchObject({
      name: "Stellar Flare",
      source: "custom"
    });
    // The wizard spell step filters by classIds — the authored spell must
    // survive that exact predicate.
    const wizardSpells = listContentByKind(registry, "spell").filter((entry) => {
      const classIds = Array.isArray(entry.data?.classIds) ? entry.data.classIds : [];
      return classIds.includes("wizard");
    });
    expect(wizardSpells.some((entry) => entry.id === "stellar-flare")).toBe(true);
  });

  it("updates a record in place, immutably, with identity locked", () => {
    const state = makeState();
    const { record } = normalizeSpellDraft(makeValidSpellDraft(), context());
    addCustomContentRecords(state, [record]);
    const before = state.content.custom;

    const edited = { ...record, name: "Stellar Flare, Greater", level: 3, source: "sneaky" };
    const result = updateCustomContentRecord(state, "spell", "stellar-flare", edited);
    expect(result).toEqual({ ok: true, errors: [] });
    expect(state.content.custom).not.toBe(before);
    expect(state.content.custom[0]).toMatchObject({
      id: "stellar-flare",
      name: "Stellar Flare, Greater",
      level: 3,
      source: "custom"
    });
  });

  it("rejects updates that target a missing record or change identity", () => {
    const state = makeState();
    const { record } = normalizeSpellDraft(makeValidSpellDraft(), context());
    expect(updateCustomContentRecord(state, "spell", "stellar-flare", record).ok).toBe(false);

    addCustomContentRecords(state, [record]);
    const renamed = { ...record, id: "different-id" };
    const result = updateCustomContentRecord(state, "spell", "stellar-flare", renamed);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("kind and id");
    expect(state.content.custom[0].id).toBe("stellar-flare");
  });

  it("rejects updates that fail record validation", () => {
    const state = makeState();
    const { record } = normalizeSpellDraft(makeValidSpellDraft(), context());
    addCustomContentRecords(state, [record]);
    const invalid = { ...record, name: "" };
    const result = updateCustomContentRecord(state, "spell", "stellar-flare", invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("name");
    expect(state.content.custom[0].name).toBe("Stellar Flare");
  });
});

describe("reference disclosure before destructive actions", () => {
  function makeStateWithSpellAndCharacters() {
    const state = makeState();
    const { record } = normalizeSpellDraft(makeValidSpellDraft(), context());
    addCustomContentRecords(state, [record]);
    state.characters = {
      activeId: "char_a",
      entries: [
        {
          id: "char_a",
          name: "Mira",
          build: { spellcasting: { wizard: { knownIds: ["stellar-flare"] } } }
        },
        {
          id: "char_b",
          name: "",
          spells: { levels: [{ spells: [{ id: "s1", builderSpellId: "stellar-flare" }] }] }
        },
        { id: "char_c", name: "Bruni", build: { raceId: "dwarf" } }
      ]
    };
    return state;
  }

  it("names every character whose build or sheet references the record", () => {
    const state = makeStateWithSpellAndCharacters();
    expect(findCharactersReferencingContent(state, "spell", "stellar-flare")).toEqual([
      "Mira",
      "Unnamed character"
    ]);
  });

  it("returns no names for unreferenced records or blank targets", () => {
    const state = makeStateWithSpellAndCharacters();
    expect(findCharactersReferencingContent(state, "spell", "other-spell")).toEqual([]);
    expect(findCharactersReferencingContent(state, "", "")).toEqual([]);
    expect(findCharactersReferencingContent(null, "spell", "stellar-flare")).toEqual([]);
  });
});
