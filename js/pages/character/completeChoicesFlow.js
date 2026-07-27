// @ts-check
// js/pages/character/completeChoicesFlow.js — incomplete-required-choices
// banner + focused Complete Choices dialog (R5-B1).
//
// Replaces Edit in Builder as the correction path for *required* build choices
// a character was created (or levelled) without — the retirement audit's D3
// ruling. One controller owns both surfaces because they are two views of the
// same derivation over the same character: the banner asks "does this character
// have unresolved required choices?", the dialog resolves them.
//
// Everything shown here is derived from canonical build data through
// `js/domain/rules/choiceCompletion.js`. There is no persisted UI flag, no
// dismissal state, and nothing new in `sanitizeForSave` — the banner disappears
// because the build changed, not because anything was recorded.
//
// Scope boundaries (owner rulings, R5-B):
//   - Permitted under-cap spell categories (class cantrips, known spells,
//     wizard spellbook) are legal states. They never raise the banner and are
//     never rendered here; their opportunity/acknowledgement system is R5-B2.
//   - Prepared spells stay owned by the Long Rest flow and are untouched.
//   - The creation Builder is never reopened in a filtered mode; this is a
//     separate, narrow dialog built from the shared wizard primitives.

import { ACTIVE_CHARACTER_CHANGED_EVENT } from "../../domain/characterEvents.js";
import {
  CHARACTER_ABILITY_KEYS,
  clonePlainBuild,
  getActiveCharacter,
  isBuilderCharacter,
  normalizeCharacterBuild
} from "../../domain/characterHelpers.js";
import { getBuilderFinishSheetSeedPatch } from "../../domain/builderSheetSeeding.js";
import {
  getChoiceCompletionReport,
  resolveChoiceOptions
} from "../../domain/rules/choiceCompletion.js";
import { normalizeBuildLevels } from "../../domain/rules/progression.js";
import { getActiveContentRegistry, getContentByKind, listContentByKind } from "../../domain/rules/registry.js";
import { subscribePanelDataChanged } from "../../ui/panelInvalidation.js";
import { enhanceSelectDropdown } from "../../ui/selectDropdown.js";
import { getNoopDestroyApi, requireMany } from "../../utils/domGuards.js";
import { makeSelect, renderAsiSlot, renderMultiPickChoice } from "./builderWizardSteps.js";

/** @typedef {import("../../domain/rules/choiceCompletion.js").ChoiceCompletionDescriptor} ChoiceCompletionDescriptor */
/** @typedef {import("../../state.js").CharacterBuildState} CharacterBuildState */

const ABILITY_LABELS = Object.freeze({
  str: "Strength", dex: "Dexterity", con: "Constitution",
  int: "Intelligence", wis: "Wisdom", cha: "Charisma"
});

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {HTMLElement} parent
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  parent.appendChild(node);
  return /** @type {HTMLElement} */ (node);
}

/** @param {HTMLElement} node */
function clearChildren(node) {
  if (typeof node.replaceChildren === "function") node.replaceChildren();
  else node.innerHTML = "";
}

/**
 * @param {HTMLElement} panel
 * @returns {HTMLElement[]}
 */
function getFocusable(panel) {
  const selectors = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "a[href]",
    "[tabindex]:not([tabindex='-1'])"
  ];
  return /** @type {HTMLElement[]} */ (Array.from(panel.querySelectorAll(selectors.join(",")))
    .filter((node) => !!node &&
      typeof /** @type {HTMLElement} */ (node).focus === "function" &&
      !(/** @type {HTMLElement} */ (node).hidden) &&
      !(/** @type {HTMLElement} */ (node).closest("[hidden]")) &&
      !(/** @type {HTMLElement} */ (node).classList.contains("nativeSelectHidden"))));
}

/**
 * The banner's one-line message. Detail lives in the dialog so the banner stays
 * a single wrapping line at phone widths.
 * @param {number} count
 * @returns {string}
 */
export function formatIncompleteChoicesBannerMessage(count) {
  return count === 1
    ? "Character setup is incomplete — 1 required choice is unfinished."
    : `Character setup is incomplete — ${count} required choices are unfinished.`;
}

