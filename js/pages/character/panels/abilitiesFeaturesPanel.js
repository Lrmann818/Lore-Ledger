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
  ["attackRoll", "Attack Roll", "+5 to hit, Ranged Spell Attack, etc."],
  ["damageRoll", "Damage Roll", "3d6 fire, 1d8+3 slashing, etc."],
  ["effectText", "Effect", "Target charmed, blinded until end of next turn, etc."],
  ["damageEffect", "Damage / Effect", "Combined damage or effect text (legacy field)"],
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
    attackRoll: cleanString(source.attackRoll),
    damageRoll: cleanString(source.damageRoll),
    effectText: cleanString(source.effectText),
    description: cleanString(source.description)
  };
}

/**
 * @param {unknown} value
 * @returns {import("../../../state.js").ManualFeatureCard[]}
 */
function normalizeManualFeatureCards(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeManualFeatureCard).filter(
    /** @param {import("../../../state.js").ManualFeatureCard | null} x @returns {x is import("../../../state.js").ManualFeatureCard} */
    (x) => x !== null
  );
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
    attackRoll: card?.attackRoll || "",
    damageRoll: card?.damageRoll || "",
    effectText: card?.effectText || "",
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
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
function isInteractive(target) {
  return target instanceof Element && !!target.closest(
    "button, input, select, textarea, a, label, summary, [role='button'], [role='link']"
  );
}

/**
 * @param {HTMLElement} parent
 * @param {number} direction
 * @param {boolean} disabled
 * @param {string} featureId
 * @returns {HTMLButtonElement}
 */
function appendMoveButton(parent, direction, disabled, featureId) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "moveBtn";
  btn.textContent = direction < 0 ? "↑" : "↓";
  btn.title = direction < 0 ? "Move feature up" : "Move feature down";
  btn.setAttribute("aria-label", direction < 0 ? "Move feature up" : "Move feature down");
  btn.dataset.featureAction = direction < 0 ? "move-up" : "move-down";
  btn.dataset.featureId = featureId;
  btn.disabled = !!disabled;
  parent.appendChild(btn);
  return btn;
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
  const saveLabel = ABILITY_SAVE_LABELS[/** @type {keyof typeof ABILITY_SAVE_LABELS} */ (feature.saveAbility)] || cleanString(feature.saveAbility);
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
 * @param {number} index
 * @param {number} total
 * @param {Set<string>} collapsedCards
 * @param {Set<string>} collapsedNotes
 */
