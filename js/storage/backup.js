// @ts-check
// js/storage/backup.js — import/export/reset local backups
//
// NOTE: This module is dependency-injected so it can be used from app.js
// without creating circular imports.

import { uiAlert, uiConfirm } from "../ui/dialogs.js";
import { deleteText, getTextRecord, textKey_spellNotes } from "./texts-idb.js";

const MAX_BACKUP_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_BLOBS = 200;

/** @typedef {typeof import("../state.js").state} AppState */
/** @typedef {ReturnType<typeof import("../state.js").sanitizeForSave>} SanitizedState */
/** @typedef {Partial<SanitizedState> & Record<string, unknown>} BackupStateLike */
/** @typedef {Record<string, string>} BackupAssetMap */

/**
 * @typedef {{
 *   version: 2,
 *   exportedAt: string,
 *   state: SanitizedState,
 *   blobs: BackupAssetMap,
 *   texts: BackupAssetMap
 * }} BackupEnvelopeV2
 */

/**
 * @typedef {{
 *   version: 1,
 *   state: BackupStateLike
 * }} BackupEnvelopeV1
 */

/**
 * @typedef {{
 *   incomingState: BackupStateLike,
 *   incomingBlobs: BackupAssetMap,
 *   incomingTexts: BackupAssetMap
 * }} NormalizedIncomingBackup
 */

/**
 * @typedef {{
 *   state: AppState,
 *   ensureMapManager?: typeof import("../state.js").ensureMapManager,
 *   getBlob: typeof import("./blobs.js").getBlob,
 *   blobToDataUrl: typeof import("./blobs.js").blobToDataUrl,
 *   getAllTexts: typeof import("./texts-idb.js").getAllTexts,
 *   sanitizeForSave: typeof import("../state.js").sanitizeForSave
 * }} ExportBackupDeps
 */

/**
 * @typedef {{
 *   state: AppState,
 *   ensureMapManager?: typeof import("../state.js").ensureMapManager,
 *   migrateState: typeof import("../state.js").migrateState,
 *   saveAll: () => boolean | Promise<boolean>,
 *   putBlob: typeof import("./blobs.js").putBlob,
 *   putText: typeof import("./texts-idb.js").putText,
 *   deleteBlob: typeof import("./blobs.js").deleteBlob,
 *   dataUrlToBlob: typeof import("./blobs.js").dataUrlToBlob,
 *   afterImport?: () => void | Promise<void>,
 *   sanitizeForSave: typeof import("../state.js").sanitizeForSave
 * }} ImportBackupDeps
 */

/**
 * @typedef {{
 *   ACTIVE_TAB_KEY: string,
 *   STORAGE_KEY: string,
 *   clearAllBlobs: typeof import("./blobs.js").clearAllBlobs,
 *   clearAllTexts: typeof import("./texts-idb.js").clearAllTexts,
 *   flush?: () => void | Promise<void>,
 *   setStatus?: (message: string) => void
 * }} ResetAllDeps
 */

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {unknown} value
 * @returns {value is BackupAssetMap}
 */
function isStringRecord(value) {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

/**
 * @param {unknown} s
 * @returns {s is string}
 */
function isSafeImageDataUrl(s) {
  return typeof s === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(s);
}

/**
 * @param {Set<string>} target
 * @param {unknown} maybeId
 * @returns {void}
 */
function addReferencedId(target, maybeId) {
  if (typeof maybeId !== "string") return;
  const id = maybeId.trim();
  if (!id) return;
  target.add(id);
}

/**
 * @param {Set<string>} target
 * @param {unknown} items
 * @returns {void}
 */
function collectPortraitBlobIds(target, items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isPlainObject(item)) continue;
    addReferencedId(target, item.imgBlobId);
  }
}

/**
 * @param {BackupStateLike | null | undefined} stateLike
 * @returns {Set<string>}
 */
export function collectReferencedBlobIds(stateLike) {
  const ids = new Set();
  if (!isPlainObject(stateLike)) return ids;

  const tracker = isPlainObject(stateLike.tracker) ? stateLike.tracker : null;
  if (tracker) {
    collectPortraitBlobIds(ids, tracker.npcs);
    collectPortraitBlobIds(ids, tracker.party);
    collectPortraitBlobIds(ids, tracker.locationsList);
  }

  const character = isPlainObject(stateLike.character) ? stateLike.character : null;
  if (character) addReferencedId(ids, character.imgBlobId);

  const map = isPlainObject(stateLike.map) ? stateLike.map : null;
  if (map) {
    // Keep legacy top-level map blob fields in the scan so cleanup remains safe
    // even if an older state shape shows up here.
    addReferencedId(ids, map.bgBlobId);
    addReferencedId(ids, map.drawingBlobId);

    if (Array.isArray(map.maps)) {
      for (const mp of map.maps) {
        if (!isPlainObject(mp)) continue;
        addReferencedId(ids, mp.bgBlobId);
        addReferencedId(ids, mp.drawingBlobId);
      }
    }
  }

  return ids;
}

