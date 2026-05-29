import { describe, expect, it } from "vitest";

import { migrateState, sanitizeForSave, CURRENT_SCHEMA_VERSION } from "../js/state.js";

const EMPTY_CHARACTERS = { activeId: null, entries: [] };

/** Returns the first (and only) character entry from a migrated state. */
function activeEntry(state) {
  return state.characters?.entries?.[0] ?? null;
}

describe("migrateToV4 — legacy singleton → characters collection", () => {
  it("wraps a meaningful legacy character into an entry with a generated id", () => {
    const migrated = migrateState({ character: { name: "Arlen", classLevel: "Fighter 3" } });

    expect(migrated.characters).toBeDefined();
    expect(migrated.characters.entries).toHaveLength(1);
    expect(migrated.characters.activeId).toBeTruthy();
    const entry = activeEntry(migrated);
    expect(entry.id).toBe(migrated.characters.activeId);
    expect(entry.name).toBe("Arlen");
    expect(entry.classLevel).toBe("Fighter 3");
    expect(migrated.character).toBeUndefined();
  });

  it("produces EMPTY_CHARACTERS when the legacy character has no meaningful data", () => {
    const migrated = migrateState({ character: {} });

    expect(migrated.characters).toEqual(EMPTY_CHARACTERS);
    expect(migrated.character).toBeUndefined();
  });

  it("produces EMPTY_CHARACTERS when there is no legacy character key at all", () => {
    const migrated = migrateState({});

    expect(migrated.characters).toEqual(EMPTY_CHARACTERS);
    expect(migrated.character).toBeUndefined();
  });

  it("considers a character with hpCur/hpMax meaningful", () => {
    const migrated = migrateState({ character: { hpCur: 0, hpMax: 10 } });

    expect(migrated.characters.entries).toHaveLength(1);
    expect(activeEntry(migrated).hpMax).toBe(10);
  });

  it("considers a character with non-empty inventoryItems notes meaningful", () => {
    const migrated = migrateState({
      character: { inventoryItems: [{ title: "Inventory", notes: "50 ft. rope" }] }
    });

    expect(migrated.characters.entries).toHaveLength(1);
  });

  it("treats a single inventory item with the default title and empty notes as NOT meaningful", () => {
    const migrated = migrateState({
      character: { inventoryItems: [{ title: "Inventory", notes: "" }] }
    });

    expect(migrated.characters).toEqual(EMPTY_CHARACTERS);
  });

  it("considers a character with an imgBlobId meaningful", () => {
    const migrated = migrateState({ character: { imgBlobId: "blob_abc123" } });

    expect(migrated.characters.entries).toHaveLength(1);
    expect(activeEntry(migrated).imgBlobId).toBe("blob_abc123");
  });

  it("considers a character with non-empty spells.levels meaningful", () => {
    const migrated = migrateState({
      character: { spells: { levels: [{ level: 1, slots: 2, spells: [] }] } }
    });

    expect(migrated.characters.entries).toHaveLength(1);
  });

  it("considers a character with an ability score meaningful", () => {
    const migrated = migrateState({
      character: { abilities: { str: { score: 16, mod: 3, save: 3 } } }
    });

    expect(migrated.characters.entries).toHaveLength(1);
  });
});

describe("migrateToV4 — already-migrated state passes through safely", () => {
  it("preserves an existing characters collection without re-wrapping", () => {
    const existing = { activeId: "char_a", entries: [{ id: "char_a", name: "Mira" }] };
    const migrated = migrateState({ characters: existing });

    expect(migrated.characters.entries).toHaveLength(1);
    expect(migrated.characters.activeId).toBe("char_a");
    expect(activeEntry(migrated).name).toBe("Mira");
  });

  it("removes a stale character key when characters already exists", () => {
    const migrated = migrateState({
      characters: { activeId: "char_a", entries: [{ id: "char_a", name: "Mira" }] },
      character: { name: "Stale ghost" }
    });

    expect(migrated.character).toBeUndefined();
    expect(migrated.characters.entries).toHaveLength(1);
    expect(activeEntry(migrated).name).toBe("Mira");
  });

  it("repairs a bad activeId that points to no entry", () => {
    const migrated = migrateState({
      characters: {
        activeId: "char_missing",
        entries: [{ id: "char_a", name: "Kira" }]
      }
    });

    expect(migrated.characters.activeId).toBe("char_a");
  });

  it("sets activeId to null when entries is empty and activeId is dangling", () => {
    const migrated = migrateState({
      characters: { activeId: "char_missing", entries: [] }
    });

    expect(migrated.characters.activeId).toBeNull();
  });

  it("normalizes a non-string, non-null activeId to null", () => {
    const migrated = migrateState({
      characters: { activeId: 999, entries: [] }
    });

    expect(migrated.characters.activeId).toBeNull();
  });

  it("repairs missing or duplicate entry ids in an existing characters collection", () => {
    const migrated = migrateState({
      characters: {
        activeId: "char_dup",
        entries: [
          { id: "char_dup", name: "First" },
          { id: "", name: "Missing" },
          { id: "char_dup", name: "Duplicate" }
        ]
      }
    });

    const ids = migrated.characters.entries.map((entry) => entry.id);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe("char_dup");
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => typeof id === "string" && id.startsWith("char_"))).toBe(true);
    expect(migrated.characters.activeId).toBe("char_dup");
  });
});