function renderManualFeatureCard(list, feature, index, total, collapsedCards, collapsedNotes) {
  const isCollapsed = collapsedCards.has(feature.id);
  const isNotesCollapsed = collapsedNotes.has(feature.id);

  const card = appendDiv(list, "featureActionCard manualFeatureCard");
  card.dataset.manualFeatureId = feature.id;
  card.dataset.featureKind = "manual";
  card.dataset.featureCollapsed = isCollapsed ? "true" : "false";
  card.dataset.notesCollapsed = isNotesCollapsed ? "true" : "false";

  // Header — clickable to collapse the card body
  const header = appendDiv(card, "featureActionHeader panelHeaderClickable");
  header.dataset.featureCollapseHeader = feature.id;
  header.setAttribute("aria-expanded", isCollapsed ? "false" : "true");

  const titleWrap = appendDiv(header, "featureActionTitleWrap");
  appendDiv(titleWrap, "featureActionTitle", feature.name || "Untitled Feature");
  if (feature.sourceType) appendDiv(titleWrap, "featureActionSource", feature.sourceType);

  // Right-side controls: activation pill, move buttons, gear button+menu
  const headerActions = appendDiv(header, "featureActionHeaderActions");
  if (feature.activation) appendDiv(headerActions, "featureActionActivation", feature.activation);

  appendMoveButton(headerActions, -1, index === 0, feature.id);
  appendMoveButton(headerActions, +1, index >= total - 1, feature.id);

  // Gear button + inline settings menu
  const gearWrap = appendDiv(headerActions, "featureCardGearWrap");
  gearWrap.dataset.featureSettingsWrap = feature.id;

  const gearBtn = document.createElement("button");
  gearBtn.type = "button";
  gearBtn.className = "featureCardGearBtn";
  gearBtn.dataset.featureAction = "gear";
  gearBtn.dataset.featureId = feature.id;
  gearBtn.textContent = "⚙";
  gearBtn.title = "Feature settings";
  gearBtn.setAttribute("aria-label", `Feature settings: ${feature.name || "Untitled Feature"}`);
  gearBtn.setAttribute("aria-haspopup", "true");
  gearWrap.appendChild(gearBtn);

  const menu = document.createElement("div");
  menu.className = "featureCardSettingsMenu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.dataset.featureSettingsMenu = feature.id;

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "featureCardSettingsMenuBtn";
  editBtn.dataset.featureAction = "edit";
  editBtn.dataset.featureId = feature.id;
  editBtn.textContent = "Edit";
  editBtn.setAttribute("role", "menuitem");
  menu.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "featureCardSettingsMenuBtn danger";
  deleteBtn.dataset.featureAction = "delete";
  deleteBtn.dataset.featureId = feature.id;
  deleteBtn.textContent = "Delete";
  deleteBtn.setAttribute("role", "menuitem");
  menu.appendChild(deleteBtn);

  gearWrap.appendChild(menu);

  // Card body — hidden when card is collapsed
  const body = appendDiv(card, "featureCardBody");

  // Detail rows: show only populated fields
  const detailRows = /** @type {[string, string][]} */ ([
    ["Range / Area", feature.rangeArea || ""],
    ["Save / DC", feature.saveDc || ""],
    ["Attack Roll", feature.attackRoll || ""],
    ["Damage Roll", feature.damageRoll || ""],
    ["Effect", feature.effectText || ""],
    ["Damage / Effect", feature.damageEffect || ""]
  ].filter(([, v]) => !!v));

  if (detailRows.length > 0) {
    const details = appendDiv(body, "featureActionDetails");
    for (const [label, value] of detailRows) {
      const row = appendDiv(details, "featureActionDetail");
      appendDiv(row, "featureActionDetailLabel", label);
      appendDiv(row, "featureActionDetailValue", value || "");
    }
  }

  // Collapsible notes/description
  if (feature.description) {
    const notesToggle = document.createElement("button");
    notesToggle.type = "button";
    notesToggle.className = "featureCardNotesToggleBtn";
    notesToggle.dataset.featureAction = "notes-toggle";
    notesToggle.dataset.featureId = feature.id;
    notesToggle.textContent = isNotesCollapsed ? "▸" : "▾";
    notesToggle.setAttribute("aria-expanded", isNotesCollapsed ? "false" : "true");
    body.appendChild(notesToggle);

    const notesArea = appendDiv(body, "featureCardNotesArea");
    notesArea.dataset.featureNotesArea = feature.id;
    notesArea.textContent = feature.description;
  }
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
  if (!guard.ok) return getNoopDestroyApi();

  const guardEls = /** @type {{ list: HTMLElement, empty: HTMLElement, addButton: HTMLButtonElement }} */ (guard.els);
  const list = guardEls.list;
  const empty = guardEls.empty;
  const addButton = guardEls.addButton;
  const { mutateCharacter } = createStateActions({ state, SaveManager });
  /** @type {Array<() => void>} */
  const destroyFns = [];
  const listenerController = new AbortController();
  destroyFns.push(() => listenerController.abort());
  let destroyed = false;
  /** @type {HTMLElement | null} */
  let featureDialogOverlay = null;

  // In-memory collapse state (UI-only, not persisted)
  /** @type {Set<string>} */
  const collapsedCards = new Set();
  /** @type {Set<string>} */
  const collapsedNotes = new Set();

  function markChanged(message = "") {
    try { SaveManager?.markDirty?.(); } catch { /* noop */ }
    if (message && typeof setStatus === "function") setStatus(message, { stickyMs: 1600 });
    render();
  }

  function closeAllSettingsMenus() {
    list.querySelectorAll("[data-feature-settings-menu]").forEach((menu) => {
      if (menu instanceof HTMLElement) menu.hidden = true;
    });
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
      // Focus the gear button for the card that was edited, or the add button
      const opener = openerId
        ? list.querySelector(`[data-manual-feature-id="${openerId}"] [data-feature-action="gear"]`)
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
        input.value = String((/** @type {Record<string, unknown>} */ (draft))[key] || "");
      }
    }
    const titleEl = overlay.querySelector("#featureCardDialogTitle");
    if (titleEl) titleEl.textContent = card ? "Edit Feature" : "Add Feature";
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
      attackRoll: values.attackRoll || "",
      damageRoll: values.damageRoll || "",
      effectText: values.effectText || "",
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

  function deleteManualFeature(/** @type {string} */ featureId) {
    const updated = mutateCharacter((character) => {
      const cards = normalizeManualFeatureCards(character.manualFeatureCards);
      const nextCards = cards.filter((card) => card.id !== featureId);
      if (nextCards.length === cards.length) return false;
      character.manualFeatureCards = nextCards;
      return true;
    }, { queueSave: false });
    if (updated) markChanged("Feature deleted.");
  }

  /**
   * @param {string} featureId
   * @param {number} direction
   */
  function moveManualFeature(featureId, direction) {
    const updated = mutateCharacter((character) => {
      const cards = normalizeManualFeatureCards(character.manualFeatureCards);
      const index = cards.findIndex((card) => card.id === featureId);
      if (index === -1) return false;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= cards.length) return false;
      const temp = cards[index];
      cards[index] = cards[nextIndex];
      cards[nextIndex] = temp;
      character.manualFeatureCards = cards;
      return true;
    }, { queueSave: false });
    if (updated) markChanged();
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
    for (let i = 0; i < manualFeatures.length; i++) {
      renderManualFeatureCard(list, manualFeatures[i], i, manualFeatures.length, collapsedCards, collapsedNotes);
    }
  }

  addButton.addEventListener("click", () => openFeatureDialog(), { signal: listenerController.signal });

  list.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    // Card header collapse — click anywhere non-interactive on the header
    const collapseHeader = target.closest("[data-feature-collapse-header]");
    if (collapseHeader instanceof HTMLElement && !isInteractive(target)) {
      const featureId = cleanString(collapseHeader.dataset.featureCollapseHeader);
      if (featureId) {
        if (collapsedCards.has(featureId)) collapsedCards.delete(featureId);
        else collapsedCards.add(featureId);
        const isNowCollapsed = collapsedCards.has(featureId);
        const cardEl = list.querySelector(`[data-manual-feature-id="${featureId}"]`);
        if (cardEl instanceof HTMLElement) {
          cardEl.dataset.featureCollapsed = isNowCollapsed ? "true" : "false";
        }
        collapseHeader.setAttribute("aria-expanded", isNowCollapsed ? "false" : "true");
        return;
      }
    }

    const button = target.closest("[data-feature-action]");
    if (!(button instanceof HTMLElement)) return;

    const action = button.dataset.featureAction;
    const featureId = cleanString(button.dataset.featureId);

    // Notes toggle — in the card body, independent of card collapse
    if (action === "notes-toggle") {
      if (collapsedNotes.has(featureId)) collapsedNotes.delete(featureId);
      else collapsedNotes.add(featureId);
      const isNowCollapsed = collapsedNotes.has(featureId);
      const cardEl = list.querySelector(`[data-manual-feature-id="${featureId}"]`);
      if (cardEl instanceof HTMLElement) {
        cardEl.dataset.notesCollapsed = isNowCollapsed ? "true" : "false";
      }
      button.textContent = isNowCollapsed ? "▸ Notes" : "▾ Notes";
      button.setAttribute("aria-expanded", isNowCollapsed ? "false" : "true");
      return;
    }

    // Settings gear toggle
    if (action === "gear") {
      const menu = list.querySelector(`[data-feature-settings-menu="${featureId}"]`);
      if (menu instanceof HTMLElement) {
        const wasOpen = !menu.hidden;
        closeAllSettingsMenus();
        if (!wasOpen) menu.hidden = false;
      }
      return;
    }

    // Edit, Delete, Move — get the card for validation
    const cardEl = button.closest("[data-manual-feature-id]");

    if (action === "edit") {
      closeAllSettingsMenus();
      const character = getActiveCharacter(state);
      const card = normalizeManualFeatureCards(character?.manualFeatureCards).find((item) => item.id === featureId) || null;
      openFeatureDialog(card);
      return;
    }

    if (action === "delete") {
      closeAllSettingsMenus();
      deleteManualFeature(featureId);
      return;
    }

    if (action === "move-up") {
      moveManualFeature(featureId, -1);
      return;
    }

    if (action === "move-down") {
      moveManualFeature(featureId, +1);
      return;
    }

    void cardEl; // suppress unused warning
  }, { signal: listenerController.signal });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    // Close settings menus when clicking outside any gear wrap
    if (!target.closest("[data-feature-settings-wrap]")) {
      closeAllSettingsMenus();
    }
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
