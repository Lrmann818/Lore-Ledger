// @ts-check
// js/pages/character/spellbookChoicesFlow.js — the max-level spellbook
// correction ("Add Spellbook Choices").
//
// R5-B2 made an unused under-cap spell allowance fillable at the next Level Up.
// A character already at `MAX_CHARACTER_LEVEL` has no next Level Up, so its
// unused **spellbook** allowance became reachable only through Edit in Builder —
// which R5-C retires. This focused dialog is that allowance's replacement home,
// opened from the Character-page Spells panel's ⋯ menu.
//
// Deliberate boundaries:
//   - **Spellbook only.** Max-level cantrip and known-spell recovery is an
//     identical but separately authorized gate ahead of R5-C; nothing here
//     generalizes to them.
//   - **Additive only.** Stored `knownIds` are never removed, reordered,
//     renamed, deduplicated, normalized, or repaired. The flow appends, or it
//     does nothing at all.
//   - **No prepared-spell involvement.** `getPreparedSpellPlan()` is read for
//     exactly one value — the class-specific `maxSpellLevel` ceiling — and its
//     prepared selections, capacities, and `rest.preparedByClass` are neither
//     read as an authority nor written.
//   - **No acknowledgement.** `underCapAckLevels` records creation and Level Up
//     decisions to finish *short*. This flow reaches no new character level and
//     makes no such decision, so it neither reads, writes, clears, nor gates on
//     that field.
//
// Every rule comes from an existing owner: allowances and counts from
// `choiceCompletion.js` (the same `allowed` the creation Summary and both
// wizards count against), the spell-level ceiling from `preparedSpells.js`, the
// candidate set from `spellChoices.js`, and sheet rows from the spells-only
// `getSpellbookAdditionSheetPatch()`. This module owns no formula.

import { ACTIVE_CHARACTER_CHANGED_EVENT } from "../../domain/characterEvents.js";
import { getActiveCharacter, isBuilderCharacter } from "../../domain/characterHelpers.js";
import { getSpellbookAdditionSheetPatch } from "../../domain/builderSheetSeeding.js";
import {
  getUnderCapChoiceDescriptors,
  UNDER_CAP_KIND
} from "../../domain/rules/choiceCompletion.js";
import { getPreparedSpellPlan } from "../../domain/rules/preparedSpells.js";
import { resolveSpellChoiceOptions } from "../../domain/rules/spellChoices.js";
import { MAX_CHARACTER_LEVEL, normalizeBuildLevels } from "../../domain/rules/progression.js";
import { getActiveContentRegistry, getContentByKind } from "../../domain/rules/registry.js";
import { notifyPanelDataChanged, subscribePanelDataChanged } from "../../ui/panelInvalidation.js";
import { getNoopDestroyApi, requireMany } from "../../utils/domGuards.js";

/** @typedef {import("../../domain/rules/registry.js").ContentRegistry} ContentRegistry */
/** @typedef {import("../../state.js").CharacterEntry} CharacterEntry */

/**
 * One eligible spellbook class: the shared descriptor's counts, the
 * class-specific ceiling, the stored entries as locked context, and the
 * candidates that may still be added.
 *
 * @typedef {{
 *   classId: string,
 *   className: string,
 *   chosen: number,
 *   allowed: number,
 *   remaining: number,
 *   maxSpellLevel: number | null,
 *   storedIds: string[],
 *   storedNames: string[],
 *   candidates: Array<{ id: string, name: string, level: number | null }>,
 *   resolvable: boolean
 * }} SpellbookCorrectionTarget
 */

const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

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
 * A genuinely finite spell level. Nothing is coerced, so a blank or malformed
 * level renders without an ordinal rather than claiming to be a cantrip.
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteLevel(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
      !(/** @type {HTMLElement} */ (node).closest("[hidden]"))));
}

/**
 * The stored spellbook entries for a class, in their existing order.
 *
 * Read-only and non-normalizing: blank slots are skipped for display and
 * counting, but the underlying array is never rewritten — the append path
 * concatenates onto the original array so every stored value survives
 * byte-for-byte.
 *
 * @param {unknown} build
 * @param {string} classId
 * @returns {string[]}
 */
