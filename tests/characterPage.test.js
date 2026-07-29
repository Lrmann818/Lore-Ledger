import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../js/pages/character/panels/equipmentPanel.js", () => ({
  initEquipmentPanel: () => ({ destroy: () => { } })
}));
vi.mock("../js/pages/character/panels/attackPanel.js", () => ({
  initAttacksPanel: () => ({ destroy: () => { } })
}));
vi.mock("../js/pages/character/characterSectionReorder.js", () => ({
  setupCharacterSectionReorder: () => ({ destroy: () => { } })
}));
vi.mock("../js/pages/character/panels/spellsPanel.js", () => ({
  initSpellsPanel: () => ({ destroy: () => { } })
}));
vi.mock("../js/pages/character/panels/vitalsPanel.js", () => ({
  initVitalsPanel: () => ({ destroy: () => { } })
}));
vi.mock("../js/pages/character/panels/basicsPanel.js", () => ({
  initBasicsPanel: () => ({ destroy: () => { } })
}));
vi.mock("../js/pages/character/panels/proficienciesPanel.js", () => ({
  initProficienciesPanel: () => ({ destroy: () => { } })
}));
// Records the deps the real controller hands the Abilities panel. The exported
// module function stays a plain function returning a live destroy API so the
// suite-wide restoreAllMocks() cannot strip its return value; only the call
// recording goes through the spy.
const abilitiesPanelInitSpy = vi.hoisted(() => vi.fn());
vi.mock("../js/pages/character/panels/abilitiesPanel.js", () => ({
  initAbilitiesPanel: (panelDeps) => {
    abilitiesPanelInitSpy(panelDeps);
    return { destroy: () => { } };
  }
}));
vi.mock("../js/pages/character/panels/abilitiesFeaturesPanel.js", () => ({
  initAbilitiesFeaturesPanel: () => ({ destroy: () => { } })
}));
vi.mock("../js/pages/character/panels/personalityPanel.js", () => ({
  initPersonalityPanel: () => ({ destroy: () => { } }),
  setupCharacterCollapsibleTextareas: () => ({ destroy: () => { } })
}));
vi.mock("../js/domain/characterPortability.js", () => ({
  MAX_IMPORT_FILE_SIZE: 10 * 1024 * 1024,
  commitImport: vi.fn(),
  exportActiveCharacter: vi.fn(),
  parseAndValidateImport: vi.fn(),
}));
vi.mock("../js/pages/character/restFlow.js", () => ({
  openCharacterRestFlow: vi.fn()
}));

import {
  CHARACTER_ACTION_BUTTON_CLASSES,
  CHARACTER_ACTION_ITEM_CLASSES,
  CHARACTER_SELECTOR_BUTTON_CLASSES,
  CHARACTER_SELECTOR_SELECT_CLASSES,
  initCharacterPageUI
} from "../js/pages/character/characterPage.js";
import {
  ACTIVE_CHARACTER_CHANGED_EVENT,
  notifyActiveCharacterChanged
} from "../js/domain/characterEvents.js";
import {
  MAX_IMPORT_FILE_SIZE,
  commitImport,
  exportActiveCharacter,
  parseAndValidateImport
} from "../js/domain/characterPortability.js";
import { openCharacterRestFlow } from "../js/pages/character/restFlow.js";
import {
  isBuilderCharacter,
  makeDefaultBuilderCharacterEntry,
  makeDefaultCharacterBuild
} from "../js/domain/characterHelpers.js";
import {
  BUILTIN_CONTENT_REGISTRY,
  listContentByKind
} from "../js/domain/rules/registry.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import { getPreparedSpellPlan } from "../js/domain/rules/preparedSpells.js";
import { CURRENT_SCHEMA_VERSION, migrateState, sanitizeForSave } from "../js/state.js";
import { createSaveManager } from "../js/storage/saveManager.js";
import { saveAllLocal } from "../js/storage/persistence.js";
import {
  normalizeCampaignVault,
  projectActiveCampaignState
} from "../js/storage/campaignVault.js";
import {
  rollBuilderAbilityScore,
  rollBuilderAbilityScorePool
} from "../js/pages/character/builderWizard.js";

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  add(...tokens) {
    tokens.forEach((token) => this.values.add(String(token)));
    this.sync();
  }

  remove(...tokens) {
    tokens.forEach((token) => this.values.delete(String(token)));
    this.sync();
  }

  contains(token) {
    return this.values.has(String(token));
  }

  toggle(token, force) {
    const shouldAdd = typeof force === "boolean" ? force : !this.values.has(String(token));
    if (shouldAdd) this.values.add(String(token));
    else this.values.delete(String(token));
    this.sync();
    return shouldAdd;
  }

  setFromString(value) {
    this.values = new Set(String(value || "").split(/\s+/).filter(Boolean));
    this.sync();
  }

  sync() {
    this.owner._className = Array.from(this.values).join(" ");
  }
}

class FakeElement extends EventTarget {
  constructor(tagName = "div") {
    super();
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.children = [];
    this.parentElement = null;
    this.parentNode = null;
    this.ownerDocument = null;
    this.dataset = {};
    this.attributes = new Map();
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.readOnly = false;
    this.checked = false;
    this.selected = false;
    this.name = "";
    this.value = "";
    this.type = "";
    this.accept = "";
    this.files = [];
    this.href = "";
    this.download = "";
    this.title = "";
    this._id = "";
    this._className = "";
    this._textContent = "";
    this.classList = new FakeClassList(this);
  }

  get id() { return this._id; }
  set id(value) {
    if (this.ownerDocument && this._id) this.ownerDocument.unregisterId(this._id, this);
    this._id = String(value || "");
    if (this.ownerDocument && this._id) this.ownerDocument.registerId(this);
  }

  get className() { return this._className; }
  set className(value) { this.classList.setFromString(value); }

  get textContent() {
    if (this.children.length) return this.children.map((child) => child.textContent || "").join("");
    return this._textContent;
  }
  set textContent(value) {
    this.children = [];
    this._textContent = String(value ?? "");
  }

  get innerHTML() {
    return this.children.map((child) => child.textContent || "").join("");
  }
  set innerHTML(_value) {
    this.children.forEach((child) => {
      child.parentElement = null;
      child.parentNode = null;
    });
    this.children = [];
    this._textContent = "";
    if (this.tagName === "SELECT") this.value = "";
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    return idx >= 0 ? siblings[idx + 1] || null : null;
  }

  get selectedOptions() {
    if (this.tagName !== "SELECT") return [];
    const options = this.children.filter((child) => child.tagName === "OPTION");
    return options.filter((option) => option.selected || option.value === this.value);
  }

  get isConnected() {
    let node = this;
    while (node) {
      if (node === this.ownerDocument?.body || node === this.ownerDocument?.documentElement) return true;
      node = node.parentElement;
    }
    return false;
  }

  appendChild(child) {
    child.parentElement = this;
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    if (this.tagName === "SELECT" && child.tagName === "OPTION") {
      if (!this.value || child.selected) this.value = child.value;
    }
    return child;
  }

  insertAdjacentElement(position, element) {
    if (position !== "afterend" || !this.parentElement) return null;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    element.parentElement = this.parentElement;
    element.parentNode = this.parentElement;
    element.ownerDocument = this.ownerDocument;
    siblings.splice(idx + 1, 0, element);
    return element;
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    if (idx >= 0) siblings.splice(idx, 1);
    this.parentElement = null;
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "id") this.id = value;
    if (name === "class") this.className = value;
    if (name === "hidden") this.hidden = true;
    if (name === "name") this.name = String(value);
    if (name === "value") this.value = String(value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "hidden") this.hidden = false;
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  dispatchEvent(event) {
    if (!event.target) {
      try {
        Object.defineProperty(event, "target", {
          configurable: true,
          value: this
        });
      } catch {
        // Native Event.target is read-only in some environments; best effort for fake DOM bubbling.
      }
    }

    const result = super.dispatchEvent(event);
    if (event.bubbles && !event.cancelBubble && this.parentElement) {
      this.parentElement.dispatchEvent(event);
    }
    return result;
  }

  click() {
    this.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  closest(selector) {
    // Attribute form (`[data-snapshot-id]`) — the Restore Character dialog
    // delegates row clicks through it. `data-*` resolves against `dataset`,
    // which is where this fake DOM keeps data attributes.
    if (selector?.startsWith("[") && selector.endsWith("]")) {
      const attr = selector.slice(1, -1);
      const datasetKey = attr.startsWith("data-")
        ? attr.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
        : "";
      let node = this;
      while (node) {
        const matched = datasetKey
          ? node.dataset?.[datasetKey] != null
          : !!node.attributes?.has(attr);
        if (matched) return node;
        node = node.parentElement;
      }
      return null;
    }
    if (!selector?.startsWith(".")) return null;
    const className = selector.slice(1);
    let node = this;
    while (node) {
      if (node.classList?.contains(className)) return node;
      node = node.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (matchesSelector(child, selector)) matches.push(child);
        visit(child);
      });
    };
    visit(this);
    return matches;
  }

  getClientRects() {
    return [{ left: 10, top: 20, right: 130, bottom: 50, width: 120, height: 30 }];
  }

  getBoundingClientRect() {
    return { left: 10, top: 20, right: 130, bottom: 50, width: 120, height: 30 };
  }
}

class FakeDocument extends EventTarget {
  constructor() {
    super();
    this.elementsById = new Map();
    this.documentElement = new FakeElement("html");
    this.body = new FakeElement("body");
    this.activeElement = this.body;
    this.documentElement.ownerDocument = this;
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    const el = new FakeElement(tagName);
    el.ownerDocument = this;
    return el;
  }

  registerId(el) {
    this.elementsById.set(el.id, el);
  }

  unregisterId(id, el) {
    if (this.elementsById.get(id) === el) this.elementsById.delete(id);
  }

  getElementById(id) {
    return this.elementsById.get(id) ?? null;
  }

  querySelector(selector) {
    if (selector.startsWith("#")) return this.getElementById(selector.slice(1));
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }
}

function matchesSelector(el, selector) {
  if (selector === "button") return el.tagName === "BUTTON";
  if (selector === "select") return el.tagName === "SELECT";
  if (selector === "button:not([disabled])") return el.tagName === "BUTTON" && !el.disabled;
  if (selector === "button.active:not([disabled])") {
    return el.tagName === "BUTTON" && el.classList.contains("active") && !el.disabled;
  }
  if (selector === "[data-character-rest]") return !!el.dataset?.characterRest;
  if (selector.startsWith("input[")) {
    const nameMatch = selector.match(/\[name="([^"]+)"\]/);
    const valueMatch = selector.match(/\[value="([^"]+)"\]/);
    return el.tagName === "INPUT"
      && (!nameMatch || el.name === nameMatch[1])
      && (!valueMatch || el.value === valueMatch[1]);
  }
  if (selector === "[data-select-label]") return el.dataset?.selectLabel === "1";
  if (selector.startsWith(".")) return el.classList.contains(selector.slice(1));
  return false;
}

function appendWithId(document, parent, tagName, id, className = "") {
  const el = document.createElement(tagName);
  el.id = id;
  if (className) el.className = className;
  parent.appendChild(el);
  return el;
}

function installCharacterSelectorDom() {
  const document = new FakeDocument();
  const root = appendWithId(document, document.body, "section", "page-character");
  const emptyState = appendWithId(document, root, "div", "charEmptyState");
  emptyState.hidden = true;
  appendWithId(document, emptyState, "button", "charEmptyStateYes");
  appendWithId(document, emptyState, "button", "charEmptyStateNo");
  const bar = appendWithId(document, root, "div", "charSelectorBar", "charSelectorBar");
  const selector = appendWithId(document, bar, "select", "charSelector", CHARACTER_SELECTOR_SELECT_CLASSES);
  const builderBadge = appendWithId(document, bar, "span", "charBuilderModeBadge", "charBuilderModeBadge");
  builderBadge.textContent = "Builder Mode";
  builderBadge.setAttribute("aria-label", "Builder mode active. Full builder tools are not enabled yet.");
  builderBadge.setAttribute("title", "Builder mode active. Full builder tools are not enabled yet.");
  builderBadge.hidden = true;
  const shortRestButton = appendWithId(document, bar, "button", "charShortRestBtn", "panelBtnSm charRestBtn");
  shortRestButton.type = "button";
  shortRestButton.dataset.characterRest = "shortRest";
  shortRestButton.textContent = "Short Rest";
  const longRestButton = appendWithId(document, bar, "button", "charLongRestBtn", "panelBtnSm charRestBtn");
  longRestButton.type = "button";
  longRestButton.dataset.characterRest = "longRest";
  longRestButton.textContent = "Long Rest";
  const actionMenu = appendWithId(document, bar, "div", "charActionMenu", "dropdown charActionMenu");
  const actionMenuButton = appendWithId(document, actionMenu, "button", "charActionMenuBtn", CHARACTER_ACTION_BUTTON_CLASSES);
  actionMenuButton.type = "button";
  actionMenuButton.textContent = "...";
  actionMenuButton.setAttribute("aria-label", "Character actions");
  actionMenuButton.setAttribute("aria-haspopup", "true");
  actionMenuButton.setAttribute("aria-expanded", "false");
  const actionMenuDropdown = appendWithId(document, actionMenu, "div", "charActionDropdownMenu", "dropdownMenu charActionDropdownMenu");
  actionMenuDropdown.hidden = true;
  actionMenuDropdown.setAttribute("aria-hidden", "true");
  [
    ["charActionNewBtn", "new", "New Character"],
    ["charActionNewBuilderBtn", "new-builder", "Create with Builder"],
    ["charActionEditBuilderBtn", "edit-builder", "Edit in Builder"],
    ["charActionLevelUpBtn", "level-up", "Level Up"],
    ["charActionRestoreBtn", "restore-character", "Restore Character"],
    ["charActionRenameBtn", "rename", "Rename Character"],
    ["charActionAddNpcBtn", "add-npc", "Add to NPCs"],
    ["charActionAddPartyBtn", "add-party", "Add to Party"],
    ["charActionExportBtn", "export", "Export Character"],
    ["charActionImportBtn", "import", "Import Character"],
    ["charActionDeleteBtn", "delete", "Delete Character"],
  ].forEach(([id, action, label]) => {
    const button = appendWithId(document, actionMenuDropdown, "button", id, CHARACTER_ACTION_ITEM_CLASSES);
    button.type = "button";
    button.dataset.charAction = action;
    button.textContent = label;
  });

  const window = new EventTarget();
  window.document = document;
  window.innerWidth = 1024;
  window.innerHeight = 768;
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);

  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("Node", FakeElement);
  vi.stubGlobal("MutationObserver", class {
    observe() { }
    disconnect() { }
  });

  return { document, selector, actionMenu, actionMenuButton, actionMenuDropdown };
}

function installBuilderSummaryDom(document) {
  const root = document.getElementById("page-character");
  let columns = document.getElementById("charColumns");
  if (!columns) columns = appendWithId(document, root, "div", "charColumns", "charColumns");
  let col = document.getElementById("charCol0");
  if (!col) col = appendWithId(document, columns, "div", "charCol0", "charCol");
  const basics = document.getElementById("charBasicsPanel") || appendWithId(document, col, "section", "charBasicsPanel", "panel");
  if (!document.getElementById("charName")) appendWithId(document, basics, "input", "charName");
  if (!document.getElementById("charClassLevel")) appendWithId(document, basics, "input", "charClassLevel");
  if (!document.getElementById("charRace")) appendWithId(document, basics, "input", "charRace");
  if (!document.getElementById("charBackground")) appendWithId(document, basics, "input", "charBackground");

  const summary = appendWithId(document, col, "section", "charBuilderSummaryPanel", "panel builderSummaryPanel");
  summary.hidden = true;
  summary.setAttribute("aria-hidden", "true");
  appendWithId(document, summary, "h2", "charBuilderSummaryTitle").textContent = "Builder Summary";
  appendWithId(document, summary, "div", "charBuilderSummaryContent", "builderSummaryContent");
  return summary;
}

function installBuilderIdentityDom(document) {
  const root = document.getElementById("page-character");
  let columns = document.getElementById("charColumns");
  if (!columns) columns = appendWithId(document, root, "div", "charColumns", "charColumns");
  let col = document.getElementById("charCol0");
  if (!col) col = appendWithId(document, columns, "div", "charCol0", "charCol");
  const basics = document.getElementById("charBasicsPanel") || appendWithId(document, col, "section", "charBasicsPanel", "panel");
  if (!document.getElementById("charName")) appendWithId(document, basics, "input", "charName");
  if (!document.getElementById("charClassLevel")) appendWithId(document, basics, "input", "charClassLevel");
  if (!document.getElementById("charRace")) appendWithId(document, basics, "input", "charRace");
  if (!document.getElementById("charBackground")) appendWithId(document, basics, "input", "charBackground");

  const panel = appendWithId(document, col, "section", "charBuilderIdentityPanel", "panel builderIdentityPanel");
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("aria-labelledby", "charBuilderIdentityTitle");
  appendWithId(document, panel, "h2", "charBuilderIdentityTitle").textContent = "Builder Identity";
  const content = appendWithId(document, panel, "div", "charBuilderIdentityContent", "builderIdentityContent");
  appendWithId(document, content, "p", "charBuilderIdentityNote", "builderIdentityNote")
    .textContent = "Race, class, background, and level are guarded build choices. Edit them with the builder wizard.";
  const grid = appendWithId(document, content, "div", "charBuilderIdentityGrid", "builderIdentityGrid builderIdentityReadonlyGrid");
  [
    ["Race", "charBuilderRaceLabel", "charBuilderRaceValue"],
    ["Class", "charBuilderClassLabel", "charBuilderClassValue"],
    ["Background", "charBuilderBackgroundLabel", "charBuilderBackgroundValue"],
    ["Level", "charBuilderLevelLabel", "charBuilderLevelValue"],
  ].forEach(([label, labelId, valueId]) => {
    const field = appendWithId(document, grid, "div", `${valueId}Field`, "builderIdentityField");
    appendWithId(document, field, "span", labelId).textContent = label;
    const value = appendWithId(document, field, "span", valueId, "builderIdentityValue");
    value.setAttribute("aria-labelledby", labelId);
    value.textContent = "—";
  });
  const actions = appendWithId(document, content, "div", "charBuilderIdentityActions", "builderPanelActions");
  const editBtn = appendWithId(document, actions, "button", "charBuilderIdentityEditBtn", "npcSmallBtn builderEditRouteBtn");
  editBtn.type = "button";
  editBtn.textContent = "Edit in Builder";
  return panel;
}

function installBuilderAbilitiesDom(document) {
  const root = document.getElementById("page-character");
  let columns = document.getElementById("charColumns");
  if (!columns) columns = appendWithId(document, root, "div", "charColumns", "charColumns");
  let col = document.getElementById("charCol0");
  if (!col) col = appendWithId(document, columns, "div", "charCol0", "charCol");
  const basics = document.getElementById("charBasicsPanel") || appendWithId(document, col, "section", "charBasicsPanel", "panel");
  if (!document.getElementById("charName")) appendWithId(document, basics, "input", "charName");
  if (!document.getElementById("charClassLevel")) appendWithId(document, basics, "input", "charClassLevel");
  if (!document.getElementById("charRace")) appendWithId(document, basics, "input", "charRace");
  if (!document.getElementById("charBackground")) appendWithId(document, basics, "input", "charBackground");

  const panel = appendWithId(document, col, "section", "charBuilderAbilitiesPanel", "panel builderAbilitiesPanel");
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("aria-labelledby", "charBuilderAbilitiesTitle");
  appendWithId(document, panel, "h2", "charBuilderAbilitiesTitle").textContent = "Builder Abilities";
  const content = appendWithId(document, panel, "div", "charBuilderAbilitiesContent", "builderAbilitiesContent");
  appendWithId(document, content, "p", "charBuilderAbilitiesNote", "builderAbilitiesNote")
    .textContent = "Base ability scores are guarded build choices set with the builder wizard. Play-state adjustments stay quick-editable in Abilities & Skills below.";
  const grid = appendWithId(document, content, "div", "charBuilderAbilitiesGrid", "builderAbilitiesGrid builderAbilitiesReadonlyGrid");
  [
    ["Str", "Strength"],
    ["Dex", "Dexterity"],
    ["Con", "Constitution"],
    ["Int", "Intelligence"],
    ["Wis", "Wisdom"],
    ["Cha", "Charisma"],
  ].forEach(([suffix, label]) => {
    const field = appendWithId(document, grid, "div", `charBuilderAbility${suffix}Field`, "builderAbilitiesField");
    appendWithId(document, field, "span", `charBuilderAbility${suffix}Label`).textContent = label;
    const value = appendWithId(document, field, "span", `charBuilderAbility${suffix}Value`, "builderIdentityValue");
    value.setAttribute("aria-labelledby", `charBuilderAbility${suffix}Label`);
    value.textContent = "—";
  });
  const actions = appendWithId(document, content, "div", "charBuilderAbilitiesActions", "builderPanelActions");
  const editBtn = appendWithId(document, actions, "button", "charBuilderAbilitiesEditBtn", "npcSmallBtn builderEditRouteBtn");
  editBtn.type = "button";
  editBtn.textContent = "Edit in Builder";
  return panel;
}

