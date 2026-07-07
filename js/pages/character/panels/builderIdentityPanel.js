// @ts-check
// Minimal builder identity editor for Step 3 Phase 3B builder characters.

import {
  ACTIVE_CHARACTER_CHANGED_EVENT
} from "../../../domain/characterEvents.js";
import {
  getActiveCharacter,
  isBuilderCharacter
} from "../../../domain/characterHelpers.js";
import {
  getActiveContentRegistry,
  getContentByKind,
  listContentByKind
} from "../../../domain/rules/registry.js";
import {
  getClassBlocks,
  getTotalLevel,
  normalizeBuildLevels,
  setSingleClassId,
  setSingleClassTotalLevel
} from "../../../domain/rules/progression.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { notifyPanelDataChanged, subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";
import { getNoopDestroyApi, requireMany } from "../../../utils/domGuards.js";

const NOT_SELECTED_LABEL = "Not selected";
const MIN_LEVEL = 1;
const MAX_LEVEL = 20;

/** @type {Readonly<Record<"race" | "background", string>>} */
const BUILD_FIELD_BY_KIND = Object.freeze({
  race: "raceId",
  background: "backgroundId"
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeLevel(value) {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.trunc(n)));
}

/**
 * Accepts both v2 builds (levels array) and legacy v1 builds (level field).
 * @param {Record<string, unknown>} build
 * @returns {boolean}
 */
function hasCurrentMinimalBuildShape(build) {
  return Number.isFinite(Number(build.version)) &&
    cleanString(build.ruleset).length > 0 &&
    isPlainObject(build.abilities) &&
    isPlainObject(build.abilities.base) &&
    isPlainObject(build.choicesByLevel) &&
    (Array.isArray(build.levels) || normalizeLevel(build.level) != null);
}

/**
 * @param {Record<string, unknown>} build
 * @returns {string}
 */
function getStartingClassId(build) {
  const blocks = getClassBlocks(build);
  if (blocks.length) return blocks[0].classId;
  return cleanString(build.classId).replace(/^class_/, "");
}

/**
 * @param {Record<string, unknown>} build
 * @returns {number}
 */
function getDisplayLevel(build) {
  const levels = normalizeBuildLevels(build);
  if (levels.length) return getTotalLevel(levels);
  return normalizeLevel(build.level) ?? MIN_LEVEL;
}

/**
 * @param {unknown} character
 * @returns {Record<string, unknown> | null}
 */
function getEditableBuild(character) {
  if (!isBuilderCharacter(character) || !isPlainObject(character)) return null;
  const build = character.build;
  if (!isPlainObject(build) || !hasCurrentMinimalBuildShape(build)) return null;
  return build;
}

/**
 * @param {HTMLSelectElement} select
 * @param {import("../../../domain/rules/builtinContent.js").BuiltinContentKind} kind
 * @param {unknown} selectedId
 * @returns {void}
 */
function populateContentSelect(select, kind, selectedId) {
  const selected = cleanString(selectedId);
  const entries = listContentByKind(getActiveContentRegistry(), kind);
  select.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = NOT_SELECTED_LABEL;
  select.appendChild(emptyOption);

  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.name;
    select.appendChild(option);
  }

  select.value = selected && entries.some((entry) => entry.id === selected) ? selected : "";
}

/**
 * @param {unknown} value
 * @param {import("../../../domain/rules/builtinContent.js").BuiltinContentKind} kind
 * @returns {string | null | undefined}
 */
function normalizeSelectedContentId(value, kind) {
  const id = cleanString(value);
  if (!id) return null;
  return getContentByKind(getActiveContentRegistry(), kind, id) ? id : undefined;
}

/**
 * @param {{
 *   state?: import("../../../state.js").State,
 *   SaveManager?: { markDirty?: () => void },
 *   root?: ParentNode,
 *   setStatus?: (message: string, options?: Record<string, unknown>) => void
 * }} [deps]
 * @returns {{ destroy: () => void }}
 */
