// js/ui/dataPanel.js
// Modal "Data & Settings" panel.
// Keeps app.js lean by dependency-injecting actions (backup/reset/theme/etc).

import { uiConfirm, uiAlert } from "./dialogs.js";
import { enhanceSelectDropdown } from "./selectDropdown.js";
import { safeAsync } from "./safeAsync.js";
import { requireMany, getNoopDestroyApi } from "../utils/domGuards.js";

let _activeDataPanel = null;

function notifyStatus(setStatus, message) {
  if (typeof setStatus === "function") {
    setStatus(message);
    return;
  }
  console.warn(message);
}

/**
 * @param {{
 *  state: any,
 *  storageKeys: { STORAGE_KEY: string, ACTIVE_TAB_KEY: string },
 *  applyTheme: (theme:string)=>void,
 *  markDirty: ()=>void,
 *  flush: ()=>Promise<any>|any,
 *  exportBackup: ()=>Promise<any>|any,
 *  importBackup: (e:Event)=>Promise<any>|any,
 *  resetAll: ()=>Promise<any>|any,
 *  clearAllBlobs: ()=>Promise<any>|any,
 *  clearAllTexts: ()=>Promise<any>|any,
 *  setStatus: (msg:string)=>void,
 *  Popovers?: any,
 * }} deps
 */
