// @ts-check
// js/storage/persistence.js — vault-backed load/save/switch helpers

import {
  collectCampaignSpellIds,
  isCampaignVault,
  normalizeCampaignVault,
  persistRuntimeStateToVault,
  projectActiveCampaignState,
  replaceRuntimeState,
  resolveActiveCampaignId,
  wrapLegacyStateInVault
} from "./campaignVault.js";
import { migrateLegacySpellNotesToCampaignScope } from "./texts-idb.js";
import {
  migrateState as defaultMigrateState,
  sanitizeForSave as defaultSanitizeForSave
} from "../state.js";

/** @typedef {typeof import("../state.js").state} AppState */
/** @typedef {{ imgBlobId?: string | null, imgDataUrl?: string }} PortraitRef */
/** @typedef {ReturnType<typeof import("./saveManager.js").createSaveManager>} SaveManagerLike */
/** @typedef {{ current: import("./campaignVault.js").CampaignVault | null }} VaultRuntime */

/**
 * @typedef {{
 *   storageKey: string,
 *   state: AppState,
 *   migrateState: typeof import("../state.js").migrateState,
 *   sanitizeForSave: typeof import("../state.js").sanitizeForSave,
 *   vaultRuntime: VaultRuntime
 * }} SaveAllLocalOptions
 */

/**
 * @typedef {{
 *   storageKey: string,
 *   state: AppState,
 *   migrateState: typeof import("../state.js").migrateState,
 *   ensureMapManager: typeof import("../state.js").ensureMapManager,
 *   sanitizeForSave: typeof import("../state.js").sanitizeForSave,
 *   dataUrlToBlob: typeof import("./blobs.js").dataUrlToBlob,
 *   putBlob: typeof import("./blobs.js").putBlob,
 *   setStatus: (message: string) => void,
 *   markDirty: () => void,
 *   vaultRuntime: VaultRuntime
 * }} LoadAllOptions
 */

/**
 * @typedef {{
 *   state: AppState,
 *   vaultRuntime: VaultRuntime,
 *   campaignId: string | null,
 *   migrateState: typeof import("../state.js").migrateState,
 *   sanitizeForSave: typeof import("../state.js").sanitizeForSave
 * }} SwitchCampaignOptions
 */

/**
 * @param {PortraitRef[]} items
 * @param {typeof import("./blobs.js").dataUrlToBlob} dataUrlToBlob
 * @param {typeof import("./blobs.js").putBlob} putBlob
 * @param {(message: string) => void} setStatus
 * @param {string} label
 * @returns {Promise<boolean>}
 */
async function migratePortraitDataUrls(items, dataUrlToBlob, putBlob, setStatus, label) {
  let changed = false;

  for (const item of items) {
    if (!item.imgDataUrl || item.imgBlobId) continue;
    const blob = dataUrlToBlob(item.imgDataUrl);
    try {
      item.imgBlobId = await putBlob(blob);
      delete item.imgDataUrl;
      changed = true;
    } catch (err) {
      console.warn(`Migration: failed to store ${label} image blob:`, err);
      setStatus("Storage is full. Some images couldn't be migrated. Export a backup.");
    }
  }

  return changed;
}

/**
 * @param {AppState} state
 * @param {typeof import("./blobs.js").dataUrlToBlob} dataUrlToBlob
 * @param {typeof import("./blobs.js").putBlob} putBlob
 * @param {(message: string) => void} setStatus
 * @returns {Promise<boolean>}
 */
