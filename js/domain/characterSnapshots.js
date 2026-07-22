// @ts-check
// js/domain/characterSnapshots.js — pre-Level-Up character snapshot records
// (Restore Character phases R1 + R2; see docs/reference/restore-character-spec.md).
//
// R1: building, normalizing, and appending snapshot records (capture).
// R2: the non-UI restore engine — resolving a snapshot, preparing a restored
// playable copy (migrate-through, new identity, naming, spell-row id
// regeneration), and the staged commit with rollback. No user-facing restore
// UI exists yet; that is phase R3.

import { getClassLevelTotals, normalizeBuildLevels } from "./rules/progression.js";
import { getContentByKind } from "./rules/registry.js";
import { makeDefaultCharacterEntry } from "./characterHelpers.js";
import { textKey_spellNotes } from "../storage/texts-idb.js";

/** @typedef {import("../state.js").CharacterEntry} CharacterEntry */
/** @typedef {import("../state.js").CharacterSnapshot} CharacterSnapshot */

export const PRE_LEVEL_UP_SNAPSHOT_KIND = "pre-level-up";

/**
 * Display fallback when a snapshot has no usable source name, matching the
 * character selector's blank-name fallback ("Unnamed Character").
 */
export const RESTORED_CHARACTER_FALLBACK_NAME = "Unnamed Character";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumberOrNull(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @returns {string}
 */
export function newCharacterSnapshotId() {
  return `csnap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Snapshot payloads are character entries and must never nest snapshot
 * history (spec §2.2: no recursion by construction, stripped defensively).
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
function stripSnapshotRecursion(payload) {
  if ("snapshots" in payload) delete payload.snapshots;
  return payload;
}

/**
 * Human class summary frozen at capture time (e.g. "Fighter 3" or
 * "Sorcerer 11, Ranger 5"), ordered by first-taken class like the sheet's
 * class/level label. Falls back to the raw class id when the registry cannot
 * resolve a name, so capture never fails on missing content.
 *
 * @param {unknown} build
 * @param {unknown} registry
 * @returns {string}
 */
export function getSnapshotClassSummary(build, registry) {
  const levels = normalizeBuildLevels(build);
  if (!levels.length) return "";
  return getClassLevelTotals(levels)
    .map(({ classId, level }) => {
      const entry = registry
        ? getContentByKind(/** @type {any} */ (registry), "class", classId)
        : null;
      const name = cleanString(entry?.name) || classId;
      return `${name} ${level}`;
    })
    .join(", ");
}

/**
 * Builds one complete pre-Level-Up snapshot record from the character as it
 * exists immediately before the Level Up commit. The payload is a fresh deep
 * clone — the source character is never mutated or referenced — with any
 * recursive snapshot data stripped. Returns null when the character cannot be
 * captured safely (no id, no levels, or an unclonable entry); callers must
 * treat null as "abort the Level Up apply without writing anything".
 *
 * @param {{
 *   character: CharacterEntry | Record<string, unknown>,
 *   toClassId?: string | null,
 *   registry?: unknown,
 *   schemaVersion?: number | null,
 *   now?: () => string
 * }} options
 * @returns {CharacterSnapshot | null}
 */
export function buildPreLevelUpSnapshot(options) {
  const { character, toClassId = null, registry = null, schemaVersion = null, now } = options || {};
  if (!isPlainRecord(character)) return null;
  const sourceCharacterId = cleanString(character.id);
  if (!sourceCharacterId) return null;

  /** @type {Record<string, unknown>} */
  let payload;
  try {
    payload = JSON.parse(JSON.stringify(character));
  } catch {
    return null;
  }
  if (!isPlainRecord(payload)) return null;
  stripSnapshotRecursion(payload);

  const fromLevel = normalizeBuildLevels(payload.build).length;
  if (fromLevel < 1) return null;

  const createdAt = typeof now === "function"
    ? cleanString(now())
    : new Date().toISOString();

  return /** @type {CharacterSnapshot} */ ({
    id: newCharacterSnapshotId(),
    kind: PRE_LEVEL_UP_SNAPSHOT_KIND,
    sourceCharacterId,
    sourceName: cleanString(character.name),
    classSummary: getSnapshotClassSummary(payload.build, registry),
    fromLevel,
    toLevel: fromLevel + 1,
    toClassId: cleanString(toClassId),
    createdAt,
    schemaVersion: finiteNumberOrNull(schemaVersion),
    payload
  });
}

/**
 * Normalizes a persisted snapshot collection. The single source of truth for
 * the v13 migration and every load path: guarantees an array, drops records
 * that are not plain objects or lack the identity fields (`id`, `kind`,
 * `sourceCharacterId`) or a plain-object `payload`, de-duplicates ids (first
 * record wins), normalizes the known scalar fields defensively, and strips
 * recursive snapshot data from payloads. Unknown extra fields on valid
 * records are preserved, matching the repo's normalization conventions.
 * Never invents snapshot records.
 *
 * @param {unknown} value
 * @returns {CharacterSnapshot[]}
 */
export function normalizeCharacterSnapshots(value) {
  if (!Array.isArray(value)) return [];
  /** @type {CharacterSnapshot[]} */
  const out = [];
  const seenIds = new Set();
  for (const raw of value) {
    if (!isPlainRecord(raw)) continue;
    const id = cleanString(raw.id);
    const kind = cleanString(raw.kind);
    const sourceCharacterId = cleanString(raw.sourceCharacterId);
    if (!id || !kind || !sourceCharacterId || seenIds.has(id)) continue;
    if (!isPlainRecord(raw.payload)) continue;

    const record = /** @type {CharacterSnapshot} */ ({
      ...raw,
      id,
      kind,
      sourceCharacterId,
      sourceName: cleanString(raw.sourceName),
      classSummary: cleanString(raw.classSummary),
      fromLevel: finiteNumberOrNull(raw.fromLevel),
      toLevel: finiteNumberOrNull(raw.toLevel),
      toClassId: cleanString(raw.toClassId),
      createdAt: cleanString(raw.createdAt),
      schemaVersion: finiteNumberOrNull(raw.schemaVersion),
      payload: stripSnapshotRecursion(raw.payload)
    });
    seenIds.add(id);
    out.push(record);
  }
  return out;
}

/**
 * Appends a snapshot record, replacing any existing record with the same
 * `(kind, sourceCharacterId, fromLevel)` at its original position.
 *
 * Idempotency rule (spec §4.3): a character can only be at a given total
 * level once per lifetime under the supported progression paths (Level Up
 * appends exactly one level; down-leveling is ratified out of scope), so the
 * key is unique per character by construction and the replacement is a
 * belt-and-suspenders guard against retried or duplicated apply events.
 * Documented limitation: while Edit in Builder still allows removing levels,
 * re-crossing the same level replaces that level's earlier snapshot; that
 * window closes when Edit in Builder retires (spec phase R5).
 *
 * @param {CharacterSnapshot[]} snapshots mutated in place
 * @param {CharacterSnapshot} record
 * @returns {boolean}
 */
export function appendPreLevelUpSnapshot(snapshots, record) {
  if (!Array.isArray(snapshots) || !isPlainRecord(record)) return false;
  const idx = snapshots.findIndex((existing) => (
    isPlainRecord(existing) &&
    existing.kind === record.kind &&
    existing.sourceCharacterId === record.sourceCharacterId &&
    existing.fromLevel === record.fromLevel
  ));
  if (idx >= 0) snapshots[idx] = record;
  else snapshots.push(record);
  return true;
}

// ---------------------------------------------------------------------------
// Phase R2 — restore engine (non-UI). Restoring a snapshot creates a separate
// playable character with a new stable id; it never mutates the source
// character, the stored snapshot, or their external note/portrait records.
// ---------------------------------------------------------------------------

/**
 * A note-copy instruction produced by preparation and executed by the commit:
 * the external spell-note text stored under the old (source) row id is copied
 * to the regenerated row id's key so source and restored notes stay
 * independently editable.
 * @typedef {{ oldRowId: string, newRowId: string }} RestoredNoteCopy
 */

/**
 * The staged result of preparing a restore. Pure data — nothing has been
 * written anywhere yet. `character.imgBlobId` is null until the commit stages
 * the portrait duplicate described by `portraitCopy`.
 * @typedef {{
 *   character: CharacterEntry,
 *   nameBase: string,
 *   sourceSnapshotId: string,
 *   sourceCharacterId: string,
 *   noteCopies: RestoredNoteCopy[],
 *   portraitCopy: { sourceBlobId: string } | null,
 *   provenance: { restoredFromSnapshotId: string, restoredFromCharacterId: string, restoredAt: string },
 *   committed?: boolean
 * }} StagedCharacterRestore
 */

/**
 * Resolves a snapshot record by id from a snapshot collection. Returns null
 * when the id is blank, the collection is not an array, or no valid record
 * matches.
 *
 * @param {unknown} snapshots
 * @param {unknown} snapshotId
 * @returns {CharacterSnapshot | null}
 */
export function getCharacterSnapshotById(snapshots, snapshotId) {
  const id = cleanString(snapshotId);
  if (!id || !Array.isArray(snapshots)) return null;
  const found = snapshots.find((record) => isPlainRecord(record) && record.id === id);
  return found ? /** @type {CharacterSnapshot} */ (found) : null;
}

/**
 * Restored-name collision resolution (spec §3.4): the base name is used
 * verbatim unless an existing character already has it (case-insensitive,
 * trimmed), in which case ` (2)`, ` (3)`, … are tried in order and the first
 * free suffix wins. Deterministic and pure. Names are never truncated.
 *
 * @param {string} nameBase
 * @param {unknown} existingNames
 * @returns {string}
 */
export function resolveRestoredCharacterName(nameBase, existingNames) {
  const base = cleanString(nameBase) || RESTORED_CHARACTER_FALLBACK_NAME;
  /** @type {Set<string>} */
  const taken = new Set();
  for (const name of Array.isArray(existingNames) ? existingNames : []) {
    const key = cleanString(name).toLowerCase();
    if (key) taken.add(key);
  }
  if (!taken.has(base.toLowerCase())) return base;
  for (let suffix = 2; suffix <= 9999; suffix += 1) {
    const candidate = `${base} (${suffix})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error("Could not find a free name for the restored character.");
}

/**
 * Spell-row id factory matching the sheet's row-id shape
 * (`spell_<rand36>_<ts36>`, see spellsPanel/builderSheetSeeding).
 * @returns {string}
 */
function newRestoredSpellRowId() {
  return `spell_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

/**
 * Collects every spell-row id owned by a character entry into `into`.
 * @param {unknown} character
 * @param {Set<string>} into
 * @returns {void}
 */
function collectSpellRowIds(character, into) {
  if (!isPlainRecord(character)) return;
  const spells = isPlainRecord(character.spells) ? character.spells : null;
  const levels = Array.isArray(spells?.levels) ? spells.levels : [];
  for (const level of levels) {
    if (!isPlainRecord(level) || !Array.isArray(level.spells)) continue;
    for (const row of level.spells) {
      if (!isPlainRecord(row)) continue;
      const id = cleanString(row.id);
      if (id) into.add(id);
    }
  }
}

/**
 * Generates an id via `factory` that is not in `reserved`, retrying a bounded
 * number of times. Throws when no free id can be found (only reachable with a
 * degenerate injected factory).
 * @param {() => string} factory
 * @param {Set<string>} reserved
 * @param {string} what
 * @returns {string}
 */
function allocateUniqueId(factory, reserved, what) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = cleanString(factory());
    if (candidate && !reserved.has(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a unique ${what} for the restored character.`);
}

