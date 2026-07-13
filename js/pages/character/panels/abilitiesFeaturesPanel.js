// @ts-check
// Character page Abilities & Features panel (derived and manual feature/action display).

import { getActiveCharacter } from "../../../domain/characterHelpers.js";
import { deriveCharacter } from "../../../domain/rules/deriveCharacter.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { ACTIVE_CHARACTER_CHANGED_EVENT } from "../../../domain/characterEvents.js";
import {
  cleanManualFeatureText,
  normalizeLimitedUseConfig,
  normalizeManualFeatureCards,
  updateLimitedUseCount
} from "../../../domain/manualFeatureCards.js";
import {
  getFeatureUseCurrent,
  normalizeFeatureUses,
  updateFeatureUseCount
} from "../../../domain/featureUses.js";
import { requireMany, getNoopDestroyApi } from "../../../utils/domGuards.js";
import { subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";
import { getActiveContentRegistry, getContentByKind } from "../../../domain/rules/registry.js";

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
 * @returns {string}
 */
function newManualFeatureId() {
  return `feature_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
    description: card?.description || "",
    ...(card?.limitedUse ? { limitedUse: normalizeLimitedUseConfig(card.limitedUse) } : {})
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
 * @param {HTMLElement} parent
 * @param {string} featureId
 * @param {string} description
 * @param {boolean} isNotesCollapsed
 */
function appendFeatureNotes(parent, featureId, description, isNotesCollapsed) {
  const notesHeader = appendDiv(parent, "featureCardNotesHeader");
  appendDiv(notesHeader, "featureCardNotesLabel", "Notes");

  const notesToggle = document.createElement("button");
  notesToggle.type = "button";
  notesToggle.className = "featureCardNotesToggleBtn";
  notesToggle.dataset.featureAction = "notes-toggle";
  notesToggle.dataset.featureId = featureId;
  notesToggle.textContent = isNotesCollapsed ? "▸" : "▾";
  notesToggle.setAttribute("aria-expanded", isNotesCollapsed ? "false" : "true");
  notesToggle.setAttribute("aria-label", isNotesCollapsed ? "Show notes" : "Hide notes");
  notesHeader.appendChild(notesToggle);

  const notesArea = appendDiv(parent, "featureCardNotesArea");
  notesArea.dataset.featureNotesArea = featureId;
  notesArea.textContent = description;
}

/**
 * @param {HTMLElement} parent
 * @param {{ id: string, name: string, label: string, current: number, max: number }} trackerConfig
 */
function appendUseTracker(parent, trackerConfig) {
  const tracker = appendDiv(parent, "featureUseTracker");
  tracker.dataset.featureUseTracker = trackerConfig.id;

  const labelWrap = appendDiv(tracker, "featureUseTrackerLabelWrap");
  appendDiv(labelWrap, "featureUseTrackerLabel", trackerConfig.label || "Uses");
  appendDiv(labelWrap, "featureUseTrackerCount", `${trackerConfig.current}/${trackerConfig.max}`);

  const controls = appendDiv(tracker, "featureUseTrackerControls");
  const featureName = trackerConfig.name || "feature";
  const buttons = [
    ["use-decrement", "Use", "Use one"],
    ["use-increment", "Regain", "Regain one use"],
    ["use-reset", "Reset", "Reset uses"]
  ];
  for (const [action, text, label] of buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "featureUseTrackerBtn";
    button.dataset.featureAction = action;
    button.dataset.featureId = trackerConfig.id;
    button.textContent = text;
    button.setAttribute("aria-label", `${label}: ${featureName}`);
    controls.appendChild(button);
  }
}

/**
 * @param {HTMLElement} parent
 * @param {import("../../../state.js").ManualFeatureCard} feature
 */
function appendLimitedUseTracker(parent, feature) {
  const limitedUse = normalizeLimitedUseConfig(feature.limitedUse);
  if (!limitedUse) return;
  appendUseTracker(parent, {
    id: feature.id,
    name: feature.name,
    label: limitedUse.label,
    current: limitedUse.current,
    max: limitedUse.max
  });
}

/**
 * @param {HTMLElement} list
 * @param {import("../../../domain/rules/deriveCharacter.js").DerivedFeatureAction} feature
 * @param {Set<string>} collapsedCards
 * @param {Set<string>} collapsedNotes
 * @param {number | null} featureUseCurrent
 */
function renderDerivedFeatureCard(list, feature, collapsedCards, collapsedNotes, featureUseCurrent = null) {
  const isCollapsed = collapsedCards.has(feature.id);
  const isNotesCollapsed = collapsedNotes.has(feature.id);

  const card = appendDiv(list, "featureActionCard");
  card.dataset.featureId = feature.id;
  card.dataset.featureKind = "derived";
  card.dataset.featureCollapsed = isCollapsed ? "true" : "false";
  card.dataset.notesCollapsed = isNotesCollapsed ? "true" : "false";

  const header = appendDiv(card, "featureActionHeader panelHeaderClickable");
  header.dataset.featureCollapseHeader = feature.id;
  header.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  const titleWrap = appendDiv(header, "featureActionTitleWrap");
  appendDiv(titleWrap, "featureActionTitle", feature.name);
  const sourceText = [feature.source, feature.sourceDetail].filter(Boolean).join(" / ");
  if (sourceText) appendDiv(titleWrap, "featureActionSource", sourceText);

  const headerActions = appendDiv(header, "featureActionHeaderActions");
  if (feature.activation) appendDiv(headerActions, "featureActionActivation", feature.activation);

  const body = appendDiv(card, "featureCardBody");

  if (feature.useTracking && featureUseCurrent != null) {
    appendUseTracker(body, {
      id: feature.id,
      name: feature.name,
      label: feature.useTracking.label,
      current: featureUseCurrent,
      max: feature.useTracking.max
    });
  }

  const details = appendDiv(body, "featureActionDetails");
  const saveLabel = ABILITY_SAVE_LABELS[/** @type {keyof typeof ABILITY_SAVE_LABELS} */ (feature.saveAbility)] || cleanManualFeatureText(feature.saveAbility);
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

  if (feature.description) appendFeatureNotes(body, feature.id, feature.description, isNotesCollapsed);
}

/**
 * @typedef {{ id: string, name: string, source: string, description: string }} ReferenceFeatureEntry
 */

/**
 * Renders a display-only rules-reference card (B3 feature detail seeding):
 * a class/subclass feature, chosen feat, or race trait with its full SRD
 * description. Reference cards are live-derived from the build and registry
 * at render time — no state writes, no edit/move/use controls; the seeded
 * one-liners in the Features text field remain the editable user-owned copy.
 * @param {HTMLElement} list
 * @param {ReferenceFeatureEntry} entry
 * @param {Set<string>} collapsedCards
 */
function renderReferenceFeatureCard(list, entry, collapsedCards) {
  const isCollapsed = collapsedCards.has(entry.id);

  const card = appendDiv(list, "featureActionCard featureReferenceCard");
  card.dataset.featureId = entry.id;
  card.dataset.featureKind = "reference";
  card.dataset.featureCollapsed = isCollapsed ? "true" : "false";

  const header = appendDiv(card, "featureActionHeader panelHeaderClickable");
  header.dataset.featureCollapseHeader = entry.id;
  header.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  const titleWrap = appendDiv(header, "featureActionTitleWrap");
  appendDiv(titleWrap, "featureActionTitle", entry.name);
  if (entry.source) appendDiv(titleWrap, "featureActionSource", entry.source);

  const body = appendDiv(card, "featureCardBody");
  const description = appendDiv(body, "featureCardNotesArea featureReferenceDescription");
  description.textContent = entry.description || "No description in the registry.";
}

/**
 * Collects the display-only reference entries for one derived builder
 * character: class/subclass features (chosen subfeatures replace their
 * parent), chosen feats, and race/subrace traits.
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @returns {ReferenceFeatureEntry[]}
 */
function collectReferenceFeatures(derived) {
  /** @type {ReferenceFeatureEntry[]} */
  const entries = [];
  const registry = getActiveContentRegistry();
  const classNameById = new Map(derived.classLevels.map((info) => [info.classId, info.className]));

  const seen = new Set();
  for (const feature of derived.features) {
    if (feature.replacedBy && feature.replacedBy.length) continue;
    if (seen.has(feature.featureId)) continue;
    seen.add(feature.featureId);
    const className = classNameById.get(feature.classId) || feature.classId;
    entries.push({
      id: `ref:feature:${feature.featureId}`,
      name: feature.name,
      source: `${className} ${feature.classLevel}`,
      description: feature.desc
    });
  }

  for (const featId of derived.featIds) {
    const featEntry = getContentByKind(registry, "feat", featId);
    if (!featEntry) continue;
    entries.push({
      id: `ref:feat:${featEntry.id}`,
      name: featEntry.name,
      source: "Feat",
      description: typeof featEntry.data?.desc === "string" ? featEntry.data.desc : ""
    });
  }

  for (const trait of derived.raceTraits) {
    entries.push({
      id: `ref:trait:${trait.id}`,
      name: trait.name,
      source: trait.source,
      description: trait.description
    });
  }

  return entries;
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
  card.dataset.featureId = feature.id;
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

  // Gear button + inline settings menu
  const gearWrap = appendDiv(headerActions, "featureCardGearWrap");
  gearWrap.dataset.featureSettingsWrap = feature.id;

  const gearBtn = document.createElement("button");
  gearBtn.type = "button";
  gearBtn.className = "iconGearBtn featureCardGearBtn";
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

  appendMoveButton(headerActions, -1, index === 0, feature.id);
  appendMoveButton(headerActions, +1, index >= total - 1, feature.id);

  // Card body — hidden when card is collapsed
  const body = appendDiv(card, "featureCardBody");

  appendLimitedUseTracker(body, feature);

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
    appendFeatureNotes(body, feature.id, feature.description, isNotesCollapsed);
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
  // Reference cards start collapsed (they can be numerous at high level);
  // this tracks which ids already received their initial collapse.
  /** @type {Set<string>} */
  const seenReferenceIds = new Set();

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

    const useSection = document.createElement("div");
    useSection.className = "featureCardUseSection";

    const useHeading = document.createElement("div");
    useHeading.className = "featureCardUseSectionTitle";
    useHeading.textContent = "Limited Uses";
    useSection.appendChild(useHeading);

    const enabledLabel = document.createElement("label");
    enabledLabel.className = "featureCardUseEnabledField";
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.dataset.featureUseEnabled = "true";
    enabledLabel.appendChild(enabledInput);
    enabledLabel.appendChild(document.createTextNode("Track limited uses"));
    useSection.appendChild(enabledLabel);

    const useGrid = document.createElement("div");
    useGrid.className = "featureCardUseGrid";
    const useFields = [
      ["label", "Use Label", "Uses"],
      ["current", "Current Uses", "0"],
      ["max", "Max Uses", "1"]
    ];
    for (const [key, labelText, placeholder] of useFields) {
      const label = document.createElement("label");
      label.className = "featureCardDialogField";
      label.setAttribute("for", `featureCard_limitedUse_${key}`);

      const labelSpan = document.createElement("span");
      labelSpan.className = "modalLabel";
      labelSpan.textContent = labelText;

      const input = document.createElement("input");
      input.id = `featureCard_limitedUse_${key}`;
      input.dataset.featureUseField = key;
      input.className = "featureCardDialogInput";
      input.placeholder = placeholder;
      if (key === "current" || key === "max") {
        input.type = "number";
        input.min = "0";
        input.step = "1";
        input.inputMode = "numeric";
      }

      label.appendChild(labelSpan);
      label.appendChild(input);
      useGrid.appendChild(label);
    }

    const recoveryLabel = document.createElement("label");
    recoveryLabel.className = "featureCardDialogField";
    recoveryLabel.setAttribute("for", "featureCard_limitedUse_recovery");
    const recoveryLabelText = document.createElement("span");
    recoveryLabelText.className = "modalLabel";
    recoveryLabelText.textContent = "Recovery";
    const recoverySelect = document.createElement("select");
    recoverySelect.id = "featureCard_limitedUse_recovery";
    recoverySelect.dataset.featureUseField = "recovery";
    recoverySelect.className = "featureCardDialogInput";
    const recoveryOptions = [
      ["manual", "Manual"],
      ["shortRest", "Short Rest"],
      ["longRest", "Long Rest"],
      ["shortOrLongRest", "Short or Long Rest"],
      ["none", "None"]
    ];
    for (const [value, label] of recoveryOptions) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      recoverySelect.appendChild(option);
    }
    recoveryLabel.appendChild(recoveryLabelText);
    recoveryLabel.appendChild(recoverySelect);
    useGrid.appendChild(recoveryLabel);

    useSection.appendChild(useGrid);
    body.appendChild(useSection);

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
    const limitedUse = normalizeLimitedUseConfig(draft.limitedUse);
    const enabled = overlay.querySelector("[data-feature-use-enabled]");
    if (enabled instanceof HTMLInputElement) enabled.checked = !!limitedUse;
    const useValues = {
      label: limitedUse?.label || "",
      current: limitedUse ? String(limitedUse.current) : "",
      max: limitedUse ? String(limitedUse.max) : "",
      recovery: limitedUse?.recovery || "manual"
    };
    for (const [key, value] of Object.entries(useValues)) {
      const input = overlay.querySelector(`[data-feature-use-field="${key}"]`);
      if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) input.value = value;
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
        ? cleanManualFeatureText(input.value)
        : "";
    }
    const useEnabled = overlay.querySelector("[data-feature-use-enabled]");
    /** @type {Record<string, string>} */
    const useValues = {};
    overlay.querySelectorAll("[data-feature-use-field]").forEach((field) => {
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
        useValues[String(field.dataset.featureUseField)] = field.value;
      }
    });
    const existingId = cleanManualFeatureText(overlay.dataset.featureId);
    /** @type {import("../../../state.js").ManualFeatureCard} */
    const draft = {
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
    if (useEnabled instanceof HTMLInputElement && useEnabled.checked) {
      const limitedUse = normalizeLimitedUseConfig({
        enabled: true,
        label: useValues.label,
        current: useValues.current,
        max: useValues.max,
        recovery: useValues.recovery
      });
      if (limitedUse) draft.limitedUse = limitedUse;
    }
    return draft;
  }

  function saveFeatureDialog() {
    const draft = readFeatureDialogDraft();
    if (!draft) return;
    const existingId = cleanManualFeatureText(featureDialogOverlay?.dataset.featureId);
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

  /**
   * @param {string} featureId
   * @param {"decrement" | "increment" | "reset"} operation
   */
  function updateManualFeatureUses(featureId, operation) {
    const updated = mutateCharacter((character) => {
      const cards = normalizeManualFeatureCards(character.manualFeatureCards);
      const index = cards.findIndex((card) => card.id === featureId);
      if (index === -1) return false;
      const result = updateLimitedUseCount(cards[index].limitedUse, operation);
      if (!result.changed || !result.limitedUse) return false;
      cards[index] = { ...cards[index], limitedUse: result.limitedUse };
      character.manualFeatureCards = cards;
      return true;
    }, { queueSave: false });
    if (updated) markChanged();
  }

  /**
   * @param {string} featureId
   * @param {"decrement" | "increment" | "reset"} operation
   */
  function updateDerivedFeatureUses(featureId, operation) {
    const updated = mutateCharacter((character) => {
      const feature = deriveCharacter(character).derivedFeatureActions.find(
        (entry) => entry.id === featureId && !!entry.useTracking
      );
      if (!feature) return false;
      const result = updateFeatureUseCount(character.featureUses, feature, operation);
      if (!result.changed) return false;
      character.featureUses = result.featureUses;
      return true;
    }, { queueSave: false });
    if (updated) markChanged();
  }

  function render() {
    if (destroyed) return;
    list.replaceChildren();
    const character = getActiveCharacter(state);
    const derived = character ? deriveCharacter(character) : null;
    const derivedFeatures = derived ? derived.derivedFeatureActions : [];
    const referenceFeatures = derived && derived.mode === "builder"
      ? collectReferenceFeatures(derived)
      : [];
    const manualFeatures = character ? normalizeManualFeatureCards(character.manualFeatureCards) : [];
    const featureUses = character ? normalizeFeatureUses(character.featureUses) : {};
    addButton.disabled = !character;
    empty.hidden = derivedFeatures.length + referenceFeatures.length + manualFeatures.length > 0;
    for (const feature of derivedFeatures) {
      renderDerivedFeatureCard(
        list,
        feature,
        collapsedCards,
        collapsedNotes,
        getFeatureUseCurrent(featureUses, feature)
      );
    }
    for (const entry of referenceFeatures) {
      if (!seenReferenceIds.has(entry.id)) {
        seenReferenceIds.add(entry.id);
        collapsedCards.add(entry.id);
      }
      renderReferenceFeatureCard(list, entry, collapsedCards);
    }
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
      const featureId = cleanManualFeatureText(collapseHeader.dataset.featureCollapseHeader);
      if (featureId) {
        if (collapsedCards.has(featureId)) collapsedCards.delete(featureId);
        else collapsedCards.add(featureId);
        const isNowCollapsed = collapsedCards.has(featureId);
        const cardEl = list.querySelector(`[data-feature-id="${featureId}"]`);
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
    const featureId = cleanManualFeatureText(button.dataset.featureId);

    // Notes toggle — in the card body, independent of card collapse
    if (action === "notes-toggle") {
      if (collapsedNotes.has(featureId)) collapsedNotes.delete(featureId);
      else collapsedNotes.add(featureId);
      const isNowCollapsed = collapsedNotes.has(featureId);
      const cardEl = list.querySelector(`[data-feature-id="${featureId}"]`);
      if (cardEl instanceof HTMLElement) {
        cardEl.dataset.notesCollapsed = isNowCollapsed ? "true" : "false";
      }
      button.textContent = isNowCollapsed ? "▸" : "▾";
      button.setAttribute("aria-expanded", isNowCollapsed ? "false" : "true");
      button.setAttribute("aria-label", isNowCollapsed ? "Show notes" : "Hide notes");
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

    const cardEl = button.closest("[data-feature-kind]");
    const isDerivedCard = cardEl instanceof HTMLElement && cardEl.dataset.featureKind === "derived";

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

    if (action === "use-decrement") {
      if (isDerivedCard) updateDerivedFeatureUses(featureId, "decrement");
      else updateManualFeatureUses(featureId, "decrement");
      return;
    }

    if (action === "use-increment") {
      if (isDerivedCard) updateDerivedFeatureUses(featureId, "increment");
      else updateManualFeatureUses(featureId, "increment");
      return;
    }

    if (action === "use-reset") {
      if (isDerivedCard) updateDerivedFeatureUses(featureId, "reset");
      else updateManualFeatureUses(featureId, "reset");
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