async function migrateRuntimeImages(state, dataUrlToBlob, putBlob, setStatus) {
  let changed = false;

  changed = (await migratePortraitDataUrls(state.tracker.npcs, dataUrlToBlob, putBlob, setStatus, "NPC")) || changed;
  changed = (await migratePortraitDataUrls(state.tracker.party, dataUrlToBlob, putBlob, setStatus, "party")) || changed;
  changed = (await migratePortraitDataUrls(state.tracker.locationsList, dataUrlToBlob, putBlob, setStatus, "location")) || changed;

  const defaultMap =
    state.map.maps.find((mapEntry) => mapEntry.id === state.map.activeMapId) ||
    state.map.maps[0];

  if (!defaultMap) return changed;

  if (state.map.bgDataUrl && !defaultMap.bgBlobId) {
    try {
      const blob = dataUrlToBlob(state.map.bgDataUrl);
      defaultMap.bgBlobId = await putBlob(blob);
      delete state.map.bgDataUrl;
      changed = true;
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
      changed = true;
    } catch (err) {
      console.warn("Migration: failed to store map drawing blob:", err);
      setStatus("Storage is full or map image is corrupted. Some images couldn't be migrated. Export a backup.");
    }
  }

  if (state.map.bgBlobId && !defaultMap.bgBlobId) {
    defaultMap.bgBlobId = state.map.bgBlobId;
    delete state.map.bgBlobId;
    changed = true;
  }
  if (state.map.drawingBlobId && !defaultMap.drawingBlobId) {
    defaultMap.drawingBlobId = state.map.drawingBlobId;
    delete state.map.drawingBlobId;
    changed = true;
  }
  if (typeof state.map.brushSize === "number" && (defaultMap.brushSize == null)) {
    defaultMap.brushSize = state.map.brushSize;
    delete state.map.brushSize;
    changed = true;
  }
  if (typeof state.map.colorKey === "string" && !defaultMap.colorKey) {
    defaultMap.colorKey = state.map.colorKey;
    delete state.map.colorKey;
    changed = true;
  }

  return changed;
}

/**
 * Save the runtime state into the campaign vault.
 * @param {SaveAllLocalOptions} opts
 * @returns {boolean}
 */
export function saveAllLocal(opts) {
  const {
    storageKey,
    state,
    migrateState = defaultMigrateState,
    sanitizeForSave = defaultSanitizeForSave,
    vaultRuntime = { current: null }
  } = opts || {};

  if (!storageKey) throw new Error("saveAllLocal: storageKey is required");
  if (!state) throw new Error("saveAllLocal: state is required");
  if (typeof migrateState !== "function") throw new Error("saveAllLocal: migrateState() is required");
  if (typeof sanitizeForSave !== "function") throw new Error("saveAllLocal: sanitizeForSave() is required");
  if (!vaultRuntime || typeof vaultRuntime !== "object") throw new Error("saveAllLocal: vaultRuntime is required");

  const baseVault = vaultRuntime.current || normalizeCampaignVault(null, { migrateState, sanitizeForSave }).vault;
  const nextVault = persistRuntimeStateToVault(baseVault, state, { sanitizeForSave });

  try {
    localStorage.setItem(storageKey, JSON.stringify(nextVault));
    vaultRuntime.current = nextVault;
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
    sanitizeForSave = defaultSanitizeForSave,
    dataUrlToBlob,
    putBlob,
    setStatus,
    markDirty,
    vaultRuntime = { current: null }
  } = opts || {};

  if (!storageKey) throw new Error("loadAll: storageKey is required");
  if (!state) throw new Error("loadAll: state is required");
  if (typeof migrateState !== "function") throw new Error("loadAll: migrateState() is required");
  if (typeof ensureMapManager !== "function") throw new Error("loadAll: ensureMapManager() is required");
  if (typeof sanitizeForSave !== "function") throw new Error("loadAll: sanitizeForSave() is required");
  if (typeof dataUrlToBlob !== "function") throw new Error("loadAll: dataUrlToBlob() is required");
  if (typeof putBlob !== "function") throw new Error("loadAll: putBlob() is required");
  if (typeof setStatus !== "function") throw new Error("loadAll: setStatus() is required");
  if (typeof markDirty !== "function") throw new Error("loadAll: markDirty() is required");
  if (!vaultRuntime || typeof vaultRuntime !== "object") throw new Error("loadAll: vaultRuntime is required");

  const raw = localStorage.getItem(storageKey);
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw);

    let loadedVault;
    let migratedFromLegacy = false;

    if (isCampaignVault(parsed)) {
      loadedVault = normalizeCampaignVault(parsed, { migrateState, sanitizeForSave }).vault;
    } else {
      const legacyWrap = wrapLegacyStateInVault({
        legacyState: parsed,
        migrateState,
        sanitizeForSave
      });
      loadedVault = legacyWrap.vault;
      migratedFromLegacy = true;
    }

    const projected = projectActiveCampaignState(loadedVault, migrateState);
    replaceRuntimeState(state, projected);

    ensureMapManager();
    let changed = await migrateRuntimeImages(state, dataUrlToBlob, putBlob, setStatus);

    if (state.tracker?.ui?.textareaHeigts && !state.tracker.ui.textareaHeights) {
      state.tracker.ui.textareaHeights = state.tracker.ui.textareaHeigts;
      changed = true;
    }

    if (migratedFromLegacy && state.appShell.activeCampaignId) {
      changed = (await migrateLegacySpellNotesToCampaignScope(
        state.appShell.activeCampaignId,
        collectCampaignSpellIds(state)
      )) || changed;
    }

    loadedVault = persistRuntimeStateToVault(loadedVault, state, { sanitizeForSave });
    vaultRuntime.current = loadedVault;

    markDirty();

    return true;
  } catch (err) {
    console.error("Load/migration failed:", err);
    setStatus("Loaded with issues. Consider exporting a backup.");
    return false;
  }
}