/**
 * Prepares a restored playable character from a snapshot record. Pure: no
 * storage access, no state mutation, and the stored snapshot is never touched
 * (all work happens on a deep clone of its payload). Throws on any snapshot
 * that cannot safely become a playable character.
 *
 * Pipeline (spec §3.2):
 * 1. Deep-clone the payload and strip recursive snapshot data.
 * 2. Migrate-through the canonical `migrateState` pipeline (injected to keep
 *    this module state-import-free). The snapshot's stored `schemaVersion` is
 *    forwarded only so future-version payloads keep migrateState's existing
 *    pass-through stance; for all current and past versions the invariant
 *    re-run tail makes the outcome identical with or without it.
 * 3. Allocate a new top-level character id (canonical `char_…` generator),
 *    collision-checked against existing entries and the source character id.
 * 4. Regenerate every spell-row id (they key external note texts), recording
 *    an old→new map for the commit's note copies. All other nested ids —
 *    attacks, resources, inventory, feature cards, spell-level ids,
 *    featureUses keys, builderSeed markers, calc blocks, content refs — are
 *    preserved verbatim.
 * 5. Plan the portrait duplicate (`portraitCopy`) and null the restored
 *    entry's `imgBlobId` until the commit stages the copy.
 * 6. Stamp provenance (`restoredFromSnapshotId`, `restoredFromCharacterId`,
 *    `restoredAt`) on the open entry shape.
 * 7. Apply collision-safe naming (spec §3.4) against current entry names.
 *
 * @param {{
 *   snapshot: CharacterSnapshot | Record<string, unknown> | null | undefined,
 *   existingCharacters?: unknown,
 *   migrateState: (raw: unknown) => import("../state.js").State,
 *   createCharacterId?: () => string,
 *   createRowId?: () => string,
 *   now?: () => string
 * }} options
 * @returns {StagedCharacterRestore}
 */