/**
 * @param {BackupStateLike | null | undefined} stateLike
 * @returns {Set<string>}
 */
export function collectReferencedTextIds(stateLike) {
  const ids = new Set();
  if (!isPlainObject(stateLike)) return ids;

  const character = isPlainObject(stateLike.character) ? stateLike.character : null;
  const spells = isPlainObject(character?.spells) ? character.spells : null;
  const levels = Array.isArray(spells?.levels) ? spells.levels : [];

  for (const level of levels) {
    if (!isPlainObject(level) || !Array.isArray(level.spells)) continue;
    for (const spell of level.spells) {
      if (!isPlainObject(spell)) continue;
      if (typeof spell.id !== "string") continue;
      const spellId = spell.id.trim();
      if (!spellId) continue;
      addReferencedId(ids, textKey_spellNotes(spellId));
    }
  }

  return ids;
}

/**
 * @param {unknown} state
 * @returns {void}
 */
function validateIncomingStateShape(state) {
  if (!isPlainObject(state)) throw new Error("Backup state must be an object.");

  if (Object.prototype.hasOwnProperty.call(state, "schemaVersion") && !Number.isFinite(state.schemaVersion)) {
    throw new Error("Backup state.schemaVersion must be a number.");
  }
  if (Object.prototype.hasOwnProperty.call(state, "tracker") && !isPlainObject(state.tracker)) {
    throw new Error("Backup state.tracker must be an object.");
  }
  if (Object.prototype.hasOwnProperty.call(state, "character") && !isPlainObject(state.character)) {
    throw new Error("Backup state.character must be an object.");
  }
  if (Object.prototype.hasOwnProperty.call(state, "map") && !isPlainObject(state.map)) {
    throw new Error("Backup state.map must be an object.");
  }
  if (Object.prototype.hasOwnProperty.call(state, "ui") && !isPlainObject(state.ui)) {
    throw new Error("Backup state.ui must be an object.");
  }
}

/**
 * @param {AppState | SanitizedState} source
 * @returns {AppState}
 */
function cloneAppState(source) {
  return /** @type {AppState} */ (JSON.parse(JSON.stringify(source)));
}

/**
 * @param {SanitizedState} source
 * @returns {SanitizedState}
 */
function cloneSanitizedState(source) {
  return /** @type {SanitizedState} */ (JSON.parse(JSON.stringify(source)));
}

/**
 * @param {AppState} target
 * @param {AppState | SanitizedState} source
 * @returns {void}
 */
function replaceStateBuckets(target, source) {
  target.schemaVersion = source.schemaVersion;
  target.tracker = /** @type {AppState["tracker"]} */ (source.tracker);
  target.character = /** @type {AppState["character"]} */ (source.character);
  target.map = /** @type {AppState["map"]} */ (source.map);
  target.ui = /** @type {AppState["ui"]} */ (source.ui);
}

/**
 * @param {AppState} target
 * @param {Map<string, string>} idMap
 * @returns {void}
 */
function remapBlobIds(target, idMap) {
  if (idMap.size === 0) return;
  const remap = (id) => (id ? (idMap.get(id) || id) : id);

  for (const npc of target.tracker.npcs) {
    if (npc.imgBlobId) npc.imgBlobId = remap(npc.imgBlobId);
  }
  for (const partyMember of target.tracker.party) {
    if (partyMember.imgBlobId) partyMember.imgBlobId = remap(partyMember.imgBlobId);
  }
  for (const location of target.tracker.locationsList) {
    if (location.imgBlobId) location.imgBlobId = remap(location.imgBlobId);
  }
  for (const mapEntry of target.map.maps) {
    if (mapEntry.bgBlobId) mapEntry.bgBlobId = remap(mapEntry.bgBlobId);
    if (mapEntry.drawingBlobId) mapEntry.drawingBlobId = remap(mapEntry.drawingBlobId);
  }
  if (target.character.imgBlobId) target.character.imgBlobId = remap(target.character.imgBlobId);
}

/**
 * @param {HTMLInputElement} input
 * @returns {void}
 */
