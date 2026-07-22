// Restore Character phase R2 — the non-UI restore engine.
//
// Covers snapshot resolution, pure restore preparation (migrate-through, new
// identity, spell-row id regeneration, naming), the staged commit protocol
// (portrait/note staging, rollback, double-commit guard), and persistence
// round trips. The R1 capture/normalization behavior is covered in
// tests/characterSnapshots.test.js; the Restore Character UI is phase R3 and
// does not exist yet.

import { describe, expect, it } from "vitest";

import {
  PRE_LEVEL_UP_SNAPSHOT_KIND,
  RESTORED_CHARACTER_FALLBACK_NAME,
  buildPreLevelUpSnapshot,
  commitRestoredCharacter,
  getCharacterSnapshotById,
  prepareRestoredCharacter,
  resolveRestoredCharacterName,
  restoreCharacterFromSnapshot
} from "../js/domain/characterSnapshots.js";
import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { textKey_spellNotes } from "../js/storage/texts-idb.js";
import { CURRENT_SCHEMA_VERSION, migrateState, sanitizeForSave } from "../js/state.js";
import {
  normalizeCampaignVault,
  persistRuntimeStateToVault,
  projectActiveCampaignState,
  replaceRuntimeState
} from "../js/storage/campaignVault.js";

const CAMPAIGN_ID = "camp_restore";
const NOW = () => "2026-07-19T10:00:00.000Z";

function makeSourceCharacter() {
  const entry = makeDefaultBuilderCharacterEntry("Gail");
  entry.id = "char_src";
  entry.imgBlobId = "blob_src_portrait";
  entry.build.raceId = "human";
  entry.build.backgroundId = "acolyte";
  entry.build.levels = [{ classId: "ranger", hp: null }, { classId: "ranger", hp: 6 }];
  entry.hpMax = 18;
  entry.hpCur = 11;
  entry.attacks = [{
    id: "atk_1",
    name: "Longbow",
    builderSeed: "weapon:longbow",
    calc: { mode: "derived", weaponId: "longbow", ability: "dex" },
    notes: "keep my notes"
  }];
  entry.resources = [{ id: "res_1", name: "Focus Points", cur: 2, max: 3 }];
  entry.featureUses = { "feature-x": { current: 1 } };
  entry.manualFeatureCards = [{
    id: "feature_card_1",
    name: "Custom Card",
    sourceType: "Feat",
    activation: "Action",
    rangeArea: "Self",
    saveDc: "",
    damageEffect: "1d6",
    description: "A manual card."
  }];
  entry.inventoryItems = [{ id: "inv_1", title: "Inventory", notes: "50 ft rope" }];
  entry.spells = {
    levels: [
      {
        id: "spellLevel_cantrips",
        label: "Cantrips",
        hasSlots: false,
        used: null,
        total: null,
        collapsed: false,
        spells: [
          { id: "spell_row_a", name: "Fire Bolt", notesCollapsed: true, known: true, prepared: false, expended: false, builderSpellId: "fire-bolt", builderSeed: "spell:fire-bolt" }
        ]
      },
      {
        id: "spellLevel_first",
        label: "1st Level",
        hasSlots: true,
        used: 2,
        total: 3,
        collapsed: false,
        spells: [
          { id: "spell_row_b", name: "Cure Wounds", notesCollapsed: true, known: true, prepared: true, expended: false, builderSpellId: "cure-wounds" },
          { id: "spell_row_c", name: "Hunter's Mark", notesCollapsed: true, known: true, prepared: false, expended: false },
          { id: "spell_row_d", name: "Cure Wounds", notesCollapsed: true, known: true, prepared: false, expended: false, builderSpellId: "cure-wounds" }
        ]
      }
    ]
  };
  return entry;
}

function makeSnapshotOf(character, overrides = {}) {
  const record = buildPreLevelUpSnapshot({
    character,
    toClassId: "ranger",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    now: () => "2026-07-18T12:00:00.000Z"
  });
  return { ...record, id: "csnap_1", ...overrides };
}

function makeRestoreState() {
  const state = migrateState(undefined);
  state.appShell = { activeCampaignId: CAMPAIGN_ID };
  state.tracker.campaignTitle = "Restore Campaign";
  const source = makeSourceCharacter();
  const snapshot = makeSnapshotOf(source);
  state.characters.entries = [source];
  state.characters.activeId = "char_src";
  state.characters.snapshots = [snapshot];
  return { state, source, snapshot };
}

function makeStores({ blobs, texts } = {}) {
  const blobStore = new Map(Object.entries(blobs ?? { blob_src_portrait: { data: "portrait-bytes" } }));
  const textStore = new Map(Object.entries(texts ?? {
    [textKey_spellNotes(CAMPAIGN_ID, "spell_row_b")]: "Source cure notes",
    [textKey_spellNotes(CAMPAIGN_ID, "spell_row_d")]: "Duplicate-row notes"
  }));
  let blobSeq = 0;
  return {
    blobStore,
    textStore,
    deps: {
      getBlob: async (id) => blobStore.get(id) ?? null,
      putBlob: async (blob) => {
        blobSeq += 1;
        const id = `blob_copy_${blobSeq}`;
        blobStore.set(id, blob);
        return id;
      },
      deleteBlob: async (id) => { blobStore.delete(id); },
      getText: async (id) => textStore.get(id) ?? "",
      putText: async (text, id) => { textStore.set(id, text); return id; },
      deleteText: async (id) => { textStore.delete(id); }
    }
  };
}

function makeCommitDeps(state, stores, overrides = {}) {
  const counters = { markDirty: 0 };
  const deps = {
    state,
    SaveManager: { markDirty: () => { counters.markDirty += 1; } },
    mutateState: (mutator) => mutator(state),
    ...stores.deps,
    ...overrides
  };
  return { deps, counters };
}

// Commit deps that count every external-store call and state mutation, for
// asserting that aborted commits touch nothing.
function makeCountingDeps(state, stores, overrides = {}) {
  const calls = { getBlob: 0, putBlob: 0, deleteBlob: 0, getText: 0, putText: 0, deleteText: 0, mutate: 0 };
  const base = stores.deps;
  const made = makeCommitDeps(state, stores, {
    getBlob: async (id) => { calls.getBlob += 1; return base.getBlob(id); },
    putBlob: async (blob) => { calls.putBlob += 1; return base.putBlob(blob); },
    deleteBlob: async (id) => { calls.deleteBlob += 1; return base.deleteBlob(id); },
    getText: async (id) => { calls.getText += 1; return base.getText(id); },
    putText: async (text, id) => { calls.putText += 1; return base.putText(text, id); },
    deleteText: async (id) => { calls.deleteText += 1; return base.deleteText(id); },
    mutateState: (mutator) => { calls.mutate += 1; return mutator(state); },
    ...overrides
  });
  return { ...made, calls };
}

