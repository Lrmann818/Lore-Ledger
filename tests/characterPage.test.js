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
vi.mock("../js/pages/character/panels/abilitiesPanel.js", () => ({
  initAbilitiesPanel: () => ({ destroy: () => { } })
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
import {
  isBuilderCharacter,
  makeDefaultCharacterBuild
} from "../js/domain/characterHelpers.js";
import {
  BUILTIN_CONTENT_REGISTRY,
  listContentByKind
} from "../js/domain/rules/registry.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
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
  if (selector === "button:not([disabled])") return el.tagName === "BUTTON" && !el.disabled;
  if (selector === "button.active:not([disabled])") {
    return el.tagName === "BUTTON" && el.classList.contains("active") && !el.disabled;
  }
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
    .textContent = "Choose race, class, background, and level here. Basics uses those builder choices for identity text.";
  const unavailable = appendWithId(document, content, "p", "charBuilderIdentityUnavailable", "builderIdentityNote");
  unavailable.hidden = true;
  unavailable.textContent = "Builder Mode is active, but this character's builder data is not editable by the current identity editor.";
  const grid = appendWithId(document, content, "div", "charBuilderIdentityGrid", "builderIdentityGrid");
  appendWithId(document, grid, "span", "charBuilderRaceLabel").textContent = "Race";
  const species = appendWithId(document, grid, "select", "charBuilderRaceSelect");
  species.setAttribute("aria-labelledby", "charBuilderRaceLabel");
  appendWithId(document, grid, "span", "charBuilderClassLabel").textContent = "Class";
  const classSelect = appendWithId(document, grid, "select", "charBuilderClassSelect");
  classSelect.setAttribute("aria-labelledby", "charBuilderClassLabel");
  appendWithId(document, grid, "span", "charBuilderBackgroundLabel").textContent = "Background";
  const background = appendWithId(document, grid, "select", "charBuilderBackgroundSelect");
  background.setAttribute("aria-labelledby", "charBuilderBackgroundLabel");
  appendWithId(document, grid, "span", "charBuilderLevelLabel").textContent = "Level";
  const level = appendWithId(document, grid, "input", "charBuilderLevelInput");
  level.type = "number";
  level.setAttribute("aria-labelledby", "charBuilderLevelLabel");
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
    .textContent = "Edit the builder base ability scores used by Builder Summary. These do not overwrite the freeform ability fields below.";
  const unavailable = appendWithId(document, content, "p", "charBuilderAbilitiesUnavailable", "builderAbilitiesNote");
  unavailable.hidden = true;
  unavailable.textContent = "Builder Mode is active, but this character's ability data is not editable by the current abilities editor.";
  const grid = appendWithId(document, content, "div", "charBuilderAbilitiesGrid", "builderAbilitiesGrid");
  [
    ["Str", "Strength"],
    ["Dex", "Dexterity"],
    ["Con", "Constitution"],
    ["Int", "Intelligence"],
    ["Wis", "Wisdom"],
    ["Cha", "Charisma"],
  ].forEach(([suffix, label]) => {
    const labelEl = appendWithId(document, grid, "label", `charBuilderAbility${suffix}Field`, "builderAbilitiesField");
    labelEl.setAttribute("for", `charBuilderAbility${suffix}`);
    appendWithId(document, labelEl, "span", `charBuilderAbility${suffix}Label`).textContent = label;
    const input = appendWithId(document, labelEl, "input", `charBuilderAbility${suffix}`);
    input.type = "number";
    input.setAttribute("min", "1");
    input.setAttribute("max", "20");
    input.setAttribute("step", "1");
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("aria-labelledby", `charBuilderAbility${suffix}Label`);
  });
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
  appendWithId(document, identityGrid, "select", "builderWizardClass");
  appendWithId(document, identityGrid, "select", "builderWizardBackground");
  appendWithId(document, identityGrid, "span", "builderWizardLevel", "builderWizardReadonlyValue").textContent = "Level 1";
  const identityValidation = appendWithId(document, identity, "div", "builderWizardIdentityValidation", "builderWizardValidation");
  identityValidation.hidden = true;
  identityValidation.setAttribute("role", "status");
  identityValidation.setAttribute("aria-live", "polite");

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

async function finishBuilderWizardWith({
  name = "Mira",
  raceId = "race_human",
  classId = "class_fighter",
  backgroundId = "background_soldier",
  abilities = { Str: 15, Dex: 14, Con: 13, Int: 12, Wis: 10, Cha: 8 }
} = {}) {
  document.getElementById("builderWizardName").value = name;
  document.getElementById("builderWizardRace").value = raceId;
  document.getElementById("builderWizardClass").value = classId;
  document.getElementById("builderWizardBackground").value = backgroundId;
  document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
  Object.entries(abilities).forEach(([suffix, value]) => {
    document.getElementById(`builderWizardAbility${suffix}`).value = String(value);
  });
  document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
  document.getElementById("builderWizardFinish").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
  await flushPromises();
}

function completeBuilderIdentity({
  name = "Builder Mira",
  raceId = "race_human",
  classId = "class_fighter",
  backgroundId = "background_soldier"
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
  document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
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
          { id: "char_a", name: "Ada", classLevel: "Wizard 5", hpCur: 7, hpMax: 20, status: "Poisoned", imgBlobId: "blob_ada" },
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
  classId = "class_fighter",
  raceId = "race_elf",
  backgroundId = "background_soldier",
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
    expect(html).toContain('id="charBuilderRaceSelect"');
    expect(html).toContain('id="charBuilderRaceSelect" aria-labelledby="charBuilderRaceLabel"');
    expect(html).toContain('id="charBuilderClassSelect"');
    expect(html).toContain('id="charBuilderClassSelect" aria-labelledby="charBuilderClassLabel"');
    expect(html).toContain('id="charBuilderBackgroundSelect"');
    expect(html).toContain('id="charBuilderBackgroundSelect" aria-labelledby="charBuilderBackgroundLabel"');
    expect(html).toContain('id="charBuilderLevelInput" type="number" min="1" max="20"');
    expect(html).toContain('aria-labelledby="charBuilderLevelLabel"');
    expect(html).toContain("Choose race, class, background, and level here. Basics uses those builder choices for identity text.");
    expect(html).toContain("Builder Mode is active, but this character's builder data is not editable by the current identity editor.");
    expect(html).toContain('class="panel builderAbilitiesPanel" id="charBuilderAbilitiesPanel" hidden aria-hidden="true"');
    expect(html).toContain("Builder Abilities");
    expect(html).toContain("Edit the builder base ability scores used by Builder Summary. These do not overwrite the freeform ability fields below.");
    [
      ["Str", "Strength"],
      ["Dex", "Dexterity"],
      ["Con", "Constitution"],
      ["Int", "Intelligence"],
      ["Wis", "Wisdom"],
      ["Cha", "Charisma"],
    ].forEach(([suffix, label]) => {
      expect(html).toContain(`id="charBuilderAbility${suffix}Label">${label}</span>`);
      expect(html).toContain(`id="charBuilderAbility${suffix}" type="number" min="1" max="20" step="1" inputmode="numeric"`);
      expect(html).toContain(`aria-labelledby="charBuilderAbility${suffix}Label"`);
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
      { action: "rename", label: "Rename Character" },
      { action: "add-npc", label: "Add to NPCs" },
      { action: "add-party", label: "Add to Party" },
      { action: "export", label: "Export Character" },
      { action: "import", label: "Import Character" },
      { action: "delete", label: "Delete Character" },
    ]);
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

    expect(document.getElementById("charActionAddNpcBtn").disabled).toBe(true);
    expect(document.getElementById("charActionAddPartyBtn").disabled).toBe(true);
    expect(document.getElementById("charActionExportBtn").disabled).toBe(true);

    document.getElementById("charActionExportBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(exportActiveCharacter).not.toHaveBeenCalled();

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
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(document.getElementById("builderWizardStepIdentity").hidden).toBe(true);
    expect(document.getElementById("builderWizardStepAbilities").hidden).toBe(false);
    expect(document.getElementById("builderWizardIdentityValidation").hidden).toBe(true);

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
        version: 1,
        ruleset: "srd-5.1",
        raceId: "race_human",
        classId: "class_fighter",
        subclassId: null,
        backgroundId: "background_soldier",
        level: 1,
        abilities: {
          base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }
        },
        choicesByLevel: {}
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
      background: "Soldier"
    });
    expect(derived.proficiencyBonus).toBe(2);
    expect(derived.abilities.str).toMatchObject({ base: 15, total: 15, modifier: 2 });

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
      raceId: "race_elf",
      classId: "class_wizard",
      backgroundId: "background_sage"
    });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardAbilityInt").value = "16";
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(deps.state.characters.entries).toHaveLength(2);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    const summary = document.getElementById("builderWizardSummary").textContent;
    expect(summary).toContain("Preview Mira");
    expect(summary).toContain("Wizard 1");
    expect(summary).toContain("Elf");
    expect(summary).toContain("Sage");
    expect(summary).toContain("+2");
    expect(summary).toContain("16 (+3)");

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
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

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
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    const summary = document.getElementById("builderWizardSummary").textContent;
    expect(summary).toContain("STR18 (+4)");
    expect(summary).toContain("DEX15 (+2)");
    expect(summary).toContain("CHA3 (-4)");

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
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    chooseBuilderAbilityMethod("point-buy");
    clickPointBuy("Str", "increase", 2);
    clickPointBuy("Dex", "increase", 1);

    expect(document.getElementById("builderWizardPointBuyRemaining").textContent).toBe("24");
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    const summary = document.getElementById("builderWizardSummary").textContent;
    expect(summary).toContain("Point Mira");
    expect(summary).toContain("STR10 (+0)");
    expect(summary).toContain("DEX9 (-1)");
    expect(summary).toContain("CHA8 (-1)");

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
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    chooseBuilderAbilityMethod("standard-array");
    expect(document.getElementById("builderWizardManualAbilityGrid").hidden).toBe(true);
    expect(document.getElementById("builderWizardStandardArrayGrid").hidden).toBe(false);
    assignStandardArrayScores({ Str: 15, Dex: 14, Con: 13, Int: 12, Wis: 10, Cha: 8 });
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    const summary = document.getElementById("builderWizardSummary").textContent;
    expect(summary).toContain("Array Mira");
    expect(summary).toContain("STR15 (+2)");
    expect(summary).toContain("DEX14 (+2)");
    expect(summary).toContain("CHA8 (-1)");

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
    document.getElementById("builderWizardNext").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

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

  it("shows the Builder Identity panel for builder characters", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const controller = initCharacterPageUI(deps);
    const panel = document.getElementById("charBuilderIdentityPanel");

    expect(panel.hidden).toBe(false);
    expect(panel.getAttribute("aria-hidden")).toBe("false");
    expect(document.getElementById("charBuilderIdentityGrid").hidden).toBe(false);
    expect(document.getElementById("charBuilderIdentityUnavailable").hidden).toBe(true);
    expect(document.getElementById("charBuilderRaceSelect").value).toBe("race_elf");
    expect(document.getElementById("charBuilderClassSelect").value).toBe("class_fighter");
    expect(document.getElementById("charBuilderBackgroundSelect").value).toBe("background_soldier");
    expect(document.getElementById("charBuilderLevelInput").value).toBe("5");

    controller.destroy();
  });

  it("links Builder Identity controls to their visible labels", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const controller = initCharacterPageUI(deps);

    expect(document.getElementById("charBuilderRaceSelect").getAttribute("aria-labelledby"))
      .toBe("charBuilderRaceLabel");
    expect(document.getElementById("charBuilderRaceLabel").textContent).toBe("Race");
    expect(document.getElementById("charBuilderClassSelect").getAttribute("aria-labelledby"))
      .toBe("charBuilderClassLabel");
    expect(document.getElementById("charBuilderClassLabel").textContent).toBe("Class");
    expect(document.getElementById("charBuilderBackgroundSelect").getAttribute("aria-labelledby"))
      .toBe("charBuilderBackgroundLabel");
    expect(document.getElementById("charBuilderBackgroundLabel").textContent).toBe("Background");
    expect(document.getElementById("charBuilderLevelInput").getAttribute("aria-labelledby"))
      .toBe("charBuilderLevelLabel");
    expect(document.getElementById("charBuilderLevelLabel").textContent).toBe("Level");

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
    expect(document.getElementById("charBuilderIdentityGrid").hidden).toBe(true);
    expect(document.getElementById("charBuilderIdentityUnavailable").hidden).toBe(true);
    expect(document.getElementById("charBuilderRaceSelect").value).toBe("");
    expect(document.getElementById("charBuilderLevelInput").value).toBe("");

    controller.destroy();
  });

  it("explains when Builder Mode data is not editable by the Builder Identity panel", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = {
      id: "char_a",
      name: "Malformed Builder",
      build: {
        version: 1,
        ruleset: "srd-5.1",
        classId: "class_fighter",
        level: 3,
        abilities: { base: { str: 15 } }
      }
    };

    const controller = initCharacterPageUI(deps);

    expect(isBuilderCharacter(deps.state.characters.entries[0])).toBe(true);
    expect(document.getElementById("charBuilderModeBadge").hidden).toBe(false);
    expect(document.getElementById("charBuilderIdentityPanel").hidden).toBe(false);
    expect(document.getElementById("charBuilderIdentityPanel").getAttribute("aria-hidden")).toBe("false");
    expect(document.getElementById("charBuilderIdentityContent").getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById("charBuilderIdentityGrid").hidden).toBe(true);
    expect(document.getElementById("charBuilderIdentityUnavailable").hidden).toBe(false);
    expect(document.getElementById("charBuilderIdentityUnavailable").textContent)
      .toContain("Builder Mode is active");
    expect(document.getElementById("charBuilderClassSelect").value).toBe("");

    controller.destroy();
  });

  it("populates Builder Identity options from builtin registry IDs and labels", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const controller = initCharacterPageUI(deps);

    expect(getSelectOptions(document.getElementById("charBuilderRaceSelect"))).toEqual([
      { value: "", label: "Not selected" },
      ...listContentByKind(BUILTIN_CONTENT_REGISTRY, "race").map((entry) => ({
        value: entry.id,
        label: entry.name
      }))
    ]);
    expect(getSelectOptions(document.getElementById("charBuilderClassSelect"))).toEqual([
      { value: "", label: "Not selected" },
      ...listContentByKind(BUILTIN_CONTENT_REGISTRY, "class").map((entry) => ({
        value: entry.id,
        label: entry.name
      }))
    ]);
    expect(getSelectOptions(document.getElementById("charBuilderBackgroundSelect"))).toEqual([
      { value: "", label: "Not selected" },
      ...listContentByKind(BUILTIN_CONTENT_REGISTRY, "background").map((entry) => ({
        value: entry.id,
        label: entry.name
      }))
    ]);

    controller.destroy();
  });

  it("shows Not selected choices and level 1 for new builder characters", async () => {
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
      raceId: null,
      classId: null,
      backgroundId: null,
      level: 1
    });
    expect(document.getElementById("charBuilderIdentityPanel").hidden).toBe(false);
    expect(document.getElementById("charBuilderRaceSelect").value).toBe("");
    expect(document.getElementById("charBuilderClassSelect").value).toBe("");
    expect(document.getElementById("charBuilderBackgroundSelect").value).toBe("");
    expect(document.getElementById("charBuilderLevelInput").value).toBe("1");

    controller.destroy();
  });

  it("reflects existing Builder Identity build values in the controls", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({
      id: "char_a",
      raceId: "race_dwarf",
      classId: "class_wizard",
      backgroundId: "background_sage",
      level: 7
    });

    const controller = initCharacterPageUI(deps);

    expect(document.getElementById("charBuilderRaceSelect").value).toBe("race_dwarf");
    expect(document.getElementById("charBuilderClassSelect").value).toBe("class_wizard");
    expect(document.getElementById("charBuilderBackgroundSelect").value).toBe("background_sage");
    expect(document.getElementById("charBuilderLevelInput").value).toBe("7");

    controller.destroy();
  });

  it("edits only the targeted builder identity fields", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const builder = makeBuilderCharacter({
      id: "char_a",
      flatFields: {
        hpCur: 11,
        hpMax: 31,
        ac: 15,
        proficiency: 99
      }
    });
    deps.state.characters.entries[0] = builder;
    const beforeFlat = {
      classLevel: builder.classLevel,
      race: builder.race,
      background: builder.background,
      proficiency: builder.proficiency,
      hpCur: builder.hpCur,
      hpMax: builder.hpMax,
      ac: builder.ac,
      abilities: structuredClone(builder.abilities)
    };

    const controller = initCharacterPageUI(deps);

    const raceSelect = document.getElementById("charBuilderRaceSelect");
    raceSelect.value = "race_human";
    dispatchChange(raceSelect);
    expect(builder.build.raceId).toBe("race_human");
    expect(builder.build.classId).toBe("class_fighter");
    expect(builder.build.backgroundId).toBe("background_soldier");
    expect(builder.build.level).toBe(5);

    const classSelect = document.getElementById("charBuilderClassSelect");
    classSelect.value = "class_wizard";
    dispatchChange(classSelect);
    expect(builder.build.classId).toBe("class_wizard");
    expect(builder.build.raceId).toBe("race_human");
    expect(builder.build.backgroundId).toBe("background_soldier");
    expect(builder.build.level).toBe(5);

    const backgroundSelect = document.getElementById("charBuilderBackgroundSelect");
    backgroundSelect.value = "background_sage";
    dispatchChange(backgroundSelect);
    expect(builder.build.backgroundId).toBe("background_sage");
    expect(builder.build.raceId).toBe("race_human");
    expect(builder.build.classId).toBe("class_wizard");
    expect(builder.build.level).toBe(5);

    const levelInput = document.getElementById("charBuilderLevelInput");
    levelInput.value = "6";
    dispatchChange(levelInput);
    expect(builder.build.level).toBe(6);
    expect(builder.build.raceId).toBe("race_human");
    expect(builder.build.classId).toBe("class_wizard");
    expect(builder.build.backgroundId).toBe("background_sage");

    expect(builder.classLevel).toBe(beforeFlat.classLevel);
    expect(builder.race).toBe(beforeFlat.race);
    expect(builder.background).toBe(beforeFlat.background);
    expect(builder.proficiency).toBe(beforeFlat.proficiency);
    expect(builder.hpCur).toBe(beforeFlat.hpCur);
    expect(builder.hpMax).toBe(beforeFlat.hpMax);
    expect(builder.ac).toBe(beforeFlat.ac);
    expect(builder.abilities).toEqual(beforeFlat.abilities);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(4);

    controller.destroy();
  });

  it("stores null when Builder Identity selections are set to Not selected", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const builder = makeBuilderCharacter({ id: "char_a" });
    deps.state.characters.entries[0] = builder;

    const controller = initCharacterPageUI(deps);

    ["charBuilderRaceSelect", "charBuilderClassSelect", "charBuilderBackgroundSelect"].forEach((id) => {
      const select = document.getElementById(id);
      select.value = "";
      dispatchChange(select);
    });

    expect(builder.build.raceId).toBeNull();
    expect(builder.build.classId).toBeNull();
    expect(builder.build.backgroundId).toBeNull();

    controller.destroy();
  });

  it("rejects invalid Builder Identity content IDs without persisting them", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const builder = makeBuilderCharacter({
      id: "char_a",
      raceId: "race_elf",
      classId: "class_fighter",
      backgroundId: null
    });
    deps.state.characters.entries[0] = builder;
    const beforeBuild = structuredClone(builder.build);

    const controller = initCharacterPageUI(deps);

    const raceSelect = document.getElementById("charBuilderRaceSelect");
    raceSelect.value = "class_fighter";
    dispatchChange(raceSelect);
    expect(builder.build).toEqual(beforeBuild);
    expect(raceSelect.value).toBe("race_elf");

    const classSelect = document.getElementById("charBuilderClassSelect");
    classSelect.value = "class_missing";
    dispatchChange(classSelect);
    expect(builder.build).toEqual(beforeBuild);
    expect(classSelect.value).toBe("class_fighter");

    const backgroundSelect = document.getElementById("charBuilderBackgroundSelect");
    backgroundSelect.value = "background_missing";
    dispatchChange(backgroundSelect);
    expect(builder.build).toEqual(beforeBuild);
    expect(backgroundSelect.value).toBe("");
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("keeps Builder Identity level within 1 through 20", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const builder = makeBuilderCharacter({ id: "char_a", level: 5 });
    deps.state.characters.entries[0] = builder;

    const controller = initCharacterPageUI(deps);
    const levelInput = document.getElementById("charBuilderLevelInput");

    levelInput.value = "";
    dispatchChange(levelInput);
    expect(builder.build.level).toBe(5);
    expect(levelInput.value).toBe("5");
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    levelInput.value = "nope";
    dispatchChange(levelInput);
    expect(builder.build.level).toBe(5);
    expect(levelInput.value).toBe("5");
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    levelInput.value = "99";
    dispatchChange(levelInput);
    expect(builder.build.level).toBe(20);
    expect(levelInput.value).toBe("20");
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);

    levelInput.value = "0";
    dispatchChange(levelInput);
    expect(builder.build.level).toBe(1);
    expect(levelInput.value).toBe("1");
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(2);

    controller.destroy();
  });

  it("refreshes Builder Summary after Builder Identity edits", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    installBuilderSummaryDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const controller = initCharacterPageUI(deps);
    expect(document.getElementById("charBuilderSummaryContent").textContent).toContain("Fighter 5");

    const classSelect = document.getElementById("charBuilderClassSelect");
    classSelect.value = "class_wizard";
    dispatchChange(classSelect);

    expect(document.getElementById("charBuilderSummaryContent").textContent).toContain("Wizard 5");
    expect(deps.state.characters.entries[0].classLevel).toBe("Persisted Class");

    controller.destroy();
  });

  it("leaves Builder Identity controls editable while the panel is visible", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const controller = initCharacterPageUI(deps);

    ["charBuilderRaceSelect", "charBuilderClassSelect", "charBuilderBackgroundSelect", "charBuilderLevelInput"].forEach((id) => {
      const input = document.getElementById(id);
      expect(input.disabled).toBe(false);
      expect(input.readOnly).toBe(false);
      expect(input.getAttribute("readonly")).toBeNull();
      expect(input.getAttribute("aria-readonly")).toBeNull();
    });

    controller.destroy();
  });

  it("refreshes and hides Builder Identity when the active character changes", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries = [
      makeBuilderCharacter({ id: "char_a", raceId: "race_elf", classId: "class_fighter", backgroundId: "background_soldier", level: 5 }),
      { id: "char_b", name: "Bram", build: null },
      makeBuilderCharacter({ id: "char_c", raceId: "race_human", classId: "class_wizard", backgroundId: "background_acolyte", level: 1 })
    ];
    deps.state.characters.activeId = "char_a";

    const controller = initCharacterPageUI(deps);
    expect(document.getElementById("charBuilderRaceSelect").value).toBe("race_elf");

    deps.state.characters.activeId = "char_c";
    notifyActiveCharacterChanged({ previousId: "char_a", activeId: "char_c" });
    expect(document.getElementById("charBuilderIdentityPanel").hidden).toBe(false);
    expect(document.getElementById("charBuilderRaceSelect").value).toBe("race_human");
    expect(document.getElementById("charBuilderClassSelect").value).toBe("class_wizard");
    expect(document.getElementById("charBuilderBackgroundSelect").value).toBe("background_acolyte");
    expect(document.getElementById("charBuilderLevelInput").value).toBe("1");

    deps.state.characters.activeId = "char_b";
    notifyActiveCharacterChanged({ previousId: "char_c", activeId: "char_b" });
    expect(document.getElementById("charBuilderIdentityPanel").hidden).toBe(true);
    expect(document.getElementById("charBuilderRaceSelect").value).toBe("");
    expect(document.getElementById("charBuilderClassSelect").value).toBe("");
    expect(document.getElementById("charBuilderBackgroundSelect").value).toBe("");
    expect(document.getElementById("charBuilderLevelInput").value).toBe("");

    controller.destroy();
  });

  it("does not duplicate Builder Identity listeners across page re-initialization", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderIdentityDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const firstController = initCharacterPageUI(deps);
    const secondController = initCharacterPageUI(deps);
    deps.SaveManager.markDirty.mockClear();

    const raceSelect = document.getElementById("charBuilderRaceSelect");
    raceSelect.value = "race_human";
    dispatchChange(raceSelect);

    expect(deps.state.characters.entries[0].build.raceId).toBe("race_human");
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);

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
    expect(document.getElementById("charBuilderAbilitiesGrid").hidden).toBe(true);
    expect(document.getElementById("charBuilderAbilitiesUnavailable").hidden).toBe(true);
    expect(document.getElementById("charBuilderAbilityStr").value).toBe("");
    expect(deps.state.characters.entries[0].build).toBeNull();
    ["str", "dex", "con", "int", "wis", "cha"].forEach((key) => {
      const score = document.getElementById(`flatAbilityScore-${key}`);
      expect(score.disabled).toBe(false);
      expect(score.readOnly).toBe(false);
      expect(score.getAttribute("readonly")).toBeNull();
    });

    controller.destroy();
  });

  it("shows Builder Abilities for valid builder characters", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderAbilitiesDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const controller = initCharacterPageUI(deps);

    expect(document.getElementById("charBuilderAbilitiesPanel").hidden).toBe(false);
    expect(document.getElementById("charBuilderAbilitiesPanel").getAttribute("aria-hidden")).toBe("false");
    expect(document.getElementById("charBuilderAbilitiesGrid").hidden).toBe(false);
    expect(document.getElementById("charBuilderAbilitiesUnavailable").hidden).toBe(true);
    expect(document.getElementById("charBuilderAbilityStr").value).toBe("16");
    expect(document.getElementById("charBuilderAbilityDex").value).toBe("14");
    expect(document.getElementById("charBuilderAbilityCon").value).toBe("13");
    expect(document.getElementById("charBuilderAbilityInt").value).toBe("12");
    expect(document.getElementById("charBuilderAbilityWis").value).toBe("10");
    expect(document.getElementById("charBuilderAbilityCha").value).toBe("8");

    controller.destroy();
  });

  it("links Builder Abilities controls to their visible labels", () => {
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
      expect(document.getElementById(`charBuilderAbility${suffix}`).getAttribute("aria-labelledby"))
        .toBe(`charBuilderAbility${suffix}Label`);
      expect(document.getElementById(`charBuilderAbility${suffix}Label`).textContent).toBe(label);
    });

    controller.destroy();
  });

  it("shows neutral base scores for new builder characters", async () => {
    const { document, actionMenuButton } = installCharacterSelectorDom();
    installBuilderAbilitiesDom(document);
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
    expect(entry.build.abilities.base).toEqual({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    expect(document.getElementById("charBuilderAbilitiesPanel").hidden).toBe(false);
    ["Str", "Dex", "Con", "Int", "Wis", "Cha"].forEach((suffix) => {
      expect(document.getElementById(`charBuilderAbility${suffix}`).value).toBe("10");
    });

    controller.destroy();
  });

  it("explains malformed Builder Abilities data without mutating state", () => {
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
        classId: "class_fighter",
        level: 3,
        abilities: { base: { str: 15 } }
      }
    };
    const beforeBuild = structuredClone(deps.state.characters.entries[0].build);

    const controller = initCharacterPageUI(deps);

    expect(isBuilderCharacter(deps.state.characters.entries[0])).toBe(true);
    expect(document.getElementById("charBuilderAbilitiesPanel").hidden).toBe(false);
    expect(document.getElementById("charBuilderAbilitiesContent").getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById("charBuilderAbilitiesGrid").hidden).toBe(true);
    expect(document.getElementById("charBuilderAbilitiesUnavailable").hidden).toBe(false);
    expect(document.getElementById("charBuilderAbilitiesUnavailable").textContent)
      .toContain("Builder Mode is active");
    expect(deps.state.characters.entries[0].build).toEqual(beforeBuild);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("edits only the targeted builder ability fields", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderAbilitiesDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const builder = makeBuilderCharacter({ id: "char_a" });
    deps.state.characters.entries[0] = builder;
    const beforeFlat = structuredClone(builder.abilities);

    const controller = initCharacterPageUI(deps);

    [
      ["charBuilderAbilityStr", "str", 17],
      ["charBuilderAbilityDex", "dex", 15],
      ["charBuilderAbilityCon", "con", 14],
      ["charBuilderAbilityInt", "int", 13],
      ["charBuilderAbilityWis", "wis", 11],
      ["charBuilderAbilityCha", "cha", 9],
    ].forEach(([id, key, value], idx) => {
      const beforeBase = structuredClone(builder.build.abilities.base);
      const input = document.getElementById(id);
      input.value = String(value);
      dispatchChange(input);
      expect(builder.build.abilities.base[key]).toBe(value);
      Object.keys(beforeBase).filter((baseKey) => baseKey !== key).forEach((baseKey) => {
        expect(builder.build.abilities.base[baseKey]).toBe(beforeBase[baseKey]);
      });
      expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(idx + 1);
    });

    expect(builder.abilities).toEqual(beforeFlat);

    controller.destroy();
  });

  it("rejects invalid Builder Abilities edits without dirtying or mutating state", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderAbilitiesDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const builder = makeBuilderCharacter({ id: "char_a", abilities: { str: 12, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
    deps.state.characters.entries[0] = builder;

    const controller = initCharacterPageUI(deps);
    const input = document.getElementById("charBuilderAbilityStr");

    ["", "nope", "12.5", "0", "21"].forEach((value) => {
      const beforeBuild = structuredClone(builder.build);
      input.value = value;
      dispatchChange(input);
      expect(builder.build).toEqual(beforeBuild);
      expect(input.value).toBe("12");
    });
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("keeps flat ability fields editable and untouched when builder abilities change", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderAbilitiesDom(document);
    installFlatAbilitiesDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    const builder = makeBuilderCharacter({
      id: "char_a",
      flatFields: {
        abilities: {
          str: { score: 4, mod: -3, save: -3 },
          dex: { score: 5, mod: -3, save: -3 },
          con: { score: 6, mod: -2, save: -2 },
          int: { score: 7, mod: -2, save: -2 },
          wis: { score: 8, mod: -1, save: -1 },
          cha: { score: 9, mod: -1, save: -1 },
        }
      }
    });
    deps.state.characters.entries[0] = builder;
    const beforeFlat = structuredClone(builder.abilities);

    const controller = initCharacterPageUI(deps);
    const input = document.getElementById("charBuilderAbilityStr");
    input.value = "15";
    dispatchChange(input);

    expect(builder.build.abilities.base.str).toBe(15);
    expect(builder.abilities).toEqual(beforeFlat);
    ["str", "dex", "con", "int", "wis", "cha"].forEach((key) => {
      const score = document.getElementById(`flatAbilityScore-${key}`);
      expect(score.disabled).toBe(false);
      expect(score.readOnly).toBe(false);
      expect(score.getAttribute("readonly")).toBeNull();
      expect(score.getAttribute("aria-readonly")).toBeNull();
    });

    controller.destroy();
  });

  it("refreshes Builder Summary after Builder Abilities edits", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderAbilitiesDom(document);
    installBuilderSummaryDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({
      id: "char_a",
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
    });

    const controller = initCharacterPageUI(deps);
    expect(document.getElementById("charBuilderSummaryContent").textContent).toContain("STR10 (+0)");

    const input = document.getElementById("charBuilderAbilityStr");
    input.value = "15";
    dispatchChange(input);

    expect(deps.state.characters.entries[0].build.abilities.base.str).toBe(15);
    expect(document.getElementById("charBuilderSummaryContent").textContent).toContain("STR15 (+2)");
    expect(deps.state.characters.entries[0].abilities.str).toEqual({ score: 3, mod: -4, save: -4 });

    controller.destroy();
  });

  it("refreshes and clears Builder Abilities when the active character changes", () => {
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
    expect(document.getElementById("charBuilderAbilityStr").value).toBe("16");

    deps.state.characters.activeId = "char_c";
    notifyActiveCharacterChanged({ previousId: "char_a", activeId: "char_c" });
    expect(document.getElementById("charBuilderAbilitiesPanel").hidden).toBe(false);
    expect(document.getElementById("charBuilderAbilityStr").value).toBe("8");
    expect(document.getElementById("charBuilderAbilityDex").value).toBe("10");
    expect(document.getElementById("charBuilderAbilityCon").value).toBe("12");
    expect(document.getElementById("charBuilderAbilityInt").value).toBe("14");
    expect(document.getElementById("charBuilderAbilityWis").value).toBe("16");
    expect(document.getElementById("charBuilderAbilityCha").value).toBe("18");

    deps.state.characters.activeId = "char_b";
    notifyActiveCharacterChanged({ previousId: "char_c", activeId: "char_b" });
    expect(document.getElementById("charBuilderAbilitiesPanel").hidden).toBe(true);
    ["Str", "Dex", "Con", "Int", "Wis", "Cha"].forEach((suffix) => {
      expect(document.getElementById(`charBuilderAbility${suffix}`).value).toBe("");
    });

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
    expect(content.textContent).toContain("Derived from builder data");
    expect(content.textContent).toContain("Class / LevelFighter 5");
    expect(content.textContent).toContain("RaceElf");
    expect(content.textContent).toContain("BackgroundSoldier");
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
        classId: "class_fighter",
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
        classId: "class_wizard",
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
      status: "Poisoned",
      imgBlobId: "blob_ada",
      notes: "Party note"
    });

    controller.destroy();
  });
});