/**
 * Safely swaps the runtime root state to another campaign after the caller has
 * already flushed any outgoing edits.
 * @param {SwitchCampaignOptions} opts
 * @returns {boolean}
 */
export function switchCampaign(opts) {
  const {
    state,
    vaultRuntime,
    campaignId,
    migrateState,
    sanitizeForSave
  } = opts || {};

  if (!state) throw new Error("switchCampaign: state is required");
  if (!vaultRuntime || typeof vaultRuntime !== "object") throw new Error("switchCampaign: vaultRuntime is required");
  if (typeof migrateState !== "function") throw new Error("switchCampaign: migrateState() is required");
  if (typeof sanitizeForSave !== "function") throw new Error("switchCampaign: sanitizeForSave() is required");

  if (!vaultRuntime.current) {
    vaultRuntime.current = normalizeCampaignVault(null, { migrateState, sanitizeForSave }).vault;
  }

  let nextVault = persistRuntimeStateToVault(vaultRuntime.current, state, { sanitizeForSave });

  if (campaignId !== null) {
    const normalizedId = String(campaignId || "").trim();
    if (!normalizedId || !nextVault.campaignDocs[normalizedId] || !nextVault.campaignIndex.entries[normalizedId]) {
      throw new Error(`switchCampaign: unknown campaign id "${campaignId}"`);
    }
    nextVault.appShell.activeCampaignId = normalizedId;
    nextVault.campaignIndex.entries[normalizedId] = {
      ...nextVault.campaignIndex.entries[normalizedId],
      lastOpenedAt: new Date().toISOString()
    };
  } else {
    nextVault.appShell.activeCampaignId = null;
  }

  const projected = projectActiveCampaignState(nextVault, migrateState);
  replaceRuntimeState(state, projected);
  vaultRuntime.current = persistRuntimeStateToVault(nextVault, state, { sanitizeForSave });
  return true;
}

/**
 * @param {SaveManagerLike} SaveManager
 * @returns {() => void}
 */
export function installExitSave(SaveManager) {
  if (!SaveManager || typeof SaveManager.flush !== "function" || typeof SaveManager.getStatus !== "function") {
    throw new Error("installExitSave: SaveManager with flush() and getStatus() is required");
  }

  /**
   * @param {BeforeUnloadEvent} e
   * @returns {string | undefined}
   */
  const handler = (e) => {
    const st = SaveManager.getStatus();
    if (st?.dirty) {
      try { SaveManager.flush(); } catch (_) { }
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
  };
}