function readStoredSpellbookIds(build, classId) {
  const spellcasting = isPlainObject(build) && isPlainObject(build.spellcasting)
    ? /** @type {Record<string, unknown>} */ (build.spellcasting)
    : {};
  const selection = isPlainObject(spellcasting[classId])
    ? /** @type {Record<string, unknown>} */ (spellcasting[classId])
    : {};
  const stored = selection.knownIds;
  return Array.isArray(stored) ? stored.map(cleanString).filter(Boolean) : [];
}

/**
 * @param {ContentRegistry} registry
 * @param {string} spellId
 * @returns {string}
 */
function spellName(registry, spellId) {
  return getContentByKind(registry, "spell", spellId)?.name || spellId;
}

/**
 * Every spellbook class this character may still add to, or `[]`.
 *
 * Eligibility is exactly the owner's three conditions, evaluated against the
 * **live** character: a builder character, already at `MAX_CHARACTER_LEVEL` (so
 * no future Level Up can ever offer the allowance again), carrying at least one
 * unsatisfied `UNDER_CAP_KIND.SPELLBOOK` descriptor. It is driven by
 * registry-backed descriptors, never by a hard-coded `"wizard"`, so a custom
 * `spellbook`-mode class is covered by the same code with no extra branch — and
 * every eligible class is returned, never just the first.
 *
 * The spell-level ceiling is the class's own `maxSpellLevel` from
 * `getPreparedSpellPlan()`, i.e. that class's own table at its own class level.
 * **Combined multiclass slots are deliberately not used**: a Wizard 1 / Cleric
 * 19 has 9th-level combined slots but may only add 1st-level Wizard spells.
 * A class whose ceiling or registry record cannot be resolved is returned with
 * `resolvable: false` and no candidates, so the dialog can fail visibly instead
 * of silently offering the wrong spells.
 *
 * Pure: reads the character and registry only, mutates nothing, never throws.
 *
 * @param {CharacterEntry | null | undefined} character
 * @param {ContentRegistry} registry
 * @returns {SpellbookCorrectionTarget[]}
 */
export function getSpellbookCorrectionTargets(character, registry) {
  if (!character || !isBuilderCharacter(character)) return [];
  const build = character.build;
  if (normalizeBuildLevels(build).length < MAX_CHARACTER_LEVEL) return [];

  /** @type {import("../../domain/rules/choiceCompletion.js").ChoiceCompletionDescriptor[]} */
  let descriptors;
  try {
    descriptors = getUnderCapChoiceDescriptors(build, registry);
  } catch {
    return [];
  }
  const shortfalls = descriptors.filter((descriptor) =>
    descriptor.kind === UNDER_CAP_KIND.SPELLBOOK &&
    !descriptor.satisfied &&
    !!cleanString(descriptor.classId));
  if (!shortfalls.length) return [];

  // One plan read for every class; its only use here is `maxSpellLevel`.
  /** @type {Map<string, import("../../domain/rules/preparedSpells.js").PreparedSpellPlanEntry>} */
  let planByClassId = new Map();
  try {
    planByClassId = new Map(
      getPreparedSpellPlan(character, registry).map((entry) => [entry.classId, entry])
    );
  } catch {
    planByClassId = new Map();
  }

  return shortfalls.map((descriptor) => {
    const classId = cleanString(descriptor.classId);
    const classEntry = getContentByKind(registry, "class", classId);
    const planEntry = planByClassId.get(classId);
    const rawCeiling = planEntry ? planEntry.maxSpellLevel : null;
    const maxSpellLevel = typeof rawCeiling === "number" && Number.isInteger(rawCeiling) && rawCeiling >= 1
      ? rawCeiling
      : null;
    const storedIds = readStoredSpellbookIds(build, classId);
    const storedSet = new Set(storedIds);

    /** @type {SpellbookCorrectionTarget["candidates"]} */
    let candidates = [];
    if (maxSpellLevel != null) {
      try {
        candidates = resolveSpellChoiceOptions(registry, {
          source: "spells",
          filter: { classId, minLevel: 1, maxLevel: maxSpellLevel }
        })
          .filter((entry) => !storedSet.has(entry.id))
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            level: finiteLevel(entry.data?.level)
          }));
      } catch {
        candidates = [];
      }
    }

    return {
      classId,
      className: classEntry?.name || cleanString(descriptor.label) || classId,
      chosen: descriptor.chosen,
      allowed: descriptor.allowed,
      remaining: Math.max(0, descriptor.allowed - descriptor.chosen),
      maxSpellLevel,
      storedIds,
      storedNames: storedIds.map((id) => spellName(registry, id)),
      candidates,
      resolvable: maxSpellLevel != null && !!classEntry
    };
  });
}

