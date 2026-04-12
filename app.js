// @ts-check

/************************ App Composition Root ************************
 * Wires shared services (state guard, persistence, popovers, theme)
 * and initializes tracker/character/map modules.
 ***************************************************************************/

import "./js/pwa/pwa.js";

import {
  STORAGE_KEY,
  ACTIVE_TAB_KEY,
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
  getTextRecord,
  deleteText,
  clearAllTexts
} from "./js/storage/texts-idb.js";

import {
  exportBackup as _exportBackup,
  importBackup as _importBackup,
  resetAll as _resetAll
} from "./js/storage/backup.js";
import { createSaveManager } from "./js/storage/saveManager.js";
import {
  loadAll as loadAllPersist,
  installExitSave,
  saveAllLocal,
  switchCampaign as switchCampaignPersist
} from "./js/storage/persistence.js";


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
import { playHubOpenSoundForState } from "./js/audio/hubOpenSound.js";

import { setupSettingsPanel } from "./js/ui/settingsPanel.js";
import { initTrackerPage } from "./js/pages/tracker/trackerPage.js";
import { initCombatPage } from "./js/pages/combat/combatPage.js";
import { initCampaignHubPage } from "./js/pages/hub/campaignHubPage.js";

import { setupMapPage } from "./js/pages/map/mapPage.js";
import {
  createCampaignInVault,
  deleteCampaignFromVault,
  getCanonicalCampaignName,
  normalizeCampaignVault,
  renameCampaignInVault
} from "./js/storage/campaignVault.js";

/** @typedef {import("./js/state.js").State} AppState */
/** @typedef {ReturnType<typeof createSaveManager>} SaveManagerApi */
/** @typedef {ReturnType<typeof createStatus>} StatusManager */
/** @typedef {ReturnType<typeof createPopoverManager>} PopoversApi */
/** @typedef {ReturnType<typeof createThemeManager>} ThemeManager */
/** @typedef {ReturnType<typeof initTopTabsNavigation>} TopTabsNavigationApi */
/** @typedef {ReturnType<typeof initCampaignHubPage>} CampaignHubPageApi */
/** @typedef {Parameters<StatusManager["setStatus"]>[1]} StatusOptions */
/** @typedef {(message: string, opts?: StatusOptions) => void} SetStatusFn */
/** @typedef {{ destroy?: () => void } | (() => void) | void} ModuleInitResult */
/** @typedef {Promise<ModuleInitResult>} ModuleInitPromise */
/** @typedef {() => ModuleInitResult | ModuleInitPromise} AppModuleInitFn */
/** @typedef {Parameters<typeof loadAllPersist>[0]} LoadAllDeps */
/** @typedef {Parameters<typeof switchCampaignPersist>[0]} SwitchCampaignDeps */
/** @typedef {Parameters<typeof _exportBackup>[0]} ExportBackupDeps */
/** @typedef {Parameters<typeof _importBackup>[1]} ImportBackupDeps */
/** @typedef {Parameters<typeof _resetAll>[0]} ResetAllDeps */
/** @typedef {Parameters<typeof setupSettingsPanel>[0]} SettingsPanelDeps */
/** @typedef {Parameters<typeof initTrackerPage>[0]} TrackerPageDeps */
/** @typedef {Parameters<typeof initCombatPage>[0]} CombatPageDeps */
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

const VaultRuntime = { current: null };

/************************ Shared file picker ************************/
// One hidden <input type="file"> for the whole app.
const ImagePicker = createFilePicker({ accept: "image/*" });

