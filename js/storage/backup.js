// @ts-check
// js/storage/backup.js — import/export/reset local backups
//
// NOTE: This module is dependency-injected so it can be used from app.js
// without creating circular imports.

import { uiAlert, uiConfirm } from "../ui/dialogs.js";
import {
  collectCapacitorRuntimeSnapshot,
  exportBackupNative,
  NativeBackupExportError
} from "./nativeBackupExport.js";
import { deleteText, getTextRecord, textKey_spellNotes } from "./texts-idb.js";

const MAX_BACKUP_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_BLOBS = 200;
const BACKUP_MIME_TYPE = "application/json";
const BACKUP_EXPORT_DEBUG_FLAG = "loreledger:debug-backup-export";
const BACKUP_EXPORT_FILE_DESCRIPTION = "Lore Ledger Backup";

/** @typedef {typeof import("../state.js").state} AppState */
/** @typedef {ReturnType<typeof import("../state.js").sanitizeForSave>} SanitizedState */
/** @typedef {Partial<SanitizedState> & Record<string, unknown>} BackupStateLike */
/** @typedef {Record<string, string>} BackupAssetMap */

/**
 * @typedef {"native-document-export" | "file-system-save-picker" | "direct-download" | "unsupported/error"} BackupExportStrategy
 */

/**
 * @typedef {"saved" | "cancelled" | "failed"} FileSystemSaveResult
 */

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
 *   getTextRecord: typeof import("./texts-idb.js").getTextRecord,
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
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {Date} [date]
 * @returns {string}
 */
function buildBackupFilename(date = new Date()) {
  return `campaign-backup-${date.toISOString().slice(0, 10)}.json`;
}

/**
 * @returns {Navigator | null}
 */
function getNavigatorTarget() {
  return typeof navigator === "undefined" ? null : navigator;
}

/**
 * @returns {((options: {
 *   suggestedName?: string,
 *   types?: Array<{
 *     description?: string,
 *     accept?: Record<string, string[]>
 *   }>
 * }) => Promise<{
 *   createWritable: () => Promise<{
 *     write: (data: Blob | string) => Promise<void> | void,
 *     close: () => Promise<void> | void
 *   }>
 * }>) | null}
 */
function getShowSaveFilePickerTarget() {
  if (typeof globalThis.window !== "object" || !globalThis.window) return null;
  const picker = Reflect.get(globalThis.window, "showSaveFilePicker");
  return typeof picker === "function"
    ? /** @type {ReturnType<typeof getShowSaveFilePickerTarget>} */ (picker)
    : null;
}

/**
 * @param {string} query
 * @returns {boolean}
 */
function matchesDisplayModeQuery(query) {
  try {
    return !!globalThis.window?.matchMedia?.(query)?.matches;
  } catch {
    return false;
  }
}

/**
 * @returns {boolean}
 */
function shouldLogBackupExportDiagnostics() {
  try {
    const storedFlag = globalThis.localStorage?.getItem?.(BACKUP_EXPORT_DEBUG_FLAG);
    if (storedFlag === "1" || storedFlag === "true") return true;
  } catch {
    // Ignore storage access failures in constrained contexts.
  }

  const search = typeof location === "undefined" ? "" : String(location.search || "");
  return /(?:\?|&)debugBackupExport=(?:1|true)(?:&|$)/i.test(search);
}

/**
 * @returns {{
 *   protocol: string,
 *   platform: string,
 *   userAgent: string,
 *   maxTouchPoints: number,
 *   navigatorStandalone: boolean,
 *   displayModeStandalone: boolean,
 *   displayModeWindowControlsOverlay: boolean,
 *   displayModeFullscreen: boolean,
 *   displayModeMinimalUi: boolean,
 *   runtimeContext: "browser-tab" | "installed-pwa" | "standalone-window" | "fullscreen" | "minimal-ui",
 *   hasShowSaveFilePicker: boolean,
 *   hasNavigatorShare: boolean,
 *   hasNavigatorCanShare: boolean,
 *   hasCapacitor: boolean,
 *   capacitorNativePlatform: boolean,
 *   capacitorPlatform: string,
 *   nativeBackupExportAvailable: boolean,
 *   isCapacitor: boolean,
 *   isIOSFamily: boolean,
 *   isIPadDesktopMode: boolean,
 *   isCapacitorNativeApple: boolean
 * }}
 */
