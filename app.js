// @ts-check

/************************ App Composition Root ************************
 * Wires shared services (state guard, persistence, popovers, theme)
 * and initializes tracker/character/map modules.
 ***************************************************************************/

import "./js/pwa/pwa.js";

import {
  STORAGE_KEY,
  ACTIVE_TAB_KEY,
  CURRENT_SCHEMA_VERSION,
  state,
  migrateState,
  sanitizeForSave,
  ensureMapManager,
  getActiveMap,
  newMapEntry
} from "./js/state.js";
import {
  DEV_MODE,
  DEV_STATE_GUARD_MODE,
  installStateMutationGuard,
  installStateMutationAllowanceLifecycle,
  withAllowedStateMutationAsync
} from "./js/utils/dev.js";

import {
  putBlob,
  getBlob,
  deleteBlob,
  blobIdToObjectUrl,
  dataUrlToBlob,
  blobToDataUrl,
  clearAllBlobs
} from "./js/storage/blobs.js";

import {
  textKey_spellNotes,
  putText,
  getText,
  deleteText,
  clearAllTexts,
  getAllTexts
} from "./js/storage/texts-idb.js";

import {
  exportBackup as _exportBackup,
  importBackup as _importBackup,
  resetAll as _resetAll
} from "./js/storage/backup.js";
import { createSaveManager } from "./js/storage/saveManager.js";
import { loadAll as loadAllPersist, installExitSave, saveAllLocal } from "./js/storage/persistence.js";


import {
  autoSizeInput,
  autosizeAllNumbers,
  setupTextareaSizing
} from "./js/features/autosize.js";

import { cropImageModal, getPortraitAspect } from "./js/features/imageCropper.js";
import { createFilePicker } from "./js/features/imagePicker.js";
import { pickCropStorePortrait } from "./js/features/portraitFlow.js";

import { enhanceNumberSteppers } from "./js/features/numberSteppers.js";
import { numberOrNull } from "./js/utils/number.js";
import { makeNpc, makePartyMember, makeLocation } from "./js/domain/factories.js";
import { positionMenuOnScreen } from "./js/ui/positioning.js";
import { createStatus } from "./js/ui/status.js";
import { showSaveBanner, hideSaveBanner } from "./js/ui/saveBanner.js";
import { getNoopDestroyApi } from "./js/utils/domGuards.js";

import { initDialogs, uiAlert, uiConfirm, uiPrompt } from "./js/ui/dialogs.js";
import { initTopTabsNavigation } from "./js/ui/navigation.js";
import { createPopoverManager } from "./js/ui/popovers.js";
import { initTopbarUI } from "./js/ui/topbar/topbar.js";
import { createThemeManager } from "./js/ui/theme.js";

import { setupSettingsPanel } from "./js/ui/settingsPanel.js";
import { initTrackerPage } from "./js/pages/tracker/trackerPage.js";

import { setupMapPage } from "./js/pages/map/mapPage.js";

/** @typedef {import("./js/state.js").State} AppState */
/** @typedef {ReturnType<typeof createSaveManager>} SaveManagerApi */
/** @typedef {ReturnType<typeof createStatus>} StatusManager */
/** @typedef {ReturnType<typeof createPopoverManager>} PopoversApi */
/** @typedef {ReturnType<typeof createThemeManager>} ThemeManager */
/** @typedef {Parameters<StatusManager["setStatus"]>[1]} StatusOptions */
/** @typedef {(message: string, opts?: StatusOptions) => void} SetStatusFn */
/** @typedef {{ destroy?: () => void } | (() => void) | void} ModuleInitResult */
/** @typedef {Promise<ModuleInitResult>} ModuleInitPromise */
/** @typedef {() => ModuleInitResult | ModuleInitPromise} AppModuleInitFn */
/** @typedef {Parameters<typeof loadAllPersist>[0]} LoadAllDeps */
/** @typedef {Parameters<typeof _exportBackup>[0]} ExportBackupDeps */
/** @typedef {Parameters<typeof _importBackup>[1]} ImportBackupDeps */
/** @typedef {Parameters<typeof _resetAll>[0]} ResetAllDeps */
/** @typedef {Parameters<typeof setupSettingsPanel>[0]} SettingsPanelDeps */
/** @typedef {Parameters<typeof initTrackerPage>[0]} TrackerPageDeps */
/** @typedef {Parameters<typeof setupMapPage>[0]} MapPageDeps */
/** @typedef {Parameters<typeof setupTextareaSizing>[0]} TextareaSizingDeps */
/** @typedef {ReturnType<typeof setupTextareaSizing>} TextareaSizingApi */
/**
 * @typedef {{
 *   setStatus: SetStatusFn,
 *   setSaveStatus: SetStatusFn,
 *   installGlobalErrorHandlers: () => void
 * }} StatusApi
 */