const NO_EXTERNAL_CALLS = Object.freeze({
  getBlob: 0, putBlob: 0, deleteBlob: 0, getText: 0, putText: 0, deleteText: 0, mutate: 0
});

function prepare(state, snapshot, overrides = {}) {
  return prepareRestoredCharacter({
    snapshot,
    existingCharacters: state.characters.entries,
    existingSnapshots: state.characters.snapshots,
    migrateState,
    now: NOW,
    ...overrides
  });
}

describe("getCharacterSnapshotById", () => {
  it("resolves a snapshot by id and returns null for anything else", () => {
    const { state, snapshot } = makeRestoreState();
    expect(getCharacterSnapshotById(state.characters.snapshots, "csnap_1")).toBe(snapshot);
    expect(getCharacterSnapshotById(state.characters.snapshots, "csnap_missing")).toBeNull();
    expect(getCharacterSnapshotById(state.characters.snapshots, "")).toBeNull();
    expect(getCharacterSnapshotById(state.characters.snapshots, null)).toBeNull();
    expect(getCharacterSnapshotById(null, "csnap_1")).toBeNull();
    expect(getCharacterSnapshotById([null, "junk", { id: "csnap_1" }], "csnap_1")).toEqual({ id: "csnap_1" });
  });
});

describe("resolveRestoredCharacterName", () => {
  it("keeps a free base name and suffixes on collision, case-insensitive and trimmed", () => {
    expect(resolveRestoredCharacterName("Gail — Restored Level 2", [])).toBe("Gail — Restored Level 2");
    expect(resolveRestoredCharacterName("Gail — Restored Level 2", ["  gail — restored level 2  "]))
      .toBe("Gail — Restored Level 2 (2)");
    expect(resolveRestoredCharacterName("Gail — Restored Level 2", [
      "Gail — Restored Level 2",
      "Gail — Restored Level 2 (2)",
      "GAIL — RESTORED LEVEL 2 (3)"
    ])).toBe("Gail — Restored Level 2 (4)");
  });

  it("falls back to the shared unnamed-character label for blank bases", () => {
    expect(resolveRestoredCharacterName("", [])).toBe(RESTORED_CHARACTER_FALLBACK_NAME);
    expect(resolveRestoredCharacterName("   ", [RESTORED_CHARACTER_FALLBACK_NAME]))
      .toBe(`${RESTORED_CHARACTER_FALLBACK_NAME} (2)`);
  });
});

describe("prepareRestoredCharacter — validation", () => {
  it("rejects absent snapshots, bad identity fields, unsupported kinds, and bad payloads", () => {
    const { state, snapshot } = makeRestoreState();
    const attempt = (record) => () => prepare(state, record);

    expect(attempt(null)).toThrow(/No snapshot to restore/);
    expect(attempt({ ...snapshot, id: " " })).toThrow(/missing its id/);
    expect(attempt({ ...snapshot, kind: "post-rest" })).toThrow(/Unsupported snapshot kind "post-rest"/);
    expect(attempt({ ...snapshot, sourceCharacterId: "" })).toThrow(/source character id/);
    expect(attempt({ ...snapshot, payload: null })).toThrow(/payload is missing or malformed/);
    expect(attempt({ ...snapshot, payload: "junk" })).toThrow(/payload is missing or malformed/);
    expect(attempt({ ...snapshot, payload: [1, 2] })).toThrow(/payload is missing or malformed/);
  });

  it("requires the injected canonical migrateState", () => {
    const { snapshot } = makeRestoreState();
    expect(() => prepareRestoredCharacter({ snapshot, existingCharacters: [] }))
      .toThrow(/migrateState is required/);
  });

  it("rejects snapshots with no usable pre-Level-Up level", () => {
    const { state, snapshot } = makeRestoreState();
    const record = {
      ...snapshot,
      fromLevel: null,
      payload: { id: "char_src", name: "Gail", build: null }
    };
    expect(() => prepare(state, record)).toThrow(/no usable pre-Level-Up level/);
  });
});

