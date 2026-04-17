// js/pages/character/characterPage.js
// Character page composition and panel wiring.

import { initEquipmentPanel } from "../character/panels/equipmentPanel.js";
import { initAttacksPanel } from "../character/panels/attackPanel.js";
import { setupCharacterSectionReorder } from "../character/characterSectionReorder.js";
import { initSpellsPanel } from "../character/panels/spellsPanel.js";
import { initVitalsPanel } from "../character/panels/vitalsPanel.js";
import { initBasicsPanel } from "../character/panels/basicsPanel.js";
import { initBuilderIdentityPanel } from "../character/panels/builderIdentityPanel.js";
import { initBuilderSummaryPanel } from "../character/panels/builderSummaryPanel.js";
import { initProficienciesPanel } from "../character/panels/proficienciesPanel.js";
import { initAbilitiesPanel } from "../character/panels/abilitiesPanel.js";
import { initPersonalityPanel, setupCharacterCollapsibleTextareas } from "../character/panels/personalityPanel.js";
import { numberOrNull } from "../../utils/number.js";
import { requireMany, getNoopDestroyApi } from "../../utils/domGuards.js";
import { DEV_MODE } from "../../utils/dev.js";
import {
  getActiveCharacter,
  isBuilderCharacter,
  makeDefaultBuilderCharacterEntry,
  makeDefaultCharacterEntry
} from "../../domain/characterHelpers.js";
import { notifyActiveCharacterChanged } from "../../domain/characterEvents.js";
import { createStateActions } from "../../domain/stateActions.js";
import { makeNpc, makePartyMember } from "../../domain/factories.js";
import { LINKED_FIELD_MAP, getLinkedCards, linkCardToCharacter, snapshotLinkedFieldsToCard } from "../../domain/cardLinking.js";
import {
  MAX_IMPORT_FILE_SIZE,
  commitImport,
  exportActiveCharacter,
  parseAndValidateImport
} from "../../domain/characterPortability.js";
import { notifyPanelDataChanged } from "../../ui/panelInvalidation.js";
import { safeAsync } from "../../ui/safeAsync.js";
import { enhanceSelectDropdown } from "../../ui/selectDropdown.js";
import { dataUrlToBlob as defaultDataUrlToBlob } from "../../storage/blobs.js";

let _activeCharacterPageController = null;
const _dismissedEmptyStateCampaignIds = new Set();

function getEmptyStateDismissalKey(state) {
  const campaignId = typeof state?.appShell?.activeCampaignId === "string"
    ? state.appShell.activeCampaignId.trim()
    : "";
  return campaignId || "__default__";
}