/**
 * The dialog's field label for one unresolved required choice.
 * Structured facts come from the descriptor; this is presentation only.
 * @param {ChoiceCompletionDescriptor} descriptor
 * @param {import("../../domain/rules/registry.js").ContentRegistry} registry
 * @returns {string}
 */
export function formatChoiceFieldLabel(descriptor, registry) {
  if (descriptor.kind === "subclass") {
    const classEntry = getContentByKind(registry, "class", cleanString(descriptor.classId));
    const flavor = cleanString(
      /** @type {{ subclassFlavor?: unknown } | undefined} */ (classEntry?.data)?.subclassFlavor
    );
    return `${descriptor.label} — ${flavor || "Subclass"}`;
  }
  const scope = descriptor.scope ? ` (${descriptor.scope})` : "";
  const count = descriptor.allowed > 1 ? ` — choose ${descriptor.allowed}` : "";
  return `${descriptor.label}${scope}${count}`;
}

/**
 * @param {ChoiceCompletionDescriptor} descriptor
 * @returns {string}
 */
function emptyOptionLabel(descriptor) {
  switch (descriptor.kind) {
    case "origin-ancestry": return "Choose ancestry";
    case "origin-spell": return "Choose spell";
    case "origin-language": return "Choose language";
    case "class-skill":
    case "multiclass-skill":
    case "expertise": return "Choose skill";
    case "subclass": return "Choose subclass";
    default: return "Choose option";
  }
}

/**
 * @typedef {{
 *   root?: ParentNode,
 *   overlayRoot?: ParentNode,
 *   state: import("../../state.js").State,
 *   mutateCharacter: (mutator: (character: any, state: any) => unknown, options?: Record<string, unknown>) => unknown,
 *   rerender: () => void,
 *   setStatus?: (message: string, options?: Record<string, unknown>) => void,
 *   uiAlert?: (message: string, options?: Record<string, unknown>) => Promise<unknown>,
 *   Popovers?: import("../../ui/popovers.js").PopoversApi | null
 * }} CompleteChoicesFlowDeps
 */

/**
 * @param {CompleteChoicesFlowDeps} deps
 * @returns {{ refresh: () => void, open: () => void, close: () => void, destroy: () => void }}
 */
