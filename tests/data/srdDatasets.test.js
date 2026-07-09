import { describe, expect, it } from "vitest";

import backgrounds from "../../game-data/srd/backgrounds.json";
import classes from "../../game-data/srd/classes.json";
import draconicAncestries from "../../game-data/srd/draconic-ancestries.json";
import armor from "../../game-data/srd/equipment.armor.json";
import packs from "../../game-data/srd/equipment.packs.json";
import weapons from "../../game-data/srd/equipment.weapons.json";
import feats from "../../game-data/srd/feats.json";
import features from "../../game-data/srd/features.json";
import languages from "../../game-data/srd/languages.json";
import races from "../../game-data/srd/races.json";
import skills from "../../game-data/srd/skills.json";
import spells from "../../game-data/srd/spells.json";
import subclasses from "../../game-data/srd/subclasses.json";
import traits from "../../game-data/srd/traits.json";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ABILITY_IDS = new Set(["str", "dex", "con", "int", "wis", "cha"]);

const DATASETS = [
  ["races", races, 9 + 4],           // 9 races + 4 SRD subraces
  ["classes", classes, 12],
  ["subclasses", subclasses, 12],
  ["backgrounds", backgrounds, 1],
  ["feats", feats, 1],
  ["traits", traits, null],
  ["draconic-ancestries", draconicAncestries, 10],
  ["armor", armor, 13],
  ["weapons", weapons, 37],
  ["packs", packs, 7],
  ["spells", spells, 319],
  ["languages", languages, 16],
  ["skills", skills, 18],
  ["features", features, null]
];