export function prepareRestoredCharacter(options) {
  const {
    snapshot,
    existingCharacters,
    migrateState,
    createCharacterId,
    createRowId,
    now
  } = options || {};
  if (typeof migrateState !== "function") {
    throw new Error("prepareRestoredCharacter: migrateState is required.");
  }
  if (!isPlainRecord(snapshot)) throw new Error("No snapshot to restore.");

  const sourceSnapshotId = cleanString(snapshot.id);
  if (!sourceSnapshotId) throw new Error("Snapshot is missing its id.");
  const kind = cleanString(snapshot.kind);
  if (kind !== PRE_LEVEL_UP_SNAPSHOT_KIND) {
    throw new Error(`Unsupported snapshot kind "${kind || "unknown"}".`);
  }
  const sourceCharacterId = cleanString(snapshot.sourceCharacterId);
  if (!sourceCharacterId) throw new Error("Snapshot is missing its source character id.");
  if (!isPlainRecord(snapshot.payload)) throw new Error("Snapshot payload is missing or malformed.");

  // 1. Deep-clone the payload; the stored snapshot is never mutated.
  /** @type {Record<string, unknown>} */
  let payloadClone;
  try {
    payloadClone = JSON.parse(JSON.stringify(snapshot.payload));
  } catch {
    throw new Error("Snapshot payload could not be cloned.");
  }
  if (!isPlainRecord(payloadClone)) throw new Error("Snapshot payload is malformed.");
  stripSnapshotRecursion(payloadClone);

  // 2. Migrate-through the canonical pipeline on the smallest
  // migration-owned shape.
  const storedSchemaVersion = finiteNumberOrNull(snapshot.schemaVersion);
  /** @type {Record<string, unknown>} */
  const migrationWrapper = {
    ...(storedSchemaVersion != null ? { schemaVersion: storedSchemaVersion } : {}),
    characters: { activeId: null, entries: [payloadClone] }
  };
  /** @type {import("../state.js").State} */
  let migrated;
  try {
    migrated = migrateState(migrationWrapper);
  } catch (err) {
    throw new Error("Snapshot payload could not be migrated.", { cause: err });
  }
  const migratedEntries = Array.isArray(migrated?.characters?.entries)
    ? migrated.characters.entries
    : [];
  const character = isPlainRecord(migratedEntries[0])
    ? /** @type {CharacterEntry & Record<string, unknown>} */ (migratedEntries[0])
    : null;
  if (!character) {
    throw new Error("Snapshot payload could not be normalized into a playable character.");
  }
  // Defense in depth: campaign snapshot registries must never ride on an
  // entry (normalization already strips them at capture and load).
  stripSnapshotRecursion(character);

  const existingEntries = Array.isArray(existingCharacters) ? existingCharacters : [];

  // 3. New top-level identity. The restored id must not collide with any
  // existing entry or with the source character id (tracker cards may still
  // reference a deleted source).
  /** @type {Set<string>} */
  const takenCharacterIds = new Set([sourceCharacterId]);
  const priorPayloadId = cleanString(character.id);
  if (priorPayloadId) takenCharacterIds.add(priorPayloadId);
  for (const entry of existingEntries) {
    if (!isPlainRecord(entry)) continue;
    const id = cleanString(entry.id);
    if (id) takenCharacterIds.add(id);
  }
  const makeCharacterId = typeof createCharacterId === "function"
    ? createCharacterId
    : () => makeDefaultCharacterEntry().id;
  character.id = allocateUniqueId(makeCharacterId, takenCharacterIds, "character id");

  // 4. Regenerate spell-row ids (they key external IndexedDB note texts;
  // keeping them would share mutable note storage with the source). New ids
  // must not collide with any live row id in the campaign, or a staged note
  // copy could overwrite a live note.
  /** @type {Set<string>} */
  const reservedRowIds = new Set();
  for (const entry of existingEntries) collectSpellRowIds(entry, reservedRowIds);
  collectSpellRowIds(character, reservedRowIds);
  const makeRowId = typeof createRowId === "function" ? createRowId : newRestoredSpellRowId;
  /** @type {RestoredNoteCopy[]} */
  const noteCopies = [];
  const spellLevels = isPlainRecord(character.spells) && Array.isArray(character.spells.levels)
    ? character.spells.levels
    : [];
  for (const level of spellLevels) {
    if (!isPlainRecord(level) || !Array.isArray(level.spells)) continue;
    for (const row of level.spells) {
      if (!isPlainRecord(row)) continue;
      const oldRowId = cleanString(row.id);
      const newRowId = allocateUniqueId(makeRowId, reservedRowIds, "spell row id");
      reservedRowIds.add(newRowId);
      row.id = newRowId;
      if (oldRowId) noteCopies.push({ oldRowId, newRowId });
    }
  }

  // 5. Portrait-copy plan. The commit duplicates the source blob and assigns
  // the staged id; a missing source blob fails soft to null.
  const sourcePortraitBlobId = cleanString(character.imgBlobId);
  const portraitCopy = sourcePortraitBlobId ? { sourceBlobId: sourcePortraitBlobId } : null;
  character.imgBlobId = null;

  // 6. Provenance on the open entry shape (the builderSeed precedent — no
  // schema migration needed for additive optional fields).
  const restoredAt = (typeof now === "function" ? cleanString(now()) : "") || new Date().toISOString();
  character.restoredFromSnapshotId = sourceSnapshotId;
  character.restoredFromCharacterId = sourceCharacterId;
  character.restoredAt = restoredAt;

  // 7. Naming (spec §3.4). The pre-Level-Up level comes from the snapshot;
  // a normalized record that lost it falls back to the migrated payload's
  // own level count.
  const storedFromLevel = finiteNumberOrNull(snapshot.fromLevel);
  let fromLevel = storedFromLevel != null && storedFromLevel >= 1 ? Math.trunc(storedFromLevel) : 0;
  if (!fromLevel) fromLevel = normalizeBuildLevels(character.build).length;
  if (fromLevel < 1) throw new Error("Snapshot has no usable pre-Level-Up level.");
  const sourceName = cleanString(snapshot.sourceName)
    || cleanString(character.name)
    || RESTORED_CHARACTER_FALLBACK_NAME;
  const nameBase = `${sourceName} — Restored Level ${fromLevel}`;
  const existingNames = existingEntries.map((entry) => (isPlainRecord(entry) ? entry.name : ""));
  character.name = resolveRestoredCharacterName(nameBase, existingNames);

  return {
    character: /** @type {CharacterEntry} */ (character),
    nameBase,
    sourceSnapshotId,
    sourceCharacterId,
    noteCopies,
    portraitCopy,
    provenance: {
      restoredFromSnapshotId: sourceSnapshotId,
      restoredFromCharacterId: sourceCharacterId,
      restoredAt
    }
  };
}