describe("prepareRestoredCharacter — preparation", () => {
  it("prepares a restored copy with new identity, provenance, naming, and a note-copy plan", () => {
    const { state, snapshot } = makeRestoreState();
    const staged = prepare(state, snapshot);

    expect(staged.character.id).toMatch(/^char_/);
    expect(staged.character.id).not.toBe("char_src");
    expect(staged.character.name).toBe("Gail — Restored Level 2");
    expect(staged.nameBase).toBe("Gail — Restored Level 2");
    expect(staged.sourceSnapshotId).toBe("csnap_1");
    expect(staged.sourceCharacterId).toBe("char_src");
    expect(staged.character.restoredFromSnapshotId).toBe("csnap_1");
    expect(staged.character.restoredFromCharacterId).toBe("char_src");
    expect(staged.character.restoredAt).toBe(NOW());
    expect(staged.provenance).toEqual({
      restoredFromSnapshotId: "csnap_1",
      restoredFromCharacterId: "char_src",
      restoredAt: NOW()
    });

    // Portrait plan: imgBlobId stays null until the commit stages the copy.
    expect(staged.character.imgBlobId).toBeNull();
    expect(staged.portraitCopy).toEqual({ sourceBlobId: "blob_src_portrait" });

    // Every spell row regenerated with an old→new mapping.
    expect(staged.noteCopies).toHaveLength(4);
    const byOld = Object.fromEntries(staged.noteCopies.map((c) => [c.oldRowId, c.newRowId]));
    expect(Object.keys(byOld).sort()).toEqual(["spell_row_a", "spell_row_b", "spell_row_c", "spell_row_d"]);
    for (const newId of Object.values(byOld)) {
      expect(newId).toMatch(/^spell_/);
      expect(["spell_row_a", "spell_row_b", "spell_row_c", "spell_row_d"]).not.toContain(newId);
    }
    const restoredRows = staged.character.spells.levels.flatMap((level) => level.spells);
    expect(restoredRows.map((row) => row.id).sort()).toEqual(Object.values(byOld).sort());
  });

  it("preserves spell data and every character-local id except spell-row ids", () => {
    const { state, source, snapshot } = makeRestoreState();
    const staged = prepare(state, snapshot);
    const character = staged.character;

    // Spell-level structures keep their ids and slot data.
    expect(character.spells.levels.map((level) => level.id))
      .toEqual(["spellLevel_cantrips", "spellLevel_first"]);
    expect(character.spells.levels[1].used).toBe(2);
    expect(character.spells.levels[1].total).toBe(3);

    // Row content is preserved verbatim apart from the regenerated id.
    const cure = character.spells.levels[1].spells[0];
    expect(cure.name).toBe("Cure Wounds");
    expect(cure.prepared).toBe(true);
    expect(cure.builderSpellId).toBe("cure-wounds");
    const fireBolt = character.spells.levels[0].spells[0];
    expect(fireBolt.builderSeed).toBe("spell:fire-bolt");

    // Character-local ids preserved: attacks, resources, inventory, feature
    // cards, featureUses keys, builder seeds, calc blocks, build content ids.
    expect(character.attacks[0].id).toBe("atk_1");
    expect(character.attacks[0].builderSeed).toBe("weapon:longbow");
    expect(character.attacks[0].calc).toEqual(source.attacks[0].calc);
    expect(character.resources[0].id).toBe("res_1");
    expect(character.featureUses).toEqual({ "feature-x": { current: 1 } });
    expect(character.manualFeatureCards[0].id).toBe("feature_card_1");
    expect(character.inventoryItems[0].id).toBe("inv_1");
    expect(character.build.levels).toEqual(source.build.levels);
    expect(character.build.raceId).toBe("human");
  });

  it("never mutates the stored snapshot, the existing characters, or the retained snapshots", () => {
    const { state, snapshot } = makeRestoreState();
    const orphanSource = makeSourceCharacter();
    orphanSource.id = "char_gone";
    orphanSource.name = "Vex";
    orphanSource.spells.levels[0].spells[0].id = "spell_gone_row";
    state.characters.snapshots.push(makeSnapshotOf(orphanSource, { id: "csnap_gone" }));
    const snapshotBefore = JSON.stringify(snapshot);
    const entriesBefore = JSON.stringify(state.characters.entries);
    const snapshotsBefore = JSON.stringify(state.characters.snapshots);

    prepare(state, snapshot);

    expect(JSON.stringify(snapshot)).toBe(snapshotBefore);
    expect(JSON.stringify(state.characters.entries)).toBe(entriesBefore);
    expect(JSON.stringify(state.characters.snapshots)).toBe(snapshotsBefore);
  });

  it("works when the source playable character no longer exists", () => {
    const { snapshot } = makeRestoreState();
    const staged = prepareRestoredCharacter({
      snapshot,
      existingCharacters: [],
      migrateState,
      now: NOW
    });
    expect(staged.character.name).toBe("Gail — Restored Level 2");
    expect(staged.character.restoredFromCharacterId).toBe("char_src");
  });

  it("migrates an older-schema payload through the canonical pipeline without touching the stored payload", () => {
    const { state } = makeRestoreState();
    const legacyPayload = {
      id: "char_src",
      name: "Gail",
      build: { classId: "class_ranger", level: 2, raceId: "race_human" },
      spells: { levels: [{ id: "spellLevel_l1", label: "1st Level", hasSlots: true, used: null, total: null, collapsed: false, spells: [{ id: "spell_old", name: "Cure Wounds" }] }] }
    };
    const record = makeSnapshotOf(makeSourceCharacter(), {
      schemaVersion: 12,
      payload: legacyPayload
    });
    const payloadBefore = JSON.stringify(record.payload);

    const staged = prepare(state, record);
    const character = staged.character;

    // v1→v2 build normalization ran: legacy classId+level expanded, prefixes stripped.
    expect(character.build.version).toBe(2);
    expect(character.build.levels).toEqual([
      { classId: "ranger", hp: null },
      { classId: "ranger", hp: null }
    ]);
    expect(character.build.raceId).toBe("human");
    // Later migrations ran too: rest, death saves, feature uses, overrides.
    expect(character.rest).toEqual({ hitDiceSpent: {}, preparedByClass: {} });
    expect(character.deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(character.featureUses).toEqual({});
    expect(character.overrides.initiative).toBe(0);
    // The stored payload was not mutated by the migrate-through.
    expect(JSON.stringify(record.payload)).toBe(payloadBefore);
  });

  it("passes future-version payloads through untouched apart from the R2 identity work", () => {
    const { state } = makeRestoreState();
    const record = makeSnapshotOf(makeSourceCharacter(), {
      schemaVersion: CURRENT_SCHEMA_VERSION + 5,
      payload: {
        id: "char_src",
        name: "Gail",
        futureField: { keep: true },
        build: { version: 99, levels: [{ classId: "ranger", hp: null }, { classId: "ranger", hp: 6 }] }
      }
    });
    const staged = prepare(state, record);
    expect(staged.character.futureField).toEqual({ keep: true });
    // Future build shapes are not rewritten by older migrations.
    expect(staged.character.build.version).toBe(99);
    expect(staged.character.id).toMatch(/^char_/);
    expect(staged.character.name).toBe("Gail — Restored Level 2");
  });

  it("strips snapshot-shaped keys so campaign registries cannot leak into the restored character", () => {
    const { state } = makeRestoreState();
    const record = makeSnapshotOf(makeSourceCharacter());
    record.payload = { ...record.payload, snapshots: [{ id: "csnap_evil" }] };
    const staged = prepare(state, record);
    expect(staged.character.snapshots).toBeUndefined();
  });

  it("does not copy unknown snapshot metadata onto the restored character", () => {
    const { state } = makeRestoreState();
    const record = makeSnapshotOf(makeSourceCharacter(), { futureSnapshotFlag: "kept-on-record-only" });
    const staged = prepare(state, record);
    expect(staged.character.futureSnapshotFlag).toBeUndefined();
  });

  it("allocates a collision-free character id, avoiding entries and the source id", () => {
    const { state, snapshot } = makeRestoreState();
    const ids = ["char_src", state.characters.entries[0].id, "char_taken", "char_free"];
    state.characters.entries.push({ ...makeSourceCharacter(), id: "char_taken", name: "Other" });
    let i = 0;
    const staged = prepare(state, snapshot, { createCharacterId: () => ids[i++] ?? "char_free" });
    expect(staged.character.id).toBe("char_free");
  });

  it("fails safely when no unique character id can be allocated", () => {
    const { state, snapshot } = makeRestoreState();
    expect(() => prepare(state, snapshot, { createCharacterId: () => "char_src" }))
      .toThrow(/unique character id/);
  });

  it("keeps regenerated spell-row ids clear of every live row id in the campaign", () => {
    const { state, snapshot } = makeRestoreState();
    const other = makeSourceCharacter();
    other.id = "char_other";
    other.name = "Other";
    other.spells.levels[0].spells[0].id = "spell_live_elsewhere";
    state.characters.entries.push(other);

    const queue = [
      "spell_live_elsewhere", // owned by another live character — must be skipped
      "spell_row_b",          // owned by the payload itself — must be skipped
      "spell_new_1", "spell_new_2", "spell_new_3", "spell_new_4"
    ];
    const staged = prepare(state, snapshot, { createRowId: () => queue.shift() ?? "spell_overflow" });
    const newIds = staged.noteCopies.map((c) => c.newRowId);
    expect(newIds).toEqual(["spell_new_1", "spell_new_2", "spell_new_3", "spell_new_4"]);
  });

  it("fails safely when spell-row ids cannot be made unique", () => {
    const { state, snapshot } = makeRestoreState();
    expect(() => prepare(state, snapshot, { createRowId: () => "spell_fixed" }))
      .toThrow(/unique spell row id/);
  });

  it("rejects generator candidates owned only by another retained snapshot", () => {
    const { state, snapshot } = makeRestoreState();
    // The other snapshot's source character has been deleted — its payload is
    // the only remaining owner of spell_snapshot_only's note key.
    const deletedSource = makeSourceCharacter();
    deletedSource.id = "char_deleted";
    deletedSource.name = "Vex";
    deletedSource.spells.levels[0].spells[0].id = "spell_snapshot_only";
    state.characters.snapshots.push(makeSnapshotOf(deletedSource, { id: "csnap_orphan" }));
    expect(state.characters.entries.some((entry) => entry.id === "char_deleted")).toBe(false);

    const queue = [
      "spell_snapshot_only", // owned only by the deleted source's snapshot — must be skipped
      "spell_new_1", "spell_new_2", "spell_new_3", "spell_new_4"
    ];
    const staged = prepare(state, snapshot, { createRowId: () => queue.shift() ?? "spell_overflow" });
    const newIds = staged.noteCopies.map((c) => c.newRowId);
    expect(newIds).toEqual(["spell_new_1", "spell_new_2", "spell_new_3", "spell_new_4"]);
  });

  it("repeated preparation is deterministic and yields distinct identities", () => {
    const { state, snapshot } = makeRestoreState();
    const first = prepare(state, snapshot);
    const second = prepare(state, snapshot);
    expect(first.character.id).not.toBe(second.character.id);
    expect(first.character.name).toBe("Gail — Restored Level 2");
    expect(second.character.name).toBe("Gail — Restored Level 2");
    const firstRows = new Set(first.noteCopies.map((c) => c.newRowId));
    for (const copy of second.noteCopies) expect(firstRows.has(copy.newRowId)).toBe(false);
  });
});

describe("prepareRestoredCharacter — naming", () => {
  it("suffixes on collision with existing characters and increments deterministically", () => {
    const { state, snapshot } = makeRestoreState();
    state.characters.entries.push({ ...makeSourceCharacter(), id: "char_r1", name: "Gail — Restored Level 2" });
    expect(prepare(state, snapshot).character.name).toBe("Gail — Restored Level 2 (2)");

    state.characters.entries.push({ ...makeSourceCharacter(), id: "char_r2", name: "Gail — Restored Level 2 (2)" });
    expect(prepare(state, snapshot).character.name).toBe("Gail — Restored Level 2 (3)");
  });

  it("falls back to the payload name and then to the unnamed-character label", () => {
    const { state } = makeRestoreState();
    const fromPayload = makeSnapshotOf(makeSourceCharacter(), { sourceName: "" });
    expect(prepare(state, fromPayload).character.name).toBe("Gail — Restored Level 2");

    const blankSource = makeSourceCharacter();
    blankSource.name = "   ";
    const blankRecord = makeSnapshotOf(blankSource, { sourceName: "" });
    expect(prepare(state, blankRecord).character.name)
      .toBe(`${RESTORED_CHARACTER_FALLBACK_NAME} — Restored Level 2`);
  });

  it("keeps very long names verbatim and stacks suffixes on already-restored names", () => {
    const { state } = makeRestoreState();
    const longName = "G".repeat(300);
    const longSource = makeSourceCharacter();
    longSource.name = longName;
    const longRecord = makeSnapshotOf(longSource);
    expect(prepare(state, longRecord).character.name).toBe(`${longName} — Restored Level 2`);

    const restoredSource = makeSourceCharacter();
    restoredSource.name = "Gail — Restored Level 2";
    const restoredRecord = makeSnapshotOf(restoredSource);
    expect(prepare(state, restoredRecord).character.name)
      .toBe("Gail — Restored Level 2 — Restored Level 2");
  });

  it("derives the level from the migrated payload when the record lost fromLevel", () => {
    const { state } = makeRestoreState();
    const record = makeSnapshotOf(makeSourceCharacter(), { fromLevel: null });
    expect(prepare(state, record).character.name).toBe("Gail — Restored Level 2");
  });
});

describe("commitRestoredCharacter", () => {
  it("appends exactly one character, copies notes and portrait, and leaves everything else unchanged", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps, counters } = makeCommitDeps(state, stores);
    const sourceBefore = JSON.stringify(state.characters.entries[0]);
    const snapshotBefore = JSON.stringify(snapshot);
    const staged = prepare(state, snapshot);

    const result = await commitRestoredCharacter(staged, deps);

    expect(state.characters.entries).toHaveLength(2);
    expect(JSON.stringify(state.characters.entries[0])).toBe(sourceBefore);
    expect(state.characters.snapshots).toHaveLength(1);
    expect(JSON.stringify(state.characters.snapshots[0])).toBe(snapshotBefore);
    expect(state.characters.activeId).toBe("char_src");
    expect(counters.markDirty).toBe(1);

    const restored = state.characters.entries[1];
    expect(result).toEqual({ characterId: restored.id, name: "Gail — Restored Level 2" });
    expect(restored.imgBlobId).toBe("blob_copy_1");
    expect(stores.blobStore.get("blob_src_portrait")).toEqual({ data: "portrait-bytes" });
    expect(stores.blobStore.get("blob_copy_1")).toEqual({ data: "portrait-bytes" });

    // Notes: both note-bearing rows copied under their new keys at current
    // values; rows without stored notes create no keys; sources unchanged.
    const byOld = Object.fromEntries(staged.noteCopies.map((c) => [c.oldRowId, c.newRowId]));
    expect(stores.textStore.get(textKey_spellNotes(CAMPAIGN_ID, byOld.spell_row_b))).toBe("Source cure notes");
    expect(stores.textStore.get(textKey_spellNotes(CAMPAIGN_ID, byOld.spell_row_d))).toBe("Duplicate-row notes");
    expect(stores.textStore.has(textKey_spellNotes(CAMPAIGN_ID, byOld.spell_row_a))).toBe(false);
    expect(stores.textStore.has(textKey_spellNotes(CAMPAIGN_ID, byOld.spell_row_c))).toBe(false);
    expect(stores.textStore.get(textKey_spellNotes(CAMPAIGN_ID, "spell_row_b"))).toBe("Source cure notes");
    expect(stores.textStore.size).toBe(4);
  });

  it("keeps source and restored notes independently editable", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps } = makeCommitDeps(state, stores);
    const staged = prepare(state, snapshot);
    await commitRestoredCharacter(staged, deps);

    const byOld = Object.fromEntries(staged.noteCopies.map((c) => [c.oldRowId, c.newRowId]));
    const sourceKey = textKey_spellNotes(CAMPAIGN_ID, "spell_row_b");
    const restoredKey = textKey_spellNotes(CAMPAIGN_ID, byOld.spell_row_b);
    expect(restoredKey).not.toBe(sourceKey);

    await stores.deps.putText("Edited restored note", restoredKey);
    expect(stores.textStore.get(sourceKey)).toBe("Source cure notes");
    await stores.deps.putText("Edited source note", sourceKey);
    expect(stores.textStore.get(restoredKey)).toBe("Edited restored note");
  });

  it("fails soft when the source portrait blob is missing", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores({ blobs: {} });
    const { deps } = makeCommitDeps(state, stores);
    const staged = prepare(state, snapshot);

    await commitRestoredCharacter(staged, deps);
    expect(state.characters.entries).toHaveLength(2);
    expect(state.characters.entries[1].imgBlobId).toBeNull();
  });

  it("aborts with no character when the portrait copy fails in a blocking path", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const failingPut = makeCommitDeps(state, stores, {
      putBlob: async () => { throw new Error("quota"); }
    });
    const staged = prepare(state, snapshot);
    await expect(commitRestoredCharacter(staged, failingPut.deps)).rejects.toThrow(/Failed to copy the portrait/);
    expect(state.characters.entries).toHaveLength(1);
    expect(stores.textStore.size).toBe(2);

    const failingGet = makeCommitDeps(state, stores, {
      getBlob: async () => { throw new Error("idb down"); }
    });
    await expect(commitRestoredCharacter(prepare(state, snapshot), failingGet.deps))
      .rejects.toThrow(/Failed to read the source portrait/);
    expect(state.characters.entries).toHaveLength(1);
  });

  it("rolls back staged records and appends nothing when note copying fails", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    let puts = 0;
    const { deps } = makeCommitDeps(state, stores, {
      putText: async (text, id) => {
        puts += 1;
        if (puts === 2) throw new Error("second write fails");
        stores.textStore.set(id, text);
        return id;
      }
    });
    const staged = prepare(state, snapshot);

    await expect(commitRestoredCharacter(staged, deps)).rejects.toThrow(/Failed to copy spell notes/);
    expect(state.characters.entries).toHaveLength(1);
    expect(state.characters.activeId).toBe("char_src");
    // The first staged note and the staged portrait duplicate were removed.
    expect(stores.textStore.size).toBe(2);
    expect([...stores.blobStore.keys()]).toEqual(["blob_src_portrait"]);
    // Source notes are untouched.
    expect(stores.textStore.get(textKey_spellNotes(CAMPAIGN_ID, "spell_row_b"))).toBe("Source cure notes");

    // Retrying with a fresh preparation succeeds without corruption.
    const retry = prepare(state, snapshot);
    const result = await commitRestoredCharacter(retry, makeCommitDeps(state, stores).deps);
    expect(result.name).toBe("Gail — Restored Level 2");
    expect(state.characters.entries).toHaveLength(2);
  });

  it("rolls back staged records when reading a source note fails", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps } = makeCommitDeps(state, stores, {
      getText: async () => { throw new Error("read fails"); }
    });
    await expect(commitRestoredCharacter(prepare(state, snapshot), deps))
      .rejects.toThrow(/Failed to copy spell notes/);
    expect(state.characters.entries).toHaveLength(1);
    expect([...stores.blobStore.keys()]).toEqual(["blob_src_portrait"]);
  });

  it("restores the characters collection and cleans staged records when the state mutation fails", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps } = makeCommitDeps(state, stores, {
      mutateState: () => { throw new Error("mutation exploded"); }
    });
    const charactersBefore = JSON.stringify(state.characters);
    const staged = prepare(state, snapshot);

    await expect(commitRestoredCharacter(staged, deps)).rejects.toThrow(/mutation exploded/);
    expect(JSON.stringify(state.characters)).toBe(charactersBefore);
    expect(stores.textStore.size).toBe(2);
    expect([...stores.blobStore.keys()]).toEqual(["blob_src_portrait"]);

    // Retry with a fresh preparation and working deps succeeds.
    await commitRestoredCharacter(prepare(state, snapshot), makeCommitDeps(state, stores).deps);
    expect(state.characters.entries).toHaveLength(2);
  });

  it("aborts before any external access when a snapshot captured after preparation owns a staged row id", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps, calls } = makeCountingDeps(state, stores);
    const queue = ["spell_new_1", "spell_new_2", "spell_new_3", "spell_new_4"];
    const staged = prepare(state, snapshot, { createRowId: () => queue.shift() ?? "spell_overflow" });

    // Between prepare and commit, a Level Up captures a snapshot whose
    // payload owns one of the staged ids.
    const lateSource = makeSourceCharacter();
    lateSource.id = "char_late";
    lateSource.name = "Late";
    lateSource.spells.levels[0].spells[0].id = "spell_new_2";
    state.characters.snapshots.push(makeSnapshotOf(lateSource, { id: "csnap_late" }));

    const charactersBefore = JSON.stringify(state.characters);
    await expect(commitRestoredCharacter(staged, deps)).rejects.toThrow(/Spell data changed/);
    expect(JSON.stringify(state.characters)).toBe(charactersBefore);
    expect(calls).toEqual(NO_EXTERNAL_CALLS);
    expect(stores.textStore.size).toBe(2);
    expect([...stores.blobStore.keys()]).toEqual(["blob_src_portrait"]);

    // A fresh preparation reserves against the new snapshot and succeeds.
    const retry = prepare(state, snapshot);
    const result = await commitRestoredCharacter(retry, makeCommitDeps(state, stores).deps);
    expect(result.name).toBe("Gail — Restored Level 2");
    expect(state.characters.entries).toHaveLength(2);
  });

  it("aborts before any external access when a live character gains a staged row id after preparation", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps, calls } = makeCountingDeps(state, stores);
    const queue = ["spell_new_1", "spell_new_2", "spell_new_3", "spell_new_4"];
    const staged = prepare(state, snapshot, { createRowId: () => queue.shift() ?? "spell_overflow" });

    const lateEntry = makeSourceCharacter();
    lateEntry.id = "char_other";
    lateEntry.name = "Other";
    lateEntry.spells.levels[0].spells[0].id = "spell_new_3";
    state.characters.entries.push(lateEntry);

    await expect(commitRestoredCharacter(staged, deps)).rejects.toThrow(/Spell data changed/);
    expect(state.characters.entries).toHaveLength(2);
    expect(calls).toEqual(NO_EXTERNAL_CALLS);
    expect(stores.textStore.size).toBe(2);
    expect([...stores.blobStore.keys()]).toEqual(["blob_src_portrait"]);
  });

  it("aborts with nothing staged and nothing mutated when rollback state cannot be prepared", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps, calls } = makeCountingDeps(state, stores);
    const staged = prepare(state, snapshot);

    // The collection becomes unclonable (cyclic) after preparation.
    state.characters.cycle = state.characters;
    await expect(commitRestoredCharacter(staged, deps)).rejects.toThrow(/rollback state/);
    expect(calls).toEqual(NO_EXTERNAL_CALLS);
    expect(state.characters.entries).toHaveLength(1);
    expect(state.characters.cycle).toBe(state.characters);
    expect(stores.textStore.size).toBe(2);
    expect([...stores.blobStore.keys()]).toEqual(["blob_src_portrait"]);

    // Nothing was consumed by the aborted attempt: once the collection is
    // clonable again the same staged restore commits cleanly.
    delete state.characters.cycle;
    const result = await commitRestoredCharacter(staged, makeCommitDeps(state, stores).deps);
    expect(result.name).toBe("Gail — Restored Level 2");
    expect(state.characters.entries).toHaveLength(2);
  });

  it("aborts without inventing a characters collection when the state has none", async () => {
    const { state, snapshot } = makeRestoreState();
    const staged = prepare(state, snapshot);
    const stores = makeStores();
    const bareState = { appShell: { activeCampaignId: CAMPAIGN_ID } };
    const { deps, calls } = makeCountingDeps(bareState, stores);

    await expect(commitRestoredCharacter(staged, deps)).rejects.toThrow(/rollback state/);
    expect(calls).toEqual(NO_EXTERNAL_CALLS);
    // state.characters was never assigned — not even null.
    expect("characters" in bareState).toBe(false);
  });

  it("preserves a legitimate mid-staging character mutation when the restore mutation later fails", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const snapshotsBefore = JSON.stringify(state.characters.snapshots);
    const staged = prepare(state, snapshot);

    let injected = false;
    const { deps, counters } = makeCommitDeps(state, stores, {
      // A legitimate rename of the source lands during the awaited note
      // staging — after the commit-entry clone, before the mutation.
      getText: async (id) => {
        if (!injected) {
          injected = true;
          state.characters.entries[0].name = "Gail the Renamed";
        }
        return stores.textStore.get(id) ?? "";
      },
      // The restore's own mutation then fails.
      mutateState: () => false
    });

    await expect(commitRestoredCharacter(staged, deps)).rejects.toThrow(/Failed to add the restored character/);

    // The intervening rename survives: rollback used the fresh pre-mutation
    // clone, not the stale commit-entry clone, so nothing legitimate is lost.
    expect(state.characters.entries).toHaveLength(1);
    expect(state.characters.entries[0].name).toBe("Gail the Renamed");
    // Staged portrait + note records were cleaned up; sources untouched.
    expect(stores.textStore.size).toBe(2);
    expect([...stores.blobStore.keys()]).toEqual(["blob_src_portrait"]);
    // No restored copy was appended and the snapshot is unchanged.
    expect(JSON.stringify(state.characters.snapshots)).toBe(snapshotsBefore);
    expect(counters.markDirty).toBe(0);

    // Retry from a fresh preparation succeeds against the renamed source.
    const retry = prepare(state, snapshot);
    const result = await commitRestoredCharacter(retry, makeCommitDeps(state, stores).deps);
    expect(result.name).toBe("Gail — Restored Level 2");
    expect(state.characters.entries).toHaveLength(2);
    expect(state.characters.entries[0].name).toBe("Gail the Renamed");
  });

  it("aborts before mutation and cleans up staged records when the fresh pre-mutation clone is unavailable", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const staged = prepare(state, snapshot);

    let injected = false;
    const { deps, counters } = makeCommitDeps(state, stores, {
      // The collection turns cyclic during the awaited note staging, so the
      // fresh pre-mutation clone (step 5) cannot be taken.
      getText: async (id) => {
        const value = stores.textStore.get(id) ?? "";
        if (!injected) {
          injected = true;
          state.characters.cycle = state.characters;
        }
        return value;
      }
    });

    await expect(commitRestoredCharacter(staged, deps)).rejects.toThrow(/Failed to prepare rollback state/);
    // No restored entry was appended and existing state is untouched.
    expect(state.characters.entries).toHaveLength(1);
    expect(state.characters.cycle).toBe(state.characters);
    expect(counters.markDirty).toBe(0);
    // Staged portrait + note records were cleaned up; sources untouched.
    expect(stores.textStore.size).toBe(2);
    expect([...stores.blobStore.keys()]).toEqual(["blob_src_portrait"]);

    // Once the cycle is gone, a fresh preparation commits cleanly.
    delete state.characters.cycle;
    const result = await commitRestoredCharacter(prepare(state, snapshot), makeCommitDeps(state, stores).deps);
    expect(result.name).toBe("Gail — Restored Level 2");
    expect(state.characters.entries).toHaveLength(2);
  });

  it("rolls back cleanly when the state mutation reports failure", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps, counters } = makeCommitDeps(state, stores, { mutateState: () => false });
    const charactersBefore = JSON.stringify(state.characters);
    const staged = prepare(state, snapshot);

    await expect(commitRestoredCharacter(staged, deps)).rejects.toThrow(/Failed to add the restored character/);
    expect(JSON.stringify(state.characters)).toBe(charactersBefore);
    expect(state.characters).not.toBeNull();
    expect(counters.markDirty).toBe(0);
    // Staged records were cleaned up; sources are untouched.
    expect(stores.textStore.size).toBe(2);
    expect([...stores.blobStore.keys()]).toEqual(["blob_src_portrait"]);

    // Retry with working deps succeeds.
    await commitRestoredCharacter(prepare(state, snapshot), makeCommitDeps(state, stores).deps);
    expect(state.characters.entries).toHaveLength(2);
  });

  it("commits successfully with no blob operations when the payload has no portrait", async () => {
    const { state } = makeRestoreState();
    const plainSource = makeSourceCharacter();
    plainSource.imgBlobId = null;
    const record = makeSnapshotOf(plainSource, { id: "csnap_plain" });
    state.characters.snapshots.push(record);
    const stores = makeStores();
    const { deps, counters, calls } = makeCountingDeps(state, stores);

    const staged = prepare(state, record);
    expect(staged.portraitCopy).toBeNull();

    const result = await commitRestoredCharacter(staged, deps);
    expect(result.name).toBe("Gail — Restored Level 2");
    expect(calls.getBlob).toBe(0);
    expect(calls.putBlob).toBe(0);
    expect(counters.markDirty).toBe(1);
    expect(state.characters.entries).toHaveLength(2);
    expect(state.characters.entries[1].imgBlobId).toBeNull();
  });

  it("cannot append twice for one staged restore", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps } = makeCommitDeps(state, stores);
    const staged = prepare(state, snapshot);

    await commitRestoredCharacter(staged, deps);
    await expect(commitRestoredCharacter(staged, deps)).rejects.toThrow(/already been committed/);
    expect(state.characters.entries).toHaveLength(2);

    // Even with the latch tampered away, the pre-staging row-id recheck sees
    // the committed copy's rows as live and aborts before staging — the
    // committed restore's note copies survive the tampered attempt.
    staged.committed = false;
    await expect(commitRestoredCharacter(staged, deps)).rejects.toThrow(/Spell data changed/);
    expect(state.characters.entries).toHaveLength(2);
    expect(stores.textStore.size).toBe(4);
  });

  it("the in-mutation id guard still blocks a tampered latch when the payload has no spell rows", async () => {
    const { state } = makeRestoreState();
    const rowlessSource = makeSourceCharacter();
    rowlessSource.imgBlobId = null;
    rowlessSource.spells = { levels: [] };
    const record = makeSnapshotOf(rowlessSource, { id: "csnap_rowless" });
    state.characters.snapshots.push(record);
    const stores = makeStores();
    const { deps } = makeCommitDeps(state, stores);
    const staged = prepare(state, record);
    expect(staged.noteCopies).toHaveLength(0);

    await commitRestoredCharacter(staged, deps);
    staged.committed = false;
    await expect(commitRestoredCharacter(staged, deps)).rejects.toThrow(/already been committed/);
    expect(state.characters.entries).toHaveLength(2);
  });

  it("two separate valid invocations create two separate characters with distinct identities", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps } = makeCommitDeps(state, stores);

    const first = await commitRestoredCharacter(prepare(state, snapshot), deps);
    const second = await commitRestoredCharacter(prepare(state, snapshot), deps);

    expect(state.characters.entries).toHaveLength(3);
    expect(first.characterId).not.toBe(second.characterId);
    expect(first.name).toBe("Gail — Restored Level 2");
    expect(second.name).toBe("Gail — Restored Level 2 (2)");

    const [, restoredA, restoredB] = state.characters.entries;
    expect(restoredA.imgBlobId).toBe("blob_copy_1");
    expect(restoredB.imgBlobId).toBe("blob_copy_2");
    const rowsA = restoredA.spells.levels.flatMap((level) => level.spells).map((row) => row.id);
    const rowsB = restoredB.spells.levels.flatMap((level) => level.spells).map((row) => row.id);
    for (const id of rowsB) expect(rowsA).not.toContain(id);
  });

  it("re-resolves the name at commit time against the live entries", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps } = makeCommitDeps(state, stores);
    const staged = prepare(state, snapshot);
    // A character claims the prepared name between prepare and commit.
    state.characters.entries.push({ ...makeSourceCharacter(), id: "char_late", name: "Gail — Restored Level 2" });

    const result = await commitRestoredCharacter(staged, deps);
    expect(result.name).toBe("Gail — Restored Level 2 (2)");
  });

  it("does not change the active character by default and activates only on request", async () => {
    const first = makeRestoreState();
    const firstResult = await commitRestoredCharacter(
      prepare(first.state, first.snapshot),
      makeCommitDeps(first.state, makeStores()).deps
    );
    expect(first.state.characters.activeId).toBe("char_src");
    expect(firstResult.characterId).toBeTruthy();

    const second = makeRestoreState();
    const activated = await commitRestoredCharacter(
      prepare(second.state, second.snapshot),
      { ...makeCommitDeps(second.state, makeStores()).deps, activate: true }
    );
    expect(second.state.characters.activeId).toBe(activated.characterId);
  });

  it("requires an active campaign and validates its deps", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const staged = prepare(state, snapshot);

    const noCampaign = makeCommitDeps({ ...state, appShell: { activeCampaignId: null } }, stores);
    await expect(commitRestoredCharacter(staged, noCampaign.deps)).rejects.toThrow(/No active campaign/);

    const { deps } = makeCommitDeps(state, stores);
    await expect(commitRestoredCharacter(staged, { ...deps, putText: undefined }))
      .rejects.toThrow(/putText is required/);
    await expect(commitRestoredCharacter(null, deps)).rejects.toThrow(/staged restore is required/);
    expect(state.characters.entries).toHaveLength(1);
  });
});

