import { describe, expect, it } from "vitest";

import backgrounds from "../../game-data/srd/backgrounds.json";
import classes from "../../game-data/srd/classes.json";
import draconicAncestries from "../../game-data/srd/draconic-ancestries.json";
import features from "../../game-data/srd/features.json";
import packs from "../../game-data/srd/equipment.packs.json";
import races from "../../game-data/srd/races.json";
import spells from "../../game-data/srd/spells.json";
import subclasses from "../../game-data/srd/subclasses.json";
import traits from "../../game-data/srd/traits.json";

const SPELL_CHOICE_KINDS = new Set(["cantrip"]);

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ABILITY_IDS = new Set(["str", "dex", "con", "int", "wis", "cha"]);

const registryFiles = [
  ["races", races],
  ["draconic-ancestries", draconicAncestries],
  ["traits", traits],
  ["equipment.packs", packs],
];

const registryBySource = new Map([
  ["draconic-ancestries", draconicAncestries],
]);

function byId(records, id) {
  return records.find((record) => record.id === id);
}

function findDuplicateIds(records) {
  const seen = new Set();
  const duplicates = [];

  for (const record of records) {
    if (seen.has(record.id)) {
      duplicates.push(record.id);
    }
    seen.add(record.id);
  }

  return duplicates;
}

function choiceIdsForRaces() {
  return new Set(
    races.flatMap((race) => (race.choices ?? []).map((choice) => choice.id))
  );
}