function installBuilderWizardDom(document) {
  const overlay = appendWithId(document, document.body, "div", "builderWizardOverlay", "modalOverlay");
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  const panel = appendWithId(document, overlay, "div", "builderWizardPanel", "modalPanel builderWizardPanel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "builderWizardTitle");
  panel.setAttribute("tabindex", "-1");
  const header = appendWithId(document, panel, "div", "builderWizardHeader", "builderWizardHeader");
  appendWithId(document, header, "div", "builderWizardTitle", "modalTitle").textContent = "Create with Builder";
  appendWithId(document, header, "button", "builderWizardClose", "npcSmallBtn").type = "button";

  const body = appendWithId(document, panel, "div", "builderWizardBody", "builderWizardBody");
  const identity = appendWithId(document, body, "section", "builderWizardStepIdentity", "builderWizardStep");
  appendWithId(document, identity, "h3", "builderWizardIdentityTitle", "builderWizardStepTitle").textContent = "Identity";
  const identityGrid = appendWithId(document, identity, "div", "builderWizardGrid", "builderWizardGrid");
  appendWithId(document, identityGrid, "input", "builderWizardName");
  appendWithId(document, identityGrid, "select", "builderWizardRace");
  const subraceField = appendWithId(document, identityGrid, "label", "builderWizardSubraceField", "builderIdentityField");
  subraceField.hidden = true;
  appendWithId(document, subraceField, "select", "builderWizardSubrace");
  appendWithId(document, identityGrid, "select", "builderWizardClass");
  appendWithId(document, identityGrid, "select", "builderWizardBackground");
  appendWithId(document, identityGrid, "span", "builderWizardLevel", "builderWizardReadonlyValue").textContent = "Level 1";
  const identityValidation = appendWithId(document, identity, "div", "builderWizardIdentityValidation", "builderWizardValidation");
  identityValidation.hidden = true;
  identityValidation.setAttribute("role", "status");
  identityValidation.setAttribute("aria-live", "polite");

  const raceChoices = appendWithId(document, body, "section", "builderWizardStepRaceChoices", "builderWizardStep");
  raceChoices.hidden = true;
  appendWithId(document, raceChoices, "h3", "builderWizardRaceChoicesTitle", "builderWizardStepTitle").textContent = "Race & Background Choices";
  appendWithId(document, raceChoices, "div", "builderWizardOriginChoices", "builderWizardGrid");
  const raceChoicesValidation = appendWithId(document, raceChoices, "div", "builderWizardRaceChoicesValidation", "builderWizardValidation");
  raceChoicesValidation.hidden = true;
  raceChoicesValidation.setAttribute("role", "status");
  raceChoicesValidation.setAttribute("aria-live", "polite");

  const classesStep = appendWithId(document, body, "section", "builderWizardStepClasses", "builderWizardStep");
  classesStep.hidden = true;
  appendWithId(document, classesStep, "h3", "builderWizardClassesTitle", "builderWizardStepTitle").textContent = "Classes & Levels";
  appendWithId(document, classesStep, "div", "builderWizardClassesBody", "builderWizardDynamicBody");
  const classesValidation = appendWithId(document, classesStep, "div", "builderWizardClassesValidation", "builderWizardValidation");
  classesValidation.hidden = true;

  const classChoicesStep = appendWithId(document, body, "section", "builderWizardStepClassChoices", "builderWizardStep");
  classChoicesStep.hidden = true;
  appendWithId(document, classChoicesStep, "h3", "builderWizardClassChoicesTitle", "builderWizardStepTitle").textContent = "Class Choices";
  appendWithId(document, classChoicesStep, "div", "builderWizardClassChoicesBody", "builderWizardDynamicBody");

  const spellsStep = appendWithId(document, body, "section", "builderWizardStepSpells", "builderWizardStep");
  spellsStep.hidden = true;
  appendWithId(document, spellsStep, "h3", "builderWizardSpellsTitle", "builderWizardStepTitle").textContent = "Spells";
  appendWithId(document, spellsStep, "div", "builderWizardSpellsBody", "builderWizardDynamicBody");

  const equipmentStep = appendWithId(document, body, "section", "builderWizardStepEquipment", "builderWizardStep");
  equipmentStep.hidden = true;
  appendWithId(document, equipmentStep, "h3", "builderWizardEquipmentTitle", "builderWizardStepTitle").textContent = "Equipment";
  appendWithId(document, equipmentStep, "div", "builderWizardEquipmentBody", "builderWizardDynamicBody");

  const abilities = appendWithId(document, body, "section", "builderWizardStepAbilities", "builderWizardStep");
  abilities.hidden = true;
  appendWithId(document, abilities, "h3", "builderWizardAbilitiesTitle", "builderWizardStepTitle").textContent = "Ability Scores";
  const methodGroup = appendWithId(document, abilities, "fieldset", "builderWizardAbilityMethodGroup", "builderAbilityMethodGroup");
  appendWithId(document, methodGroup, "legend", "builderWizardAbilityMethodLegend").textContent = "Method";
  ["manual", "standard-array", "point-buy", "roll"].forEach((methodId) => {
    const input = appendWithId(document, methodGroup, "input", `builderWizardAbilityMethod-${methodId}`);
    input.type = "radio";
    input.setAttribute("name", "builderWizardAbilityMethod");
    input.setAttribute("value", methodId);
    if (methodId === "manual") {
      input.id = "builderWizardAbilityMethodManual";
      input.checked = true;
    }
  });
  appendWithId(document, abilities, "p", "builderWizardAbilityMethodNote", "builderAbilityMethodNote");
  const validation = appendWithId(document, abilities, "div", "builderWizardAbilityValidation", "builderAbilityValidation");
  validation.hidden = true;
  validation.setAttribute("role", "status");
  validation.setAttribute("aria-live", "polite");
  const abilityGrid = appendWithId(document, abilities, "div", "builderWizardManualAbilityGrid", "builderWizardAbilityGrid");
  ["Str", "Dex", "Con", "Int", "Wis", "Cha"].forEach((suffix) => {
    const input = appendWithId(document, abilityGrid, "input", `builderWizardAbility${suffix}`);
    input.type = "number";
  });
  const standardArrayGrid = appendWithId(document, abilities, "div", "builderWizardStandardArrayGrid", "builderWizardAbilityGrid builderStandardArrayGrid");
  standardArrayGrid.hidden = true;
  ["Str", "Dex", "Con", "Int", "Wis", "Cha"].forEach((suffix) => {
    appendWithId(document, standardArrayGrid, "select", `builderWizardStandardArray${suffix}`);
  });
  const pointBuyGrid = appendWithId(document, abilities, "div", "builderWizardPointBuyGrid", "builderPointBuySection");
  pointBuyGrid.hidden = true;
  appendWithId(document, pointBuyGrid, "strong", "builderWizardPointBuyRemaining").textContent = "27";
  ["Str", "Dex", "Con", "Int", "Wis", "Cha"].forEach((suffix) => {
    const key = suffix.toLowerCase();
    const field = appendWithId(document, pointBuyGrid, "div", `builderWizardPointBuy${suffix}Field`, "builderPointBuyField");
    const decrease = appendWithId(document, field, "button", `builderWizardPointBuy${suffix}Decrease`);
    decrease.type = "button";
    decrease.dataset.pointBuyAbility = key;
    decrease.dataset.pointBuyAction = "decrease";
    decrease.setAttribute("aria-label", `Decrease ${suffix}`);
    appendWithId(document, field, "strong", `builderWizardPointBuy${suffix}Value`).textContent = "8";
    const increase = appendWithId(document, field, "button", `builderWizardPointBuy${suffix}Increase`);
    increase.type = "button";
    increase.dataset.pointBuyAbility = key;
    increase.dataset.pointBuyAction = "increase";
    increase.setAttribute("aria-label", `Increase ${suffix}`);
  });
  const rollSection = appendWithId(document, abilities, "div", "builderWizardRollSection", "builderRollSection");
  rollSection.hidden = true;
  const rollMode = appendWithId(document, rollSection, "select", "builderWizardRollMode");
  ["4d6-drop-lowest", "3d6-straight"].forEach((mode) => {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = mode === "3d6-straight" ? "3d6 straight" : "4d6 drop lowest";
    rollMode.appendChild(option);
  });
  appendWithId(document, rollSection, "button", "builderWizardRollButton").type = "button";
  appendWithId(document, rollSection, "div", "builderWizardRollPool", "builderRollPool");
  const rollAssignmentGrid = appendWithId(document, rollSection, "div", "builderWizardRollAssignmentGrid", "builderWizardAbilityGrid builderRollAssignmentGrid");
  rollAssignmentGrid.hidden = true;
  ["Str", "Dex", "Con", "Int", "Wis", "Cha"].forEach((suffix) => {
    appendWithId(document, rollAssignmentGrid, "select", `builderWizardRoll${suffix}`);
  });

  const summary = appendWithId(document, body, "section", "builderWizardStepSummary", "builderWizardStep");
  summary.hidden = true;
  appendWithId(document, summary, "h3", "builderWizardSummaryTitle", "builderWizardStepTitle").textContent = "Summary";
  const summaryContent = appendWithId(document, summary, "div", "builderWizardSummary", "builderSummaryContent");
  const summaryNameField = document.createElement("label");
  summaryNameField.className = "builderSummaryNameField";
  summaryNameField.setAttribute("for", "builderWizardSummaryName");
  const summaryNameLabel = document.createElement("span");
  summaryNameLabel.textContent = "Character Name";
  summaryNameField.appendChild(summaryNameLabel);
  appendWithId(document, summaryNameField, "input", "builderWizardSummaryName", "settingsInput");
  summaryContent.appendChild(summaryNameField);

  const footer = appendWithId(document, panel, "div", "builderWizardFooter", "builderWizardFooter");
  appendWithId(document, footer, "button", "builderWizardCancel", "npcSmallBtn").type = "button";
  const back = appendWithId(document, footer, "button", "builderWizardBack", "npcSmallBtn");
  back.type = "button";
  back.hidden = true;
  appendWithId(document, footer, "button", "builderWizardNext", "npcSmallBtn").type = "button";
  const finish = appendWithId(document, footer, "button", "builderWizardFinish", "npcSmallBtn");
  finish.type = "button";
  finish.hidden = true;
  return overlay;
}

function installLevelUpWizardDom(document) {
  const overlay = appendWithId(document, document.body, "div", "levelUpOverlay", "modalOverlay");
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  const panel = appendWithId(document, overlay, "div", "levelUpPanel", "modalPanel builderWizardPanel levelUpPanel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "levelUpTitle");
  panel.setAttribute("tabindex", "-1");
  const header = appendWithId(document, panel, "div", "levelUpHeader", "builderWizardHeader");
  appendWithId(document, header, "div", "levelUpTitle", "modalTitle").textContent = "Level Up";
  appendWithId(document, header, "button", "levelUpClose", "npcSmallBtn").type = "button";

  const body = appendWithId(document, panel, "div", "levelUpBody", "builderWizardBody levelUpBody");
  const steps = [
    ["levelUpStepClass", "levelUpClassBody", "levelUpClassValidation"],
    ["levelUpStepSubclass", "levelUpSubclassBody", "levelUpSubclassValidation"],
    ["levelUpStepFeatures", "levelUpFeaturesBody", null],
    ["levelUpStepAsi", "levelUpAsiBody", null],
    ["levelUpStepSpells", "levelUpSpellsBody", "levelUpSpellsValidation"],
    ["levelUpStepHp", "levelUpHpBody", "levelUpHpValidation"],
    ["levelUpStepSummary", "levelUpSummaryBody", null],
  ];
  steps.forEach(([stepId, bodyId, validationId], index) => {
    const step = appendWithId(document, body, "section", stepId, "builderWizardStep");
    step.hidden = index !== 0;
    appendWithId(document, step, "div", bodyId, "builderWizardDynamicBody");
    if (validationId) {
      const validation = appendWithId(document, step, "div", validationId, "builderWizardValidation");
      validation.hidden = true;
    }
  });

  const footer = appendWithId(document, panel, "div", "levelUpFooter", "builderWizardFooter");
  appendWithId(document, footer, "button", "levelUpCancel", "npcSmallBtn").type = "button";
  const back = appendWithId(document, footer, "button", "levelUpBack", "npcSmallBtn");
  back.type = "button";
  back.hidden = true;
  appendWithId(document, footer, "button", "levelUpNext", "npcSmallBtn").type = "button";
  const apply = appendWithId(document, footer, "button", "levelUpApply", "npcSmallBtn");
  apply.type = "button";
  apply.hidden = true;
  return overlay;
}

/** Mirrors the #restoreCharacterOverlay markup in index.html (Restore Character R3). */
function installRestoreCharacterDialogDom(document) {
  const overlay = appendWithId(document, document.body, "div", "restoreCharacterOverlay", "modalOverlay");
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  const panel = appendWithId(document, overlay, "div", "restoreCharacterPanel", "modalPanel restoreCharacterPanel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "restoreCharacterTitle");
  panel.setAttribute("tabindex", "-1");

  const header = appendWithId(document, panel, "div", "restoreCharacterHeader", "restoreCharacterHeader");
  appendWithId(document, header, "div", "restoreCharacterTitle", "modalTitle").textContent = "Restore Character";
  const closeBtn = appendWithId(document, header, "button", "restoreCharacterClose", "npcSmallBtn");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";

  const body = appendWithId(document, panel, "div", "restoreCharacterBody", "restoreCharacterBody");
  appendWithId(document, body, "p", "restoreCharacterIntro", "restoreCharacterIntro").textContent =
    "Restore a saved pre-Level-Up snapshot as a separate playable character.";
  const empty = appendWithId(document, body, "div", "restoreCharacterEmpty", "restoreCharacterEmpty");
  empty.hidden = true;
  empty.textContent = "No snapshots yet.";
  appendWithId(document, body, "div", "restoreCharacterList", "restoreCharacterList");
  const pending = appendWithId(document, body, "div", "restoreCharacterPending", "restoreCharacterPending");
  pending.hidden = true;
  pending.setAttribute("role", "alert");
  pending.setAttribute("aria-live", "assertive");
  appendWithId(document, pending, "p", "restoreCharacterPendingMsg", "restoreCharacterPendingMsg");

  const footer = appendWithId(document, panel, "div", "restoreCharacterFooter", "restoreCharacterFooter");
  const retryBtn = appendWithId(document, footer, "button", "restoreCharacterRetrySave", "npcSmallBtn restoreCharacterRetrySaveBtn");
  retryBtn.type = "button";
  retryBtn.hidden = true;
  retryBtn.textContent = "Retry Save";
  const cancelBtn = appendWithId(document, footer, "button", "restoreCharacterCancel", "npcSmallBtn");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Close";
  return overlay;
}

function makeLeveledBuilderCharacter({
  id = "char_levelup",
  name = "Level Up Mira",
  levels = [{ classId: "fighter", hp: null }],
  base = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  subclassByClass = {},
  flatFields = {}
} = {}) {
  const build = makeDefaultCharacterBuild();
  build.raceId = "human";
  build.backgroundId = "acolyte";
  build.levels = levels;
  build.subclassByClass = subclassByClass;
  build.abilities.base = { ...base };
  return { id, name, ...flatFields, build };
}

function clickLevelUp(document, elementId) {
  document.getElementById(elementId).dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
}

function clickEl(el) {
  el.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
}

function openLevelUp(actionMenuButton) {
  clickEl(actionMenuButton);
  clickLevelUp(document, "charActionLevelUpBtn");
}

// Unlike the rest of this suite (stub SaveManager), this harness wires the
// character page to the REAL persistence pipeline — createSaveManager →
// saveAllLocal → campaign vault → a stubbed localStorage — so a forced
// vault-write failure exercises the exact production path. It also installs
// the Level Up and Restore Character dialog DOM and supplies the canonical
// migration boundary + text seam the Restore Character engine needs, so
// Restore (R3) and Level Up (R1) failure lifecycles share one production
// shape (restore-character-spec.md §4.1–§4.3).
//
// `options.migrateStateImpl` replaces only the engine-facing `deps.migrateState`
// (the vault's own migrateState stays the real import), which makes engine
// invocations directly countable at the injection boundary.
function setupCharacterPageWithRealPersistence(character, options = {}) {
  const { snapshots = null, migrateStateImpl = migrateState } = options;
  const TEST_VAULT_KEY = "test_localCampaignTracker_v1";
  const dom = installCharacterSelectorDom();
  installLevelUpWizardDom(dom.document);
  installRestoreCharacterDialogDom(dom.document);
  const Popovers = createFakePopovers();
  const deps = createCharacterPageDeps(Popovers);
  deps.state.characters.entries = [character];
  deps.state.characters.activeId = character.id;
  if (snapshots) deps.state.characters.snapshots = snapshots;
  // Restore Character engine deps (app.js supplies these in production).
  deps.migrateState = migrateStateImpl;
  deps.deleteText = vi.fn();

  // localStorage stand-in with a switchable quota-style write failure.
  const stored = new Map();
  const storage = {
    failWrites: false,
    getItem: (key) => (stored.has(key) ? stored.get(key) : null),
    setItem(key, value) {
      if (this.failWrites) throw new Error("QuotaExceededError (forced by test)");
      stored.set(key, String(value));
    },
    removeItem: (key) => { stored.delete(key); }
  };
  vi.stubGlobal("localStorage", storage);

  const vaultRuntime = { current: null };
  const saveStatus = vi.fn();
  const showSaveBanner = vi.fn();
  const hideSaveBanner = vi.fn();
  const SaveManager = createSaveManager({
    saveAll: () => saveAllLocal({
      storageKey: TEST_VAULT_KEY,
      state: deps.state,
      migrateState,
      sanitizeForSave,
      vaultRuntime
    }),
    setStatus: saveStatus,
    showSaveBanner,
    hideSaveBanner,
    // Saves are driven deterministically through SaveManager.flush(); the
    // large debounce keeps the queued timer from racing the assertions.
    debounceMs: 60_000
  });
  SaveManager.init();
  deps.SaveManager = SaveManager;

  const controller = initCharacterPageUI(deps);

  const readPersistedRaw = () => storage.getItem(TEST_VAULT_KEY);
  const readPersistedDoc = () => {
    const vault = JSON.parse(readPersistedRaw());
    return vault.campaignDocs[vault.appShell.activeCampaignId];
  };
  const projectPersistedState = () => {
    const { vault } = normalizeCampaignVault(
      JSON.parse(readPersistedRaw()),
      { migrateState, sanitizeForSave }
    );
    return projectActiveCampaignState(vault, migrateState);
  };

  return {
    ...dom,
    deps,
    controller,
    storage,
    vaultRuntime,
    SaveManager,
    saveStatus,
    showSaveBanner,
    hideSaveBanner,
    readPersistedRaw,
    readPersistedDoc,
    projectPersistedState
  };
}

function installFlatAbilitiesDom(document) {
  const root = document.getElementById("page-character");
  let columns = document.getElementById("charColumns");
  if (!columns) columns = appendWithId(document, root, "div", "charColumns", "charColumns");
  let col = document.getElementById("charCol0");
  if (!col) col = appendWithId(document, columns, "div", "charCol0", "charCol");
  const panel = appendWithId(document, col, "section", "charAbilitiesPanel", "panel");
  const grid = appendWithId(document, panel, "div", "charAbilitiesGrid", "abilityGrid");
  ["str", "dex", "con", "int", "wis", "cha"].forEach((key) => {
    const block = appendWithId(document, grid, "div", `flatAbility-${key}`, "abilityBlock");
    block.dataset.ability = key;
    const score = appendWithId(document, block, "input", `flatAbilityScore-${key}`, "abilityScore");
    score.type = "number";
    score.dataset.stat = "score";
    const skill = appendWithId(document, block, "input", `flatSkill-${key}`);
    skill.type = "checkbox";
    skill.dataset.skillProf = key === "str" ? "athletics" : `${key}-skill`;
  });
  return panel;
}

function getSelectOptions(select) {
  return Array.from(select.children).map((option) => ({
    value: option.value,
    label: option.textContent
  }));
}

function getSelectOptionValues(select) {
  return getSelectOptions(select).map((option) => option.value);
}

function getEnhancedDropdownValues(select) {
  const menu = select.nextElementSibling?.querySelector(".dropdownMenu");
  return Array.from(menu?.querySelectorAll("button") || [])
    .map((button) => button.dataset.value);
}

function dispatchChange(el) {
  el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
}

function clickBuilderWizardNext() {
  document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
}

/**
 * Clicks Next until the given step section is visible, filling the required
 * Draconic Ancestry choice when passing through Race & Background Choices.
 */
function advanceBuilderWizardToStep(stepElementId, { ancestryId = "" } = {}) {
  for (let i = 0; i < 10; i += 1) {
    if (!document.getElementById(stepElementId).hidden) return true;
    const raceChoicesStep = document.getElementById("builderWizardStepRaceChoices");
    if (raceChoicesStep && !raceChoicesStep.hidden) {
      const ancestrySelect = document.getElementById("builderWizardDraconicAncestry");
      if (ancestrySelect && ancestryId && ancestrySelect.value !== ancestryId) {
        ancestrySelect.value = ancestryId;
        dispatchChange(ancestrySelect);
      }
    }
    clickBuilderWizardNext();
  }
  return !document.getElementById(stepElementId).hidden;
}

async function finishBuilderWizardWith({
  name = "Mira",
  raceId = "human",
  classId = "fighter",
  backgroundId = "acolyte",
  ancestryId = "",
  abilities = { Str: 15, Dex: 14, Con: 13, Int: 12, Wis: 10, Cha: 8 }
} = {}) {
  document.getElementById("builderWizardName").value = name;
  document.getElementById("builderWizardRace").value = raceId;
  document.getElementById("builderWizardClass").value = classId;
  document.getElementById("builderWizardBackground").value = backgroundId;
  advanceBuilderWizardToStep("builderWizardStepAbilities", { ancestryId });
  Object.entries(abilities).forEach(([suffix, value]) => {
    document.getElementById(`builderWizardAbility${suffix}`).value = String(value);
  });
  advanceBuilderWizardToStep("builderWizardStepSummary", { ancestryId });
  document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
  await flushPromises();
}

function completeBuilderIdentity({
  name = "Builder Mira",
  raceId = "human",
  classId = "fighter",
  backgroundId = "acolyte"
} = {}) {
  document.getElementById("builderWizardName").value = name;
  document.getElementById("builderWizardRace").value = raceId;
  document.getElementById("builderWizardClass").value = classId;
  document.getElementById("builderWizardBackground").value = backgroundId;
}

function openBuilderWizardToAbilities(actionMenuButton) {
  actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
  document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
  completeBuilderIdentity();
  advanceBuilderWizardToStep("builderWizardStepAbilities");
}

function chooseBuilderAbilityMethod(methodId) {
  const manualRadio = document.getElementById("builderWizardAbilityMethodManual");
  const targetRadio = methodId === "manual"
    ? manualRadio
    : document.getElementById(`builderWizardAbilityMethod-${methodId}`);
  manualRadio.checked = methodId === "manual";
  targetRadio.checked = true;
  targetRadio.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
  targetRadio.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
}

function assignStandardArrayScores(scoresBySuffix) {
  Object.entries(scoresBySuffix).forEach(([suffix, score]) => {
    const select = document.getElementById(`builderWizardStandardArray${suffix}`);
    select.value = String(score);
    select.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  });
}

function clickPointBuy(suffix, action, times = 1) {
  const id = `builderWizardPointBuy${suffix}${action === "increase" ? "Increase" : "Decrease"}`;
  const button = document.getElementById(id);
  for (let i = 0; i < times; i += 1) {
    button.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
  }
}

function getPointBuyScore(suffix) {
  return document.getElementById(`builderWizardPointBuy${suffix}Value`).textContent;
}

function getRollSelect(suffix) {
  return document.getElementById(`builderWizardRoll${suffix}`);
}

function clickRollScores() {
  document.getElementById("builderWizardRollButton").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
}

function assignRollScoresByIndex(suffixes = ["Str", "Dex", "Con", "Int", "Wis", "Cha"]) {
  suffixes.forEach((suffix) => {
    const select = getRollSelect(suffix);
    const option = select.children[1];
    select.value = option?.value || "";
    select.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  });
}

function mockDiceRolls(values) {
  let index = 0;
  return vi.spyOn(Math, "random").mockImplementation(() => {
    const next = values[index];
    index += 1;
    return ((next ?? 1) - 1) / 6;
  });
}

function createFakePopovers() {
  const handles = [];
  const setOpen = (reg, open) => {
    reg.menu.hidden = !open;
    reg.menu.setAttribute("aria-hidden", open ? "false" : "true");
    reg.button.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) reg.onOpen?.();
    else reg.onClose?.();
  };
  const api = {
    handles,
    register(args) {
      const reg = {
        button: args.button,
        menu: args.menu,
        preferRight: !!args.preferRight,
        closeOnOutside: args.closeOnOutside !== false,
        closeOnEsc: args.closeOnEsc !== false,
        stopInsideClick: args.stopInsideClick !== false,
        onOpen: args.onOpen || null,
        onClose: args.onClose || null,
      };
      const handle = {
        reg,
        reposition: vi.fn(),
        close: () => setOpen(reg, false),
        open: () => setOpen(reg, true),
        toggle: () => setOpen(reg, reg.menu.hidden),
        destroy: vi.fn(() => setOpen(reg, false)),
      };
      handles.push(handle);
      if (args.wireButton !== false) {
        args.button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          handle.toggle();
        });
      }
      return handle;
    },
    open(reg) { setOpen(reg, true); },
    close(reg) { setOpen(reg, false); },
    toggle(reg) { setOpen(reg, reg.menu.hidden); },
  };
  return api;
}

