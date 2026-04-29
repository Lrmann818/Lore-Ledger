import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import events from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { makeDefaultBuilderCharacterEntry, makeDefaultCharacterEntry } from "../js/domain/characterHelpers.js";
import { initAbilitiesPanel } from "../js/pages/character/panels/abilitiesPanel.js";
import { initAttacksPanel } from "../js/pages/character/panels/attackPanel.js";
import { initBuilderAbilitiesPanel } from "../js/pages/character/panels/builderAbilitiesPanel.js";
import { initBuilderIdentityPanel } from "../js/pages/character/panels/builderIdentityPanel.js";
import { initBuilderSummaryPanel } from "../js/pages/character/panels/builderSummaryPanel.js";
import { initBasicsPanel } from "../js/pages/character/panels/basicsPanel.js";
import { initAbilitiesFeaturesPanel } from "../js/pages/character/panels/abilitiesFeaturesPanel.js";
import { initEquipmentPanel } from "../js/pages/character/panels/equipmentPanel.js";
import { initPersonalityPanel } from "../js/pages/character/panels/personalityPanel.js";
import { initProficienciesPanel } from "../js/pages/character/panels/proficienciesPanel.js";
import { initSpellsPanel } from "../js/pages/character/panels/spellsPanel.js";
import { initVitalsPanel } from "../js/pages/character/panels/vitalsPanel.js";
import {
  EMBEDDED_PANEL_HOST_SELECTORS,
  initCombatEmbeddedPanels,
  renderAbilitiesEmbeddedContent,
  renderSpellsEmbeddedContent,
  renderVitalsEmbeddedContent,
  renderWeaponsEmbeddedContent
} from "../js/pages/combat/combatEmbeddedPanels.js";
import { notifyActiveCharacterChanged } from "../js/domain/characterEvents.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import { notifyPanelDataChanged } from "../js/ui/panelInvalidation.js";

events.defaultMaxListeners = 100;

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

class FakeNode extends EventTarget {
  constructor(tagName = "") {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.ownerDocument = null;
    this.dataset = {};
    this.attributes = new Map();
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.readOnly = false;
    this.value = "";
    this.type = "";
    this.title = "";
    this.placeholder = "";
    this._id = "";
    this._className = "";
    this._textContent = "";
    this.classList = new FakeClassList(this);
  }

  addEventListener(type, listener, options) {
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    super.addEventListener(type, listener, capture);
  }

  removeEventListener(type, listener, options) {
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    super.removeEventListener(type, listener, capture);
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

  get firstElementChild() { return this.children.find((child) => child instanceof FakeElement) || null; }
  get firstChild() { return this.children[0] || null; }

  setAttribute(name, value) {
    const str = String(value);
    this.attributes.set(name, str);
    if (name === "id") this.id = str;
    else if (name === "class") this.className = str;
    else if (name.startsWith("data-")) this.dataset[dataKey(name)] = str;
    else this[name] = str;
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    if (name.startsWith("data-")) return this.dataset[dataKey(name)] ?? null;
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "id") this.id = "";
    else if (name === "class") this.className = "";
    else if (name.startsWith("data-")) delete this.dataset[dataKey(name)];
    else if (name === "hidden") this.hidden = false;
    else if (name === "disabled") this.disabled = false;
    else if (name === "readonly") this.readOnly = false;
    else this[name] = "";
  }

  appendChild(child) {
    if (!child) return child;
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    registerTree(child, this.ownerDocument);
    return child;
  }

  insertBefore(child, before) {
    if (!before) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    const idx = this.children.indexOf(before);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    if (idx === -1) this.children.push(child);
    else this.children.splice(idx, 0, child);
    registerTree(child, this.ownerDocument);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    unregisterTree(child, this.ownerDocument);
    child.parentNode = null;
    return child;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  replaceChildren(...children) {
    for (const child of [...this.children]) this.removeChild(child);
    children.forEach((child) => this.appendChild(child));
    this._textContent = "";
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains?.(node));
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  blur() {
    if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }

  querySelector(selector) {
    return queryAll(this, selector)[0] || null;
  }

  querySelectorAll(selector) {
    return queryAll(this, selector);
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      if (cur.matches?.(selector)) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }

  set innerHTML(value) {
    this.replaceChildren();
    parseHtmlInto(this, String(value || ""));
  }
}

class FakeElement extends FakeNode {}
class FakeInputElement extends FakeElement {}
class FakeTextAreaElement extends FakeInputElement {}
class FakeButtonElement extends FakeElement {}
class FakeSelectElement extends FakeElement {}
class FakeHeadingElement extends FakeElement {}
class FakeTextNode extends FakeNode {
  constructor(text) {
    super("#text");
    this._textContent = String(text ?? "");
  }
}
class FakeDocumentFragment extends FakeElement {
  constructor() {
    super("#fragment");
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super("#document");
    this.ownerDocument = this;
    this.ids = new Map();
    this.body = new FakeElement("body");
    this.body.ownerDocument = this;
    this.activeElement = this.body;
    this.appendChild(this.body);
    this.title = "";
  }

  registerId(el) {
    if (el.id) this.ids.set(el.id, el);
  }

  unregisterId(id, el) {
    if (this.ids.get(id) === el) this.ids.delete(id);
  }

  getElementById(id) {
    return this.ids.get(id) || null;
  }

  createElement(tag) {
    const normalized = String(tag).toLowerCase();
    let el;
    if (normalized === "input") el = new FakeInputElement(tag);
    else if (normalized === "textarea") el = new FakeTextAreaElement(tag);
    else if (normalized === "button") el = new FakeButtonElement(tag);
    else if (normalized === "select") el = new FakeSelectElement(tag);
    else if (/^h[1-6]$/.test(normalized)) el = new FakeHeadingElement(tag);
    else el = new FakeElement(tag);
    el.ownerDocument = this;
    return el;
  }

  createTextNode(text) {
    const node = new FakeTextNode(text);
    node.ownerDocument = this;
    return node;
  }

  createDocumentFragment() {
    const frag = new FakeDocumentFragment();
    frag.ownerDocument = this;
    return frag;
  }
}

function dataKey(attrName) {
  return attrName.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

function attrNameFromDatasetKey(key) {
  return `data-${String(key).replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`;
}

function registerTree(node, document) {
  if (!document) return;
  node.ownerDocument = document;
  if (node.id) document.registerId(node);
  node.children?.forEach((child) => registerTree(child, document));
}

function unregisterTree(node, document) {
  if (!document) return;
  if (node.id) document.unregisterId(node.id, node);
  node.children?.forEach((child) => unregisterTree(child, document));
}

function descendants(root) {
  const out = [];
  for (const child of root.children || []) {
    out.push(child);
    out.push(...descendants(child));
  }
  return out;
}

function queryAll(root, selector) {
  const trimmed = String(selector || "").trim();
  if (!trimmed) return [];
  const commaParts = splitSelector(trimmed, ",");
  if (commaParts.length > 1) {
    const seen = new Set();
    return commaParts.flatMap((part) => queryAll(root, part)).filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });
  }
  if (trimmed.startsWith(":scope > ")) {
    const rest = trimmed.slice(9).trim();
    if (rest.includes(" > ")) {
      const [first, ...remaining] = rest.split(/\s*>\s*/);
      return root.children
        .filter((child) => matchesSelector(child, first))
        .flatMap((child) => queryAll(child, `:scope > ${remaining.join(" > ")}`));
    }
    return root.children.filter((child) => matchesSelector(child, rest));
  }
  const spaceParts = splitSelector(trimmed, " ");
  if (spaceParts.length > 1) {
    let current = [root];
    for (const part of spaceParts) {
      current = current.flatMap((base) => descendants(base).filter((el) => matchesSelector(el, part)));
    }
    return current;
  }
  return descendants(root).filter((el) => matchesSelector(el, trimmed));
}

function splitSelector(selector, delimiter) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (const ch of selector) {
    if (ch === "[") depth += 1;
    if (ch === "]") depth -= 1;
    if (ch === delimiter && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function matchesSelector(el, selector) {
  const trimmed = String(selector || "").trim();
  if (!trimmed || !(el instanceof FakeElement)) return false;
  if (trimmed.includes(",")) return splitSelector(trimmed, ",").some((part) => matchesSelector(el, part));
  if (trimmed === "*") return true;

  let rest = trimmed;
  const tagMatch = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tagMatch) {
    if (el.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }

  const idMatch = rest.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch && el.id !== idMatch[1]) return false;

  for (const classMatch of rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
    if (!el.classList.contains(classMatch[1])) return false;
  }

  for (const attrMatch of rest.matchAll(/\[([^\]=~^$*]+)(\^=|=)?(?:"([^"]*)"|'([^']*)'|([^\]]*))?\]/g)) {
    const name = attrMatch[1].trim();
    const op = attrMatch[2] || null;
    const expected = attrMatch[3] ?? attrMatch[4] ?? attrMatch[5] ?? "";
    const actual = name.startsWith("data-") ? el.dataset[dataKey(name)] : el.getAttribute(name);
    if (!op && actual == null) return false;
    if (op === "=" && String(actual) !== expected) return false;
    if (op === "^=" && !String(actual || "").startsWith(expected)) return false;
  }

  return true;
}

function parseHtmlInto(parent, html) {
  const doc = parent.ownerDocument;
  const stack = [parent];
  const tokenRe = /<\/?[^>]+>|[^<]+/g;
  let match;
  while ((match = tokenRe.exec(html))) {
    const token = match[0];
    if (token.startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (token.startsWith("<")) {
      const tagMatch = token.match(/^<\s*([a-zA-Z0-9-]+)/);
      if (!tagMatch) continue;
      const el = doc.createElement(tagMatch[1]);
      for (const attrMatch of token.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:]*)=(?:"([^"]*)"|'([^']*)')/g)) {
        el.setAttribute(attrMatch[1], attrMatch[2] ?? attrMatch[3] ?? "");
      }
      stack[stack.length - 1].appendChild(el);
      if (!token.endsWith("/>") && !["input", "br", "hr", "img"].includes(tagMatch[1].toLowerCase())) {
        stack.push(el);
      }
      continue;
    }
    const text = token.replace(/\s+/g, " ").trim();
    if (text) stack[stack.length - 1].appendChild(doc.createTextNode(text));
  }
}

function installFakeDom() {
  const document = new FakeDocument();
  const windowTarget = new EventTarget();
  windowTarget.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 0));
  vi.stubGlobal("getComputedStyle", () => ({
    font: "",
    letterSpacing: "",
    lineHeight: "",
    textTransform: "",
    textIndent: "",
    textAlign: "",
    padding: "",
    borderRadius: ""
  }));
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("HTMLInputElement", FakeInputElement);
  vi.stubGlobal("HTMLTextAreaElement", FakeTextAreaElement);
  vi.stubGlobal("HTMLButtonElement", FakeButtonElement);
  vi.stubGlobal("HTMLSelectElement", FakeSelectElement);
  vi.stubGlobal("HTMLHeadingElement", FakeHeadingElement);
  return document;
}

function append(parent, tag, { id, className, text, dataset = {}, type } = {}) {
  const el = parent.ownerDocument.createElement(tag);
  if (id) el.id = id;
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  if (type) el.type = type;
  for (const [key, value] of Object.entries(dataset)) {
    el.dataset[key] = String(value);
    el.attributes.set(attrNameFromDatasetKey(key), String(value));
  }
  parent.appendChild(el);
  return el;
}

function addInput(parent, id, type = "text") {
  return append(parent, "input", { id, type });
}