export const CHARACTER_SELECTOR_SELECT_CLASSES = "charSelectorSelect panelSelect";
export const CHARACTER_SELECTOR_BUTTON_CLASSES = "panelSelectBtn charSelectorSelectBtn";
export const CHARACTER_ACTION_BUTTON_CLASSES = "panelBtnSm charActionMenuBtn";
export const CHARACTER_ACTION_ITEM_CLASSES = "swatchOption charActionMenuItem";

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
    getBlob,
    deleteBlob,
    putBlob,
    dataUrlToBlob = defaultDataUrlToBlob,
    cropImageModal,
    getPortraitAspect,
    blobIdToObjectUrl,
    getText,
    putText,

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

    runPanelInit("Builder identity panel", () => initBuilderIdentityPanel(deps));

    runPanelInit("Builder summary panel", () => initBuilderSummaryPanel(deps));

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
   * Populates the character selector and wires the overflow action menu (New / Rename / Delete).
   */
  function initCharacterSelectorBar() {
    const selectorEl = /** @type {HTMLSelectElement | null} */ (document.getElementById("charSelector"));
    const builderBadgeEl = /** @type {HTMLElement | null} */ (document.getElementById("charBuilderModeBadge"));
    const actionMenuButtonEl = /** @type {HTMLButtonElement | null} */ (document.getElementById("charActionMenuBtn"));
    const actionMenuEl = /** @type {HTMLElement | null} */ (document.getElementById("charActionDropdownMenu"));
    if (!selectorEl || !actionMenuButtonEl || !actionMenuEl) return;

    const { addTrackerCard, mutateState } = createStateActions({ state, SaveManager });

    /**
     * @param {(state: import("../../state.js").State) => unknown} mutator
     * @returns {unknown}
     */
    function mutateCharactersAndNotify(mutator) {
      const previousId = state.characters?.activeId ?? null;
      const result = mutateState(mutator);
      const activeId = state.characters?.activeId ?? null;
      if (activeId !== previousId) {
        notifyActiveCharacterChanged({ previousId, activeId });
      }
      return result;
    }

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

    const enhancedSelector = Popovers ? enhanceSelectDropdown({
      select: selectorEl,
      Popovers,
      buttonClass: CHARACTER_SELECTOR_BUTTON_CLASSES,
      optionClass: "swatchOption",
      groupLabelClass: "dropdownGroupLabel",
      preferRight: false
    }) : null;
    addDestroy(() => {
      try { enhancedSelector?.destroy?.(); } catch { /* noop */ }
    });

    // --- wire action overflow menu ---
    const actionButtons = /** @type {HTMLButtonElement[]} */ (
      Array.from(actionMenuEl.querySelectorAll(".charActionMenuItem"))
    );
    const addToTrackerButtons = actionButtons.filter((button) => (
      button.dataset.charAction === "add-npc" || button.dataset.charAction === "add-party"
    ));
    const exportButtons = actionButtons.filter((button) => button.dataset.charAction === "export");
    const activeCharacterForActions = getActiveCharacter(state);
    if (builderBadgeEl) {
      builderBadgeEl.hidden = !isBuilderCharacter(activeCharacterForActions);
    }
    [...addToTrackerButtons, ...exportButtons].forEach((button) => {
      button.disabled = !activeCharacterForActions;
      button.setAttribute("aria-disabled", (!activeCharacterForActions).toString());
    });

    const setActionMenuClosed = () => {
      actionMenuEl.hidden = true;
      actionMenuEl.setAttribute("aria-hidden", "true");
      actionMenuButtonEl.setAttribute("aria-expanded", "false");
    };

    const setActionMenuOpen = () => {
      actionMenuEl.hidden = false;
      actionMenuEl.setAttribute("aria-hidden", "false");
      actionMenuButtonEl.setAttribute("aria-expanded", "true");
    };

    /** @type {any} */
    let actionPopover = null;

    const focusActionButtonAt = (idx) => {
      const enabled = actionButtons.filter((button) => !button.disabled);
      if (!enabled.length) return;
      const clampedIdx = Math.max(0, Math.min(idx, enabled.length - 1));
      const target = enabled[clampedIdx];
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    };

    const openActionMenu = () => {
      if (actionPopover?.open) {
        actionPopover.open();
      } else {
        setActionMenuOpen();
        focusActionButtonAt(0);
      }
    };

    const closeActionMenu = () => {
      if (actionPopover?.close) {
        actionPopover.close();
      } else {
        setActionMenuClosed();
      }
    };

    setActionMenuClosed();

    const wireFallbackActionMenu = () => {
      addListener(actionMenuButtonEl, "click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (actionMenuEl.hidden) openActionMenu();
        else closeActionMenu();
      });
    };

    if (Popovers?.register) {
      actionPopover = Popovers.register({
        button: actionMenuButtonEl,
        menu: actionMenuEl,
        preferRight: true,
        closeOnOutside: true,
        closeOnEsc: true,
        stopInsideClick: true,
        wireButton: true,
        onOpen: () => {
          try { actionPopover?.reposition?.(); } catch { /* noop */ }
          focusActionButtonAt(0);
        },
        onClose: setActionMenuClosed,
      });
    }
    if (!actionPopover) wireFallbackActionMenu();

    addDestroy(() => {
      try { actionPopover?.destroy?.(); } catch { /* noop */ }
      setActionMenuClosed();
    });

    // --- wire selector change ---
    addListener(selectorEl, "change", () => {
      const newId = selectorEl.value;
      if (!newId || newId === state.characters?.activeId) return;
      mutateCharactersAndNotify((s) => { s.characters.activeId = newId; });
      rerender();
    });

    async function runNewCharacterAction() {
      const entry = makeDefaultCharacterEntry();
      mutateCharactersAndNotify((s) => {
        s.characters.entries.push(entry);
        s.characters.activeId = entry.id;
      });
      rerender();
    }

    async function runNewBuilderCharacterAction() {
      const entry = makeDefaultBuilderCharacterEntry();
      mutateCharactersAndNotify((s) => {
        s.characters.entries.push(entry);
        s.characters.activeId = entry.id;
      });
      rerender();
    }

    async function runRenameCharacterAction() {
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
    }

    function snapshotCharacterFieldsToCard(card, character) {
      for (const [cardField, characterField] of Object.entries(LINKED_FIELD_MAP)) {
        card[cardField] = character[characterField];
      }
    }

    function runAddCharacterToTrackerAction(type) {
      const activeChar = getActiveCharacter(state);
      if (!activeChar) return;
      const isNpc = type === "npc";
      const card = isNpc
        ? makeNpc({ sectionId: state.tracker?.npcActiveSectionId || "" })
        : makePartyMember({ sectionId: state.tracker?.partyActiveSectionId || "party" });

      snapshotCharacterFieldsToCard(card, activeChar);
      linkCardToCharacter(card, activeChar.id);

      const added = addTrackerCard(isNpc ? "npc" : "party", /** @type {any} */ (card), { atStart: true });
      if (!added) return;
      notifyPanelDataChanged("tracker-cards");
      if (typeof setStatus === "function") {
        setStatus(isNpc ? "Added to NPCs" : "Added to Party", { stickyMs: 2000 });
      }
    }

    function sanitizeFilenameSegment(value, fallback) {
      const cleaned = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      return cleaned || fallback;
    }

    function shortCharacterId(value) {
      const cleaned = String(value || "")
        .replace(/^char[_-]?/i, "")
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 8);
      return cleaned || "character";
    }

    function getErrorMessage(err, fallback = "Character import failed.") {
      return err instanceof Error && err.message ? err.message : fallback;
    }

    function triggerCharacterDownload(text, filename) {
      const fileBlob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(fileBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      try {
        a.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    async function runExportCharacterAction() {
      const activeChar = getActiveCharacter(state);
      if (!activeChar) return;

      const exportObject = await exportActiveCharacter({ state, getBlob, getText });
      const json = JSON.stringify(exportObject, null, 2);
      const namePart = sanitizeFilenameSegment(activeChar.name, "character");
      const idPart = shortCharacterId(activeChar.id);
      triggerCharacterDownload(json, `${namePart}-${idPart}.ll-character.json`);
      if (typeof setStatus === "function") {
        setStatus("Character exported.", { stickyMs: 2000 });
      }
    }

    function pickCharacterImportFile() {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.style.display = "none";
      document.body.appendChild(input);

      return new Promise((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
          input.removeEventListener("change", onChange);
          input.removeEventListener("cancel", onCancel);
          input.remove();
        };

        const finish = (file) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(file);
        };

        const onChange = () => {
          finish(input.files?.[0] || null);
        };

        const onCancel = () => {
          finish(null);
        };

        input.addEventListener("change", onChange);
        input.addEventListener("cancel", onCancel);

        try {
          input.click();
        } catch (err) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err);
          }
        }
      });
    }

    async function runImportCharacterAction() {
      const file = await pickCharacterImportFile();
      if (!file) return;

      if (typeof file.size === "number" && file.size > MAX_IMPORT_FILE_SIZE) {
        await uiAlert?.(
          "Character file is too large. Please check that this is a valid Lore Ledger character file.",
          { title: "Import failed" }
        );
        return;
      }

      let parsedObject;
      try {
        parsedObject = await parseAndValidateImport(file);
      } catch (err) {
        await uiAlert?.(getErrorMessage(err, "Invalid character import file."), { title: "Import failed" });
        return;
      }

      const importName = String(parsedObject.character?.name || "").trim() || "Unnamed Character";
      const confirmed = await uiConfirm?.(
        `Import "${importName}" into this campaign?\n\n- A new character will be added to this campaign.\n- Linked card connections from the original campaign are not imported.`,
        { title: "Import Character", okText: "Import" }
      );
      if (!confirmed) return;

      const previousId = state.characters?.activeId ?? null;
      try {
        const newId = await commitImport(parsedObject, {
          state,
          SaveManager,
          putBlob,
          deleteBlob,
          putText,
          dataUrlToBlob,
          mutateState
        });
        if (newId !== previousId) {
          notifyActiveCharacterChanged({ previousId, activeId: newId });
        }
        rerender();
        if (typeof setStatus === "function") {
          setStatus(`Imported "${importName}"`, { stickyMs: 2000 });
        }
      } catch (err) {
        await uiAlert?.(getErrorMessage(err), { title: "Import failed" });
      }
    }

    async function runDeleteCharacterAction() {
      const activeChar = getActiveCharacter(state);
      if (!activeChar) return;
      const charName = activeChar?.name ? `"${activeChar.name}"` : "this character";
      const linkedCards = getLinkedCards(state, activeChar.id);
      const npcCount = linkedCards.filter((entry) => entry.type === "npc").length;
      const partyCount = linkedCards.filter((entry) => entry.type === "party").length;
      const linkedSummary = [
        npcCount ? `NPCs (${npcCount})` : "",
        partyCount ? `Party (${partyCount})` : ""
      ].filter(Boolean).join(", ");
      const linkedWarning = linkedSummary
        ? `\n\nThis character has linked cards in: ${linkedSummary}. Linked cards will keep their last known data and become standalone.`
        : "";
      const ok = await uiConfirm?.(`Delete ${charName}? This cannot be undone.${linkedWarning}`, {
        title: "Delete Character",
        okText: "Delete"
      });
      if (!ok) return;
      mutateCharactersAndNotify((s) => {
        linkedCards.forEach(({ card }) => snapshotLinkedFieldsToCard(card, s));
        const idx = s.characters.entries.findIndex((e) => e.id === s.characters.activeId);
        if (idx !== -1) s.characters.entries.splice(idx, 1);
        const remaining = s.characters.entries;
        s.characters.activeId = remaining.length > 0 ? remaining[0].id : null;
      });
      rerender();
    }

    const runCharacterAction = async (action) => {
      if (action === "new") {
        await runNewCharacterAction();
      } else if (action === "new-builder") {
        await runNewBuilderCharacterAction();
      } else if (action === "rename") {
        await runRenameCharacterAction();
      } else if (action === "add-npc") {
        runAddCharacterToTrackerAction("npc");
      } else if (action === "add-party") {
        runAddCharacterToTrackerAction("party");
      } else if (action === "export") {
        await runExportCharacterAction();
      } else if (action === "import") {
        await runImportCharacterAction();
      } else if (action === "delete") {
        await runDeleteCharacterAction();
      }
    };

    actionButtons.forEach((button) => {
      addListener(button, "click", safeAsync(async () => {
        const action = button.dataset.charAction;
        if (!action) return;
        try {
          await runCharacterAction(action);
        } finally {
          closeActionMenu();
        }
      }, (err) => {
        console.error("Character action failed:", err);
        if (typeof setStatus === "function") setStatus("Character action failed.");
        closeActionMenu();
      }));
    });

    addListener(actionMenuButtonEl, "keydown", (event) => {
      const e = /** @type {KeyboardEvent} */ (event);
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      openActionMenu();
      focusActionButtonAt(e.key === "ArrowUp" ? actionButtons.length - 1 : 0);
    });

    addListener(actionMenuEl, "keydown", (event) => {
      const e = /** @type {KeyboardEvent} */ (event);
      const enabled = actionButtons.filter((button) => !button.disabled);
      if (!enabled.length) return;
      const active = /** @type {HTMLElement | null} */ (document.activeElement);
      const idx = enabled.findIndex((button) => button === active);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusActionButtonAt((idx >= 0 ? idx : -1) + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusActionButtonAt((idx >= 0 ? idx : enabled.length) - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        focusActionButtonAt(0);
      } else if (e.key === "End") {
        e.preventDefault();
        focusActionButtonAt(enabled.length - 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeActionMenu();
        try {
          actionMenuButtonEl.focus({ preventScroll: true });
        } catch {
          actionMenuButtonEl.focus();
        }
      }
    });
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
    const dismissalKey = getEmptyStateDismissalKey(state);
    if (hasEntries || _dismissedEmptyStateCampaignIds.has(dismissalKey)) {
      emptyEl.hidden = true;
      return;
    }

    emptyEl.hidden = false;
    const { mutateState } = createStateActions({ state, SaveManager });

    function dismiss() {
      _dismissedEmptyStateCampaignIds.add(dismissalKey);
      emptyEl.hidden = true;
    }

    addListener(yesBtn, "click", () => {
      const entry = makeDefaultCharacterEntry();
      const previousId = state.characters?.activeId ?? null;
      mutateState((s) => {
        s.characters.entries.push(entry);
        s.characters.activeId = entry.id;
      });
      const activeId = state.characters?.activeId ?? null;
      if (activeId !== previousId) {
        notifyActiveCharacterChanged({ previousId, activeId });
      }
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