function resetFileInput(input) {
  input.value = "";
}

/**
 * @param {unknown} err
 * @param {string} fallback
 * @returns {string}
 */
function getErrorMessage(err, fallback) {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * @param {unknown} parsed
 * @returns {NormalizedIncomingBackup}
 */
function normalizeIncomingBackup(parsed) {
  if (!isPlainObject(parsed)) throw new Error("Unsupported backup format.");

  if (parsed.version === 2) {
    validateIncomingStateShape(parsed.state);
    const incomingBlobs = parsed.blobs ?? {};
    const incomingTexts = parsed.texts ?? {};
    if (!isStringRecord(incomingBlobs)) throw new Error("Backup blobs must be an object of strings.");
    if (!isStringRecord(incomingTexts)) throw new Error("Backup texts must be an object of strings.");
    return {
      incomingState: /** @type {BackupStateLike} */ (parsed.state),
      incomingBlobs,
      incomingTexts
    };
  }

  if (parsed.version === 1) {
    validateIncomingStateShape(parsed.state);
    return {
      incomingState: /** @type {BackupStateLike} */ (parsed.state),
      incomingBlobs: {},
      incomingTexts: {}
    };
  }

  if (Object.prototype.hasOwnProperty.call(parsed, "version")) {
    throw new Error("Unsupported backup format.");
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "state")) {
    throw new Error("Unsupported backup format.");
  }

  validateIncomingStateShape(parsed);
  return {
    incomingState: /** @type {BackupStateLike} */ (parsed),
    incomingBlobs: {},
    incomingTexts: {}
  };
}

/**
 * @param {ExportBackupDeps} deps
 * @returns {Promise<void>}
 */