/**
 * @typedef {{
 *   state: unknown,
 *   SaveManager: { markDirty: () => unknown },
 *   mutateState: (mutator: (state: any) => unknown, options?: { queueSave?: boolean }) => unknown,
 *   getBlob: (id: string) => Promise<Blob | null>,
 *   putBlob: (blob: Blob) => Promise<string>,
 *   deleteBlob: (id: string) => Promise<void>,
 *   getText: (id: string) => Promise<string>,
 *   putText: (text: string, id: string) => Promise<unknown>,
 *   deleteText: (id: string) => Promise<void>,
 *   activate?: boolean
 * }} CommitRestoredCharacterDeps
 */

/**
 * @param {unknown} stateLike
 * @returns {string}
 */
function getActiveCampaignId(stateLike) {
  if (!isPlainRecord(stateLike) || !isPlainRecord(stateLike.appShell)) return "";
  return cleanString(stateLike.appShell.activeCampaignId);
}

/**
 * Plain deep clone of the characters collection for rollback (the
 * commitImport precedent — JSON-safe by construction).
 * @param {unknown} stateLike
 * @returns {unknown}
 */
function snapshotCharactersCollection(stateLike) {
  if (!isPlainRecord(stateLike)) return null;
  try {
    return JSON.parse(JSON.stringify(stateLike.characters ?? null));
  } catch {
    return null;
  }
}

