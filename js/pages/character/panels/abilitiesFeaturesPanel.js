// @ts-check
// Character page Abilities & Features panel (derived and manual feature/action display).

import { getActiveCharacter } from "../../../domain/characterHelpers.js";
import { deriveCharacter } from "../../../domain/rules/deriveCharacter.js";
import { createStateActions } from "../../../domain/stateActions.js";
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

const MANUAL_FEATURE_FIELDS = Object.freeze([
  ["name", "Name", "Feature name"],
  ["sourceType", "Source / Type", "Feat, class feature, boon, custom, etc."],
  ["activation", "Activation", "Action, bonus action, reaction, passive, etc."],
  ["rangeArea", "Range / Area", "Self, 30 ft., 15 ft. cone, etc."],
  ["saveDc", "Save / DC", "Dex DC 13, Str save, none, etc."],
  ["damageEffect", "Damage / Effect", "2d6 fire, advantage on checks, etc."],
  ["description", "Description / Notes", "Rules notes or table reminder"]
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @returns {string}
 */
function newManualFeatureId() {
  return `feature_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {unknown} value
 * @returns {import("../../../state.js").ManualFeatureCard | null}
 */
function normalizeManualFeatureCard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = /** @type {Record<string, unknown>} */ (value);
  const id = cleanString(source.id);
  if (!id) return null;
  return {
    id,
    name: cleanString(source.name),
    sourceType: cleanString(source.sourceType),
    activation: cleanString(source.activation),
    rangeArea: cleanString(source.rangeArea),
    saveDc: cleanString(source.saveDc),
    damageEffect: cleanString(source.damageEffect),
    description: cleanString(source.description)
  };
}

/**
 * @param {unknown} value
 * @returns {import("../../../state.js").ManualFeatureCard[]}
 */
function normalizeManualFeatureCards(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeManualFeatureCard).filter(Boolean);
}

/**
 * @param {import("../../../state.js").ManualFeatureCard | null} card
 * @returns {import("../../../state.js").ManualFeatureCard}
 */
function makeManualFeatureDraft(card = null) {
  return {
    id: card?.id || newManualFeatureId(),
    name: card?.name || "",
    sourceType: card?.sourceType || "",
    activation: card?.activation || "",
    rangeArea: card?.rangeArea || "",
    saveDc: card?.saveDc || "",
    damageEffect: card?.damageEffect || "",
    description: card?.description || ""
  };
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
 * @param {HTMLElement} parent
 * @param {string} text
 * @param {string} action
 * @returns {HTMLButtonElement}
 */
function appendCardButton(parent, text, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "npcSmallBtn featureActionCardBtn";
  button.dataset.featureAction = action;
  button.textContent = text;
  parent.appendChild(button);
  return button;
}

/**
 * @param {HTMLElement} list
 * @param {import("../../../domain/rules/deriveCharacter.js").DerivedFeatureAction} feature
 */
function renderDerivedFeatureCard(list, feature) {
  const card = appendDiv(list, "featureActionCard");
  card.dataset.featureId = feature.id;
  card.dataset.featureKind = "derived";

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
 * @param {HTMLElement} list
 * @param {import("../../../state.js").ManualFeatureCard} feature
 */
function renderManualFeatureCard(list, feature) {
  const card = appendDiv(list, "featureActionCard manualFeatureCard");
  card.dataset.manualFeatureId = feature.id;
  card.dataset.featureKind = "manual";

  const header = appendDiv(card, "featureActionHeader");
  const titleWrap = appendDiv(header, "featureActionTitleWrap");
  appendDiv(titleWrap, "featureActionTitle", feature.name || "Untitled Feature");
  if (feature.sourceType) appendDiv(titleWrap, "featureActionSource", feature.sourceType);

  const actions = appendDiv(header, "featureActionHeaderActions");
  if (feature.activation) appendDiv(actions, "featureActionActivation", feature.activation);
  const buttons = appendDiv(actions, "featureActionCardButtons");
  appendCardButton(buttons, "Edit", "edit");
  appendCardButton(buttons, "Delete", "delete");

  const details = appendDiv(card, "featureActionDetails");
  const rows = [
    ["Range / Area", feature.rangeArea],
    ["Save / DC", feature.saveDc],
    ["Damage / Effect", feature.damageEffect]
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
 * @param {{ state?: import("../../../state.js").State, SaveManager?: { markDirty?: () => void }, root?: ParentNode, setStatus?: Function }} [deps]
 * @returns {{ destroy: () => void }}
 */
export function initAbilitiesFeaturesPanel(deps = {}) {
  const {
    state,
    SaveManager,
    root = document,
    setStatus
  } = deps;

  if (!state) return getNoopDestroyApi();

  const guard = requireMany(
    {
      panel: "#charAbilitiesFeaturesPanel",
      list: "#charAbilitiesFeaturesList",
      empty: "#charAbilitiesFeaturesEmpty",
      addButton: "#addFeatureCardBtn"
    },
    { root, setStatus, context: "Abilities & Features panel" }
  );
  if (!guard.ok) return guard.destroy;

  const list = /** @type {HTMLElement} */ (guard.els.list);
  const empty = /** @type {HTMLElement} */ (guard.els.empty);
  const addButton = /** @type {HTMLButtonElement} */ (guard.els.addButton);
  const { mutateCharacter } = createStateActions({ state, SaveManager });
  const destroyFns = [];
  const listenerController = new AbortController();
  destroyFns.push(() => listenerController.abort());
  let destroyed = false;
  /** @type {HTMLElement | null} */
  let featureDialogOverlay = null;

  function markChanged(message = "") {
    try { SaveManager?.markDirty?.(); } catch { /* noop */ }
    if (message && typeof setStatus === "function") setStatus(message, { stickyMs: 1600 });
    render();
  }

  function ensureFeatureDialog() {
    if (featureDialogOverlay && document.contains(featureDialogOverlay)) return featureDialogOverlay;

    const overlay = document.createElement("div");
    overlay.id = "featureCardDialogOverlay";
    overlay.className = "modalOverlay featureCardDialogOverlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");

    const panel = document.createElement("div");
    panel.className = "modalPanel featureCardDialogPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "featureCardDialogTitle");
    panel.setAttribute("tabindex", "-1");

    const header = document.createElement("div");
    header.className = "uiDialogHeader";

    const title = document.createElement("div");
    title.className = "modalTitle";
    title.id = "featureCardDialogTitle";
    title.textContent = "Feature";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "npcSmallBtn";
    close.dataset.featureDialogCancel = "true";
    close.setAttribute("aria-label", "Close Feature");
    close.textContent = "X";

    header.appendChild(title);
    header.appendChild(close);

    const body = document.createElement("div");
    body.className = "uiDialogBody featureCardDialogBody";

    for (const [key, labelText, placeholder] of MANUAL_FEATURE_FIELDS) {
      const label = document.createElement("label");
      label.className = "featureCardDialogField";
      label.setAttribute("for", `featureCard_${key}`);

      const labelSpan = document.createElement("span");
      labelSpan.className = "modalLabel";
      labelSpan.textContent = labelText;

      const input = key === "description"
        ? document.createElement("textarea")
        : document.createElement("input");
      input.id = `featureCard_${key}`;
      input.dataset.featureField = key;
      input.className = key === "description"
        ? "featureCardDialogTextarea"
        : "featureCardDialogInput";
      input.placeholder = placeholder;

      label.appendChild(labelSpan);
      label.appendChild(input);
      body.appendChild(label);
    }

    const footer = document.createElement("div");
    footer.className = "uiDialogFooter";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "npcSmallBtn";
    cancel.dataset.featureDialogCancel = "true";
    cancel.textContent = "Cancel";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "npcSmallBtn";
    save.dataset.featureDialogSave = "true";
    save.textContent = "Save";

    footer.appendChild(cancel);
    footer.appendChild(save);
    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    featureDialogOverlay = overlay;
    return overlay;
  }

  function closeFeatureDialog({ restoreFocus = true } = {}) {
    const overlay = featureDialogOverlay;
    if (!overlay || overlay.hidden) return;
    const openerId = overlay.dataset.featureId || "";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    delete overlay.dataset.featureId;
    if (!restoreFocus) return;
    requestAnimationFrame(() => {
      if (destroyed) return;
      const opener = openerId
        ? list.querySelector(`[data-manual-feature-id="${openerId}"] [data-feature-action="edit"]`)
        : addButton;
      if (opener instanceof HTMLElement) {
        try { opener.focus({ preventScroll: true }); } catch { opener.focus(); }
      }
    });
  }

  /**
   * @param {import("../../../state.js").ManualFeatureCard | null} card
   */
  function openFeatureDialog(card = null) {
    if (destroyed || !getActiveCharacter(state)) return;
    const overlay = ensureFeatureDialog();
    const draft = makeManualFeatureDraft(card);
    overlay.dataset.featureId = card?.id || "";
    for (const [key] of MANUAL_FEATURE_FIELDS) {
      const input = overlay.querySelector(`[data-feature-field="${key}"]`);
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        input.value = String(draft[key] || "");
      }
    }
    const title = overlay.querySelector("#featureCardDialogTitle");
    if (title) title.textContent = card ? "Edit Feature" : "Add Feature";
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    const first = overlay.querySelector("[data-feature-field='name']");
    if (first instanceof HTMLElement) {
      try { first.focus({ preventScroll: true }); } catch { first.focus(); }
    }
  }

  function readFeatureDialogDraft() {
    const overlay = featureDialogOverlay;
    if (!overlay) return null;
    /** @type {Record<string, string>} */
    const values = {};
    for (const [key] of MANUAL_FEATURE_FIELDS) {
      const input = overlay.querySelector(`[data-feature-field="${key}"]`);
      values[key] = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
        ? cleanString(input.value)
        : "";
    }
    const existingId = cleanString(overlay.dataset.featureId);
    return {
      id: existingId || newManualFeatureId(),
      name: values.name || "Untitled Feature",
      sourceType: values.sourceType || "",
      activation: values.activation || "",
      rangeArea: values.rangeArea || "",
      saveDc: values.saveDc || "",
      damageEffect: values.damageEffect || "",
      description: values.description || ""
    };
  }

  function saveFeatureDialog() {
    const draft = readFeatureDialogDraft();
    if (!draft) return;
    const existingId = cleanString(featureDialogOverlay?.dataset.featureId);
    const updated = mutateCharacter((character) => {
      const cards = normalizeManualFeatureCards(character.manualFeatureCards);
      const index = existingId ? cards.findIndex((card) => card.id === existingId) : -1;
      if (index === -1) cards.push(draft);
      else cards[index] = draft;
      character.manualFeatureCards = cards;
      return true;
    }, { queueSave: false });
    if (updated) markChanged(existingId ? "Feature updated." : "Feature added.");
    closeFeatureDialog();
  }

  function deleteManualFeature(featureId) {
    const updated = mutateCharacter((character) => {
      const cards = normalizeManualFeatureCards(character.manualFeatureCards);
      const nextCards = cards.filter((card) => card.id !== featureId);
      if (nextCards.length === cards.length) return false;
      character.manualFeatureCards = nextCards;
      return true;
    }, { queueSave: false });
    if (updated) markChanged("Feature deleted.");
  }

  function render() {
    if (destroyed) return;
    list.replaceChildren();
    const character = getActiveCharacter(state);
    const derivedFeatures = character ? deriveCharacter(character).derivedFeatureActions : [];
    const manualFeatures = character ? normalizeManualFeatureCards(character.manualFeatureCards) : [];
    addButton.disabled = !character;
    empty.hidden = derivedFeatures.length + manualFeatures.length > 0;
    for (const feature of derivedFeatures) renderDerivedFeatureCard(list, feature);
    for (const feature of manualFeatures) renderManualFeatureCard(list, feature);
  }

  addButton.addEventListener("click", () => openFeatureDialog(), { signal: listenerController.signal });
  list.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("[data-feature-action]");
    if (!(button instanceof HTMLElement)) return;
    const cardEl = button.closest("[data-manual-feature-id]");
    if (!(cardEl instanceof HTMLElement)) return;
    const featureId = cleanString(cardEl.dataset.manualFeatureId);
    if (!featureId) return;
    const character = getActiveCharacter(state);
    const card = normalizeManualFeatureCards(character?.manualFeatureCards).find((item) => item.id === featureId) || null;
    if (button.dataset.featureAction === "edit") openFeatureDialog(card);
    else if (button.dataset.featureAction === "delete") deleteManualFeature(featureId);
  }, { signal: listenerController.signal });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("[data-feature-dialog-cancel]")) closeFeatureDialog();
    if (target.closest("[data-feature-dialog-save]")) saveFeatureDialog();
  }, { signal: listenerController.signal });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && featureDialogOverlay && !featureDialogOverlay.hidden) closeFeatureDialog();
  }, { signal: listenerController.signal });

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