function createCharacterPageDeps(Popovers) {
  return {
    state: {
      appShell: { activeCampaignId: "campaign_alpha" },
      characters: {
        activeId: "char_a",
        entries: [
          { id: "char_a", name: "Ada", classLevel: "Wizard 5", hpCur: 7, hpMax: 20, ac: 15, status: "Poisoned", imgBlobId: "blob_ada" },
          { id: "char_b", name: "Bram" },
        ],
      },
      tracker: {
        npcs: [],
        party: [],
        locationsList: [],
        npcActiveSectionId: "npc_main",
        partyActiveSectionId: "party_main"
      },
      combat: { workspace: {} },
    },
    SaveManager: { markDirty: vi.fn() },
    Popovers,
    setStatus: vi.fn(),
    uiPrompt: vi.fn(),
    uiAlert: vi.fn(),
    uiConfirm: vi.fn(),
    getBlob: vi.fn(),
    deleteBlob: vi.fn(),
    putBlob: vi.fn(),
    dataUrlToBlob: vi.fn(),
    getText: vi.fn(),
    putText: vi.fn(),
  };
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function findImportInput(document) {
  return document.body.children.find((el) => el.tagName === "INPUT" && el.type === "file") || null;
}

function makeImportObject(name = "Mira") {
  return {
    formatVersion: 1,
    type: "lore-ledger-character",
    character: { id: "char_source", name },
    portrait: null,
    spellNotes: {}
  };
}

function makeBuilderCharacter({
  id = "char_builder",
  name = "Builder",
  classId = "fighter",
  raceId = "elf",
  backgroundId = "acolyte",
  level = 5,
  abilities = { str: 16, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  flatFields = {}
} = {}) {
  return {
    id,
    name,
    classLevel: "Persisted Class",
    race: "Persisted Race",
    background: "Persisted Background",
    proficiency: 99,
    abilities: {
      str: { score: 3, mod: -4, save: -4 },
      dex: { score: 3, mod: -4, save: -4 },
      con: { score: 3, mod: -4, save: -4 },
      int: { score: 3, mod: -4, save: -4 },
      wis: { score: 3, mod: -4, save: -4 },
      cha: { score: 3, mod: -4, save: -4 },
    },
    ...flatFields,
    build: {
      ...makeDefaultCharacterBuild(),
      classId,
      raceId,
      backgroundId,
      level,
      abilities: { base: abilities }
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("character page selector", () => {
  it("uses shared app select classes for the Character selector", () => {
    expect(CHARACTER_SELECTOR_SELECT_CLASSES.split(" "))
      .toEqual(expect.arrayContaining(["charSelectorSelect", "panelSelect"]));
    expect(CHARACTER_SELECTOR_BUTTON_CLASSES.split(" "))
      .toEqual(expect.arrayContaining(["panelSelectBtn", "charSelectorSelectBtn"]));
    expect(CHARACTER_ACTION_BUTTON_CLASSES.split(" "))
      .toEqual(expect.arrayContaining(["panelBtnSm", "charActionMenuBtn"]));
    expect(CHARACTER_ACTION_ITEM_CLASSES.split(" "))
      .toEqual(expect.arrayContaining(["swatchOption", "charActionMenuItem"]));

    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toContain('id="charSelector" class="charSelectorSelect panelSelect"');
    expect(html).toContain('class="charBuilderModeBadge" id="charBuilderModeBadge"');
    expect(html).toContain('class="panel builderIdentityPanel" id="charBuilderIdentityPanel" hidden aria-hidden="true"');
    // B1: builder panels are read-only routing surfaces — no structural edit
    // controls on the sheet.
    expect(html).not.toContain("charBuilderRaceSelect");
    expect(html).not.toContain("charBuilderClassSelect");
    expect(html).not.toContain("charBuilderBackgroundSelect");
    expect(html).not.toContain("charBuilderLevelInput");
    expect(html).toContain('id="charBuilderRaceValue" aria-labelledby="charBuilderRaceLabel"');
    expect(html).toContain('id="charBuilderClassValue" aria-labelledby="charBuilderClassLabel"');
    expect(html).toContain('id="charBuilderBackgroundValue" aria-labelledby="charBuilderBackgroundLabel"');
    expect(html).toContain('id="charBuilderLevelValue" aria-labelledby="charBuilderLevelLabel"');
    expect(html).toContain("Race, class, background, and level are guarded build choices. Edit them with the builder wizard.");
    expect(html).toContain('id="charBuilderIdentityEditBtn"');
    expect(html).toContain('class="panel builderAbilitiesPanel" id="charBuilderAbilitiesPanel" hidden aria-hidden="true"');
    expect(html).toContain("Builder Abilities");
    expect(html).toContain("Base ability scores are guarded build choices set with the builder wizard.");
    expect(html).toContain('id="charBuilderAbilitiesEditBtn"');
    [
      ["Str", "Strength"],
      ["Dex", "Dexterity"],
      ["Con", "Constitution"],
      ["Int", "Intelligence"],
      ["Wis", "Wisdom"],
      ["Cha", "Charisma"],
    ].forEach(([suffix, label]) => {
      expect(html).toContain(`id="charBuilderAbility${suffix}Label">${label}</span>`);
      expect(html).toContain(`id="charBuilderAbility${suffix}Value" aria-labelledby="charBuilderAbility${suffix}Label"`);
    });
    expect(html.indexOf('id="charBuilderIdentityPanel"')).toBeLessThan(html.indexOf('id="charBuilderAbilitiesPanel"'));
    expect(html.indexOf('id="charBuilderAbilitiesPanel"')).toBeLessThan(html.indexOf('id="charBuilderSummaryPanel"'));
    expect(readFileSync(resolve(process.cwd(), "js/pages/character/panels/builderAbilitiesPanel.js"), "utf8"))
      .not.toContain("materializeDerivedCharacterFields");
    expect(html).toContain('class="panelBtnSm charActionMenuBtn" id="charActionMenuBtn"');
    expect(html).toContain('class="dropdownMenu charActionDropdownMenu" id="charActionDropdownMenu"');
    expect(html).not.toContain("charActionSelect");
    expect(html).not.toContain(">Character Actions<");

    const menuHtml = html.match(/id="charActionDropdownMenu"[\s\S]*?<\/div>/)?.[0] || "";
    const actions = Array.from(menuHtml.matchAll(/data-char-action="([^"]+)">([^<]+)<\/button>/g))
      .map((match) => ({ action: match[1], label: match[2] }));
    expect(actions).toEqual([
      { action: "new", label: "New Character" },
      { action: "new-builder", label: "Create with Builder" },
      { action: "edit-builder", label: "Edit in Builder" },
      { action: "level-up", label: "Level Up" },
      // Restore Character (R3) sits directly after Level Up (spec §7).
      { action: "restore-character", label: "Restore Character" },
      { action: "rename", label: "Rename Character" },
      { action: "add-npc", label: "Add to NPCs" },
      { action: "add-party", label: "Add to Party" },
      { action: "export", label: "Export Character" },
      { action: "import", label: "Import Character" },
      { action: "delete", label: "Delete Character" },
    ]);
    // Restore Character is immediately after Level Up.
    const levelUpIndex = actions.findIndex((a) => a.action === "level-up");
    expect(actions[levelUpIndex + 1]).toEqual({ action: "restore-character", label: "Restore Character" });
  });

  it("dispatches the app-level active character change event", () => {
    const calls = [];
    const target = new EventTarget();
    target.addEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, (event) => {
      calls.push(/** @type {CustomEvent} */(event).detail);
    });
    vi.stubGlobal("window", target);

    notifyActiveCharacterChanged({ previousId: "char_a", activeId: "char_b" });

    expect(calls).toEqual([{ previousId: "char_a", activeId: "char_b" }]);
    vi.unstubAllGlobals();
  });

  it("initializes the enhanced Character selector closed", () => {
    const { document, selector } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();

    const controller = initCharacterPageUI(createCharacterPageDeps(Popovers));

    const wrap = selector.nextElementSibling;
    const button = wrap?.querySelector(".charSelectorSelectBtn");
    const menu = wrap?.querySelector(".dropdownMenu");

    expect(wrap?.classList.contains("selectDropdown")).toBe(true);
    expect(selector.classList.contains("nativeSelectHidden")).toBe(true);
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(menu?.hidden).toBe(true);
    expect(menu?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelectorAll(".dropdownMenu").filter((el) => !el.hidden)).toHaveLength(0);
    expect(Popovers.handles[0].reposition).not.toHaveBeenCalled();

    button.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(Popovers.handles[0].reposition).toHaveBeenCalledTimes(1);

    controller.destroy();
  });

  it("does not preserve stale enhanced selector open state across Character page rerender", () => {
    const { document, selector } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const firstController = initCharacterPageUI(deps);
    const firstWrap = selector.nextElementSibling;
    const firstButton = firstWrap.querySelector(".charSelectorSelectBtn");
    const firstMenu = firstWrap.querySelector(".dropdownMenu");

    firstButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    expect(firstMenu.hidden).toBe(false);

    const secondController = initCharacterPageUI(deps);
    const secondWrap = selector.nextElementSibling;
    const secondButton = secondWrap.querySelector(".charSelectorSelectBtn");
    const secondMenu = secondWrap.querySelector(".dropdownMenu");

    expect(firstWrap.isConnected).toBe(false);
    expect(document.querySelectorAll(".selectDropdown")).toHaveLength(1);
    expect(document.querySelectorAll(".dropdownMenu").filter((el) => !el.hidden)).toHaveLength(0);
    expect(secondMenu.hidden).toBe(true);
    expect(secondMenu.getAttribute("aria-hidden")).toBe("true");
    expect(secondButton.getAttribute("aria-expanded")).toBe("false");
    expect(Popovers.handles[0].destroy).toHaveBeenCalledTimes(1);

    firstController.destroy();
    secondController.destroy();
  });

  // Ownership pin for the Abilities & Skills panel. That panel renders
  // #saveOptionsBtn / #saveOptionsMenu / #miscSave_*, and the combat
  // workspace's embedded copy renders the same ids. #page-combat precedes
  // #page-character in the DOM, so an unscoped character controller resolves
  // the combat copy on rerender: the character ⋯ button goes dead and the
  // combat menu collects duplicate injected groups (including the base
  // ability-score editor). The controller must hand the panel the real
  // #page-character element as its root — never the document fallback.
  it("binds the Abilities panel to the #page-character root, on init and on rerender", () => {
    const { document } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const pageRoot = document.getElementById("page-character");
    expect(pageRoot).toBeTruthy();

    abilitiesPanelInitSpy.mockClear();

    const firstController = initCharacterPageUI(deps);
    expect(abilitiesPanelInitSpy).toHaveBeenCalledTimes(1);
    expect(abilitiesPanelInitSpy.mock.calls[0][0].root).toBe(pageRoot);

    // The character-switch path destroys and rebuilds the controller; the
    // rebuilt panel must not regress to the document-wide lookup.
    const secondController = initCharacterPageUI(deps);
    expect(abilitiesPanelInitSpy).toHaveBeenCalledTimes(2);
    expect(abilitiesPanelInitSpy.mock.calls[1][0].root).toBe(pageRoot);

    firstController.destroy();
    secondController.destroy();
  });

  it("stays interactive when a boot step throws during (re)render", () => {
    // Reported failure: switching characters left the whole page unresponsive
    // to clicks with stale panels until a full reload. Root failure mode: a
    // re-render destroys the previous controller first, then rebuilds; if any
    // rebuild step (or a cleanup) throws, the page is left with no listeners
    // and no rebuilt panels. Simulate a boot-time failure in the selector bar
    // (here: the action-menu popover registration throws) and assert the page
    // still comes up — panels still bind and a later re-render still works.
    const { document, selector } = installCharacterSelectorDom();
    const base = createFakePopovers();
    let injectFault = true;
    const Popovers = {
      handles: base.handles,
      register(args) {
        if (injectFault && args?.button?.id === "charActionMenuBtn") {
          throw new Error("boom: action menu registration failed");
        }
        return base.register(args);
      },
      open: base.open,
      close: base.close,
      toggle: base.toggle
    };
    const deps = createCharacterPageDeps(Popovers);

    // Before the hardening this threw out of initCharacterPageUI (page bricked).
    let controller;
    expect(() => { controller = initCharacterPageUI(deps); }).not.toThrow();
    expect(controller).toBeTruthy();

    // The failure is surfaced, not silently swallowed.
    expect(deps.setStatus).toHaveBeenCalled();

    // Execution continued past the failing step: the enhanced character
    // selector still built (proving the boot sequence did not abort).
    const wrap = selector.nextElementSibling;
    expect(wrap?.classList.contains("selectDropdown")).toBe(true);

    // A subsequent re-render (the destroy-then-rebuild character-switch path)
    // also survives and rebuilds cleanly once the fault clears.
    injectFault = false;
    let controller2;
    expect(() => { controller2 = initCharacterPageUI(deps); }).not.toThrow();
    expect(controller2).toBeTruthy();
    expect(document.querySelectorAll(".selectDropdown")).toHaveLength(1);

    controller2.destroy();
  });

  it("initializes the Character action overflow menu closed", () => {
    const { document, actionMenuButton, actionMenuDropdown } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();

    const controller = initCharacterPageUI(createCharacterPageDeps(Popovers));
    const actionItems = actionMenuDropdown.querySelectorAll(".charActionMenuItem");

    expect(document.getElementById("charActionSelect")).toBeNull();
    expect(actionMenuButton.textContent).toBe("...");
    expect(actionMenuButton.getAttribute("aria-expanded")).toBe("false");
    expect(actionMenuDropdown.hidden).toBe(true);
    expect(actionMenuDropdown.getAttribute("aria-hidden")).toBe("true");
    expect(actionItems.map((button) => button.textContent)).toEqual([
      "New Character",
      "Create with Builder",
      "Edit in Builder",
      "Level Up",
      "Restore Character",
      "Rename Character",
      "Add to NPCs",
      "Add to Party",
      "Export Character",
      "Import Character",
      "Delete Character",
    ]);
    expect(actionMenuDropdown.textContent).not.toContain("Character Actions");
    expect(document.querySelectorAll(".dropdownMenu").filter((el) => !el.hidden)).toHaveLength(0);
    expect(Popovers.handles[1].reposition).not.toHaveBeenCalled();

    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    expect(actionMenuDropdown.hidden).toBe(false);
    expect(actionMenuButton.getAttribute("aria-expanded")).toBe("true");
    expect(Popovers.handles[1].reposition).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.getElementById("charActionNewBtn"));

    controller.destroy();
  });

  it("creates linked NPC and Party cards from the action overflow menu", async () => {
    const { actionMenuButton } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionAddNpcBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionAddPartyBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(deps.state.tracker.npcs).toHaveLength(1);
    expect(deps.state.tracker.party).toHaveLength(1);
    expect(deps.state.tracker.npcs[0]).toMatchObject({
      characterId: "char_a",
      sectionId: "npc_main",
      name: "Ada",
      className: "Wizard 5",
      hpCurrent: 7,
      hpMax: 20,
      ac: 15,
      status: "Poisoned",
      imgBlobId: "blob_ada"
    });
    expect(deps.state.tracker.party[0]).toMatchObject({
      characterId: "char_a",
      sectionId: "party_main",
      name: "Ada",
      className: "Wizard 5",
      hpCurrent: 7,
      hpMax: 20,
      ac: 15,
      status: "Poisoned",
      imgBlobId: "blob_ada"
    });
    expect(deps.setStatus).toHaveBeenCalledWith("Added to NPCs", { stickyMs: 2000 });
    expect(deps.setStatus).toHaveBeenCalledWith("Added to Party", { stickyMs: 2000 });
    expect(deps.state.characters.activeId).toBe("char_a");

    controller.destroy();
  });

  it("disables active-character actions when there is no active character", async () => {
    installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters = { activeId: null, entries: [] };

    const controller = initCharacterPageUI(deps);

    expect(document.getElementById("charShortRestBtn").disabled).toBe(true);
    expect(document.getElementById("charLongRestBtn").disabled).toBe(true);
    expect(document.getElementById("charActionAddNpcBtn").disabled).toBe(true);
    expect(document.getElementById("charActionAddPartyBtn").disabled).toBe(true);
    expect(document.getElementById("charActionExportBtn").disabled).toBe(true);

    document.getElementById("charActionExportBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(exportActiveCharacter).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("applies rest recovery only to the active character", async () => {
    installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0].resources = [
      { id: "active_short", name: "Active Short", cur: 1, max: 3, recovery: "shortRest" },
      { id: "active_long", name: "Active Long", cur: 1, max: 3, recovery: "longRest" },
      { id: "active_manual", name: "Active Manual", cur: 1, max: 3, recovery: "manual" },
    ];
    deps.state.characters.entries[1].resources = [
      { id: "inactive_short", name: "Inactive Short", cur: 1, max: 3, recovery: "shortRest" },
    ];

    const controller = initCharacterPageUI(deps);
    document.getElementById("charShortRestBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(deps.state.characters.entries[0].resources.map((resource) => resource.cur)).toEqual([3, 1, 1]);
    expect(deps.state.characters.entries[1].resources[0].cur).toBe(1);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(deps.setStatus).toHaveBeenCalledWith("Short rest applied.", { stickyMs: 2000 });

    controller.destroy();
  });

  it("applies rest recovery to active manual feature limited-use counters through the character toolbar", async () => {
    installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0].manualFeatureCards = [{
      id: "feature_second_wind",
      name: "Second Wind",
      sourceType: "Class Feature",
      activation: "Bonus Action",
      rangeArea: "",
      saveDc: "",
      damageEffect: "",
      description: "",
      limitedUse: { enabled: true, label: "Second Wind", current: 0, max: 1, recovery: "shortRest" }
    }];
    deps.state.characters.entries[1].manualFeatureCards = [{
      id: "feature_inactive",
      name: "Inactive Feature",
      sourceType: "",
      activation: "",
      rangeArea: "",
      saveDc: "",
      damageEffect: "",
      description: "",
      limitedUse: { enabled: true, label: "", current: 0, max: 1, recovery: "shortRest" }
    }];

    const controller = initCharacterPageUI(deps);
    document.getElementById("charShortRestBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(deps.state.characters.entries[0].manualFeatureCards[0].limitedUse.current).toBe(1);
    expect(deps.state.characters.entries[1].manualFeatureCards[0].limitedUse.current).toBe(0);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(deps.setStatus).toHaveBeenCalledWith("Short rest applied.", { stickyMs: 2000 });

    controller.destroy();
  });

  it("does not mark dirty or re-render when rest recovery changes nothing", async () => {
    installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0].resources = [
      { id: "manual", name: "Manual", cur: 1, max: 3, recovery: "manual" },
      { id: "untagged", name: "Untagged", cur: 1, max: 3 },
    ];

    const controller = initCharacterPageUI(deps);
    document.getElementById("charShortRestBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(deps.state.characters.entries[0].resources.map((resource) => resource.cur)).toEqual([1, 1]);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    expect(deps.setStatus).toHaveBeenCalledWith("No recoverable resources for this rest.", { stickyMs: 2000 });
    expect(Popovers.handles).toHaveLength(2);

    controller.destroy();
  });

  it("preserves freeform and builder character state while applying explicit rest resources", async () => {
    installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const builder = makeBuilderCharacter({
      id: "char_builder",
      name: "Builder Rest",
      flatFields: {
        hpCur: 4,
        hpMax: 12,
        resources: [{ id: "builder_use", name: "Builder Use", cur: 0, max: 1, recovery: "longRest" }]
      }
    });
    deps.state.characters = {
      activeId: "char_builder",
      entries: [
        {
          id: "char_freeform",
          name: "Freeform Rest",
          build: null,
          resources: [{ id: "freeform_use", name: "Freeform Use", cur: 0, max: 1, recovery: "longRest" }]
        },
        builder
      ]
    };

    const controller = initCharacterPageUI(deps);
    document.getElementById("charLongRestBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(deps.state.characters.entries[0].build).toBeNull();
    expect(deps.state.characters.entries[0].resources[0].cur).toBe(0);
    expect(deps.state.characters.entries[1].build).toEqual(builder.build);
    expect(deps.state.characters.entries[1].resources[0].cur).toBe(1);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);

    controller.destroy();
  });

  it.each([
    ["cleric", "wis", 3],
    ["druid", "wis", 3],
    ["paladin", "cha", 4],
    ["wizard", "int", 3]
  ])("opens the Long Rest prepared-spell flow for builder %s characters", async (classId, ability, level) => {
    installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, [ability]: 16 };
    const builder = makeBuilderCharacter({
      id: `char_${classId}`,
      classId,
      level,
      abilities,
      flatFields: { hpCur: 4, hpMax: 12, rest: { hitDiceSpent: {}, preparedByClass: {} } }
    });
    builder.build.levels = Array.from({ length: level }, () => ({ classId, hp: 4 }));
    builder.build.spellcasting = { [classId]: { cantripIds: [], knownIds: classId === "wizard" ? ["magic-missile"] : [], preparedIds: [] } };
    deps.state.characters = { activeId: builder.id, entries: [builder] };
    openCharacterRestFlow.mockResolvedValue({});

    const controller = initCharacterPageUI(deps);
    document.getElementById("charLongRestBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();

    expect(openCharacterRestFlow).toHaveBeenCalledWith(expect.objectContaining({ type: "longRest", character: builder }));
    expect(builder.hpCur).toBe(12);
    controller.destroy();
  });

  it("keeps builder prepared state on No and applies a selected prepared state atomically on Yes", async () => {
    installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const builder = makeBuilderCharacter({
      id: "char_cleric_prepared",
      classId: "cleric",
      level: 3,
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
      flatFields: { hpCur: 3, hpMax: 12, rest: { hitDiceSpent: {}, preparedByClass: { cleric: ["cure-wounds"] } } }
    });
    builder.build.levels = Array.from({ length: 3 }, () => ({ classId: "cleric", hp: 4 }));
    builder.build.spellcasting = { cleric: { cantripIds: [], knownIds: [], preparedIds: ["cure-wounds"] } };
    deps.state.characters = { activeId: builder.id, entries: [builder] };
    openCharacterRestFlow.mockResolvedValueOnce({}).mockResolvedValueOnce({ preparedByClass: { cleric: [] } });

    const controller = initCharacterPageUI(deps);
    document.getElementById("charLongRestBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();
    expect(builder.rest.preparedByClass).toEqual({ cleric: ["cure-wounds"] });

    builder.hpCur = 4;
    document.getElementById("charLongRestBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();
    // C1 merge contract: clearing a class's ordinary list drops the key rather
    // than storing an empty array (which normalizeCharacterRestState discards
    // anyway). Nothing is prepared for the cleric either way.
    expect(builder.rest.preparedByClass).toEqual({});
    expect(builder.hpCur).toBe(12);
    controller.destroy();
  });

  it("synchronizes builder spell rows and re-seeds nothing else on a prepared Long Rest", async () => {
    installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const builder = makeBuilderCharacter({
      id: "char_cleric_sync",
      classId: "cleric",
      level: 3,
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
      flatFields: {
        hpCur: 3,
        hpMax: 12,
        // The player has cleared these since creation; a Long Rest must not
        // bring any of them back (C1.1 spells-only patch).
        features: "",
        languages: "",
        armorProf: "",
        weaponProf: "",
        attacks: [],
        inventoryItems: [],
        rest: { hitDiceSpent: {}, preparedByClass: { cleric: ["cure-wounds", "healing-word"] } },
        spells: {
          levels: [{
            id: "lvl1",
            label: "1st Level",
            hasSlots: true,
            used: 0,
            total: 4,
            collapsed: false,
            spells: [
              { id: "sp_cure", name: "Cure Wounds", notesCollapsed: true, known: true, prepared: true, expended: false, builderSpellId: "cure-wounds" },
              { id: "sp_heal", name: "Healing Word", notesCollapsed: false, known: true, prepared: true, expended: false, builderSpellId: "healing-word" },
              { id: "sp_manual", name: "My Homebrew Ward", notesCollapsed: true, known: true, prepared: true, expended: false }
            ]
          }]
        }
      }
    });
    builder.build.levels = Array.from({ length: 3 }, () => ({ classId: "cleric", hp: 4 }));
    builder.build.spellcasting = { cleric: { cantripIds: [], knownIds: [], preparedIds: [] } };
    builder.build.equipment = { armorId: "chain-mail", shield: true, weaponIds: ["mace"], startingChoices: {}, notes: "" };
    deps.state.characters = { activeId: builder.id, entries: [builder] };
    openCharacterRestFlow.mockResolvedValueOnce({ preparedByClass: { cleric: ["cure-wounds"] } });

    const controller = initCharacterPageUI(deps);
    document.getElementById("charLongRestBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();

    const spells = builder.spells.levels.find((level) => level.id === "lvl1").spells;
    const byId = (id) => spells.find((spell) => spell.id === id);
    expect(builder.rest.preparedByClass).toEqual({ cleric: ["cure-wounds"] });
    expect(byId("sp_cure")).toMatchObject({ prepared: true, builderSpellId: "cure-wounds" });
    // The deselected ordinary row is cleared; every other field survives.
    expect(byId("sp_heal")).toEqual({
      id: "sp_heal",
      name: "Healing Word",
      notesCollapsed: false,
      known: true,
      prepared: false,
      expended: false,
      builderSpellId: "healing-word"
    });
    // A manual row is never adopted or cleared.
    expect(byId("sp_manual")).toMatchObject({ prepared: true });

    // Spells-only: no unrelated builder content is restored.
    expect(builder.features).toBe("");
    expect(builder.languages).toBe("");
    expect(builder.armorProf).toBe("");
    expect(builder.weaponProf).toBe("");
    expect(builder.attacks).toEqual([]);
    expect(builder.inventoryItems).toEqual([]);

    // One user action, one save.
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);
    controller.destroy();
  });

  it("does not open a prepared-spell Long Rest flow for known-spell casters", async () => {
    installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const bard = makeBuilderCharacter({
      id: "char_bard_rest",
      classId: "bard",
      level: 3,
      abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 16 },
      flatFields: { hpCur: 3, hpMax: 12 }
    });
    bard.build.levels = Array.from({ length: 3 }, () => ({ classId: "bard", hp: 4 }));
    deps.state.characters = { activeId: bard.id, entries: [bard] };

    const controller = initCharacterPageUI(deps);
    document.getElementById("charLongRestBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(openCharacterRestFlow).not.toHaveBeenCalled();
    expect(bard.hpCur).toBe(12);
    controller.destroy();
  });

  it("exports the active character with a pretty JSON download", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const anchors = [];
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = (tagName) => {
      const el = originalCreateElement(tagName);
      if (String(tagName).toLowerCase() === "a") anchors.push(el);
      return el;
    };
    const createdUrls = [];
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((blob) => {
        createdUrls.push(blob);
        return "blob:character-export";
      }),
      revokeObjectURL: vi.fn()
    });
    exportActiveCharacter.mockResolvedValue({
      formatVersion: 1,
      type: "lore-ledger-character",
      character: { id: "char_a", name: "Ada" },
      portrait: null,
      spellNotes: {}
    });

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionExportBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();

    expect(exportActiveCharacter).toHaveBeenCalledWith({
      state: deps.state,
      getBlob: deps.getBlob,
      getText: deps.getText
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:character-export");
    expect(anchors[0]).toMatchObject({
      href: "blob:character-export",
      download: "ada-a.ll-character.json"
    });
    expect(JSON.parse(await createdUrls[0].text())).toEqual({
      formatVersion: 1,
      type: "lore-ledger-character",
      character: { id: "char_a", name: "Ada" },
      portrait: null,
      spellNotes: {}
    });
    expect(await createdUrls[0].text()).toContain('\n  "character"');
    expect(deps.setStatus).toHaveBeenCalledWith("Character exported.", { stickyMs: 2000 });

    controller.destroy();
  });

  it("cancels an import confirmation without committing or rerendering", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const importObject = makeImportObject("Mira");
    parseAndValidateImport.mockResolvedValue(importObject);
    deps.uiConfirm.mockResolvedValue(false);

    const controller = initCharacterPageUI(deps);
    const initialHandleCount = Popovers.handles.length;
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionImportBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    const input = findImportInput(document);
    expect(input).not.toBeNull();
    input.files = [{ size: 128, text: vi.fn(async () => "{}") }];
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();

    expect(parseAndValidateImport).toHaveBeenCalledWith(input.files[0]);
    expect(deps.uiConfirm).toHaveBeenCalledWith(
      'Import "Mira" into this campaign?\n\n- A new character will be added to this campaign.\n- Linked card connections from the original campaign are not imported.',
      { title: "Import Character", okText: "Import" }
    );
    expect(commitImport).not.toHaveBeenCalled();
    expect(deps.putBlob).not.toHaveBeenCalled();
    expect(deps.putText).not.toHaveBeenCalled();
    expect(deps.setStatus).not.toHaveBeenCalledWith('Imported "Mira"', expect.anything());
    expect(Popovers.handles).toHaveLength(initialHandleCount);
    expect(deps.state.characters.entries).toHaveLength(2);

    controller.destroy();
  });

  it("commits a confirmed import, rerenders, and reports success", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const importObject = makeImportObject("Mira");
    parseAndValidateImport.mockResolvedValue(importObject);
    deps.uiConfirm.mockResolvedValue(true);
    commitImport.mockImplementation(async (_importObject, commitDeps) => {
      commitDeps.state.characters.entries.push({ id: "char_imported", name: "Mira" });
      commitDeps.state.characters.activeId = "char_imported";
      return "char_imported";
    });

    const controller = initCharacterPageUI(deps);
    const initialHandleCount = Popovers.handles.length;
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionImportBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    const input = findImportInput(document);
    input.files = [{ size: 128, text: vi.fn(async () => "{}") }];
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();

    expect(commitImport).toHaveBeenCalledWith(importObject, {
      state: deps.state,
      SaveManager: deps.SaveManager,
      putBlob: deps.putBlob,
      deleteBlob: deps.deleteBlob,
      putText: deps.putText,
      dataUrlToBlob: deps.dataUrlToBlob,
      mutateState: expect.any(Function)
    });
    expect(deps.state.characters.activeId).toBe("char_imported");
    expect(Popovers.handles.length).toBeGreaterThan(initialHandleCount);
    expect(deps.setStatus).toHaveBeenCalledWith('Imported "Mira"', { stickyMs: 2000 });
    expect(deps.uiAlert).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("surfaces commit errors without rerendering", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const importObject = makeImportObject("Mira");
    parseAndValidateImport.mockResolvedValue(importObject);
    deps.uiConfirm.mockResolvedValue(true);
    commitImport.mockRejectedValue(new Error("Failed to store portrait."));

    const controller = initCharacterPageUI(deps);
    const initialHandleCount = Popovers.handles.length;
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionImportBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    const input = findImportInput(document);
    input.files = [{ size: 128, text: vi.fn(async () => "{}") }];
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();

    expect(deps.uiAlert).toHaveBeenCalledWith("Failed to store portrait.", { title: "Import failed" });
    expect(Popovers.handles).toHaveLength(initialHandleCount);
    expect(deps.setStatus).not.toHaveBeenCalledWith('Imported "Mira"', expect.anything());

    controller.destroy();
  });

  it("rejects oversized import files before parsing", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionImportBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    const file = { size: MAX_IMPORT_FILE_SIZE + 1, text: vi.fn(async () => "{}") };
    const input = findImportInput(document);
    input.files = [file];
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(parseAndValidateImport).not.toHaveBeenCalled();
    expect(file.text).not.toHaveBeenCalled();
    expect(deps.uiAlert).toHaveBeenCalledWith(
      "Character file is too large. Please check that this is a valid Lore Ledger character file.",
      { title: "Import failed" }
    );
    expect(commitImport).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("handles invalid JSON or invalid character files gracefully", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    parseAndValidateImport.mockRejectedValue(new Error("Invalid JSON file."));

    const controller = initCharacterPageUI(deps);
    const initialHandleCount = Popovers.handles.length;
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionImportBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    const input = findImportInput(document);
    input.files = [{ size: 128, text: vi.fn(async () => "{not json") }];
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();

    expect(deps.uiAlert).toHaveBeenCalledWith("Invalid JSON file.", { title: "Import failed" });
    expect(deps.uiConfirm).not.toHaveBeenCalled();
    expect(commitImport).not.toHaveBeenCalled();
    expect(Popovers.handles).toHaveLength(initialHandleCount);

    controller.destroy();
  });

  it("runs New Character from the action overflow menu", async () => {
    const { actionMenuButton } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    const entries = deps.state.characters.entries;
    expect(entries).toHaveLength(3);
    expect(entries[2].name).toBe("New Character");
    expect(entries[2].build).toBeNull();
    expect(entries[2].features).toBe("");
    expect(entries[2].languages).toBe("");
    expect(isBuilderCharacter(entries[2])).toBe(false);
    expect(deps.state.characters.activeId).toBe(entries[2].id);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(document.getElementById("charBuilderModeBadge").hidden).toBe(true);
    expect(document.getElementById("charActionDropdownMenu").hidden).toBe(true);

    controller.destroy();
  });

  it("opens Create with Builder from the action overflow menu without mutating state", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    const entries = deps.state.characters.entries;
    expect(entries).toHaveLength(2);
    expect(deps.state.characters.activeId).toBe("char_a");
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    expect(document.getElementById("builderWizardOverlay").hidden).toBe(false);
    expect(document.getElementById("builderWizardOverlay").getAttribute("aria-hidden")).toBe("false");
    expect(document.getElementById("builderWizardName").value).toBe("New Builder Character");
    expect(document.getElementById("charBuilderModeBadge").hidden).toBe(true);
    expect(document.getElementById("charActionDropdownMenu").hidden).toBe(true);

    controller.destroy();
  });

  it("enhances builder wizard identity selects with the shared select dropdown", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    ["builderWizardRace", "builderWizardClass", "builderWizardBackground"].forEach((id) => {
      const select = document.getElementById(id);
      const wrap = select.nextElementSibling;
      const button = wrap?.querySelector(".builderWizardSelectBtn");
      const menu = wrap?.querySelector(".dropdownMenu");
      expect(select.classList.contains("nativeSelectHidden")).toBe(true);
      expect(wrap?.classList.contains("selectDropdown")).toBe(true);
      expect(button?.getAttribute("aria-expanded")).toBe("false");
      expect(menu?.hidden).toBe(true);
    });

    controller.destroy();
  });

  it("keeps Identity validation hidden until Next is attempted", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(document.getElementById("builderWizardIdentityValidation").hidden).toBe(true);
    expect(document.getElementById("builderWizardIdentityValidation").textContent).toBe("");

    controller.destroy();
  });

  it("blocks Identity progression until race, class, and background are selected", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardName").value = "Incomplete";
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(document.getElementById("builderWizardStepIdentity").hidden).toBe(false);
    expect(document.getElementById("builderWizardStepAbilities").hidden).toBe(true);
    expect(document.getElementById("builderWizardIdentityValidation").textContent)
      .toBe("Race, class, and background are required before continuing.");
    expect(deps.setStatus).toHaveBeenCalledWith(
      "Race, class, and background are required before continuing.",
      { stickyMs: 2500 }
    );
    expect(deps.state.characters.entries).toHaveLength(2);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("allows complete Identity selections to progress to Ability Scores", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity();
    advanceBuilderWizardToStep("builderWizardStepAbilities");

    expect(document.getElementById("builderWizardStepIdentity").hidden).toBe(true);
    expect(document.getElementById("builderWizardStepAbilities").hidden).toBe(false);
    expect(document.getElementById("builderWizardIdentityValidation").hidden).toBe(true);

    controller.destroy();
  });

  it("routes Dragonborn Identity to Race Choices before Ability Scores", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "dragonborn" });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(document.getElementById("builderWizardStepIdentity").hidden).toBe(true);
    expect(document.getElementById("builderWizardStepRaceChoices").hidden).toBe(false);
    expect(document.getElementById("builderWizardStepAbilities").hidden).toBe(true);
    expect(document.getElementById("builderWizardRaceChoicesValidation").hidden).toBe(true);
    expect(document.getElementById("builderWizardRaceChoicesValidation").textContent).toBe("");
    expect(getSelectOptionValues(document.getElementById("builderWizardDraconicAncestry"))).toContain("red");

    controller.destroy();
  });

  it("shows a Race Choices helper before Dragonborn ancestry is selected", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "dragonborn" });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    const preview = document.getElementById("builderWizardRaceChoicePreview");
    expect(preview.hidden).toBe(false);
    expect(preview.textContent).toContain("Choose a Draconic Ancestry to preview its breath weapon and resistance.");
    expect(document.getElementById("builderWizardDraconicAncestry").getAttribute("aria-describedby"))
      .toContain("builderWizardRaceChoicePreviewBody");

    controller.destroy();
  });

  it("previews selected Red Dragonborn ancestry mechanics on Race Choices", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "dragonborn" });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardDraconicAncestry").value = "red";
    document.getElementById("builderWizardDraconicAncestry").dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));

    const preview = document.getElementById("builderWizardRaceChoicePreview").textContent;
    expect(preview).toContain("Draconic Ancestry");
    expect(preview).toContain("Red");
    expect(preview).toContain("Damage Resistance");
    expect(preview).toContain("Fire");
    expect(preview).toContain("Breath Weapon");
    expect(preview).toContain("15 ft. cone, Fire, Dexterity save");
    expect(preview).toContain("Breath Weapon DC");
    expect(preview).toContain("= 10");
    expect(preview).toContain("Breath Weapon Damage");
    expect(preview).toContain("2d6");

    controller.destroy();
  });

  it("updates the Race Choices preview when Dragonborn ancestry changes", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "dragonborn" });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    const select = document.getElementById("builderWizardDraconicAncestry");

    select.value = "red";
    select.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    expect(document.getElementById("builderWizardRaceChoicePreview").textContent)
      .toContain("15 ft. cone, Fire, Dexterity save");

    select.value = "black";
    select.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    const preview = document.getElementById("builderWizardRaceChoicePreview").textContent;
    expect(preview).toContain("Black");
    expect(preview).toContain("Damage Resistance");
    expect(preview).toContain("Acid");
    expect(preview).toContain("5 by 30 ft. line, Acid, Dexterity save");
    expect(preview).not.toContain("15 ft. cone, Fire");

    controller.destroy();
  });

  it("blocks Dragonborn Race Choices until Draconic Ancestry is selected", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "dragonborn" });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(document.getElementById("builderWizardStepRaceChoices").hidden).toBe(false);
    expect(document.getElementById("builderWizardStepAbilities").hidden).toBe(true);
    expect(document.getElementById("builderWizardRaceChoicesValidation").textContent)
      .toBe("Draconic Ancestry is required before continuing.");
    expect(deps.setStatus).toHaveBeenCalledWith(
      "Draconic Ancestry is required before continuing.",
      { stickyMs: 2500 }
    );

    controller.destroy();
  });

  it("allows selected Dragonborn ancestry to progress to Ability Scores", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "dragonborn" });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardDraconicAncestry").value = "red";
    document.getElementById("builderWizardDraconicAncestry").dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    advanceBuilderWizardToStep("builderWizardStepAbilities");

    expect(document.getElementById("builderWizardStepRaceChoices").hidden).toBe(true);
    expect(document.getElementById("builderWizardStepAbilities").hidden).toBe(false);
    expect(document.getElementById("builderWizardRaceChoicesValidation").hidden).toBe(true);

    controller.destroy();
  });

  it("shows Dragonborn race ability bonuses on the Ability Scores step", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "dragonborn" });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardDraconicAncestry").value = "red";
    document.getElementById("builderWizardDraconicAncestry").dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    const banner = document.getElementById("builderWizardRaceAbilityBonusPreview");
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toBe("Race Ability Bonus: +2 STR, +1 CHA");

    controller.destroy();
  });

  it("shows Dragonborn Manual base, race, and total ability previews", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "dragonborn" });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardDraconicAncestry").value = "red";
    document.getElementById("builderWizardDraconicAncestry").dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    document.getElementById("builderWizardAbilityStr").value = "15";
    document.getElementById("builderWizardAbilityStr").dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardAbilityCha").value = "8";
    document.getElementById("builderWizardAbilityCha").dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));

    expect(document.getElementById("builderWizardManualAbilityStrPreview").textContent)
      .toBe("STR: Base 15 + Race 2 = Total 17");
    expect(document.getElementById("builderWizardManualAbilityChaPreview").textContent)
      .toBe("CHA: Base 8 + Race 1 = Total 9");

    controller.destroy();
  });

  it("updates Dragonborn Standard Array ability previews after assignment", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "dragonborn" });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardDraconicAncestry").value = "red";
    document.getElementById("builderWizardDraconicAncestry").dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    chooseBuilderAbilityMethod("standard-array");
    assignStandardArrayScores({ Str: 15, Cha: 8 });

    expect(document.getElementById("builderWizardStandardArrayAbilityStrPreview").textContent)
      .toBe("STR: Base 15 + Race 2 = Total 17");
    expect(document.getElementById("builderWizardStandardArrayAbilityChaPreview").textContent)
      .toBe("CHA: Base 8 + Race 1 = Total 9");

    controller.destroy();
  });

  it("updates Dragonborn Point Buy ability previews after score changes", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "dragonborn" });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardDraconicAncestry").value = "red";
    document.getElementById("builderWizardDraconicAncestry").dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    chooseBuilderAbilityMethod("point-buy");
    clickPointBuy("Str", "increase", 2);

    expect(document.getElementById("builderWizardPointBuyAbilityStrPreview").textContent)
      .toBe("STR: Base 10 + Race 2 = Total 12");
    expect(document.getElementById("builderWizardPointBuyAbilityChaPreview").textContent)
      .toBe("CHA: Base 8 + Race 1 = Total 9");

    controller.destroy();
  });

  it("updates Dragonborn Roll ability previews after assignment", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    mockDiceRolls([
      6, 6, 3, 3,
      5, 5, 5, 1,
      4, 4, 4, 1,
      3, 3, 3, 1,
      2, 2, 2, 1,
      1, 1, 1, 1
    ]);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "dragonborn" });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardDraconicAncestry").value = "red";
    document.getElementById("builderWizardDraconicAncestry").dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    chooseBuilderAbilityMethod("roll");
    clickRollScores();
    assignRollScoresByIndex(["Str"]);

    expect(document.getElementById("builderWizardRollAbilityStrPreview").textContent)
      .toBe("STR: Base 15 + Race 2 = Total 17");

    controller.destroy();
  });

  it("shows Human race ability bonuses on the Ability Scores step", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "human" });
    advanceBuilderWizardToStep("builderWizardStepAbilities");

    expect(document.getElementById("builderWizardRaceAbilityBonusPreview").textContent)
      .toBe("Race Ability Bonus: +1 STR, +1 DEX, +1 CON, +1 INT, +1 WIS, +1 CHA");

    controller.destroy();
  });

  it("enhances the Dragonborn ancestry select with the shared select dropdown", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    completeBuilderIdentity({ raceId: "dragonborn" });
    advanceBuilderWizardToStep("builderWizardStepRaceChoices");

    const select = document.getElementById("builderWizardDraconicAncestry");
    const wrap = select.nextElementSibling;
    const button = wrap?.querySelector(".builderWizardSelectBtn");
    const menu = wrap?.querySelector(".dropdownMenu");
    expect(select.classList.contains("nativeSelectHidden")).toBe(true);
    expect(wrap?.classList.contains("selectDropdown")).toBe(true);
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(menu?.hidden).toBe(true);

    controller.destroy();
  });

  it("creates a populated builder character on wizard Finish", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await finishBuilderWizardWith();

    const entries = deps.state.characters.entries;
    expect(entries).toHaveLength(3);
    expect(entries[2]).toMatchObject({
      name: "Mira",
      classLevel: "",
      race: "",
      background: "",
      proficiency: null,
      build: {
        version: 2,
        ruleset: "srd-5.1",
        raceId: "human",
        backgroundId: "acolyte",
        levels: [{ classId: "fighter", hp: null }],
        abilities: {
          method: "manual",
          base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }
        }
      }
    });
    expect(isBuilderCharacter(entries[2])).toBe(true);
    expect(deps.state.characters.activeId).toBe(entries[2].id);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(document.getElementById("builderWizardOverlay").hidden).toBe(true);

    const derived = deriveCharacter(entries[2]);
    expect(derived.mode).toBe("builder");
    expect(derived.labels).toEqual({
      classLevel: "Fighter 1",
      race: "Human",
      background: "Acolyte"
    });
    expect(derived.proficiencyBonus).toBe(2);
    expect(derived.abilities.str).toMatchObject({ base: 15, total: 16, modifier: 3 });

    controller.destroy();
  });

  // Prepared Correctness C2-A: creation adopts the validated ordinary prepared
  // selection into `rest.preparedByClass`, through the real wizard Finish path.
  //
  // The fake DOM's selector engine handles single-class selectors only, so
  // rows are read by walking each label's children rather than with a
  // descendant selector.
  function preparedSpellRows(groupEl) {
    return groupEl.querySelectorAll(".builderSpellCheckItem").map((item) => ({
      input: item.children.find((child) => child.tagName === "INPUT"),
      name: item.children.find((child) => child.tagName === "SPAN")?.textContent || ""
    }));
  }

  async function createClericWithPrepared({
    name = "Prepared Mira",
    pick = 2,
    wis = 16,
    confirmUnderfill = true
  } = {}) {
    document.getElementById("builderWizardName").value = name;
    document.getElementById("builderWizardRace").value = "human";
    document.getElementById("builderWizardClass").value = "cleric";
    document.getElementById("builderWizardBackground").value = "acolyte";
    advanceBuilderWizardToStep("builderWizardStepAbilities");
    Object.entries({ Str: 10, Dex: 10, Con: 10, Int: 10, Wis: wis, Cha: 10 })
      .forEach(([suffix, value]) => {
        document.getElementById(`builderWizardAbility${suffix}`).value = String(value);
      });
    advanceBuilderWizardToStep("builderWizardStepSpells");

    const preparedGroup = Array.from(
      document.getElementById("builderWizardSpellsBody").querySelectorAll(".builderSpellGroup")
    ).find((node) => node.querySelector(".builderSpellGroupTitle")?.textContent === "Prepared Spells");
    const boxes = preparedSpellRows(preparedGroup);
    const chosen = [];
    for (let i = 0; i < pick; i += 1) {
      boxes[i].input.checked = true;
      boxes[i].input.dispatchEvent(new Event("change", { bubbles: true }));
      chosen.push(boxes[i].name);
    }
    advanceBuilderWizardToStep("builderWizardStepSummary");
    const finish = document.getElementById("builderWizardFinish");
    finish.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    if (confirmUnderfill && finish.textContent === "Finish Anyway") {
      finish.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    }
    await flushPromises();
    return { preparedGroup, chosenNames: chosen };
  }

  it("adopts exactly the validated ordinary prepared selection on Finish (C2-A)", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const deps = createCharacterPageDeps(createFakePopovers());

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await createClericWithPrepared({ pick: 2 });

    const entry = deps.state.characters.entries.at(-1);
    expect(entry.name).toBe("Prepared Mira");
    const adopted = entry.rest.preparedByClass.cleric;
    // Positive control: something really was adopted.
    expect(adopted).toHaveLength(2);
    // Exactly the draft's ordinary selection, unchanged.
    expect(adopted).toEqual(entry.build.spellcasting.cleric.preparedIds);
    // Every adopted id is a real, resolvable ordinary candidate.
    const plan = getPreparedSpellPlan(entry, BUILTIN_CONTENT_REGISTRY)
      .find((item) => item.classId === "cleric");
    expect(plan.selectedIds).toEqual(adopted);
    for (const id of adopted) expect(plan.ordinaryCandidateIds).toContain(id);

    // The sheet agrees: those spells are seeded as prepared rows.
    const seededPrepared = entry.spells.levels
      .flatMap((level) => level.spells)
      .filter((spell) => spell.prepared === true)
      .map((spell) => spell.builderSpellId);
    expect(seededPrepared.sort()).toEqual([...adopted].sort());

    controller.destroy();
  });

  it("confirms creation underfill inline, summarizes it, and links back to prepared spells (C2-B)", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const deps = createCharacterPageDeps(createFakePopovers());

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    // Capacity is 4 (level 1 + WIS 16); prepare one. The first Finish is a
    // transient confirmation only — no character or dirty mark yet.
    await createClericWithPrepared({
      name: "Underfilled",
      pick: 1,
      confirmUnderfill: false
    });

    expect(deps.state.characters.entries).toHaveLength(2);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    expect(document.getElementById("builderWizardOverlay").hidden).toBe(false);
    expect(document.getElementById("builderWizardStepSummary").hidden).toBe(false);
    expect(document.getElementById("builderWizardSummary").textContent).toContain("Prepared for play");
    expect(document.getElementById("builderWizardSummary").textContent).toContain("Prepared spells");
    expect(document.getElementById("builderWizardSummary").textContent).toContain("Cleric: 1 / 4");
    const confirmation = document.getElementById("builderWizardSummary")
      .querySelector(".builderPreparedUnderfillConfirmation");
    expect(confirmation.getAttribute("role")).toBe("alert");
    expect(confirmation.textContent).toContain("Cleric has 1 of 4 prepared");
    expect(document.getElementById("builderWizardFinish").textContent).toBe("Finish Anyway");

    // The neutral Summary block returns directly to the owning step.
    const review = document.getElementById("builderWizardSummary")
      .querySelector(".builderSummaryReviewPrepared");
    expect(review.textContent).toBe("Review prepared spells");
    review.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    expect(document.getElementById("builderWizardStepSpells").hidden).toBe(false);
    const preparedGroup = document.getElementById("builderWizardSpellsBody")
      .querySelectorAll(".builderSpellGroup")
      .find((group) => group.querySelector(".builderSpellGroupTitle")?.textContent === "Prepared Spells");
    const count = preparedGroup.querySelector(".builderSpellGroupCount");
    expect(count.getAttribute("role")).toBe("status");
    expect(count.getAttribute("aria-live")).toBe("polite");
    expect(count.getAttribute("aria-atomic")).toBe("true");

    // Returning without changing the exact list keeps the pending explicit
    // acknowledgement; the second Finish applies the legal underfilled list.
    advanceBuilderWizardToStep("builderWizardStepSummary");
    expect(document.getElementById("builderWizardFinish").textContent).toBe("Finish Anyway");
    document.getElementById("builderWizardFinish")
      .dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    const entry = deps.state.characters.entries.at(-1);
    expect(entry.name).toBe("Underfilled");
    expect(entry.rest.preparedByClass.cleric).toHaveLength(1);
    expect(document.getElementById("builderWizardOverlay").hidden).toBe(true);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);

    controller.destroy();
  });

  it("invalidates creation confirmation when the resulting prepared list changes (C2-B)", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const deps = createCharacterPageDeps(createFakePopovers());

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn")
      .dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await createClericWithPrepared({ pick: 1, confirmUnderfill: false });
    expect(document.getElementById("builderWizardFinish").textContent).toBe("Finish Anyway");

    document.getElementById("builderWizardSummary")
      .querySelector(".builderSummaryReviewPrepared")
      .dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    const prepared = document.getElementById("builderWizardSpellsBody")
      .querySelectorAll(".builderSpellGroup")
      .find((group) => group.querySelector(".builderSpellGroupTitle")?.textContent === "Prepared Spells");
    const unchecked = preparedSpellRows(prepared).find((row) => !row.input.checked);
    unchecked.input.checked = true;
    unchecked.input.dispatchEvent(new Event("change", { bubbles: true }));

    advanceBuilderWizardToStep("builderWizardStepSummary");
    expect(document.getElementById("builderWizardFinish").textContent).toBe("Finish");
    expect(document.querySelector(".builderPreparedUnderfillConfirmation")).toBeNull();

    document.getElementById("builderWizardFinish")
      .dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(deps.state.characters.entries).toHaveLength(2);
    expect(document.querySelector(".builderPreparedUnderfillConfirmation").textContent)
      .toContain("Cleric has 2 of 4 prepared");

    document.getElementById("builderWizardFinish")
      .dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(deps.state.characters.entries.at(-1).rest.preparedByClass.cleric).toHaveLength(2);

    controller.destroy();
  });

  it("finishes a full creation prepared list without confirmation (C2-B)", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const deps = createCharacterPageDeps(createFakePopovers());

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn")
      .dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await createClericWithPrepared({ name: "Full Cleric", pick: 4, confirmUnderfill: false });

    expect(document.getElementById("builderWizardOverlay").hidden).toBe(true);
    expect(deps.state.characters.entries.at(-1).name).toBe("Full Cleric");
    expect(deps.state.characters.entries.at(-1).rest.preparedByClass.cleric).toHaveLength(4);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);

    controller.destroy();
  });

  /**
   * A stored builder cleric whose build carries a prepared list the current
   * picker could not produce — the Edit-in-Builder / stale-content shape the
   * C2-A guard exists for.
   */
  function makeStoredCleric({ preparedIds, restPrepared = {}, subclassByClass = {} }) {
    const builder = makeDefaultBuilderCharacterEntry("Stored Cleric");
    builder.id = "char_stored_cleric";
    builder.build.raceId = "human";
    builder.build.backgroundId = "acolyte";
    builder.build.levels = [{ classId: "cleric", hp: null }];
    builder.build.subclassByClass = subclassByClass;
    builder.build.abilities.base = { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 };
    builder.build.spellcasting = { cleric: { cantripIds: [], knownIds: [], preparedIds } };
    builder.rest = { hitDiceSpent: {}, preparedByClass: restPrepared };
    return builder;
  }

  /** Remediation rows inside the live wizard's prepared group. */
  function preparedFixRows(document) {
    return document.getElementById("builderWizardSpellsBody")
      .querySelectorAll(".builderPreparedFixItem")
      .map((label) => ({
        text: label.children.find((child) => child.tagName === "SPAN")?.textContent || "",
        input: label.children.find((child) => child.tagName === "INPUT")
      }));
  }

  function openStoredClericInBuilder(builder) {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const deps = createCharacterPageDeps(createFakePopovers());
    deps.state.characters.entries[0] = builder;
    deps.state.characters.activeId = builder.id;
    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionEditBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    return { document, deps, controller };
  }

  it("blocks Finish and mutates nothing when the draft prepared list is invalid (C2-A)", async () => {
    // Positive control: the same flow with a legal list Finishes cleanly.
    const legal = makeStoredCleric({ preparedIds: ["bless"] });
    const ok = openStoredClericInBuilder(legal);
    advanceBuilderWizardToStep("builderWizardStepSummary");
    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(document.getElementById("builderWizardOverlay").hidden).toBe(true);
    expect(legal.rest.preparedByClass.cleric).toEqual(["bless"]);
    ok.controller.destroy();

    // Now the invalid one: a 1st-level wizard spell that is not on the cleric list.
    const builder = makeStoredCleric({ preparedIds: ["magic-missile"] });
    const { deps, controller } = openStoredClericInBuilder(builder);
    deps.SaveManager.markDirty.mockClear();

    advanceBuilderWizardToStep("builderWizardStepSummary");
    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    // Wizard stays open, on the step that owns the problem, explaining why.
    expect(document.getElementById("builderWizardOverlay").hidden).toBe(false);
    expect(document.getElementById("builderWizardStepSpells").hidden).toBe(false);
    const validation = document.getElementById("builderWizardSpellsBody")
      .querySelector(".builderSpellsValidation");
    expect(validation.hidden).toBe(false);
    expect(validation.textContent).toContain("Magic Missile");

    // Nothing was adopted, seeded, dirtied, or saved.
    expect(builder.rest.preparedByClass).toEqual({});
    expect(builder.spells.levels).toEqual([]);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    // The stored draft is left exactly as found — never truncated or repaired.
    expect(builder.build.spellcasting.cleric.preparedIds).toEqual(["magic-missile"]);

    controller.destroy();
  });

  // C2-A correction: a build the shipped pre-C2-A picker produced (a granted
  // domain spell stored as an ordinary prepared pick) must stay fixable through
  // the real wizard, not just detectable.
  it("lets the player remove a legacy granted prepared id and then Finish (C2-A correction)", async () => {
    const builder = makeStoredCleric({
      preparedIds: ["bless", "bane"],
      subclassByClass: { cleric: "life" }
    });
    const { deps, controller } = openStoredClericInBuilder(builder);
    deps.SaveManager.markDirty.mockClear();

    // Finish is blocked first, and nothing is touched.
    advanceBuilderWizardToStep("builderWizardStepSummary");
    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(document.getElementById("builderWizardOverlay").hidden).toBe(false);
    expect(document.getElementById("builderWizardStepSpells").hidden).toBe(false);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    expect(builder.rest.preparedByClass).toEqual({});
    expect(builder.spells.levels).toEqual([]);

    // The offending id is visible and removable on the step it sent us to.
    const fixes = preparedFixRows(document);
    expect(fixes).toHaveLength(1); // positive control
    expect(fixes[0].text).toContain("Bless");
    expect(fixes[0].text).toContain("already always prepared");
    expect(fixes[0].input.checked).toBe(true);
    expect(fixes[0].input.disabled).toBe(false);

    fixes[0].input.checked = false;
    fixes[0].input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(preparedFixRows(document)).toHaveLength(0);

    // Finish now succeeds, adopting only the legal ordinary pick.
    advanceBuilderWizardToStep("builderWizardStepSummary");
    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(document.getElementById("builderWizardOverlay").hidden).toBe(true);
    const saved = deps.state.characters.entries[0];
    expect(saved.build.spellcasting.cleric.preparedIds).toEqual(["bane"]);
    expect(saved.rest.preparedByClass.cleric).toEqual(["bane"]);
    // The grant still reaches the sheet as an always-prepared row.
    const grantedRow = saved.spells.levels
      .flatMap((level) => level.spells)
      .find((spell) => spell.builderSpellId === "bless");
    expect(grantedRow.builderGranted).toBe(true);
    expect(grantedRow.prepared).toBe(true);
    expect(deps.SaveManager.markDirty).toHaveBeenCalled();

    controller.destroy();
  });

  it("preserves the stored build when the player cancels after unchecking (C2-A correction)", async () => {
    const builder = makeStoredCleric({
      preparedIds: ["bless", "bane"],
      restPrepared: { cleric: ["bless", "bane"] },
      subclassByClass: { cleric: "life" }
    });
    const before = JSON.stringify(builder);
    const { deps, controller } = openStoredClericInBuilder(builder);
    deps.SaveManager.markDirty.mockClear();

    advanceBuilderWizardToStep("builderWizardStepSpells");
    const fixes = preparedFixRows(document);
    expect(fixes).toHaveLength(1); // positive control
    fixes[0].input.checked = false;
    fixes[0].input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(preparedFixRows(document)).toHaveLength(0);

    // Cancel: the draft is discarded, so the removal never reaches storage.
    document.getElementById("builderWizardCancel").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(document.getElementById("builderWizardOverlay").hidden).toBe(true);
    expect(JSON.stringify(deps.state.characters.entries[0])).toBe(before);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("does not overwrite an established runtime prepared list on Edit in Builder (C2-A)", async () => {
    // The wizard draft still says two spells; play-state says one.
    const builder = makeStoredCleric({
      preparedIds: ["bless", "cure-wounds"],
      restPrepared: { cleric: ["bless"] }
    });
    const { deps, controller } = openStoredClericInBuilder(builder);

    advanceBuilderWizardToStep("builderWizardStepSummary");
    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    // Runtime state wins: a prepared list is no longer a guarded build choice.
    expect(deps.state.characters.entries[0].rest.preparedByClass.cleric).toEqual(["bless"]);

    controller.destroy();
  });

  it("leaves freeform characters without any prepared adoption (C2-A)", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const deps = createCharacterPageDeps(createFakePopovers());

    const controller = initCharacterPageUI(deps);
    const freeform = deps.state.characters.entries.find((item) => !isBuilderCharacter(item));
    expect(freeform).toBeTruthy(); // positive control
    const restBefore = JSON.stringify(freeform.rest ?? null);

    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await createClericWithPrepared({ name: "Builder Only", pick: 1 });

    expect(JSON.stringify(freeform.rest ?? null)).toBe(restBefore);
    expect(getPreparedSpellPlan(freeform, BUILTIN_CONTENT_REGISTRY)).toEqual([]);

    controller.destroy();
  });

  it("seeds Dragonborn passive sheet text without persisting derived mechanics on Finish", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await finishBuilderWizardWith({ raceId: "dragonborn", ancestryId: "red" });

    const created = deps.state.characters.entries[2];
    expect(created.build.choicesByLevel["1"]["dragonborn-ancestry"]).toBe("red");
    expect(created.features.startsWith([
      "Dragonborn Traits",
      "Draconic Ancestry: Red",
      "Damage Resistance: You have resistance to fire damage."
    ].join("\n"))).toBe(true);
    expect(created.features).toContain("Second Wind (Fighter 1)");
    expect(created.languages).toBe("Common\nDraconic");
    expect(created.features).not.toContain("Breath Weapon");
    expect(created.manualFeatureCards).toEqual([]);
    expect(deriveCharacter(created).derivedFeatureActions.map((feature) => feature.id))
      .toContain("dragonborn-breath-weapon");
    expect(created).not.toHaveProperty("breathWeapon");
    expect(created).not.toHaveProperty("damageResistance");
    expect(created).not.toHaveProperty("raceAbilityBonuses");
    expect(created.build).not.toHaveProperty("breathWeapon");
    expect(created.build).not.toHaveProperty("damageResistance");
    expect(created.build).not.toHaveProperty("raceAbilityBonuses");
    expect(created.build).not.toHaveProperty("abilityTotals");
    expect(created.build).not.toHaveProperty("abilityMethod");

    controller.destroy();
  });

  it("skips Race Choices and persists no Dragonborn ancestry for non-Dragonborn", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await finishBuilderWizardWith({ raceId: "human" });

    const created = deps.state.characters.entries[2];
    expect(created.build.raceId).toBe("human");
    expect(created.build.choicesByLevel["1"]?.["dragonborn-ancestry"]).toBeUndefined();
    expect(created.features).toContain("Second Wind (Fighter 1)");
    expect(created.features).not.toContain("Draconic Ancestry");
    expect(created.languages).toBe("Common");
    expect(document.getElementById("builderWizardStepRaceChoices").hidden).toBe(true);

    controller.destroy();
  });

  it("clears stale Dragonborn ancestry when Race changes away from Dragonborn", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "dragonborn" });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardDraconicAncestry").value = "red";
    document.getElementById("builderWizardDraconicAncestry").dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardBack").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardRace").value = "human";
    document.getElementById("builderWizardRace").dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    const created = deps.state.characters.entries[2];
    expect(created.build.raceId).toBe("human");
    expect(created.build.choicesByLevel["1"]?.["dragonborn-ancestry"]).toBeUndefined();

    controller.destroy();
  });

  it("requires a fresh ancestry selection after changing away from and back to Dragonborn", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ raceId: "dragonborn" });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardDraconicAncestry").value = "red";
    document.getElementById("builderWizardDraconicAncestry").dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardBack").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardRace").value = "human";
    document.getElementById("builderWizardRace").dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardRace").value = "dragonborn";
    document.getElementById("builderWizardRace").dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(document.getElementById("builderWizardStepRaceChoices").hidden).toBe(false);
    expect(document.getElementById("builderWizardDraconicAncestry").value).toBe("");
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    expect(document.getElementById("builderWizardRaceChoicesValidation").textContent)
      .toBe("Draconic Ancestry is required before continuing.");

    controller.destroy();
  });

  it("does not persist abilityMethod on the build object after wizard Finish", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await finishBuilderWizardWith();

    const build = deps.state.characters.entries[2].build;
    expect(build).not.toBeNull();
    expect("abilityMethod" in build).toBe(false);

    controller.destroy();
  });

  it("renders wizard Summary from the draft build before Finish", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    completeBuilderIdentity({
      name: "Preview Mira",
      raceId: "elf",
      classId: "wizard",
      backgroundId: "acolyte"
    });
    advanceBuilderWizardToStep("builderWizardStepAbilities");
    document.getElementById("builderWizardAbilityInt").value = "16";
    advanceBuilderWizardToStep("builderWizardStepSummary");

    expect(deps.state.characters.entries).toHaveLength(2);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    const summary = document.getElementById("builderWizardSummary").textContent;
    expect(summary).toContain("Preview Mira");
    expect(summary).toContain("Wizard 1");
    expect(summary).toContain("Elf");
    expect(summary).toContain("Acolyte");
    expect(summary).toContain("+2");
    expect(summary).toContain("16 (+3)");

    controller.destroy();
  });

  it("renders selected Dragonborn ancestry in Summary with derived mechanics", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    completeBuilderIdentity({
      name: "Dragon Mira",
      raceId: "dragonborn",
      classId: "fighter",
      backgroundId: "acolyte"
    });
    advanceBuilderWizardToStep("builderWizardStepSummary", { ancestryId: "red" });

    const summary = document.getElementById("builderWizardSummary").textContent;
    expect(summary).toContain("Dragonborn");
    expect(summary).toContain("Draconic Ancestry");
    expect(summary).toContain("Red");
    expect(summary).toContain("Damage Resistance");
    expect(summary).toContain("Fire");
    expect(summary).toContain("Breath Weapon");
    expect(summary).toContain("15 ft. cone, Fire, Dexterity save");
    expect(summary).toContain("= 10");
    expect(summary).toContain("2d6");

    controller.destroy();
  });

  it("does not expose an editable builder wizard level input", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    const levelDisplay = document.getElementById("builderWizardLevel");
    expect(levelDisplay.tagName).toBe("SPAN");
    expect(levelDisplay.textContent).toBe("Level 1");
    expect(["INPUT", "SELECT", "TEXTAREA"]).not.toContain(levelDisplay.tagName);

    controller.destroy();
  });

  it("keeps the Summary name field synced to the wizard draft used on Finish", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ name: "Identity Name" });
    advanceBuilderWizardToStep("builderWizardStepSummary");

    const summaryName = document.getElementById("builderWizardSummaryName");
    expect(summaryName.value).toBe("Identity Name");
    summaryName.value = "Summary Name";
    summaryName.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    expect(document.getElementById("builderWizardName").value).toBe("Summary Name");

    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    const created = deps.state.characters.entries[2];
    expect(created.name).toBe("Summary Name");
    expect(created.build).not.toBeNull();

    controller.destroy();
  });

  it("enables Roll alongside Manual, Standard Array, and Point Buy", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity();
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(document.getElementById("builderWizardAbilityMethodManual").checked).toBe(true);
    const standardArray = document.getElementById("builderWizardAbilityMethod-standard-array");
    expect(standardArray.disabled).toBe(false);
    expect(standardArray.getAttribute("aria-disabled")).not.toBe("true");
    expect(standardArray.getAttribute("tabindex")).not.toBe("-1");
    const pointBuy = document.getElementById("builderWizardAbilityMethod-point-buy");
    expect(pointBuy.disabled).toBe(false);
    expect(pointBuy.getAttribute("aria-disabled")).not.toBe("true");
    expect(pointBuy.getAttribute("tabindex")).not.toBe("-1");
    const roll = document.getElementById("builderWizardAbilityMethod-roll");
    expect(roll.disabled).toBe(false);
    expect(roll.getAttribute("aria-disabled")).not.toBe("true");
    expect(roll.getAttribute("tabindex")).not.toBe("-1");

    controller.destroy();
  });

  it("confirms ability score method radios are all keyboard reachable after wizard open", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    const manualRadio = document.getElementById("builderWizardAbilityMethodManual");
    expect(manualRadio.getAttribute("aria-disabled")).not.toBe("true");
    expect(manualRadio.getAttribute("tabindex")).not.toBe("-1");
    expect(manualRadio.checked).toBe(true);

    const standardArrayRadio = document.getElementById("builderWizardAbilityMethod-standard-array");
    expect(standardArrayRadio).not.toBeNull();
    expect(standardArrayRadio.getAttribute("aria-disabled")).not.toBe("true");
    expect(standardArrayRadio.getAttribute("tabindex")).not.toBe("-1");
    expect(standardArrayRadio.disabled).toBe(false);

    const pointBuyRadio = document.getElementById("builderWizardAbilityMethod-point-buy");
    expect(pointBuyRadio).not.toBeNull();
    expect(pointBuyRadio.getAttribute("aria-disabled")).not.toBe("true");
    expect(pointBuyRadio.getAttribute("tabindex")).not.toBe("-1");
    expect(pointBuyRadio.disabled).toBe(false);

    const rollRadio = document.getElementById("builderWizardAbilityMethod-roll");
    expect(rollRadio).not.toBeNull();
    expect(rollRadio.getAttribute("aria-disabled")).not.toBe("true");
    expect(rollRadio.getAttribute("tabindex")).not.toBe("-1");
    expect(rollRadio.disabled).toBe(false);

    controller.destroy();
  });

  it("defaults Roll to 4d6 drop lowest when selected", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("roll");
    await flushPromises();

    expect(document.getElementById("builderWizardAbilityMethod-roll").checked).toBe(true);
    expect(document.getElementById("builderWizardRollSection").hidden).toBe(false);
    expect(document.getElementById("builderWizardRollMode").value).toBe("4d6-drop-lowest");
    expect(document.getElementById("builderWizardRollButton").textContent).toBe("Roll Scores");
    expect(document.getElementById("builderWizardRollPool").textContent).toBe("No scores rolled yet.");
    expect(document.getElementById("builderWizardRollAssignmentGrid").hidden).toBe(true);
    expect(document.getElementById("builderWizardAbilityValidation").hidden).toBe(true);

    controller.destroy();
  });

  it("calculates Roll scores with deterministic dice for both supported modes", () => {
    expect(rollBuilderAbilityScore("4d6-drop-lowest", vi.fn()
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(6)
      .mockReturnValueOnce(3)
      .mockReturnValueOnce(4))).toBe(13);
    expect(rollBuilderAbilityScore("3d6-straight", vi.fn()
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(6))).toBe(13);
  });

  it("generates six Roll score instances with deterministic 4d6 drop lowest dice", () => {
    const dice = [
      1, 6, 3, 4,
      2, 2, 2, 2,
      6, 6, 6, 1,
      5, 4, 3, 2,
      1, 1, 1, 1,
      3, 3, 4, 4
    ];
    let index = 0;
    const pool = rollBuilderAbilityScorePool("4d6-drop-lowest", () => dice[index++], 7);
    expect(pool).toEqual([
      { id: "roll-7-1", value: 13 },
      { id: "roll-7-2", value: 6 },
      { id: "roll-7-3", value: 18 },
      { id: "roll-7-4", value: 12 },
      { id: "roll-7-5", value: 3 },
      { id: "roll-7-6", value: 11 }
    ]);
  });

  it("generates six Roll score instances from the wizard button and supports duplicate numeric scores", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    mockDiceRolls([
      6, 6, 3, 3,
      6, 6, 3, 3,
      5, 5, 5, 1,
      4, 4, 4, 1,
      3, 3, 3, 1,
      2, 2, 2, 1
    ]);

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("roll");
    clickRollScores();

    expect(document.getElementById("builderWizardRollButton").textContent).toBe("Reroll Scores");
    expect(document.getElementById("builderWizardRollPool").textContent).toContain("Generated scores: 15, 15, 15, 12, 9, 6");
    expect(document.getElementById("builderWizardRollAssignmentGrid").hidden).toBe(false);

    const strOptions = getSelectOptions(getRollSelect("Str"));
    expect(strOptions.map((option) => option.label)).toEqual(["Choose score", "15", "15", "15", "12", "9", "6"]);
    expect(new Set(strOptions.map((option) => option.value)).size).toBe(7);

    controller.destroy();
  });

  it("uses 3d6 straight when the Roll mode is changed", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    mockDiceRolls([
      1, 2, 3,
      2, 3, 4,
      3, 4, 5,
      4, 5, 6,
      1, 1, 1,
      6, 6, 6
    ]);

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("roll");
    const mode = document.getElementById("builderWizardRollMode");
    mode.value = "3d6-straight";
    dispatchChange(mode);
    clickRollScores();

    expect(document.getElementById("builderWizardRollPool").textContent).toContain("Generated scores: 6, 9, 12, 15, 3, 18");

    controller.destroy();
  });

  it("removes used Roll score instances from other dropdowns while keeping the owner selected", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    mockDiceRolls([
      6, 6, 3, 3,
      6, 6, 3, 3,
      5, 5, 5, 1,
      4, 4, 4, 1,
      3, 3, 3, 1,
      2, 2, 2, 1
    ]);

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("roll");
    clickRollScores();

    const strSelect = getRollSelect("Str");
    const dexSelect = getRollSelect("Dex");
    const firstRollId = strSelect.children[1].value;
    strSelect.value = firstRollId;
    dispatchChange(strSelect);

    expect(getSelectOptionValues(strSelect)).toContain(firstRollId);
    expect(getSelectOptionValues(dexSelect)).not.toContain(firstRollId);
    expect(getSelectOptions(dexSelect).filter((option) => option.label === "15")).toHaveLength(2);
    expect(getEnhancedDropdownValues(dexSelect)).not.toContain(firstRollId);

    controller.destroy();
  });

  it("rerolling clears old Roll assignments and validation", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    mockDiceRolls([
      6, 6, 3, 3, 5, 5, 5, 1, 4, 4, 4, 1, 3, 3, 3, 1, 2, 2, 2, 1, 1, 1, 1, 1,
      6, 6, 6, 1, 5, 5, 5, 1, 4, 4, 4, 1, 3, 3, 3, 1, 2, 2, 2, 1, 1, 1, 1, 1
    ]);

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("roll");
    clickRollScores();
    assignRollScoresByIndex(["Str", "Dex"]);
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    expect(document.getElementById("builderWizardAbilityValidation").textContent)
      .toBe("Assign each rolled score before continuing.");

    clickRollScores();

    expect(getRollSelect("Str").value).toBe("");
    expect(getRollSelect("Dex").value).toBe("");
    expect(document.getElementById("builderWizardAbilityValidation").hidden).toBe(true);
    expect(document.getElementById("builderWizardAbilityValidation").textContent).toBe("");

    controller.destroy();
  });

  it("blocks Roll progression before rolling with a clear validation message", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("roll");
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(document.getElementById("builderWizardStepAbilities").hidden).toBe(false);
    expect(document.getElementById("builderWizardStepSummary").hidden).toBe(true);
    expect(document.getElementById("builderWizardAbilityValidation").textContent)
      .toBe("Roll scores before continuing.");

    controller.destroy();
  });

  it("blocks Roll progression after rolling until all abilities are assigned", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    mockDiceRolls(Array(24).fill(4));

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("roll");
    clickRollScores();
    assignRollScoresByIndex(["Str", "Dex", "Con", "Int", "Wis"]);
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(document.getElementById("builderWizardStepAbilities").hidden).toBe(false);
    expect(document.getElementById("builderWizardStepSummary").hidden).toBe(true);
    expect(document.getElementById("builderWizardAbilityValidation").textContent)
      .toBe("Assign each rolled score before continuing.");

    controller.destroy();
  });

  it("previews Roll values in Summary and finishes with only canonical base scores persisted", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    mockDiceRolls([
      6, 6, 6, 1,
      5, 5, 5, 1,
      4, 4, 4, 1,
      3, 3, 3, 1,
      2, 2, 2, 1,
      1, 1, 1, 1
    ]);

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("roll");
    clickRollScores();
    assignRollScoresByIndex();
    advanceBuilderWizardToStep("builderWizardStepSummary");

    const summary = document.getElementById("builderWizardSummary").textContent;
    expect(summary).toContain("STR19 (+4)");
    expect(summary).toContain("DEX16 (+3)");
    expect(summary).toContain("CHA4 (-3)");

    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    const build = deps.state.characters.entries[2].build;
    expect(build.abilities.base).toEqual({ str: 18, dex: 15, con: 12, int: 9, wis: 6, cha: 3 });
    expect("abilityMethod" in build).toBe(false);
    expect("rollMode" in build.abilities).toBe(false);
    expect("rollPool" in build.abilities).toBe(false);
    expect("rollAssignments" in build.abilities).toBe(false);
    expect("rolledDice" in build.abilities).toBe(false);
    expect("randomSeed" in build.abilities).toBe(false);

    controller.destroy();
  });

  it("blocks forced duplicate Roll assignments defensively", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    mockDiceRolls(Array(24).fill(5));

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("roll");
    clickRollScores();
    const firstId = getRollSelect("Str").children[1].value;
    getRollSelect("Str").value = firstId;
    dispatchChange(getRollSelect("Str"));
    const forcedOption = document.createElement("option");
    forcedOption.value = firstId;
    forcedOption.textContent = "15";
    getRollSelect("Dex").appendChild(forcedOption);
    getRollSelect("Dex").value = firstId;
    dispatchChange(getRollSelect("Dex"));

    expect(getRollSelect("Dex").value).toBe("");
    expect(document.getElementById("builderWizardAbilityValidation").textContent)
      .toContain("is already assigned");
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    expect(document.getElementById("builderWizardStepAbilities").hidden).toBe(false);

    controller.destroy();
  });

  it("starts Point Buy at 8 for all abilities with 27 remaining points", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("point-buy");

    expect(document.getElementById("builderWizardPointBuyGrid").hidden).toBe(false);
    expect(document.getElementById("builderWizardManualAbilityGrid").hidden).toBe(true);
    expect(document.getElementById("builderWizardStandardArrayGrid").hidden).toBe(true);
    expect(document.getElementById("builderWizardPointBuyRemaining").textContent).toBe("27");
    ["Str", "Dex", "Con", "Int", "Wis", "Cha"].forEach((suffix) => {
      expect(getPointBuyScore(suffix)).toBe("8");
      expect(document.getElementById(`builderWizardPointBuy${suffix}Decrease`).disabled).toBe(true);
      expect(document.getElementById(`builderWizardPointBuy${suffix}Increase`).disabled).toBe(false);
    });
    expect(document.getElementById("builderWizardAbilityValidation").hidden).toBe(true);

    controller.destroy();
  });

  it("updates Point Buy scores and remaining points using the 5e cost table", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("point-buy");

    clickPointBuy("Str", "increase", 5);
    expect(getPointBuyScore("Str")).toBe("13");
    expect(document.getElementById("builderWizardPointBuyRemaining").textContent).toBe("22");

    clickPointBuy("Str", "increase");
    expect(getPointBuyScore("Str")).toBe("14");
    expect(document.getElementById("builderWizardPointBuyRemaining").textContent).toBe("20");

    clickPointBuy("Str", "increase");
    expect(getPointBuyScore("Str")).toBe("15");
    expect(document.getElementById("builderWizardPointBuyRemaining").textContent).toBe("18");
    expect(document.getElementById("builderWizardPointBuyStrIncrease").disabled).toBe(true);

    clickPointBuy("Str", "increase");
    expect(getPointBuyScore("Str")).toBe("15");
    expect(document.getElementById("builderWizardPointBuyRemaining").textContent).toBe("18");

    controller.destroy();
  });

  it("prevents Point Buy decreases below 8 and spending beyond 27 points", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("point-buy");

    clickPointBuy("Str", "decrease");
    expect(getPointBuyScore("Str")).toBe("8");
    expect(document.getElementById("builderWizardPointBuyRemaining").textContent).toBe("27");

    ["Str", "Dex", "Con"].forEach((suffix) => clickPointBuy(suffix, "increase", 7));
    expect(document.getElementById("builderWizardPointBuyRemaining").textContent).toBe("0");
    expect(getPointBuyScore("Str")).toBe("15");
    expect(getPointBuyScore("Dex")).toBe("15");
    expect(getPointBuyScore("Con")).toBe("15");
    ["Int", "Wis", "Cha"].forEach((suffix) => {
      expect(document.getElementById(`builderWizardPointBuy${suffix}Increase`).disabled).toBe(true);
    });

    clickPointBuy("Int", "increase");
    expect(getPointBuyScore("Int")).toBe("8");
    expect(document.getElementById("builderWizardPointBuyRemaining").textContent).toBe("0");

    controller.destroy();
  });

  it("allows unspent Point Buy points and previews Point Buy values in Summary", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ name: "Point Mira" });
    advanceBuilderWizardToStep("builderWizardStepAbilities");
    chooseBuilderAbilityMethod("point-buy");
    clickPointBuy("Str", "increase", 2);
    clickPointBuy("Dex", "increase", 1);

    expect(document.getElementById("builderWizardPointBuyRemaining").textContent).toBe("24");
    advanceBuilderWizardToStep("builderWizardStepSummary");

    const summary = document.getElementById("builderWizardSummary").textContent;
    expect(summary).toContain("Point Mira");
    expect(summary).toContain("STR11 (+0)");
    expect(summary).toContain("DEX10 (+0)");
    expect(summary).toContain("CHA9 (-1)");

    controller.destroy();
  });

  it("finishes from Point Buy with only canonical base scores persisted", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("point-buy");
    clickPointBuy("Str", "increase", 7);
    clickPointBuy("Dex", "increase", 6);
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    const build = deps.state.characters.entries[2].build;
    expect(build.abilities.base).toEqual({ str: 15, dex: 14, con: 8, int: 8, wis: 8, cha: 8 });
    expect("abilityMethod" in build).toBe(false);
    expect("pointBuy" in build.abilities).toBe(false);
    expect("remainingPoints" in build.abilities).toBe(false);
    expect("spent" in build.abilities).toBe(false);

    controller.destroy();
  });

  it("preserves Manual, Standard Array, Point Buy, and Roll draft state independently when switching methods", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    mockDiceRolls([
      6, 6, 6, 1,
      5, 5, 5, 1,
      4, 4, 4, 1,
      3, 3, 3, 1,
      2, 2, 2, 1,
      1, 1, 1, 1
    ]);

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);

    document.getElementById("builderWizardAbilityStr").value = "18";
    document.getElementById("builderWizardAbilityDex").value = "11";
    chooseBuilderAbilityMethod("standard-array");
    assignStandardArrayScores({ Str: 15, Dex: 14, Con: 13, Int: 12, Wis: 10, Cha: 8 });
    chooseBuilderAbilityMethod("point-buy");
    clickPointBuy("Str", "increase", 2);
    clickPointBuy("Wis", "increase", 1);
    chooseBuilderAbilityMethod("roll");
    clickRollScores();
    assignRollScoresByIndex(["Str", "Dex"]);
    chooseBuilderAbilityMethod("manual");
    expect(document.getElementById("builderWizardAbilityStr").value).toBe("18");
    expect(document.getElementById("builderWizardAbilityDex").value).toBe("11");

    chooseBuilderAbilityMethod("standard-array");
    expect(document.getElementById("builderWizardStandardArrayStr").value).toBe("15");
    expect(document.getElementById("builderWizardStandardArrayDex").value).toBe("14");

    chooseBuilderAbilityMethod("point-buy");
    expect(getPointBuyScore("Str")).toBe("10");
    expect(getPointBuyScore("Wis")).toBe("9");
    expect(document.getElementById("builderWizardPointBuyRemaining").textContent).toBe("24");

    chooseBuilderAbilityMethod("roll");
    expect(document.getElementById("builderWizardRollPool").textContent).toContain("Generated scores: 18, 15, 12, 9, 6, 3");
    expect(getRollSelect("Str").value).toBe("roll-1-1");
    expect(getRollSelect("Dex").value).toBe("roll-1-2");

    controller.destroy();
  });

  it("blocks progression and Finish from a forced invalid Point Buy state", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    openBuilderWizardToAbilities(actionMenuButton);
    chooseBuilderAbilityMethod("point-buy");
    document.getElementById("builderWizardPointBuyStrValue").textContent = "16";
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(document.getElementById("builderWizardStepAbilities").hidden).toBe(false);
    expect(document.getElementById("builderWizardStepSummary").hidden).toBe(true);
    expect(document.getElementById("builderWizardAbilityValidation").textContent)
      .toBe("Point Buy scores must stay between 8 and 15 and spend no more than 27 points.");
    expect(deps.state.characters.entries).toHaveLength(2);

    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(deps.state.characters.entries).toHaveLength(2);

    controller.destroy();
  });

  it("assigns all six Standard Array scores, previews them in Summary, and persists only canonical base scores", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity({ name: "Array Mira" });
    advanceBuilderWizardToStep("builderWizardStepAbilities");

    chooseBuilderAbilityMethod("standard-array");
    expect(document.getElementById("builderWizardManualAbilityGrid").hidden).toBe(true);
    expect(document.getElementById("builderWizardStandardArrayGrid").hidden).toBe(false);
    assignStandardArrayScores({ Str: 15, Dex: 14, Con: 13, Int: 12, Wis: 10, Cha: 8 });
    advanceBuilderWizardToStep("builderWizardStepSummary");

    const summary = document.getElementById("builderWizardSummary").textContent;
    expect(summary).toContain("Array Mira");
    expect(summary).toContain("STR16 (+3)");
    expect(summary).toContain("DEX15 (+2)");
    expect(summary).toContain("CHA9 (-1)");

    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    const build = deps.state.characters.entries[2].build;
    expect(build.abilities.base).toEqual({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 });
    expect("abilityMethod" in build).toBe(false);

    controller.destroy();
  });

  it("keeps Standard Array incomplete validation hidden until Next is attempted", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity();
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    chooseBuilderAbilityMethod("standard-array");

    expect(document.getElementById("builderWizardAbilityValidation").hidden).toBe(true);
    expect(document.getElementById("builderWizardAbilityValidation").textContent).toBe("");

    controller.destroy();
  });

  it("clears Standard Array incomplete validation after all six scores are assigned", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity();
    advanceBuilderWizardToStep("builderWizardStepAbilities");

    chooseBuilderAbilityMethod("standard-array");
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    expect(document.getElementById("builderWizardAbilityValidation").textContent)
      .toBe("Assign each Standard Array score before continuing.");

    assignStandardArrayScores({ Str: 15, Dex: 14, Con: 13, Int: 12, Wis: 10, Cha: 8 });

    expect(document.getElementById("builderWizardAbilityValidation").hidden).toBe(true);
    expect(document.getElementById("builderWizardAbilityValidation").textContent).toBe("");

    controller.destroy();
  });

  it("enhances Standard Array score selects with the shared select dropdown", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity();
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    chooseBuilderAbilityMethod("standard-array");
    assignStandardArrayScores({ Str: 15 });

    const strSelect = document.getElementById("builderWizardStandardArrayStr");
    const dexSelect = document.getElementById("builderWizardStandardArrayDex");
    const dexWrap = dexSelect.nextElementSibling;
    const dexButton = dexWrap?.querySelector(".builderWizardSelectBtn");
    expect(strSelect.classList.contains("nativeSelectHidden")).toBe(true);
    expect(dexSelect.classList.contains("nativeSelectHidden")).toBe(true);
    expect(dexWrap?.classList.contains("selectDropdown")).toBe(true);
    expect(dexButton?.getAttribute("aria-expanded")).toBe("false");
    expect(getSelectOptionValues(strSelect)).toContain("15");
    expect(getEnhancedDropdownValues(strSelect)).toContain("15");
    expect(getSelectOptionValues(dexSelect)).not.toContain("15");
    expect(getEnhancedDropdownValues(dexSelect)).not.toContain("15");
    expect(getEnhancedDropdownValues(dexSelect)).toContain("");

    controller.destroy();
  });

  it("returns a changed Standard Array score to the available pool for other abilities", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity();
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    chooseBuilderAbilityMethod("standard-array");
    assignStandardArrayScores({ Str: 15 });

    const strSelect = document.getElementById("builderWizardStandardArrayStr");
    const dexSelect = document.getElementById("builderWizardStandardArrayDex");
    expect(getSelectOptionValues(dexSelect)).not.toContain("15");

    strSelect.value = "14";
    dispatchChange(strSelect);

    expect(getSelectOptionValues(strSelect)).toContain("14");
    expect(getEnhancedDropdownValues(strSelect)).toContain("14");
    expect(getSelectOptionValues(dexSelect)).toContain("15");
    expect(getEnhancedDropdownValues(dexSelect)).toContain("15");
    expect(getSelectOptionValues(dexSelect)).not.toContain("14");
    expect(getEnhancedDropdownValues(dexSelect)).not.toContain("14");

    controller.destroy();
  });

  it("prevents duplicate Standard Array assignments", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity();
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    chooseBuilderAbilityMethod("standard-array");
    assignStandardArrayScores({ Str: 15 });
    const dexSelect = document.getElementById("builderWizardStandardArrayDex");
    const forcedOption = document.createElement("option");
    forcedOption.value = "15";
    forcedOption.textContent = "15";
    dexSelect.appendChild(forcedOption);
    dexSelect.value = "15";
    dexSelect.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));

    expect(dexSelect.value).toBe("");
    expect(document.getElementById("builderWizardAbilityValidation").textContent)
      .toContain("score 15 is already assigned");
    expect(deps.setStatus).toHaveBeenCalledWith(
      "Standard Array score 15 is already assigned. Each score can be used once.",
      { stickyMs: 2500 }
    );

    controller.destroy();
  });

  it("blocks Standard Array Summary/Finish when assignments are incomplete", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity();
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    chooseBuilderAbilityMethod("standard-array");
    assignStandardArrayScores({ Str: 15, Dex: 14, Con: 13, Int: 12, Wis: 10 });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(document.getElementById("builderWizardStepAbilities").hidden).toBe(false);
    expect(document.getElementById("builderWizardStepSummary").hidden).toBe(true);
    expect(document.getElementById("builderWizardAbilityValidation").textContent)
      .toBe("Assign each Standard Array score before continuing.");
    expect(deps.state.characters.entries).toHaveLength(2);

    controller.destroy();
  });

  it("switches methods without corrupting Manual draft ability values", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    completeBuilderIdentity();
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    document.getElementById("builderWizardAbilityStr").value = "18";
    document.getElementById("builderWizardAbilityDex").value = "11";
    chooseBuilderAbilityMethod("standard-array");
    assignStandardArrayScores({ Str: 15, Dex: 14, Con: 13, Int: 12, Wis: 10, Cha: 8 });
    chooseBuilderAbilityMethod("manual");

    expect(document.getElementById("builderWizardManualAbilityGrid").hidden).toBe(false);
    expect(document.getElementById("builderWizardStandardArrayGrid").hidden).toBe(true);
    expect(document.getElementById("builderWizardAbilityStr").value).toBe("18");
    expect(document.getElementById("builderWizardAbilityDex").value).toBe("11");

    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(deps.state.characters.entries[2].build.abilities.base.str).toBe(18);
    expect(deps.state.characters.entries[2].build.abilities.base.dex).toBe(11);

    controller.destroy();
  });

  it("cancels Create with Builder without creating or marking dirty", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardName").value = "Cancelled";
    document.getElementById("builderWizardCancel").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(deps.state.characters.entries).toHaveLength(2);
    expect(deps.state.characters.activeId).toBe("char_a");
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    expect(document.getElementById("builderWizardOverlay").hidden).toBe(true);

    controller.destroy();
  });

  it("closes Create with Builder on Escape without creating or marking dirty", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    const event = new Event("keydown", { bubbles: true, cancelable: true });
    event.key = "Escape";
    document.dispatchEvent(event);
    await flushPromises();

    expect(deps.state.characters.entries).toHaveLength(2);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    expect(document.getElementById("builderWizardOverlay").hidden).toBe(true);

    controller.destroy();
  });

  it("shows the accessible Builder Mode badge only for active builder characters", () => {
    installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const firstController = initCharacterPageUI(deps);
    expect(document.getElementById("charBuilderModeBadge").hidden).toBe(true);

    firstController.destroy();
    deps.state.characters.entries[1].build = makeDefaultCharacterBuild();
    deps.state.characters.activeId = "char_b";
    const secondController = initCharacterPageUI(deps);
    const builderBadge = document.getElementById("charBuilderModeBadge");
    expect(builderBadge.hidden).toBe(false);
    expect(builderBadge.getAttribute("aria-label")).toBe("Builder mode active. Full builder tools are not enabled yet.");
    expect(builderBadge.getAttribute("title")).toBe("Builder mode active. Full builder tools are not enabled yet.");

    secondController.destroy();
  });

  it("shows read-only Builder Identity values for builder characters", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const controller = initCharacterPageUI(deps);
    const panel = document.getElementById("charBuilderIdentityPanel");

    expect(panel.hidden).toBe(false);
    expect(panel.getAttribute("aria-hidden")).toBe("false");
    expect(document.getElementById("charBuilderRaceValue").textContent).toBe("Elf");
    expect(document.getElementById("charBuilderClassValue").textContent).toBe("Fighter 5");
    expect(document.getElementById("charBuilderBackgroundValue").textContent).toBe("Acolyte");
    expect(document.getElementById("charBuilderLevelValue").textContent).toBe("5");
    // B1: no structural edit controls remain on the sheet panel.
    expect(document.getElementById("charBuilderRaceSelect")).toBeNull();
    expect(document.getElementById("charBuilderLevelInput")).toBeNull();
    expect(document.getElementById("charBuilderIdentityEditBtn").disabled).toBe(false);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("links Builder Identity values to their visible labels", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const controller = initCharacterPageUI(deps);

    [
      ["charBuilderRaceValue", "charBuilderRaceLabel", "Race"],
      ["charBuilderClassValue", "charBuilderClassLabel", "Class"],
      ["charBuilderBackgroundValue", "charBuilderBackgroundLabel", "Background"],
      ["charBuilderLevelValue", "charBuilderLevelLabel", "Level"],
    ].forEach(([valueId, labelId, label]) => {
      expect(document.getElementById(valueId).getAttribute("aria-labelledby")).toBe(labelId);
      expect(document.getElementById(labelId).textContent).toBe(label);
    });

    controller.destroy();
  });

  it("hides the Builder Identity panel for freeform characters", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = { id: "char_a", name: "Ada", build: null };

    const controller = initCharacterPageUI(deps);

    expect(document.getElementById("charBuilderIdentityPanel").hidden).toBe(true);
    expect(document.getElementById("charBuilderIdentityPanel").getAttribute("aria-hidden")).toBe("true");

    controller.destroy();
  });

  it("routes Builder Identity edits through the builder wizard without mutating state", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const builder = makeBuilderCharacter({ id: "char_a", raceId: "dwarf", classId: "wizard", level: 7 });
    deps.state.characters.entries[0] = builder;
    const snapshot = JSON.stringify(builder);

    const controller = initCharacterPageUI(deps);
    document.getElementById("charBuilderIdentityEditBtn")
      .dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    // The guarded wizard opens in edit mode, prefilled from the build; the
    // panel itself never wrote anything.
    expect(document.getElementById("builderWizardOverlay").hidden).toBe(false);
    expect(document.getElementById("builderWizardTitle").textContent).toBe("Edit with Builder");
    expect(document.getElementById("builderWizardRace").value).toBe("dwarf");
    expect(document.getElementById("builderWizardClass").value).toBe("wizard");
    expect(JSON.stringify(deps.state.characters.entries[0])).toBe(snapshot);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("renders derived identity for legacy or partial builds without mutating them", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = {
      id: "char_a",
      name: "Legacy Builder",
      build: {
        version: 1,
        ruleset: "srd-5.1",
        classId: "fighter",
        level: 3,
        abilities: { base: { str: 15 } }
      }
    };
    const beforeBuild = structuredClone(deps.state.characters.entries[0].build);

    const controller = initCharacterPageUI(deps);

    expect(isBuilderCharacter(deps.state.characters.entries[0])).toBe(true);
    expect(document.getElementById("charBuilderIdentityPanel").hidden).toBe(false);
    expect(document.getElementById("charBuilderClassValue").textContent).toBe("Fighter 3");
    expect(document.getElementById("charBuilderRaceValue").textContent).toBe("—");
    expect(document.getElementById("charBuilderLevelValue").textContent).toBe("3");
    expect(deps.state.characters.entries[0].build).toEqual(beforeBuild);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("shows placeholder identity values for new empty builder characters", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await finishBuilderWizardWith({
      name: "",
      raceId: "",
      classId: "",
      backgroundId: "",
      level: "1",
      abilities: { Str: 10, Dex: 10, Con: 10, Int: 10, Wis: 10, Cha: 10 }
    });

    const entry = deps.state.characters.entries[2];
    expect(entry.build).toMatchObject({
      version: 2,
      raceId: null,
      backgroundId: null,
      levels: []
    });
    expect(document.getElementById("charBuilderIdentityPanel").hidden).toBe(false);
    expect(document.getElementById("charBuilderRaceValue").textContent).toBe("—");
    // No class chosen: the derived label falls back to the bare level (the
    // same label Basics shows for this build state).
    expect(document.getElementById("charBuilderClassValue").textContent).toBe("1");
    expect(document.getElementById("charBuilderBackgroundValue").textContent).toBe("—");
    expect(document.getElementById("charBuilderLevelValue").textContent).toBe("1");

    controller.destroy();
  });

  it("refreshes and hides Builder Identity when the active character changes", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries = [
      makeBuilderCharacter({ id: "char_a", raceId: "elf", classId: "fighter", backgroundId: "acolyte", level: 5 }),
      { id: "char_b", name: "Bram", build: null },
      makeBuilderCharacter({ id: "char_c", raceId: "human", classId: "wizard", backgroundId: "acolyte", level: 1 })
    ];
    deps.state.characters.activeId = "char_a";

    const controller = initCharacterPageUI(deps);
    expect(document.getElementById("charBuilderRaceValue").textContent).toBe("Elf");

    deps.state.characters.activeId = "char_c";
    notifyActiveCharacterChanged({ previousId: "char_a", activeId: "char_c" });
    expect(document.getElementById("charBuilderIdentityPanel").hidden).toBe(false);
    expect(document.getElementById("charBuilderRaceValue").textContent).toBe("Human");
    expect(document.getElementById("charBuilderClassValue").textContent).toBe("Wizard 1");
    expect(document.getElementById("charBuilderLevelValue").textContent).toBe("1");

    deps.state.characters.activeId = "char_b";
    notifyActiveCharacterChanged({ previousId: "char_c", activeId: "char_b" });
    expect(document.getElementById("charBuilderIdentityPanel").hidden).toBe(true);

    controller.destroy();
  });

  it("does not duplicate Builder Identity routing listeners across re-initialization", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const firstController = initCharacterPageUI(deps);
    const secondController = initCharacterPageUI(deps);

    document.getElementById("charBuilderIdentityEditBtn")
      .dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(document.getElementById("builderWizardOverlay").hidden).toBe(false);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    firstController.destroy();
    secondController.destroy();
  });

  it("hides Builder Abilities for freeform characters without creating build data", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderAbilitiesDom(document);
    installFlatAbilitiesDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = { id: "char_a", name: "Ada", build: null };

    const controller = initCharacterPageUI(deps);

    expect(document.getElementById("charBuilderAbilitiesPanel").hidden).toBe(true);
    expect(document.getElementById("charBuilderAbilitiesPanel").getAttribute("aria-hidden")).toBe("true");
    expect(deps.state.characters.entries[0].build).toBeNull();
    ["str", "dex", "con", "int", "wis", "cha"].forEach((key) => {
      const score = document.getElementById(`flatAbilityScore-${key}`);
      expect(score.disabled).toBe(false);
      expect(score.readOnly).toBe(false);
      expect(score.getAttribute("readonly")).toBeNull();
    });

    controller.destroy();
  });

  it("shows read-only base scores for builder characters", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderAbilitiesDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const controller = initCharacterPageUI(deps);

    expect(document.getElementById("charBuilderAbilitiesPanel").hidden).toBe(false);
    expect(document.getElementById("charBuilderAbilitiesPanel").getAttribute("aria-hidden")).toBe("false");
    expect(document.getElementById("charBuilderAbilityStrValue").textContent).toBe("16");
    expect(document.getElementById("charBuilderAbilityDexValue").textContent).toBe("14");
    expect(document.getElementById("charBuilderAbilityConValue").textContent).toBe("13");
    expect(document.getElementById("charBuilderAbilityIntValue").textContent).toBe("12");
    expect(document.getElementById("charBuilderAbilityWisValue").textContent).toBe("10");
    expect(document.getElementById("charBuilderAbilityChaValue").textContent).toBe("8");
    // B1: no editable base-score inputs remain on the sheet panel.
    expect(document.getElementById("charBuilderAbilityStr")).toBeNull();
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("links Builder Abilities values to their visible labels", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderAbilitiesDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const controller = initCharacterPageUI(deps);

    [
      ["Str", "Strength"],
      ["Dex", "Dexterity"],
      ["Con", "Constitution"],
      ["Int", "Intelligence"],
      ["Wis", "Wisdom"],
      ["Cha", "Charisma"],
    ].forEach(([suffix, label]) => {
      expect(document.getElementById(`charBuilderAbility${suffix}Value`).getAttribute("aria-labelledby"))
        .toBe(`charBuilderAbility${suffix}Label`);
      expect(document.getElementById(`charBuilderAbility${suffix}Label`).textContent).toBe(label);
    });

    controller.destroy();
  });

  it("shows dashes for malformed base scores without mutating state", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderAbilitiesDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = {
      id: "char_a",
      name: "Malformed Builder",
      build: {
        version: 1,
        ruleset: "srd-5.1",
        classId: "fighter",
        level: 3,
        abilities: { base: { str: 15 } }
      }
    };
    const beforeBuild = structuredClone(deps.state.characters.entries[0].build);

    const controller = initCharacterPageUI(deps);

    expect(document.getElementById("charBuilderAbilitiesPanel").hidden).toBe(false);
    expect(document.getElementById("charBuilderAbilityStrValue").textContent).toBe("15");
    expect(document.getElementById("charBuilderAbilityDexValue").textContent).toBe("—");
    expect(deps.state.characters.entries[0].build).toEqual(beforeBuild);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("routes Builder Abilities edits through the builder wizard without mutating state", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderAbilitiesDom(document);
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const builder = makeBuilderCharacter({ id: "char_a" });
    deps.state.characters.entries[0] = builder;
    const snapshot = JSON.stringify(builder);

    const controller = initCharacterPageUI(deps);
    document.getElementById("charBuilderAbilitiesEditBtn")
      .dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(document.getElementById("builderWizardOverlay").hidden).toBe(false);
    expect(document.getElementById("builderWizardTitle").textContent).toBe("Edit with Builder");
    expect(JSON.stringify(deps.state.characters.entries[0])).toBe(snapshot);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("refreshes and hides Builder Abilities when the active character changes", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderAbilitiesDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries = [
      makeBuilderCharacter({
        id: "char_a",
        abilities: { str: 16, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }
      }),
      { id: "char_b", name: "Bram", build: null },
      makeBuilderCharacter({
        id: "char_c",
        abilities: { str: 8, dex: 10, con: 12, int: 14, wis: 16, cha: 18 }
      })
    ];
    deps.state.characters.activeId = "char_a";

    const controller = initCharacterPageUI(deps);
    expect(document.getElementById("charBuilderAbilityStrValue").textContent).toBe("16");

    deps.state.characters.activeId = "char_c";
    notifyActiveCharacterChanged({ previousId: "char_a", activeId: "char_c" });
    expect(document.getElementById("charBuilderAbilitiesPanel").hidden).toBe(false);
    expect(document.getElementById("charBuilderAbilityStrValue").textContent).toBe("8");
    expect(document.getElementById("charBuilderAbilityChaValue").textContent).toBe("18");

    deps.state.characters.activeId = "char_b";
    notifyActiveCharacterChanged({ previousId: "char_c", activeId: "char_b" });
    expect(document.getElementById("charBuilderAbilitiesPanel").hidden).toBe(true);

    controller.destroy();
  });

  it("shows the display-only Builder Summary for builder characters", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderSummaryDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a", name: "Ada" });

    const controller = initCharacterPageUI(deps);
    const panel = document.getElementById("charBuilderSummaryPanel");
    const content = document.getElementById("charBuilderSummaryContent");

    expect(panel.hidden).toBe(false);
    expect(panel.getAttribute("aria-hidden")).toBe("false");
    expect(panel.getAttribute("aria-describedby")).toBe("charBuilderSummaryDescription");
    expect(content.textContent).toContain("Live builder values shown here are for review");
    expect(content.textContent).toContain("Normal character panels are the play surface");
    expect(content.textContent).toContain("seeded Features / Traits and Languages text is user-owned after creation");
    expect(content.textContent).not.toContain("not saved into freeform fields");
    expect(content.textContent).toContain("Class / LevelFighter 5");
    expect(content.textContent).toContain("RaceElf");
    expect(content.textContent).toContain("BackgroundAcolyte");
    expect(content.textContent).toContain("Level5");
    expect(content.textContent).toContain("Proficiency Bonus+3");
    expect(content.textContent).toContain("STR16 (+3)");
    expect(content.textContent).toContain("CHA8 (-1)");

    controller.destroy();
  });

  it("hides the Builder Summary for freeform characters", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderSummaryDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = { id: "char_a", name: "Ada", build: null };

    const controller = initCharacterPageUI(deps);

    expect(document.getElementById("charBuilderSummaryPanel").hidden).toBe(true);
    expect(document.getElementById("charBuilderSummaryPanel").getAttribute("aria-hidden")).toBe("true");
    expect(document.getElementById("charBuilderSummaryContent").textContent).toBe("");

    controller.destroy();
  });

  it("hides the Builder Summary when builder data cannot produce safe derived abilities", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderSummaryDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = {
      id: "char_a",
      name: "Malformed Builder",
      build: {
        version: 1,
        ruleset: "srd-5.1",
        classId: "fighter",
        level: 3,
        abilities: { base: { str: 15 } }
      }
    };

    const controller = initCharacterPageUI(deps);

    expect(isBuilderCharacter(deps.state.characters.entries[0])).toBe(true);
    expect(document.getElementById("charBuilderSummaryPanel").hidden).toBe(true);
    expect(document.getElementById("charBuilderSummaryContent").textContent).toBe("");

    controller.destroy();
  });

  it("does not write Builder Summary values into persisted flat character fields", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderSummaryDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const builder = makeBuilderCharacter({
      id: "char_a",
      flatFields: {
        classLevel: "Legacy Wizard 19",
        race: "Legacy Species",
        background: "Legacy Background",
        proficiency: 42
      }
    });
    deps.state.characters.entries[0] = builder;

    const controller = initCharacterPageUI(deps);

    expect(document.getElementById("charBuilderSummaryContent").textContent).toContain("Fighter 5");
    expect(builder.classLevel).toBe("Legacy Wizard 19");
    expect(builder.race).toBe("Legacy Species");
    expect(builder.background).toBe("Legacy Background");
    expect(builder.proficiency).toBe(42);
    expect(builder.abilities.str).toEqual({ score: 3, mod: -4, save: -4 });
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("keeps Builder Summary display-only for builder characters", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderSummaryDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const controller = initCharacterPageUI(deps);

    expect(document.getElementById("charBuilderSummaryContent").textContent).toContain("Fighter 5");
    expect(deps.state.characters.entries[0].classLevel).toBe("Persisted Class");
    expect(deps.state.characters.entries[0].race).toBe("Persisted Race");
    expect(deps.state.characters.entries[0].background).toBe("Persisted Background");
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("updates or hides the Builder Summary when the active character changes", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderSummaryDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries = [
      makeBuilderCharacter({ id: "char_a", name: "Ada" }),
      { id: "char_b", name: "Bram", build: null },
      makeBuilderCharacter({
        id: "char_c",
        name: "Cora",
        classId: "wizard",
        raceId: null,
        backgroundId: null,
        level: 1,
        abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 12, cha: 8 }
      })
    ];
    deps.state.characters.activeId = "char_a";

    const controller = initCharacterPageUI(deps);
    expect(document.getElementById("charBuilderSummaryContent").textContent).toContain("Fighter 5");

    deps.state.characters.activeId = "char_c";
    notifyActiveCharacterChanged({ previousId: "char_a", activeId: "char_c" });
    expect(document.getElementById("charBuilderSummaryPanel").hidden).toBe(false);
    expect(document.getElementById("charBuilderSummaryContent").textContent).toContain("Wizard 1");
    expect(document.getElementById("charBuilderSummaryContent").textContent).toContain("RaceNot selected");
    expect(document.getElementById("charBuilderSummaryContent").textContent).toContain("INT16 (+3)");

    deps.state.characters.activeId = "char_b";
    notifyActiveCharacterChanged({ previousId: "char_c", activeId: "char_b" });
    expect(document.getElementById("charBuilderSummaryPanel").hidden).toBe(true);
    expect(document.getElementById("charBuilderSummaryContent").textContent).toBe("");

    controller.destroy();
  });

  it("keeps the empty-state prompt dismissed across Character page re-init for the same campaign", () => {
    const { document } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.appShell = { activeCampaignId: "campaign_empty_prompt" };
    deps.state.characters = { activeId: null, entries: [] };

    const firstController = initCharacterPageUI(deps);
    const emptyState = document.getElementById("charEmptyState");
    expect(emptyState.hidden).toBe(false);

    document.getElementById("charEmptyStateNo").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    expect(emptyState.hidden).toBe(true);

    firstController.destroy();
    const secondController = initCharacterPageUI(deps);
    expect(document.getElementById("charEmptyState").hidden).toBe(true);

    secondController.destroy();
  });

  it("closes the Character action overflow menu when Rename is cancelled", async () => {
    const { actionMenuButton } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.uiPrompt.mockResolvedValue(null);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionRenameBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(deps.uiPrompt).toHaveBeenCalledWith("Rename character to:", {
      defaultValue: "Ada",
      title: "Rename Character"
    });
    expect(deps.state.characters.entries[0].name).toBe("Ada");
    expect(document.getElementById("charActionDropdownMenu").hidden).toBe(true);

    controller.destroy();
  });

  it("keeps Delete confirmation dangerous and closes when cancelled", async () => {
    const { actionMenuButton } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.uiConfirm.mockResolvedValue(false);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionDeleteBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(deps.uiConfirm).toHaveBeenCalledWith("Delete \"Ada\"? This cannot be undone.", {
      title: "Delete Character",
      okText: "Delete"
    });
    expect(deps.state.characters.entries).toHaveLength(2);
    expect(deps.state.characters.activeId).toBe("char_a");
    expect(document.getElementById("charActionDropdownMenu").hidden).toBe(true);

    controller.destroy();
  });

  it("snapshots and unlinks cards before deleting a linked character", async () => {
    const { actionMenuButton } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.tracker.npcs = [
      {
        id: "npc_1",
        characterId: "char_a",
        name: "Old NPC",
        className: "Old Role",
        hpCurrent: 1,
        hpMax: 2,
        status: "Old",
        imgBlobId: "old-npc-portrait",
        notes: "NPC note"
      }
    ];
    deps.state.tracker.party = [
      {
        id: "party_1",
        characterId: "char_a",
        name: "Old Party",
        className: "Old Class",
        hpCurrent: 3,
        hpMax: 4,
        status: "Old Party",
        imgBlobId: "old-party-portrait",
        notes: "Party note"
      }
    ];
    deps.uiConfirm.mockResolvedValue(true);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionDeleteBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(deps.uiConfirm).toHaveBeenCalledWith(
      "Delete \"Ada\"? This cannot be undone.\n\nThis character has linked cards in: NPCs (1), Party (1). Linked cards will keep their last known data and become standalone.",
      { title: "Delete Character", okText: "Delete" }
    );
    expect(deps.state.characters.entries.map((entry) => entry.id)).toEqual(["char_b"]);
    expect(deps.state.characters.activeId).toBe("char_b");
    expect(deps.state.tracker.npcs[0]).toMatchObject({
      characterId: null,
      name: "Ada",
      className: "Wizard 5",
      hpCurrent: 7,
      hpMax: 20,
      ac: 15,
      status: "Poisoned",
      imgBlobId: "blob_ada",
      notes: "NPC note"
    });
    expect(deps.state.tracker.party[0]).toMatchObject({
      characterId: null,
      name: "Ada",
      className: "Wizard 5",
      hpCurrent: 7,
      hpMax: 20,
      ac: 15,
      status: "Poisoned",
      imgBlobId: "blob_ada",
      notes: "Party note"
    });

    controller.destroy();
  });

  // ---- delete-time snapshot retention copy (D4) ----------------------------
  // Deleting a character keeps its pre-Level-Up snapshots (retirement audit §3
  // D4 / restore spec §5). The confirmation says so — and only when a snapshot
  // for THIS character actually survives. Nothing here deletes a snapshot.
  const DELETE_BASE_COPY = "Delete \"Ada\"? This cannot be undone.";
  const DELETE_LINKED_WARNING =
    "\n\nThis character has linked cards in: NPCs (1). Linked cards will keep their last known data and become standalone.";
  const DELETE_RETENTION_NOTE =
    "\n\nSaved Level Up snapshots are kept — you can still restore this character from Restore Character.";

  function makeRetainedSnapshot(sourceCharacterId, id = `csnap_${sourceCharacterId}`) {
    return {
      id,
      kind: "pre-level-up",
      sourceCharacterId,
      sourceName: "Ada",
      classSummary: "Wizard 5",
      fromLevel: 5,
      toLevel: 6,
      toClassId: "wizard",
      createdAt: "2026-07-23T10:00:00.000Z",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      payload: { id: sourceCharacterId, name: "Ada" }
    };
  }

  async function runDeleteAndReadConfirmMessage(deps, actionMenuButton) {
    const controller = initCharacterPageUI(deps);
    clickEl(actionMenuButton);
    clickEl(document.getElementById("charActionDeleteBtn"));
    await flushPromises();
    const [message, options] = deps.uiConfirm.mock.calls.at(-1) || [];
    return { controller, message, options };
  }

  it("keeps the ordinary delete copy when the campaign has no snapshots", async () => {
    const { actionMenuButton } = installCharacterSelectorDom();
    const deps = createCharacterPageDeps(createFakePopovers());
    deps.state.characters.snapshots = [];
    deps.uiConfirm.mockResolvedValue(false);

    const { controller, message, options } = await runDeleteAndReadConfirmMessage(deps, actionMenuButton);

    expect(message).toBe(DELETE_BASE_COPY);
    expect(options).toEqual({ title: "Delete Character", okText: "Delete" });

    controller.destroy();
  });

  it("adds the retention paragraph when a snapshot for the deleted character is retained", async () => {
    const { actionMenuButton } = installCharacterSelectorDom();
    const deps = createCharacterPageDeps(createFakePopovers());
    deps.state.characters.snapshots = [makeRetainedSnapshot("char_a")];
    deps.uiConfirm.mockResolvedValue(false);

    const { controller, message, options } = await runDeleteAndReadConfirmMessage(deps, actionMenuButton);

    expect(message).toBe(`${DELETE_BASE_COPY}${DELETE_RETENTION_NOTE}`);
    expect(options).toEqual({ title: "Delete Character", okText: "Delete" });

    controller.destroy();
  });

  it("omits the retention paragraph when every snapshot belongs to another character", async () => {
    const { actionMenuButton } = installCharacterSelectorDom();
    const deps = createCharacterPageDeps(createFakePopovers());
    deps.state.characters.snapshots = [
      makeRetainedSnapshot("char_b"),
      makeRetainedSnapshot("char_gone", "csnap_gone")
    ];
    deps.uiConfirm.mockResolvedValue(false);

    const { controller, message } = await runDeleteAndReadConfirmMessage(deps, actionMenuButton);

    expect(message).toBe(DELETE_BASE_COPY);

    controller.destroy();
  });

  it("composes the retention paragraph after the existing linked-card warning", async () => {
    const { actionMenuButton } = installCharacterSelectorDom();
    const deps = createCharacterPageDeps(createFakePopovers());
    deps.state.tracker.npcs = [{ id: "npc_1", characterId: "char_a", name: "Old NPC" }];
    deps.state.characters.snapshots = [makeRetainedSnapshot("char_a")];
    deps.uiConfirm.mockResolvedValue(false);

    const { controller, message } = await runDeleteAndReadConfirmMessage(deps, actionMenuButton);

    expect(message).toBe(`${DELETE_BASE_COPY}${DELETE_LINKED_WARNING}${DELETE_RETENTION_NOTE}`);

    controller.destroy();
  });

  it("falls back to the ordinary copy for missing, non-array, or malformed snapshot data", async () => {
    const cases = [
      undefined,
      null,
      { csnap_1: makeRetainedSnapshot("char_a") },
      "csnap_1",
      [null, undefined, 0, "csnap_1", [], { id: "csnap_2" }, { sourceCharacterId: null }]
    ];

    for (const snapshots of cases) {
      const { actionMenuButton } = installCharacterSelectorDom();
      const deps = createCharacterPageDeps(createFakePopovers());
      if (snapshots !== undefined) deps.state.characters.snapshots = snapshots;
      deps.uiConfirm.mockResolvedValue(false);

      const { controller, message } = await runDeleteAndReadConfirmMessage(deps, actionMenuButton);

      expect(message).toBe(DELETE_BASE_COPY);
      expect(deps.state.characters.entries).toHaveLength(2);

      controller.destroy();
    }
  });

  it("retains every snapshot after the deletion is confirmed", async () => {
    const { actionMenuButton } = installCharacterSelectorDom();
    const deps = createCharacterPageDeps(createFakePopovers());
    const snapshots = [makeRetainedSnapshot("char_a"), makeRetainedSnapshot("char_b")];
    const before = JSON.parse(JSON.stringify(snapshots));
    deps.state.characters.snapshots = snapshots;
    deps.uiConfirm.mockResolvedValue(true);

    const { controller, message } = await runDeleteAndReadConfirmMessage(deps, actionMenuButton);

    expect(message).toBe(`${DELETE_BASE_COPY}${DELETE_RETENTION_NOTE}`);
    expect(deps.state.characters.entries.map((entry) => entry.id)).toEqual(["char_b"]);
    expect(deps.state.characters.activeId).toBe("char_b");
    expect(deps.state.characters.snapshots).toEqual(before);

    controller.destroy();
  });
});

