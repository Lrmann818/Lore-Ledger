// @ts-check
// Character page Abilities & Features panel (derived feature/action display).

import { getActiveCharacter } from "../../../domain/characterHelpers.js";
import { deriveCharacter } from "../../../domain/rules/deriveCharacter.js";
import { ACTIVE_CHARACTER_CHANGED_EVENT } from "../../../domain/characterEvents.js";
import { requireMany, getNoopDestroyApi } from "../../../utils/domGuards.js";
import { subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";

const ABILITY_SAVE_LABELS = Object.freeze({
  str: "Str",
  dex: "Dex",
  con: "Con",
  int: "Int",
  wis: "Wis",
  cha: "Cha"
});

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {HTMLElement} parent
 * @param {string} className
 * @param {string} text
 * @returns {HTMLDivElement}
 */
function appendDiv(parent, className, text = "") {
  const el = document.createElement("div");
  el.className = className;
  if (text) el.textContent = text;
  parent.appendChild(el);
  return el;
}

/**
 * @param {HTMLElement} list
 * @param {import("../../../domain/rules/deriveCharacter.js").DerivedFeatureAction} feature
 */
function renderFeatureCard(list, feature) {
  const card = appendDiv(list, "featureActionCard");
  card.dataset.featureId = feature.id;

  const header = appendDiv(card, "featureActionHeader");
  const titleWrap = appendDiv(header, "featureActionTitleWrap");
  appendDiv(titleWrap, "featureActionTitle", feature.name);
  const sourceText = [feature.source, feature.sourceDetail].filter(Boolean).join(" / ");
  if (sourceText) appendDiv(titleWrap, "featureActionSource", sourceText);
  appendDiv(header, "featureActionActivation", feature.activation);

  const details = appendDiv(card, "featureActionDetails");
  const saveLabel = ABILITY_SAVE_LABELS[feature.saveAbility] || cleanString(feature.saveAbility);
  const saveText = saveLabel
    ? `${saveLabel}${feature.saveDc == null ? "" : ` DC ${feature.saveDc}`}`
    : (feature.saveDc == null ? "" : `DC ${feature.saveDc}`);
  const rows = [
    ["Save", saveText],
    ["Area", feature.area],
    ["Damage", [feature.damage, feature.damageType].filter(Boolean).join(" ")],
    ["Recovery", feature.recovery]
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    const row = appendDiv(details, "featureActionDetail");
    appendDiv(row, "featureActionDetailLabel", label);
    appendDiv(row, "featureActionDetailValue", value);
  }

  if (feature.description) appendDiv(card, "featureActionDescription", feature.description);
}

/**
 * @param {{ state?: import("../../../state.js").State, root?: ParentNode, setStatus?: Function }} [deps]
 * @returns {{ destroy: () => void }}
 */
export function initAbilitiesFeaturesPanel(deps = {}) {
  const {
    state,
    root = document,
    setStatus
  } = deps;

  if (!state) return getNoopDestroyApi();

  const guard = requireMany(
    {
      panel: "#charAbilitiesFeaturesPanel",
      list: "#charAbilitiesFeaturesList",
      empty: "#charAbilitiesFeaturesEmpty"
    },
    { root, setStatus, context: "Abilities & Features panel" }
  );
  if (!guard.ok) return guard.destroy;

  const list = /** @type {HTMLElement} */ (guard.els.list);
  const empty = /** @type {HTMLElement} */ (guard.els.empty);
  const destroyFns = [];
  const listenerController = new AbortController();
  destroyFns.push(() => listenerController.abort());
  let destroyed = false;

  function render() {
    if (destroyed) return;
    list.replaceChildren();
    const character = getActiveCharacter(state);
    const features = character ? deriveCharacter(character).derivedFeatureActions : [];
    empty.hidden = features.length > 0;
    for (const feature of features) renderFeatureCard(list, feature);
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, render, { signal: listenerController.signal });
  }
  destroyFns.push(subscribePanelDataChanged("character-fields", render));

  render();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (let i = destroyFns.length - 1; i >= 0; i--) destroyFns[i]?.();
    }
  };
}
