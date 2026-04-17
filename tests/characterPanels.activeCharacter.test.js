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
    ["Species", "charBuilderSpeciesSelect"],
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
    builder.build.speciesId = "species_elf";
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
    builder.build.speciesId = "species_elf";
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
    const speciesSelect = document.getElementById("charBuilderSpeciesSelect");
    speciesSelect.value = "species_human";
    dispatchChange(speciesSelect);
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
    builder.build.speciesId = "species_elf";
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
    builder.build.speciesId = "species_elf";
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
        speciesId: "species_missing",
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
