import { describe, expect, it } from "vitest";

import { makeDefaultCharacterOverrides } from "../js/domain/characterHelpers.js";
import { CURRENT_SCHEMA_VERSION, migrateState, sanitizeForSave } from "../js/state.js";
import v5LiveFixture from "./fixtures/saves/v5-live.json";
import v7MobileFixture from "./fixtures/saves/v7-mobile.json";

// Cross-lineage contract tests against captured real saves (see
// tests/fixtures/saves/README.md). These prove the renumbered single-lineage
// migration chain: develop's v6/v7 (stable session/inventory ids) and the
// builder's v8/v9/v10 (build/overrides, manual feature cards, feature uses)
// all materialize regardless of which shipped build produced the save.

function cloneFixture(value) {
  return structuredClone(value);
}

describe("captured save fixtures migrate to the merged schema", () => {
  it("upgrades a real v7 mobile save with builder defaults while preserving stable ids", () => {
    const fixture = cloneFixture(v7MobileFixture);
    const originalSessionIds = fixture.tracker.sessions.map((session) => session.id);
    const originalInventoryIds = fixture.characters.entries[0].inventoryItems.map((item) => item.id);
    const originalParticipantIds = fixture.combat.encounter.participants.map((participant) => participant.id);

    const migrated = migrateState(cloneFixture(v7MobileFixture));

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe(13);

    // develop's v6/v7 stable ids were already present and must survive untouched.
    expect(migrated.tracker.sessions.map((session) => session.id)).toEqual(originalSessionIds);
    expect(migrated.characters.entries[0].inventoryItems.map((item) => item.id)).toEqual(originalInventoryIds);
    expect(migrated.combat.encounter.participants.map((participant) => participant.id)).toEqual(originalParticipantIds);

    // builder's v8/v9/v10 defaults materialize on the freeform character.
    for (const entry of migrated.characters.entries) {
      expect(entry.build).toBeNull();
      expect(entry.overrides).toEqual(makeDefaultCharacterOverrides());
      expect(entry.manualFeatureCards).toEqual([]);
      expect(entry.featureUses).toEqual({});
      expect(entry.rest).toEqual({ hitDiceSpent: {}, preparedByClass: {} });
      expect(entry.deathSaves).toEqual({ successes: 0, failures: 0 });
    }

    // Freeform fields pass through unchanged.
    expect(migrated.characters.activeId).toBe(v7MobileFixture.characters.activeId);
    expect(migrated.characters.entries[0].name).toBe(v7MobileFixture.characters.entries[0].name);
    expect(migrated.characters.entries[0].ac).toBe(v7MobileFixture.characters.entries[0].ac);
    expect(migrated.tracker.npcs).toHaveLength(v7MobileFixture.tracker.npcs.length);
  });

  it("upgrades a real v5 live-site save with every post-v5 migration", () => {
    const migrated = migrateState(cloneFixture(v5LiveFixture));

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    // v6: sessions gain stable ids (the capture already carried ids from the
    // live build's normalization — every session must have a unique string id).
    const sessionIds = migrated.tracker.sessions.map((session) => session.id);
    expect(sessionIds.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(sessionIds).size).toBe(sessionIds.length);

    // v7: inventory items gain stable unique ids.
    for (const entry of migrated.characters.entries) {
      const inventoryIds = entry.inventoryItems.map((item) => item.id);
      expect(inventoryIds.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
      expect(new Set(inventoryIds).size).toBe(inventoryIds.length);
      expect(entry.inventoryItems).toHaveLength(v5LiveFixture.characters.entries[0].inventoryItems.length);
    }

    // v8/v9/v10: builder fields materialize without touching freeform data.
    for (const entry of migrated.characters.entries) {
      expect(entry.build).toBeNull();
      expect(entry.overrides).toEqual(makeDefaultCharacterOverrides());
      expect(entry.manualFeatureCards).toEqual([]);
      expect(entry.featureUses).toEqual({});
    }

    // v5 fields and freeform content pass through unchanged.
    expect(migrated.characters.entries[0].name).toBe(v5LiveFixture.characters.entries[0].name);
    expect(migrated.characters.entries[0].hpMax).toBe(v5LiveFixture.characters.entries[0].hpMax);
    expect(migrated.tracker.party[0].characterId).toBe(v5LiveFixture.tracker.party[0].characterId);
    expect(migrated.tracker.npcs).toHaveLength(v5LiveFixture.tracker.npcs.length);
    expect(migrated.tracker.sessions).toHaveLength(v5LiveFixture.tracker.sessions.length);
  });

  it("round-trips both fixtures through sanitizeForSave + migrateState without drift", () => {
    for (const fixture of [v5LiveFixture, v7MobileFixture]) {
      const once = sanitizeForSave(migrateState(cloneFixture(fixture)));
      const twice = sanitizeForSave(migrateState(structuredClone(once)));
      expect(twice).toEqual(once);
      expect(twice.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    }
  });
});
