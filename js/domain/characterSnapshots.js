// @ts-check
// js/domain/characterSnapshots.js — pre-Level-Up character snapshot records
// (Restore Character phase R1; see docs/reference/restore-character-spec.md).
//
// R1 scope: building, normalizing, and appending snapshot records only.
// Restoring a snapshot as a playable copy is phase R2 and does not exist yet.

import { getClassLevelTotals, normalizeBuildLevels } from "./rules/progression.js";
import { getContentByKind } from "./rules/registry.js";

/** @typedef {import("../state.js").CharacterEntry} CharacterEntry */
/** @typedef {import("../state.js").CharacterSnapshot} CharacterSnapshot */

export const PRE_LEVEL_UP_SNAPSHOT_KIND = "pre-level-up";

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