/**
 * Commits a staged restore, mirroring the `commitImport` protocol
 * (characterPortability.js): every external write is staged **before** the
 * state mutation, and any failure rolls the staged records back so no
 * partially-restored playable character can exist.
 *
 * Order and guarantees:
 * 1. Stage the portrait duplicate (`getBlob` → `putBlob`). A missing source
 *    blob fails soft (restored `imgBlobId` stays null); a read/write failure
 *    aborts before anything else is written.
 * 2. Stage the spell-note copies at their **current** values (spec §3.3):
 *    for each old→new row id with a non-empty stored note, `putText` under
 *    the new key. Missing notes are skipped (fail-soft). Any copy failure
 *    deletes the already-staged records and aborts — no restored character
 *    exists after a note-copy failure.
 * 3. Mutate state: append exactly one entry (double-commit guarded by the
 *    staged `committed` latch and an entry-id check inside the mutation) and
 *    re-resolve the restored name against the live entries. `activate`
 *    defaults to false — a domain-only restore never silently changes the
 *    active character; the R3 UI opts in per spec §7. On mutation failure
 *    the characters collection is restored from a pre-mutation clone and all
 *    staged external records are deleted.
 * 4. `SaveManager.markDirty()` queues the campaign persist. Persistence
 *    failure afterwards follows the SaveManager ERROR contract (one atomic
 *    vault write — never partial); staged IndexedDB records are then
 *    referenced only by the unpersisted in-memory entry, so a reload leaves
 *    them unreachable orphans, never shared or dangling references.
 *
 * @param {StagedCharacterRestore} staged
 * @param {CommitRestoredCharacterDeps} deps
 * @returns {Promise<{ characterId: string, name: string }>}
 */
