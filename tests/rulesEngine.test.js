import { describe, expect, it } from "vitest";

import { makeDefaultCharacterOverrides, normalizeCharacterOverrides } from "../js/domain/characterHelpers.js";
import {
  abilityModifier,
  deriveCharacter,
  materializeDerivedCharacterFields,
  proficiencyBonusForLevel
} from "../js/domain/rules/deriveCharacter.js";
import {
  BUILTIN_CONTENT_REGISTRY,
  createContentRegistry,
  getContentById,
  listContentByKind
} from "../js/domain/rules/registry.js";

describe("builtin content registry", () => {
  it("looks up builtin content by id", () => {
    expect(getContentById(BUILTIN_CONTENT_REGISTRY, "class_fighter")).toMatchObject({
      id: "class_fighter",
      kind: "class",
      name: "Fighter"
    });
  });

  it("lists content by kind", () => {
    expect(listContentByKind(BUILTIN_CONTENT_REGISTRY, "species").map((entry) => entry.id)).toEqual([
      "species_human",
      "species_dwarf",
      "species_elf"
    ]);
    expect(listContentByKind(BUILTIN_CONTENT_REGISTRY, "class").map((entry) => entry.id)).toEqual([
      "class_fighter",
      "class_cleric",
      "class_wizard"
    ]);
    expect(listContentByKind(BUILTIN_CONTENT_REGISTRY, "background").map((entry) => entry.id)).toEqual([
      "background_acolyte",
      "background_sage",
      "background_soldier"
    ]);
  });

  it("returns null or an empty list for unknown content", () => {
    expect(getContentById(BUILTIN_CONTENT_REGISTRY, "missing")).toBeNull();
    expect(listContentByKind(BUILTIN_CONTENT_REGISTRY, "feat")).toEqual([]);
  });

  it("can create a registry from a caller-provided entry list", () => {
    const registry = createContentRegistry([
      { id: "species_test", kind: "species", name: "Test Species", source: "test" }
    ]);

    expect(getContentById(registry, "species_test")).toMatchObject({ name: "Test Species" });
    expect(listContentByKind(registry, "class")).toEqual([]);
  });
});