function collectBackupExportRuntimeSnapshot() {
  const currentLocation = typeof location === "undefined" ? null : location;
  const nav = getNavigatorTarget();
  const capacitor = collectCapacitorRuntimeSnapshot();
  const userAgent = String(nav?.userAgent || "");
  const platform = String(nav?.platform || "");
  const maxTouchPoints = typeof nav?.maxTouchPoints === "number" ? nav.maxTouchPoints : 0;
  const displayModeWindowControlsOverlay = matchesDisplayModeQuery("(display-mode: window-controls-overlay)");
  const displayModeFullscreen = matchesDisplayModeQuery("(display-mode: fullscreen)");
  const displayModeMinimalUi = matchesDisplayModeQuery("(display-mode: minimal-ui)");
  const displayModeStandalone = matchesDisplayModeQuery("(display-mode: standalone)");
  const navigatorStandalone = nav && typeof nav === "object" && Reflect.get(nav, "standalone") === true;
  const isIPadDesktopMode = platform === "MacIntel" && maxTouchPoints > 1 && /\bMobile\b/i.test(userAgent);
  const isIOSFamily = /\b(iPad|iPhone|iPod)\b/i.test(userAgent) || isIPadDesktopMode;

  /** @type {"browser-tab" | "installed-pwa" | "standalone-window" | "fullscreen" | "minimal-ui"} */
  let runtimeContext = "browser-tab";
  if (displayModeWindowControlsOverlay) runtimeContext = "standalone-window";
  else if (displayModeFullscreen) runtimeContext = "fullscreen";
  else if (displayModeMinimalUi) runtimeContext = "minimal-ui";
  else if (displayModeStandalone || navigatorStandalone) runtimeContext = "installed-pwa";

  const isCapacitor = currentLocation?.protocol === "capacitor:" || capacitor.isNativePlatform;
  const isCapacitorNativeApple = isCapacitor
    && (
      capacitor.platform === "ios"
      || /\b(iPad|iPhone|iPod)\b/i.test(userAgent)
      || /\bMacintosh\b/i.test(userAgent)
      || isIPadDesktopMode
    );

  return {
    protocol: String(currentLocation?.protocol || ""),
    platform,
    userAgent,
    maxTouchPoints,
    navigatorStandalone,
    displayModeStandalone,
    displayModeWindowControlsOverlay,
    displayModeFullscreen,
    displayModeMinimalUi,
    runtimeContext,
    hasShowSaveFilePicker: typeof getShowSaveFilePickerTarget() === "function",
    hasNavigatorShare: typeof nav?.share === "function",
    hasNavigatorCanShare: typeof nav?.canShare === "function",
    hasCapacitor: capacitor.hasCapacitor,
    capacitorNativePlatform: capacitor.isNativePlatform,
    capacitorPlatform: capacitor.platform,
    nativeBackupExportAvailable: capacitor.pluginAvailable,
    isCapacitor,
    isIOSFamily,
    isIPadDesktopMode,
    isCapacitorNativeApple
  };
}

/**
 * @returns {boolean}
 */
function canDirectDownloadBackup() {
  return typeof URL !== "undefined"
    && typeof URL.createObjectURL === "function"
    && typeof document !== "undefined"
    && typeof document.createElement === "function";
}

/**
 * @param {{
 *   runtime: ReturnType<typeof collectBackupExportRuntimeSnapshot>,
 *   canDirectDownload: boolean
 * }} options
 * @returns {BackupExportStrategy}
 */
function selectBackupExportStrategy({ runtime, canDirectDownload }) {
  if (runtime.isCapacitorNativeApple) {
    return runtime.nativeBackupExportAvailable ? "native-document-export" : "unsupported/error";
  }
  if (runtime.hasShowSaveFilePicker) return "file-system-save-picker";
  return canDirectDownload ? "direct-download" : "unsupported/error";
}

/**
 * @param {Record<string, unknown>} details
 * @returns {void}
 */
function logBackupExportDiagnostics(details) {
  if (!shouldLogBackupExportDiagnostics()) return;
  console.info("[backup-export]", details);
}