describe("builder wizard preserves interleaved multiclass level order", () => {
  // Concrete interleaved edit-mode fixture: Fighter 1 → Wizard 1 → Fighter 2.
  function makeInterleavedBuilder(id = "char_a") {
    const entry = makeDefaultBuilderCharacterEntry("Interleaved Mira");
    entry.id = id;
    entry.build.raceId = "dwarf";
    entry.build.backgroundId = "acolyte";
    entry.build.levels = [
      { classId: "fighter", hp: null },
      { classId: "wizard", hp: 4 },
      { classId: "fighter", hp: 7 }
    ];
    entry.build.abilities.base = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
    return entry;
  }

  function openWizardEdit(document, actionMenuButton) {
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionEditBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
  }

  async function finishFromSummary() {
    advanceBuilderWizardToStep("builderWizardStepSummary");
    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
  }

  function setupEditMode(builder) {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = builder;
    deps.state.characters.activeId = builder.id;
    const controller = initCharacterPageUI(deps);
    openWizardEdit(document, actionMenuButton);
    expect(document.getElementById("builderWizardPanel").hidden).toBe(false);
    return { document, deps, controller };
  }

  it("preserves Fighter 1 → Wizard 1 → Fighter 2 after opening and finishing with no changes", async () => {
    const { deps, controller } = setupEditMode(makeInterleavedBuilder("char_a"));

    await finishFromSummary();

    const updated = deps.state.characters.entries.find((e) => e.id === "char_a");
    expect(updated.build.levels).toEqual([
      { classId: "fighter", hp: null },
      { classId: "wizard", hp: 4 },
      { classId: "fighter", hp: 7 }
    ]);

    controller.destroy();
  });

  it("preserves the order and HP-to-level association after editing HP", async () => {
    const { document, deps, controller } = setupEditMode(makeInterleavedBuilder("char_a"));

    advanceBuilderWizardToStep("builderWizardStepClasses");
    const body = document.getElementById("builderWizardClassesBody");
    const hpInputs = body.querySelectorAll(".builderLevelHpInput");
    // Two HP inputs: level 2 (Wizard) and level 3 (Fighter). Edit level 3's.
    expect(hpInputs).toHaveLength(2);
    hpInputs[1].value = "9";
    hpInputs[1].dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));

    await finishFromSummary();

    const updated = deps.state.characters.entries.find((e) => e.id === "char_a");
    // Order intact; the new roll landed on the level-3 Fighter, not the Wizard.
    expect(updated.build.levels).toEqual([
      { classId: "fighter", hp: null },
      { classId: "wizard", hp: 4 },
      { classId: "fighter", hp: 9 }
    ]);

    controller.destroy();
  });

  it("preserves the order after adding a new level", async () => {
    const { document, deps, controller } = setupEditMode(makeInterleavedBuilder("char_a"));

    advanceBuilderWizardToStep("builderWizardStepClasses");
    const body = document.getElementById("builderWizardClassesBody");
    const addBtn = body.querySelector(".builderAddLevelBtn");
    expect(addBtn).not.toBeNull();
    addBtn.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    await finishFromSummary();

    const updated = deps.state.characters.entries.find((e) => e.id === "char_a");
    // The added level appends at the end (defaults to the most recent class);
    // the interleaved history ahead of it is untouched.
    expect(updated.build.levels).toEqual([
      { classId: "fighter", hp: null },
      { classId: "wizard", hp: 4 },
      { classId: "fighter", hp: 7 },
      { classId: "fighter", hp: null }
    ]);

    controller.destroy();
  });

  it("preserves ASI/feat choice ids when the level order is unchanged", async () => {
    // Fighter reaches its first ASI at Fighter level 4. Interleave so that
    // is character level 5, and stash a feat choice there.
    const builder = makeDefaultBuilderCharacterEntry("ASI Mira");
    builder.id = "char_a";
    builder.build.raceId = "dwarf";
    builder.build.backgroundId = "acolyte";
    builder.build.levels = [
      { classId: "fighter", hp: null },
      { classId: "wizard", hp: null },
      { classId: "fighter", hp: null },
      { classId: "fighter", hp: null },
      { classId: "fighter", hp: null }
    ];
    builder.build.abilities.base = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
    builder.build.choicesByLevel = { "5": { "asi-5": { type: "feat", featId: "grappler" } } };

    const { deps, controller } = setupEditMode(builder);

    await finishFromSummary();

    const updated = deps.state.characters.entries.find((e) => e.id === "char_a");
    expect(updated.build.levels.map((row) => row.classId))
      .toEqual(["fighter", "wizard", "fighter", "fighter", "fighter"]);
    // The ASI/feat choice id survived (order unchanged → not pruned/moved).
    expect(updated.build.choicesByLevel["5"]["asi-5"]).toEqual({ type: "feat", featId: "grappler" });
    expect(deriveCharacter(updated).featIds).toContain("grappler");

    controller.destroy();
  });
});