function buildCharacterPanelDom(document) {
  const root = document.body;

  const basics = append(root, "section", { id: "charBasicsPanel" });
  ["charName", "charClassLevel", "charRace", "charBackground", "charAlignment", "charExperience", "charFeatures"].forEach((id) => {
    append(basics, id === "charFeatures" ? "textarea" : "input", { id });
  });
  append(basics, "div", { id: "charPortraitCard" });
  append(basics, "div", { id: "charPortraitTop" });

  const vitals = append(root, "section", { id: "charVitalsPanel" });
  append(vitals, "button", { id: "addResourceBtn" });
  const tiles = append(vitals, "div", { id: "charVitalsTiles", className: "charTiles" });
  [
    ["hp", ["charHpCur", "charHpMax"]],
    ["hitDie", ["hitDieAmt", "hitDieSize"]],
    ["ac", ["charAC"]],
    ["init", ["charInit"]],
    ["speed", ["charSpeed"]],
    ["prof", ["charProf"]],
    ["spellAtk", ["charSpellAtk"]],
    ["spellDC", ["charSpellDC"]]
  ].forEach(([key, ids]) => {
    const tile = append(tiles, "div", { className: "charTile", dataset: { vitalKey: key } });
    append(tile, "div", { className: "charTileLabel", text: key });
    ids.forEach((id) => addInput(tile, id, "number"));
  });
  const statusTile = append(tiles, "div", { className: "charTile charTileWide", dataset: { vitalKey: "status" } });
  append(statusTile, "div", { className: "charTileLabel", text: "Status Effects" });
  addInput(statusTile, "charStatus", "text");

  const spells = append(root, "section", { id: "charSpellsPanel" });
  append(spells, "button", { id: "addSpellLevelBtn" });
  append(spells, "div", { id: "spellLevels", className: "spellLevels" });

  const attacks = append(root, "section", { id: "charAttacksPanel" });
  append(attacks, "button", { id: "addAttackBtn" });
  append(attacks, "div", { id: "attackList", className: "attackList" });

  const equipment = append(root, "section", { id: "charEquipmentPanel" });
  append(equipment, "div", { id: "inventoryTabs" });
  append(equipment, "textarea", { id: "inventoryNotesBox" });
  addInput(equipment, "inventorySearch");
  ["addInventoryBtn", "renameInventoryBtn", "deleteInventoryBtn"].forEach((id) => append(equipment, "button", { id }));
  ["moneyPP", "moneyGP", "moneyEP", "moneySP", "moneyCP"].forEach((id) => addInput(equipment, id, "number"));

  const prof = append(root, "section", { id: "charProfPanel" });
  ["charArmorProf", "charWeaponProf", "charToolProf", "charLanguages"].forEach((id) => append(prof, "textarea", { id }));

  const features = append(root, "section", { id: "charAbilitiesFeaturesPanel" });
  append(features, "button", { id: "addFeatureCardBtn" });
  append(features, "div", { id: "charAbilitiesFeaturesEmpty", className: "mutedSmall abilitiesFeaturesEmpty" });
  append(features, "div", { id: "charAbilitiesFeaturesList", className: "abilitiesFeaturesList" });

  const personality = append(root, "section", { id: "charPersonalityPanel" });
  ["charTraits", "charIdeals", "charBonds", "charFlaws", "charCharNotes"].forEach((id) => append(personality, "textarea", { id }));

  const abilities = append(root, "section", { id: "charAbilitiesPanel" });
  const saveOptions = append(abilities, "div", { id: "saveOptionsDropdown", className: "saveOptionsDropdown" });
  append(saveOptions, "button", { id: "saveOptionsBtn", type: "button" });
  const menu = append(saveOptions, "div", { id: "saveOptionsMenu", className: "saveOptionsMenu" });
  menu.hidden = true;
  const grid = append(menu, "div", { className: "saveOptionsGrid" });
  TEST_ABILITY_KEYS.forEach((key) => {
    const item = append(grid, "div", { className: "saveOpt" });
    append(append(item, "div", { className: "saveOptTop" }), "input", { id: `miscSave_${key}`, type: "number" });
    append(item, "div", { className: "saveOptLabel", text: `${key} Save` });
  });
  append(menu, "select", { id: "saveModToAllSelect", className: "settingsSelect abilitySaves" });
  append(abilities, "div", { className: "abilityGrid" });
}

const TEST_ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
const TEST_ABILITY_LABELS = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

function installAbilityBlocks(document, root = document) {
  const grid = root.querySelector("#charAbilitiesPanel .abilityGrid") ||
    root.querySelector("#combatEmbeddedAbilitiesSource .abilityGrid");
  grid.replaceChildren();
  TEST_ABILITY_KEYS.forEach((key) => {
    const block = append(grid, "div", { className: "abilityBlock", dataset: { ability: key } });
    const header = append(block, "div", { className: "abilityHeader" });
    append(header, "div", { className: "abilityTitle", text: TEST_ABILITY_LABELS[key] });
    const stats = append(header, "div", { className: "abilityStats" });
    append(stats, "input", { className: "abilityScore", type: "number", dataset: { stat: "score" } });
    const mod = append(stats, "div", { className: "abilityStat", text: "Mod " });
    append(mod, "span", { dataset: { stat: "mod" }, text: "+0" });
    const save = append(stats, "div", { className: "abilityStat", text: "Save " });
    append(save, "span", { dataset: { stat: "save" }, text: "+0" });
    append(save, "input", { type: "checkbox", dataset: { stat: "saveProf" } });
    append(block, "div", { className: "abilitySkills" });
  });
}

function installBuilderAbilitiesPanelDom(document) {
  const panel = append(document.body, "section", { id: "charBuilderAbilitiesPanel" });
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  const content = append(panel, "div", { id: "charBuilderAbilitiesContent" });
  const unavailable = append(content, "p", { id: "charBuilderAbilitiesUnavailable" });
  unavailable.hidden = true;
  const grid = append(content, "div", { id: "charBuilderAbilitiesGrid" });
  [
    ["Str", "str"],
    ["Dex", "dex"],
    ["Con", "con"],
    ["Int", "int"],
    ["Wis", "wis"],
    ["Cha", "cha"]
  ].forEach(([suffix]) => {
    const label = append(grid, "label", { id: `charBuilderAbility${suffix}Field` });
    append(label, "input", { id: `charBuilderAbility${suffix}`, type: "number" });
  });
}

function installBuilderIdentityPanelDom(document) {
  const panel = append(document.body, "section", { id: "charBuilderIdentityPanel" });
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  const content = append(panel, "div", { id: "charBuilderIdentityContent" });
  const unavailable = append(content, "p", { id: "charBuilderIdentityUnavailable" });
  unavailable.hidden = true;
  const grid = append(content, "div", { id: "charBuilderIdentityGrid" });
  [
    ["Race", "charBuilderRaceSelect"],
    ["Class", "charBuilderClassSelect"],
    ["Background", "charBuilderBackgroundSelect"]
  ].forEach(([, id]) => {
    append(grid, "select", { id });
  });
  append(grid, "input", { id: "charBuilderLevelInput", type: "number" });
}

function installBuilderSummaryPanelDom(document) {
  const panel = append(document.body, "section", { id: "charBuilderSummaryPanel" });
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  append(panel, "div", { id: "charBuilderSummaryContent" });
}

function abilityBlock(root, key) {
  return root.querySelector(`.abilityBlock[data-ability="${key}"]`);
}

function abilityScoreInput(root, key) {
  return abilityBlock(root, key).querySelector(".abilityScore");
}

function abilityModText(root, key) {
  return abilityBlock(root, key).querySelector('[data-stat="mod"]').textContent;
}

function abilitySaveText(root, key) {
  return abilityBlock(root, key).querySelector('[data-stat="save"]').textContent;
}

function skillValueText(root, key) {
  return root.querySelector(`[data-skill-value="${key}"]`)?.textContent || "";
}

function installSkillRow(root, ability, skillKey, label) {
  const skills = abilityBlock(root, ability).querySelector(".abilitySkills");
  const row = append(skills, "div", { className: "skillRow" });
  append(row, "input", { type: "checkbox", dataset: { skillProf: skillKey } });
  append(row, "span", { text: label });
  append(row, "span", { dataset: { skillValue: skillKey }, text: "+0" });
  return row;
}

function abilityAdjustmentInput(root, key) {
  return root.querySelector(`#miscSave_${key}`);
}

function builderSummaryAbilityText(root, key) {
  return root.querySelector(`.builderAbilityRow[data-ability="${key}"] .builderAbilityValue`)?.textContent || "";
}

function abilityBuilderHint(root) {
  return root.querySelector(".builderSheetHint");
}

function makeAbilityRows(scores) {
  return Object.fromEntries(TEST_ABILITY_KEYS.map((key) => [
    key,
    { score: scores[key], mod: null, save: null }
  ]));
}

function makeBuilder(id, base, flatScores = {}) {
  const character = makeDefaultBuilderCharacterEntry(`Builder ${id}`);
  character.id = id;
  character.build.abilities.base = { ...base };
  if (Object.keys(flatScores).length) character.abilities = makeAbilityRows(flatScores);
  return character;
}

function makeCharacter(id, name, overrides = {}) {
  return { ...makeDefaultCharacterEntry(name), id, ...overrides };
}

function makeState(activeId = "char_a") {
  const first = makeCharacter("char_a", "Aria", {
    hpCur: 7,
    hpMax: 11,
    ac: 13,
    spells: { levels: [{ id: "lvl_a", label: "1st Level", hasSlots: true, spells: [{ id: "spell_a", name: "Shield" }] }] },
    attacks: [{ id: "atk_a", name: "Dagger", bonus: "+4", damage: "1d4", range: "20/60", type: "Piercing" }],
    inventoryItems: [{ title: "Pack", notes: "rope" }],
    activeInventoryIndex: 0,
    armorProf: "Light",
    personality: { traits: "Careful", ideals: "", bonds: "", flaws: "", notes: "" }
  });
  const second = makeCharacter("char_b", "Bryn", {
    hpCur: 21,
    hpMax: 30,
    ac: 16,
    spells: { levels: [{ id: "lvl_b", label: "Cantrips", hasSlots: false, spells: [{ id: "spell_b", name: "Ray of Frost" }] }] },
    attacks: [{ id: "atk_b", name: "Longsword", bonus: "+6", damage: "1d8+3", range: "5", type: "Slashing" }],
    inventoryItems: [{ title: "Satchel", notes: "chalk" }],
    activeInventoryIndex: 0,
    armorProf: "Medium",
    personality: { traits: "Bold", ideals: "", bonds: "", flaws: "", notes: "" }
  });
  return {
    appShell: { activeCampaignId: "campaign_test" },
    characters: { activeId, entries: [first, second] },
    combat: { workspace: { embeddedPanels: [], panelCollapsed: {} } }
  };
}

function makeDeps(state) {
  const SaveManager = { markDirty: vi.fn() };
  const bindText = (id, getter, setter) => {
    const el = document.getElementById(id);
    if (!el) return null;
    el.value = getter?.() ?? "";
    el.addEventListener("input", () => {
      setter?.(el.value);
      SaveManager.markDirty();
    });
    return el;
  };
  const bindNumber = (id, getter, setter) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const value = getter?.();
    el.value = value == null ? "" : String(value);
    el.addEventListener("input", () => {
      setter?.(el.value === "" ? null : Number(el.value));
      SaveManager.markDirty();
    });
    return el;
  };
  return {
    state,
    SaveManager,
    Popovers: { register: vi.fn(() => ({ destroy() {} })), open: vi.fn() },
    bindText,
    bindNumber,
    setStatus: vi.fn(),
    autoSizeInput: vi.fn(),
    enhanceNumberSteppers: vi.fn(),
    applyTextareaSize: vi.fn(),
    uiConfirm: vi.fn(async () => true),
    uiPrompt: vi.fn(async () => "New"),
    uiAlert: vi.fn(async () => {}),
    blobIdToObjectUrl: vi.fn(async () => null),
    pickCropStorePortrait: vi.fn()
  };
}