export async function commitRestoredCharacter(staged, deps) {
  if (!isPlainRecord(staged) || !isPlainRecord(staged.character)) {
    throw new Error("commitRestoredCharacter: staged restore is required.");
  }
  if (staged.committed) {
    throw new Error("This restore has already been committed.");
  }
  const {
    state,
    SaveManager,
    mutateState,
    getBlob,
    putBlob,
    deleteBlob,
    getText,
    putText,
    deleteText,
    activate = false
  } = deps || {};
  if (typeof SaveManager?.markDirty !== "function") throw new Error("commitRestoredCharacter: SaveManager.markDirty is required.");
  if (typeof mutateState !== "function") throw new Error("commitRestoredCharacter: mutateState is required.");
  if (typeof getBlob !== "function") throw new Error("commitRestoredCharacter: getBlob is required.");
  if (typeof putBlob !== "function") throw new Error("commitRestoredCharacter: putBlob is required.");
  if (typeof deleteBlob !== "function") throw new Error("commitRestoredCharacter: deleteBlob is required.");
  if (typeof getText !== "function") throw new Error("commitRestoredCharacter: getText is required.");
  if (typeof putText !== "function") throw new Error("commitRestoredCharacter: putText is required.");
  if (typeof deleteText !== "function") throw new Error("commitRestoredCharacter: deleteText is required.");

  const campaignId = getActiveCampaignId(state);
  if (!campaignId) throw new Error("No active campaign.");

  const character = /** @type {CharacterEntry & Record<string, unknown>} */ (staged.character);
  const noteCopies = Array.isArray(staged.noteCopies) ? staged.noteCopies : [];

  /** @type {string | null} */
  let stagedBlobId = null;
  /** @type {string[]} */
  const stagedTextKeys = [];
  const cleanupStagedRecords = async () => {
    for (const key of stagedTextKeys) {
      try {
        await deleteText(key);
      } catch (err) {
        console.warn("commitRestoredCharacter: failed to clean up staged spell note.", err);
      }
    }
    if (stagedBlobId) {
      try {
        await deleteBlob(stagedBlobId);
      } catch (err) {
        console.warn("commitRestoredCharacter: failed to clean up staged portrait blob.", err);
      }
    }
  };

  // 1. Stage the portrait duplicate.
  const sourceBlobId = isPlainRecord(staged.portraitCopy)
    ? cleanString(staged.portraitCopy.sourceBlobId)
    : "";
  if (sourceBlobId) {
    /** @type {Blob | null} */
    let sourceBlob = null;
    try {
      sourceBlob = await getBlob(sourceBlobId);
    } catch (err) {
      throw new Error("Failed to read the source portrait.", { cause: err });
    }
    if (sourceBlob) {
      try {
        stagedBlobId = await putBlob(sourceBlob);
      } catch (err) {
        throw new Error("Failed to copy the portrait.", { cause: err });
      }
    }
    // Missing source blob: fail soft — the restored character keeps a null
    // portrait reference and the restore proceeds (spec §3.1).
  }

  // 2. Stage the spell-note copies at their current values.
  try {
    for (const copy of noteCopies) {
      if (!isPlainRecord(copy)) continue;
      const oldRowId = cleanString(copy.oldRowId);
      const newRowId = cleanString(copy.newRowId);
      if (!oldRowId || !newRowId) continue;
      const noteText = await getText(textKey_spellNotes(campaignId, oldRowId));
      if (typeof noteText !== "string" || noteText === "") continue;
      const newKey = textKey_spellNotes(campaignId, newRowId);
      await putText(noteText, newKey);
      stagedTextKeys.push(newKey);
    }
  } catch (err) {
    await cleanupStagedRecords();
    throw new Error("Failed to copy spell notes.", { cause: err });
  }

  // 3. Commit the entry (single state mutation, rollback on failure).
  character.imgBlobId = stagedBlobId;
  const previousCharacters = snapshotCharactersCollection(state);
  try {
    const result = mutateState((draft) => {
      if (!isPlainRecord(draft)) throw new Error("Character collection is unavailable.");
      if (!isPlainRecord(draft.characters)) {
        draft.characters = { activeId: null, entries: [], snapshots: [] };
      }
      const characters = /** @type {{ activeId: string | null, entries?: unknown, snapshots?: unknown }} */ (draft.characters);
      if (!Array.isArray(characters.entries)) characters.entries = [];
      const entries = /** @type {CharacterEntry[]} */ (characters.entries);
      if (entries.some((entry) => isPlainRecord(entry) && entry.id === character.id)) {
        throw new Error("This restore has already been committed.");
      }
      // Re-resolve the name against the live entries so a commit that lands
      // after other changes keeps collision-safe naming.
      const nameBase = cleanString(staged.nameBase) || cleanString(character.name);
      character.name = resolveRestoredCharacterName(
        nameBase,
        entries.map((entry) => (isPlainRecord(entry) ? entry.name : ""))
      );
      entries.push(character);
      if (activate) characters.activeId = character.id;
      return true;
    }, { queueSave: false });
    if (result === false) throw new Error("Failed to add the restored character.");
    staged.committed = true;
    SaveManager.markDirty();
  } catch (err) {
    try {
      if (isPlainRecord(state)) {
        /** @type {Record<string, unknown>} */ (state).characters = previousCharacters;
      }
    } catch (restoreErr) {
      console.warn("commitRestoredCharacter: failed to restore character state after commit failure.", restoreErr);
    }
    await cleanupStagedRecords();
    throw err;
  }

  return { characterId: character.id, name: character.name };
}