describe("restoreCharacterFromSnapshot", () => {
  it("resolves, prepares, and commits in one call", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps } = makeCommitDeps(state, stores);

    const result = await restoreCharacterFromSnapshot({
      snapshotId: "csnap_1",
      migrateState,
      now: NOW,
      ...deps
    });

    expect(result.name).toBe("Gail — Restored Level 2");
    expect(state.characters.entries).toHaveLength(2);
    expect(state.characters.snapshots).toHaveLength(1);
    expect(getCharacterSnapshotById(state.characters.snapshots, "csnap_1")).toBe(snapshot);
  });

  it("protects a spell note owned only by a deleted source's snapshot", async () => {
    const { state } = makeRestoreState();
    // Character "Vex" leveled up (snapshot captured), then was deleted: the
    // snapshot payload is now the only owner of spell_orphan_row's note key.
    const deletedSource = makeSourceCharacter();
    deletedSource.id = "char_deleted";
    deletedSource.name = "Vex";
    deletedSource.imgBlobId = null;
    deletedSource.spells.levels[0].spells[0].id = "spell_orphan_row";
    state.characters.snapshots.push(makeSnapshotOf(deletedSource, { id: "csnap_orphan" }));
    const orphanKey = textKey_spellNotes(CAMPAIGN_ID, "spell_orphan_row");
    const stores = makeStores();
    stores.textStore.set(orphanKey, "Orphan-only note");
    const { deps } = makeCommitDeps(state, stores);
    const snapshotsBefore = JSON.stringify(state.characters.snapshots);

    // The generator's first candidate is the snapshot-owned row id; the
    // orchestrator must reserve it and retry with the next candidates.
    const queue = ["spell_orphan_row", "spell_new_1", "spell_new_2", "spell_new_3", "spell_new_4"];
    const result = await restoreCharacterFromSnapshot({
      snapshotId: "csnap_1",
      migrateState,
      now: NOW,
      createRowId: () => queue.shift() ?? "spell_overflow",
      ...deps
    });

    expect(result.name).toBe("Gail — Restored Level 2");
    const restored = state.characters.entries[1];
    const restoredRowIds = restored.spells.levels.flatMap((level) => level.spells).map((row) => row.id);
    expect(restoredRowIds).toEqual(["spell_new_1", "spell_new_2", "spell_new_3", "spell_new_4"]);
    expect(restoredRowIds).not.toContain("spell_orphan_row");
    // The orphan snapshot's note and record are untouched.
    expect(stores.textStore.get(orphanKey)).toBe("Orphan-only note");
    expect(JSON.stringify(state.characters.snapshots)).toBe(snapshotsBefore);
  });

  it("fails safely when the snapshot id does not resolve", async () => {
    const { state } = makeRestoreState();
    const stores = makeStores();
    const { deps } = makeCommitDeps(state, stores);
    await expect(restoreCharacterFromSnapshot({
      snapshotId: "csnap_missing",
      migrateState,
      ...deps
    })).rejects.toThrow(/Snapshot not found/);
    expect(state.characters.entries).toHaveLength(1);
    expect(stores.textStore.size).toBe(2);
  });
});

