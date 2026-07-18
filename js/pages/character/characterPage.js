// js/pages/character/characterPage.js
// Character page composition and panel wiring.

import { initEquipmentPanel } from "../character/panels/equipmentPanel.js";
import { initAttacksPanel } from "../character/panels/attackPanel.js";
import { setupCharacterSectionReorder } from "../character/characterSectionReorder.js";
import { initSpellsPanel } from "../character/panels/spellsPanel.js";
import { initVitalsPanel } from "../character/panels/vitalsPanel.js";
import { initBasicsPanel } from "../character/panels/basicsPanel.js";
import { initBuilderIdentityPanel } from "../character/panels/builderIdentityPanel.js";
import { initBuilderAbilitiesPanel } from "../character/panels/builderAbilitiesPanel.js";
import { initBuilderSummaryPanel } from "../character/panels/builderSummaryPanel.js";
import { initBuilderWizard } from "../character/builderWizard.js";
import { initLevelUpWizard } from "../character/levelUpWizard.js";
import { initProficienciesPanel } from "../character/panels/proficienciesPanel.js";
import { initAbilitiesPanel } from "../character/panels/abilitiesPanel.js";
import { initAbilitiesFeaturesPanel } from "../character/panels/abilitiesFeaturesPanel.js";
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
import { getBuilderFinishSheetSeedPatch, getLevelUpSheetSeedPatch } from "../../domain/builderSheetSeeding.js";
import { MAX_CHARACTER_LEVEL, normalizeBuildLevels } from "../../domain/rules/progression.js";
import {
  applyLongRest,
  applyShortRest,
  getBuilderPreparedSpellOptions,
  getLongRestHitDiceRecovery,
  getRestHitDicePools
} from "../../domain/characterRest.js";
import { openCharacterRestFlow } from "./restFlow.js";
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

/**
 * Destroys whichever character page controller is currently live. The page
 * replaces its own controller through rerender() after character CRUD
 * actions, so shell-level teardown (destroyCampaignModules() -> tracker page
 * destroy) must resolve the live controller at destroy time — holding on to
 * the instance created at page init would leak any rerender() replacement
 * past teardown.
 */
export function destroyActiveCharacterPageUI() {
  _activeCharacterPageController?.destroy?.();
  _activeCharacterPageController = null;
}

/**
 * Initial wizard selections become rest play-state at character creation.
 * Existing per-class rest selections win during Edit in Builder, because a
 * prepared list is no longer a guarded build choice after creation.
 * @param {import("../../state.js").CharacterEntry} character
 * @returns {void}
 */
