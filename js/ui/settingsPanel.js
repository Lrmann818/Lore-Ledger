// @ts-check
// js/ui/settingsPanel.js — wiring for the Settings / Data panel modal
//
// Keeps app.js as a composition root by moving DOM wiring for the settings
// button and data panel init into a focused module.

import { initDataPanel } from "./dataPanel.js";
import { requireMany } from "../utils/domGuards.js";

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

  // Settings button opens the modal directly
  const guard = requireMany(
    { settingsBtn: "#settingsBtn" },
    { root: document, setStatus, context: "Settings button" }
  );
  if (!guard.ok) return guard.destroy;
  const { settingsBtn } = guard.els;

  settingsBtn.addEventListener("click", () => {
    dataPanelApi?.open?.();
  });

  return dataPanelApi;
}
