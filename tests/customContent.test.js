import { describe, expect, it } from "vitest";

import {
  addCustomContentRecords,
  ensureCustomContent,
  listCustomContent,
  removeCustomContentRecord,
  validateCustomContentRecord
} from "../js/domain/customContent.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import {
  createContentRegistry,
  getContentByKind,
  normalizeCustomContent,
  setActiveCustomContent
} from "../js/domain/rules/registry.js";
import { BUILTIN_CONTENT } from "../js/domain/rules/builtinContent.js";
import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { migrateState, sanitizeForSave } from "../js/state.js";

function makeState() {
  return migrateState({ schemaVersion: 10 });
}

const customRace = {
  id: "starfolk",
  kind: "race",
  name: "Starfolk",
  source: "custom",
  size: "Medium",
  speed: 35,
  abilityScoreIncreases: [{ ability: "wis", bonus: 2 }],
  traits: [],
  languages: ["common"],
  subraceIds: []
};

describe("custom content validation", () => {
  it("accepts a well-formed record", () => {
    expect(validateCustomContentRecord(customRace)).toEqual({ ok: true, errors: [] });
  });

  it("rejects malformed records with actionable errors", () => {
    expect(validateCustomContentRecord(null).ok).toBe(false);
    expect(validateCustomContentRecord({ kind: "race", name: "No Id" }).errors.join(" ")).toContain("Missing id");
    expect(validateCustomContentRecord({ id: "Bad Id!", kind: "race", name: "X" }).errors.join(" ")).toContain("Invalid id");
    expect(validateCustomContentRecord({ id: "x", kind: "monster", name: "X" }).errors.join(" ")).toContain("Unknown kind");
  });

  it("rejects records that shadow builtin SRD content", () => {
    const result = validateCustomContentRecord({ id: "fighter", kind: "class", name: "Fake Fighter" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("builtin");
  });
});

describe("custom content state storage", () => {
  it("migrateState v10 advances through current schema while creating the content bucket", () => {
    const state = makeState();
    expect(state.schemaVersion).toBe(12);
    expect(state.content).toEqual({ custom: [] });
  });

  it("adds records immutably and forces source custom", () => {
    const state = makeState();
    const before = ensureCustomContent(state);
    const result = addCustomContentRecords(state, [
      { ...customRace, source: "totally-not-custom" },
      { id: "bad id", kind: "race", name: "Nope" }
    ]);
    expect(result.added).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(state.content.custom).not.toBe(before);
    expect(state.content.custom[0].source).toBe("custom");
  });

  it("removes records by kind and id", () => {
    const state = makeState();
    addCustomContentRecords(state, [customRace]);
    expect(removeCustomContentRecord(state, "race", "starfolk")).toBe(true);
    expect(removeCustomContentRecord(state, "race", "starfolk")).toBe(false);
    expect(listCustomContent(state)).toEqual([]);
  });

  it("persists custom content through sanitizeForSave", () => {
    const state = makeState();
    addCustomContentRecords(state, [customRace]);
    const sanitized = sanitizeForSave(state);
    expect(sanitized.content.custom).toHaveLength(1);
    expect(sanitized.content.custom[0]).toMatchObject({ id: "starfolk", kind: "race", source: "custom" });

    // Round-trip: a reloaded save keeps the record.
    const reloaded = migrateState(JSON.parse(JSON.stringify(sanitized)));
    expect(listCustomContent(reloaded)).toHaveLength(1);
  });
});

describe("custom content registry merge", () => {
  it("merges custom records into the registry and skips shadowing/duplicates", () => {
    const { entries, skipped } = normalizeCustomContent([
      customRace,
      { id: "fighter", kind: "class", name: "Fake Fighter" },
      customRace
    ]);
    expect(entries).toHaveLength(1);
    expect(skipped.map((entry) => entry.reason)).toEqual(["shadows-builtin", "duplicate-custom"]);

    const registry = createContentRegistry([...BUILTIN_CONTENT, ...entries]);
    expect(getContentByKind(registry, "race", "starfolk")).toMatchObject({ name: "Starfolk", source: "custom" });
    expect(getContentByKind(registry, "class", "fighter")).toMatchObject({ source: "srd-5.1" });
  });

  it("derives builder characters from custom races and feats", () => {
    const customFeat = {
      id: "custom-tough",
      kind: "feat",
      name: "Custom Tough",
      source: "custom",
      prerequisites: [],
      desc: "+2 HP per level.",
      effects: [{ type: "hp_per_level_bonus", value: 2 }]
    };
    const { registry } = setActiveCustomContent([customRace, customFeat]);
    try {
      const character = makeDefaultBuilderCharacterEntry("Custom Mira");
      character.build.raceId = "starfolk";
      character.build.levels = [
        { classId: "fighter", hp: null },
        { classId: "fighter", hp: null },
        { classId: "fighter", hp: null },
        { classId: "fighter", hp: null }
      ];
      character.build.abilities.base = { str: 14, dex: 10, con: 14, int: 10, wis: 14, cha: 10 };
      character.build.choicesByLevel = {
        "4": { "asi-4": { type: "feat", featId: "custom-tough" } }
      };

      const derived = deriveCharacter(character, registry);
      expect(derived.labels.race).toBe("Starfolk");
      expect(derived.speed).toBe(35);
      expect(derived.abilities.wis).toMatchObject({ total: 16, modifier: 3 });
      // Fighter d10 ×4, CON +2, +2/level from the custom feat:
      // 10 + 6 + 6 + 6 + 4×2 + 4×2 = 44.
      expect(derived.hp.max).toBe(44);
      expect(derived.featIds).toEqual(["custom-tough"]);
      expect(derived.warnings).toEqual([]);
    } finally {
      setActiveCustomContent(null);
    }
  });
});

describe("builder character migration to v11", () => {
  it("migrates legacy v1 builds (prefixed ids, classId+level) to the level plan", () => {
    const migrated = migrateState({
      schemaVersion: 10,
      characters: {
        activeId: "char_a",
        entries: [{
          id: "char_a",
          name: "Legacy Mira",
          build: {
            version: 1,
            ruleset: "srd-5.1",
            raceId: "race_human",
            classId: "class_fighter",
            subclassId: null,
            backgroundId: "background_acolyte",
            level: 3,
            abilities: { base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 } },
            choicesByLevel: {}
          },
          features: "Existing notes stay",
          hpMax: 31,
          inventoryItems: [{ id: "inv_1", title: "Inventory", notes: "rope" }]
        }]
      }
    });

    const entry = migrated.characters.entries[0];
    expect(entry.build).toMatchObject({
      version: 2,
      ruleset: "srd-5.1",
      raceId: "human",
      backgroundId: "acolyte",
      levels: [
        { classId: "fighter", hp: null },
        { classId: "fighter", hp: null },
        { classId: "fighter", hp: null }
      ]
    });
    expect(entry.build.classId).toBeUndefined();
    expect(entry.build.level).toBeUndefined();
    // Unrelated character data is untouched.
    expect(entry.features).toBe("Existing notes stay");
    expect(entry.hpMax).toBe(31);
    expect(entry.inventoryItems).toEqual([{ id: "inv_1", title: "Inventory", notes: "rope" }]);

    // The migrated character derives correctly.
    const derived = deriveCharacter(entry);
    expect(derived.labels).toMatchObject({ classLevel: "Fighter 3", race: "Human", background: "Acolyte" });
    expect(derived.totalLevel).toBe(3);
  });
});