describe("restored-character persistence", () => {
  it("survives sanitize → reload with provenance, regenerated rows, and copied notes intact", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps } = makeCommitDeps(state, stores);
    const staged = prepare(state, snapshot);
    await commitRestoredCharacter(staged, deps);

    const reloaded = migrateState(JSON.parse(JSON.stringify(sanitizeForSave(state))));
    expect(reloaded.characters.entries).toHaveLength(2);
    expect(reloaded.characters.snapshots).toHaveLength(1);

    const restored = reloaded.characters.entries[1];
    expect(restored.restoredFromSnapshotId).toBe("csnap_1");
    expect(restored.restoredFromCharacterId).toBe("char_src");
    expect(restored.restoredAt).toBe(NOW());
    expect(restored.imgBlobId).toBe("blob_copy_1");

    const byOld = Object.fromEntries(staged.noteCopies.map((c) => [c.oldRowId, c.newRowId]));
    const reloadedRowIds = restored.spells.levels.flatMap((level) => level.spells).map((row) => row.id);
    expect(reloadedRowIds.sort()).toEqual(Object.values(byOld).sort());
    expect(stores.textStore.get(textKey_spellNotes(CAMPAIGN_ID, byOld.spell_row_b))).toBe("Source cure notes");

    // Source and restored records remain independent after reload.
    expect(reloaded.characters.entries[0].id).toBe("char_src");
    expect(reloaded.characters.entries[0].spells.levels[1].spells[0].id).toBe("spell_row_b");
  });

  it("survives the campaign vault save → reload path", async () => {
    const { state, snapshot } = makeRestoreState();
    const stores = makeStores();
    const { deps } = makeCommitDeps(state, stores);
    await commitRestoredCharacter(prepare(state, snapshot), deps);

    const { vault } = normalizeCampaignVault(null, { migrateState, sanitizeForSave });
    const savedVault = persistRuntimeStateToVault(vault, state, { sanitizeForSave });
    const { vault: reloadedVault } = normalizeCampaignVault(
      JSON.parse(JSON.stringify(savedVault)),
      { migrateState, sanitizeForSave }
    );
    const projected = projectActiveCampaignState(reloadedVault, migrateState);
    const runtime = migrateState(undefined);
    replaceRuntimeState(runtime, projected);

    expect(runtime.characters.entries).toHaveLength(2);
    expect(runtime.characters.entries[1].restoredFromSnapshotId).toBe("csnap_1");
    expect(runtime.characters.snapshots).toHaveLength(1);
  });

  it("a committed-but-never-persisted restore leaves reload state without any reference to the staged records", async () => {
    const { state, snapshot } = makeRestoreState();
    const preRestoreDoc = JSON.parse(JSON.stringify(sanitizeForSave(state)));
    const stores = makeStores();
    const { deps } = makeCommitDeps(state, stores);
    const staged = prepare(state, snapshot);
    await commitRestoredCharacter(staged, deps);

    // Simulate the app closing before the queued save flushes: reload from
    // the pre-restore document. The staged blob/text records still exist in
    // IndexedDB but nothing in the reloaded state references them.
    const reloaded = migrateState(preRestoreDoc);
    expect(reloaded.characters.entries).toHaveLength(1);
    const referencedRowIds = new Set(
      reloaded.characters.entries.flatMap((entry) => entry.spells.levels.flatMap((level) => level.spells.map((row) => row.id)))
    );
    for (const copy of staged.noteCopies) {
      expect(referencedRowIds.has(copy.newRowId)).toBe(false);
    }
    expect(reloaded.characters.entries.some((entry) => entry.imgBlobId === "blob_copy_1")).toBe(false);
  });
});