describe("generated SRD registry integrity", () => {
  it("keeps stable unique ids within each loaded file", () => {
    for (const [fileName, records] of registryFiles) {
      expect(
        records
          .filter((record) => !ID_PATTERN.test(record.id))
          .map((record) => `${fileName}:${record.id}`)
      ).toEqual([]);
      expect(findDuplicateIds(records)).toEqual([]);
    }
  });

  it("includes canonical base fields on every loaded record", () => {
    for (const [fileName, records] of registryFiles) {
      expect(
        records
          .filter((record) => !record.id || !record.kind || !record.name || !record.source)
          .map((record) => `${fileName}:${record.id ?? "<missing-id>"}`)
      ).toEqual([]);
    }
  });

  it("keeps race choice ids unique within each race", () => {
    for (const race of races) {
      expect(findDuplicateIds(race.choices ?? [])).toEqual([]);
    }
  });

  it("resolves Dragonborn's ancestry choice to the generated draconic ancestries file", () => {
    const dragonborn = byId(races, "dragonborn");
    const choice = dragonborn?.choices?.find((entry) => entry.id === "dragonborn-ancestry");

    expect(choice).toMatchObject({
      id: "dragonborn-ancestry",
      kind: "ancestry",
      from: {
        type: "list",
        source: "draconic-ancestries",
      },
    });
    expect(registryBySource.has(choice?.from.source)).toBe(true);
    expect(registryBySource.get(choice?.from.source)).toBe(draconicAncestries);
  });

  it("resolves scoped list-backed race choice sources to generated registry files", () => {
    const unresolvedSources = [];

    for (const race of races) {
      for (const choice of race.choices ?? []) {
        if (choice.from?.type === "list" && choice.from.source === "draconic-ancestries") {
          if (!registryBySource.has(choice.from.source)) {
            unresolvedSources.push(`${race.id}:${choice.id}:${choice.from.source}`);
          }
        }
      }
    }

    expect(unresolvedSources).toEqual([]);
  });

  it("resolves every filtered spell-list choice to at least one eligible spell", () => {
    // Spell-list choices (kind cantrip/…) filter the spell registry by
    // classId + maxLevel. A filter that matches no spell is a data bug.
    const matchesFilter = (spell, filter = {}) => {
      if (filter.classId && !(spell.classIds ?? []).includes(filter.classId)) return false;
      if (filter.maxLevel != null && !(spell.level <= filter.maxLevel)) return false;
      if (filter.minLevel != null && !(spell.level >= filter.minLevel)) return false;
      if (filter.school && spell.school !== filter.school) return false;
      return true;
    };
    const emptyChoices = [];
    for (const entry of races) {
      for (const choice of entry.choices ?? []) {
        if (!SPELL_CHOICE_KINDS.has(choice.kind)) continue;
        if (choice.from?.source !== "spells") continue;
        const eligible = spells.filter((spell) => matchesFilter(spell, choice.from.filter));
        if (!eligible.length) emptyChoices.push(`${entry.id}:${choice.id}`);
      }
    }
    expect(emptyChoices).toEqual([]);
  });

  it("models the High Elf wizard-cantrip choice with Intelligence provenance", () => {
    const highElf = byId(races, "high-elf");
    const choice = highElf?.choices?.find((entry) => entry.id === "high-elf-cantrip");
    expect(choice).toMatchObject({
      id: "high-elf-cantrip",
      kind: "cantrip",
      count: 1,
      from: { type: "list", source: "spells", filter: { classId: "wizard", maxLevel: 0 } },
      source: "subrace:high-elf",
      spellcastingAbility: "int",
    });
    // The filter resolves to real level-0 wizard spells and nothing else.
    const eligible = spells.filter((spell) => (spell.classIds ?? []).includes("wizard") && spell.level === 0);
    expect(eligible.length).toBeGreaterThan(0);
    for (const spell of eligible) expect(spell.level).toBe(0);
  });

  it("resolves trait derivedFrom values to race choice ids", () => {
    const raceChoiceIds = choiceIdsForRaces();

    expect(
      traits
        .filter((trait) => trait.derivedFrom && !raceChoiceIds.has(trait.derivedFrom))
        .map((trait) => `${trait.id}:${trait.derivedFrom}`)
    ).toEqual([]);

    expect(byId(traits, "breath-weapon")).toMatchObject({
      derivedFrom: "dragonborn-ancestry",
    });
    expect(byId(traits, "damage-resistance")).toMatchObject({
      derivedFrom: "dragonborn-ancestry",
    });
  });

  it("resolves every race trait id to an existing trait record", () => {
    const traitIds = new Set(traits.map((trait) => trait.id));

    expect(
      races.flatMap((race) => (
        (race.traits ?? [])
          .filter((traitId) => !traitIds.has(traitId))
          .map((traitId) => `${race.id}:${traitId}`)
      ))
    ).toEqual([]);
  });

  it("uses valid draconic ancestry breath weapon shapes", () => {
    expect(
      draconicAncestries
        .filter((ancestry) => {
          const breathWeapon = ancestry.breathWeapon;
          if (breathWeapon?.shape === "line") {
            return (
              typeof breathWeapon.width !== "number"
              || typeof breathWeapon.length !== "number"
            );
          }
          if (breathWeapon?.shape === "cone") {
            return typeof breathWeapon.size !== "number";
          }
          return true;
        })
        .map((ancestry) => ancestry.id)
    ).toEqual([]);
  });

  it("uses canonical ability ids for draconic ancestry saveAbility", () => {
    expect(
      draconicAncestries
        .filter((ancestry) => !ABILITY_IDS.has(ancestry.saveAbility))
        .map((ancestry) => `${ancestry.id}:${ancestry.saveAbility}`)
    ).toEqual([]);
  });

  it("resolves every pack referenced by class/background starting equipment", () => {
    const packIds = new Set(packs.map((pack) => pack.id));

    // Walks fixed startingEquipment and every nested startingEquipmentOptions
    // shape (bare option, {items:[...]}, {itemOptions:[...]}).
    const collectItemIds = (node, out = []) => {
      if (Array.isArray(node)) {
        for (const entry of node) collectItemIds(entry, out);
        return out;
      }
      if (!node || typeof node !== "object") return out;
      if (typeof node.itemId === "string") out.push(node.itemId);
      collectItemIds(node.items, out);
      collectItemIds(node.itemOptions, out);
      collectItemIds(node.options, out);
      return out;
    };

    const referenced = [];
    for (const record of [...classes, ...backgrounds]) {
      referenced.push(
        ...collectItemIds(record.startingEquipment).map((itemId) => [record.id, itemId]),
        ...collectItemIds(record.startingEquipmentOptions).map((itemId) => [record.id, itemId])
      );
    }

    // Any "*-pack" itemId in starting equipment must exist in equipment.packs.json.
    const dangling = referenced
      .filter(([, itemId]) => itemId.endsWith("-pack") && !packIds.has(itemId))
      .map(([parentId, itemId]) => `${parentId}:${itemId}`);
    expect(dangling).toEqual([]);

    // Sanity: the reference walk actually found packs to check.
    const found = new Set(referenced.map(([, itemId]) => itemId).filter((id) => packIds.has(id)));
    expect(found.size).toBeGreaterThan(0);
  });

  it("keeps pack contents structured and free of pack self-references", () => {
    const packIds = new Set(packs.map((pack) => pack.id));
    const problems = [];

    for (const pack of packs) {
      if (!Array.isArray(pack.contents) || pack.contents.length === 0) {
        problems.push(`${pack.id}:empty-contents`);
        continue;
      }
      for (const item of pack.contents) {
        if (!ID_PATTERN.test(item.itemId ?? "")) problems.push(`${pack.id}:${item.itemId}:id`);
        if (!Number.isInteger(item.quantity) || item.quantity < 1) problems.push(`${pack.id}:${item.itemId}:qty`);
        // A pack never contains another pack (would recurse during seeding).
        if (packIds.has(item.itemId)) problems.push(`${pack.id}:${item.itemId}:nested-pack`);
      }
    }

    expect(problems).toEqual([]);
  });

  it("resolves every level a Level Up can reach to real progression features", () => {
    // Level Up walks class asiLevels, subclassLevel, and per-level feature
    // lists directly; a dangling id would surface mid-flow as a blank choice.
    const featureIds = new Set(features.map((feature) => feature.id));
    const subclassIds = new Set(subclasses.map((subclass) => subclass.id));
    const problems = [];

    for (const classEntry of classes) {
      const featuresByLevel = classEntry.featuresByLevel ?? {};
      for (const [level, ids] of Object.entries(featuresByLevel)) {
        const levelNumber = Number(level);
        if (!Number.isInteger(levelNumber) || levelNumber < 1 || levelNumber > 20) {
          problems.push(`${classEntry.id}:featuresByLevel:${level}`);
        }
        for (const featureId of ids) {
          if (!featureIds.has(featureId)) problems.push(`${classEntry.id}:${level}:${featureId}`);
        }
      }
      for (const asiLevel of classEntry.asiLevels ?? []) {
        const ids = featuresByLevel[String(asiLevel)] ?? [];
        if (!ids.length) problems.push(`${classEntry.id}:asi-level-${asiLevel}:no-features`);
      }
      if (classEntry.subclassLevel != null) {
        const ids = featuresByLevel[String(classEntry.subclassLevel)] ?? [];
        if (!ids.length) problems.push(`${classEntry.id}:subclass-level-${classEntry.subclassLevel}:no-features`);
        for (const subclassId of classEntry.subclassIds ?? []) {
          if (!subclassIds.has(subclassId)) problems.push(`${classEntry.id}:subclass:${subclassId}`);
        }
      }
    }

    for (const subclass of subclasses) {
      for (const [level, ids] of Object.entries(subclass.featuresByLevel ?? {})) {
        const levelNumber = Number(level);
        if (!Number.isInteger(levelNumber) || levelNumber < 1 || levelNumber > 20) {
          problems.push(`${subclass.id}:featuresByLevel:${level}`);
        }
        for (const featureId of ids) {
          if (!featureIds.has(featureId)) problems.push(`${subclass.id}:${level}:${featureId}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
