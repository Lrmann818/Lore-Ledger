import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, migrateState, sanitizeForSave } from "../js/state.js";

// Contract suite over every captured save fixture (see
// tests/fixtures/saves/README.md). Any save any shipped build has ever
// written must load through migrateState + sanitizeForSave on the merged
// single-lineage schema. Drop a new fixture into tests/fixtures/saves/ and it
// is covered automatically — no test edits required.
const fixtureModules = import.meta.glob("./fixtures/saves/*.json", { eager: true });
const fixtures = Object.entries(fixtureModules).map(([path, module]) => ({
  name: path.split("/").pop(),
  doc: /** @type {{ default: Record<string, unknown> }} */ (module).default
}));

const BUILDER_ENTRY_KEYS = ["build", "overrides", "manualFeatureCards", "featureUses", "rest", "deathSaves"];

function clone(value) {
  return structuredClone(value);
}

function characterEntries(state) {
  return Array.isArray(state?.characters?.entries) ? state.characters.entries : [];
}

describe("save compatibility contract (all captured fixtures)", () => {
  it("found the captured fixtures", () => {
    const names = fixtures.map((fixture) => fixture.name);
    expect(names).toContain("v5-live.json");
    expect(names).toContain("v7-mobile.json");
    expect(names).toContain("v10-merged.json");
  });

  it.each(fixtures)("$name migrates to the current schema version", ({ doc }) => {
    const migrated = migrateState(clone(doc));
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it.each(fixtures)("$name round-trips migrate -> sanitize -> migrate without drift", ({ doc }) => {
    const once = sanitizeForSave(migrateState(clone(doc)));
    const twice = sanitizeForSave(migrateState(structuredClone(once)));
    expect(twice).toEqual(once);
  });

  it.each(fixtures)("$name materializes every builder field on every character entry", ({ doc }) => {
    const migrated = migrateState(clone(doc));
    for (const entry of characterEntries(migrated)) {
      for (const key of BUILDER_ENTRY_KEYS) {
        expect(entry, `entry missing ${key}`).toHaveProperty(key);
      }
      expect(Array.isArray(entry.manualFeatureCards)).toBe(true);
      expect(entry.featureUses && typeof entry.featureUses === "object").toBe(true);
    }
  });

  it.each(fixtures)("$name ends up with unique stable session and inventory ids", ({ doc }) => {
    const migrated = migrateState(clone(doc));
    const sessionIds = (migrated.tracker?.sessions || []).map((session) => session.id);
    expect(sessionIds.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(sessionIds).size).toBe(sessionIds.length);
    for (const entry of characterEntries(migrated)) {
      const inventoryIds = (entry.inventoryItems || []).map((item) => item.id);
      expect(inventoryIds.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
      expect(new Set(inventoryIds).size).toBe(inventoryIds.length);
    }
  });

  it.each(fixtures)("$name preserves campaign content counts through migration", ({ doc }) => {
    const migrated = migrateState(clone(doc));
    expect(migrated.tracker.sessions).toHaveLength(doc.tracker.sessions.length);
    expect(migrated.tracker.npcs).toHaveLength(doc.tracker.npcs.length);
    expect(migrated.tracker.party).toHaveLength(doc.tracker.party.length);
    expect(migrated.tracker.locationsList).toHaveLength(doc.tracker.locationsList.length);
    expect(migrated.characters.entries).toHaveLength(doc.characters.entries.length);
  });
});

describe("freeform characters are untouched by builder migrations", () => {
  // The strongest guard the review asked for: on an already-id-stable v7 save,
  // the additive character migrations may ONLY add their owned keys. Every
  // pre-existing freeform field must survive deep-equal.
  it("a freeform v7 character gains exactly the owned migration keys and nothing else changes", () => {
    const fixture = fixtures.find((entry) => entry.name === "v7-mobile.json");
    expect(fixture).toBeTruthy();
    const original = clone(fixture.doc.characters.entries[0]);
    expect(original.build).toBeUndefined();

    const migrated = migrateState(clone(fixture.doc));
    const migratedEntry = clone(characterEntries(migrated)[0]);

    const addedKeys = Object.keys(migratedEntry).filter((key) => !(key in original));
    expect(addedKeys.sort()).toEqual([...BUILDER_ENTRY_KEYS].sort());
    expect(migratedEntry.build).toBeNull();

    for (const key of BUILDER_ENTRY_KEYS) delete migratedEntry[key];
    expect(migratedEntry).toEqual(original);
  });

  it("an already-current v10 freeform character gains only later owned migration state", () => {
    const fixture = fixtures.find((entry) => entry.name === "v10-merged.json");
    expect(fixture).toBeTruthy();
    const original = clone(fixture.doc.characters.entries[0]);
    expect(original.build).toBeNull();

    const migrated = migrateState(clone(fixture.doc));
    expect(characterEntries(migrated)[0]).toEqual({
      ...original,
      rest: { hitDiceSpent: {}, preparedByClass: {} },
      deathSaves: { successes: 0, failures: 0 }
    });
  });
});