export function initBuilderIdentityPanel(deps = {}) {
  const {
    state,
    SaveManager,
    root = document,
    setStatus
  } = deps;

  if (!state) return getNoopDestroyApi();

  const guard = requireMany(
    {
      panel: "#charBuilderIdentityPanel",
      content: "#charBuilderIdentityContent",
      unavailable: "#charBuilderIdentityUnavailable",
      grid: "#charBuilderIdentityGrid",
      race: "#charBuilderRaceSelect",
      class: "#charBuilderClassSelect",
      background: "#charBuilderBackgroundSelect",
      level: "#charBuilderLevelInput"
    },
    {
      root,
      setStatus,
      context: "Builder identity panel",
      devAssert: false,
      warn: false
    }
  );
  if (!guard.ok) return guard.destroy;

  const panelEl = /** @type {HTMLElement} */ (guard.els.panel);
  const contentEl = /** @type {HTMLElement} */ (guard.els.content);
  const unavailableEl = /** @type {HTMLElement} */ (guard.els.unavailable);
  const gridEl = /** @type {HTMLElement} */ (guard.els.grid);
  const raceSelect = /** @type {HTMLSelectElement} */ (guard.els.race);
  const classSelect = /** @type {HTMLSelectElement} */ (guard.els.class);
  const backgroundSelect = /** @type {HTMLSelectElement} */ (guard.els.background);
  const levelInput = /** @type {HTMLInputElement} */ (guard.els.level);
  const multiclassHintEl = /** @type {HTMLElement | null} */ (
    root.querySelector?.("#charBuilderMulticlassHint") ?? null
  );
  const { updateCharacterField, mutateCharacter } = createStateActions({ state, SaveManager });
  const destroyFns = [];
  const listenerController = new AbortController();
  const listenerSignal = listenerController.signal;
  const panelSource = { panelId: "builder-identity" };
  let destroyed = false;

  destroyFns.push(() => listenerController.abort());

  function resetControls() {
    raceSelect.value = "";
    classSelect.value = "";
    backgroundSelect.value = "";
    levelInput.value = "";
  }

  /**
   * @param {Record<string, unknown>} build
   * @returns {boolean}
   */
  function isMulticlassBuild(build) {
    return getClassBlocks(build).length > 1;
  }

  /**
   * @param {Record<string, unknown>} build
   */
  function syncControls(build) {
    populateContentSelect(raceSelect, "race", build.raceId);
    populateContentSelect(classSelect, "class", getStartingClassId(build));
    populateContentSelect(backgroundSelect, "background", build.backgroundId);
    levelInput.value = String(getDisplayLevel(build));
    levelInput.min = String(MIN_LEVEL);
    levelInput.max = String(MAX_LEVEL);
    levelInput.step = "1";

    // Multiclass builds are edited in the wizard so exact level order is
    // preserved; the single-class-oriented class/level controls here are
    // disabled to avoid collapsing interleaved level history.
    const multiclass = isMulticlassBuild(build);
    classSelect.disabled = multiclass;
    classSelect.setAttribute("aria-disabled", multiclass.toString());
    levelInput.disabled = multiclass;
    levelInput.setAttribute("aria-disabled", multiclass.toString());
    if (multiclassHintEl) multiclassHintEl.hidden = !multiclass;
  }

  function showPanel() {
    panelEl.hidden = false;
    panelEl.setAttribute("aria-hidden", "false");
  }

  function hide() {
    panelEl.hidden = true;
    panelEl.setAttribute("aria-hidden", "true");
    unavailableEl.hidden = true;
    gridEl.hidden = true;
    contentEl.removeAttribute("aria-disabled");
    resetControls();
  }

  function showUnavailable() {
    resetControls();
    unavailableEl.hidden = false;
    gridEl.hidden = true;
    contentEl.setAttribute("aria-disabled", "true");
    showPanel();
  }

  /**
   * @param {Record<string, unknown>} build
   */
  function showEditable(build) {
    unavailableEl.hidden = true;
    gridEl.hidden = false;
    contentEl.removeAttribute("aria-disabled");
    syncControls(build);
    showPanel();
  }

  function refresh() {
    if (destroyed) return;
    const character = getActiveCharacter(state);
    const build = getEditableBuild(character);
    if (build) {
      showEditable(build);
      return;
    }
    if (isBuilderCharacter(character)) {
      showUnavailable();
      return;
    }
    hide();
  }

  /**
   * @param {"race" | "background"} kind
   * @param {unknown} rawValue
   */
  function updateContentId(kind, rawValue) {
    const build = getEditableBuild(getActiveCharacter(state));
    if (!build) {
      refresh();
      return;
    }

    const nextValue = normalizeSelectedContentId(rawValue, kind);
    if (nextValue === undefined) {
      refresh();
      return;
    }

    const field = BUILD_FIELD_BY_KIND[kind];
    const updated = updateCharacterField(`build.${field}`, nextValue, { queueSave: false });
    if (!updated) {
      refresh();
      return;
    }

    SaveManager?.markDirty?.();
    notifyPanelDataChanged("character-fields", { source: panelSource });
    refresh();
  }

  /**
   * Sets the class for a single-class build (all levels share one class).
   * Clearing empties the plan. Multiclass builds are read-only here (the
   * control is disabled), so this never collapses interleaved order.
   * @param {unknown} rawValue
   */
  function updateStartingClass(rawValue) {
    const build = getEditableBuild(getActiveCharacter(state));
    if (!build || isMulticlassBuild(build)) {
      refresh();
      return;
    }
    const nextValue = normalizeSelectedContentId(rawValue, "class");
    if (nextValue === undefined) {
      refresh();
      return;
    }
    const updated = mutateCharacter((character) => {
      const target = getEditableBuild(character);
      if (!target || isMulticlassBuild(target)) return false;
      return setSingleClassId(
        /** @type {import("../../../state.js").CharacterBuildState} */ (target),
        nextValue ?? ""
      );
    }, { queueSave: false });
    if (!updated) {
      refresh();
      return;
    }

    SaveManager?.markDirty?.();
    notifyPanelDataChanged("character-fields", { source: panelSource });
    refresh();
  }

  /**
   * Resizes a single-class build's total level (append/truncate at the end,
   * order-preserving). Multiclass builds are read-only here.
   * @param {unknown} rawValue
   */
  function updateLevel(rawValue) {
    const build = getEditableBuild(getActiveCharacter(state));
    if (!build || isMulticlassBuild(build)) {
      refresh();
      return;
    }

    const nextLevel = normalizeLevel(rawValue);
    if (nextLevel == null) {
      refresh();
      return;
    }

    const updated = mutateCharacter((character) => {
      const target = getEditableBuild(character);
      if (!target || isMulticlassBuild(target)) return false;
      const startingClassId = getStartingClassId(target);
      if (!startingClassId) {
        // No class chosen yet: keep the legacy scalar level field so the
        // display stays in sync until a class is picked.
        if (normalizeLevel(target.level) === nextLevel) return false;
        target.level = nextLevel;
        return true;
      }
      return setSingleClassTotalLevel(
        /** @type {import("../../../state.js").CharacterBuildState} */ (target),
        nextLevel,
        startingClassId
      );
    }, { queueSave: false });
    if (!updated) {
      refresh();
      return;
    }

    SaveManager?.markDirty?.();
    notifyPanelDataChanged("character-fields", { source: panelSource });
    refresh();
  }

  raceSelect.addEventListener("change", () => updateContentId("race", raceSelect.value), {
    signal: listenerSignal
  });
  classSelect.addEventListener("change", () => updateStartingClass(classSelect.value), {
    signal: listenerSignal
  });
  backgroundSelect.addEventListener("change", () => updateContentId("background", backgroundSelect.value), {
    signal: listenerSignal
  });
  levelInput.addEventListener("change", () => updateLevel(levelInput.value), {
    signal: listenerSignal
  });

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, refresh, {
      signal: listenerSignal
    });
  }

  destroyFns.push(subscribePanelDataChanged("character-fields", refresh));
  refresh();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (let i = destroyFns.length - 1; i >= 0; i--) {
        destroyFns[i]?.();
      }
    }
  };
}
