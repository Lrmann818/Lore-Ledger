// @ts-check
// js/storage/saveManager.js — debounced + queued local save manager
//
// Dependency-injected so app.js can provide saveAll() and setStatus()
// without circular imports.
//
// Usage:
//   const SaveManager = createSaveManager({ saveAll, setStatus });
//   SaveManager.init();
//   SaveManager.markDirty();

/**
 * @typedef {"SAVED" | "DIRTY" | "SAVING" | "ERROR"} SaveLifecycleState
 */

/**
 * @typedef {{ stickyMs?: number }} SaveStatusOptions
 */

/**
 * @typedef {{ stateNow: SaveLifecycleState, dirty: boolean, saving: boolean }} SaveManagerStatus
 */

/**
 * @typedef {{
 *   markDirty: () => void,
 *   queueSave?: () => void,
 *   reportError: () => void,
 *   flush: () => Promise<boolean>,
 *   init: () => void,
 *   getStatus: () => SaveManagerStatus
 * }} SaveManager
 */

/**
 * @typedef {{
 *   saveAll: () => boolean,
 *   setStatus: (message: string, opts?: SaveStatusOptions) => void,
 *   debounceMs?: number,
 *   dirtyDelayMs?: number,
 *   savedText?: string,
 *   dirtyText?: string,
 *   savingText?: string,
 *   errorText?: string
 *   showSaveBanner?: (opts?: { onExport?: () => void }) => void,
 *   hideSaveBanner?: () => void
 *   onExport?: () => Promise<void>
 * }} SaveManagerOptions
 */

/**
 * @param {SaveManagerOptions} [opts]
 * @returns {SaveManager}
 */
export function createSaveManager(opts) {
  const {
    saveAll,
    setStatus,
    showSaveBanner,
    hideSaveBanner,
    onExport,
    debounceMs = 250,
    // Prevent "Unsaved changes" flicker when we auto-save quickly (e.g., tab switches
    // that trigger harmless state normalization). If dirty clears before this delay,
    // the user never sees the DIRTY state.
    dirtyDelayMs = 400,
    savedText = "Saved locally.",
    dirtyText = "Unsaved changes",
    savingText = "Saving...",
    errorText = "Save failed (local). Export a backup."
  } = opts || {};

  if (typeof saveAll !== "function") throw new Error("createSaveManager: saveAll() is required");
  if (typeof setStatus !== "function") throw new Error("createSaveManager: setStatus() is required");

  const SaveState = /** @type {const} */ ({
    SAVED: "SAVED",
    DIRTY: "DIRTY",
    SAVING: "SAVING",
    ERROR: "ERROR"
  });

  /** @type {SaveLifecycleState} */
  let stateNow = SaveState.SAVED;
  let dirty = false;
  let saving = false;
  let saveRequested = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let debounceTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let dirtyUiTimer = null;

  function renderStatus() {
    if (stateNow === SaveState.SAVING) return setStatus(savingText);
    if (stateNow === SaveState.DIRTY) return setStatus(dirtyText);
    if (stateNow === SaveState.ERROR) return setStatus(errorText);
    return setStatus(savedText);
  }

  function clearDirtyUiTimer() {
    if (dirtyUiTimer) clearTimeout(dirtyUiTimer);
    dirtyUiTimer = null;
  }

  function scheduleDirtyUi() {
    // If we're actively saving, showing DIRTY is misleading.
    if (saving) return;
    clearDirtyUiTimer();
    dirtyUiTimer = setTimeout(() => {
      dirtyUiTimer = null;
      // Only show DIRTY if we're still dirty and not saving.
      if (dirty && !saving) {
        stateNow = SaveState.DIRTY;
        renderStatus();
      }
    }, Math.max(0, dirtyDelayMs | 0));
  }

  function markDirty() {
    dirty = true;
    // Delay showing DIRTY to avoid UI flicker when dirty clears quickly.
    // If we were in ERROR, we also want to move away from the error message
    // once the user changes something again (still delayed to avoid flicker).
    scheduleDirtyUi();

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      flush().catch(() => {});
    }, debounceMs);
  }

  function reportError() {
    showSaveBanner?.({ onExport });
    clearDirtyUiTimer();
    stateNow = SaveState.ERROR;
    renderStatus();
  }

  async function flush() {
    if (!dirty) {
      if (!saving) {
        clearDirtyUiTimer();
        stateNow = SaveState.SAVED;
        renderStatus();
      }
      return true;
    }

    if (saving) {
      saveRequested = true;
      return false;
    }

    saving = true;
    clearDirtyUiTimer();
    stateNow = SaveState.SAVING;
    renderStatus();

    try {
      const ok = saveAll();
      if (!ok) throw new Error("local save failed");
      hideSaveBanner?.();
      dirty = false;
      clearDirtyUiTimer();
      stateNow = SaveState.SAVED;
      renderStatus();
      return true;
    } catch (err) {
      console.warn("Save failed:", err);
      reportError();
      return false;
    } finally {
      saving = false;
      if (saveRequested) {
        saveRequested = false;
        if (dirty) await flush();
      }
    }
  }

  function init() {
    stateNow = SaveState.SAVED;
    dirty = false;
    saving = false;
    saveRequested = false;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    clearDirtyUiTimer();
    renderStatus();
  }

  function getStatus() {
    return { stateNow, dirty, saving };
  }

  return { markDirty, reportError, flush, init, getStatus };
}
