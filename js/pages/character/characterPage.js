// js/pages/character/characterPage.js
// Character page composition and panel wiring.

import { initEquipmentPanel } from "../character/panels/equipmentPanel.js";
import { initAttacksPanel } from "../character/panels/attackPanel.js";
import { setupCharacterSectionReorder } from "../character/characterSectionReorder.js";
import { initSpellsPanel } from "../character/panels/spellsPanel.js";
import { initVitalsPanel } from "../character/panels/vitalsPanel.js";
import { initBasicsPanel } from "../character/panels/basicsPanel.js";
import { initProficienciesPanel } from "../character/panels/proficienciesPanel.js";
import { initAbilitiesPanel } from "../character/panels/abilitiesPanel.js";
import { initPersonalityPanel, setupCharacterCollapsibleTextareas } from "../character/panels/personalityPanel.js";
import { numberOrNull } from "../../utils/number.js";
import { requireMany, getNoopDestroyApi } from "../../utils/domGuards.js";
import { DEV_MODE } from "../../utils/dev.js";
import { getActiveCharacter, makeDefaultCharacterEntry } from "../../domain/characterHelpers.js";
import { createStateActions } from "../../domain/stateActions.js";
import { safeAsync } from "../../ui/safeAsync.js";

let _activeCharacterPageController = null;

