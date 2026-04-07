// @ts-check
// js/storage/persistence.js — load + migrate + exit-safety helpers
//
// Keeps app.js slimmer and makes persistence logic reusable/testable.
//
// - loadAll(): loads from localStorage, runs migrateState(), then performs
//   legacy image migrations (dataUrl -> IndexedDB blobs) and map-manager folding.
// - installExitSave(): best-effort flush on tab close/background.

/** @typedef {typeof import("../state.js").state} AppState */
/** @typedef {{ imgBlobId?: string | null, imgDataUrl?: string }} PortraitRef */
/** @typedef {typeof import("../state.js").state["map"]["maps"][number]} MapEntry */
/** @typedef {ReturnType<typeof import("../state.js").sanitizeForSave>} SanitizedState */
/** @typedef {ReturnType<typeof import("./saveManager.js").createSaveManager>} SaveManagerLike */

/**
 * @typedef {{
 *   storageKey: string,
 *   state: AppState,
 *   currentSchemaVersion?: number,
 *   sanitizeForSave: typeof import("../state.js").sanitizeForSave
 * }} SaveAllLocalOptions
 */

/**
 * @typedef {{
 *   storageKey: string,
 *   state: AppState,
 *   migrateState: typeof import("../state.js").migrateState,
 *   ensureMapManager: typeof import("../state.js").ensureMapManager,
 *   dataUrlToBlob: typeof import("./blobs.js").dataUrlToBlob,
 *   putBlob: typeof import("./blobs.js").putBlob,
 *   setStatus: (message: string) => void,
 *   markDirty: () => void
 * }} LoadAllOptions
 */

/**
 * @param {AppState | SanitizedState} source
 * @returns {AppState}
 */
function cloneState(source) {
  return /** @type {AppState} */ (JSON.parse(JSON.stringify(source)));
}

/**
 * @param {AppState} target
 * @param {AppState} source
 * @returns {void}
 */
function replaceStateBuckets(target, source) {
  target.schemaVersion = source.schemaVersion;
  target.tracker = source.tracker;
  target.character = source.character;
  target.map = source.map;
  target.ui = source.ui;
}

/**
 * @param {PortraitRef[]} items
 * @param {typeof import("./blobs.js").dataUrlToBlob} dataUrlToBlob
 * @param {typeof import("./blobs.js").putBlob} putBlob
 * @param {(message: string) => void} setStatus
 * @param {string} label
 * @returns {Promise<void>}
 */
async function migratePortraitDataUrls(items, dataUrlToBlob, putBlob, setStatus, label) {
  for (const item of items) {
    if (!item.imgDataUrl || item.imgBlobId) continue;
    const blob = dataUrlToBlob(item.imgDataUrl);
    try {
      item.imgBlobId = await putBlob(blob);
      delete item.imgDataUrl;
    } catch (err) {
      console.warn(`Migration: failed to store ${label} image blob:`, err);
      setStatus("Storage is full. Some images couldn't be migrated. Export a backup.");
    }
  }
}

/**
 * Save the app state to localStorage.
 *
 * NOTE: Undo/redo are in-memory only and are intentionally excluded.
 * @param {SaveAllLocalOptions} opts
 * @returns {boolean}
 */
