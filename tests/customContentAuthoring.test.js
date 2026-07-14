import { describe, expect, it } from "vitest";

import {
  FEAT_EFFECT_TYPES,
  classDraftFromRecord,
  collectOrphanedFeatureIds,
  collectOrphanedTraitIds,
  createClassDraft,
  createFeatDraft,
  createRaceDraft,
  createSpellDraft,
  featDraftFromRecord,
  generateContentId,
  normalizeClassDraft,
  normalizeFeatDraft,
  normalizeRaceDraft,
  normalizeSpellDraft,
  parsePerLevelList,
  raceDraftFromRecord,
  slugifyContentName,
  spellDraftFromRecord,
  standardSlotTable
} from "../js/domain/customContentAuthoring.js";
import { collectFeatEffects, getGrantedSpells, getSpellcastingClasses } from "../js/domain/rules/progression.js";
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

describe("class draft normalization (the matrix #15 acceptance case)", () => {
  function makeValidClassDraft(overrides = {}) {
    return {
      ...createClassDraft(),
      name: "Runesmith",
      hitDie: "10",
      savingThrowProficiencies: ["con", "int"],
      armorProficiencies: ["light", "medium", "shield"],
      weaponProficiencies: ["simple", "martial"],
      toolProficiencies: "smith's tools",
      skillChoicesCount: "2",
      skillChoicesFrom: ["arcana", "history", "athletics"],
      asiLevels: "4, 8, 12, 16, 19",
      features: [
        { id: "", level: "1", name: "Runic Focus", description: "You channel magic through carved runes." },
        { id: "", level: "2", name: "Rune Burst", description: "Expend a rune for a burst of force." }
      ],
      progression: "full",
      preparationMode: "known",
      spellAbility: "int",
      ritualCasting: true,
      startLevel: "1",
      cantripsKnown: "2, 2, 2, 3",
      spellsKnown: "2, 3, 4, 5",
      resources: [
        {
          name: "Runes",
          maxType: "byClassLevel",
          constantValue: "",
          multiplier: "",
          ability: "",
          minimum: "",
          startLevel: "1",
          byLevelValues: "2, 2, 3, 3, unlimited",
          recovery: "longRest"
        }
      ],
      grantedSpells: [{ classLevel: "3", spellId: "fireball" }],
      ...overrides
    };
  }

  it("normalizes a full caster class with features, resources, and granted spells", () => {
    const result = normalizeClassDraft(makeValidClassDraft(), context());
    expect(result.ok).toBe(true);
    const record = result.record;
    expect(record).toMatchObject({
      id: "runesmith",
      kind: "class",
      name: "Runesmith",
      source: "custom",
      hitDie: 10,
      savingThrowProficiencies: ["con", "int"],
      armorProficiencies: ["light", "medium", "shield"],
      weaponProficiencies: ["simple", "martial"],
      toolProficiencies: ["smith's tools"],
      skillChoices: { choose: 2, from: ["arcana", "history", "athletics"] },
      asiLevels: [4, 8, 12, 16, 19],
      featuresByLevel: { "1": ["runic-focus"], "2": ["rune-burst"] },
      subclassIds: [],
      grantedSpells: [{ classLevel: 3, spellId: "fireball", grantType: "always_prepared" }]
    });
    // Casting uses the standard SRD full-caster slot table.
    expect(record.spellcasting).toMatchObject({
      ability: "int",
      progression: "full",
      preparationMode: "known",
      ritualCasting: true,
      startLevel: 1
    });
    expect(record.spellcasting.slotsByLevel).toEqual(standardSlotTable("full"));
    // Comma lists pad to 20 by repeating the last value.
    expect(record.spellcasting.cantripsKnownByLevel).toHaveLength(20);
    expect(record.spellcasting.cantripsKnownByLevel.slice(0, 5)).toEqual([2, 2, 2, 3, 3]);
    expect(record.spellcasting.spellsKnownByLevel[19]).toBe(5);
    // Resource pool in the Phase 2 schema, including the unlimited sentinel.
    expect(record.resources).toEqual([{
      id: "runes",
      name: "Runes",
      max: { type: "byClassLevel", values: [2, 2, 3, 3, ...Array(16).fill("unlimited")] },
      recovery: "longRest"
    }]);
    // Companion feature records are tied to the class.
    expect(result.companionRecords).toEqual([
      expect.objectContaining({ id: "runic-focus", kind: "feature", classId: "runesmith", level: 1 }),
      expect.objectContaining({ id: "rune-burst", kind: "feature", classId: "runesmith", level: 2 })
    ]);
    // Import-path validation (including the resources probe) agrees.
    expect(validateCustomContentRecord(record)).toEqual({ ok: true, errors: [] });
    for (const companion of result.companionRecords) {
      expect(validateCustomContentRecord(companion)).toEqual({ ok: true, errors: [] });
    }
  });

  it("omits spellcasting and resources for a plain martial class", () => {
    const result = normalizeClassDraft(makeValidClassDraft({
      progression: "none",
      resources: [],
      grantedSpells: [],
      features: []
    }), context());
    expect(result.ok).toBe(true);
    expect(result.record).not.toHaveProperty("spellcasting");
    expect(result.record).not.toHaveProperty("resources");
    expect(result.record).not.toHaveProperty("grantedSpells");
    expect(result.record.featuresByLevel).toEqual({});
  });

  it("validates every repeatable-row family with row-numbered messages", () => {
    const result = normalizeClassDraft(makeValidClassDraft({
      skillChoicesCount: "5",
      skillChoicesFrom: ["arcana"],
      asiLevels: "4, banana",
      features: [{ id: "", level: "25", name: "Too Deep", description: "x" }],
      resources: [{
        name: "", maxType: "constant", constantValue: "", multiplier: "",
        ability: "", minimum: "", startLevel: "1", byLevelValues: "", recovery: "longRest"
      }],
      grantedSpells: [{ classLevel: "3", spellId: "not-a-spell" }],
      spellsKnown: "2, x"
    }), context());
    expect(result.ok).toBe(false);
    const text = result.errors.map((error) => `${error.field}: ${error.message}`).join("\n");
    expect(text).toContain("skillChoices: The class picks 5 skills");
    expect(text).toContain('asiLevels: ASI level "banana"');
    expect(text).toContain("features: Feature 1");
    expect(text).toContain("resources: Resource 1");
    expect(text).toContain("grantedSpells: Granted spell 1");
    expect(text).toContain("spellsKnown: Spells known:");
  });

  it("requires a spells-known table for known-mode casters", () => {
    const result = normalizeClassDraft(makeValidClassDraft({ spellsKnown: "" }), context());
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: "spellsKnown" })
    );
  });

  it("round-trips a class and its features through a draft without loss", () => {
    const first = normalizeClassDraft(makeValidClassDraft(), context());
    const existing = [first.record, ...first.companionRecords];
    const draft = classDraftFromRecord(first.record, { existing });
    expect(draft.features).toHaveLength(2);
    expect(draft.resources).toHaveLength(1);
    const roundTripped = normalizeClassDraft(draft, {
      registry: BUILTIN_CONTENT_REGISTRY,
      existing,
      editingId: "runesmith"
    });
    expect(roundTripped.ok).toBe(true);
    expect(roundTripped.record).toEqual(first.record);
    expect(roundTripped.companionRecords).toEqual(first.companionRecords);
  });

  it("preserves fields and rows the form does not own through an edit", () => {
    const imported = {
      ...normalizeClassDraft(makeValidClassDraft(), context()).record,
      multiclassing: { prerequisites: [{ ability: "int", minimum: 13 }] },
      startingEquipment: [{ itemId: "backpack", name: "Backpack", quantity: 1 }],
      subclassIds: ["rune-carver"],
      resources: [
        { id: "runes", name: "Runes", max: { type: "constant", value: 2, startLevel: 1 }, recovery: "longRest" },
        {
          id: "threshold-pool",
          name: "Threshold Pool",
          max: { type: "constant", value: 1, startLevel: 1 },
          recovery: [{ minClassLevel: 1, recovery: "longRest" }, { minClassLevel: 5, recovery: "shortOrLongRest" }]
        }
      ],
      featuresByLevel: { "1": ["runic-focus", "some-imported-feature"] }
    };
    const featureRecord = {
      id: "runic-focus", kind: "feature", name: "Runic Focus", source: "custom",
      classId: "runesmith", subclassId: null, level: 1, desc: "You channel magic through carved runes."
    };
    const draft = classDraftFromRecord(imported, { existing: [imported, featureRecord] });
    // Editable: the resolvable feature and the simple resource.
    expect(draft.features).toEqual([expect.objectContaining({ id: "runic-focus" })]);
    expect(draft.resources).toEqual([expect.objectContaining({ name: "Runes" })]);
    // Preserved: threshold-recovery pool, unresolvable feature id, and
    // fields the form does not own.
    expect(draft.preservedResources).toEqual([expect.objectContaining({ id: "threshold-pool" })]);
    expect(draft.preservedFeaturesByLevel).toEqual({ "1": ["some-imported-feature"] });
    expect(draft.preservedFields.multiclassing).toBeTruthy();
    expect(draft.preservedFields.startingEquipment).toBeTruthy();
    expect(draft.preservedFields.subclassIds).toEqual(["rune-carver"]);

    const result = normalizeClassDraft(draft, {
      registry: BUILTIN_CONTENT_REGISTRY,
      existing: [imported, featureRecord],
      editingId: "runesmith"
    });
    expect(result.ok).toBe(true);
    expect(result.record.multiclassing).toEqual(imported.multiclassing);
    expect(result.record.startingEquipment).toEqual(imported.startingEquipment);
    expect(result.record.subclassIds).toEqual(["rune-carver"]);
    expect(result.record.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "threshold-pool" }),
      expect.objectContaining({ id: "runes" })
    ]));
    expect(result.record.featuresByLevel["1"]).toEqual(
      expect.arrayContaining(["runic-focus", "some-imported-feature"])
    );
  });

  it("drives the rules engine end-to-end: slots, resources, granted spells, derivation", () => {
    const result = normalizeClassDraft(makeValidClassDraft(), context());
    const { entries } = normalizeCustomContent([result.record, ...result.companionRecords]);
    const registry = createContentRegistry([...BUILTIN_CONTENT, ...entries]);

    const levels = [
      { classId: "runesmith", hp: null },
      { classId: "runesmith", hp: null },
      { classId: "runesmith", hp: null }
    ];
    const casters = getSpellcastingClasses(levels, registry);
    expect(casters).toEqual([expect.objectContaining({
      classId: "runesmith",
      preparationMode: "known",
      cantripsKnownMax: 2,
      spellsKnownMax: 4
    })]);
    expect(getGrantedSpells(levels, {}, registry)).toEqual([
      { spellId: "fireball", classId: "runesmith", subclassId: "", grantType: "always_prepared" }
    ]);

    const character = makeDefaultBuilderCharacterEntry("Rune Tester");
    character.build.raceId = "human";
    character.build.levels = levels;
    character.build.abilities.base = { str: 10, dex: 12, con: 14, int: 15, wis: 10, cha: 8 };
    const derived = deriveCharacter(character, registry);
    expect(derived.labels.classLevel).toContain("Runesmith 3");
    expect(derived.derivedResources).toEqual([
      expect.objectContaining({ id: "runes", name: "Runes", max: 3, recovery: "longRest" })
    ]);
    expect(derived.spellcasting.slots[0]).toBeGreaterThan(0);
  });

  it("identifies orphaned custom features only when nothing else references them", () => {
    const feature = { id: "runic-focus", kind: "feature", name: "Runic Focus", desc: "x" };
    const before = { id: "runesmith", kind: "class", featuresByLevel: { "1": ["runic-focus", "second-wind"] } };
    const after = { id: "runesmith", kind: "class", featuresByLevel: {} };
    expect(collectOrphanedFeatureIds(before, after, [before, feature])).toEqual(["runic-focus"]);
    const otherClass = { id: "other", kind: "class", featuresByLevel: { "3": ["runic-focus"] } };
    expect(collectOrphanedFeatureIds(before, after, [before, feature, otherClass])).toEqual([]);
    expect(collectOrphanedFeatureIds(null, after, [feature])).toEqual([]);
  });

  it("parses per-level lists with padding and rejects junk", () => {
    expect(parsePerLevelList("2, 3").values).toEqual([2, ...Array(19).fill(3)].map((v, i) => i === 0 ? 2 : 3));
    expect(parsePerLevelList("").values).toBeNull();
    expect(parsePerLevelList("2, x").error).toContain('"x"');
    expect(parsePerLevelList("2, unlimited", { allowUnlimited: true }).values[19]).toBe("unlimited");
    expect(parsePerLevelList("2, unlimited").error).toContain('"unlimited"');
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