describe("level up flow", () => {
  function setupLevelUp(character, { extraEntries = [] } = {}) {
    const dom = installCharacterSelectorDom();
    installLevelUpWizardDom(dom.document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries = [character, ...extraEntries];
    deps.state.characters.activeId = character.id;
    const controller = initCharacterPageUI(deps);
    return { ...dom, deps, controller };
  }

  it("disables Level Up for freeform characters and at level 20, enables below 20", () => {
    const freeform = { id: "char_free", name: "Manual Mira", build: null };
    const first = setupLevelUp(freeform);
    expect(document.getElementById("charActionLevelUpBtn").disabled).toBe(true);
    expect(document.getElementById("charActionLevelUpBtn").getAttribute("aria-disabled")).toBe("true");
    first.controller.destroy();

    const twenty = makeLeveledBuilderCharacter({
      id: "char_twenty",
      levels: Array.from({ length: 20 }, () => ({ classId: "fighter", hp: null })),
      subclassByClass: { fighter: "champion" }
    });
    const second = setupLevelUp(twenty);
    expect(document.getElementById("charActionLevelUpBtn").disabled).toBe(true);
    second.controller.destroy();

    const five = makeLeveledBuilderCharacter({
      id: "char_five",
      levels: Array.from({ length: 5 }, () => ({ classId: "fighter", hp: null })),
      subclassByClass: { fighter: "champion" }
    });
    const third = setupLevelUp(five);
    expect(document.getElementById("charActionLevelUpBtn").disabled).toBe(false);
    third.controller.destroy();
  });

  it("opening Level Up mutates nothing and does not mark dirty", () => {
    const character = makeLeveledBuilderCharacter();
    const snapshot = JSON.stringify(character);
    const { deps, controller, actionMenuButton } = setupLevelUp(character);

    openLevelUp(actionMenuButton);

    expect(document.getElementById("levelUpOverlay").hidden).toBe(false);
    expect(JSON.stringify(deps.state.characters.entries[0])).toBe(snapshot);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    expect(deps.state.characters.snapshots ?? []).toHaveLength(0);

    controller.destroy();
  });

  it("cancels from any step without mutating or marking dirty", () => {
    const character = makeLeveledBuilderCharacter({ flatFields: { hpMax: 12, hpCur: 12 } });
    const snapshot = JSON.stringify(character);
    const { deps, controller, actionMenuButton } = setupLevelUp(character);

    openLevelUp(actionMenuButton);
    clickLevelUp(document, "levelUpNext"); // class → features
    clickLevelUp(document, "levelUpNext"); // features → hp
    clickLevelUp(document, "levelUpCancel");

    expect(document.getElementById("levelUpOverlay").hidden).toBe(true);
    expect(JSON.stringify(deps.state.characters.entries[0])).toBe(snapshot);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    expect(deps.state.characters.snapshots ?? []).toHaveLength(0);

    controller.destroy();
  });

  it("closes on Escape without mutating or marking dirty", () => {
    const character = makeLeveledBuilderCharacter();
    const snapshot = JSON.stringify(character);
    const { deps, controller, actionMenuButton } = setupLevelUp(character);

    openLevelUp(actionMenuButton);
    const event = new Event("keydown", { bubbles: true, cancelable: true });
    event.key = "Escape";
    document.dispatchEvent(event);

    expect(document.getElementById("levelUpOverlay").hidden).toBe(true);
    expect(JSON.stringify(deps.state.characters.entries[0])).toBe(snapshot);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    expect(deps.state.characters.snapshots ?? []).toHaveLength(0);

    controller.destroy();
  });

  it("applies exactly one level, marks dirty once, and seeds the sheet", async () => {
    const character = makeLeveledBuilderCharacter({
      flatFields: { hpMax: 12, hpCur: 9, features: "" }
    });
    const { deps, controller, actionMenuButton } = setupLevelUp(character);

    openLevelUp(actionMenuButton);
    clickLevelUp(document, "levelUpNext"); // class → features (Action Surge)
    clickLevelUp(document, "levelUpNext"); // features → hp (average default)
    clickLevelUp(document, "levelUpNext"); // hp → summary
    expect(document.getElementById("levelUpStepSummary").hidden).toBe(false);
    clickLevelUp(document, "levelUpApply");
    await flushPromises();

    const updated = deps.state.characters.entries.find((e) => e.id === "char_levelup");
    expect(updated.build.levels).toHaveLength(2);
    expect(updated.build.levels[1]).toEqual({ classId: "fighter", hp: null });
    // Human Con 14 (+2): 12 → 20; wounded gap preserved (9 → 17).
    expect(updated.hpMax).toBe(20);
    expect(updated.hpCur).toBe(17);
    expect(updated.features).toContain("Action Surge");
    expect(updated.features).toContain("(Fighter 2)");
    // Phase 2: the newly unlocked Action Surge pool arrives full and marked.
    const surge = updated.resources.find((resource) => resource.builderSeed === "class-resource:action-surge");
    expect(surge).toMatchObject({ name: "Action Surge", cur: 1, max: 1, recovery: "shortOrLongRest" });
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(document.getElementById("levelUpOverlay").hidden).toBe(true);
    expect(deps.setStatus).toHaveBeenCalledWith("Level Up applied — now level 2.", { stickyMs: 2000 });

    controller.destroy();
  });

  it("a double-click on Apply cannot append two levels", async () => {
    const character = makeLeveledBuilderCharacter({ flatFields: { hpMax: 12, hpCur: 12 } });
    const { deps, controller, actionMenuButton } = setupLevelUp(character);

    openLevelUp(actionMenuButton);
    clickLevelUp(document, "levelUpNext");
    clickLevelUp(document, "levelUpNext");
    clickLevelUp(document, "levelUpNext");
    clickLevelUp(document, "levelUpApply");
    clickLevelUp(document, "levelUpApply");
    await flushPromises();

    const updated = deps.state.characters.entries.find((e) => e.id === "char_levelup");
    expect(updated.build.levels).toHaveLength(2);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);
    // Repeated submission captured exactly one pre-Level-Up snapshot.
    expect(deps.state.characters.snapshots).toHaveLength(1);

    controller.destroy();
  });

  it("requires the newly unlocked subclass before applying", async () => {
    const character = makeLeveledBuilderCharacter({
      levels: [
        { classId: "fighter", hp: null },
        { classId: "fighter", hp: null }
      ],
      flatFields: { hpMax: 20, hpCur: 20 }
    });
    const { deps, controller, actionMenuButton } = setupLevelUp(character);

    openLevelUp(actionMenuButton);
    clickLevelUp(document, "levelUpNext"); // class → subclass
    expect(document.getElementById("levelUpStepSubclass").hidden).toBe(false);
    clickLevelUp(document, "levelUpNext"); // blocked: no subclass chosen
    expect(document.getElementById("levelUpStepSubclass").hidden).toBe(false);
    expect(document.getElementById("levelUpSubclassValidation").hidden).toBe(false);

    const select = document.getElementById("levelUpSubclassSelect");
    select.value = "champion";
    dispatchChange(select);
    clickLevelUp(document, "levelUpNext"); // subclass → features
    clickLevelUp(document, "levelUpNext"); // features → hp
    clickLevelUp(document, "levelUpNext"); // hp → summary
    clickLevelUp(document, "levelUpApply");
    await flushPromises();

    const updated = deps.state.characters.entries.find((e) => e.id === "char_levelup");
    expect(updated.build.levels).toHaveLength(3);
    expect(updated.build.subclassByClass.fighter).toBe("champion");
    expect(updated.features).toContain("Improved Critical");

    controller.destroy();
  });

  it("cancels safely when the active character changes while the flow is open", () => {
    const character = makeLeveledBuilderCharacter();
    const other = { id: "char_other", name: "Other", build: null };
    const snapshotA = JSON.stringify(character);
    const snapshotB = JSON.stringify(other);
    const { deps, controller, actionMenuButton } = setupLevelUp(character, { extraEntries: [other] });

    openLevelUp(actionMenuButton);
    expect(document.getElementById("levelUpOverlay").hidden).toBe(false);

    deps.state.characters.activeId = "char_other";
    notifyActiveCharacterChanged({ previousId: "char_levelup", activeId: "char_other" });

    expect(document.getElementById("levelUpOverlay").hidden).toBe(true);
    expect(JSON.stringify(deps.state.characters.entries[0])).toBe(snapshotA);
    expect(JSON.stringify(deps.state.characters.entries[1])).toBe(snapshotB);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    expect(deps.setStatus).toHaveBeenCalledWith(
      "Level Up was canceled because the active character changed.", { stickyMs: 2500 });

    controller.destroy();
  });

  it("refuses to apply to a different character even without the change event", async () => {
    const character = makeLeveledBuilderCharacter({ flatFields: { hpMax: 12, hpCur: 12 } });
    const other = { id: "char_other", name: "Other", build: null };
    const { deps, controller, actionMenuButton } = setupLevelUp(character, { extraEntries: [other] });

    openLevelUp(actionMenuButton);
    clickLevelUp(document, "levelUpNext");
    clickLevelUp(document, "levelUpNext");
    clickLevelUp(document, "levelUpNext");
    // Simulate a silent switch (no event) between Summary and Apply.
    deps.state.characters.activeId = "char_other";
    clickLevelUp(document, "levelUpApply");
    await flushPromises();

    expect(deps.state.characters.entries[0].build.levels).toHaveLength(1);
    expect(deps.state.characters.entries[1].build).toBeNull();
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    expect(deps.state.characters.snapshots ?? []).toHaveLength(0);
    expect(deps.setStatus).toHaveBeenCalledWith(
      "Level Up was canceled because the active character changed.", { stickyMs: 2500 });

    controller.destroy();
  });

  it("blocks the flow with a validation message when the class is not in the registry", () => {
    const character = makeLeveledBuilderCharacter({
      levels: [{ classId: "mystery-class", hp: null }]
    });
    const snapshot = JSON.stringify(character);
    const { deps, controller, actionMenuButton } = setupLevelUp(character);

    openLevelUp(actionMenuButton);
    clickLevelUp(document, "levelUpNext");

    // The malformed class cannot produce a plan; the flow refuses to advance.
    expect(document.getElementById("levelUpStepClass").hidden).toBe(false);
    expect(document.getElementById("levelUpClassValidation").hidden).toBe(false);
    expect(JSON.stringify(deps.state.characters.entries[0])).toBe(snapshot);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    expect(deps.state.characters.snapshots ?? []).toHaveLength(0);

    controller.destroy();
  });

  it("a successful apply captures exactly one complete pre-Level-Up snapshot in the same mutation", async () => {
    const character = makeLeveledBuilderCharacter({ flatFields: { hpMax: 12, hpCur: 9 } });
    const before = JSON.parse(JSON.stringify(character));
    const { deps, controller, actionMenuButton } = setupLevelUp(character);

    openLevelUp(actionMenuButton);
    clickLevelUp(document, "levelUpNext"); // class → features
    clickLevelUp(document, "levelUpNext"); // features → hp
    clickLevelUp(document, "levelUpNext"); // hp → summary
    clickLevelUp(document, "levelUpApply");
    await flushPromises();

    // The capture happened inside the same mutation as the level-up commit:
    // one markDirty covers both, so the single vault write persists them
    // together (Restore Character R1).
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);
    const snapshots = deps.state.characters.snapshots;
    expect(snapshots).toHaveLength(1);
    const record = snapshots[0];
    expect(record.id).toMatch(/^csnap_/);
    expect(record.kind).toBe("pre-level-up");
    expect(record.sourceCharacterId).toBe("char_levelup");
    expect(record.sourceName).toBe("Level Up Mira");
    expect(record.classSummary).toBe("Fighter 1");
    expect(record.fromLevel).toBe(1);
    expect(record.toLevel).toBe(2);
    expect(record.toClassId).toBe("fighter");
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(record.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    // The payload is the complete pre-Level-Up character, not the advanced one.
    expect(record.payload).toEqual(before);

    // The playable character advanced normally alongside the capture.
    const updated = deps.state.characters.entries.find((e) => e.id === "char_levelup");
    expect(updated.build.levels).toHaveLength(2);
    expect(updated.hpMax).toBe(20);

    controller.destroy();
  });

  it("later edits to the advanced character never leak into the captured snapshot", async () => {
    const character = makeLeveledBuilderCharacter({ flatFields: { hpMax: 12, hpCur: 12 } });
    const { deps, controller, actionMenuButton } = setupLevelUp(character);

    openLevelUp(actionMenuButton);
    clickLevelUp(document, "levelUpNext");
    clickLevelUp(document, "levelUpNext");
    clickLevelUp(document, "levelUpNext");
    clickLevelUp(document, "levelUpApply");
    await flushPromises();

    const record = deps.state.characters.snapshots[0];
    const frozen = JSON.parse(JSON.stringify(record.payload));

    const updated = deps.state.characters.entries.find((e) => e.id === "char_levelup");
    updated.name = "Renamed After Level Up";
    updated.hpCur = 1;
    updated.build.levels.push({ classId: "fighter", hp: 6 });
    updated.resources.push({ id: "res_new", name: "New Pool", cur: 0, max: 1 });

    expect(record.payload).toEqual(frozen);
    expect(record.payload.name).toBe("Level Up Mira");
    expect(record.payload.build.levels).toHaveLength(1);

    controller.destroy();
  });

  it("deleting the source character keeps its snapshots", async () => {
    const character = makeLeveledBuilderCharacter({ flatFields: { hpMax: 12, hpCur: 12 } });
    const other = { id: "char_other", name: "Other", build: null };
    const { deps, controller, actionMenuButton } = setupLevelUp(character, { extraEntries: [other] });
    deps.uiConfirm.mockResolvedValue(true);

    openLevelUp(actionMenuButton);
    clickLevelUp(document, "levelUpNext");
    clickLevelUp(document, "levelUpNext");
    clickLevelUp(document, "levelUpNext");
    clickLevelUp(document, "levelUpApply");
    await flushPromises();
    expect(deps.state.characters.snapshots).toHaveLength(1);

    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionDeleteBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(deps.state.characters.entries.map((entry) => entry.id)).toEqual(["char_other"]);
    // Snapshots are campaign-owned: the source character's history survives
    // its deletion and stays restorable (spec §5; owner decision D4).
    expect(deps.state.characters.snapshots).toHaveLength(1);
    expect(deps.state.characters.snapshots[0].sourceCharacterId).toBe("char_levelup");

    controller.destroy();
  });

  // ---- R1 persistence-failure lifecycle ----------------------------------
  // These tests use the module-level setupCharacterPageWithRealPersistence()
  // harness: the page is wired to the REAL persistence pipeline so a forced
  // vault-write failure exercises the exact production path and pins what it
  // can and cannot leave behind (restore-character-spec.md §4.1–§4.3).

  it("a failed vault write after Level Up persists neither the snapshot nor the advancement, and never lets them split", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => { });
    const character = makeLeveledBuilderCharacter({ flatFields: { hpMax: 12, hpCur: 9 } });
    const h = setupCharacterPageWithRealPersistence(character);

    // Baseline: persist the pre-Level-Up campaign once, successfully.
    h.SaveManager.markDirty();
    await h.SaveManager.flush();
    const baselineRaw = h.readPersistedRaw();
    expect(baselineRaw).toBeTruthy();
    const baselineDoc = h.readPersistedDoc();
    expect(baselineDoc.characters.entries[0].build.levels).toHaveLength(1);
    expect(baselineDoc.characters.snapshots ?? []).toHaveLength(0);

    // Force the vault write to fail, then apply a real Level Up.
    h.storage.failWrites = true;
    openLevelUp(h.actionMenuButton);
    clickLevelUp(document, "levelUpNext"); // class → features
    clickLevelUp(document, "levelUpNext"); // features → hp
    clickLevelUp(document, "levelUpNext"); // hp → summary
    clickLevelUp(document, "levelUpApply");
    await flushPromises();
    await h.SaveManager.flush(); // the queued save attempt → write fails

    // Persisted state is byte-identical to the baseline: no persisted
    // snapshot, no persisted level advancement. The vault is one atomic
    // localStorage key, so a partial persist cannot exist.
    expect(h.readPersistedRaw()).toBe(baselineRaw);

    // The failed attempt cannot be committed later: saveAllLocal discards
    // the failed vault object (vaultRuntime.current is only reassigned on
    // success), and every future save re-extracts from live state.
    const cachedDoc = h.vaultRuntime.current.campaignDocs.campaign_alpha;
    expect(cachedDoc.characters.entries[0].build.levels).toHaveLength(1);
    expect(cachedDoc.characters.snapshots ?? []).toHaveLength(0);

    // Live state keeps the committed pair TOGETHER — advanced character and
    // snapshot, never one without the other. Spec §4.3 save-failure
    // semantics: in-memory truth stays consistent and dirty for retry (an
    // automatic rollback would destroy the user's applied Level Up while the
    // export banner exists precisely to save that in-memory truth).
    const live = h.deps.state.characters;
    expect(live.entries[0].build.levels).toHaveLength(2);
    expect(live.snapshots).toHaveLength(1);
    expect(live.snapshots[0]).toMatchObject({
      kind: "pre-level-up",
      sourceCharacterId: "char_levelup",
      fromLevel: 1,
      toLevel: 2
    });

    // The user got the existing error handling: ERROR lifecycle, the
    // export banner, and the status message.
    expect(h.SaveManager.getStatus()).toMatchObject({ stateNow: "ERROR", dirty: true });
    expect(h.saveStatus).toHaveBeenCalledWith("Save failed (local). Export a backup.");
    expect(h.showSaveBanner).toHaveBeenCalled();

    // Interruption equivalence: reloading the persisted vault right now
    // yields the consistent pre-Level-Up state — snapshot and advancement
    // are absent together; a split state cannot be constructed from storage.
    const reloaded = h.projectPersistedState();
    expect(reloaded.characters.entries[0].build.levels).toHaveLength(1);
    expect(reloaded.characters.snapshots).toEqual([]);

    // Recovery: a later unrelated save re-extracts live state and commits
    // the pair atomically alongside the unrelated edit — still never split.
    h.storage.failWrites = false;
    h.deps.state.tracker.campaignTitle = "After Failure";
    h.SaveManager.markDirty();
    await h.SaveManager.flush();
    const recoveredDoc = h.readPersistedDoc();
    expect(recoveredDoc.tracker.campaignTitle).toBe("After Failure");
    expect(recoveredDoc.characters.entries[0].build.levels).toHaveLength(2);
    expect(recoveredDoc.characters.snapshots).toHaveLength(1);
    expect(recoveredDoc.characters.snapshots[0].payload.build.levels).toHaveLength(1);
    expect(h.hideSaveBanner).toHaveBeenCalled();
    expect(h.SaveManager.getStatus()).toMatchObject({ stateNow: "SAVED", dirty: false });

    h.SaveManager.init();
    h.controller.destroy();
  });

  it("a Level Up apply that fails mid-commit leaves no live snapshot or advancement, and a later unrelated save persists no trace of it", async () => {
    const character = makeLeveledBuilderCharacter({ flatFields: { hpMax: 12, hpCur: 9 } });
    const h = setupCharacterPageWithRealPersistence(character);

    h.SaveManager.markDirty();
    await h.SaveManager.flush();

    openLevelUp(h.actionMenuButton);
    clickLevelUp(document, "levelUpNext"); // class → features
    clickLevelUp(document, "levelUpNext"); // features → hp
    clickLevelUp(document, "levelUpNext"); // hp → summary
    // Make the pre-commit deep clone fail after the wizard has validated:
    // the apply mutation aborts ("snapshot-failed") before writing anything,
    // because all validation and construction precede every write.
    const live = h.deps.state.characters.entries[0];
    live.__cycle = live;
    clickLevelUp(document, "levelUpApply");
    await flushPromises();
    delete live.__cycle;

    // No live snapshot left behind, no live level advancement left behind.
    expect(live.build.levels).toHaveLength(1);
    expect(h.deps.state.characters.snapshots ?? []).toHaveLength(0);
    // The user got the existing failure status; nothing was queued to save.
    expect(h.deps.setStatus).toHaveBeenCalledWith(
      "Level Up could not be applied. No changes were made.",
      { stickyMs: 2500 }
    );
    expect(h.SaveManager.getStatus().dirty).toBe(false);

    // A later unrelated save cannot commit any part of the failed Level Up:
    // it persists live state, which never gained a snapshot or a level.
    h.deps.state.tracker.campaignTitle = "Unrelated Edit";
    h.SaveManager.markDirty();
    await h.SaveManager.flush();
    const doc = h.readPersistedDoc();
    expect(doc.tracker.campaignTitle).toBe("Unrelated Edit");
    expect(doc.characters.entries[0].build.levels).toHaveLength(1);
    expect(doc.characters.snapshots ?? []).toHaveLength(0);

    h.SaveManager.init();
    h.controller.destroy();
  });
});