describe("schema version", () => {
  it("always sets schemaVersion to the current version after migration", () => {
    const fromLegacy = migrateState({ character: { name: "Arlen" } });
    expect(fromLegacy.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe(7);

    const fromEmpty = migrateState({});
    expect(fromEmpty.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe("migrateToV5 — character-linked tracker card fields", () => {
  it("adds characterId to NPC and Party cards and status to character entries", () => {
    const migrated = migrateState({
      schemaVersion: 4,
      tracker: {
        npcs: [{ id: "npc_1", name: "Mira" }],
        party: [{ id: "party_1", name: "Arlen" }],
        locationsList: [{ id: "loc_1", title: "Docks" }]
      },
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Arlen" }]
      }
    });

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.tracker.npcs[0].characterId).toBeNull();
    expect(migrated.tracker.party[0].characterId).toBeNull();
    expect(migrated.tracker.locationsList[0].characterId).toBeUndefined();
    expect(migrated.characters.entries[0].status).toBe("");
  });

  it("preserves existing linked ids and character status values", () => {
    const migrated = migrateState({
      schemaVersion: 4,
      tracker: {
        npcs: [{ id: "npc_1", characterId: "char_a", name: "Fallback" }],
        party: [{ id: "party_1", characterId: "char_a", name: "Fallback" }]
      },
      characters: {
        activeId: "char_a",
        entries: [{ id: "char_a", name: "Arlen", status: "Poisoned" }]
      }
    });

    expect(migrated.tracker.npcs[0].characterId).toBe("char_a");
    expect(migrated.tracker.party[0].characterId).toBe("char_a");
    expect(migrated.characters.entries[0].status).toBe("Poisoned");
  });
});

describe("round-trip stability", () => {
  it("migrate → sanitize → migrate produces the same characters collection", () => {
    const legacy = { character: { name: "Arlen", hpMax: 20 } };
    const first = migrateState(legacy);
    const sanitized = sanitizeForSave(first);
    const second = migrateState(sanitized);

    expect(second.characters.entries).toHaveLength(1);
    expect(second.characters.activeId).toBe(first.characters.activeId);
    const entry = second.characters.entries[0];
    expect(entry.id).toBe(first.characters.activeId);
    expect(entry.name).toBe("Arlen");
    expect(entry.hpMax).toBe(20);
    expect(entry.status).toBe("");
  });

  it("round-tripping an already-current state is stable", () => {
    const migrated = migrateState({
      characters: { activeId: "char_a", entries: [{ id: "char_a", name: "Mira" }] },
      tracker: { npcs: [{ id: "npc_1", name: "Scout" }], party: [{ id: "party_1", name: "Tess" }] }
    });
    const sanitized = sanitizeForSave(migrated);
    const again = migrateState(sanitized);

    expect(again.characters.entries).toHaveLength(1);
    expect(again.characters.activeId).toBe("char_a");
    expect(activeEntry(again).name).toBe("Mira");
    expect(activeEntry(again).status).toBe("");
    expect(again.tracker.npcs[0].characterId).toBeNull();
    expect(again.tracker.party[0].characterId).toBeNull();
  });

  it("round-tripping an empty-character state stays empty", () => {
    const migrated = migrateState({ character: {} });
    expect(migrated.characters).toEqual(EMPTY_CHARACTERS);

    const sanitized = sanitizeForSave(migrated);
    const again = migrateState(sanitized);
    expect(again.characters).toEqual(EMPTY_CHARACTERS);
  });
});