export function initCompleteChoicesFlow(deps) {
  const {
    root = document,
    overlayRoot = document,
    state,
    mutateCharacter,
    rerender,
    setStatus,
    uiAlert,
    Popovers = null
  } = deps || {};

  if (!state) throw new Error("initCompleteChoicesFlow: state is required");
  if (typeof mutateCharacter !== "function") throw new Error("initCompleteChoicesFlow: mutateCharacter is required");
  if (typeof rerender !== "function") throw new Error("initCompleteChoicesFlow: rerender is required");

  // The banner lives inside #page-character (scoped to the page root, per the
  // R5-A.1 ownership fix); the dialog overlay lives at document level with the
  // other modal overlays.
  const bannerGuard = requireMany(
    {
      banner: "#charIncompleteChoices",
      bannerText: "#charIncompleteChoicesText",
      bannerBtn: "#charIncompleteChoicesBtn"
    },
    { root, setStatus, context: "Incomplete choices banner", devAssert: false, warn: false }
  );
  const dialogGuard = requireMany(
    {
      overlay: "#completeChoicesOverlay",
      panel: "#completeChoicesPanel",
      closeBtn: "#completeChoicesClose",
      intro: "#completeChoicesIntro",
      body: "#completeChoicesBody",
      empty: "#completeChoicesEmpty",
      status: "#completeChoicesStatus",
      applyBtn: "#completeChoicesApply",
      cancelBtn: "#completeChoicesCancel"
    },
    { root: overlayRoot, setStatus, context: "Complete Choices dialog", devAssert: false, warn: false }
  );
  if (!bannerGuard.ok || !dialogGuard.ok) {
    const noop = getNoopDestroyApi();
    return { refresh() {}, open() {}, close() {}, destroy: noop.destroy };
  }

  const bannerEl = /** @type {HTMLElement} */ (bannerGuard.els.banner);
  const bannerTextEl = /** @type {HTMLElement} */ (bannerGuard.els.bannerText);
  const bannerBtn = /** @type {HTMLButtonElement} */ (bannerGuard.els.bannerBtn);
  const overlay = /** @type {HTMLElement} */ (dialogGuard.els.overlay);
  const panel = /** @type {HTMLElement} */ (dialogGuard.els.panel);
  const closeBtn = /** @type {HTMLButtonElement} */ (dialogGuard.els.closeBtn);
  const introEl = /** @type {HTMLElement} */ (dialogGuard.els.intro);
  const bodyEl = /** @type {HTMLElement} */ (dialogGuard.els.body);
  const emptyEl = /** @type {HTMLElement} */ (dialogGuard.els.empty);
  const statusEl = /** @type {HTMLElement} */ (dialogGuard.els.status);
  const applyBtn = /** @type {HTMLButtonElement} */ (dialogGuard.els.applyBtn);
  const cancelBtn = /** @type {HTMLButtonElement} */ (dialogGuard.els.cancelBtn);

  const listenerController = new AbortController();
  const signal = listenerController.signal;

  /** @type {"idle" | "applying"} */
  let phase = "idle";
  let destroyed = false;
  /** @type {Element | null} */
  let previousFocus = null;
  /** @type {string} */
  let openCharacterId = "";
  /** @type {string} */
  let openCampaignId = "";
  /** @type {{ build: CharacterBuildState } | null} */
  let draft = null;
  /** @type {string} */
  let baselineJson = "";
  let baselineLevelCount = 0;
  /** @type {string} */
  let renderedKeys = "";
  /** @type {Array<{ select: HTMLSelectElement, api: { rebuild?: () => void, close?: () => void, destroy?: () => void } }>} */
  const dynamicEnhancedSelects = [];

  /* ---------------------------- state reads ---------------------------- */

  const getRegistry = () => getActiveContentRegistry();
  const getActiveCampaignId = () => cleanString(state.appShell?.activeCampaignId);

  /** @returns {import("../../state.js").CharacterEntry | null} */
  function getBuilderCharacter() {
    const character = getActiveCharacter(state);
    return character && isBuilderCharacter(character) ? character : null;
  }

  /* --------------------------- enhanced selects ------------------------ */

  /** @param {HTMLSelectElement} select */
  function enhanceDynamicSelect(select) {
    for (let i = dynamicEnhancedSelects.length - 1; i >= 0; i -= 1) {
      if (!dynamicEnhancedSelects[i].select.isConnected) {
        try { dynamicEnhancedSelects[i].api.destroy?.(); } catch { /* noop */ }
        dynamicEnhancedSelects.splice(i, 1);
      }
    }
    if (!Popovers) return;
    const api = enhanceSelectDropdown({
      select,
      Popovers,
      buttonClass: "settingsSelectBtn builderWizardSelectBtn",
      optionClass: "swatchOption",
      groupLabelClass: "dropdownGroupLabel",
      preferRight: false
    });
    if (api) dynamicEnhancedSelects.push({ select, api });
  }

  function destroyEnhancedSelects() {
    for (const enhanced of dynamicEnhancedSelects) {
      try { enhanced.api.destroy?.(); } catch { /* noop */ }
    }
    dynamicEnhancedSelects.length = 0;
  }

  /* -------------------------------- banner ------------------------------ */

  /**
   * Recomputes banner visibility from canonical build data. Shown only for an
   * active builder character with at least one unresolved *required* choice —
   * never for freeform characters, complete builder characters, or characters
   * whose only shortfall is a permitted under-cap spell category.
   */
  function refresh() {
    if (destroyed) return;
    const character = getBuilderCharacter();
    if (!character) {
      bannerEl.hidden = true;
      return;
    }
    const report = getChoiceCompletionReport(character.build, getRegistry());
    if (!report.hasUnresolvedRequired) {
      bannerEl.hidden = true;
      return;
    }
    bannerTextEl.textContent = formatIncompleteChoicesBannerMessage(report.unresolvedRequired.length);
    bannerEl.hidden = false;
  }

  /* ------------------------------- rendering ---------------------------- */

  /** @type {import("./builderWizardSteps.js").WizardStepContext} */
  const stepCtx = {
    getDraft: () => /** @type {{ name: string, build: CharacterBuildState }} */ (
      { name: "", build: /** @type {CharacterBuildState} */ (draft?.build) }
    ),
    getRegistry,
    signal,
    enhanceSelect: enhanceDynamicSelect,
    onDraftChanged: () => handleDraftChanged()
  };

  /**
   * @param {ChoiceCompletionDescriptor} descriptor
   * @param {HTMLElement} container
   */
  function renderDescriptor(descriptor, container) {
    const registry = getRegistry();
    const section = el(container, "section", "completeChoicesItem");
    section.dataset.choiceKey = descriptor.key;
    const label = formatChoiceFieldLabel(descriptor, registry);

    if (descriptor.kind === "asi" && descriptor.picker?.kind === "asi") {
      // Shared with both wizards so the stored ASI/feat shape stays identical.
      const featOptions = listContentByKind(registry, "feat")
        .map((entry) => ({
          value: entry.id,
          label: entry.source === "custom" ? `${entry.name} (custom)` : entry.name
        }));
      const abilityOptions = CHARACTER_ABILITY_KEYS
        .map((key) => ({ value: key, label: ABILITY_LABELS[key] || key.toUpperCase() }));
      renderAsiSlot(stepCtx, section, descriptor.picker.slot, featOptions, abilityOptions);
      return;
    }

    if (descriptor.kind === "subclass") {
      const classId = cleanString(descriptor.classId);
      const build = /** @type {Record<string, unknown>} */ (draft?.build ?? {});
      if (!isPlainObject(build.subclassByClass)) build.subclassByClass = {};
      const stored = cleanString(
        /** @type {Record<string, string>} */ (build.subclassByClass)[classId]
      );
      const field = el(section, "div", "builderIdentityField builderSubclassField");
      el(field, "span", "", label);
      const options = resolveChoiceOptions(descriptor, registry)
        .map((option) => ({ value: option.id, label: option.name }));
      const select = makeSelect(field, options, stored, emptyOptionLabel(descriptor));
      select.setAttribute("aria-label", label);
      // `data-subclass-class-id` rather than a choice id: a subclass is stored
      // on build.subclassByClass, not in choicesByLevel.
      select.dataset.subclassClassId = classId;
      select.addEventListener("change", () => {
        const value = cleanString(select.value);
        const map = /** @type {Record<string, string>} */ (build.subclassByClass);
        if (value) map[classId] = value;
        else delete map[classId];
        handleDraftChanged();
      }, { signal });
      enhanceDynamicSelect(select);
      return;
    }

    renderMultiPickChoice(stepCtx, section, {
      label,
      count: descriptor.allowed,
      options: resolveChoiceOptions(descriptor, registry)
        .map((option) => ({ value: option.id, label: option.name })),
      choiceId: cleanString(descriptor.choiceId),
      levelKey: cleanString(descriptor.levelKey) || "1",
      emptyLabel: emptyOptionLabel(descriptor)
    });
  }

  /**
   * Rebuilds the dialog body from the *current* draft. Only unresolved required
   * choices are rendered, so a choice resolved during this session disappears
   * and a choice newly unlocked by one (a subclass that brings its own required
   * pick) appears — both without leaving the dialog.
   */
  function renderBody() {
    if (!draft) return;
    destroyEnhancedSelects();
    clearChildren(bodyEl);
    const report = getChoiceCompletionReport(draft.build, getRegistry());
    const items = report.unresolvedRequired;
    renderedKeys = items.map((descriptor) => descriptor.key).join("|");
    const hasItems = items.length > 0;
    emptyEl.hidden = hasItems;
    introEl.hidden = !hasItems;
    bodyEl.hidden = !hasItems;
    for (const descriptor of items) renderDescriptor(descriptor, bodyEl);
  }

  /**
   * Draft-change hook. Rebuilds only when the unresolved set actually changed,
   * so partially filling a multi-pick keeps focus where the user is working.
   */
  function handleDraftChanged() {
    if (!draft) return;
    const report = getChoiceCompletionReport(draft.build, getRegistry());
    const nextKeys = report.unresolvedRequired.map((descriptor) => descriptor.key).join("|");
    if (nextKeys === renderedKeys) return;
    renderBody();
    queueMicrotask(() => {
      if (overlay.hidden) return;
      const target = getFocusable(bodyEl)[0] || applyBtn;
      try { target.focus({ preventScroll: true }); } catch { target.focus?.(); }
    });
  }

  /* --------------------------------- flow -------------------------------- */

  /** @param {string} message */
  function showDialogStatus(message) {
    statusEl.textContent = message;
    statusEl.hidden = !message;
  }

  function open() {
    if (destroyed || !overlay.hidden) return;
    const character = getBuilderCharacter();
    if (!character) return;

    // Isolated draft. `clonePlainBuild` (not structuredClone) is required: the
    // live build may be a dev-mode mutation-guard Proxy, which structuredClone
    // rejects with DataCloneError (builderWizard.editClone regression).
    const normalized = normalizeCharacterBuild(clonePlainBuild(character.build));
    if (!normalized) {
      setStatus?.("Complete Choices could not read this character safely.", { stickyMs: 2500 });
      return;
    }

    phase = "idle";
    draft = { build: normalized };
    baselineJson = JSON.stringify(normalized);
    baselineLevelCount = normalizeBuildLevels(normalized).length;
    openCharacterId = cleanString(character.id);
    openCampaignId = getActiveCampaignId();
    previousFocus = document.activeElement;
    applyBtn.disabled = false;
    showDialogStatus("");
    renderBody();
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    queueMicrotask(() => {
      if (overlay.hidden) return;
      const target = getFocusable(bodyEl)[0] || getFocusable(panel)[0] || panel;
      try { target.focus({ preventScroll: true }); } catch { target.focus?.(); }
    });
  }

  /** @param {{ restoreFocus?: boolean }} [options] */
  function close(options = {}) {
    const restoreFocus = options.restoreFocus !== false;
    destroyEnhancedSelects();
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    showDialogStatus("");
    // The draft is discarded on every close path: canonical state is only ever
    // written by a successful Apply.
    draft = null;
    baselineJson = "";
    renderedKeys = "";
    openCharacterId = "";
    openCampaignId = "";
    phase = "idle";
    applyBtn.disabled = false;
    const target = restoreFocus && previousFocus &&
      typeof (/** @type {HTMLElement} */ (previousFocus).focus) === "function"
      ? /** @type {HTMLElement} */ (previousFocus)
      : null;
    previousFocus = null;
    if (target) {
      queueMicrotask(() => {
        try { target.focus({ preventScroll: true }); } catch { target.focus(); }
      });
    }
  }

  /** Close only when no apply is in flight. */
  function requestClose() {
    if (phase !== "idle") return;
    close({ restoreFocus: true });
  }

  async function onApply() {
    if (destroyed || phase !== "idle" || !draft) return;
    phase = "applying";
    applyBtn.disabled = true;

    const draftBuild = draft.build;

    // Submission guards: never write into a different campaign or character.
    if (getActiveCampaignId() !== openCampaignId) {
      close({ restoreFocus: false });
      await uiAlert?.(
        "The active campaign changed, so no choices were saved.",
        { title: "Complete Choices" }
      );
      return;
    }
    const character = getBuilderCharacter();
    if (!character || cleanString(character.id) !== openCharacterId) {
      close({ restoreFocus: false });
      setStatus?.("Complete Choices was canceled because the active character changed.", { stickyMs: 2500 });
      return;
    }

    // A no-op Apply must not mutate or mark dirty.
    if (JSON.stringify(draftBuild) === baselineJson) {
      close({ restoreFocus: true });
      setStatus?.("No choices were changed.", { stickyMs: 2000 });
      return;
    }

    // This flow completes choices; it can never add or remove a character level.
    if (normalizeBuildLevels(draftBuild).length !== baselineLevelCount) {
      phase = "idle";
      applyBtn.disabled = false;
      await uiAlert?.(
        "These choices could not be applied because the character's levels changed. No changes were made.",
        { title: "Complete Choices" }
      );
      return;
    }

    // Precompute everything before touching state: derivation can fail without
    // leaving a partially written character (the R1 transaction-order rule).
    /** @type {Record<string, unknown>} */
    let beforeSnapshot;
    try {
      beforeSnapshot = JSON.parse(JSON.stringify(character));
    } catch {
      phase = "idle";
      applyBtn.disabled = false;
      await uiAlert?.(
        "These choices could not be applied because this character could not be read safely. No changes were made.",
        { title: "Complete Choices" }
      );
      return;
    }
    /** @type {Partial<import("../../state.js").CharacterEntry>} */
    let patch;
    try {
      patch = getBuilderFinishSheetSeedPatch({ ...beforeSnapshot, build: draftBuild }, getRegistry());
    } catch (err) {
      console.error("Complete Choices: sheet seeding failed.", err);
      phase = "idle";
      applyBtn.disabled = false;
      await uiAlert?.(
        "These choices could not be applied. No changes were made.",
        { title: "Complete Choices" }
      );
      return;
    }

    // One mutation → one markDirty → one vault write. The build and the
    // additive seed patch commit together or not at all.
    let applyError = "";
    const updated = mutateCharacter((current) => {
      if (cleanString(current?.id) !== openCharacterId) {
        applyError = "active-character-changed";
        return false;
      }
      if (normalizeBuildLevels(current.build).length !== baselineLevelCount) {
        applyError = "invalid-draft";
        return false;
      }
      current.build = draftBuild;
      Object.assign(current, patch);
      return true;
    });

    if (!updated) {
      if (applyError === "active-character-changed") {
        close({ restoreFocus: false });
        setStatus?.("Complete Choices was canceled because the active character changed.", { stickyMs: 2500 });
        return;
      }
      phase = "idle";
      applyBtn.disabled = false;
      await uiAlert?.(
        "These choices could not be applied. No changes were made.",
        { title: "Complete Choices" }
      );
      return;
    }

    // Close before rerendering: the rerender replaces this controller and the
    // invoking banner button, so focus must not be restored to a removed node.
    close({ restoreFocus: false });
    rerender();
    setStatus?.("Character choices updated.", { stickyMs: 2000 });
  }

  /* ------------------------------- listeners ----------------------------- */

  /** @param {Event} event */
  function handleKeydown(event) {
    if (overlay.hidden) return;
    const e = /** @type {KeyboardEvent} */ (event);
    // Defer to a stacked confirm/alert dialog while one is open.
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    if (active?.closest?.("#uiDialogOverlay")) return;
    // Let an open enhanced-select dropdown consume Escape first.
    if (e.key === "Escape") {
      const target = /** @type {{ closest?: (selector: string) => Element | null } | null} */ (
        e.target && typeof e.target === "object" ? e.target : null
      );
      if (target?.closest?.(".selectDropdown, .dropdownMenu")) return;
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = getFocusable(panel);
    if (!focusables.length) {
      e.preventDefault();
      try { panel.focus({ preventScroll: true }); } catch { panel.focus?.(); }
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const activeEl = document.activeElement;
    if (e.shiftKey && (activeEl === first || activeEl === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  }

  bannerBtn.addEventListener("click", (event) => {
    event.preventDefault();
    open();
  }, { signal });

  applyBtn.addEventListener("click", (event) => {
    event.preventDefault();
    void onApply();
  }, { signal });

  closeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    requestClose();
  }, { signal });

  cancelBtn.addEventListener("click", (event) => {
    event.preventDefault();
    requestClose();
  }, { signal });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) requestClose();
  }, { signal });

  document.addEventListener("keydown", handleKeydown, { signal });

  // An active-character change closes an open dialog without mutating either
  // character (the shipped Level Up / rest guard shape) and re-derives the
  // banner for the newly active character.
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, () => {
      if (destroyed) return;
      if (!overlay.hidden) {
        close({ restoreFocus: false });
        setStatus?.("Complete Choices was canceled because the active character changed.", { stickyMs: 2500 });
      }
      refresh();
    }, { signal });
  }

  const unsubscribePanelData = subscribePanelDataChanged("character-fields", () => refresh());

  refresh();

  return {
    refresh,
    open,
    close: () => requestClose(),
    destroy() {
      destroyed = true;
      try { unsubscribePanelData(); } catch { /* noop */ }
      listenerController.abort();
      destroyEnhancedSelects();
      // Never restore focus during teardown: destroy runs from a character-page
      // rerender whose DOM has already been rebuilt.
      close({ restoreFocus: false });
      bannerEl.hidden = true;
    }
  };
}