describe("Restore Character (R3) — page-level lifecycle", () => {
  /** A retained snapshot whose source character no longer exists in the campaign. */
  function makeOrphanedSnapshot({
    id = "csnap_deleted_1",
    sourceCharacterId = "char_gone",
    sourceName = "Deleted Mira"
  } = {}) {
    return {
      id,
      kind: "pre-level-up",
      sourceCharacterId,
      sourceName,
      classSummary: "Fighter 1",
      fromLevel: 1,
      toLevel: 2,
      toClassId: "fighter",
      createdAt: "2026-07-21T10:00:00.000Z",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      payload: makeLeveledBuilderCharacter({
        id: sourceCharacterId,
        name: sourceName,
        flatFields: { hpMax: 12, hpCur: 9 }
      })
    };
  }

  function openRestoreDialog(actionMenuButton) {
    clickEl(actionMenuButton);
    clickEl(document.getElementById("charActionRestoreBtn"));
  }

  const restoreRowButtons = () => document.querySelectorAll(".restoreCharacterRestoreBtn");
  const statusMessages = (setStatus) => setStatus.mock.calls.map(([message]) => String(message));

  // ---- real-persistence failure and retry ---------------------------------
  // Production-shaped end to end: the real Restore Character UI drives the real
  // R2 engine, which commits through the real SaveManager → saveAllLocal →
  // campaign vault → a stubbed localStorage whose write is forced to fail. No
  // portrait or spell-note assets are involved (R2 owns asset ownership); this
  // pins only the persistence boundary (spec §4.1–§4.3, §5).
  it("locks the dialog on a failed vault write, then finalizes exactly once when Retry Save succeeds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => { });
    const character = makeLeveledBuilderCharacter({ flatFields: { hpMax: 12, hpCur: 9 } });
    // deps.migrateState is the engine's own migration boundary and is called
    // exactly once per restoreCharacterFromSnapshot(), so this spy counts
    // engine invocations. The vault keeps the real migrateState import.
    const engineMigrate = vi.fn((raw) => migrateState(raw));
    const h = setupCharacterPageWithRealPersistence(character, { migrateStateImpl: engineMigrate });
    h.deps.uiConfirm.mockResolvedValue(true);

    // 1. A persisted campaign with one live character and one retained
    //    snapshot, produced by a real Level Up and a successful save.
    openLevelUp(h.actionMenuButton);
    clickLevelUp(document, "levelUpNext"); // class → features
    clickLevelUp(document, "levelUpNext"); // features → hp
    clickLevelUp(document, "levelUpNext"); // hp → summary
    clickLevelUp(document, "levelUpApply");
    await flushPromises();
    h.SaveManager.markDirty();
    await h.SaveManager.flush();

    const snapshotId = h.deps.state.characters.snapshots[0].id;
    const baselineRaw = h.readPersistedRaw();
    const baselineDoc = h.readPersistedDoc();
    expect(baselineDoc.characters.entries).toHaveLength(1);
    expect(baselineDoc.characters.snapshots).toHaveLength(1);
    expect(h.SaveManager.getStatus()).toMatchObject({ stateNow: "SAVED", dirty: false });
    expect(engineMigrate).not.toHaveBeenCalled();

    // Watch the two finalization side effects that must not fire early.
    /** @type {unknown[]} */
    const activeChanges = [];
    const onActiveChanged = (event) => activeChanges.push(event.detail ?? null);
    window.addEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, onActiveChanged);

    // 2. Force the campaign-vault write to fail.
    h.storage.failWrites = true;

    // 3. Restore through the real Character-page UI.
    openRestoreDialog(h.actionMenuButton);
    const overlay = document.getElementById("restoreCharacterOverlay");
    expect(overlay.hidden).toBe(false);
    const rows = restoreRowButtons();
    expect(rows).toHaveLength(1);
    expect(rows[0].dataset.snapshotId).toBe(snapshotId);
    clickEl(rows[0]);
    await flushPromises();

    // 4. Exactly one restored character is committed in memory.
    const live = h.deps.state.characters;
    expect(live.entries).toHaveLength(2);
    const restored = live.entries[1];
    expect(restored.id).not.toBe("char_levelup");
    expect(restored.name).toBe("Level Up Mira — Restored Level 1");
    expect(restored.restoredFromSnapshotId).toBe(snapshotId);
    expect(restored.restoredFromCharacterId).toBe("char_levelup");
    expect(restored.build.levels).toHaveLength(1);
    expect(live.activeId).toBe(restored.id);
    expect(engineMigrate).toHaveBeenCalledTimes(1);
    // The source character is untouched and the snapshot is not consumed.
    expect(live.entries[0].build.levels).toHaveLength(2);
    expect(live.snapshots).toHaveLength(1);

    // 5. The persisted vault is byte-identical to its previous state.
    expect(h.readPersistedRaw()).toBe(baselineRaw);

    // 6. The dialog stays open and locked.
    expect(overlay.hidden).toBe(false);
    expect(document.getElementById("restoreCharacterPending").hidden).toBe(false);
    expect(document.getElementById("restoreCharacterClose").disabled).toBe(true);
    expect(document.getElementById("restoreCharacterCancel").disabled).toBe(true);
    expect(restoreRowButtons().map((button) => button.disabled)).toEqual([true]);

    // 7. Retry Save is visible, enabled, and focused.
    const retryBtn = document.getElementById("restoreCharacterRetrySave");
    expect(retryBtn.hidden).toBe(false);
    expect(retryBtn.disabled).toBe(false);
    expect(document.activeElement).toBe(retryBtn);

    // 8. Nothing has been announced as done: no success status, no
    //    active-character notification.
    expect(activeChanges).toHaveLength(0);
    expect(statusMessages(h.deps.setStatus).some((m) => m.startsWith("Restored \""))).toBe(false);
    expect(statusMessages(h.deps.setStatus)).toContain("Restore not yet saved — choose Retry Save.");

    // 9. Close, Cancel, Escape, overlay click, and repeated Restore can
    //    neither dismiss the pending operation nor create a second character.
    const entriesBefore = JSON.stringify(live.entries);
    clickEl(document.getElementById("restoreCharacterClose"));
    clickEl(document.getElementById("restoreCharacterCancel"));
    const escape = new Event("keydown", { bubbles: true, cancelable: true });
    escape.key = "Escape";
    document.dispatchEvent(escape);
    clickEl(overlay);
    restoreRowButtons().forEach((button) => clickEl(button));
    await flushPromises();

    expect(overlay.hidden).toBe(false);
    expect(document.getElementById("restoreCharacterPending").hidden).toBe(false);
    expect(live.entries).toHaveLength(2);
    expect(JSON.stringify(live.entries)).toBe(entriesBefore);
    expect(engineMigrate).toHaveBeenCalledTimes(1);
    expect(h.readPersistedRaw()).toBe(baselineRaw);
    expect(activeChanges).toHaveLength(0);

    // 10. The existing save-failure recovery affordances stay available.
    expect(h.SaveManager.getStatus()).toMatchObject({ stateNow: "ERROR", dirty: true });
    expect(h.saveStatus).toHaveBeenCalledWith("Save failed (local). Export a backup.");
    expect(h.showSaveBanner).toHaveBeenCalled();

    // 11-12. Storage recovers; the user chooses Retry Save.
    h.storage.failWrites = false;
    clickEl(retryBtn);
    await flushPromises();

    // 13. Only persistence was retried — the engine never ran a second time,
    //     and the committed entry is the same object it always was.
    expect(engineMigrate).toHaveBeenCalledTimes(1);
    expect(h.deps.state.characters.entries).toHaveLength(2);
    expect(h.deps.state.characters.entries[1]).toBe(restored);
    expect(h.deps.state.characters.snapshots).toHaveLength(1);

    // 14. The dialog closed and finalized exactly once.
    expect(overlay.hidden).toBe(true);
    expect(activeChanges).toEqual([{ previousId: "char_levelup", activeId: restored.id }]);
    expect(statusMessages(h.deps.setStatus).filter((m) => m === `Restored "${restored.name}"`))
      .toHaveLength(1);
    expect(h.SaveManager.getStatus()).toMatchObject({ stateNow: "SAVED", dirty: false });
    expect(h.hideSaveBanner).toHaveBeenCalled();

    // 15. Everything survives a reload from the persisted vault.
    const reloaded = h.projectPersistedState();
    expect(reloaded.characters.entries).toHaveLength(2);
    const reloadedRestored = reloaded.characters.entries.find((entry) => entry.id === restored.id);
    expect(reloadedRestored).toBeTruthy();
    expect(reloadedRestored.name).toBe(restored.name);
    expect(reloadedRestored.build.levels).toHaveLength(1);
    expect(reloadedRestored.restoredFromSnapshotId).toBe(snapshotId);
    expect(reloadedRestored.restoredFromCharacterId).toBe("char_levelup");
    expect(reloadedRestored.restoredAt).toBe(restored.restoredAt);
    expect(reloaded.characters.activeId).toBe(restored.id);
    expect(reloaded.characters.snapshots).toHaveLength(1);
    expect(reloaded.characters.snapshots[0].id).toBe(snapshotId);

    window.removeEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, onActiveChanged);
    h.SaveManager.init();
    h.controller.destroy();
  });

  // ---- no live character --------------------------------------------------
  it("keeps Restore Character usable when every character is deleted but snapshots remain", async () => {
    const dom = installCharacterSelectorDom();
    installRestoreCharacterDialogDom(dom.document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const snapshot = makeOrphanedSnapshot();
    deps.state.characters = { activeId: null, entries: [], snapshots: [snapshot] };
    deps.migrateState = migrateState;
    deps.deleteText = vi.fn();
    deps.SaveManager.flush = vi.fn().mockResolvedValue(true);
    deps.uiConfirm.mockResolvedValue(true);
    const snapshotBefore = JSON.stringify(snapshot);

    const controller = initCharacterPageUI(deps);

    // Restore Character is campaign-scoped, so it stays enabled with no
    // active character; every active-character-only action is disabled.
    const restoreBtn = document.getElementById("charActionRestoreBtn");
    expect(restoreBtn.disabled).toBe(false);
    expect(restoreBtn.getAttribute("aria-disabled")).not.toBe("true");
    [
      "charActionEditBuilderBtn",
      "charActionLevelUpBtn",
      "charActionAddNpcBtn",
      "charActionAddPartyBtn",
      "charActionExportBtn",
      "charShortRestBtn",
      "charLongRestBtn"
    ].forEach((id) => {
      expect(document.getElementById(id).disabled).toBe(true);
      expect(document.getElementById(id).getAttribute("aria-disabled")).toBe("true");
    });

    // The retained snapshot is listed, labeled as a deleted source.
    openRestoreDialog(dom.actionMenuButton);
    expect(document.getElementById("restoreCharacterOverlay").hidden).toBe(false);
    expect(document.getElementById("restoreCharacterEmpty").hidden).toBe(true);
    expect(document.querySelectorAll(".restoreCharacterRow")).toHaveLength(1);
    expect(document.querySelector(".restoreCharacterGroupName").textContent).toBe("Deleted Mira");
    expect(document.querySelector(".restoreCharacterGroupDeleted").textContent).toBe("(character deleted)");
    expect(document.querySelector(".restoreCharacterRowPrimary").textContent).toBe("Level 1 — Fighter 1");

    // Restoring creates and activates one playable character.
    const rows = restoreRowButtons();
    expect(rows).toHaveLength(1);
    clickEl(rows[0]);
    await flushPromises();

    expect(deps.state.characters.entries).toHaveLength(1);
    const restored = deps.state.characters.entries[0];
    expect(restored.id).not.toBe("char_gone");
    expect(restored.name).toBe("Deleted Mira — Restored Level 1");
    expect(restored.build.levels).toHaveLength(1);
    expect(restored.restoredFromSnapshotId).toBe("csnap_deleted_1");
    expect(restored.restoredFromCharacterId).toBe("char_gone");
    expect(deps.state.characters.activeId).toBe(restored.id);
    expect(deps.SaveManager.markDirty).toHaveBeenCalled();
    expect(document.getElementById("restoreCharacterOverlay").hidden).toBe(true);

    // R3 is restore-only: the snapshot is retained, byte-for-byte.
    expect(deps.state.characters.snapshots).toHaveLength(1);
    expect(JSON.stringify(deps.state.characters.snapshots[0])).toBe(snapshotBefore);

    controller.destroy();
  });
});