export async function exportBackup(deps) {
  const {
    state,
    ensureMapManager,
    getBlob,
    blobToDataUrl,
    getAllTexts,
    sanitizeForSave
  } = deps;

  if (typeof sanitizeForSave !== "function") {
    throw new Error("exportBackup: sanitizeForSave() is required");
  }

  ensureMapManager?.();
  const ids = collectReferencedBlobIds(state);

  // Turn blobs into dataURLs inside the backup file
  /** @type {BackupAssetMap} */
  const blobs = {};
  for (const id of ids) {
    try {
      const blob = await getBlob(id);
      if (blob) blobs[id] = await blobToDataUrl(blob);
    } catch (err) {
      console.warn("Skipping image during export (failed to read):", id, err);
    }
  }

  const backup = /** @type {BackupEnvelopeV2} */ ({
    version: 2,
    exportedAt: new Date().toISOString(),
    state: sanitizeForSave(state),
    blobs,
    texts: await getAllTexts()
  });

  const fileBlob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(fileBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `campaign-backup-${new Date().toISOString().slice(0, 10)}.json`;
  try {
    a.click();
  } catch (err) {
    console.error("Export download failed:", err);
    await uiAlert("Export failed. Try again, or use a different browser.", { title: "Export failed" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {Event} e
 * @param {ImportBackupDeps} deps
 * @returns {Promise<void>}
 */
export async function importBackup(e, deps) {
  const {
    state,
    ensureMapManager,
    migrateState,
    saveAll,
    putBlob,
    putText,
    deleteBlob,
    dataUrlToBlob,
    afterImport,
    sanitizeForSave
  } = deps;

  const input = e.target;
  if (!(input instanceof HTMLInputElement)) return;

  const file = input.files?.[0];
  if (!file) return;

  // ── 1. VALIDATE ────────────────────────────────────────────────────────────
  // No side effects in this section. Bail early if anything looks wrong.

  if (file.size > MAX_BACKUP_BYTES) {
    await uiAlert("Backup file is too large.", { title: "Import failed" });
    resetFileInput(input);
    return;
  }

  let text = "";
  try {
    text = await file.text();
  } catch (err) {
    console.error("Import failed: could not read file:", err);
    await uiAlert("Could not read that file.", { title: "Import failed" });
    resetFileInput(input);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error("Import failed: invalid JSON:", err);
    await uiAlert("That file isn't valid JSON.", { title: "Import failed" });
    resetFileInput(input);
    return;
  }

  let normalized;
  try {
    normalized = normalizeIncomingBackup(parsed);
  } catch (err) {
    console.error("Import failed: unsupported backup format:", err);
    await uiAlert(getErrorMessage(err, "Unsupported backup format."), { title: "Import failed" });
    resetFileInput(input);
    return;
  }

  const { incomingState, incomingBlobs, incomingTexts } = normalized;
  const incomingTextEntries = Object.entries(incomingTexts);

  let migrated;
  try {
    migrated = migrateState(incomingState);
  } catch (err) {
    console.error("Import failed: could not migrate state:", err);
    await uiAlert(getErrorMessage(err, "Backup state is invalid."), { title: "Import failed" });
    resetFileInput(input);
    return;
  }

  const blobEntries = Object.entries(incomingBlobs);
  if (blobEntries.length > MAX_BLOBS) {
    await uiAlert("Backup contains too many images.", { title: "Import failed" });
    resetFileInput(input);
    return;
  }
  for (const [, dataUrl] of blobEntries) {
    if (!isSafeImageDataUrl(dataUrl)) {
      await uiAlert("Backup contains an unsupported image format.", { title: "Import failed" });
      resetFileInput(input);
      return;
    }
  }

  // ── 2. SNAPSHOT ────────────────────────────────────────────────────────────
  // Deep clone current state before touching anything.
  // If anything fails after this point we can restore it.

  let stateSnapshot;
  try {
    stateSnapshot = cloneSanitizedState(sanitizeForSave(state));
  } catch (err) {
    console.error("Import failed: could not snapshot current state:", err);
    await uiAlert("Import failed: could not create a safe restore point.", { title: "Import failed" });
    resetFileInput(input);
    return;
  }

  const oldBlobIds = collectReferencedBlobIds(stateSnapshot);
  const oldTextIds = collectReferencedTextIds(stateSnapshot);

  /** @type {Map<string, { text: string } | null>} */
  const previousTexts = new Map();
  try {
    for (const [textId] of incomingTextEntries) {
      previousTexts.set(textId, await getTextRecord(textId));
    }
  } catch (err) {
    console.error("Import failed: could not snapshot current text data:", err);
    await uiAlert("Import failed: could not create a safe restore point.", { title: "Import failed" });
    resetFileInput(input);
    return;
  }

  // ── ROLLBACK HELPERS ───────────────────────────────────────────────────────
  // Track every new blob written so we can clean up partial writes on failure.
  /** @type {string[]} */
  const writtenBlobIds = [];

  let textRestoreWarned = false;

  /**
   * @returns {Promise<void>}
   */
  const restorePreviousTexts = async () => {
    for (const [textId, previous] of previousTexts) {
      try {
        if (previous) {
          await putText(previous.text, textId);
        } else {
          await deleteText(textId);
        }
      } catch (restoreErr) {
        textRestoreWarned = true;
        console.error("Import rollback: failed to restore text:", textId, restoreErr);
      }
    }
  };

  // Called if something fails BEFORE we touch state.
  /**
   * @param {unknown} err
   * @param {string} [message]
   * @returns {Promise<void>}
   */
  const abort = async (err, message) => {
    for (const id of writtenBlobIds) {
      try { await deleteBlob(id); } catch (_) { }
    }
    console.error("Import failed:", err);
    let alertMessage = message || "Import failed due to an unexpected error.";
    if (textRestoreWarned) {
      alertMessage += " Some previous text notes could not be fully restored.";
    }
    await uiAlert(alertMessage, { title: "Import failed" });
    resetFileInput(input);
  };

  // Called if something fails AFTER we've started mutating state.
  /**
   * @param {unknown} err
   * @param {string} [message]
   * @returns {Promise<void>}
   */
  const rollback = async (err, message) => {
    const restored = cloneSanitizedState(stateSnapshot);
    replaceStateBuckets(state, restored);
    await restorePreviousTexts();
    await abort(err, message);
  };

  // ── 3. WRITE NEW BLOBS ─────────────────────────────────────────────────────
  // Write before clearing old ones. Old blobs stay intact until success.

  /** @type {Map<string, string>} */
  const idMap = new Map();
  for (const [oldId, dataUrl] of blobEntries) {
    let blob;
    try {
      blob = dataUrlToBlob(dataUrl);
    } catch (err) {
      await abort(err, "Import failed: one of the images in this backup is corrupted.");
      return;
    }

    try {
      await putBlob(blob, oldId);
      writtenBlobIds.push(oldId);
    } catch (err) {
      try {
        const newId = await putBlob(blob);
        idMap.set(oldId, newId);
        writtenBlobIds.push(newId);
      } catch (fallbackErr) {
        await abort(fallbackErr, "Import failed while saving images.");
        return;
      }
    }
  }

  // Remap blob IDs in migrated state if any IDs changed during write
  remapBlobIds(migrated, idMap);

  // ── 4. WRITE NEW TEXTS ─────────────────────────────────────────────────────

  for (const [tid, tval] of incomingTextEntries) {
    try {
      await putText(tval, tid);
    } catch (err) {
      await restorePreviousTexts();
      await abort(err, "Import failed: could not store text data.");
      return;
    }
  }

  // ── 5. SWAP STATE ──────────────────────────────────────────────────────────
  // Point of no return. Use rollback from here on if anything fails.

  try {
    const clean = cloneAppState(migrated);
    replaceStateBuckets(state, clean);
    ensureMapManager?.();
  } catch (err) {
    await rollback(err, "Import failed: could not apply backup data. Your previous data has been restored.");
    return;
  }

  // ── 6. SAVE ────────────────────────────────────────────────────────────────

  try {
    const ok = await saveAll();
    if (!ok) {
      await rollback(
        new Error("Import failed: saveAll() reported failure."),
        "Import failed: could not save. Your previous data has been restored."
      );
      return;
    }
  } catch (err) {
    await rollback(err, "Import failed: could not save. Your previous data has been restored.");
    return;
  }

  // ── 7. CLEAN UP OLD DATA ───────────────────────────────────────────────────
  // Only reached on full success. We wait until after save succeeds so a failed
  // import can still roll back to the pre-import state without losing assets it
  // still needs.
  //
  // Cleanup is based on "old references minus new references": if an ID was
  // referenced before import but is no longer referenced by the saved/imported
  // state, it is safe to delete. Any ID still referenced after import is kept.
  //
  // Cleanup errors are non-fatal on purpose. At this point the import already
  // succeeded, so we prefer logging a warning and keeping an orphan over
  // risking a rollback of valid imported data.
  try {
    const finalSavedState = sanitizeForSave(state);
    const newReferencedBlobIds = collectReferencedBlobIds(finalSavedState);
    const newReferencedTextIds = collectReferencedTextIds(finalSavedState);
    const importedBlobIds = new Set();
    const importedTextIds = new Set();

    // Skip IDs written by this import so we never delete newly imported data,
    // even if a backup reused an old ID or carried an extra unreferenced asset.
    for (const blobId of writtenBlobIds) addReferencedId(importedBlobIds, blobId);
    for (const [textId] of incomingTextEntries) addReferencedId(importedTextIds, textId);

    for (const blobId of oldBlobIds) {
      if (newReferencedBlobIds.has(blobId)) continue;
      if (importedBlobIds.has(blobId)) continue;
      try {
        await deleteBlob(blobId);
      } catch (err) {
        console.warn("Import cleanup: failed to delete replaced blob:", blobId, err);
      }
    }

    for (const textId of oldTextIds) {
      if (newReferencedTextIds.has(textId)) continue;
      if (importedTextIds.has(textId)) continue;
      try {
        await deleteText(textId);
      } catch (err) {
        console.warn("Import cleanup: failed to delete replaced text:", textId, err);
      }
    }
  } catch (err) {
    console.warn("Import cleanup: failed to compute selective asset cleanup.", err);
  }


  // ── 8. RELOAD UI ───────────────────────────────────────────────────────────

  if (blobEntries.length === 0) {
    try {
      await uiAlert("This backup did not include images. Existing portraits were kept.", { title: "Import complete" });
    } catch (err) {
      console.warn("Import complete notice failed:", err);
    }
  }

  resetFileInput(input);
  try { await afterImport?.(); } catch (err) {
    console.warn("afterImport hook failed:", err);
  }
}

/**
 * @param {ResetAllDeps} deps
 * @returns {Promise<void>}
 */
export async function resetAll(deps) {
  const {
    ACTIVE_TAB_KEY,
    STORAGE_KEY,
    clearAllBlobs,
    clearAllTexts,
    // Optional: best-effort flush + status before wiping
    flush,
    setStatus
  } = deps;

  const ok = await uiConfirm(
    "Reset everything? This clears your local saved data (including images and large notes)."
  );
  if (!ok) return;

  try {
    setStatus?.("Resetting...");
    // Best effort: if something is dirty, try to write one last time.
    await flush?.();
  } catch (e) {
    // Not fatal — we're about to wipe anyway.
    console.warn("resetAll: flush failed (continuing).", e);
  }

  try {
    localStorage.removeItem(ACTIVE_TAB_KEY);
    localStorage.removeItem(STORAGE_KEY);
    await clearAllBlobs();
    await clearAllTexts();
  } catch (e) {
    console.error("resetAll: wipe failed", e);
    await uiAlert("Reset failed. Check the console for details.");
    return;
  }

  // Reload into clean defaults.
  location.reload();
}
