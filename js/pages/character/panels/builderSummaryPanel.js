// @ts-check
// Display-only summary for Step 3 builder characters.

import {
  ACTIVE_CHARACTER_CHANGED_EVENT
} from "../../../domain/characterEvents.js";
import {
  CHARACTER_ABILITY_KEYS,
  getActiveCharacter,
  isBuilderCharacter
} from "../../../domain/characterHelpers.js";
import { deriveCharacter } from "../../../domain/rules/deriveCharacter.js";
import { subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";
import { getNoopDestroyApi, requireMany } from "../../../utils/domGuards.js";

const PLACEHOLDER = "Not selected";
const ABILITY_LABELS = Object.freeze({
  str: "STR",
  dex: "DEX",
  con: "CON",
  int: "INT",
  wis: "WIS",
  cha: "CHA"
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
 * @returns {value is number}
 */
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {number} value
 * @returns {string}
 */
function signedNumber(value) {
  return value >= 0 ? `+${value}` : String(value);
}

/**
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @returns {Array<{ key: string, label: string, total: number, modifier: number }> | null}
 */
function getSafeAbilityRows(derived) {
  if (!isPlainObject(derived.abilities)) return null;

  const rows = [];
  for (const key of CHARACTER_ABILITY_KEYS) {
    const ability = derived.abilities[key];
    if (!isPlainObject(ability)) return null;
    if (!isFiniteNumber(ability.total) || !isFiniteNumber(ability.modifier)) return null;
    rows.push({
      key,
      label: ABILITY_LABELS[key] || key.toUpperCase(),
      total: ability.total,
      modifier: ability.modifier
    });
  }
  return rows;
}

/**
 * @param {unknown} character
 * @returns {{
 *   classLevelLabel: string,
 *   raceLabel: string,
 *   backgroundLabel: string,
 *   level: number,
 *   proficiencyBonus: number,
 *   abilities: Array<{ key: string, label: string, total: number, modifier: number }>
 * } | null}
 */
function getBuilderSummaryViewModel(character) {
  if (!isBuilderCharacter(character)) return null;

  let derived;
  try {
    derived = deriveCharacter(character);
  } catch (err) {
    console.warn("Builder summary derivation failed:", err);
    return null;
  }

  if (!derived || derived.mode !== "builder") return null;
  if (!isFiniteNumber(derived.level) || !isFiniteNumber(derived.proficiencyBonus)) return null;

  const abilities = getSafeAbilityRows(derived);
  if (!abilities) return null;

  const labels = isPlainObject(derived.labels) ? derived.labels : {};
  const levelText = String(derived.level);
  const rawClassLevelLabel = cleanString(labels.classLevel);
  const classLevelLabel = rawClassLevelLabel && rawClassLevelLabel !== levelText
    ? rawClassLevelLabel
    : PLACEHOLDER;

  return {
    classLevelLabel,
    raceLabel: cleanString(labels.race) || PLACEHOLDER,
    backgroundLabel: cleanString(labels.background) || PLACEHOLDER,
    level: derived.level,
    proficiencyBonus: derived.proficiencyBonus,
    abilities
  };
}

/**
 * @param {HTMLElement} parent
 * @param {string} className
 * @param {string | null} text
 * @returns {HTMLElement}
 */
function appendDiv(parent, className, text = null) {
  const el = document.createElement("div");
  el.className = className;
  if (text != null) el.textContent = text;
  parent.appendChild(el);
  return el;
}

/**
 * @param {HTMLElement} contentEl
 * @param {ReturnType<typeof getBuilderSummaryViewModel>} vm
 * @returns {void}
 */
function renderSummary(contentEl, vm) {
  contentEl.innerHTML = "";
  if (!vm) return;

  const note = appendDiv(
    contentEl,
    "builderSummaryNote",
    "Derived from builder data. These values are read-only and are not saved into freeform fields."
  );
  note.id = "charBuilderSummaryDescription";

  const rows = appendDiv(contentEl, "builderSummaryRows");
  [
    ["Class / Level", vm.classLevelLabel],
    ["Race", vm.raceLabel],
    ["Background", vm.backgroundLabel],
    ["Level", String(vm.level)],
    ["Proficiency Bonus", signedNumber(vm.proficiencyBonus)]
  ].forEach(([label, value]) => {
    const row = appendDiv(rows, "builderSummaryRow");
    appendDiv(row, "builderSummaryLabel", label);
    appendDiv(row, "builderSummaryValue", value);
  });

  const abilities = appendDiv(contentEl, "builderSummaryAbilities");
  appendDiv(abilities, "builderSummarySubhead", "Ability Totals");
  const abilityGrid = appendDiv(abilities, "builderAbilityGrid");
  vm.abilities.forEach((ability) => {
    const row = appendDiv(abilityGrid, "builderAbilityRow");
    row.dataset.ability = ability.key;
    appendDiv(row, "builderAbilityLabel", ability.label);
    appendDiv(row, "builderAbilityValue", `${ability.total} (${signedNumber(ability.modifier)})`);
  });
}

/**
 * @param {{
 *   state?: import("../../../state.js").State,
 *   root?: ParentNode,
 *   setStatus?: (message: string, options?: Record<string, unknown>) => void
 * }} [deps]
 * @returns {{ destroy: () => void }}
 */
export function initBuilderSummaryPanel(deps = {}) {
  const {
    state,
    root = document,
    setStatus
  } = deps;

  if (!state) return getNoopDestroyApi();

  const guard = requireMany(
    {
      panel: "#charBuilderSummaryPanel",
      content: "#charBuilderSummaryContent"
    },
    {
      root,
      setStatus,
      context: "Builder summary panel",
      devAssert: false,
      warn: false
    }
  );
  if (!guard.ok) return guard.destroy;

  const panelEl = /** @type {HTMLElement} */ (guard.els.panel);
  const contentEl = /** @type {HTMLElement} */ (guard.els.content);
  const destroyFns = [];
  const listenerController = new AbortController();
  destroyFns.push(() => listenerController.abort());

  let destroyed = false;

  function hide() {
    panelEl.hidden = true;
    panelEl.setAttribute("aria-hidden", "true");
    contentEl.innerHTML = "";
  }

  function refresh() {
    if (destroyed) return;
    const vm = getBuilderSummaryViewModel(getActiveCharacter(state));
    if (!vm) {
      hide();
      return;
    }

    renderSummary(contentEl, vm);
    panelEl.hidden = false;
    panelEl.setAttribute("aria-hidden", "false");
    panelEl.setAttribute("aria-describedby", "charBuilderSummaryDescription");
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, refresh, {
      signal: listenerController.signal
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