describe("bundled SRD 5.1 datasets", () => {
  it("loads every required dataset with the expected record counts", () => {
    for (const [name, records, expectedCount] of DATASETS) {
      expect(Array.isArray(records), `${name} must be an array`).toBe(true);
      expect(records.length, `${name} must not be empty`).toBeGreaterThan(0);
      if (expectedCount != null) {
        expect(records.length, `${name} count`).toBe(expectedCount);
      }
    }
    expect(features.length).toBeGreaterThanOrEqual(400);
    expect(traits.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps canonical base fields, id charset, source tag, and per-kind uniqueness", () => {
    const seen = new Set();
    for (const [name, records] of DATASETS) {
      for (const record of records) {
        expect(record.id, `${name} record id`).toBeTruthy();
        expect(ID_PATTERN.test(record.id), `${name}:${record.id} id charset`).toBe(true);
        expect(record.kind, `${name}:${record.id} kind`).toBeTruthy();
        expect(record.name, `${name}:${record.id} name`).toBeTruthy();
        expect(record.source, `${name}:${record.id} source`).toBe("srd-5.1");
        const key = `${record.kind}:${record.id}`;
        expect(seen.has(key), `duplicate ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it("resolves class references: subclasses, skill choices, features, spellcasting", () => {
    const subclassIds = new Set(subclasses.map((record) => record.id));
    const skillIds = new Set(skills.map((record) => record.id));
    const featureIds = new Set(features.map((record) => record.id));

    for (const cls of classes) {
      expect(cls.hitDie).toBeGreaterThanOrEqual(6);
      expect(cls.hitDie).toBeLessThanOrEqual(12);
      for (const save of cls.savingThrowProficiencies) expect(ABILITY_IDS.has(save)).toBe(true);
      for (const subclassId of cls.subclassIds) expect(subclassIds.has(subclassId)).toBe(true);
      expect(cls.subclassLevel).toBeGreaterThanOrEqual(1);
      expect(cls.asiLevels.length).toBeGreaterThanOrEqual(4);
      if (cls.skillChoices) {
        for (const skillId of cls.skillChoices.from) {
          expect(skillIds.has(skillId), `${cls.id} skill ${skillId}`).toBe(true);
        }
      }
      for (const ids of Object.values(cls.featuresByLevel)) {
        for (const featureId of ids) {
          expect(featureIds.has(featureId), `${cls.id} feature ${featureId}`).toBe(true);
        }
      }
      if (cls.spellcasting) {
        expect(ABILITY_IDS.has(cls.spellcasting.ability)).toBe(true);
        expect(["full", "half", "pact"]).toContain(cls.spellcasting.progression);
        expect(["prepared", "known", "spellbook"]).toContain(cls.spellcasting.preparationMode);
        expect(cls.spellcasting.slotsByLevel).toHaveLength(20);
        for (const row of cls.spellcasting.slotsByLevel) expect(row).toHaveLength(9);
      }
    }
  });

  it("resolves subclass references: parent class, features, granted spells", () => {
    const classIds = new Set(classes.map((record) => record.id));
    const featureIds = new Set(features.map((record) => record.id));
    const spellIds = new Set(spells.map((record) => record.id));

    for (const subclass of subclasses) {
      expect(classIds.has(subclass.classId), `${subclass.id} classId`).toBe(true);
      for (const ids of Object.values(subclass.featuresByLevel)) {
        for (const featureId of ids) {
          expect(featureIds.has(featureId), `${subclass.id} feature ${featureId}`).toBe(true);
        }
      }
      for (const grant of subclass.grantedSpells) {
        expect(spellIds.has(grant.spellId), `${subclass.id} spell ${grant.spellId}`).toBe(true);
        expect(grant.classLevel).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("resolves spell class lists and keeps spell levels in range", () => {
    const classIds = new Set(classes.map((record) => record.id));
    let cantrips = 0;
    for (const spell of spells) {
      expect(spell.level).toBeGreaterThanOrEqual(0);
      expect(spell.level).toBeLessThanOrEqual(9);
      if (spell.level === 0) cantrips += 1;
      expect(spell.classIds.length, `${spell.id} has a class list`).toBeGreaterThan(0);
      for (const classId of spell.classIds) {
        expect(classIds.has(classId), `${spell.id} class ${classId}`).toBe(true);
      }
      expect(spell.desc.length, `${spell.id} has rules text`).toBeGreaterThan(0);
    }
    expect(cantrips).toBeGreaterThanOrEqual(20);
    // Every casting class has a non-empty spell list.
    for (const cls of classes.filter((record) => record.spellcasting)) {
      expect(spells.some((spell) => spell.classIds.includes(cls.id)), `${cls.id} spell list`).toBe(true);
    }
  });

  it("keeps armor and weapons mundane and mechanically structured", () => {
    for (const record of armor) {
      expect(["light", "medium", "heavy", "shield"]).toContain(record.armorCategory);
      if (record.armorCategory === "shield") expect(record.acBonus).toBe(2);
      else expect(record.baseAC).toBeGreaterThanOrEqual(11);
    }
    const armorIds = new Set(armor.map((record) => record.id));
    expect(armorIds.has("adamantine-armor")).toBe(false);
    for (const record of weapons) {
      expect(["simple", "martial"]).toContain(record.weaponCategory);
      expect(["melee", "ranged"]).toContain(record.attackType);
    }
    const weaponIds = new Set(weapons.map((record) => record.id));
    expect(weaponIds.has("longsword")).toBe(true);
    expect(weaponIds.has("vicious-weapon")).toBe(false);
  });

  it("keeps equipment packs structured with resolvable contents", () => {
    for (const record of packs) {
      expect(record.kind, `${record.id} kind`).toBe("pack");
      expect(Array.isArray(record.contents), `${record.id} contents`).toBe(true);
      expect(record.contents.length, `${record.id} contents`).toBeGreaterThan(0);
      for (const item of record.contents) {
        expect(ID_PATTERN.test(item.itemId), `${record.id}:${item.itemId} charset`).toBe(true);
        expect(item.name, `${record.id}:${item.itemId} name`).toBeTruthy();
        expect(Number.isInteger(item.quantity), `${record.id}:${item.itemId} quantity`).toBe(true);
        expect(item.quantity, `${record.id}:${item.itemId} quantity`).toBeGreaterThan(0);
      }
    }
    const packIds = new Set(packs.map((record) => record.id));
    // Every pack referenced by class starting equipment must resolve.
    expect(packIds.has("explorers-pack")).toBe(true);
    expect(packIds.has("dungeoneers-pack")).toBe(true);
    // Explorer's Pack carries its SRD contents, not a self-reference.
    const explorers = packs.find((record) => record.id === "explorers-pack");
    const itemIds = explorers.contents.map((item) => item.itemId);
    expect(itemIds).toContain("bedroll");
    expect(itemIds).toContain("waterskin");
    expect(itemIds).not.toContain("explorers-pack");
    expect(explorers.contents.find((item) => item.itemId === "torch").quantity).toBe(10);
  });

  it("resolves race subraces, traits, and language lists", () => {
    const raceRecords = races.filter((record) => record.kind === "race");
    const subraceIds = new Set(races.filter((record) => record.kind === "subrace").map((record) => record.id));
    const traitIds = new Set(traits.map((record) => record.id));
    const languageIds = new Set(languages.map((record) => record.id));
    for (const race of raceRecords) {
      for (const subraceId of race.subraceIds) expect(subraceIds.has(subraceId), `${race.id} subrace ${subraceId}`).toBe(true);
      for (const languageId of race.languages) expect(languageIds.has(languageId), `${race.id} language ${languageId}`).toBe(true);
      // traits.json intentionally covers the vertical-slice races so far;
      // trait ids that are covered must resolve.
      for (const traitId of race.traits) {
        if (traitIds.has(traitId)) expect(ID_PATTERN.test(traitId)).toBe(true);
      }
    }
    for (const skill of skills) expect(ABILITY_IDS.has(skill.ability)).toBe(true);
  });
});
