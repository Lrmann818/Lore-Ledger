// @ts-nocheck
// js/storage/backup.js — import/export/reset local backups
//
// NOTE: This module is dependency-injected so it can be used from app.js
// without creating circular imports.

import { uiAlert, uiConfirm } from "../ui/dialogs.js";
import { deleteText, textKey_spellNotes } from "./texts-idb.js";

const MAX_BACKUP_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_BLOBS = 200;

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isSafeImageDataUrl(s) {
  return typeof s === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(s);
}

function addReferencedId(target, maybeId) {
  if (typeof maybeId !== "string") return;
  const id = maybeId.trim();
  if (!id) return;
  target.add(id);
}

function collectPortraitBlobIds(target, items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isPlainObject(item)) continue;
    addReferencedId(target, item.imgBlobId);
  }
}

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

function normalizeIncomingBackup(parsed) {
  if (!isPlainObject(parsed)) throw new Error("Unsupported backup format.");

  if (parsed.version === 2) {
    validateIncomingStateShape(parsed.state);
    const incomingBlobs = parsed.blobs ?? {};
    const incomingTexts = parsed.texts ?? {};
    if (!isPlainObject(incomingBlobs)) throw new Error("Backup blobs must be an object.");
    if (!isPlainObject(incomingTexts)) throw new Error("Backup texts must be an object.");
    return { incomingState: parsed.state, incomingBlobs, incomingTexts };
  }

  if (parsed.version === 1) {
    validateIncomingStateShape(parsed.state);
    return { incomingState: parsed.state, incomingBlobs: {}, incomingTexts: {} };
  }

  if (Object.prototype.hasOwnProperty.call(parsed, "version")) {
    throw new Error("Unsupported backup format.");
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "state")) {
    throw new Error("Unsupported backup format.");
  }

  validateIncomingStateShape(parsed);
  return { incomingState: parsed, incomingBlobs: {}, incomingTexts: {} };
}

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
  const blobs = {};
  for (const id of ids) {
    try {
      const blob = await getBlob(id);
      if (blob) blobs[id] = await blobToDataUrl(blob);
    } catch (err) {
      console.warn("Skipping image during export (failed to read):", id, err);
    }
  }

  const backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    state: sanitizeForSave(state),
    blobs,
    texts: await getAllTexts()
  };

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