// Local persistence (kept as a tiny wrapper for SaveManager + autosize integration)
function saveAll() {
  return saveAllLocal({
    storageKey: STORAGE_KEY,
    state: appState,
    migrateState,
    sanitizeForSave,
    vaultRuntime: VaultRuntime
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
    getTextRecord,
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
    sanitizeForSave,
    dataUrlToBlob,
    putBlob,
    setStatus: StatusApi.setStatus,
    markDirty: SaveManager.markDirty,
    vaultRuntime: VaultRuntime
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
    saveAll: () => {
      const activeCampaignId = typeof appState.appShell?.activeCampaignId === "string"
        ? appState.appShell.activeCampaignId.trim()
        : "";
      if (activeCampaignId) {
        return saveAll();
      }

      const baseVault = VaultRuntime.current || normalizeCampaignVault(null, { migrateState, sanitizeForSave }).vault;
      const created = createCampaignInVault(baseVault, {
        migrateState,
        sanitizeForSave,
        name: appState.tracker?.campaignTitle
      });
      const previousCampaignId = appState.appShell.activeCampaignId;
      const tempVaultRuntime = { current: created.vault };

      appState.appShell.activeCampaignId = created.campaignId;
      const ok = saveAllLocal({
        storageKey: STORAGE_KEY,
        state: appState,
        migrateState,
        sanitizeForSave,
        vaultRuntime: tempVaultRuntime
      });

      if (ok) {
        VaultRuntime.current = tempVaultRuntime.current;
        return true;
      }

      appState.appShell.activeCampaignId = previousCampaignId;
      return false;
    },
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
 * @param {{ openCampaignHub?: () => Promise<void> }} [opts]
 * @returns {SettingsPanelDeps}
 */
function createSettingsPanelDeps(opts = {}) {
  const { openCampaignHub } = opts;
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
    setStatus: StatusApi.setStatus,
    openCampaignHub
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
    // Resolve lazily so Tracker deps stay safe even if this assembly runs
    // before textarea sizing initialization assigns the implementation.
    applyTextareaSize: (el) => applyTextareaSize?.(el)
  };
}

/**
 * @returns {CombatPageDeps}
 */
function createCombatPageDeps() {
  return {
    state: appState,
    SaveManager,
    uiConfirm,
    uiPrompt,
    setStatus: StatusApi.setStatus,
    Popovers,
    blobIdToObjectUrl,
    textKey_spellNotes,
    putText,
    getText,
    deleteText,
    autoSizeInput,
    enhanceNumberSteppers,
    applyTextareaSize: (el) => applyTextareaSize?.(el)
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

/**
 * @param {string | null} campaignId
 * @returns {SwitchCampaignDeps}
 */
function createSwitchCampaignDeps(campaignId) {
  return {
    state: appState,
    vaultRuntime: VaultRuntime,
    campaignId,
    migrateState,
    sanitizeForSave
  };
}

/** @type {TopTabsNavigationApi} */
const NOOP_TOP_TABS_API = {
  applyActiveTab: () => { },
  getActiveTab: () => "",
  refresh: () => { },
  destroy: () => { }
};

/** @type {CampaignHubPageApi} */
const NOOP_HUB_PAGE_API = {
  destroy: () => { },
  render: () => { }
};

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

  /** @type {ModuleInitResult | ModuleInitPromise} */
  let trackerPageApi = getNoopDestroyApi();
  /** @type {ModuleInitResult | ModuleInitPromise} */
  let combatPageApi = getNoopDestroyApi();
  /** @type {ModuleInitResult | ModuleInitPromise} */
  let mapPageApi = getNoopDestroyApi();
  /** @type {TopTabsNavigationApi} */
  let topTabsApi = NOOP_TOP_TABS_API;
  /** @type {CampaignHubPageApi} */
  let campaignHubPageApi = NOOP_HUB_PAGE_API;

  const hasActiveCampaign = () => !!appState.appShell?.activeCampaignId;
  const isCampaignContentTab = (tabName) => ["tracker", "combat", "character", "map"].includes(tabName);
  const canActivateTab = (tabName) => {
    if (tabName === "hub") return !hasActiveCampaign();
    return !isCampaignContentTab(tabName) || hasActiveCampaign();
  };
  const getDefaultLandingTab = () => (hasActiveCampaign() ? "tracker" : "hub");

  const ensureVaultRuntime = () => {
    if (!VaultRuntime.current) {
      VaultRuntime.current = normalizeCampaignVault(null, { migrateState, sanitizeForSave }).vault;
    }
    return VaultRuntime.current;
  };

  const getActiveCampaignName = () => {
    const activeCampaignId = appState.appShell?.activeCampaignId ?? null;
    if (!activeCampaignId) return "Lore Ledger";
    const canonicalName = VaultRuntime.current?.campaignIndex?.entries?.[activeCampaignId]?.name;
    return getCanonicalCampaignName(canonicalName || appState.tracker?.campaignTitle);
  };

  const syncShellMode = () => {
    const shellMode = hasActiveCampaign() ? "campaign" : "hub";
    document.documentElement.dataset.shellMode = shellMode;
    document.body.dataset.shellMode = shellMode;
    const topbarEl = document.querySelector(".topbar");
    topbarEl?.toggleAttribute("hidden", !hasActiveCampaign());
    const campaignTabsEl = document.getElementById("campaignTabs");
    campaignTabsEl?.toggleAttribute("hidden", !hasActiveCampaign());
  };

  /**
   * @param {boolean} showHub
   * @returns {void}
   */
  const syncHubPageVisibility = (showHub) => {
    const hubPage = document.getElementById("page-hub");
    if (!hubPage) return;
    hubPage.classList.toggle("active", showHub);
    hubPage.toggleAttribute("hidden", !showHub);
  };

  const syncAppShellTitle = () => {
    const campaignTitleEl = document.getElementById("campaignTitle");
    if (!campaignTitleEl) return;

    if (hasActiveCampaign()) {
      campaignTitleEl.textContent = getActiveCampaignName();
      campaignTitleEl.setAttribute("contenteditable", "true");
      campaignTitleEl.setAttribute("aria-label", "Campaign title");
      return;
    }

    campaignTitleEl.textContent = "Lore Ledger";
    campaignTitleEl.setAttribute("contenteditable", "false");
    campaignTitleEl.setAttribute("aria-label", "Lore Ledger");
  };

  /**
   * @param {{ targetTab?: string | null }} [opts]
   * @returns {void}
   */
  const refreshShellUi = ({ targetTab = null } = {}) => {
    syncShellMode();
    syncAppShellTitle();
    if (hasActiveCampaign()) {
      syncHubPageVisibility(false);
      if (targetTab) topTabsApi.applyActiveTab(targetTab, { markDirty: false });
      else topTabsApi.refresh();
    } else {
      syncHubPageVisibility(true);
      topTabsApi.refresh();
    }
    campaignHubPageApi.render();
  };

  const destroyCampaignModules = () => {
    if (
      trackerPageApi &&
      typeof trackerPageApi === "object" &&
      "destroy" in trackerPageApi &&
      typeof trackerPageApi.destroy === "function"
    ) {
      trackerPageApi.destroy();
    }
    if (
      combatPageApi &&
      typeof combatPageApi === "object" &&
      "destroy" in combatPageApi &&
      typeof combatPageApi.destroy === "function"
    ) {
      combatPageApi.destroy();
    }
    if (
      mapPageApi &&
      typeof mapPageApi === "object" &&
      "destroy" in mapPageApi &&
      typeof mapPageApi.destroy === "function"
    ) {
      mapPageApi.destroy();
    }
    trackerPageApi = getNoopDestroyApi();
    combatPageApi = getNoopDestroyApi();
    mapPageApi = getNoopDestroyApi();
  };

  const initCampaignModules = () => {
    if (!hasActiveCampaign()) return;
    trackerPageApi = runModuleInit("Tracker page", () => initTrackerPage(createTrackerPageDeps()));
    combatPageApi = runModuleInit("Combat page", () => initCombatPage(createCombatPageDeps()));
    mapPageApi = runModuleInit("Map page", () => setupMapPage(createMapPageDeps()));
  };

  /**
   * @param {string | null} campaignId
   * @param {{ targetTab?: string | null }} [opts]
   * @returns {Promise<void>}
   */
  async function switchActiveCampaign(campaignId, { targetTab = null } = {}) {
    const normalizedCampaignId = typeof campaignId === "string" ? campaignId.trim() || null : null;
    if (normalizedCampaignId === (appState.appShell?.activeCampaignId ?? null)) {
      refreshShellUi({ targetTab });
      return;
    }

    await SaveManager.flush();
    await withAllowedStateMutationAsync(async () => {
      switchCampaignPersist(createSwitchCampaignDeps(normalizedCampaignId));
      destroyCampaignModules();
      if (hasActiveCampaign()) initCampaignModules();
      refreshShellUi({ targetTab });
      SaveManager.markDirty();
      await SaveManager.flush();
    });
  }

  /**
   * @param {string} name
   * @returns {Promise<void>}
   */
  async function createCampaign(name) {
    await SaveManager.flush();
    await withAllowedStateMutationAsync(async () => {
      const created = createCampaignInVault(ensureVaultRuntime(), {
        migrateState,
        sanitizeForSave,
        name
      });
      VaultRuntime.current = created.vault;
      switchCampaignPersist(createSwitchCampaignDeps(created.campaignId));
      destroyCampaignModules();
      initCampaignModules();
      refreshShellUi({ targetTab: "tracker" });
      SaveManager.markDirty();
      await SaveManager.flush();
    });
  }

  /**
   * @param {string} campaignId
   * @param {string} nextName
   * @returns {Promise<void>}
   */
  async function renameCampaign(campaignId, nextName) {
    await SaveManager.flush();
    await withAllowedStateMutationAsync(async () => {
      const nextVault = renameCampaignInVault(ensureVaultRuntime(), campaignId, nextName);
      VaultRuntime.current = nextVault;

      if (campaignId === (appState.appShell?.activeCampaignId ?? null)) {
        appState.tracker.campaignTitle = nextVault.campaignIndex.entries[campaignId].name;
      }

      refreshShellUi();
      SaveManager.markDirty();
      await SaveManager.flush();
    });
  }

  /**
   * @param {string} campaignId
   * @returns {Promise<void>}
   */
  async function deleteCampaign(campaignId) {
    await SaveManager.flush();
    await withAllowedStateMutationAsync(async () => {
      const normalizedCampaignId = String(campaignId || "").trim();
      const deletingActiveCampaign = normalizedCampaignId === (appState.appShell?.activeCampaignId ?? null);

      if (deletingActiveCampaign) {
        switchCampaignPersist(createSwitchCampaignDeps(null));
        destroyCampaignModules();
      }

      VaultRuntime.current = deleteCampaignFromVault(ensureVaultRuntime(), normalizedCampaignId);
      refreshShellUi();
      SaveManager.markDirty();
      await SaveManager.flush();
    });
  }

  await withAllowedStateMutationAsync(async () => {
    await loadAllPersist(createLoadAllDeps());
    // Wire CSP-safe modal dialogs (replaces window.confirm/prompt)
    runModuleInit("Dialogs", () => initDialogs());
    runModuleInit("Theme", () => Theme.initFromState());
    try {
      topTabsApi = initTopTabsNavigation({
        state: appState,
        markDirty: () => SaveManager.markDirty(),
        setStatus: StatusApi.setStatus,
        activeTabStorageKey: ACTIVE_TAB_KEY,
        defaultTab: getDefaultLandingTab(),
        canActivateTab,
        onHubEntry: () => {
          void playHubOpenSoundForState(appState);
        }
      });
    } catch (err) {
      _reportModuleInitError("Top navigation", err);
      topTabsApi = NOOP_TOP_TABS_API;
    }
    try {
      campaignHubPageApi = initCampaignHubPage({
        state: appState,
        vaultRuntime: VaultRuntime,
        uiPrompt,
        uiAlert,
        setStatus: StatusApi.setStatus,
        createCampaign,
        openCampaign: (campaignId) => switchActiveCampaign(campaignId, { targetTab: "tracker" }),
        renameCampaign,
        deleteCampaign
      });
    } catch (err) {
      _reportModuleInitError("Campaign Hub", err);
      campaignHubPageApi = NOOP_HUB_PAGE_API;
    }
    runModuleInit("Settings panel", () => setupSettingsPanel(
      createSettingsPanelDeps({ openCampaignHub: () => switchActiveCampaign(null) })
    ));
    runModuleInit(
      "Topbar",
      () => initTopbarUI({ state: appState, SaveManager, Popovers, positionMenuOnScreen, setStatus: StatusApi.setStatus })
    );
    runModuleInit("Autosize numbers", () => autosizeAllNumbers());
    runModuleInit("Textarea sizing", () => {
      const api = setupTextareaSizing(createTextareaSizingDeps());
      applyTextareaSize = api.applyTextareaSize;
    });
    if (hasActiveCampaign()) initCampaignModules();
    refreshShellUi();
    // If migrations or initial setup changed state, persist once, then show clean status.
    await SaveManager.flush();
  });
  void switchActiveCampaign;
  SaveManager.init();
})();