/**
 * @param {Blob} fileBlob
 * @param {string} filename
 * @returns {Promise<FileSystemSaveResult>}
 */
async function saveBackupWithFileSystemPicker(fileBlob, filename) {
  const picker = getShowSaveFilePickerTarget();
  if (typeof picker !== "function") return "failed";

  try {
    const fileHandle = await picker({
      suggestedName: filename,
      types: [
        {
          description: BACKUP_EXPORT_FILE_DESCRIPTION,
          accept: {
            [BACKUP_MIME_TYPE]: [".json"]
          }
        }
      ]
    });
    const writable = await fileHandle.createWritable();
    await writable.write(fileBlob);
    await writable.close();
    return "saved";
  } catch (err) {
    const errorName = err && typeof err === "object" && "name" in err ? String(err.name) : "";
    if (errorName === "AbortError") return "cancelled";

    console.error("Export save-picker failed:", err);
    await uiAlert("Export failed. Try again, or use a different browser.", { title: "Export failed" });
    return "failed";
  }
}

/**
 * @param {Blob} fileBlob
 * @param {string} filename
 * @returns {Promise<boolean>}
 */
async function downloadBackupFile(fileBlob, filename) {
  const url = URL.createObjectURL(fileBlob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";

  let appended = false;
  try {
    if (document.body && typeof document.body.appendChild === "function") {
      document.body.appendChild(anchor);
      appended = true;
    }
    anchor.click();
    return true;
  } catch (err) {
    console.error("Export download failed:", err);
    await uiAlert("Export failed. Try again, or use a different browser.", { title: "Export failed" });
    return false;
  } finally {
    if (appended && typeof anchor.remove === "function") {
      anchor.remove();
    }
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        // Best-effort cleanup only.
      }
    }, 1000);
  }
}

/**
 * @returns {Promise<void>}
 */
async function reportUnsupportedBackupExport() {
  await uiAlert("Export failed. This device couldn't save the backup file.", { title: "Export failed" });
}

/**
 * @param {NativeBackupExportError | unknown} err
 * @returns {Promise<void>}
 */