function adoptInitialBuilderPreparedSelections(character) {
  const build = character?.build;
  if (!build || typeof build !== "object" || Array.isArray(build)) return;
  const spellcasting = build.spellcasting;
  if (!spellcasting || typeof spellcasting !== "object" || Array.isArray(spellcasting)) return;
  if (!character.rest || typeof character.rest !== "object" || Array.isArray(character.rest)) {
    character.rest = { hitDiceSpent: {}, preparedByClass: {} };
  }
  if (!character.rest.preparedByClass || typeof character.rest.preparedByClass !== "object" || Array.isArray(character.rest.preparedByClass)) {
    character.rest.preparedByClass = {};
  }
  for (const [classId, rawSelection] of Object.entries(spellcasting)) {
    if (!rawSelection || typeof rawSelection !== "object" || Array.isArray(rawSelection)) continue;
    if (Object.prototype.hasOwnProperty.call(character.rest.preparedByClass, classId)) continue;
    const rawIds = rawSelection.preparedIds;
    character.rest.preparedByClass[classId] = Array.isArray(rawIds)
      ? [...new Set(rawIds.filter((id) => typeof id === "string").map((id) => id.trim()).filter(Boolean))]
      : [];
  }
}

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

  // The builder wizard is created in initCharacterSelectorBar (which runs
  // before the panels); read-only builder panels route structural edits back
  // through it via this lazy handle (B1 guarded edit routing).
  /** @type {{ open: (options?: { character?: import("../../state.js").CharacterEntry | null }) => void } | null} */
  let builderWizardApi = null;
  const openBuilderWizard = (character) => {
    if (!character || !isBuilderCharacter(character)) return;
    builderWizardApi?.open({ character });
  };
  const listenerControllers = {
    fields: new AbortController(),
    chrome: new AbortController(),
    actions: new AbortController()
  };
  addDestroy(() => listenerControllers.fields.abort());
  addDestroy(() => listenerControllers.chrome.abort());
  addDestroy(() => listenerControllers.actions.abort());

  const addListener = (bucket, target, type, handler, options) => {
    if (!target || typeof target.addEventListener !== "function") return;
    const listenerOptions =
      typeof options === "boolean"
        ? { capture: options }
        : (options || {});
    target.addEventListener(type, handler, {
      ...listenerOptions,
      signal: listenerControllers[bucket].signal
    });
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
    addListener("fields", target, "input", () => {
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

    addListener("fields", target, "input", () => {
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

    runPanelInit("Builder identity panel", () => initBuilderIdentityPanel({ ...deps, openBuilderWizard }));

    runPanelInit("Builder abilities panel", () => initBuilderAbilitiesPanel({ ...deps, openBuilderWizard }));

    runPanelInit("Builder summary panel", () => initBuilderSummaryPanel(deps));

    runPanelInit("Vitals panel", () => initVitalsPanel({ ...deps, bindNumber }));

    runPanelInit("Proficiencies panel", () => initProficienciesPanel({ ...deps, bindText }));

    runPanelInit("Personality panel", () => initPersonalityPanel({ ...deps, bindText }));

    runPanelInit("Abilities panel", () => initAbilitiesPanel({ ...deps, bindNumber, bindText }));

    runPanelInit("Abilities & Features panel", () => initAbilitiesFeaturesPanel(deps));
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
    const restButtons = /** @type {HTMLButtonElement[]} */ (
      Array.from(document.querySelectorAll("[data-character-rest]"))
    );
    const actionMenuButtonEl = /** @type {HTMLButtonElement | null} */ (document.getElementById("charActionMenuBtn"));
    const actionMenuEl = /** @type {HTMLElement | null} */ (document.getElementById("charActionDropdownMenu"));
    if (!selectorEl || !actionMenuButtonEl || !actionMenuEl) return;

    const { addTrackerCard, mutateCharacter, mutateState } = createStateActions({ state, SaveManager });

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

    const builderWizard = initBuilderWizard({
      root: document,
      Popovers,
      setStatus,
      onFinish: ({ name, build, characterId }) => {
        if (characterId) {
          // Edit mode: update the build in place and re-seed additively.
          // Every other character field (notes, inventory, spells usage,
          // combat state, manual edits) is left untouched.
          const updated = mutateCharacter((character) => {
            if (character.id !== characterId) return false;
            character.name = name;
            character.build = build;
            adoptInitialBuilderPreparedSelections(character);
            Object.assign(character, getBuilderFinishSheetSeedPatch(character));
            return true;
          });
          if (!updated) {
            mutateCharactersAndNotify((s) => {
              const entry = s.characters.entries.find((e) => e.id === characterId);
              if (!entry) return;
              entry.name = name;
              entry.build = build;
              adoptInitialBuilderPreparedSelections(entry);
              Object.assign(entry, getBuilderFinishSheetSeedPatch(entry));
            });
          }
          rerender();
          if (typeof setStatus === "function") setStatus("Builder character updated.", { stickyMs: 2000 });
          return;
        }
        const entry = makeDefaultBuilderCharacterEntry(name);
        entry.build = build;
        adoptInitialBuilderPreparedSelections(entry);
        Object.assign(entry, getBuilderFinishSheetSeedPatch(entry));
        mutateCharactersAndNotify((s) => {
          s.characters.entries.push(entry);
          s.characters.activeId = entry.id;
        });
        rerender();
      }
    });
    builderWizardApi = builderWizard;
    addDestroy(() => builderWizard.destroy());

    const levelUpWizard = initLevelUpWizard({
      root: document,
      Popovers,
      setStatus,
      onApply: ({ characterId, build, toLevel }) => {
        // Same-character apply guard, mirroring the shipped rest guard: check
        // the active id before mutating and again inside the mutation.
        if (!characterId || getActiveCharacter(state)?.id !== characterId) {
          if (typeof setStatus === "function") {
            setStatus("Level Up was canceled because the active character changed.", { stickyMs: 2500 });
          }
          return;
        }
        let applyError = "";
        const updated = mutateCharacter((character) => {
          if (character.id !== characterId) {
            applyError = "active-character-changed";
            return false;
          }
          /** @type {Record<string, unknown>} */
          let beforeSnapshot;
          try {
            beforeSnapshot = JSON.parse(JSON.stringify(character));
          } catch {
            applyError = "snapshot-failed";
            return false;
          }
          const levelsBefore = normalizeBuildLevels(beforeSnapshot.build);
          const levelsAfter = normalizeBuildLevels(build);
          if (levelsAfter.length !== levelsBefore.length + 1 || levelsAfter.length > MAX_CHARACTER_LEVEL) {
            applyError = "invalid-level-up";
            return false;
          }
          // Compute the entire sheet patch before writing anything so the
          // build replacement and the patch commit as one atomic mutation.
          const afterCharacter = { ...beforeSnapshot, build };
          const { patch } = getLevelUpSheetSeedPatch(beforeSnapshot, afterCharacter);
          character.build = build;
          Object.assign(character, patch);
          return true;
        });
        if (!updated) {
          if (typeof setStatus === "function") {
            setStatus(applyError === "active-character-changed"
              ? "Level Up was canceled because the active character changed."
              : "Level Up could not be applied. No changes were made.", { stickyMs: 2500 });
          }
          return;
        }
        rerender();
        if (typeof setStatus === "function") {
          setStatus(`Level Up applied — now level ${toLevel}.`, { stickyMs: 2000 });
        }
      }
    });
    addDestroy(() => levelUpWizard.destroy());

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
    const editBuilderButtons = actionButtons.filter((button) => button.dataset.charAction === "edit-builder");
    const levelUpButtons = actionButtons.filter((button) => button.dataset.charAction === "level-up");
    const activeCharacterForActions = getActiveCharacter(state);
    const activeIsBuilder = isBuilderCharacter(activeCharacterForActions);
    if (builderBadgeEl) {
      builderBadgeEl.hidden = !activeIsBuilder;
    }
    editBuilderButtons.forEach((button) => {
      button.disabled = !activeIsBuilder;
      button.setAttribute("aria-disabled", (!activeIsBuilder).toString());
    });
    // Level Up: builder characters below total level 20 only. At level 20 the
    // item stays visible but disabled; freeform characters cannot enter.
    const canLevelUp = activeIsBuilder &&
      normalizeBuildLevels(activeCharacterForActions?.build).length < MAX_CHARACTER_LEVEL;
    levelUpButtons.forEach((button) => {
      button.disabled = !canLevelUp;
      button.setAttribute("aria-disabled", (!canLevelUp).toString());
    });
    restButtons.forEach((button) => {
      button.disabled = !activeCharacterForActions;
      button.setAttribute("aria-disabled", (!activeCharacterForActions).toString());
    });
    [...addToTrackerButtons, ...exportButtons].forEach((button) => {
      button.disabled = !activeCharacterForActions;
      button.setAttribute("aria-disabled", (!activeCharacterForActions).toString());
    });

    function restErrorMessage(error) {
      if (error === "long-rest-requires-positive-hp") return "A character needs at least 1 HP to benefit from a Long Rest.";
      if (error === "unavailable-hit-dice") return "That Short Rest selection spends unavailable Hit Dice.";
      if (error === "missing-hp-for-hit-dice") return "Set current and maximum HP before spending Hit Dice.";
      if (error === "incomplete-hit-dice-allocation") return "Allocate the required recovered Hit Dice before taking a Long Rest.";
      if (error === "active-character-changed") return "Rest was canceled because the active character changed.";
      if (error?.startsWith?.("prepared-capacity:")) return "Prepared spell selection exceeds that class's capacity.";
      if (error?.startsWith?.("invalid-prepared-spell:")) return "Prepared spell selection includes an unavailable spell.";
      return "Rest could not be applied. Please review the selection and try again.";
    }

    async function runCharacterRestAction(restType) {
      const activeCharacter = getActiveCharacter(state);
      if (!activeCharacter) return;
      const activeCharacterId = activeCharacter.id;
      let selection = {};
      if (restType === "longRest") {
        const preflight = applyLongRest(activeCharacter);
        if (preflight.error === "long-rest-requires-positive-hp") {
          if (typeof setStatus === "function") setStatus(restErrorMessage(preflight.error), { stickyMs: 2500 });
          return;
        }
      }
      const hasShortRestDice = restType === "shortRest" && getRestHitDicePools(activeCharacter)
        .some((pool) => pool.available > 0);
      const longRecovery = restType === "longRest" ? getLongRestHitDiceRecovery(activeCharacter) : null;
      const preparedOptions = restType === "longRest" ? getBuilderPreparedSpellOptions(activeCharacter) : [];
      const needsFlow = hasShortRestDice || !!longRecovery?.requiresAllocation || preparedOptions.length > 0;
      if (needsFlow) {
        const result = await openCharacterRestFlow({ type: restType, character: activeCharacter });
        if (!result) return;
        selection = result;
      }
      if (getActiveCharacter(state)?.id !== activeCharacterId) {
        if (typeof setStatus === "function") {
          setStatus(restErrorMessage("active-character-changed"), { stickyMs: 2500 });
        }
        return;
      }
      let restError = "";
      const updated = mutateCharacter((character) => {
        if (character.id !== activeCharacterId) {
          restError = "active-character-changed";
          return false;
        }
        const result = restType === "shortRest"
          ? applyShortRest(character, selection)
          : applyLongRest(character, selection);
        if (result.error) {
          restError = result.error;
          return false;
        }
        if (!result.changed) return false;
        let nextCharacter = result.character;
        if (restType === "longRest" && selection.preparedByClass) {
          const seededPatch = getBuilderFinishSheetSeedPatch(nextCharacter);
          if (seededPatch) nextCharacter = { ...nextCharacter, ...seededPatch };
        }
        Object.assign(character, nextCharacter);
        return true;
      });
      if (!updated) {
        if (typeof setStatus === "function") {
          setStatus(restError ? restErrorMessage(restError) : "No recoverable resources for this rest.", { stickyMs: restError ? 2500 : 2000 });
        }
        return;
      }
      rerender();
      if (typeof setStatus === "function") {
        setStatus(restType === "shortRest" ? "Short rest applied." : "Long rest applied.", { stickyMs: 2000 });
      }
    }

    restButtons.forEach((button) => {
      addListener("actions", button, "click", safeAsync(async (event) => {
        event.preventDefault();
        const restType = button.dataset.characterRest;
        if (restType !== "shortRest" && restType !== "longRest") return;
        await runCharacterRestAction(restType);
      }, (error) => {
        console.error("Character rest flow failed:", error);
        if (typeof setStatus === "function") setStatus("Rest could not be applied. Please try again.", { stickyMs: 2500 });
      }));
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
      addListener("chrome", actionMenuButtonEl, "click", (event) => {
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
    addListener("chrome", selectorEl, "change", () => {
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
      builderWizard.open();
    }

    async function runEditBuilderCharacterAction() {
      const activeChar = getActiveCharacter(state);
      if (!activeChar || !isBuilderCharacter(activeChar)) return;
      builderWizard.open({ character: activeChar });
    }

    async function runLevelUpCharacterAction() {
      const activeChar = getActiveCharacter(state);
      if (!activeChar || !isBuilderCharacter(activeChar)) return;
      if (normalizeBuildLevels(activeChar.build).length >= MAX_CHARACTER_LEVEL) return;
      levelUpWizard.open({ character: activeChar });
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
      const bundledCount = Array.isArray(parsedObject.customContent) ? parsedObject.customContent.length : 0;
      const bundledLine = bundledCount
        ? `\n- Includes ${bundledCount} bundled custom (homebrew) record${bundledCount === 1 ? "" : "s"}; missing ones will be added to this campaign, existing ones are kept as-is.`
        : "";
      const confirmed = await uiConfirm?.(
        `Import "${importName}" into this campaign?\n\n- A new character will be added to this campaign.\n- Linked card connections from the original campaign are not imported.${bundledLine}`,
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
      } else if (action === "edit-builder") {
        await runEditBuilderCharacterAction();
      } else if (action === "level-up") {
        await runLevelUpCharacterAction();
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
      addListener("actions", button, "click", safeAsync(async () => {
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

    addListener("chrome", actionMenuButtonEl, "keydown", (event) => {
      const e = /** @type {KeyboardEvent} */ (event);
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      openActionMenu();
      focusActionButtonAt(e.key === "ArrowUp" ? actionButtons.length - 1 : 0);
    });

    addListener("chrome", actionMenuEl, "keydown", (event) => {
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

    addListener("chrome", yesBtn, "click", () => {
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

    addListener("chrome", noBtn, "click", dismiss);
  }

  // Boot character page bindings.
  //
  // Each boot step is isolated so a failure in one cannot leave the page
  // half-built. This matters most on a re-render (character switch): the
  // previous controller has already been destroyed at the top of this
  // function, so a throw here would otherwise leave the page with no listeners
  // (unresponsive to clicks) and stale panels until a full page reload. In
  // particular, the Equipment/Inventory and other panels (initCharacterUI)
  // must still bind even if the selector bar or empty-state setup throws.
  runPanelInit("Character empty state", () => initCharacterEmptyState());
  runPanelInit("Character selector bar", () => initCharacterSelectorBar());
  runPanelInit("Character panels", () => initCharacterUI());

  const api = {
    destroy() {
      // Never let one failing cleanup abort the rest, or propagate out of
      // destroy(). On a character switch this runs from the top of a
      // re-render; a thrown cleanup would abort the rebuild and freeze the
      // page until reload.
      for (let i = destroyFns.length - 1; i >= 0; i--) {
        try {
          destroyFns[i]?.();
        } catch (err) {
          console.error("Character page cleanup failed:", err);
        }
      }
      if (_activeCharacterPageController === api) {
        _activeCharacterPageController = null;
      }
    }
  };

  _activeCharacterPageController = api;
  return api;
}