/**
 * Convenience orchestrator for a full restore: resolve the snapshot from the
 * live state, prepare the restored copy, and commit it. This is the seam the
 * R3 UI is expected to call.
 *
 * @param {{
 *   snapshotId: string,
 *   migrateState: (raw: unknown) => import("../state.js").State,
 *   createCharacterId?: () => string,
 *   createRowId?: () => string,
 *   now?: () => string
 * } & CommitRestoredCharacterDeps} options
 * @returns {Promise<{ characterId: string, name: string }>}
 */
export async function restoreCharacterFromSnapshot(options) {
  const {
    snapshotId,
    migrateState,
    createCharacterId,
    createRowId,
    now,
    ...commitDeps
  } = /** @type {typeof options} */ (options || {});
  const stateLike = isPlainRecord(commitDeps.state) ? commitDeps.state : null;
  const collection = stateLike && isPlainRecord(stateLike.characters) ? stateLike.characters : null;
  const snapshot = getCharacterSnapshotById(collection?.snapshots, snapshotId);
  if (!snapshot) throw new Error("Snapshot not found.");
  const staged = prepareRestoredCharacter({
    snapshot,
    existingCharacters: Array.isArray(collection?.entries) ? collection.entries : [],
    migrateState,
    createCharacterId,
    createRowId,
    now
  });
  return commitRestoredCharacter(staged, commitDeps);
}