async function reportNativeBackupExportFailure(err) {
  console.error("Export native-document-export failed:", err);
  const message = err instanceof Error && err.message
    ? `Export failed. ${err.message}`
    : "Export failed. This device couldn't complete the native backup export.";
  await uiAlert(message, { title: "Export failed" });
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
 * @param {BackupStateLike | null | undefined} stateLike
 * @returns {Record<string, unknown>[]}
 */
function getCharacterEntries(stateLike) {
  if (!isPlainObject(stateLike)) return [];
  const charactersCollection = isPlainObject(stateLike.characters) ? stateLike.characters : null;
  const characterEntries = Array.isArray(charactersCollection?.entries) ? charactersCollection.entries : [];
  const legacySingleChar = characterEntries.length === 0 && isPlainObject(stateLike.character) ? stateLike.character : null;
  return /** @type {Record<string, unknown>[]} */ (
    characterEntries.length > 0 ? characterEntries.filter(isPlainObject) : (legacySingleChar ? [legacySingleChar] : [])
  );
}

/**
 * Retained pre-Level-Up snapshot payloads (Restore Character R4).
 *
 * Snapshots are campaign-owned and outlive their source character, so a payload
 * can be the only remaining reference to a portrait blob or a spell note text.
 * Malformed optional records are skipped so export/import never breaks on
 * hand-edited or partially migrated data.
 *
 * @param {unknown} stateLike
 * @returns {Record<string, unknown>[]}
 */
function getSnapshotPayloads(stateLike) {
  if (!isPlainObject(stateLike)) return [];
  const charactersCollection = isPlainObject(stateLike.characters) ? stateLike.characters : null;
  const snapshots = Array.isArray(charactersCollection?.snapshots) ? charactersCollection.snapshots : [];

  /** @type {Record<string, unknown>[]} */
  const payloads = [];
  for (const snapshot of snapshots) {
    if (!isPlainObject(snapshot)) continue;
    if (!isPlainObject(snapshot.payload)) continue;
    payloads.push(snapshot.payload);
  }
  return payloads;
}

/**
 * Structured spell row ids on one character-shaped record (live entry, legacy
 * character, or snapshot payload). Row ids key external spell note texts.
 *
 * @param {unknown} record
 * @returns {string[]}
 */
function getSpellRowIds(record) {
  /** @type {string[]} */
  const rowIds = [];
  if (!isPlainObject(record)) return rowIds;

  const spells = isPlainObject(record.spells) ? record.spells : null;
  const levels = Array.isArray(spells?.levels) ? spells.levels : [];
  for (const level of levels) {
    if (!isPlainObject(level) || !Array.isArray(level.spells)) continue;
    for (const spell of level.spells) {
      if (!isPlainObject(spell)) continue;
      const spellId = cleanString(spell.id);
      if (spellId) rowIds.push(spellId);
    }
  }
  return rowIds;
}

/**
 * Every character-shaped record whose spell rows own note text keys: live
 * entries (or the legacy singleton) plus retained snapshot payloads.
 *
 * @param {BackupStateLike | null | undefined} stateLike
 * @returns {Record<string, unknown>[]}
 */
function getSpellNoteOwners(stateLike) {
  return [...getCharacterEntries(stateLike), ...getSnapshotPayloads(stateLike)];
}

/**
 * @param {BackupStateLike | null | undefined} stateLike
 * @returns {Map<string, Record<string, unknown>>}
 */
function getCharacterEntryMap(stateLike) {
  const entries = getCharacterEntries(stateLike);
  const out = new Map();
  for (const entry of entries) {
    const id = cleanString(entry.id);
    if (id) out.set(id, entry);
  }
  return out;
}

/**
 * @param {Set<string>} target
 * @param {unknown} items
 * @param {Map<string, Record<string, unknown>>} characterById
 * @returns {void}
 */
function collectTrackerPortraitBlobIds(target, items, characterById) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isPlainObject(item)) continue;
    const linkedCharacterId = cleanString(item.characterId);
    if (linkedCharacterId && characterById.has(linkedCharacterId)) continue;
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
  const characterById = getCharacterEntryMap(stateLike);
  if (tracker) {
    collectTrackerPortraitBlobIds(ids, tracker.npcs, characterById);
    collectTrackerPortraitBlobIds(ids, tracker.party, characterById);
    collectTrackerPortraitBlobIds(ids, tracker.locationsList, new Map());
  }

  // Support both new shape (characters.entries[]) and legacy shape (character).
  for (const ch of getCharacterEntries(stateLike)) {
    addReferencedId(ids, ch.imgBlobId);
  }

  // Retained pre-Level-Up snapshot payloads keep their own portrait reference
  // alive after the source character is deleted (Restore Character R4).
  for (const payload of getSnapshotPayloads(stateLike)) {
    addReferencedId(ids, payload.imgBlobId);
  }

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
  const activeCampaignId = isPlainObject(stateLike.appShell) && typeof stateLike.appShell.activeCampaignId === "string"
    ? stateLike.appShell.activeCampaignId.trim()
    : "";

  // Support both new shape (characters.entries[]) and legacy shape (character),
  // plus retained snapshot payloads (R4) — while the source character lives
  // these resolve to the same keys, and after deletion the snapshot keeps them.
  for (const owner of getSpellNoteOwners(stateLike)) {
    for (const spellId of getSpellRowIds(owner)) {
      addReferencedId(
        ids,
        activeCampaignId
          ? textKey_spellNotes(activeCampaignId, spellId)
          : textKey_spellNotes(spellId)
      );
    }
  }

  return ids;
}

/**
 * @param {unknown} stateLike
 * @returns {Set<string>}
 */
function collectSpellIds(stateLike) {
  const ids = new Set();
  if (!isPlainObject(stateLike)) return ids;

  // Support both new shape (characters.entries[]) and legacy shape (character),
  // plus retained snapshot payloads (R4) so snapshot-only note keys are remapped
  // to the destination campaign on import.
  for (const owner of getSpellNoteOwners(/** @type {BackupStateLike} */ (stateLike))) {
    for (const spellId of getSpellRowIds(owner)) ids.add(spellId);
  }

  return ids;
}

/**
 * @param {unknown} textId
 * @returns {{ campaignId: string | null, spellId: string } | null}
 */