export function initCharacterPageUI(deps) {
  _activeCharacterPageController?.destroy?.();
  _activeCharacterPageController = null;

  const {
    state,
    SaveManager,
    Popovers,

    // Character portrait flow
    ImagePicker,
    pickCropStorePortrait,
    deleteBlob,
    putBlob,
    cropImageModal,
    getPortraitAspect,
    blobIdToObjectUrl,

    // Common UI helpers
    autoSizeInput,
    enhanceNumberSteppers,
    uiAlert,
    uiConfirm,
    uiPrompt,
    setStatus
  } = deps || {};

  if (!state) throw new Error("initCharacterPageUI: state is required");
  if (!SaveManager) throw new Error("initCharacterPageUI: SaveManager is required");
  if (!setStatus) throw new Error("initCharacterPageUI requires setStatus");

  const guard = requireMany(
    { root: "#page-character" },
    {
      root: document,
      setStatus,
      context: "Character page",
      stickyMs: 5000
    }
  );
  if (!guard.ok) {
    return guard.destroy;
  }

  const destroyFns = [];
  const addDestroy = (destroyFn) => {
    if (typeof destroyFn === "function") destroyFns.push(destroyFn);
  };
  const listenerController = new AbortController();
  const listenerSignal = listenerController.signal;
  addDestroy(() => listenerController.abort());

  const addListener = (target, type, handler, options) => {
    if (!target || typeof target.addEventListener !== "function") return;
    const listenerOptions =
      typeof options === "boolean"
        ? { capture: options }
        : (options || {});
    target.addEventListener(type, handler, { ...listenerOptions, signal: listenerSignal });
  };

  /**
   * @param {string} id
   * @param {(() => string | null | undefined) | undefined} getter
   * @param {((value: string) => void) | undefined} setter
   * @returns {HTMLInputElement | HTMLTextAreaElement | null}
   */
  const bindText = (id, getter, setter) => {
    const target = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (document.getElementById(id));
    if (!target) return null;

    target.value = getter?.() ?? "";
    addListener(target, "input", () => {
      setter?.(target.value);
      SaveManager.markDirty();
    });

    return target;
  };

  /**
   * @param {string} id
   * @param {(() => number | string | null | undefined) | undefined} getter
   * @param {((value: number | null) => void) | undefined} setter
   * @param {{ min: number, max: number } | undefined} autosizeOpts
   * @returns {HTMLInputElement | HTMLTextAreaElement | null}
   */
  const bindNumber = (id, getter, setter, autosizeOpts) => {
    const target = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (document.getElementById(id));
    if (!target) return null;

    const sizeOpts = autosizeOpts || { min: 30, max: 80 };
    const initial = getter?.();
    target.value = (initial === null || initial === undefined) ? "" : String(initial);

    if (typeof autoSizeInput === "function") {
      target.classList.add("autosize");
      autoSizeInput(target, sizeOpts);
    }

    addListener(target, "input", () => {
      setter?.(numberOrNull(target.value));

      if (typeof autoSizeInput === "function") {
        autoSizeInput(target, sizeOpts);
      }

      SaveManager.markDirty();
    });

    return target;
  };

  /**
   * @param {string} panelName
   * @param {() => ({ destroy?: () => void } | null | undefined | void)} initFn
   */
  const runPanelInit = (panelName, initFn) => {
    try {
      const panelApi = initFn();
      if (panelApi && typeof panelApi === "object" && typeof panelApi.destroy === "function") {
        addDestroy(() => panelApi.destroy());
      }
      return panelApi || getNoopDestroyApi();
    } catch (err) {
      console.error(`${panelName} init failed:`, err);
      if (typeof setStatus === "function") {
        const message = DEV_MODE
          ? `${panelName} failed in DEV mode. Check console for details.`
          : `${panelName} failed to initialize. Check console for details.`;
        setStatus(message, { stickyMs: 5000 });
      }
      return getNoopDestroyApi();
    }
  };

  /************************ Character Sheet page ***********************/
  function initCharacterUI() {
    // Each panel resolves the active character independently via getActiveCharacter().
    // If no active character exists, panels return early and render empty.

    runPanelInit("Spells panel", () => initSpellsPanel(deps));
    runPanelInit("Attacks panel", () => initAttacksPanel(deps));

    runPanelInit(
      "Equipment panel",
      () => initEquipmentPanel({ ...deps, bindNumber })
    );

    runPanelInit("Basics panel", () => initBasicsPanel({
      ...deps,
      ImagePicker,
      pickCropStorePortrait,
      deleteBlob,
      putBlob,
      cropImageModal,
      getPortraitAspect,
      blobIdToObjectUrl,
      bindText,
      bindNumber,
      autoSizeInput,
      setStatus,
    }));

    runPanelInit("Vitals panel", () => initVitalsPanel({ ...deps, bindNumber }));

    runPanelInit("Proficiencies panel", () => initProficienciesPanel({ ...deps, bindText }));

    runPanelInit("Personality panel", () => initPersonalityPanel({ ...deps, bindText }));

    runPanelInit("Abilities panel", () => initAbilitiesPanel({ ...deps, bindNumber, bindText }));
    runPanelInit("Character section reorder", () => setupCharacterSectionReorder({ state, SaveManager }));
    runPanelInit("Character textarea collapse", () => setupCharacterCollapsibleTextareas({ state, SaveManager }));
  }

  /** Re-initializes the entire character page (selector + panels) after a character CRUD action. */
  function rerender() {
    initCharacterPageUI(deps);
  }

  /**
   * Populates the character selector and wires the overflow menu (New / Rename / Delete).
   */
  function initCharacterSelectorBar() {
    const selectorEl = /** @type {HTMLSelectElement | null} */ (document.getElementById("charSelector"));
    const menuBtnEl = document.getElementById("charMenuBtn");
    if (!selectorEl || !menuBtnEl) return;

    const { mutateState } = createStateActions({ state, SaveManager });

    // --- populate selector ---
    const entries = state.characters?.entries ?? [];
    const activeId = state.characters?.activeId ?? null;

    selectorEl.innerHTML = "";
    if (entries.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No characters";
      opt.disabled = true;
      selectorEl.appendChild(opt);
      selectorEl.disabled = true;
    } else {
      selectorEl.disabled = false;
      for (const entry of entries) {
        const opt = document.createElement("option");
        opt.value = entry.id;
        opt.textContent = entry.name || "Unnamed Character";
        opt.selected = entry.id === activeId;
        selectorEl.appendChild(opt);
      }
    }

    // --- wire selector change ---
    addListener(selectorEl, "change", () => {
      const newId = selectorEl.value;
      if (!newId || newId === state.characters?.activeId) return;
      mutateState((s) => { s.characters.activeId = newId; });
      rerender();
    });

    // --- build overflow menu ---
    const menu = document.createElement("div");
    menu.className = "popoverMenu charMenu";

    function addMenuItem(label, handler, isDanger = false) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "popoverMenuItem" + (isDanger ? " danger" : "");
      btn.textContent = label;
      addListener(btn, "click", safeAsync(handler, (err) => {
        console.error(label, "failed:", err);
        if (typeof setStatus === "function") setStatus(`${label} failed.`);
      }));
      menu.appendChild(btn);
    }

    addMenuItem("New Character", async () => {
      const entry = makeDefaultCharacterEntry();
      mutateState((s) => {
        s.characters.entries.push(entry);
        s.characters.activeId = entry.id;
      });
      rerender();
    });

    addMenuItem("Rename Character", async () => {
      const activeChar = getActiveCharacter(state);
      if (!activeChar) return;
      const proposed = await uiPrompt?.("Rename character to:", {
        defaultValue: activeChar.name || "",
        title: "Rename Character"
      });
      if (proposed === null || proposed === undefined) return;
      const name = String(proposed).trim() || activeChar.name || "Unnamed Character";
      mutateState((s) => {
        const entry = s.characters.entries.find((e) => e.id === s.characters.activeId);
        if (entry) entry.name = name;
      });
      rerender();
    });

    addMenuItem("Delete Character", async () => {
      const activeChar = getActiveCharacter(state);
      const charName = activeChar?.name ? `"${activeChar.name}"` : "this character";
      const ok = await uiConfirm?.(`Delete ${charName}? This cannot be undone.`, {
        title: "Delete Character",
        okText: "Delete"
      });
      if (!ok) return;
      mutateState((s) => {
        const idx = s.characters.entries.findIndex((e) => e.id === s.characters.activeId);
        if (idx !== -1) s.characters.entries.splice(idx, 1);
        const remaining = s.characters.entries;
        s.characters.activeId = remaining.length > 0 ? remaining[0].id : null;
      });
      rerender();
    }, true);

    document.body.appendChild(menu);
    addDestroy(() => menu.remove());

    if (Popovers) {
      const popoverHandle = Popovers.register({
        button: menuBtnEl,
        menu,
        preferRight: false,
        closeOnOutside: true,
        closeOnEsc: true,
        stopInsideClick: false,
        wireButton: true
      });
      addDestroy(() => {
        try { popoverHandle?.destroy?.(); } catch { /* noop */ }
      });
    }
  }

  /**
   * Shows/hides the empty-state prompt based on whether any character entries exist.
   * "Yes" creates a blank character. "No" dismisses without creating.
   * Both buttons hide the prompt so it doesn't reappear during this page session.
   */
  function initCharacterEmptyState() {
    const emptyEl = document.getElementById("charEmptyState");
    const yesBtn = document.getElementById("charEmptyStateYes");
    const noBtn = document.getElementById("charEmptyStateNo");
    if (!emptyEl || !yesBtn || !noBtn) return;

    const hasEntries = (state.characters?.entries?.length ?? 0) > 0;
    if (hasEntries) {
      emptyEl.hidden = true;
      return;
    }

    emptyEl.hidden = false;
    const { mutateState } = createStateActions({ state, SaveManager });

    function dismiss() {
      emptyEl.hidden = true;
    }

    addListener(yesBtn, "click", () => {
      const entry = makeDefaultCharacterEntry();
      mutateState((s) => {
        s.characters.entries.push(entry);
        s.characters.activeId = entry.id;
      });
      rerender();
    });

    addListener(noBtn, "click", dismiss);
  }

  // Boot character page bindings
  initCharacterEmptyState();
  initCharacterSelectorBar();
  initCharacterUI();

  const api = {
    destroy() {
      for (let i = destroyFns.length - 1; i >= 0; i--) {
        destroyFns[i]?.();
      }
      if (_activeCharacterPageController === api) {
        _activeCharacterPageController = null;
      }
    }
  };

  _activeCharacterPageController = api;
  return api;
}