export async function importBackup(e, deps) {
  const {
    state,
    ensureMapManager,
    migrateState,
    saveAll,
    putBlob,
    putText,
    deleteBlob,           // NEW — needed for abort cleanup
    dataUrlToBlob,
    ACTIVE_TAB_KEY,
    STORAGE_KEY,
    afterImport,
    sanitizeForSave
  } = deps;

  const file = e.target.files?.[0];
  if (!file) return;

  // ── 1. VALIDATE ────────────────────────────────────────────────────────────
  // No side effects in this section. Bail early if anything looks wrong.

  if (file.size > MAX_BACKUP_BYTES) {
    await uiAlert("Backup file is too large.", { title: "Import failed" });
    e.target.value = "";
    return;
  }

  let text = "";
  try {
    text = await file.text();
  } catch (err) {
    console.error("Import failed: could not read file:", err);
    await uiAlert("Could not read that file.", { title: "Import failed" });
    e.target.value = "";
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error("Import failed: invalid JSON:", err);
    await uiAlert("That file isn't valid JSON.", { title: "Import failed" });
    e.target.value = "";
    return;
  }

  let normalized;
  try {
    normalized = normalizeIncomingBackup(parsed);
  } catch (err) {
    console.error("Import failed: unsupported backup format:", err);
    await uiAlert(err?.message || "Unsupported backup format.", { title: "Import failed" });
    e.target.value = "";
    return;
  }

  const { incomingState, incomingBlobs, incomingTexts } = normalized;

  let migrated;
  try {
    migrated = migrateState(incomingState);
  } catch (err) {
    console.error("Import failed: could not migrate state:", err);
    await uiAlert(err?.message || "Backup state is invalid.", { title: "Import failed" });
    e.target.value = "";
    return;
  }

  const blobEntries = Object.entries(incomingBlobs);
  if (blobEntries.length > MAX_BLOBS) {
    await uiAlert("Backup contains too many images.", { title: "Import failed" });
    e.target.value = "";
    return;
  }
  for (const [, dataUrl] of blobEntries) {
    if (!isSafeImageDataUrl(dataUrl)) {
      await uiAlert("Backup contains an unsupported image format.", { title: "Import failed" });
      e.target.value = "";
      return;
    }
  }

  // ── 2. SNAPSHOT ────────────────────────────────────────────────────────────
  // Deep clone current state before touching anything.
  // If anything fails after this point we can restore it.

  let stateSnapshot;
  try {
    stateSnapshot = JSON.parse(JSON.stringify(sanitizeForSave(state)));
  } catch (err) {
    console.error("Import failed: could not snapshot current state:", err);
    await uiAlert("Import failed: could not create a safe restore point.", { title: "Import failed" });
    e.target.value = "";
    return;
  }

  const oldBlobIds = collectReferencedBlobIds(stateSnapshot);
  const oldTextIds = collectReferencedTextIds(stateSnapshot);

  // ── ROLLBACK HELPERS ───────────────────────────────────────────────────────
  // Track every new blob written so we can clean up partial writes on failure.
  const writtenBlobIds = [];

  // Called if something fails BEFORE we touch state.
  const abort = async (err, message) => {
    for (const id of writtenBlobIds) {
      try { await deleteBlob(id); } catch (_) { }
    }
    console.error("Import failed:", err);
    await uiAlert(message || "Import failed due to an unexpected error.", { title: "Import failed" });
    e.target.value = "";
  };

  // Called if something fails AFTER we've started mutating state.
  const rollback = async (err, message) => {
    const restored = JSON.parse(JSON.stringify(stateSnapshot));
    state.schemaVersion = restored.schemaVersion;
    state.tracker = restored.tracker;
    state.character = restored.character;
    state.map = restored.map;
    state.ui = restored.ui;
    await abort(err, message);
  };

  // ── 3. WRITE NEW BLOBS ─────────────────────────────────────────────────────
  // Write before clearing old ones. Old blobs stay intact until success.

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
  if (idMap.size > 0) {
    const remap = (id) => (id ? (idMap.get(id) || id) : id);
    if (Array.isArray(migrated?.tracker?.npcs)) {
      for (const npc of migrated.tracker.npcs) if (npc?.imgBlobId) npc.imgBlobId = remap(npc.imgBlobId);
    }
    if (Array.isArray(migrated?.tracker?.party)) {
      for (const m of migrated.tracker.party) if (m?.imgBlobId) m.imgBlobId = remap(m.imgBlobId);
    }
    if (Array.isArray(migrated?.tracker?.locationsList)) {
      for (const loc of migrated.tracker.locationsList) if (loc?.imgBlobId) loc.imgBlobId = remap(loc.imgBlobId);
    }
    if (Array.isArray(migrated?.map?.maps)) {
      for (const mp of migrated.map.maps) {
        if (mp?.bgBlobId) mp.bgBlobId = remap(mp.bgBlobId);
        if (mp?.drawingBlobId) mp.drawingBlobId = remap(mp.drawingBlobId);
      }
    }
    if (migrated?.character?.imgBlobId) migrated.character.imgBlobId = remap(migrated.character.imgBlobId);
  }

  // ── 4. WRITE NEW TEXTS ─────────────────────────────────────────────────────

  for (const [tid, tval] of Object.entries(incomingTexts)) {
    try {
      await putText(tval, tid);
    } catch (err) {
      await abort(err, "Import failed: could not store text data.");
      return;
    }
  }

  // ── 5. SWAP STATE ──────────────────────────────────────────────────────────
  // Point of no return. Use rollback from here on if anything fails.

  try {
    const clean = JSON.parse(JSON.stringify(migrated));
    state.schemaVersion = clean.schemaVersion;
    state.tracker = clean.tracker;
    state.character = clean.character;
    state.map = clean.map;
    state.ui = clean.ui;
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
    for (const textId of Object.keys(incomingTexts || {})) addReferencedId(importedTextIds, textId);

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

  e.target.value = "";
  try { await afterImport?.(); } catch (err) {
    console.warn("afterImport hook failed:", err);
  }
}

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