function parseSpellNotesTextId(textId) {
  const id = cleanString(textId);
  const prefix = "spell_notes_";
  if (!id.startsWith(prefix)) return null;

  const tail = id.slice(prefix.length);
  if (!tail) return null;

  const scopedSeparator = tail.indexOf("__");
  if (scopedSeparator >= 0) {
    const campaignId = tail.slice(0, scopedSeparator).trim();
    const spellId = tail.slice(scopedSeparator + 2).trim();
    if (!spellId) return null;
    return { campaignId: campaignId || null, spellId };
  }

  return { campaignId: null, spellId: tail.trim() };
}

/**
 * @param {BackupAssetMap} incomingTexts
 * @param {unknown} migratedState
 * @param {string | null} targetCampaignId
 * @returns {BackupAssetMap}
 */
function remapIncomingSpellNoteTextIds(incomingTexts, migratedState, targetCampaignId) {
  const normalizedCampaignId = cleanString(targetCampaignId);
  if (!normalizedCampaignId) return incomingTexts;

  const spellIds = collectSpellIds(migratedState);
  if (spellIds.size === 0) return incomingTexts;

  /** @type {BackupAssetMap} */
  const remapped = {};
  for (const [incomingId, text] of Object.entries(incomingTexts)) {
    const parsed = parseSpellNotesTextId(incomingId);
    if (!parsed || !spellIds.has(parsed.spellId)) {
      remapped[incomingId] = text;
      continue;
    }
    remapped[textKey_spellNotes(normalizedCampaignId, parsed.spellId)] = text;
  }
  return remapped;
}

/**
 * @param {unknown} stateLike
 * @returns {string | null}
 */
function getActiveCampaignId(stateLike) {
  if (!isPlainObject(stateLike) || !isPlainObject(stateLike.appShell)) return null;
  return cleanString(stateLike.appShell.activeCampaignId) || null;
}

/**
 * @returns {string}
 */