/**
 * @param {unknown} value
 * @returns {value is ModuleInitPromise}
 */
function isModuleInitPromise(value) {
  return !!value && typeof value === "object" && "catch" in value && typeof value.catch === "function";
}

// Status line + global error surface
/** @type {StatusApi} */
const StatusApi = {
  setStatus: () => { },
  setSaveStatus: () => { },
  installGlobalErrorHandlers: () => { }
};

const StateGuard = installStateMutationGuard(state, {
  mode: DEV_STATE_GUARD_MODE,
  helperHint: "Use createStateActions(...) helpers for mutations so changes stay explicit and save-aware."
});
/** @type {AppState} */
const appState = StateGuard.state;
if (DEV_MODE) {
  const appGlobals = /** @type {typeof globalThis & { __APP_STATE__?: AppState }} */ (globalThis);
  appGlobals.__APP_STATE__ = appState;
}
if (DEV_MODE && StateGuard.enabled) {
  installStateMutationAllowanceLifecycle();
}

/************************ Shared file picker ************************/
// One hidden <input type="file"> for the whole app.
const ImagePicker = createFilePicker({ accept: "image/*" });

// Local persistence (kept as a tiny wrapper for SaveManager + autosize integration)
function saveAll() {
  return saveAllLocal({
    storageKey: STORAGE_KEY,
    state: appState,
    currentSchemaVersion: CURRENT_SCHEMA_VERSION,
    sanitizeForSave
  });
}

/**
 * @returns {ExportBackupDeps}
 */
function createExportBackupDeps() {
  return {
    state: appState,
    ensureMapManager,
    getBlob,
    blobToDataUrl,
    getAllTexts,
    sanitizeForSave
  };
}

/**
 * @returns {LoadAllDeps}
 */
function createLoadAllDeps() {
  return {
    storageKey: STORAGE_KEY,
    state: appState,
    migrateState,
    ensureMapManager,
    dataUrlToBlob,
    putBlob,
    setStatus: StatusApi.setStatus,
    markDirty: SaveManager.markDirty
  };
}

/**
 * @returns {ImportBackupDeps}
 */
function createImportBackupDeps() {
  return {
    state: appState,
    ensureMapManager,
    migrateState,
    sanitizeForSave,
    saveAll,
    putBlob,
    deleteBlob,
    dataUrlToBlob,
    putText,
    afterImport: async () => {
      try { location.reload(); } catch (_) { }
    }
  };
}

/**
 * @returns {ResetAllDeps}
 */
function createResetAllDeps() {
  return {
    ACTIVE_TAB_KEY,
    STORAGE_KEY,
    clearAllBlobs,
    clearAllTexts,
    flush: async () => {
      await SaveManager.flush();
    },
    setStatus: StatusApi.setStatus
  };
}

// ---------- Save Manager (debounced + queued) ----------
/** @type {SaveManagerApi} */
const SaveManager = createSaveManager({
  saveAll,
  setStatus: (message, opts) => StatusApi.setSaveStatus(message, opts),
  showSaveBanner: (opts) => showSaveBanner(opts),
  hideSaveBanner: () => hideSaveBanner(),
  onExport: () => _exportBackup(createExportBackupDeps()),
  debounceMs: 250,
  savedText: "Saved locally.",
  dirtyText: "Unsaved changes",
  savingText: "Saving...",
  errorText: "Save failed (local). Export a backup."
});

// Best-effort: try to flush on tab close / background.
installExitSave(SaveManager);
// Centralized popover/dropdown manager (outside click, escape, resize reposition)
// Uses the shared positioning helper below (function declaration hoists).
/** @type {PopoversApi} */
const Popovers = createPopoverManager({
  positionFn: (menu, anchor, opts) => positionMenuOnScreen(menu, anchor, opts)
});

// Theme manager (system/light/dark + named themes)
/** @type {ThemeManager} */
const Theme = createThemeManager({
  state: appState
});

/** @type {((el: HTMLTextAreaElement | null | undefined) => void) | undefined} */
let applyTextareaSize;

// Disable autocomplete globally (prevent password managers from hijacking our custom dialogs)
/**
 * @param {Document | HTMLElement} [root]
 * @returns {void}
 */
function disableAutocompleteGlobally(root = document) {
  const fields = root.querySelectorAll('input, textarea, select');
  fields.forEach(el => {
    el.setAttribute('autocomplete', 'off');
  });
}

/**
 * @returns {SettingsPanelDeps}
 */
function createSettingsPanelDeps() {
  return {
    state: appState,
    storageKeys: { STORAGE_KEY, ACTIVE_TAB_KEY },
    applyTheme: Theme.applyTheme,
    markDirty: () => SaveManager.markDirty(),
    flush: () => SaveManager.flush(),
    Popovers,
    exportBackup: () => _exportBackup(createExportBackupDeps()),
    importBackup: (event) => withAllowedStateMutationAsync(() => _importBackup(event, createImportBackupDeps())),
    resetAll: () => _resetAll(createResetAllDeps()),
    clearAllBlobs,
    clearAllTexts,
    setStatus: StatusApi.setStatus
  };
}

