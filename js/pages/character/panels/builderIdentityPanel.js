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
  BUILTIN_CONTENT_REGISTRY,
  getContentById,
  listContentByKind
} from "../../../domain/rules/registry.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { notifyPanelDataChanged, subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";
import { getNoopDestroyApi, requireMany } from "../../../utils/domGuards.js";

const NOT_SELECTED_LABEL = "Not selected";
const MIN_LEVEL = 1;
const MAX_LEVEL = 20;

/** @type {Readonly<Record<"species" | "class" | "background", string>>} */
const BUILD_FIELD_BY_KIND = Object.freeze({
  species: "speciesId",
  class: "classId",
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
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.trunc(n)));
}

/**
 * @param {Record<string, unknown>} build
 * @returns {boolean}
 */
function hasCurrentMinimalBuildShape(build) {
  return Number.isFinite(Number(build.version)) &&
    cleanString(build.ruleset).length > 0 &&
    isPlainObject(build.abilities) &&
    isPlainObject(build.abilities.base) &&
    isPlainObject(build.choicesByLevel) &&
    normalizeLevel(build.level) != null;
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
  const entries = listContentByKind(BUILTIN_CONTENT_REGISTRY, kind);
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
  return getContentById(BUILTIN_CONTENT_REGISTRY, id)?.kind === kind ? id : undefined;
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
      species: "#charBuilderSpeciesSelect",
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
  const speciesSelect = /** @type {HTMLSelectElement} */ (guard.els.species);
  const classSelect = /** @type {HTMLSelectElement} */ (guard.els.class);
  const backgroundSelect = /** @type {HTMLSelectElement} */ (guard.els.background);
  const levelInput = /** @type {HTMLInputElement} */ (guard.els.level);
  const { updateCharacterField } = createStateActions({ state, SaveManager });
  const destroyFns = [];
  const listenerController = new AbortController();
  const listenerSignal = listenerController.signal;
  const panelSource = { panelId: "builder-identity" };
  let destroyed = false;

  destroyFns.push(() => listenerController.abort());

  function hide() {
    panelEl.hidden = true;
    panelEl.setAttribute("aria-hidden", "true");
    speciesSelect.value = "";
    classSelect.value = "";
    backgroundSelect.value = "";
    levelInput.value = "";
  }

  function refresh() {
    if (destroyed) return;
    const build = getEditableBuild(getActiveCharacter(state));
    if (!build) {
      hide();
      return;
    }

    populateContentSelect(speciesSelect, "species", build.speciesId);
    populateContentSelect(classSelect, "class", build.classId);
    populateContentSelect(backgroundSelect, "background", build.backgroundId);
    levelInput.value = String(normalizeLevel(build.level) ?? MIN_LEVEL);
    levelInput.min = String(MIN_LEVEL);
    levelInput.max = String(MAX_LEVEL);
    levelInput.step = "1";

    panelEl.hidden = false;
    panelEl.setAttribute("aria-hidden", "false");
    contentEl.removeAttribute("aria-disabled");
  }

  /**
   * @param {"species" | "class" | "background"} kind
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
   * @param {unknown} rawValue
   */
  function updateLevel(rawValue) {
    const build = getEditableBuild(getActiveCharacter(state));
    if (!build) {
      refresh();
      return;
    }

    const nextLevel = normalizeLevel(rawValue);
    if (nextLevel == null) {
      refresh();
      return;
    }

    const updated = updateCharacterField("build.level", nextLevel, { queueSave: false });
    if (!updated) {
      refresh();
      return;
    }

    SaveManager?.markDirty?.();
    notifyPanelDataChanged("character-fields", { source: panelSource });
    refresh();
  }

  speciesSelect.addEventListener("change", () => updateContentId("species", speciesSelect.value), {
    signal: listenerSignal
  });
  classSelect.addEventListener("change", () => updateContentId("class", classSelect.value), {
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
