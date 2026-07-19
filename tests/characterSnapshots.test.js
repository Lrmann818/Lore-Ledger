// Restore Character phase R1 — pre-Level-Up snapshot records.
//
// Covers the domain module (build/normalize/append), the v13 migration, save
// sanitization, and the campaign-vault + full-backup state round trips. The
// capture-on-Level-Up behavior is covered in tests/characterPage.test.js
// ("level up flow"); restoring a snapshot is phase R2 and has no tests yet.

import { describe, expect, it } from "vitest";

import {
  PRE_LEVEL_UP_SNAPSHOT_KIND,
  appendPreLevelUpSnapshot,
  buildPreLevelUpSnapshot,
  getSnapshotClassSummary,
  newCharacterSnapshotId,
  normalizeCharacterSnapshots
} from "../js/domain/characterSnapshots.js";
import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";
import { CURRENT_SCHEMA_VERSION, migrateState, sanitizeForSave } from "../js/state.js";
import {
  normalizeCampaignVault,
  persistRuntimeStateToVault,
  projectActiveCampaignState,
  replaceRuntimeState
} from "../js/storage/campaignVault.js";

function makeLeveledCharacter({ id = "char_src", name = "Gail", levels = [{ classId: "ranger", hp: null }] } = {}) {
  const entry = makeDefaultBuilderCharacterEntry(name);
  entry.id = id;
  entry.build.raceId = "human";
  entry.build.backgroundId = "acolyte";
  entry.build.levels = levels;
  entry.hpMax = 12;
  entry.hpCur = 9;
  return entry;
}

function makeValidSnapshotRecord(overrides = {}) {
  return {
    id: "csnap_fixture_1",
    kind: PRE_LEVEL_UP_SNAPSHOT_KIND,
    sourceCharacterId: "char_src",
    sourceName: "Gail",
    classSummary: "Ranger 1",
    fromLevel: 1,
    toLevel: 2,
    toClassId: "ranger",
    createdAt: "2026-07-18T12:00:00.000Z",
    schemaVersion: 13,
    payload: { id: "char_src", name: "Gail", build: { levels: [{ classId: "ranger", hp: null }] } },
    ...overrides
  };
}

