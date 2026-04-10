// @ts-check
// js/ui/settingsPanel.js — wiring for the Settings / Data panel modal
//
// Keeps app.js as a composition root by moving DOM wiring for the settings
// button and data panel init into a focused module.

import { initDataPanel } from "./dataPanel.js";

/** @typedef {Parameters<typeof initDataPanel>[0]} SettingsPanelDeps */

/**
 * @param {SettingsPanelDeps} deps
 * @returns {ReturnType<typeof initDataPanel> | void}
 */
export function setupSettingsPanel(deps) {
  const {
    state,
    storageKeys,
    applyTheme,
    markDirty,
    flush,
    Popovers,
    exportBackup,
    importBackup,
    resetAll,
    clearAllBlobs,
    clearAllTexts,
    openCampaignHub,
    setStatus,
  } = deps || {};

  if (!state) throw new Error("setupSettingsPanel: state is required");
  if (!storageKeys) throw new Error("setupSettingsPanel: storageKeys is required");
  if (typeof applyTheme !== "function") throw new Error("setupSettingsPanel: applyTheme() is required");
  if (typeof markDirty !== "function") throw new Error("setupSettingsPanel: markDirty() is required");
  if (typeof flush !== "function") throw new Error("setupSettingsPanel: flush() is required");

  const dataPanelApi = initDataPanel({
    state,
    storageKeys,
    applyTheme,
    markDirty,
    flush,
    Popovers,
    exportBackup,
    importBackup,
    resetAll,
    clearAllBlobs,
    clearAllTexts,
    openCampaignHub,
    setStatus,
  });

  const triggerButtons = [
    document.getElementById("settingsBtn"),
    document.getElementById("hubSettingsBtn")
  ].filter((button) => button instanceof HTMLButtonElement);

  if (!triggerButtons.length) {
    setStatus?.("Settings button unavailable.", { stickyMs: 5000 });
    return dataPanelApi;
  }

  triggerButtons.forEach((button) => {
    button.addEventListener("click", () => {
      dataPanelApi?.open?.();
    });
  });

  return dataPanelApi;
}