function createImportCampaignId() {
  return `campaign_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
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
  // Accept both legacy `character` and new `characters` shapes.
  if (Object.prototype.hasOwnProperty.call(state, "character") && !isPlainObject(state.character)) {
    throw new Error("Backup state.character must be an object.");
  }
  if (Object.prototype.hasOwnProperty.call(state, "characters") && !isPlainObject(state.characters)) {
    throw new Error("Backup state.characters must be an object.");
  }
  if (Object.prototype.hasOwnProperty.call(state, "map") && !isPlainObject(state.map)) {
    throw new Error("Backup state.map must be an object.");
  }
  if (Object.prototype.hasOwnProperty.call(state, "combat") && !isPlainObject(state.combat)) {
    throw new Error("Backup state.combat must be an object.");
  }
  if (Object.prototype.hasOwnProperty.call(state, "ui") && !isPlainObject(state.ui)) {
    throw new Error("Backup state.ui must be an object.");
  }
  if (Object.prototype.hasOwnProperty.call(state, "app") && !isPlainObject(state.app)) {
    throw new Error("Backup state.app must be an object.");
  }
  if (Object.prototype.hasOwnProperty.call(state, "content") && !isPlainObject(state.content)) {
    throw new Error("Backup state.content must be an object.");
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
  target.characters = /** @type {AppState["characters"]} */ (source.characters);
  target.map = /** @type {AppState["map"]} */ (source.map);
  target.combat = /** @type {AppState["combat"]} */ (source.combat);
  // Custom content travels with the campaign; older backups without the
  // bucket restore to an empty custom list via migrateState.
  target.content = /** @type {AppState["content"]} */ (
    isPlainObject(source.content) ? source.content : { custom: [] }
  );
  target.ui = /** @type {AppState["ui"]} */ (source.ui);
  target.app = /** @type {AppState["app"]} */ (source.app);
  if (isPlainObject(source.appShell)) {
    target.appShell = /** @type {AppState["appShell"]} */ (source.appShell);
  }
}

/**
 * @param {AppState} target
 * @param {Map<string, string>} idMap
 * @returns {void}
 */
function remapBlobIds(target, idMap) {
  if (idMap.size === 0) return;
  const remap = (id) => (id ? (idMap.get(id) || id) : id);
  const characterById = getCharacterEntryMap(target);
  const shouldRemapCardPortrait = (card) => {
    if (!isPlainObject(card)) return false;
    const linkedCharacterId = cleanString(card.characterId);
    return !(linkedCharacterId && characterById.has(linkedCharacterId));
  };

  for (const npc of target.tracker.npcs) {
    if (npc.imgBlobId && shouldRemapCardPortrait(npc)) npc.imgBlobId = remap(npc.imgBlobId);
  }
  for (const partyMember of target.tracker.party) {
    if (partyMember.imgBlobId && shouldRemapCardPortrait(partyMember)) partyMember.imgBlobId = remap(partyMember.imgBlobId);
  }
  for (const location of target.tracker.locationsList) {
    if (location.imgBlobId) location.imgBlobId = remap(location.imgBlobId);
  }
  for (const mapEntry of target.map.maps) {
    if (mapEntry.bgBlobId) mapEntry.bgBlobId = remap(mapEntry.bgBlobId);
    if (mapEntry.drawingBlobId) mapEntry.drawingBlobId = remap(mapEntry.drawingBlobId);
  }
  // Remap character portrait blobs in all character entries.
  if (target.characters && Array.isArray(target.characters.entries)) {
    for (const entry of target.characters.entries) {
      if (entry && entry.imgBlobId) entry.imgBlobId = remap(entry.imgBlobId);
    }
  }
  // Snapshot payload portraits point at the same blob store, so a rewritten id
  // has to reach them too or a restore would resolve a dangling portrait (R4).
  for (const payload of getSnapshotPayloads(target)) {
    const payloadBlobId = cleanString(payload.imgBlobId);
    if (payloadBlobId) payload.imgBlobId = remap(payloadBlobId);
  }
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
    getTextRecord,
    sanitizeForSave
  } = deps;

  if (typeof sanitizeForSave !== "function") {
    throw new Error("exportBackup: sanitizeForSave() is required");
  }

  ensureMapManager?.();
  const ids = collectReferencedBlobIds(state);
  const textIds = collectReferencedTextIds(state);

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

  /** @type {BackupAssetMap} */
  const texts = {};
  for (const id of textIds) {
    try {
      const record = await getTextRecord(id);
      if (record) texts[id] = record.text ?? "";
    } catch (err) {
      console.warn("Skipping text during export (failed to read):", id, err);
    }
  }

  const backup = /** @type {BackupEnvelopeV2} */ ({
    version: 2,
    exportedAt: new Date().toISOString(),
    state: sanitizeForSave(state),
    blobs,
    texts
  });

  const filename = buildBackupFilename(new Date(backup.exportedAt));
  const serializedBackup = JSON.stringify(backup, null, 2);
  const fileBlob = new Blob([serializedBackup], { type: BACKUP_MIME_TYPE });

  const runtime = collectBackupExportRuntimeSnapshot();
  const canDirectDownload = canDirectDownloadBackup();
  const strategy = selectBackupExportStrategy({
    runtime,
    canDirectDownload
  });

  logBackupExportDiagnostics({
    stage: "decision",
    filename,
    platform: runtime.platform,
    userAgent: runtime.userAgent,
    maxTouchPoints: runtime.maxTouchPoints,
    protocol: runtime.protocol,
    runtimeContext: runtime.runtimeContext,
    navigatorStandalone: runtime.navigatorStandalone,
    displayModeStandalone: runtime.displayModeStandalone,
    displayModeWindowControlsOverlay: runtime.displayModeWindowControlsOverlay,
    displayModeFullscreen: runtime.displayModeFullscreen,
    displayModeMinimalUi: runtime.displayModeMinimalUi,
    isCapacitor: runtime.isCapacitor,
    isIOSFamily: runtime.isIOSFamily,
    isIPadDesktopMode: runtime.isIPadDesktopMode,
    hasShowSaveFilePicker: runtime.hasShowSaveFilePicker,
    hasNavigatorShare: runtime.hasNavigatorShare,
    hasNavigatorCanShare: runtime.hasNavigatorCanShare,
    hasCapacitor: runtime.hasCapacitor,
    capacitorNativePlatform: runtime.capacitorNativePlatform,
    capacitorPlatform: runtime.capacitorPlatform,
    nativeBackupExportAvailable: runtime.nativeBackupExportAvailable,
    canDirectDownload,
    selectedStrategy: strategy,
    nativeExportAttempted: false,
    savePickerAttempted: false,
    directDownloadAttempted: false
  });

  if (strategy === "native-document-export") {
    logBackupExportDiagnostics({
      stage: "native-export-attempt",
      filename,
      selectedStrategy: strategy,
      nativeExportAttempted: true,
      savePickerAttempted: false,
      directDownloadAttempted: false
    });
    try {
      const nativeResult = await exportBackupNative({ filename, json: serializedBackup });
      logBackupExportDiagnostics({
        stage: "native-export-result",
        filename,
        selectedStrategy: strategy,
        nativeResult,
        nativeExportAttempted: true,
        savePickerAttempted: false,
        directDownloadAttempted: false
      });
    } catch (err) {
      logBackupExportDiagnostics({
        stage: "native-export-result",
        filename,
        selectedStrategy: strategy,
        nativeExportAttempted: true,
        savePickerAttempted: false,
        directDownloadAttempted: false,
        nativeExportError: err instanceof Error ? err.message : String(err || "")
      });
      await reportNativeBackupExportFailure(err);
    }
    return;
  }

  if (strategy === "file-system-save-picker") {
    logBackupExportDiagnostics({
      stage: "save-picker-attempt",
      filename,
      selectedStrategy: strategy,
      nativeExportAttempted: false,
      savePickerAttempted: true,
      directDownloadAttempted: false
    });
    const saveResult = await saveBackupWithFileSystemPicker(fileBlob, filename);
    logBackupExportDiagnostics({
      stage: "save-picker-result",
      filename,
      selectedStrategy: strategy,
      saveResult,
      nativeExportAttempted: false,
      savePickerAttempted: true,
      directDownloadAttempted: false
    });
    return;
  }

  if (strategy === "unsupported/error") {
    logBackupExportDiagnostics({
      stage: "unsupported",
      filename,
      selectedStrategy: strategy,
      nativeExportAttempted: false,
      savePickerAttempted: false,
      directDownloadAttempted: false
    });
    await reportUnsupportedBackupExport();
    return;
  }

  logBackupExportDiagnostics({
    stage: "download-attempt",
    filename,
    selectedStrategy: strategy,
    nativeExportAttempted: false,
    savePickerAttempted: false,
    directDownloadAttempted: true
  });
  const downloadSucceeded = await downloadBackupFile(fileBlob, filename);
  logBackupExportDiagnostics({
    stage: "download-result",
    filename,
    selectedStrategy: strategy,
    downloadSucceeded,
    nativeExportAttempted: false,
    savePickerAttempted: false,
    directDownloadAttempted: true
  });
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

  let migrated;
  try {
    migrated = migrateState(incomingState);
  } catch (err) {
    console.error("Import failed: could not migrate state:", err);
    await uiAlert(getErrorMessage(err, "Backup state is invalid."), { title: "Import failed" });
    resetFileInput(input);
    return;
  }

  const targetCampaignId =
    getActiveCampaignId(state)
    || getActiveCampaignId(migrated)
    || createImportCampaignId();
  migrated.appShell = { activeCampaignId: targetCampaignId };
  const importTexts = remapIncomingSpellNoteTextIds(incomingTexts, migrated, targetCampaignId);
  const incomingTextEntries = Object.entries(importTexts);

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
  const appShellSnapshot = /** @type {AppState["appShell"]} */ (
    JSON.parse(JSON.stringify(state.appShell || { activeCampaignId: null }))
  );
  try {
    stateSnapshot = cloneSanitizedState(sanitizeForSave(state));
  } catch (err) {
    console.error("Import failed: could not snapshot current state:", err);
    await uiAlert("Import failed: could not create a safe restore point.", { title: "Import failed" });
    resetFileInput(input);
    return;
  }

  const oldBlobIds = collectReferencedBlobIds(stateSnapshot);
  const oldTextIds = collectReferencedTextIds(state);

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
    state.appShell = appShellSnapshot;
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
    const newReferencedTextIds = collectReferencedTextIds(state);
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