describe("buildPreLevelUpSnapshot", () => {
  it("builds the complete record with identity, transition, summary, timestamp, and payload", () => {
    const registry = BUILTIN_CONTENT_REGISTRY;
    const character = makeLeveledCharacter();
    const record = buildPreLevelUpSnapshot({
      character,
      toClassId: "ranger",
      registry,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      now: () => "2026-07-18T12:00:00.000Z"
    });

    expect(record.id).toMatch(/^csnap_/);
    expect(record.kind).toBe(PRE_LEVEL_UP_SNAPSHOT_KIND);
    expect(record.sourceCharacterId).toBe("char_src");
    expect(record.sourceName).toBe("Gail");
    expect(record.classSummary).toBe("Ranger 1");
    expect(record.fromLevel).toBe(1);
    expect(record.toLevel).toBe(2);
    expect(record.toClassId).toBe("ranger");
    expect(record.createdAt).toBe("2026-07-18T12:00:00.000Z");
    expect(record.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(record.payload).toEqual(JSON.parse(JSON.stringify(character)));
  });

  it("defaults the timestamp to an ISO string when no clock is injected", () => {
    const record = buildPreLevelUpSnapshot({ character: makeLeveledCharacter() });
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("payload is a deep copy — mutating the source afterwards never changes the snapshot", () => {
    const character = makeLeveledCharacter();
    const record = buildPreLevelUpSnapshot({ character });
    const frozen = JSON.parse(JSON.stringify(record.payload));

    character.name = "Renamed";
    character.hpCur = 1;
    character.build.levels.push({ classId: "ranger", hp: 6 });
    character.resources.push({ id: "res_x", name: "New Pool", cur: 1, max: 1 });

    expect(record.payload).toEqual(frozen);
    expect(record.payload).not.toBe(character);
    expect(record.payload.build).not.toBe(character.build);
  });

  it("summarizes multiclass builds in first-taken order and falls back to raw class ids", () => {
    const registry = BUILTIN_CONTENT_REGISTRY;
    const levels = [
      { classId: "sorcerer", hp: null },
      { classId: "ranger", hp: null },
      { classId: "sorcerer", hp: null }
    ];
    expect(getSnapshotClassSummary({ levels }, registry)).toBe("Sorcerer 2, Ranger 1");
    expect(getSnapshotClassSummary({ levels: [{ classId: "mystery-class", hp: null }] }, registry))
      .toBe("mystery-class 1");
    expect(getSnapshotClassSummary({ levels: [{ classId: "ranger", hp: null }] }, null)).toBe("ranger 1");
  });

  it("strips recursive snapshot data from the payload", () => {
    const character = makeLeveledCharacter();
    character.snapshots = [{ id: "csnap_evil", kind: "pre-level-up" }];
    const record = buildPreLevelUpSnapshot({ character });
    expect(record.payload.snapshots).toBeUndefined();
    // The source character is not mutated by the strip.
    expect(character.snapshots).toHaveLength(1);
  });

  it("refuses to capture characters without an id or without levels", () => {
    const noId = makeLeveledCharacter();
    noId.id = "";
    expect(buildPreLevelUpSnapshot({ character: noId })).toBeNull();
    const noLevels = makeLeveledCharacter({ levels: [] });
    expect(buildPreLevelUpSnapshot({ character: noLevels })).toBeNull();
    expect(buildPreLevelUpSnapshot({ character: null })).toBeNull();
  });

  it("generates csnap-prefixed ids", () => {
    expect(newCharacterSnapshotId()).toMatch(/^csnap_[a-z0-9]+_[a-z0-9]+$/);
  });
});

describe("normalizeCharacterSnapshots", () => {
  it("returns an empty array for missing or non-array collections", () => {
    expect(normalizeCharacterSnapshots(undefined)).toEqual([]);
    expect(normalizeCharacterSnapshots(null)).toEqual([]);
    expect(normalizeCharacterSnapshots("junk")).toEqual([]);
    expect(normalizeCharacterSnapshots({ 0: makeValidSnapshotRecord() })).toEqual([]);
  });

  it("keeps valid records, preserves unknown extra fields, and normalizes scalars", () => {
    const record = makeValidSnapshotRecord({ futureField: "kept", fromLevel: "1" });
    const [normalized] = normalizeCharacterSnapshots([record]);
    expect(normalized).toMatchObject({
      id: "csnap_fixture_1",
      kind: PRE_LEVEL_UP_SNAPSHOT_KIND,
      sourceCharacterId: "char_src",
      fromLevel: 1,
      futureField: "kept"
    });
  });

  it("drops records missing identity fields or a plain-object payload", () => {
    const out = normalizeCharacterSnapshots([
      null,
      "junk",
      42,
      [],
      makeValidSnapshotRecord({ id: "" }),
      makeValidSnapshotRecord({ kind: "  " }),
      makeValidSnapshotRecord({ sourceCharacterId: null }),
      makeValidSnapshotRecord({ payload: "not an object" }),
      makeValidSnapshotRecord({ payload: [] }),
      makeValidSnapshotRecord({ id: "csnap_ok" })
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("csnap_ok");
  });

  it("de-duplicates ids keeping the first record", () => {
    const out = normalizeCharacterSnapshots([
      makeValidSnapshotRecord({ sourceName: "First" }),
      makeValidSnapshotRecord({ sourceName: "Second" })
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].sourceName).toBe("First");
  });

  it("strips recursive snapshot data nested inside payloads", () => {
    const record = makeValidSnapshotRecord();
    record.payload.snapshots = [{ id: "csnap_nested" }];
    const [normalized] = normalizeCharacterSnapshots([record]);
    expect(normalized.payload.snapshots).toBeUndefined();
  });
});

describe("appendPreLevelUpSnapshot", () => {
  it("appends new records and replaces the same (kind, source, fromLevel) in place", () => {
    const snapshots = [];
    const first = makeValidSnapshotRecord({ id: "csnap_a" });
    expect(appendPreLevelUpSnapshot(snapshots, first)).toBe(true);
    expect(snapshots).toHaveLength(1);

    // Same character, same fromLevel: replaced at its original position.
    const retry = makeValidSnapshotRecord({ id: "csnap_b" });
    appendPreLevelUpSnapshot(snapshots, retry);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].id).toBe("csnap_b");

    // Same character, later level: appended.
    const nextLevel = makeValidSnapshotRecord({ id: "csnap_c", fromLevel: 2, toLevel: 3 });
    appendPreLevelUpSnapshot(snapshots, nextLevel);
    expect(snapshots.map((s) => s.id)).toEqual(["csnap_b", "csnap_c"]);

    // Different character at the same level: appended.
    const otherCharacter = makeValidSnapshotRecord({ id: "csnap_d", sourceCharacterId: "char_other" });
    appendPreLevelUpSnapshot(snapshots, otherCharacter);
    expect(snapshots).toHaveLength(3);
  });

  it("rejects non-array collections and non-object records", () => {
    expect(appendPreLevelUpSnapshot(null, makeValidSnapshotRecord())).toBe(false);
    expect(appendPreLevelUpSnapshot([], null)).toBe(false);
  });
});

describe("schema v13 migration", () => {
  it("new state carries an empty snapshot collection at the current version", () => {
    const fresh = migrateState(undefined);
    expect(fresh.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(fresh.characters.snapshots).toEqual([]);
  });

  it("migrates a v12 save to an empty collection without inventing snapshots for leveled characters", () => {
    const migrated = migrateState({
      schemaVersion: 12,
      characters: {
        activeId: "char_src",
        entries: [makeLeveledCharacter({ levels: [{ classId: "ranger", hp: null }, { classId: "ranger", hp: 6 }] })]
      }
    });
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.characters.snapshots).toEqual([]);
    expect(migrated.characters.entries).toHaveLength(1);
  });

  it("preserves valid stored snapshots and drops malformed ones", () => {
    const migrated = migrateState({
      schemaVersion: 13,
      characters: {
        activeId: null,
        entries: [],
        snapshots: [makeValidSnapshotRecord(), "junk", { id: "csnap_broken" }]
      }
    });
    expect(migrated.characters.snapshots).toHaveLength(1);
    expect(migrated.characters.snapshots[0].id).toBe("csnap_fixture_1");
  });

  it("normalizes malformed snapshot collections safely", () => {
    const fromString = migrateState({
      schemaVersion: 13,
      characters: { activeId: null, entries: [], snapshots: "corrupted" }
    });
    expect(fromString.characters.snapshots).toEqual([]);

    const fromObject = migrateState({
      schemaVersion: 13,
      characters: { activeId: null, entries: [], snapshots: { nope: true } }
    });
    expect(fromObject.characters.snapshots).toEqual([]);
  });

  it("strips recursive snapshot payload data during migration", () => {
    const record = makeValidSnapshotRecord();
    record.payload.snapshots = [makeValidSnapshotRecord({ id: "csnap_nested" })];
    const migrated = migrateState({
      schemaVersion: 13,
      characters: { activeId: null, entries: [], snapshots: [record] }
    });
    expect(migrated.characters.snapshots[0].payload.snapshots).toBeUndefined();
  });

  it("keeps freeform and legacy characters untouched by the snapshot migration", () => {
    const legacy = migrateState({
      schemaVersion: 1,
      character: { equipment: "50 ft rope" }
    });
    expect(legacy.characters.snapshots).toEqual([]);
    expect(legacy.characters.entries[0].inventoryItems[0].notes).toBe("50 ft rope");
  });
});

describe("snapshot persistence round trips", () => {
  function makeStateWithSnapshot() {
    const state = migrateState(undefined);
    state.appShell = { activeCampaignId: "camp_snap" };
    state.tracker.campaignTitle = "Snapshot Campaign";
    state.characters.entries = [makeLeveledCharacter()];
    state.characters.activeId = "char_src";
    state.characters.snapshots = [makeValidSnapshotRecord()];
    return state;
  }

  it("sanitizeForSave retains the snapshot collection", () => {
    const sanitized = sanitizeForSave(makeStateWithSnapshot());
    expect(sanitized.characters.snapshots).toHaveLength(1);
    expect(sanitized.characters.snapshots[0].id).toBe("csnap_fixture_1");
  });

  it("survives source-character deletion in state (snapshots are campaign-owned)", () => {
    const state = makeStateWithSnapshot();
    state.characters.entries = [];
    state.characters.activeId = null;
    const reloaded = migrateState(JSON.parse(JSON.stringify(sanitizeForSave(state))));
    expect(reloaded.characters.entries).toEqual([]);
    expect(reloaded.characters.snapshots).toHaveLength(1);
    expect(reloaded.characters.snapshots[0].sourceCharacterId).toBe("char_src");
  });

  // The reload path a real session takes: persist into the vault, JSON
  // round-trip the stored vault, re-normalize, project back into runtime
  // state, and hydrate the live singleton (the state.content vault-drop
  // regression is the reason every leg is pinned — matrix #14).
  it("persists snapshots through the campaign vault save → reload → re-persist path", () => {
    const state = makeStateWithSnapshot();

    const { vault } = normalizeCampaignVault(null, { migrateState, sanitizeForSave });
    const savedVault = persistRuntimeStateToVault(vault, state, { sanitizeForSave });
    expect(savedVault.campaignDocs.camp_snap.characters.snapshots).toHaveLength(1);

    const { vault: reloadedVault } = normalizeCampaignVault(
      JSON.parse(JSON.stringify(savedVault)),
      { migrateState, sanitizeForSave }
    );
    const projected = projectActiveCampaignState(reloadedVault, migrateState);
    expect(projected.characters.snapshots).toHaveLength(1);
    expect(projected.characters.snapshots[0]).toMatchObject({
      id: "csnap_fixture_1",
      sourceCharacterId: "char_src",
      fromLevel: 1
    });

    const runtime = migrateState(undefined);
    replaceRuntimeState(runtime, projected);
    expect(runtime.characters.snapshots).toHaveLength(1);
    const repersisted = persistRuntimeStateToVault(reloadedVault, runtime, { sanitizeForSave });
    expect(repersisted.campaignDocs.camp_snap.characters.snapshots).toHaveLength(1);
  });

  it("hydrates older vault docs without a snapshots key to an empty collection", () => {
    const state = migrateState(undefined);
    state.appShell = { activeCampaignId: "camp_old" };
    const { vault } = normalizeCampaignVault(null, { migrateState, sanitizeForSave });
    const savedVault = persistRuntimeStateToVault(vault, state, { sanitizeForSave });
    delete savedVault.campaignDocs.camp_old.characters.snapshots;

    const { vault: reloadedVault } = normalizeCampaignVault(
      JSON.parse(JSON.stringify(savedVault)),
      { migrateState, sanitizeForSave }
    );
    const projected = projectActiveCampaignState(reloadedVault, migrateState);
    expect(projected.characters.snapshots).toEqual([]);
  });

  // Full-backup semantics at the state layer: exportBackup embeds
  // sanitizeForSave(state) verbatim and importBackup runs migrateState over
  // the parsed envelope state. The real importBackup path is additionally
  // covered in tests/storage.backup.test.js. R4 will extend the backup blob/
  // text collectors to walk snapshot payloads; until then the records
  // round-trip but snapshot-only portrait/note assets are not yet bundled.
  it("round-trips snapshot records through the backup envelope state", () => {
    const exported = sanitizeForSave(makeStateWithSnapshot());
    const reimported = migrateState(JSON.parse(JSON.stringify(exported)));
    expect(reimported.characters.snapshots).toHaveLength(1);
    expect(reimported.characters.snapshots[0].payload).toMatchObject({ id: "char_src", name: "Gail" });
  });

  it("imports old backups without snapshots to an empty collection", () => {
    const oldBackupState = sanitizeForSave(migrateState(undefined));
    delete oldBackupState.characters.snapshots;
    const reimported = migrateState(JSON.parse(JSON.stringify(oldBackupState)));
    expect(reimported.characters.snapshots).toEqual([]);
  });
});