describe("ASI ability-cap guidance", () => {
  it("warns when an ASI pushes an ability above 20 and clears when it does not", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    // Fighter 4 with base Str 18 (human +1 = 19): a +2 Str ASI lands on 21.
    const builder = makeLeveledBuilderCharacter({
      id: "char_cap",
      levels: Array.from({ length: 4 }, () => ({ classId: "fighter", hp: null })),
      base: { str: 18, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      subclassByClass: { fighter: "champion" }
    });
    deps.state.characters.entries = [builder];
    deps.state.characters.activeId = "char_cap";

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionEditBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    advanceBuilderWizardToStep("builderWizardStepClassChoices");

    const warning = document.querySelector(".builderAsiCapWarning");
    expect(warning).toBeTruthy();
    expect(warning.hidden).toBe(true);

    // Choose +1 Str twice via the ASI slot's two ability selects.
    const asiBody = document.querySelector(".builderAsiBody");
    expect(asiBody).toBeTruthy();
    const asiSelects = asiBody.querySelectorAll("select");
    expect(asiSelects.length).toBeGreaterThanOrEqual(2);
    asiSelects[0].value = "str";
    dispatchChange(asiSelects[0]);
    asiSelects[1].value = "str";
    dispatchChange(asiSelects[1]);

    expect(warning.hidden).toBe(false);
    expect(warning.textContent).toContain("STR");
    expect(warning.textContent).toContain("house-rules territory");

    // Redirect one +1 to Dex: back under the cap, warning clears.
    asiSelects[1].value = "dex";
    dispatchChange(asiSelects[1]);
    expect(warning.hidden).toBe(true);

    controller.destroy();
  });
});