describe("rules derivation", () => {
  it("computes ability totals, modifiers, proficiency, saves, skills, initiative, and labels", () => {
    const character = {
      id: "char_builder",
      name: "Mira",
      classLevel: "Legacy Class",
      race: "Legacy Race",
      background: "Legacy Background",
      build: {
        version: 1,
        ruleset: "srd-5.2.1",
        speciesId: "species_human",
        classId: "class_fighter",
        backgroundId: "background_soldier",
        level: 5,
        abilities: {
          base: { str: 15, dex: 14, con: 13, int: 10, wis: 8, cha: 12 }
        }
      },
      overrides: {
        abilities: { str: 1, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
        saves: { str: 2, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
        skills: { athletics: 1, stealth: 2 },
        initiative: 1
      },
      skills: {
        athletics: { level: "prof", misc: 1 },
        stealth: { level: "half", misc: 0 }
      }
    };

    const derived = deriveCharacter(character);

    expect(derived.mode).toBe("builder");
    expect(derived.labels).toEqual({
      classLevel: "Fighter 5",
      race: "Human",
      background: "Soldier"
    });
    expect(derived.level).toBe(5);
    expect(derived.proficiencyBonus).toBe(3);
    expect(derived.abilities.str).toEqual({ base: 15, override: 1, total: 16, modifier: 3 });
    expect(derived.abilities.dex).toMatchObject({ total: 14, modifier: 2 });
    expect(derived.saves.str).toEqual({ proficient: true, misc: 2, total: 8 });
    expect(derived.saves.con).toEqual({ proficient: true, misc: 0, total: 4 });
    expect(derived.skills.athletics).toMatchObject({ ability: "str", level: "prof", misc: 1, override: 1, total: 8 });
    expect(derived.skills.stealth).toMatchObject({ ability: "dex", level: "half", misc: 0, override: 2, total: 5 });
    expect(derived.initiative).toBe(3);
    expect(derived.warnings).toEqual([]);
    expect(() => JSON.stringify(derived)).not.toThrow();
  });

  it("derives freeform characters from existing persisted fields without switching modes", () => {
    const character = {
      id: "char_freeform",
      name: "Arlen",
      classLevel: "Rogue 2",
      race: "Halfling",
      background: "Urchin",
      proficiency: 2,
      build: null,
      overrides: makeDefaultCharacterOverrides(),
      abilities: {
        dex: { score: 16, saveProf: true },
        int: { score: 12, saveProf: false }
      },
      saveOptions: {
        misc: { str: 0, dex: 1, con: 0, int: 0, wis: 0, cha: 0 },
        modToAll: "int"
      },
      skills: {
        stealth: { level: "expert", misc: 1 },
        investigation: { level: "none", misc: 0 }
      }
    };

    const derived = deriveCharacter(character);

    expect(derived.mode).toBe("freeform");
    expect(derived.labels).toEqual({
      classLevel: "Rogue 2",
      race: "Halfling",
      background: "Urchin"
    });
    expect(derived.proficiencyBonus).toBe(2);
    expect(derived.abilities.dex).toMatchObject({ base: 16, total: 16, modifier: 3 });
    expect(derived.saves.dex).toEqual({ proficient: true, misc: 2, total: 7 });
    expect(derived.skills.stealth).toMatchObject({ ability: "dex", level: "expert", misc: 1, total: 8 });
    expect(derived.skills.investigation).toMatchObject({ ability: "int", level: "none", misc: 0, total: 1 });
  });

  it("does not activate builder mode for malformed plain build objects", () => {
    const derived = deriveCharacter({
      classLevel: "Rogue 2",
      race: "Halfling",
      background: "Urchin",
      proficiency: 2,
      build: { arbitrary: true },
      abilities: {
        dex: { score: 16, saveProf: true }
      }
    });

    expect(derived.mode).toBe("freeform");
    expect(derived.labels).toEqual({
      classLevel: "Rogue 2",
      race: "Halfling",
      background: "Urchin"
    });
    expect(derived.abilities.dex).toMatchObject({ base: 16, total: 16, modifier: 3 });
  });

  it("uses the shared override normalization helper during derivation", () => {
    const rawOverrides = {
      abilities: { dex: "2", con: "bad" },
      saves: { dex: "1" },
      skills: { stealth: "3", "": 9 },
      initiative: "4"
    };
    const normalized = normalizeCharacterOverrides(rawOverrides);

    const derived = deriveCharacter({
      build: {
        version: 1,
        classId: "class_fighter",
        level: 1,
        abilities: { base: { dex: 14 } }
      },
      overrides: rawOverrides,
      skills: {
        stealth: { level: "prof", misc: 0 }
      }
    });

    expect(normalized).toEqual({
      abilities: { str: 0, dex: 2, con: 0, int: 0, wis: 0, cha: 0 },
      saves: { str: 0, dex: 1, con: 0, int: 0, wis: 0, cha: 0 },
      skills: { stealth: 3 },
      initiative: 4
    });
    expect(derived.abilities.dex.override).toBe(normalized.abilities.dex);
    expect(derived.saves.dex.misc).toBe(normalized.saves.dex);
    expect(derived.skills.stealth.override).toBe(normalized.skills.stealth);
    expect(derived.initiative).toBe(7);
  });

  it("does not treat builder ability overrides as replacement scores when base data is missing", () => {
    const character = {
      build: {
        version: 1,
        level: 1,
        abilities: { base: { dex: 14 } }
      },
      overrides: { abilities: { str: 3, dex: 2 } }
    };

    const derived = deriveCharacter(character);

    expect(derived.abilities.str).toMatchObject({ base: null, override: 3, total: null, modifier: null });
    expect(derived.abilities.dex).toMatchObject({ base: 14, override: 2, total: 16, modifier: 3 });
  });

  it("reports warnings for unknown builder content ids without throwing", () => {
    const derived = deriveCharacter({
      build: {
        speciesId: "species_missing",
        classId: "class_missing",
        backgroundId: "background_missing",
        level: 1
      }
    });

    expect(derived.mode).toBe("builder");
    expect(derived.labels).toEqual({ classLevel: "1", race: "", background: "" });
    expect(derived.warnings).toEqual([
      "Unknown class content: class_missing",
      "Unknown species content: species_missing",
      "Unknown background content: background_missing"
    ]);
  });

  it("does not mutate the input character", () => {
    const character = {
      build: {
        speciesId: "species_human",
        classId: "class_fighter",
        backgroundId: "background_soldier",
        level: 1,
        abilities: { base: { str: 16 } }
      },
      overrides: { abilities: { str: 1 } },
      skills: { athletics: { level: "prof", misc: 0 } }
    };
    const before = structuredClone(character);

    deriveCharacter(character);

    expect(character).toEqual(before);
  });

  it("reflects builder identity changes in derived values without mutating the character", () => {
    const character = {
      build: {
        version: 1,
        ruleset: "srd-5.2.1",
        speciesId: "species_human",
        classId: "class_fighter",
        backgroundId: "background_soldier",
        level: 1,
        abilities: { base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } },
        choicesByLevel: {}
      },
      overrides: makeDefaultCharacterOverrides()
    };

    character.build.level = 9;
    character.build.speciesId = "species_elf";
    character.build.classId = "class_wizard";
    character.build.backgroundId = "background_sage";
    const beforeDerive = structuredClone(character);

    const derived = deriveCharacter(character);

    expect(derived.level).toBe(9);
    expect(derived.proficiencyBonus).toBe(4);
    expect(derived.labels).toEqual({
      classLevel: "Wizard 9",
      race: "Elf",
      background: "Sage"
    });
    expect(character).toEqual(beforeDerive);
    expect(beforeDerive).toMatchObject({
      build: {
        level: 9,
        speciesId: "species_elf",
        classId: "class_wizard",
        backgroundId: "background_sage"
      }
    });
    expect(derived).not.toBe(character);
  });

  it("materializes derived compatibility fields into a clone only when explicitly called", () => {
    const character = {
      id: "char_builder",
      name: "Mira",
      classLevel: "",
      race: "",
      background: "",
      build: {
        speciesId: "species_human",
        classId: "class_fighter",
        backgroundId: "background_soldier",
        level: 1,
        abilities: { base: { str: 16, dex: 14 } }
      },
      overrides: makeDefaultCharacterOverrides(),
      abilities: {}
    };
    const derived = deriveCharacter(character);
    const materialized = materializeDerivedCharacterFields(character, derived);

    expect(materialized).not.toBe(character);
    expect(character.classLevel).toBe("");
    expect(materialized).toMatchObject({
      classLevel: "Fighter 1",
      race: "Human",
      background: "Soldier",
      proficiency: 2,
      initiative: 2
    });
    expect(materialized.abilities.str).toMatchObject({ score: 16, mod: 3, save: 5 });
    expect(materialized.abilities.dex).toMatchObject({ score: 14, mod: 2, save: 2 });
  });

  it("exposes basic math helpers", () => {
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(18)).toBe(4);
    expect(proficiencyBonusForLevel(1)).toBe(2);
    expect(proficiencyBonusForLevel(5)).toBe(3);
    expect(proficiencyBonusForLevel(17)).toBe(6);
  });
});