/**
 * @returns {TrackerPageDeps}
 */
function createTrackerPageDeps() {
  return {
    state: appState,
    SaveManager,
    Popovers,
    uiPrompt,
    uiAlert,
    uiConfirm,
    setStatus: StatusApi.setStatus,
    makeNpc,
    makePartyMember,
    makeLocation,
    enhanceNumberSteppers,
    numberOrNull,
    pickCropStorePortrait,
    ImagePicker,
    deleteBlob,
    putBlob,
    cropImageModal,
    getPortraitAspect,
    blobIdToObjectUrl,
    textKey_spellNotes,
    putText,
    getText,
    deleteText,
    autoSizeInput,
    applyTextareaSize
  };
}

/**
 * @returns {MapPageDeps}
 */
function createMapPageDeps() {
  return {
    state: appState,
    SaveManager,
    setStatus: StatusApi.setStatus,
    positionMenuOnScreen,
    Popovers,
    ensureMapManager,
    getActiveMap,
    newMapEntry,
    blobIdToObjectUrl,
    putBlob,
    deleteBlob,
    uiPrompt,
    uiAlert,
    uiConfirm
  };
}

/**
 * @returns {TextareaSizingDeps}
 */
function createTextareaSizingDeps() {
  return {
    state: appState,
    markDirty: SaveManager.markDirty,
    saveAll,
    setStatus: StatusApi.setStatus
  };
}

/************************ Boot ***********************/
(async () => {
  if (!appState) throw new Error("app bootstrap: state is required");
  if (!SaveManager) throw new Error("app bootstrap: SaveManager is required");

  const Status = createStatus({ statusEl: document.getElementById("statusText") });
  StatusApi.setStatus = Status.setStatus;
  StatusApi.setSaveStatus = Status.setSaveStatus;
  StatusApi.installGlobalErrorHandlers = Status.installGlobalErrorHandlers;
  StatusApi.installGlobalErrorHandlers();

  /**
   * @param {string} moduleName
   * @param {unknown} err
   * @returns {void}
   */
  const _reportModuleInitError = (moduleName, err) => {
    console.error(`[app] ${moduleName} init failed:`, err);
    const message = DEV_MODE
      ? `${moduleName} failed in DEV mode. Check console for details.`
      : `${moduleName} failed to initialize. Check console for details.`;
    StatusApi.setStatus(message, { stickyMs: 5000 });
  };

  /**
   * @param {string} moduleName
   * @param {AppModuleInitFn} initFn
   * @returns {ModuleInitResult | ModuleInitPromise}
   */
  const runModuleInit = (moduleName, initFn) => {
    let result;
    try {
      result = initFn();
    } catch (err) {
      _reportModuleInitError(moduleName, err);
      return getNoopDestroyApi();
    }

    // If initFn returned a Promise, attach a rejection handler so async
    // failures are surfaced visibly rather than silently eaten or only
    // appearing as unhandledRejection noise in the console.
    if (isModuleInitPromise(result)) {
      result.catch((err) => _reportModuleInitError(moduleName, err));
    }

    return result;
  };

  await withAllowedStateMutationAsync(async () => {
    await loadAllPersist(createLoadAllDeps());
    // Wire CSP-safe modal dialogs (replaces window.confirm/prompt)
    runModuleInit("Dialogs", () => initDialogs());
    runModuleInit("Theme", () => Theme.initFromState());
    runModuleInit("Top navigation", () => initTopTabsNavigation({
      state: appState,
      markDirty: () => SaveManager.markDirty(),
      setStatus: StatusApi.setStatus,
      activeTabStorageKey: ACTIVE_TAB_KEY
    }));
    runModuleInit("Settings panel", () => setupSettingsPanel(createSettingsPanelDeps()));
    runModuleInit(
      "Topbar",
      () => initTopbarUI({ state: appState, SaveManager, Popovers, positionMenuOnScreen, setStatus: StatusApi.setStatus })
    );
    runModuleInit("Autosize numbers", () => autosizeAllNumbers());
    runModuleInit("Textarea sizing", () => {
      const api = setupTextareaSizing(createTextareaSizingDeps());
      applyTextareaSize = api.applyTextareaSize;
    });
    runModuleInit("Tracker page", () => initTrackerPage(createTrackerPageDeps()));
    runModuleInit("Map page", () => setupMapPage(createMapPageDeps()));
    // If migrations or initial setup changed state, persist once, then show clean status.
    await SaveManager.flush();
  });
  SaveManager.init();
})();