export function saveAllLocal(opts) {
  const {
    storageKey,
    state,
    currentSchemaVersion,
    sanitizeForSave
  } = opts || {};

  if (!storageKey) throw new Error("saveAllLocal: storageKey is required");
  if (!state) throw new Error("saveAllLocal: state is required");

  if (typeof sanitizeForSave !== "function") {
    throw new Error("saveAllLocal: sanitizeForSave() is required");
  }

  const payload = sanitizeForSave(state, { currentSchemaVersion });

  try {
    localStorage.setItem(storageKey, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn("Save failed:", err);
    return false;
  }
}

/**
 * @param {LoadAllOptions} opts
 * @returns {Promise<boolean>}
 */
export async function loadAll(opts) {
  const {
    storageKey,
    state,
    migrateState,
    ensureMapManager,
    dataUrlToBlob,
    putBlob,
    setStatus,
    markDirty
  } = opts || {};

  if (!storageKey) throw new Error("loadAll: storageKey is required");
  if (!state) throw new Error("loadAll: state is required");
  if (typeof migrateState !== "function") throw new Error("loadAll: migrateState() is required");
  if (typeof ensureMapManager !== "function") throw new Error("loadAll: ensureMapManager() is required");
  if (typeof dataUrlToBlob !== "function") throw new Error("loadAll: dataUrlToBlob() is required");
  if (typeof putBlob !== "function") throw new Error("loadAll: putBlob() is required");
  if (typeof setStatus !== "function") throw new Error("loadAll: setStatus() is required");
  if (typeof markDirty !== "function") throw new Error("loadAll: markDirty() is required");

  const raw = localStorage.getItem(storageKey);
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw);
    const migrated = migrateState(parsed);

    const clean = cloneState(migrated);
    replaceStateBuckets(state, clean);

    // Ensure undo/redo start empty (in-memory only)
    state.map.undo = [];
    state.map.redo = [];

    // ---- MIGRATION: imgDataUrl -> IndexedDB blobId ----
    await migratePortraitDataUrls(state.tracker.npcs, dataUrlToBlob, putBlob, setStatus, "NPC");
    await migratePortraitDataUrls(state.tracker.party, dataUrlToBlob, putBlob, setStatus, "party");
    await migratePortraitDataUrls(state.tracker.locationsList, dataUrlToBlob, putBlob, setStatus, "location");

    // Map (legacy -> multi-map)
    ensureMapManager();

    const defaultMap =
      state.map.maps.find((mapEntry) => mapEntry.id === state.map.activeMapId) ||
      state.map.maps[0];

    // Fold legacy top-level map fields into the default map entry
    if (defaultMap) {
      // Legacy: data URLs
      if (state.map.bgDataUrl && !defaultMap.bgBlobId) {
        try {
          const blob = dataUrlToBlob(state.map.bgDataUrl);
          defaultMap.bgBlobId = await putBlob(blob);
          delete state.map.bgDataUrl;
        } catch (err) {
          console.warn("Migration: failed to store map background blob:", err);
          setStatus("Storage is full or map image is corrupted. Some images couldn't be migrated. Export a backup.");
        }
      }

      if (state.map.drawingDataUrl && !defaultMap.drawingBlobId) {
        try {
          const blob = dataUrlToBlob(state.map.drawingDataUrl);
          defaultMap.drawingBlobId = await putBlob(blob);
          delete state.map.drawingDataUrl;
        } catch (err) {
          console.warn("Migration: failed to store map drawing blob:", err);
          setStatus("Storage is full or map image is corrupted. Some images couldn't be migrated. Export a backup.");
        }
      }

      // Legacy: blob ids stored at top-level
      if (state.map.bgBlobId && !defaultMap.bgBlobId) {
        defaultMap.bgBlobId = state.map.bgBlobId;
        delete state.map.bgBlobId;
      }
      if (state.map.drawingBlobId && !defaultMap.drawingBlobId) {
        defaultMap.drawingBlobId = state.map.drawingBlobId;
        delete state.map.drawingBlobId;
      }

      // Legacy: per-map settings stored at top-level
      if (typeof state.map.brushSize === "number" && (defaultMap.brushSize == null)) {
        defaultMap.brushSize = state.map.brushSize;
        delete state.map.brushSize;
      }
      if (typeof state.map.colorKey === "string" && !defaultMap.colorKey) {
        defaultMap.colorKey = state.map.colorKey;
        delete state.map.colorKey;
      }
    }

    // Fix a common typo from older builds
    if (state.tracker?.ui?.textareaHeigts && !state.tracker.ui.textareaHeights) {
      state.tracker.ui.textareaHeights = state.tracker.ui.textareaHeigts;
    }

    // If we touched anything, ensure we write the migrated state back.
    markDirty();
    return true;
  } catch (err) {
    console.error("Load/migration failed:", err);
    setStatus("Loaded with issues. Consider exporting a backup.");
    return false;
  }
}

/**
 * @param {SaveManagerLike} SaveManager
 * @returns {() => void}
 */
export function installExitSave(SaveManager) {
  if (!SaveManager || typeof SaveManager.flush !== "function" || typeof SaveManager.getStatus !== "function") {
    throw new Error("installExitSave: SaveManager with flush() and getStatus() is required");
  }

  // Best-effort: try to flush when the page is backgrounded or closed.
  // beforeunload is the only hook that *may* show a confirmation if unsaved.
  /**
   * @param {BeforeUnloadEvent} e
   * @returns {string | undefined}
   */
  const handler = (e) => {
    const st = SaveManager.getStatus();
    if (st?.dirty) {
      try { SaveManager.flush(); } catch (_) { }
      // Trigger the native "Leave site?" prompt (message ignored by most browsers).
      e.preventDefault();
      e.returnValue = "";
      return "";
    }
    return undefined;
  };

  const backgroundFlush = () => {
    const st = SaveManager.getStatus();
    if (st?.dirty) {
      try { SaveManager.flush(); } catch (_) { }
    }
  };

  window.addEventListener("beforeunload", handler);
  window.addEventListener("pagehide", backgroundFlush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") backgroundFlush();
  });

  return () => {
    window.removeEventListener("beforeunload", handler);
    window.removeEventListener("pagehide", backgroundFlush);
    // visibilitychange listener intentionally stays for app lifetime; removal needs a named handler reference.
  };
}