function initAllCharacterPanels(deps) {
  return [
    initBasicsPanel(deps),
    initVitalsPanel(deps),
    initSpellsPanel(deps),
    initAttacksPanel(deps),
    initEquipmentPanel(deps),
    initProficienciesPanel(deps),
    initPersonalityPanel(deps),
    initAbilitiesPanel(deps)
  ].filter(Boolean);
}

function dispatchInput(target, dispatchTarget = target) {
  class TargetedInputEvent extends Event {
    get target() {
      return target;
    }
  }
  dispatchTarget.dispatchEvent(new TargetedInputEvent("input", { bubbles: true, cancelable: true }));
}

function dispatchChange(target) {
  target.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
}

function dispatchTargetedEvent(dispatchTarget, type, target, props = {}) {
  class TargetedEvent extends Event {
    get target() {
      return target;
    }
  }
  const event = new TargetedEvent(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  dispatchTarget.dispatchEvent(event);
  return event;
}

function getResourceTileByName(name) {
  return Array.from(document.querySelectorAll(".resourceTile"))
    .find((tile) => tile.querySelector(".resourceTitle")?.textContent === name);
}

function openResourceSettingsWithKey(tile, key = "Enter") {
  dispatchTargetedEvent(document.getElementById("charVitalsTiles"), "keydown", tile, { key });
  return document.getElementById("resourceRecoveryDialogOverlay");
}

function clickDialogButton(selector) {
  const button = document.querySelector(selector);
  dispatchTargetedEvent(document, "click", button);
}

function fillFeatureDialog(values) {
  for (const [key, value] of Object.entries(values)) {
    const field = document.querySelector(`[data-feature-field="${key}"]`);
    expect(field).not.toBeNull();
    field.value = value;
  }
}

describe("character panels active character resolution", () => {
  let document;

  beforeEach(() => {
    document = installFakeDom();
    buildCharacterPanelDom(document);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not throw when there is no active character", () => {
    const state = { characters: { activeId: null, entries: [] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    expect(() => initAllCharacterPanels(deps)).not.toThrow();
  });

  it("initializes after creating a new active character", () => {
    const entry = makeCharacter("char_new", "New Hero", { hpCur: 9, hpMax: 9 });
    const state = { characters: { activeId: entry.id, entries: [entry] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    let apis = [];
    expect(() => { apis = initAllCharacterPanels(deps); }).not.toThrow();
    expect(document.getElementById("charName").value).toBe("New Hero");
    expect(document.getElementById("charHpCur").value).toBe("9");
    apis.forEach((api) => api?.destroy?.());
  });

  it("displays builder-derived Basics identity fields without materializing flat fields", () => {
    const builder = makeBuilder("char_builder", { str: 16, dex: 14, con: 13, int: 12, wis: 10, cha: 8 });
    builder.classLevel = "Persisted Class";
    builder.race = "Persisted Race";
    builder.background = "Persisted Background";
    builder.build.classId = "class_fighter";
    builder.build.raceId = "race_elf";
    builder.build.backgroundId = "background_soldier";
    builder.build.level = 5;
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initBasicsPanel(deps);

    expect(document.getElementById("charClassLevel").value).toBe("Fighter 5");
    expect(document.getElementById("charRace").value).toBe("Elf");
    expect(document.getElementById("charBackground").value).toBe("Soldier");
    ["charClassLevel", "charRace", "charBackground"].forEach((id) => {
      const input = document.getElementById(id);
      expect(input.readOnly).toBe(true);
      expect(input.getAttribute("aria-readonly")).toBe("true");
    });
    expect(builder.classLevel).toBe("Persisted Class");
    expect(builder.race).toBe("Persisted Race");
    expect(builder.background).toBe("Persisted Background");
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("does not show a bare numeric builder class level when no class label exists", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.classLevel = "Persisted Class";
    builder.build.classId = null;
    builder.build.level = 5;
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initBasicsPanel(deps);

    expect(document.getElementById("charClassLevel").value).toBe("");
    expect(builder.classLevel).toBe("Persisted Class");
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("refreshes normal Basics display after Builder Identity edits", () => {
    installBuilderIdentityPanelDom(document);
    const builder = makeBuilder("char_builder", { str: 16, dex: 14, con: 13, int: 12, wis: 10, cha: 8 });
    builder.classLevel = "Persisted Class";
    builder.race = "Persisted Race";
    builder.background = "Persisted Background";
    builder.build.classId = "class_fighter";
    builder.build.raceId = "race_elf";
    builder.build.backgroundId = "background_soldier";
    builder.build.level = 5;
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const basicsApi = initBasicsPanel(deps);
    const identityApi = initBuilderIdentityPanel(deps);

    expect(document.getElementById("charClassLevel").value).toBe("Fighter 5");

    const classSelect = document.getElementById("charBuilderClassSelect");
    classSelect.value = "class_wizard";
    dispatchChange(classSelect);
    const raceSelect = document.getElementById("charBuilderRaceSelect");
    raceSelect.value = "race_human";
    dispatchChange(raceSelect);
    const backgroundSelect = document.getElementById("charBuilderBackgroundSelect");
    backgroundSelect.value = "background_sage";
    dispatchChange(backgroundSelect);
    const levelInput = document.getElementById("charBuilderLevelInput");
    levelInput.value = "6";
    dispatchChange(levelInput);

    expect(document.getElementById("charClassLevel").value).toBe("Wizard 6");
    expect(document.getElementById("charRace").value).toBe("Human");
    expect(document.getElementById("charBackground").value).toBe("Sage");
    expect(builder.classLevel).toBe("Persisted Class");
    expect(builder.race).toBe("Persisted Race");
    expect(builder.background).toBe("Persisted Background");

    identityApi.destroy();
    basicsApi.destroy();
  });

  it("ignores attempted edits to builder-owned Basics identity fields without marking dirty", () => {
    const builder = makeBuilder("char_builder", { str: 16, dex: 14, con: 13, int: 12, wis: 10, cha: 8 });
    builder.classLevel = "Persisted Class";
    builder.race = "Persisted Race";
    builder.background = "Persisted Background";
    builder.build.classId = "class_fighter";
    builder.build.raceId = "race_elf";
    builder.build.backgroundId = "background_soldier";
    builder.build.level = 5;
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initBasicsPanel(deps);

    document.getElementById("charClassLevel").value = "Rogue 20";
    dispatchInput(document.getElementById("charClassLevel"));
    document.getElementById("charRace").value = "Dragon";
    dispatchInput(document.getElementById("charRace"));
    document.getElementById("charBackground").value = "Pirate";
    dispatchInput(document.getElementById("charBackground"));

    expect(document.getElementById("charClassLevel").value).toBe("Fighter 5");
    expect(document.getElementById("charRace").value).toBe("Elf");
    expect(document.getElementById("charBackground").value).toBe("Soldier");
    expect(builder.classLevel).toBe("Persisted Class");
    expect(builder.race).toBe("Persisted Race");
    expect(builder.background).toBe("Persisted Background");
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("keeps freeform Basics identity fields editable against flat fields only", () => {
    const freeform = makeCharacter("char_free", "Freeform", {
      build: null,
      classLevel: "Ranger 3",
      race: "Halfling",
      background: "Guide"
    });
    const state = { characters: { activeId: "char_free", entries: [freeform] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initBasicsPanel(deps);

    expect(document.getElementById("charClassLevel").value).toBe("Ranger 3");
    expect(document.getElementById("charRace").value).toBe("Halfling");
    expect(document.getElementById("charBackground").value).toBe("Guide");
    ["charClassLevel", "charRace", "charBackground"].forEach((id) => {
      expect(document.getElementById(id).readOnly).toBe(false);
    });

    document.getElementById("charClassLevel").value = "Ranger 4";
    dispatchInput(document.getElementById("charClassLevel"));
    document.getElementById("charRace").value = "Gnome";
    dispatchInput(document.getElementById("charRace"));
    document.getElementById("charBackground").value = "Cartographer";
    dispatchInput(document.getElementById("charBackground"));

    expect(freeform.classLevel).toBe("Ranger 4");
    expect(freeform.race).toBe("Gnome");
    expect(freeform.background).toBe("Cartographer");
    expect(freeform.build).toBeNull();
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(3);

    api.destroy();
  });

  it("restores Basics ownership when switching between builder and freeform characters", () => {
    const builder = makeBuilder("char_builder", { str: 16, dex: 14, con: 13, int: 12, wis: 10, cha: 8 });
    builder.build.classId = "class_fighter";
    builder.build.raceId = "race_elf";
    builder.build.backgroundId = "background_soldier";
    builder.build.level = 5;
    const freeform = makeCharacter("char_free", "Freeform", {
      build: null,
      classLevel: "Bard 2",
      race: "Tiefling",
      background: "Minstrel"
    });
    const state = { characters: { activeId: "char_builder", entries: [builder, freeform] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initBasicsPanel(deps);

    expect(document.getElementById("charClassLevel").value).toBe("Fighter 5");
    expect(document.getElementById("charClassLevel").readOnly).toBe(true);

    state.characters.activeId = "char_free";
    notifyPanelDataChanged("character-fields", { source: {} });
    expect(document.getElementById("charClassLevel").value).toBe("Bard 2");
    expect(document.getElementById("charRace").value).toBe("Tiefling");
    expect(document.getElementById("charBackground").value).toBe("Minstrel");
    expect(document.getElementById("charClassLevel").readOnly).toBe(false);

    document.getElementById("charClassLevel").value = "Bard 3";
    dispatchInput(document.getElementById("charClassLevel"));
    expect(freeform.classLevel).toBe("Bard 3");

    state.characters.activeId = "char_builder";
    notifyPanelDataChanged("character-fields", { source: {} });
    expect(document.getElementById("charClassLevel").value).toBe("Fighter 5");
    expect(document.getElementById("charRace").value).toBe("Elf");
    expect(document.getElementById("charBackground").value).toBe("Soldier");
    expect(document.getElementById("charClassLevel").readOnly).toBe(true);

    api.destroy();
  });

  it("keeps malformed builder Basics identity display non-mutating and builder-owned", () => {
    const builder = makeCharacter("char_builder", "Malformed", {
      classLevel: "Legacy Class",
      race: "Legacy Race",
      background: "Legacy Background",
      build: {
        version: 1,
        classId: "class_missing",
        raceId: "race_missing",
        backgroundId: "background_missing",
        level: 5
      }
    });
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initBasicsPanel(deps);

    expect(document.getElementById("charClassLevel").value).toBe("");
    expect(document.getElementById("charRace").value).toBe("");
    expect(document.getElementById("charBackground").value).toBe("");
    expect(document.getElementById("charClassLevel").readOnly).toBe(true);

    document.getElementById("charClassLevel").value = "Fixed Class";
    dispatchInput(document.getElementById("charClassLevel"));
    document.getElementById("charRace").value = "Fixed Race";
    dispatchInput(document.getElementById("charRace"));
    document.getElementById("charBackground").value = "Fixed Background";
    dispatchInput(document.getElementById("charBackground"));

    expect(builder.classLevel).toBe("Legacy Class");
    expect(builder.race).toBe("Legacy Race");
    expect(builder.background).toBe("Legacy Background");
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("displays builder-derived Vitals speed and hit dice without materializing stale flat fields", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "race_human";
    builder.build.classId = "class_fighter";
    builder.build.level = 5;
    builder.speed = 99;
    builder.hitDieAmt = 99;
    builder.hitDieSize = 99;
    builder.hpCur = 7;
    builder.hpMax = 11;
    builder.ac = 13;
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);

    expect(document.getElementById("charSpeed").value).toBe("30");
    expect(document.getElementById("hitDieAmt").value).toBe("5");
    expect(document.getElementById("hitDieSize").value).toBe("10");
    ["charSpeed", "hitDieAmt", "hitDieSize"].forEach((id) => {
      const input = document.getElementById(id);
      expect(input.readOnly).toBe(true);
      expect(input.disabled).toBe(true);
      expect(input.dataset.builderOwned).toBe("true");
      expect(input.getAttribute("aria-readonly")).toBe("true");
    });
    expect(document.getElementById("charHpCur").value).toBe("7");
    expect(document.getElementById("charHpMax").value).toBe("11");
    expect(document.getElementById("charAC").value).toBe("13");
    expect(builder.speed).toBe(99);
    expect(builder.hitDieAmt).toBe(99);
    expect(builder.hitDieSize).toBe(99);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("ignores attempted builder Vitals speed and hit dice input without mutating or marking dirty", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "race_human";
    builder.build.classId = "class_fighter";
    builder.build.level = 5;
    builder.speed = 99;
    builder.hitDieAmt = 99;
    builder.hitDieSize = 99;
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);

    document.getElementById("charSpeed").value = "45";
    dispatchInput(document.getElementById("charSpeed"));
    document.getElementById("hitDieAmt").value = "12";
    dispatchInput(document.getElementById("hitDieAmt"));
    document.getElementById("hitDieSize").value = "12";
    dispatchInput(document.getElementById("hitDieSize"));

    expect(document.getElementById("charSpeed").value).toBe("30");
    expect(document.getElementById("hitDieAmt").value).toBe("5");
    expect(document.getElementById("hitDieSize").value).toBe("10");
    expect(builder.speed).toBe(99);
    expect(builder.hitDieAmt).toBe(99);
    expect(builder.hitDieSize).toBe(99);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("refreshes builder-derived Vitals speed and hit dice after Builder Identity edits", () => {
    installBuilderIdentityPanelDom(document);
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = null;
    builder.build.classId = "class_fighter";
    builder.build.level = 5;
    builder.speed = 99;
    builder.hitDieAmt = 99;
    builder.hitDieSize = 99;
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const vitalsApi = initVitalsPanel(deps);
    const identityApi = initBuilderIdentityPanel(deps);

    expect(document.getElementById("charSpeed").value).toBe("");
    expect(document.getElementById("hitDieAmt").value).toBe("5");
    expect(document.getElementById("hitDieSize").value).toBe("10");

    const raceSelect = document.getElementById("charBuilderRaceSelect");
    raceSelect.value = "race_human";
    dispatchChange(raceSelect);
    const classSelect = document.getElementById("charBuilderClassSelect");
    classSelect.value = "class_wizard";
    dispatchChange(classSelect);
    const levelInput = document.getElementById("charBuilderLevelInput");
    levelInput.value = "9";
    dispatchChange(levelInput);

    expect(builder.build.raceId).toBe("race_human");
    expect(builder.build.classId).toBe("class_wizard");
    expect(builder.build.level).toBe(9);
    expect(document.getElementById("charSpeed").value).toBe("30");
    expect(document.getElementById("hitDieAmt").value).toBe("9");
    expect(document.getElementById("hitDieSize").value).toBe("6");
    expect(builder.speed).toBe(99);
    expect(builder.hitDieAmt).toBe(99);
    expect(builder.hitDieSize).toBe(99);

    identityApi.destroy();
    vitalsApi.destroy();
  });

  it("keeps malformed builder Vitals speed and hit dice blank, owned, and non-mutating", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "race_missing";
    builder.build.classId = "class_missing";
    builder.build.level = Symbol("bad-level");
    builder.speed = 99;
    builder.hitDieAmt = 99;
    builder.hitDieSize = 99;
    const beforeFlat = {
      speed: builder.speed,
      hitDieAmt: builder.hitDieAmt,
      hitDieSize: builder.hitDieSize
    };
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);

    ["charSpeed", "hitDieAmt", "hitDieSize"].forEach((id) => {
      const input = document.getElementById(id);
      expect(input.value).toBe("");
      expect(input.readOnly).toBe(true);
      expect(input.disabled).toBe(true);
      expect(input.dataset.builderOwned).toBe("true");
      input.value = "42";
      dispatchInput(input);
      expect(input.value).toBe("");
    });
    expect(builder.speed).toBe(beforeFlat.speed);
    expect(builder.hitDieAmt).toBe(beforeFlat.hitDieAmt);
    expect(builder.hitDieSize).toBe(beforeFlat.hitDieSize);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("restores Vitals speed and hit dice ownership and source when switching builder and freeform characters", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "race_human";
    builder.build.classId = "class_fighter";
    builder.build.level = 5;
    builder.speed = 99;
    builder.hitDieAmt = 99;
    builder.hitDieSize = 99;
    const freeform = makeCharacter("char_free", "Freeform", {
      build: null,
      speed: 25,
      hitDieAmt: 2,
      hitDieSize: 8
    });
    const state = { characters: { activeId: "char_builder", entries: [builder, freeform] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);

    expect(document.getElementById("charSpeed").value).toBe("30");
    expect(document.getElementById("charSpeed").disabled).toBe(true);

    state.characters.activeId = "char_free";
    notifyPanelDataChanged("vitals", { source: {} });

    expect(document.getElementById("charSpeed").value).toBe("25");
    expect(document.getElementById("hitDieAmt").value).toBe("2");
    expect(document.getElementById("hitDieSize").value).toBe("8");
    ["charSpeed", "hitDieAmt", "hitDieSize"].forEach((id) => {
      expect(document.getElementById(id).disabled).toBe(false);
      expect(document.getElementById(id).readOnly).toBe(false);
      expect(document.getElementById(id).dataset.builderOwned).toBeUndefined();
    });

    document.getElementById("charSpeed").value = "35";
    dispatchInput(document.getElementById("charSpeed"));
    expect(freeform.speed).toBe(35);

    state.characters.activeId = "char_builder";
    notifyPanelDataChanged("vitals", { source: {} });

    expect(document.getElementById("charSpeed").value).toBe("30");
    expect(document.getElementById("hitDieAmt").value).toBe("5");
    expect(document.getElementById("hitDieSize").value).toBe("10");
    expect(document.getElementById("charSpeed").disabled).toBe(true);
    expect(builder.speed).toBe(99);

    api.destroy();
  });

  it("keeps freeform Vitals speed and hit dice editable against flat fields only", () => {
    const freeform = makeCharacter("char_free", "Freeform", {
      build: null,
      speed: 25,
      hitDieAmt: 2,
      hitDieSize: 8
    });
    const state = { characters: { activeId: "char_free", entries: [freeform] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);

    expect(document.getElementById("charSpeed").value).toBe("25");
    expect(document.getElementById("hitDieAmt").value).toBe("2");
    expect(document.getElementById("hitDieSize").value).toBe("8");
    ["charSpeed", "hitDieAmt", "hitDieSize"].forEach((id) => {
      expect(document.getElementById(id).readOnly).toBe(false);
      expect(document.getElementById(id).disabled).toBe(false);
    });

    document.getElementById("charSpeed").value = "35";
    dispatchInput(document.getElementById("charSpeed"));
    document.getElementById("hitDieAmt").value = "3";
    dispatchInput(document.getElementById("hitDieAmt"));
    document.getElementById("hitDieSize").value = "10";
    dispatchInput(document.getElementById("hitDieSize"));

    expect(freeform.speed).toBe(35);
    expect(freeform.hitDieAmt).toBe(3);
    expect(freeform.hitDieSize).toBe(10);
    expect(freeform.build).toBeNull();
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(3);

    api.destroy();
  });

  it("keeps builder HP and AC manual while speed and hit dice are builder-owned", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "race_human";
    builder.build.classId = "class_fighter";
    builder.build.level = 5;
    builder.hpCur = 7;
    builder.hpMax = 11;
    builder.ac = 13;
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);

    expect(document.getElementById("charHpCur").readOnly).toBe(false);
    expect(document.getElementById("charHpMax").readOnly).toBe(false);
    expect(document.getElementById("charAC").readOnly).toBe(false);

    document.getElementById("charHpCur").value = "8";
    dispatchInput(document.getElementById("charHpCur"));
    document.getElementById("charHpMax").value = "12";
    dispatchInput(document.getElementById("charHpMax"));
    document.getElementById("charAC").value = "14";
    dispatchInput(document.getElementById("charAC"));

    expect(builder.hpCur).toBe(8);
    expect(builder.hpMax).toBe(12);
    expect(builder.ac).toBe(14);
    expect(document.getElementById("charSpeed").value).toBe("30");
    expect(document.getElementById("hitDieAmt").value).toBe("5");
    expect(document.getElementById("hitDieSize").value).toBe("10");
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(3);

    api.destroy();
  });

  it("renders the Vitals resource recovery tip and keyboard-reachable resource settings target without a visible settings button", () => {
    const character = makeCharacter("char_a", "Ada", {
      resources: [{ id: "ki", name: "Ki", cur: 1, max: 3 }]
    });
    const state = { characters: { activeId: "char_a", entries: [character] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);
    const tile = getResourceTileByName("Ki");

    expect(document.querySelector(".vitalsResourceTip")?.textContent)
      .toBe("Tip: press and hold a resource tile to choose how it recovers on rests.");
    expect(tile.getAttribute("tabindex")).toBe("0");
    expect(tile.getAttribute("role")).toBe("button");
    expect(tile.getAttribute("aria-label")).toBe("Open recovery settings for Ki");
    expect(tile.querySelector("[data-resource-recovery-open]")).toBeNull();
    expect(tile.querySelector(".resourceSettingsBtn")).toBeNull();

    api.destroy();
  });

  it("opens Resource Settings with Enter and displays missing recovery metadata as Manual", () => {
    const character = makeCharacter("char_a", "Ada", {
      resources: [{ id: "ki", name: "Ki", cur: 1, max: 3 }]
    });
    const state = { characters: { activeId: "char_a", entries: [character] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);
    const tile = getResourceTileByName("Ki");
    tile.focus();
    const overlay = openResourceSettingsWithKey(tile, "Enter");

    expect(overlay.hidden).toBe(false);
    expect(document.getElementById("resourceRecoveryDialogTitle").textContent).toBe("Resource Settings");
    expect(document.querySelector("[data-resource-recovery-name]").textContent).toBe("Ki");
    expect(document.getElementById("resourceRecoverySelect").value).toBe("manual");

    api.destroy();
  });

  it("opens Resource Settings with Space from the focused resource tile", () => {
    const character = makeCharacter("char_a", "Ada", {
      resources: [{ id: "ki", name: "Ki", cur: 1, max: 3 }]
    });
    const state = { characters: { activeId: "char_a", entries: [character] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);
    const tile = getResourceTileByName("Ki");
    tile.focus();
    const overlay = openResourceSettingsWithKey(tile, " ");

    expect(overlay.hidden).toBe(false);

    api.destroy();
  });

  it("opens Resource Settings after press-and-hold on the resource tile body but not after a quick tap", () => {
    vi.useFakeTimers();
    const character = makeCharacter("char_a", "Ada", {
      resources: [{ id: "ki", name: "Ki", cur: 1, max: 3 }]
    });
    const state = { characters: { activeId: "char_a", entries: [character] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    try {
      const api = initVitalsPanel(deps);
      const wrap = document.getElementById("charVitalsTiles");
      const tile = getResourceTileByName("Ki");

      dispatchTargetedEvent(wrap, "pointerdown", tile, { clientX: 10, clientY: 10 });
      dispatchTargetedEvent(wrap, "pointerup", tile, { clientX: 10, clientY: 10 });
      vi.advanceTimersByTime(600);
      expect(document.getElementById("resourceRecoveryDialogOverlay")).toBeNull();

      dispatchTargetedEvent(wrap, "pointerdown", tile, { clientX: 10, clientY: 10 });
      vi.advanceTimersByTime(550);
      expect(document.getElementById("resourceRecoveryDialogOverlay").hidden).toBe(false);

      api.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels pending resource long-press when the pointer moves meaningfully", () => {
    vi.useFakeTimers();
    const character = makeCharacter("char_a", "Ada", {
      resources: [{ id: "ki", name: "Ki", cur: 1, max: 3 }]
    });
    const state = { characters: { activeId: "char_a", entries: [character] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    try {
      const api = initVitalsPanel(deps);
      const wrap = document.getElementById("charVitalsTiles");
      const tile = getResourceTileByName("Ki");

      dispatchTargetedEvent(wrap, "pointerdown", tile, { clientX: 10, clientY: 10 });
      dispatchTargetedEvent(wrap, "pointermove", tile, { clientX: 40, clientY: 10 });
      vi.advanceTimersByTime(600);

      expect(document.getElementById("resourceRecoveryDialogOverlay")).toBeNull();

      api.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not open Resource Settings when long-press starts on resource inputs or buttons", () => {
    vi.useFakeTimers();
    const character = makeCharacter("char_a", "Ada", {
      resources: [{ id: "ki", name: "Ki", cur: 1, max: 3 }]
    });
    const state = { characters: { activeId: "char_a", entries: [character] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    try {
      const api = initVitalsPanel(deps);
      const wrap = document.getElementById("charVitalsTiles");
      const tile = getResourceTileByName("Ki");
      const [cur, max] = tile.querySelectorAll("input");
      const del = tile.querySelector(".resourceDeleteBtn");
      const step = document.createElement("button");
      step.type = "button";
      step.className = "numStepBtn";
      tile.appendChild(step);

      [cur, max, del, step].forEach((target) => {
        dispatchTargetedEvent(wrap, "pointerdown", target, { clientX: 10, clientY: 10 });
        vi.advanceTimersByTime(600);
        expect(document.getElementById("resourceRecoveryDialogOverlay")).toBeNull();
      });

      api.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes Resource Settings on Cancel without mutating the resource", () => {
    const character = makeCharacter("char_a", "Ada", {
      resources: [{ id: "ki", name: "Ki", cur: 1, max: 3 }]
    });
    const state = { characters: { activeId: "char_a", entries: [character] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);
    const tile = getResourceTileByName("Ki");
    const overlay = openResourceSettingsWithKey(tile);
    document.getElementById("resourceRecoverySelect").value = "shortRest";

    clickDialogButton("[data-resource-recovery-cancel]");

    expect(overlay.hidden).toBe(true);
    expect(character.resources[0].recovery).toBeUndefined();
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("closes Resource Settings on Escape without mutating the resource", () => {
    const character = makeCharacter("char_a", "Ada", {
      resources: [{ id: "ki", name: "Ki", cur: 1, max: 3 }]
    });
    const state = { characters: { activeId: "char_a", entries: [character] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);
    const tile = getResourceTileByName("Ki");
    const overlay = openResourceSettingsWithKey(tile);
    document.getElementById("resourceRecoverySelect").value = "shortRest";

    dispatchTargetedEvent(document, "keydown", document, { key: "Escape" });

    expect(overlay.hidden).toBe(true);
    expect(character.resources[0].recovery).toBeUndefined();
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("saves only the selected resource recovery metadata and preserves existing resource fields", () => {
    const character = makeCharacter("char_a", "Ada", {
      resources: [
        { id: "ki", name: "Ki", cur: 1, max: 3, note: "discipline" },
        { id: "rage", name: "Rage", cur: 0, max: 2, recovery: "manual" }
      ]
    });
    const state = { characters: { activeId: "char_a", entries: [character] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);
    const tile = getResourceTileByName("Ki");
    openResourceSettingsWithKey(tile);
    document.getElementById("resourceRecoverySelect").value = "shortRest";

    clickDialogButton("[data-resource-recovery-save]");

    expect(character.resources).toEqual([
      { id: "ki", name: "Ki", cur: 1, max: 3, note: "discipline", recovery: "shortRest" },
      { id: "rage", name: "Rage", cur: 0, max: 2, recovery: "manual" }
    ]);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);

    api.destroy();
  });

  it("keeps existing resource input and delete interactions working", async () => {
    const character = makeCharacter("char_a", "Ada", {
      resources: [
        { id: "ki", name: "Ki", cur: 1, max: 3 },
        { id: "rage", name: "Rage", cur: 0, max: 2 }
      ]
    });
    const state = { characters: { activeId: "char_a", entries: [character] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);
    const kiTile = getResourceTileByName("Ki");
    const [cur, max] = kiTile.querySelectorAll("input");
    cur.value = "2";
    dispatchInput(cur);
    max.value = "4";
    dispatchInput(max);
    expect(character.resources[0]).toMatchObject({ name: "Ki", cur: 2, max: 4 });

    const del = getResourceTileByName("Rage").querySelector(".resourceDeleteBtn");
    del.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    expect(character.resources.map((resource) => resource.name)).toEqual(["Ki"]);

    api.destroy();
  });

  it("displays builder-derived Vitals proficiency without materializing stale flat proficiency", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.level = 5;
    builder.proficiency = 9;
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);
    const prof = document.getElementById("charProf");

    expect(prof.value).toBe("3");
    expect(prof.readOnly).toBe(true);
    expect(prof.disabled).toBe(true);
    expect(prof.dataset.builderOwned).toBe("true");
    expect(prof.getAttribute("aria-readonly")).toBe("true");
    expect(builder.proficiency).toBe(9);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("displays Dragonborn Breath Weapon DC in Vitals from derived ancestry mechanics", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "dragonborn";
    builder.build.classId = "class_fighter";
    builder.build.level = 5;
    builder.build.choicesByLevel = { "1": { "dragonborn-ancestry": "red" } };
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);
    const derived = deriveCharacter(builder);
    const tile = document.querySelector('.charTile[data-vital-key="breathWeaponDC"]');

    expect(tile).not.toBeNull();
    expect(tile.textContent).toContain("Breath Weapon DC");
    expect(tile.querySelector(".builderDerivedVitalValue").textContent)
      .toBe(String(derived.dragonbornAncestry.breathWeapon.saveDC));
    expect(derived.dragonbornAncestry.breathWeapon.saveDC).toBe(13);
    expect(builder).not.toHaveProperty("breathWeaponDC");
    expect(builder).not.toHaveProperty("breathWeapon");
    expect(builder.build).not.toHaveProperty("breathWeaponDC");
    expect(builder.build).not.toHaveProperty("breathWeapon");
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("renders Dragonborn Breath Weapon in Abilities & Features from derived ancestry mechanics", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "dragonborn";
    builder.build.classId = "class_fighter";
    builder.build.level = 5;
    builder.build.choicesByLevel = { "1": { "dragonborn-ancestry": "blue" } };
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesFeaturesPanel(deps);
    const card = document.querySelector('[data-feature-id="dragonborn-breath-weapon"]');

    expect(card).not.toBeNull();
    expect(card.textContent).toContain("Breath Weapon");
    expect(card.textContent).toContain("Dragonborn / Blue Draconic Ancestry");
    expect(card.textContent).toContain("Action");
    expect(card.textContent).toContain("Dex DC 13");
    expect(card.textContent).toContain("5 by 30 ft. line");
    expect(card.textContent).toContain("2d6 Lightning");
    expect(card.textContent).toContain("Short or Long Rest");
    expect(card.textContent).toContain("successful save takes half");
    expect(document.getElementById("charAbilitiesFeaturesEmpty").hidden).toBe(true);
    expect(builder).not.toHaveProperty("derivedFeatureActions");
    expect(builder.build).not.toHaveProperty("derivedFeatureActions");
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("does not render Dragonborn Breath Weapon in Abilities & Features for non-Dragonborn builders", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "race_human";
    builder.build.choicesByLevel = { "1": { "dragonborn-ancestry": "blue" } };
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesFeaturesPanel(deps);

    expect(document.querySelector('[data-feature-id="dragonborn-breath-weapon"]')).toBeNull();
    expect(document.getElementById("charAbilitiesFeaturesEmpty").hidden).toBe(false);

    api.destroy();
  });

  it("keeps freeform characters out of derived Abilities & Features cards", () => {
    const freeform = makeCharacter("char_free", "Freeform", {
      build: null,
      race: "Dragonborn",
      proficiency: 2,
      abilities: { con: { score: 14 } }
    });
    const state = { characters: { activeId: "char_free", entries: [freeform] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesFeaturesPanel(deps);

    expect(deriveCharacter(freeform).derivedFeatureActions).toEqual([]);
    expect(document.querySelector('[data-feature-id="dragonborn-breath-weapon"]')).toBeNull();
    expect(document.getElementById("charAbilitiesFeaturesEmpty").hidden).toBe(false);

    api.destroy();
  });

  it("lets freeform characters create and render manual Abilities & Features cards", () => {
    const freeform = makeCharacter("char_free", "Freeform", {
      build: null,
      resources: [{ id: "ki", name: "Ki", cur: 1, max: 3 }]
    });
    const state = { characters: { activeId: "char_free", entries: [freeform] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesFeaturesPanel(deps);
    document.getElementById("addFeatureCardBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    fillFeatureDialog({
      name: "Sneak Attack",
      sourceType: "Class Feature",
      activation: "Once per turn",
      rangeArea: "Weapon range",
      saveDc: "None",
      damageEffect: "1d6 extra damage",
      description: "Deal extra damage when the attack qualifies."
    });
    clickDialogButton("[data-feature-dialog-save]");

    expect(freeform.manualFeatureCards).toHaveLength(1);
    expect(freeform.manualFeatureCards[0]).toMatchObject({
      name: "Sneak Attack",
      sourceType: "Class Feature",
      activation: "Once per turn",
      rangeArea: "Weapon range",
      saveDc: "None",
      damageEffect: "1d6 extra damage",
      description: "Deal extra damage when the attack qualifies."
    });
    expect(freeform.resources).toEqual([{ id: "ki", name: "Ki", cur: 1, max: 3 }]);
    expect(document.querySelector("[data-feature-kind='manual']").textContent).toContain("Sneak Attack");
    expect(document.querySelector("[data-feature-kind='manual']").textContent).toContain("1d6 extra damage");
    expect(document.getElementById("charAbilitiesFeaturesEmpty").hidden).toBe(true);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);

    api.destroy();
  });

  it("renders builder manual cards with derived cards while keeping derived cards read-only and unpersisted", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "dragonborn";
    builder.build.classId = "class_fighter";
    builder.build.level = 5;
    builder.build.choicesByLevel = { "1": { "dragonborn-ancestry": "blue" } };
    builder.manualFeatureCards = [{
      id: "manual_lucky",
      name: "Lucky Break",
      sourceType: "Custom",
      activation: "Reaction",
      rangeArea: "Self",
      saveDc: "",
      damageEffect: "Reroll a check",
      description: "A table-specific custom feature."
    }];
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesFeaturesPanel(deps);
    const derived = document.querySelector('[data-feature-id="dragonborn-breath-weapon"]');
    const manual = document.querySelector('[data-manual-feature-id="manual_lucky"]');

    expect(derived).not.toBeNull();
    expect(manual).not.toBeNull();
    expect(derived.querySelector("[data-feature-action='edit']")).toBeNull();
    expect(derived.querySelector("[data-feature-action='delete']")).toBeNull();
    expect(manual.querySelector("[data-feature-action='edit']")).not.toBeNull();
    expect(manual.querySelector("[data-feature-action='delete']")).not.toBeNull();
    expect(builder.manualFeatureCards).toHaveLength(1);
    expect(builder).not.toHaveProperty("derivedFeatureActions");
    expect(builder.build).not.toHaveProperty("derivedFeatureActions");
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("edits and deletes only manual persisted feature-card state", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "dragonborn";
    builder.build.choicesByLevel = { "1": { "dragonborn-ancestry": "red" } };
    builder.manualFeatureCards = [{
      id: "manual_boon",
      name: "Old Boon",
      sourceType: "Boon",
      activation: "Passive",
      rangeArea: "",
      saveDc: "",
      damageEffect: "Old effect",
      description: ""
    }];
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesFeaturesPanel(deps);
    const list = document.getElementById("charAbilitiesFeaturesList");
    const edit = document.querySelector('[data-manual-feature-id="manual_boon"] [data-feature-action="edit"]');
    dispatchTargetedEvent(list, "click", edit);
    fillFeatureDialog({
      name: "Updated Boon",
      damageEffect: "Updated effect"
    });
    clickDialogButton("[data-feature-dialog-save]");

    expect(builder.manualFeatureCards).toHaveLength(1);
    expect(builder.manualFeatureCards[0]).toMatchObject({
      id: "manual_boon",
      name: "Updated Boon",
      damageEffect: "Updated effect"
    });
    expect(document.querySelector('[data-feature-id="dragonborn-breath-weapon"]')).not.toBeNull();
    expect(builder).not.toHaveProperty("derivedFeatureActions");
    expect(builder.build).not.toHaveProperty("derivedFeatureActions");

    const del = document.querySelector('[data-manual-feature-id="manual_boon"] [data-feature-action="delete"]');
    dispatchTargetedEvent(list, "click", del);

    expect(builder.manualFeatureCards).toEqual([]);
    expect(document.querySelector('[data-feature-id="dragonborn-breath-weapon"]')).not.toBeNull();
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(2);

    api.destroy();
  });

  it("keeps the Dragonborn Breath Weapon DC Vitals item read-only", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "dragonborn";
    builder.build.choicesByLevel = { "1": { "dragonborn-ancestry": "red" } };
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);
    const tile = document.querySelector('.charTile[data-vital-key="breathWeaponDC"]');

    expect(tile.querySelector("input")).toBeNull();
    expect(tile.querySelector(".builderDerivedVitalValue").getAttribute("aria-readonly")).toBe("true");
    expect(tile.querySelector(".resourceDeleteBtn")).toBeNull();
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("does not show Breath Weapon DC in Vitals for non-Dragonborn builder characters", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "race_human";
    builder.build.choicesByLevel = { "1": { "dragonborn-ancestry": "red" } };
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);

    expect(document.querySelector('.charTile[data-vital-key="breathWeaponDC"]')).toBeNull();

    api.destroy();
  });

  it("does not show Breath Weapon DC in Vitals for freeform characters", () => {
    const freeform = makeCharacter("char_free", "Freeform", { build: null, con: 14 });
    const state = { characters: { activeId: "char_free", entries: [freeform] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);

    expect(document.querySelector('.charTile[data-vital-key="breathWeaponDC"]')).toBeNull();

    api.destroy();
  });

  it("does not show Breath Weapon DC in Vitals for Dragonborn builders without ancestry", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "dragonborn";
    builder.build.choicesByLevel = {};
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);

    expect(deriveCharacter(builder).dragonbornAncestry).toBeNull();
    expect(document.querySelector('.charTile[data-vital-key="breathWeaponDC"]')).toBeNull();

    api.destroy();
  });

  it("ignores attempted builder Vitals proficiency input without mutating or marking dirty", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.level = 5;
    builder.proficiency = 1;
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);
    const prof = document.getElementById("charProf");

    prof.value = "99";
    dispatchInput(prof);

    expect(prof.value).toBe("3");
    expect(builder.proficiency).toBe(1);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("keeps freeform Vitals proficiency editable against flat character fields", () => {
    const freeform = makeCharacter("char_free", "Freeform", {
      build: null,
      proficiency: 2
    });
    const state = { characters: { activeId: "char_free", entries: [freeform] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);
    const prof = document.getElementById("charProf");

    expect(prof.value).toBe("2");
    expect(prof.readOnly).toBe(false);
    expect(prof.disabled).toBe(false);
    expect(prof.dataset.builderOwned).toBeUndefined();

    prof.value = "4";
    dispatchInput(prof);

    expect(freeform.proficiency).toBe(4);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);

    api.destroy();
  });

  it("refreshes builder-derived Vitals proficiency after Builder Identity level edits", () => {
    installBuilderIdentityPanelDom(document);
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.level = 5;
    builder.proficiency = 1;
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const vitalsApi = initVitalsPanel(deps);
    const identityApi = initBuilderIdentityPanel(deps);

    expect(document.getElementById("charProf").value).toBe("3");

    const levelInput = document.getElementById("charBuilderLevelInput");
    levelInput.value = "9";
    dispatchChange(levelInput);

    expect(builder.build.level).toBe(9);
    expect(document.getElementById("charProf").value).toBe("4");
    expect(builder.proficiency).toBe(1);

    identityApi.destroy();
    vitalsApi.destroy();
  });

  it("uses builder-derived proficiency for Abilities and Skills even when flat proficiency and DOM are stale", () => {
    installAbilityBlocks(document);
    installSkillRow(document, "str", "athletics", "Athletics");
    const builder = makeBuilder("char_builder", { str: 15, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.level = 9;
    builder.proficiency = 1;
    builder.abilities.str.saveProf = true;
    builder.skills.athletics = { level: "prof", misc: 0, value: -99 };
    document.getElementById("charProf").value = "1";
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesPanel(deps);

    expect(abilityModText(document, "str")).toBe("+2");
    expect(abilitySaveText(document, "str")).toBe("+6");
    expect(skillValueText(document, "athletics")).toBe("+6");
    expect(builder.proficiency).toBe(1);
    expect(builder.skills.athletics.value).toBe(-99);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("displays builder-derived proficiency in embedded Combat Vitals", () => {
    const host = append(document.body, "div", { id: "combatVitalsHost" });
    renderVitalsEmbeddedContent(host);
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.level = 9;
    builder.proficiency = 1;
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel({
      ...deps,
      root: host,
      selectors: EMBEDDED_PANEL_HOST_SELECTORS.vitals
    });
    const prof = document.getElementById("combatEmbeddedCharProf");

    expect(prof.value).toBe("4");
    expect(prof.readOnly).toBe(true);
    expect(prof.disabled).toBe(true);
    expect(prof.dataset.builderOwned).toBe("true");
    expect(builder.proficiency).toBe(1);

    api.destroy();
  });

  it("displays builder-derived speed and hit dice in embedded Combat Vitals", () => {
    const host = append(document.body, "div", { id: "combatVitalsHost" });
    renderVitalsEmbeddedContent(host);
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.raceId = "race_human";
    builder.build.classId = "class_wizard";
    builder.build.level = 9;
    builder.speed = 99;
    builder.hitDieAmt = 99;
    builder.hitDieSize = 99;
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel({
      ...deps,
      root: host,
      selectors: EMBEDDED_PANEL_HOST_SELECTORS.vitals
    });

    expect(document.getElementById("combatEmbeddedCharSpeed").value).toBe("30");
    expect(document.getElementById("combatEmbeddedHitDieAmt").value).toBe("9");
    expect(document.getElementById("combatEmbeddedHitDieSize").value).toBe("6");
    ["combatEmbeddedCharSpeed", "combatEmbeddedHitDieAmt", "combatEmbeddedHitDieSize"].forEach((id) => {
      const input = document.getElementById(id);
      expect(input.readOnly).toBe(true);
      expect(input.disabled).toBe(true);
      expect(input.dataset.builderOwned).toBe("true");
    });
    expect(builder.speed).toBe(99);
    expect(builder.hitDieAmt).toBe(99);
    expect(builder.hitDieSize).toBe(99);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("uses builder-derived proficiency in embedded Combat Abilities when normal-page charProf is absent", () => {
    document.getElementById("charProf").remove();
    const host = append(document.body, "div", { id: "combatAbilitiesHost" });
    renderAbilitiesEmbeddedContent(host);
    const builder = makeBuilder("char_builder", { str: 15, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.level = 9;
    builder.proficiency = 1;
    builder.abilities.str.saveProf = true;
    builder.skills.athletics = { level: "prof", misc: 0, value: -99 };
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesPanel({
      ...deps,
      root: host,
      selectors: EMBEDDED_PANEL_HOST_SELECTORS.abilities
    });

    expect(document.getElementById("charProf")).toBeNull();
    expect(abilitySaveText(host, "str")).toBe("+6");
    expect(skillValueText(host, "athletics")).toBe("+6");
    expect(builder.proficiency).toBe(1);
    expect(builder.skills.athletics.value).toBe(-99);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("keeps malformed builder proficiency blank and non-mutating without falling back to flat proficiency", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const builder = makeBuilder("char_builder", { str: 15, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.level = Symbol("bad-level");
    builder.proficiency = 6;
    builder.abilities.str.saveProf = true;
    const beforeFlat = structuredClone(builder.abilities);
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const vitalsApi = initVitalsPanel(deps);
    installAbilityBlocks(document);
    const abilitiesApi = initAbilitiesPanel(deps);
    const prof = document.getElementById("charProf");

    expect(prof.value).toBe("");
    expect(prof.readOnly).toBe(true);
    expect(prof.disabled).toBe(true);
    expect(prof.dataset.builderOwned).toBe("true");
    expect(abilitySaveText(document, "str")).toBe("—");

    prof.value = "10";
    dispatchInput(prof);

    expect(prof.value).toBe("");
    expect(builder.proficiency).toBe(6);
    expect(builder.abilities).toEqual(beforeFlat);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    abilitiesApi.destroy();
    vitalsApi.destroy();
    warnSpy.mockRestore();
  });

  it("restores Vitals proficiency ownership and value source when switching between builder and freeform characters", () => {
    const builder = makeBuilder("char_builder", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    builder.build.level = 5;
    builder.proficiency = 1;
    const freeform = makeCharacter("char_free", "Freeform", {
      build: null,
      proficiency: 4
    });
    const state = { characters: { activeId: "char_builder", entries: [builder, freeform] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initVitalsPanel(deps);
    const prof = document.getElementById("charProf");

    expect(prof.value).toBe("3");
    expect(prof.disabled).toBe(true);
    expect(prof.dataset.builderOwned).toBe("true");

    state.characters.activeId = "char_free";
    notifyPanelDataChanged("vitals", { source: {} });

    expect(prof.value).toBe("4");
    expect(prof.disabled).toBe(false);
    expect(prof.readOnly).toBe(false);
    expect(prof.dataset.builderOwned).toBeUndefined();

    prof.value = "5";
    dispatchInput(prof);
    expect(freeform.proficiency).toBe(5);

    state.characters.activeId = "char_builder";
    notifyPanelDataChanged("vitals", { source: {} });

    expect(prof.value).toBe("3");
    expect(prof.disabled).toBe(true);
    expect(prof.dataset.builderOwned).toBe("true");
    expect(builder.proficiency).toBe(1);

    api.destroy();
  });

  it("keeps freeform Abilities scores editable against flat character fields only", () => {
    installAbilityBlocks(document);
    const freeform = makeCharacter("char_free", "Freeform", {
      build: null,
      abilities: makeAbilityRows({ str: 12, dex: 11, con: 10, int: 9, wis: 8, cha: 7 })
    });
    const state = { characters: { activeId: "char_free", entries: [freeform] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesPanel(deps);
    const strScore = abilityScoreInput(document, "str");

    expect(strScore.value).toBe("12");
    expect(abilityModText(document, "str")).toBe("+1");
    expect(strScore.disabled).toBe(false);
    expect(strScore.readOnly).toBe(false);

    strScore.value = "14";
    dispatchInput(strScore);

    expect(freeform.abilities.str.score).toBe(14);
    expect(abilityModText(document, "str")).toBe("+2");
    expect(abilitySaveText(document, "str")).toBe("+2");

    const strAdjustment = abilityAdjustmentInput(document, "str");
    strAdjustment.value = "2";
    dispatchInput(strAdjustment);

    expect(freeform.saveOptions.misc.str).toBe(2);
    expect(abilitySaveText(document, "str")).toBe("+4");
    expect(freeform.build).toBeNull();
    expect(freeform.overrides.abilities.str).toBe(0);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(2);

    api.destroy();
  });

  it("displays builder-derived ability scores and modifiers without materializing flat fields", () => {
    installAbilityBlocks(document);
    const builder = makeBuilder(
      "char_builder",
      { str: 16, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      { str: 3, dex: 4, con: 5, int: 6, wis: 7, cha: 8 }
    );
    const beforeFlat = structuredClone(builder.abilities);
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesPanel(deps);
    const strScore = abilityScoreInput(document, "str");

    expect(strScore.value).toBe("16");
    expect(abilityModText(document, "str")).toBe("+3");
    expect(strScore.disabled).toBe(true);
    expect(strScore.readOnly).toBe(true);
    expect(strScore.getAttribute("aria-readonly")).toBe("true");
    expect(abilityBuilderHint(document).hidden).toBe(false);
    expect(abilityBuilderHint(document).textContent).toContain("Builder Abilities");

    strScore.value = "20";
    dispatchInput(strScore);

    expect(strScore.value).toBe("16");
    expect(builder.abilities).toEqual(beforeFlat);
    expect(builder.build.abilities.base.str).toBe(16);
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();
    expect(readFileSync(resolve(process.cwd(), "js/pages/character/panels/abilitiesPanel.js"), "utf8"))
      .not.toContain("materializeDerivedCharacterFields");

    api.destroy();
  });

  it("routes existing Abilities adjustment controls to builder ability overrides", () => {
    installAbilityBlocks(document);
    installBuilderSummaryPanelDom(document);
    const builder = makeBuilder(
      "char_builder",
      { str: 15, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      { str: 3, dex: 4, con: 5, int: 6, wis: 7, cha: 8 }
    );
    const beforeFlat = structuredClone(builder.abilities);
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const abilitiesApi = initAbilitiesPanel(deps);
    const summaryApi = initBuilderSummaryPanel(deps);
    const strScore = abilityScoreInput(document, "str");
    const strAdjustment = abilityAdjustmentInput(document, "str");

    expect(strScore.value).toBe("15");
    expect(abilityModText(document, "str")).toBe("+2");
    expect(strScore.disabled).toBe(true);
    expect(strAdjustment.value).toBe("0");
    expect(builder.abilities).toEqual(beforeFlat);
    expect(builderSummaryAbilityText(document, "str")).toBe("15 (+2)");

    strAdjustment.value = "3";
    dispatchInput(strAdjustment);

    expect(builder.overrides.abilities.str).toBe(3);
    expect(strScore.value).toBe("18");
    expect(abilityModText(document, "str")).toBe("+4");
    expect(builder.abilities).toEqual(beforeFlat);
    expect(builder.build.abilities.base.str).toBe(15);
    expect(builderSummaryAbilityText(document, "str")).toBe("18 (+4)");

    strAdjustment.value = "0";
    dispatchInput(strAdjustment);

    expect(builder.overrides.abilities.str).toBe(0);
    expect(strScore.value).toBe("15");
    expect(abilityModText(document, "str")).toBe("+2");
    expect(builder.abilities).toEqual(beforeFlat);
    expect(builderSummaryAbilityText(document, "str")).toBe("15 (+2)");

    summaryApi.destroy();
    abilitiesApi.destroy();
  });

  it("allows builder ability adjustment totals above 20 without clamping", () => {
    installAbilityBlocks(document);
    const builder = makeBuilder("char_builder", { str: 15, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesPanel(deps);
    const strAdjustment = abilityAdjustmentInput(document, "str");

    strAdjustment.value = "8";
    dispatchInput(strAdjustment);

    expect(builder.overrides.abilities.str).toBe(8);
    expect(abilityScoreInput(document, "str").value).toBe("23");
    expect(abilityModText(document, "str")).toBe("+6");

    api.destroy();
  });

  it("blocks builder ability adjustments when builder ability base data is malformed", () => {
    installAbilityBlocks(document);
    const builder = makeBuilder("char_builder", { str: 15, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    delete builder.build.abilities.base.str;
    builder.overrides.abilities.str = 4;
    const beforeFlat = structuredClone(builder.abilities);
    const beforeOverrides = structuredClone(builder.overrides);
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesPanel(deps);
    const strScore = abilityScoreInput(document, "str");
    const strAdjustment = abilityAdjustmentInput(document, "str");

    expect(strScore.value).toBe("");
    expect(abilityModText(document, "str")).toBe("—");
    expect(strScore.disabled).toBe(true);
    expect(strScore.readOnly).toBe(true);
    expect(strAdjustment.value).toBe("");
    expect(strAdjustment.disabled).toBe(true);

    strAdjustment.value = "3";
    dispatchInput(strAdjustment);
    strScore.value = "20";
    dispatchInput(strScore);

    expect(builder.overrides).toEqual(beforeOverrides);
    expect(builder.abilities).toEqual(beforeFlat);
    expect(builder.build.abilities.base.str).toBeUndefined();
    expect(deps.SaveManager.markDirty).not.toHaveBeenCalled();

    api.destroy();
  });

  it("shows neutral derived abilities for a new builder character in the normal Abilities panel", () => {
    installAbilityBlocks(document);
    const builder = makeDefaultBuilderCharacterEntry("New Builder Character");
    builder.id = "char_builder";
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesPanel(deps);

    TEST_ABILITY_KEYS.forEach((key) => {
      expect(abilityScoreInput(document, key).value).toBe("10");
      expect(abilityModText(document, key)).toBe("+0");
    });

    api.destroy();
  });

  it("refreshes normal Abilities display when Builder Abilities edits base scores", () => {
    installAbilityBlocks(document);
    installBuilderAbilitiesPanelDom(document);
    const builder = makeBuilder(
      "char_builder",
      { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      { str: 3, dex: 4, con: 5, int: 6, wis: 7, cha: 8 }
    );
    const beforeFlat = structuredClone(builder.abilities);
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const abilitiesApi = initAbilitiesPanel(deps);
    const builderAbilitiesApi = initBuilderAbilitiesPanel(deps);

    expect(abilityScoreInput(document, "str").value).toBe("10");
    expect(abilityModText(document, "str")).toBe("+0");

    const builderStr = document.getElementById("charBuilderAbilityStr");
    builderStr.value = "15";
    builderStr.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));

    expect(builder.build.abilities.base.str).toBe(15);
    expect(abilityScoreInput(document, "str").value).toBe("15");
    expect(abilityModText(document, "str")).toBe("+2");
    expect(builder.abilities).toEqual(beforeFlat);

    builderAbilitiesApi.destroy();
    abilitiesApi.destroy();
  });

  it("refreshes Abilities display when switching between builder and freeform characters", () => {
    installAbilityBlocks(document);
    const builderA = makeBuilder("char_builder_a", { str: 16, dex: 14, con: 13, int: 12, wis: 10, cha: 8 });
    const builderB = makeBuilder("char_builder_b", { str: 8, dex: 10, con: 12, int: 14, wis: 16, cha: 18 });
    const freeform = makeCharacter("char_free", "Freeform", {
      build: null,
      abilities: makeAbilityRows({ str: 12, dex: 11, con: 10, int: 9, wis: 8, cha: 7 })
    });
    const state = {
      characters: { activeId: "char_builder_a", entries: [builderA, builderB, freeform] },
      combat: { workspace: {} }
    };
    const deps = makeDeps(state);
    const api = initAbilitiesPanel(deps);
    const strScore = abilityScoreInput(document, "str");
    const strAdjustment = abilityAdjustmentInput(document, "str");

    expect(strScore.value).toBe("16");
    expect(strScore.disabled).toBe(true);
    expect(strAdjustment.value).toBe("0");

    strAdjustment.value = "2";
    dispatchInput(strAdjustment);
    expect(builderA.overrides.abilities.str).toBe(2);
    expect(strScore.value).toBe("18");

    state.characters.activeId = "char_builder_b";
    notifyActiveCharacterChanged({ previousId: "char_builder_a", activeId: "char_builder_b" });
    expect(strScore.value).toBe("8");
    expect(abilityModText(document, "str")).toBe("-1");
    expect(strScore.disabled).toBe(true);
    expect(strAdjustment.value).toBe("0");
    expect(builderB.overrides.abilities.str).toBe(0);

    state.characters.activeId = "char_free";
    notifyActiveCharacterChanged({ previousId: "char_builder_b", activeId: "char_free" });
    expect(strScore.value).toBe("12");
    expect(strScore.disabled).toBe(false);
    expect(strScore.readOnly).toBe(false);
    expect(strAdjustment.value).toBe("0");

    strScore.value = "13";
    dispatchInput(strScore);
    expect(freeform.abilities.str.score).toBe(13);
    expect(freeform.build).toBeNull();

    state.characters.activeId = "char_builder_a";
    notifyActiveCharacterChanged({ previousId: "char_free", activeId: "char_builder_a" });
    expect(strScore.value).toBe("18");
    expect(strScore.disabled).toBe(true);
    expect(strAdjustment.value).toBe("2");
    expect(freeform.overrides.abilities.str).toBe(0);

    api.destroy();
  });

  it("uses the shared Abilities panel behavior for Combat embedded abilities", () => {
    const host = append(document.body, "div", { id: "combatAbilitiesHost" });
    renderAbilitiesEmbeddedContent(host);
    const builder = makeBuilder("char_builder", { str: 15, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    const state = { characters: { activeId: "char_builder", entries: [builder] }, combat: { workspace: {} } };
    const deps = makeDeps(state);

    const api = initAbilitiesPanel({
      ...deps,
      root: host,
      selectors: EMBEDDED_PANEL_HOST_SELECTORS.abilities
    });
    const strScore = abilityScoreInput(host, "str");
    const strAdjustment = abilityAdjustmentInput(host, "str");

    expect(strScore.value).toBe("15");
    expect(abilityModText(host, "str")).toBe("+2");
    expect(strScore.disabled).toBe(true);
    expect(abilityBuilderHint(host).textContent).toContain("Builder Abilities");
    expect(builder.abilities.str.score).toBeNull();

    strAdjustment.value = "3";
    dispatchInput(strAdjustment);

    expect(builder.overrides.abilities.str).toBe(3);
    expect(strScore.value).toBe("18");
    expect(abilityModText(host, "str")).toBe("+4");
    expect(builder.abilities.str.score).toBeNull();

    api.destroy();
  });

  it("re-initializes with the newly active character's data after a switch", () => {
    const state = makeState("char_a");
    const deps = makeDeps(state);
    const apis = initAllCharacterPanels(deps);

    expect(document.getElementById("charName").value).toBe("Aria");
    expect(document.getElementById("charHpCur").value).toBe("7");

    apis.forEach((api) => api?.destroy?.());
    state.characters.activeId = "char_b";
    const nextApis = initAllCharacterPanels(makeDeps(state));

    expect(document.getElementById("charName").value).toBe("Bryn");
    expect(document.getElementById("charHpCur").value).toBe("21");
    expect(document.querySelector(".spellName").value).toBe("Ray of Frost");
    expect(document.querySelector(".attackName").value).toBe("Longsword");
    expect(document.getElementById("inventoryNotesBox").value).toBe("chalk");
    expect(document.getElementById("charArmorProf").value).toBe("Medium");
    expect(document.getElementById("charTraits").value).toBe("Bold");
    nextApis.forEach((api) => api?.destroy?.());
  });

  it("combat embedded vitals, spells, and weapons initialize after a character switch", () => {
    const state = makeState("char_a");
    const deps = makeDeps(state);
    const host = append(document.body, "div", { id: "combatHost" });
    const vitalsHost = append(host, "div");
    const spellsHost = append(host, "div");
    const weaponsHost = append(host, "div");

    renderVitalsEmbeddedContent(vitalsHost);
    renderSpellsEmbeddedContent(spellsHost);
    renderWeaponsEmbeddedContent(weaponsHost);

    const firstApis = [
      initVitalsPanel({ ...deps, root: vitalsHost, selectors: EMBEDDED_PANEL_HOST_SELECTORS.vitals }),
      initSpellsPanel({ ...deps, root: spellsHost, selectors: EMBEDDED_PANEL_HOST_SELECTORS.spells, noteTextareaIdPrefix: "combat_" }),
      initAttacksPanel({ ...deps, root: weaponsHost, selectors: EMBEDDED_PANEL_HOST_SELECTORS.weapons })
    ].filter(Boolean);

    state.characters.activeId = "char_b";
    firstApis.forEach((api) => api?.destroy?.());
    const secondDeps = makeDeps(state);
    const secondApis = [
      initVitalsPanel({ ...secondDeps, root: vitalsHost, selectors: EMBEDDED_PANEL_HOST_SELECTORS.vitals }),
      initSpellsPanel({ ...secondDeps, root: spellsHost, selectors: EMBEDDED_PANEL_HOST_SELECTORS.spells, noteTextareaIdPrefix: "combat_" }),
      initAttacksPanel({ ...secondDeps, root: weaponsHost, selectors: EMBEDDED_PANEL_HOST_SELECTORS.weapons })
    ].filter(Boolean);

    expect(document.getElementById("combatEmbeddedCharHpCur").value).toBe("21");
    expect(spellsHost.querySelector(".spellName").value).toBe("Ray of Frost");
    expect(weaponsHost.querySelector(".attackName").value).toBe("Longsword");
    secondApis.forEach((api) => api?.destroy?.());
  });

  it("combat embedded panels refresh visible hosted panels when activeId changes", () => {
    const state = makeState("char_a");
    state.combat.workspace.embeddedPanels = ["vitals", "spells", "weapons"];
    const deps = makeDeps(state);
    const root = append(document.body, "div", { id: "combatRoot" });
    append(root, "div", { id: "combatEmbeddedPanels" });

    const api = initCombatEmbeddedPanels({ ...deps, root });

    expect(document.getElementById("combatEmbeddedCharHpCur").value).toBe("7");
    expect(root.querySelector(".spellName").value).toBe("Shield");
    expect(root.querySelector(".attackName").value).toBe("Dagger");

    state.characters.activeId = "char_b";
    notifyActiveCharacterChanged({ previousId: "char_a", activeId: "char_b" });

    expect(document.getElementById("combatEmbeddedCharHpCur").value).toBe("21");
    expect(root.querySelector(".spellName").value).toBe("Ray of Frost");
    expect(root.querySelector(".attackName").value).toBe("Longsword");

    api.destroy();
    state.characters.activeId = "char_a";
    notifyActiveCharacterChanged({ previousId: "char_b", activeId: "char_a" });
    expect(document.getElementById("combatEmbeddedCharHpCur")).toBeNull();
  });

  it("vitals status tile initializes from active character status", () => {
    const state = makeState("char_a");
    state.characters.entries[0].status = "Poisoned";
    const deps = makeDeps(state);
    const api = initVitalsPanel(deps);

    expect(document.getElementById("charStatus").value).toBe("Poisoned");
    api.destroy();
  });

  it("typing in vitals status tile updates character status", () => {
    const state = makeState("char_a");
    const deps = makeDeps(state);
    const api = initVitalsPanel(deps);

    const el = document.getElementById("charStatus");
    el.value = "Stunned";
    dispatchInput(el);

    expect(state.characters.entries[0].status).toBe("Stunned");
    api.destroy();
  });

  it("character-fields notification from external source refreshes vitals status tile", () => {
    const state = makeState("char_a");
    const deps = makeDeps(state);
    const api = initVitalsPanel(deps);

    state.characters.entries[0].status = "Charmed";
    notifyPanelDataChanged("character-fields", { source: {} });

    expect(document.getElementById("charStatus").value).toBe("Charmed");
    api.destroy();
  });

  it("vitals status edit on Character page updates mounted Combat embedded Vitals status", () => {
    const state = makeState("char_a");
    state.characters.entries[0].status = "Charmed";
    state.combat.workspace.embeddedPanels = ["vitals"];
    const deps = makeDeps(state);
    const root = append(document.body, "div", { id: "combatRoot" });
    append(root, "div", { id: "combatEmbeddedPanels" });
    const combatApi = initCombatEmbeddedPanels({ ...deps, root });
    const characterApi = initVitalsPanel(deps);

    const charStatusEl = document.getElementById("charStatus");
    const embeddedStatusEl = document.getElementById("combatEmbeddedCharStatus");
    expect(charStatusEl.value).toBe("Charmed");
    expect(embeddedStatusEl.value).toBe("Charmed");

    charStatusEl.value = "Poisoned";
    dispatchInput(charStatusEl);

    expect(state.characters.entries[0].status).toBe("Poisoned");
    expect(embeddedStatusEl.value).toBe("Poisoned");

    characterApi.destroy();
    combatApi.destroy();
  });

  it("vitals edits on the Character page update mounted Combat embedded Vitals", () => {
    const state = makeState("char_a");
    state.combat.workspace.embeddedPanels = ["vitals"];
    const deps = makeDeps(state);
    const root = append(document.body, "div", { id: "combatRoot" });
    append(root, "div", { id: "combatEmbeddedPanels" });
    const combatApi = initCombatEmbeddedPanels({ ...deps, root });
    const characterApi = initVitalsPanel(deps);

    const characterHp = document.getElementById("charHpCur");
    const embeddedHp = document.getElementById("combatEmbeddedCharHpCur");
    expect(embeddedHp.value).toBe("7");

    characterHp.value = "18";
    dispatchInput(characterHp);

    expect(state.characters.entries[0].hpCur).toBe(18);
    expect(document.getElementById("combatEmbeddedCharHpCur")).toBe(embeddedHp);
    expect(embeddedHp.value).toBe("18");

    characterApi.destroy();
    combatApi.destroy();
  });

  it("weapon edits on the Character page update mounted Combat embedded Weapons", () => {
    const state = makeState("char_a");
    state.combat.workspace.embeddedPanels = ["weapons"];
    const deps = makeDeps(state);
    const root = append(document.body, "div", { id: "combatRoot" });
    append(root, "div", { id: "combatEmbeddedPanels" });
    const combatApi = initCombatEmbeddedPanels({ ...deps, root });
    const characterApi = initAttacksPanel(deps);

    const characterName = document.getElementById("attackList").querySelector(".attackName");
    const characterList = document.getElementById("attackList");
    const embeddedName = root.querySelector("#combatEmbeddedAttackList .attackName");
    expect(embeddedName.value).toBe("Dagger");

    characterName.value = "Rapier";
    dispatchInput(characterName, characterList);

    expect(state.characters.entries[0].attacks[0].name).toBe("Rapier");
    expect(root.querySelector("#combatEmbeddedAttackList .attackName")).not.toBe(embeddedName);
    expect(root.querySelector("#combatEmbeddedAttackList .attackName").value).toBe("Rapier");

    characterApi.destroy();
    combatApi.destroy();
  });

  it("spell edits keep updating mounted Combat embedded Spells", () => {
    const state = makeState("char_a");
    state.combat.workspace.embeddedPanels = ["spells"];
    const deps = makeDeps(state);
    const root = append(document.body, "div", { id: "combatRoot" });
    append(root, "div", { id: "combatEmbeddedPanels" });
    const combatApi = initCombatEmbeddedPanels({ ...deps, root });
    const characterApi = initSpellsPanel(deps);

    const characterSpell = document.getElementById("spellLevels").querySelector(".spellName");
    const embeddedSpell = root.querySelector("#combatEmbeddedSpellLevels .spellName");
    expect(embeddedSpell.value).toBe("Shield");

    characterSpell.value = "Absorb Elements";
    dispatchInput(characterSpell);

    expect(state.characters.entries[0].spells.levels[0].spells[0].name).toBe("Absorb Elements");
    expect(root.querySelector("#combatEmbeddedSpellLevels .spellName")).not.toBe(embeddedSpell);
    expect(root.querySelector("#combatEmbeddedSpellLevels .spellName").value).toBe("Absorb Elements");

    characterApi.destroy();
    combatApi.destroy();
  });

  it("combat embedded panel rerenders clean up panel invalidation listeners", () => {
    const state = makeState("char_a");
    state.combat.workspace.embeddedPanels = ["vitals"];
    const deps = makeDeps(state);
    const root = append(document.body, "div", { id: "combatRoot" });
    append(root, "div", { id: "combatEmbeddedPanels" });
    const combatApi = initCombatEmbeddedPanels({ ...deps, root });
    const characterApi = initVitalsPanel(deps);

    expect(notifyPanelDataChanged("vitals")).toBe(2);

    state.characters.activeId = "char_b";
    notifyActiveCharacterChanged({ previousId: "char_a", activeId: "char_b" });
    expect(notifyPanelDataChanged("vitals")).toBe(2);

    combatApi.destroy();
    expect(notifyPanelDataChanged("vitals")).toBe(1);

    characterApi.destroy();
    expect(notifyPanelDataChanged("vitals")).toBe(0);
  });
});