/**
 * @typedef {{
 *   root?: ParentNode,
 *   state: import("../../state.js").State,
 *   mutateCharacter: (mutator: (character: any, state: any) => unknown, options?: Record<string, unknown>) => unknown,
 *   rerender: () => void,
 *   setStatus?: (message: string, options?: Record<string, unknown>) => void,
 *   uiAlert?: (message: string, options?: Record<string, unknown>) => Promise<unknown>
 * }} SpellbookChoicesFlowDeps
 */

/**
 * @param {SpellbookChoicesFlowDeps} deps
 * @returns {{
 *   isAvailable: () => boolean,
 *   open: (options?: { returnFocusTo?: Element | null }) => void,
 *   close: () => void,
 *   subscribe: (listener: () => void) => () => void,
 *   destroy: () => void
 * }}
 */
export function initSpellbookChoicesFlow(deps) {
  const {
    root = document,
    state,
    mutateCharacter,
    rerender,
    setStatus,
    uiAlert
  } = deps || {};

  if (!state) throw new Error("initSpellbookChoicesFlow: state is required");
  if (typeof mutateCharacter !== "function") throw new Error("initSpellbookChoicesFlow: mutateCharacter is required");
  if (typeof rerender !== "function") throw new Error("initSpellbookChoicesFlow: rerender is required");

  const guard = requireMany(
    {
      overlay: "#spellbookChoicesOverlay",
      panel: "#spellbookChoicesPanel",
      closeBtn: "#spellbookChoicesClose",
      body: "#spellbookChoicesBody",
      status: "#spellbookChoicesStatus",
      applyBtn: "#spellbookChoicesApply",
      cancelBtn: "#spellbookChoicesCancel"
    },
    { root, setStatus, context: "Add Spellbook Choices dialog", devAssert: false, warn: false }
  );
  if (!guard.ok) {
    const noop = getNoopDestroyApi();
    return {
      isAvailable: () => false,
      open() {},
      close() {},
      subscribe: () => () => {},
      destroy: noop.destroy
    };
  }

  const overlay = /** @type {HTMLElement} */ (guard.els.overlay);
  const panel = /** @type {HTMLElement} */ (guard.els.panel);
  const closeBtn = /** @type {HTMLButtonElement} */ (guard.els.closeBtn);
  const bodyEl = /** @type {HTMLElement} */ (guard.els.body);
  const statusEl = /** @type {HTMLElement} */ (guard.els.status);
  const applyBtn = /** @type {HTMLButtonElement} */ (guard.els.applyBtn);
  const cancelBtn = /** @type {HTMLButtonElement} */ (guard.els.cancelBtn);

  const listenerController = new AbortController();
  const signal = listenerController.signal;

  let destroyed = false;
  /** @type {"idle" | "applying"} */
  let phase = "idle";
  /** @type {Element | null} */
  let returnFocusTarget = null;
  /** @type {string} */
  let openCharacterId = "";
  /** @type {string} */
  let openCampaignId = "";
  /** Selections made in this dialog session, per class, in pick order. */
  /** @type {Map<string, string[]>} */
  let picks = new Map();
  /** @type {Set<() => void>} */
  const availabilityListeners = new Set();

  const getRegistry = () => getActiveContentRegistry();
  const getActiveCampaignId = () => cleanString(state.appShell?.activeCampaignId);

  /** @returns {CharacterEntry | null} */
  function getCharacter() {
    const character = getActiveCharacter(state);
    return character && isBuilderCharacter(character) ? character : null;
  }

  /** @returns {SpellbookCorrectionTarget[]} */
  function getLiveTargets() {
    return getSpellbookCorrectionTargets(getCharacter(), getRegistry());
  }

  /**
   * Whether the menu action should be offered at all. Recomputed from the live
   * character every time it is asked, never cached.
   * @returns {boolean}
   */
  function isAvailable() {
    if (destroyed) return false;
    return getLiveTargets().length > 0;
  }

  function notifyAvailabilityChanged() {
    for (const listener of Array.from(availabilityListeners)) {
      try { listener(); } catch (err) { console.error("Spellbook choices listener failed:", err); }
    }
  }

  /** @param {string} message */
  function showDialogStatus(message) {
    statusEl.textContent = message;
    statusEl.hidden = !message;
  }

  /* ------------------------------- rendering ---------------------------- */

  /**
   * @param {SpellbookCorrectionTarget} target
   * @returns {string[]}
   */
  function picksFor(target) {
    const current = picks.get(target.classId);
    return Array.isArray(current) ? current : [];
  }

  /** @param {SpellbookCorrectionTarget[]} targets */
  function renderBody(targets) {
    clearChildren(bodyEl);

    if (!targets.length) {
      el(bodyEl, "p", "builderWizardValidation",
        "This character has no unused spellbook choices.");
      applyBtn.disabled = true;
      return;
    }

    let anySelectable = false;

    for (const target of targets) {
      const section = el(bodyEl, "section", "spellbookChoicesClass");
      section.dataset.classId = target.classId;
      el(section, "h4", "builderWizardSubTitle", `${target.className} Spellbook`);

      const head = el(section, "div", "builderSpellGroupHead");
      el(head, "span", "builderSpellGroupTitle", "In spellbook");
      const countEl = el(head, "span", "builderSpellGroupCount", "");
      countEl.setAttribute("role", "status");
      countEl.setAttribute("aria-live", "polite");
      countEl.setAttribute("aria-atomic", "true");

      if (!target.resolvable) {
        // Fail visibly rather than guessing a ceiling or a spell list.
        countEl.textContent = `${target.chosen} / ${target.allowed} in spellbook`;
        el(section, "p", "builderWizardValidation",
          `${target.className}'s spell list could not be read from this campaign's content, so no spells can be added for it right now. Nothing has been changed.`);
        continue;
      }

      el(section, "p", "builderAbilityMethodNote spellbookChoicesNote",
        `${target.remaining} ${target.remaining === 1 ? "choice is" : "choices are"} still unused from earlier levels. ` +
        `You can add spells up to ${ORDINALS[target.maxSpellLevel ?? 0] || "1st"} level. Choosing fewer than the maximum is allowed.`);

      if (target.storedNames.length) {
        el(section, "p", "levelUpLockedContext",
          `Already in spellbook: ${target.storedNames.join(", ")}`);
      }

      const list = el(section, "div", "builderSpellCheckList");
      /** @type {Array<{ input: HTMLInputElement, row: HTMLElement }>} */
      const rows = [];

      const refresh = () => {
        const selected = picksFor(target).length;
        const total = target.chosen + selected;
        countEl.textContent = `${total} / ${target.allowed} in spellbook`;
        const atCap = total >= target.allowed;
        for (const { input, row } of rows) {
          // Only unselected rows are blocked; a pick made in this dialog stays
          // removable, so reaching the cap can never strand a selection.
          input.disabled = input.checked ? false : atCap;
          row.classList.toggle("isDisabled", input.disabled);
        }
      };

      for (const candidate of target.candidates) {
        anySelectable = true;
        const label = document.createElement("label");
        label.className = "builderSpellCheckItem";
        const checkbox = /** @type {HTMLInputElement} */ (document.createElement("input"));
        checkbox.type = "checkbox";
        checkbox.checked = picksFor(target).includes(candidate.id);
        checkbox.addEventListener("change", () => {
          const selected = picksFor(target).slice();
          const index = selected.indexOf(candidate.id);
          if (checkbox.checked && index < 0) {
            // Defensive cap guard: the rendered `disabled` state blocks a real
            // pointer or keyboard, but a synthetic or replayed change event
            // must not push the spellbook past its allowance.
            if (target.chosen + selected.length >= target.allowed) {
              checkbox.checked = false;
              refresh();
              return;
            }
            selected.push(candidate.id);
          }
          if (!checkbox.checked && index >= 0) selected.splice(index, 1);
          picks.set(target.classId, selected);
          refresh();
        }, { signal });
        rows.push({ input: checkbox, row: label });

        label.appendChild(checkbox);
        const nameSpan = document.createElement("span");
        const levelTag = candidate.level != null && candidate.level > 0
          ? ` — ${ORDINALS[candidate.level] || `${candidate.level}th`}`
          : "";
        nameSpan.textContent = `${candidate.name}${levelTag}`;
        label.appendChild(nameSpan);
        list.appendChild(label);
      }

      if (!target.candidates.length) {
        el(section, "p", "mutedSmall",
          `No further ${target.className} spells are available to add from this campaign's content.`);
      }

      refresh();
    }

    applyBtn.disabled = !anySelectable;
  }

  /* --------------------------------- flow -------------------------------- */

  /** @param {{ returnFocusTo?: Element | null }} [options] */
  function open(options = {}) {
    if (destroyed || !overlay.hidden) return;
    const character = getCharacter();
    const targets = getSpellbookCorrectionTargets(character, getRegistry());
    if (!character || !targets.length) {
      setStatus?.("This character has no unused spellbook choices.", { stickyMs: 2500 });
      notifyAvailabilityChanged();
      return;
    }

    phase = "idle";
    picks = new Map();
    openCharacterId = cleanString(character.id);
    openCampaignId = getActiveCampaignId();
    returnFocusTarget = options.returnFocusTo ?? document.activeElement;
    showDialogStatus("");
    renderBody(targets);
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
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    showDialogStatus("");
    clearChildren(bodyEl);
    // The picks are discarded on every close path: canonical state is only ever
    // written by a successful Apply.
    picks = new Map();
    openCharacterId = "";
    openCampaignId = "";
    phase = "idle";
    applyBtn.disabled = false;
    const target = restoreFocus ? returnFocusTarget : null;
    returnFocusTarget = null;
    if (target && typeof (/** @type {HTMLElement} */ (target).focus) === "function") {
      queueMicrotask(() => {
        const node = /** @type {HTMLElement} */ (target);
        if (node.isConnected === false) return;
        try { node.focus({ preventScroll: true }); } catch { node.focus(); }
      });
    }
  }

  /** Close only when no apply is in flight. */
  function requestClose() {
    if (phase !== "idle") return;
    close({ restoreFocus: true });
  }

  /**
   * @param {Element | null} target
   */
  function focusAfterRerender(target) {
    if (!target || typeof (/** @type {HTMLElement} */ (target).focus) !== "function") return;
    const node = /** @type {HTMLElement} */ (target);
    if (node.isConnected === false) return;
    try { node.focus({ preventScroll: true }); } catch { node.focus(); }
  }

  async function onApply() {
    if (destroyed || phase !== "idle") return;
    phase = "applying";
    applyBtn.disabled = true;

    /** @param {string} message */
    const failOpen = async (message) => {
      phase = "idle";
      applyBtn.disabled = false;
      await uiAlert?.(message, { title: "Add Spellbook Choices" });
    };

    // 1-2. Re-resolve the active character and campaign, and recheck identity.
    if (getActiveCampaignId() !== openCampaignId) {
      close({ restoreFocus: false });
      await uiAlert?.(
        "The active campaign changed, so no spellbook choices were added.",
        { title: "Add Spellbook Choices" }
      );
      return;
    }
    const character = getCharacter();
    if (!character || cleanString(character.id) !== openCharacterId) {
      close({ restoreFocus: false });
      setStatus?.("Add Spellbook Choices was canceled because the active character changed.", { stickyMs: 2500 });
      return;
    }

    // 3-5. Recheck total-level eligibility and recompute every allowance,
    // ceiling, and candidate set from the live character and live registry.
    const registry = getRegistry();
    const freshTargets = getSpellbookCorrectionTargets(character, registry);
    const freshByClassId = new Map(freshTargets.map((target) => [target.classId, target]));

    /** @type {Array<{ classId: string, ids: string[] }>} */
    const additions = [];
    for (const [classId, selected] of picks) {
      const ids = (Array.isArray(selected) ? selected : []).map(cleanString).filter(Boolean);
      if (!ids.length) continue;
      const target = freshByClassId.get(classId);
      // 6. Reject any id outside the freshly resolved candidate set.
      if (!target || !target.resolvable) {
        await failOpen(
          "These spellbook choices could not be added because this character's spellbook options changed. No changes were made."
        );
        return;
      }
      const candidateIds = new Set(target.candidates.map((candidate) => candidate.id));
      if (!ids.every((id) => candidateIds.has(id))) {
        await failOpen(
          "These spellbook choices could not be added because one of the selected spells is no longer available. No changes were made."
        );
        return;
      }
      // 7. Reject a result above the fresh allowance.
      if (target.chosen + ids.length > target.allowed) {
        await failOpen(
          "These spellbook choices could not be added because they exceed this character's remaining spellbook allowance. No changes were made."
        );
        return;
      }
      additions.push({ classId, ids });
    }

    if (!additions.length) {
      // A no-op Apply mutates nothing and marks nothing dirty.
      close({ restoreFocus: true });
      setStatus?.("No spellbook choices were added.", { stickyMs: 2000 });
      return;
    }

    // Precompute the sheet patch against a plain projection before touching
    // state: derivation can fail without leaving a partially written character
    // (the R1 transaction-order rule).
    /** @type {Record<string, any>} */
    let projection;
    try {
      projection = JSON.parse(JSON.stringify(character));
    } catch {
      await failOpen(
        "These spellbook choices could not be added because this character could not be read safely. No changes were made."
      );
      return;
    }
    for (const addition of additions) {
      if (!isPlainObject(projection.build.spellcasting)) projection.build.spellcasting = {};
      const bucket = projection.build.spellcasting;
      if (!isPlainObject(bucket[addition.classId])) {
        // Matches the shape both wizards write through `ensureSpellSelection`.
        bucket[addition.classId] = { cantripIds: [], knownIds: [], preparedIds: [] };
      }
      const selection = bucket[addition.classId];
      const existing = Array.isArray(selection.knownIds) ? selection.knownIds : [];
      selection.knownIds = [...existing, ...addition.ids];
    }

    /** @type {{ spells: import("../../state.js").CharacterEntry["spells"] } | null} */
    let patch;
    try {
      // Addition-scoped: only the ids just chosen may seed a row, so a builder
      // row the player deleted stays deleted and every other level and row is
      // byte-identical.
      patch = getSpellbookAdditionSheetPatch(projection, additions, registry);
    } catch (err) {
      console.error("Add Spellbook Choices: sheet seeding failed.", err);
      await failOpen("These spellbook choices could not be added. No changes were made.");
      return;
    }

    // 8-10. One mutation → one markDirty → one vault write. The appends and the
    // spells-only seed patch commit together or not at all.
    //
    // Multi-class atomicity: every bucket is resolved and validated **before**
    // the first live assignment, so a second class that cannot be written can
    // never leave the first class's append committed. `mutateCharacter` marks
    // dirty only on a truthy return, so a rejection here also produces no dirty
    // mark and no rerender.
    let applyError = "";
    const updated = mutateCharacter((current) => {
      if (cleanString(current?.id) !== openCharacterId) {
        applyError = "active-character-changed";
        return false;
      }
      if (normalizeBuildLevels(current.build).length < MAX_CHARACTER_LEVEL) {
        applyError = "invalid-eligibility";
        return false;
      }
      if (!isPlainObject(current.build)) {
        applyError = "invalid-build";
        return false;
      }
      // --- validate every target first ---------------------------------
      /** @type {Array<{ selection: Record<string, unknown> | null, classId: string, next: string[] }>} */
      const planned = [];
      const bucket = isPlainObject(current.build.spellcasting)
        ? /** @type {Record<string, unknown>} */ (current.build.spellcasting)
        : null;
      for (const addition of additions) {
        const selection = bucket && isPlainObject(bucket[addition.classId])
          ? /** @type {Record<string, unknown>} */ (bucket[addition.classId])
          : null;
        if (selection) {
          const stored = selection.knownIds;
          // A malformed non-array `knownIds` is not silently replaced: it is a
          // build shape this action must not normalize.
          if (stored !== undefined && !Array.isArray(stored)) {
            applyError = "invalid-build";
            return false;
          }
          const existing = Array.isArray(stored) ? stored : [];
          planned.push({ selection, classId: addition.classId, next: [...existing, ...addition.ids] });
          continue;
        }
        // Eligibility offered this class with no selection bucket yet (nothing
        // stored is a legal state and counts as 0 chosen), so the bucket is
        // created as part of the same transaction rather than rejected.
        planned.push({ selection: null, classId: addition.classId, next: [...addition.ids] });
      }

      // --- then write ---------------------------------------------------
      if (!bucket) current.build.spellcasting = {};
      const writeBucket = /** @type {Record<string, unknown>} */ (
        bucket ?? current.build.spellcasting
      );
      for (const target of planned) {
        if (target.selection) {
          // Append only. Existing entries keep their exact values and order.
          target.selection.knownIds = target.next;
          continue;
        }
        /** @type {Record<string, unknown>} */
        (writeBucket)[target.classId] = {
          cantripIds: [], knownIds: target.next, preparedIds: []
        };
      }
      if (patch) Object.assign(current, patch);
      return true;
    });

    if (!updated) {
      if (applyError === "active-character-changed") {
        close({ restoreFocus: false });
        setStatus?.("Add Spellbook Choices was canceled because the active character changed.", { stickyMs: 2500 });
        return;
      }
      await failOpen("These spellbook choices could not be added. No changes were made.");
      return;
    }

    const total = additions.reduce((sum, addition) => sum + addition.ids.length, 0);
    const focusTarget = returnFocusTarget;
    close({ restoreFocus: false });
    // The Character page rebuilds its own panels; a Spells panel mounted on
    // another surface (the Combat workspace's embedded copy) is not rebuilt by
    // that rerender, so it needs the established invalidation to pick the new
    // rows up live — no reload, removal, or re-add.
    notifyPanelDataChanged("spells");
    rerender();
    notifyAvailabilityChanged();
    focusAfterRerender(focusTarget);
    setStatus?.(
      total === 1 ? "1 spell added to the spellbook." : `${total} spells added to the spellbook.`,
      { stickyMs: 2000 }
    );
  }

  /* ------------------------------- listeners ----------------------------- */

  /** @param {Event} event */
  function handleKeydown(event) {
    if (overlay.hidden) return;
    const e = /** @type {KeyboardEvent} */ (event);
    // Defer to a stacked confirm/alert dialog while one is open.
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    if (active?.closest?.("#uiDialogOverlay")) return;
    if (e.key === "Escape") {
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
  // character (the shipped Level Up / rest guard shape) and re-derives
  // availability for the newly active character.
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, () => {
      if (destroyed) return;
      if (!overlay.hidden) {
        close({ restoreFocus: false });
        setStatus?.("Add Spellbook Choices was canceled because the active character changed.", { stickyMs: 2500 });
      }
      notifyAvailabilityChanged();
    }, { signal });
  }

  const unsubscribePanelData = subscribePanelDataChanged("character-fields", () => {
    if (!destroyed) notifyAvailabilityChanged();
  });

  return {
    isAvailable,
    open,
    close: () => requestClose(),
    /**
     * Lets the Spells panel re-derive its menu item's enabled state when the
     * active character or its build changes.
     * @param {() => void} listener
     */
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      availabilityListeners.add(listener);
      return () => availabilityListeners.delete(listener);
    },
    destroy() {
      destroyed = true;
      availabilityListeners.clear();
      try { unsubscribePanelData(); } catch { /* noop */ }
      listenerController.abort();
      // Never restore focus during teardown: destroy runs from a character-page
      // rerender whose panels have already been rebuilt.
      close({ restoreFocus: false });
    }
  };
}