export function initDataPanel(deps) {
  _activeDataPanel?.destroy?.();
  _activeDataPanel = null;

  const {
    state,
    storageKeys,
    applyTheme,
    markDirty,
    flush,
    exportBackup,
    importBackup,
    resetAll,
    clearAllBlobs,
    clearAllTexts,
    setStatus,
    Popovers
  } = deps;

  const guard = requireMany(
    {
      overlay: "#dataPanelOverlay",
      panel: "#dataPanelPanel",
      closeBtn: "#dataPanelClose"
    },
    { root: document, setStatus, context: "Data panel" }
  );
  if (!guard.ok) return guard.destroy;
  const overlay = /** @type {HTMLElement} */ (guard.els.overlay);
  const panel = /** @type {HTMLElement} */ (guard.els.panel);
  const closeBtn = /** @type {HTMLButtonElement} */ (guard.els.closeBtn);

  const listenerController = new AbortController();
  const listenerSignal = listenerController.signal;
  const addListener = (target, type, handler, options) => {
    if (!target || typeof target.addEventListener !== "function") return;
    const listenerOptions =
      typeof options === "boolean"
        ? { capture: options }
        : (options || {});
    target.addEventListener(type, handler, { ...listenerOptions, signal: listenerSignal });
  };

  const themeSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById("dataPanelThemeSelect"));

  // Populate the Theme dropdown groups once.
  if (themeSelect && !themeSelect.dataset.built) {
    buildThemeOptions(themeSelect);
    themeSelect.dataset.built = "1";
  }

  // Enhance the Theme <select> into a custom dropdown that matches the Map Tools menu.
  // This is the only reliable way to style the *open* menu consistently across browsers.
  if (themeSelect && Popovers && !themeSelect.dataset.dropdownEnhanced) {
    enhanceSelectDropdown({
      select: themeSelect,
      Popovers,
      // Keep the CLOSED control looking like the original <select> (same size),
      // while the OPEN menu uses the Map Tools menu look.
      buttonClass: "settingsSelectBtn settingsDropDownBtn",
      optionClass: "swatchOption",
      groupLabelClass: "dropdownGroupLabel",
      preferRight: true
    });
  }

  function open() {
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    // Sync theme select
    if (themeSelect) {
      const current = (state?.tracker?.ui && typeof state.tracker.ui.theme === "string")
        ? state.tracker.ui.theme
        : (state?.ui && typeof state.ui.theme === "string")
          ? state.ui.theme
          : "system";
      themeSelect.value = current;
      // Sync enhanced dropdown label without firing the real change handler.
      try { themeSelect.dispatchEvent(new Event("selectDropdown:sync")); } catch { }
    }
    // Focus close for keyboard users
    (closeBtn || panel).focus?.();
  }

  function close() {
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
  }

  // allow other modules (settings dropdown) to open it
  window.openDataPanel = open;

  // Close interactions
  if (closeBtn) addListener(closeBtn, "click", close);
  addListener(overlay, "click", (e) => {
    if (e.target === overlay) close();
  });
  addListener(document, "keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) close();
  });

  // Theme change
  if (themeSelect) {
    addListener(themeSelect, "change", () => {
      const val = themeSelect.value || "system";
      applyTheme(val);
      // Preserve whichever UI bucket exists (legacy tracker.ui or root ui).
      if (state?.tracker?.ui) state.tracker.ui.theme = val;
      else {
        state.ui = state.ui || {};
        state.ui.theme = val;
      }
      markDirty();
    });
  }

  // Buttons
  const exportBtn = document.getElementById("dataExportBtn");
  const importFile = /** @type {HTMLInputElement|null} */ (document.getElementById("dataImportFile"));
  const resetAllBtn = document.getElementById("dataResetAllBtn");
  const resetUiBtn = document.getElementById("dataResetUiBtn");
  const clearImagesBtn = document.getElementById("dataClearImagesBtn");
  const clearTextsBtn = document.getElementById("dataClearTextsBtn");
  const aboutBtn = document.getElementById("dataAboutBtn");

  if (exportBtn) addListener(exportBtn, "click", () => exportBackup());
  if (importFile) addListener(importFile, "change", (e) => importBackup(e));

  if (resetAllBtn) addListener(resetAllBtn, "click",
    safeAsync(async () => {
      close();
      await resetAll();
    }, (err) => {
      console.error(err);
      notifyStatus(setStatus, "Reset all failed.");
    })
  );

  if (resetUiBtn) addListener(resetUiBtn, "click",
    safeAsync(async () => {
    const ok = await uiConfirm("Reset UI settings only?\n\nThis will reset theme + UI layout prefs (like last active tab). It will NOT delete your campaign data.");
    if (!ok) return;

    try {
      notifyStatus(setStatus, "Resetting UI…");
      await flush?.();

      // Clear UI-only localStorage keys
      try { localStorage.removeItem(storageKeys.ACTIVE_TAB_KEY); } catch {}
      // Reset UI subtree
      if (state?.tracker?.ui) {
        state.tracker.ui = { textareaHeights: {} };
      } else if (state?.ui) {
        state.ui = { textareaHeights: {} };
      }
      applyTheme("system");
      markDirty();
      await flush?.();

      notifyStatus(setStatus, "UI reset. Reloading…");
      location.reload();
    } catch (err) {
      console.error(err);
      await uiAlert("Could not reset UI settings. See console for details.");
      notifyStatus(setStatus, "Reset UI failed");
    }
    }, (err) => {
      console.error(err);
      notifyStatus(setStatus, "Reset UI failed.");
    })
  );

  if (clearImagesBtn) addListener(clearImagesBtn, "click",
    safeAsync(async () => {
    const ok = await uiConfirm("Clear ALL saved images?\n\nThis removes portraits and map images stored in your browser. Your campaign data stays.");
    if (!ok) return;

    try {
      notifyStatus(setStatus, "Clearing images…");
      await flush?.();

      // Remove blob references from state to avoid dangling ids
      removeAllBlobIds(state);

      markDirty();
      await flush?.();

      // Clear IndexedDB blobs
      await clearAllBlobs?.();

      notifyStatus(setStatus, "Images cleared. Reloading…");
      location.reload();
    } catch (err) {
      console.error(err);
      await uiAlert("Could not clear images. See console for details.");
      notifyStatus(setStatus, "Clear images failed");
    }
    }, (err) => {
      console.error(err);
      notifyStatus(setStatus, "Clear images failed.");
    })
  );

  if (clearTextsBtn) addListener(clearTextsBtn, "click",
    safeAsync(async () => {
    const ok = await uiConfirm("Clear ALL saved long texts (notes) stored in the browser?\n\nThis does not delete your campaign cards, but it will remove any large notes stored separately.");
    if (!ok) return;

    try {
      notifyStatus(setStatus, "Clearing texts…");
      await flush?.();
      await clearAllTexts?.();
      notifyStatus(setStatus, "Texts cleared. Reloading…");
      location.reload();
    } catch (err) {
      console.error(err);
      await uiAlert("Could not clear texts. See console for details.");
      notifyStatus(setStatus, "Clear texts failed");
    }
    }, (err) => {
      console.error(err);
      notifyStatus(setStatus, "Clear texts failed.");
    })
  );

  if (aboutBtn) addListener(aboutBtn, "click",
    safeAsync(async () => {
    const appName = (state?.tracker && typeof state.tracker.campaignTitle === "string" && state.tracker.campaignTitle.trim())
      ? state.tracker.campaignTitle.trim()
      : "My Campaign Tracker";

    const schema = Number.isFinite(state?.schemaVersion) ? state.schemaVersion : "?";
    const version = (window.__APP_VERSION__ || window.APP_VERSION || "dev").toString();
    const build = (window.__APP_BUILD__ || window.APP_BUILD || "").toString();
    const lastModified = (document.lastModified || "").toString();

    const lines = [
      `${appName}`,
      "",
      `Version: ${version}`,
      build ? `Build: ${build}` : null,
      `Schema: v${schema}`,
      lastModified ? `Last modified: ${lastModified}` : null,
      "",
      "Local storage keys:",
      `• Data: ${storageKeys?.STORAGE_KEY || "(unknown)"}`,
      `• UI tab: ${storageKeys?.ACTIVE_TAB_KEY || "(unknown)"}`,
    ].filter(Boolean);

      await uiAlert(lines.join("\n"), { title: "About" });
    }, (err) => {
      console.error(err);
      notifyStatus(setStatus, "Open about failed.");
    })
  );

  const api = {
    destroy() {
      listenerController.abort();
      if (window.openDataPanel === open) {
        delete window.openDataPanel;
      }
      if (_activeDataPanel === api) _activeDataPanel = null;
    }
  };

  _activeDataPanel = api;
  return api;
}