describe("wizard Summary incomplete-choice guidance", () => {
  it("lists skipped count-bearing choices on the Summary and still allows Finish", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardName").value = "Skipper";
    document.getElementById("builderWizardRace").value = "half-orc";
    document.getElementById("builderWizardClass").value = "fighter";
    document.getElementById("builderWizardBackground").value = "acolyte";
    advanceBuilderWizardToStep("builderWizardStepSummary");

    const guidance = document.querySelector(".builderIncompleteChoices");
    expect(guidance).toBeTruthy();
    expect(guidance.hidden).toBe(false);
    expect(guidance.textContent).toContain("Fighter skills: 0 of 2 chosen");
    expect(guidance.textContent).toContain("Fighting Style: 0 of 1 chosen");
    // R5-B1: required choices point at the sheet-side correction path.
    expect(guidance.textContent).toContain("Required choices not finished");
    expect(guidance.textContent).toContain("complete them from the character sheet");
    // Languages are required (R5-B1 owner ruling), so the skipped Acolyte pair
    // is listed with the rest of the required work.
    expect(guidance.textContent).toContain("Acolyte languages: 0 of 2 chosen");
    // A non-caster has no under-cap block at all.
    expect(document.querySelector(".builderUnderCapChoices")).toBeNull();

    // Guidance never blocks Finish.
    document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(deps.state.characters.entries).toHaveLength(3);
    expect(document.getElementById("builderWizardOverlay").hidden).toBe(true);

    controller.destroy();
  });

  it("separates required choices from permitted under-cap spell selections", () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderWizardDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardName").value = "Underfilled";
    document.getElementById("builderWizardRace").value = "half-orc";
    document.getElementById("builderWizardClass").value = "wizard";
    document.getElementById("builderWizardBackground").value = "acolyte";
    advanceBuilderWizardToStep("builderWizardStepSummary");

    const required = document.querySelector(".builderIncompleteChoices");
    const underCap = document.querySelector(".builderUnderCapChoices");
    expect(required).toBeTruthy();
    expect(underCap).toBeTruthy();
    expect(underCap.hidden).toBe(false);

    // Required block: only genuinely required work, never a spell count.
    expect(required.textContent).toContain("Wizard skills: 0 of 2 chosen");
    expect(required.textContent).toContain("Acolyte languages: 0 of 2 chosen");
    expect(required.textContent).not.toContain("cantrips");
    expect(required.textContent).not.toContain("spellbook");

    // Under-cap block: only the permitted spell maxima, worded as allowed.
    expect(underCap.textContent).toContain("Wizard cantrips: 0 of 3 chosen");
    expect(underCap.textContent).toContain("Wizard spellbook: 0 of 6 spells chosen");
    expect(underCap.textContent).toContain("allowed");
    expect(underCap.textContent).not.toContain("Required");
    expect(underCap.textContent).not.toContain("Wizard skills");
    // Prepared capacity is Long-Rest owned and never appears in either block.
    expect(required.textContent).not.toContain("prepared");
    expect(underCap.textContent).not.toContain("prepared");

    controller.destroy();
  });
});