function buildThemeOptions(select) {
  // value => label (label is what the user sees)
  const light = [
    ["light", "Light"],
    ["beige", "Parchment"],
    ["rose", "Blush"],
    ["teal", "Teal"],
    ["blue", "Pondera Blue"],
  ];

  const dark = [
    ["dark", "Dark"],
    ["purple", "Purple"],
    ["red", "Crimson"],
    ["red-gold", "Royal Red"],
    ["arcane", "Arcane"],
    ["arcane-gold", "Arcane Gold"],
    ["green", "Toxic Core"],
    ["slate", "Stone"],
    ["forest", "Forest"],
    ["ember", "Dark Copper"],
    ["sepia", "Sepia"],
  ];

  // Clear existing options
  select.innerHTML = "";

  // Default (System)
  select.appendChild(new Option("Default", "system"));

  // Light group
  const gLight = document.createElement("optgroup");
  gLight.label = "✶ Light Themes";
  for (const [value, label] of light) gLight.appendChild(new Option(label, value));
  select.appendChild(gLight);

  // Dark group
  const gDark = document.createElement("optgroup");
  gDark.label = "☾ Dark Themes";
  for (const [value, label] of dark) gDark.appendChild(new Option(label, value));
  select.appendChild(gDark);
}

/** Remove any *BlobId references inside an object graph (best effort). */
function removeAllBlobIds(root) {
  const seen = new Set();
  const stack = [root];

  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);

    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }

    for (const k of Object.keys(cur)) {
      const v = cur[k];
      if (k === "imgBlobId" || k === "bgBlobId" || k === "drawingBlobId" || k.endsWith("BlobId")) {
        cur[k] = null;
        continue;
      }
      if (v && typeof v === "object") stack.push(v);
    }
  }
}
