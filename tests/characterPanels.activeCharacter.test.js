import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import events from "node:events";

import { makeDefaultCharacterEntry } from "../js/domain/characterHelpers.js";
import { initAbilitiesPanel } from "../js/pages/character/panels/abilitiesPanel.js";
import { initAttacksPanel } from "../js/pages/character/panels/attackPanel.js";
import { initBasicsPanel } from "../js/pages/character/panels/basicsPanel.js";
import { initEquipmentPanel } from "../js/pages/character/panels/equipmentPanel.js";
import { initPersonalityPanel } from "../js/pages/character/panels/personalityPanel.js";
import { initProficienciesPanel } from "../js/pages/character/panels/proficienciesPanel.js";
import { initSpellsPanel } from "../js/pages/character/panels/spellsPanel.js";
import { initVitalsPanel } from "../js/pages/character/panels/vitalsPanel.js";
import {
  EMBEDDED_PANEL_HOST_SELECTORS,
  renderSpellsEmbeddedContent,
  renderVitalsEmbeddedContent,
  renderWeaponsEmbeddedContent
} from "../js/pages/combat/combatEmbeddedPanels.js";

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
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { requestAnimationFrame: (cb) => setTimeout(cb, 0) });
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
  append(abilities, "div", { className: "abilityGrid" });
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

    expect(() => initAllCharacterPanels(deps)).not.toThrow();
    expect(document.getElementById("charName").value).toBe("New Hero");
    expect(document.getElementById("charHpCur").value).toBe("9");
  });

  it("re-initializes with the newly active character's data after a switch", () => {
    const state = makeState("char_a");
    const deps = makeDeps(state);
    const apis = initAllCharacterPanels(deps);

    expect(document.getElementById("charName").value).toBe("Aria");
    expect(document.getElementById("charHpCur").value).toBe("7");

    apis.forEach((api) => api?.destroy?.());
    state.characters.activeId = "char_b";
    initAllCharacterPanels(makeDeps(state));

    expect(document.getElementById("charName").value).toBe("Bryn");
    expect(document.getElementById("charHpCur").value).toBe("21");
    expect(document.querySelector(".spellName").value).toBe("Ray of Frost");
    expect(document.querySelector(".attackName").value).toBe("Longsword");
    expect(document.getElementById("inventoryNotesBox").value).toBe("chalk");
    expect(document.getElementById("charArmorProf").value).toBe("Medium");
    expect(document.getElementById("charTraits").value).toBe("Bold");
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

    initVitalsPanel({ ...deps, root: vitalsHost, selectors: EMBEDDED_PANEL_HOST_SELECTORS.vitals });
    initSpellsPanel({ ...deps, root: spellsHost, selectors: EMBEDDED_PANEL_HOST_SELECTORS.spells, noteTextareaIdPrefix: "combat_" });
    initAttacksPanel({ ...deps, root: weaponsHost, selectors: EMBEDDED_PANEL_HOST_SELECTORS.weapons });

    state.characters.activeId = "char_b";
    initVitalsPanel({ ...makeDeps(state), root: vitalsHost, selectors: EMBEDDED_PANEL_HOST_SELECTORS.vitals });
    initSpellsPanel({ ...makeDeps(state), root: spellsHost, selectors: EMBEDDED_PANEL_HOST_SELECTORS.spells, noteTextareaIdPrefix: "combat_" });
    initAttacksPanel({ ...makeDeps(state), root: weaponsHost, selectors: EMBEDDED_PANEL_HOST_SELECTORS.weapons });

    expect(document.getElementById("combatEmbeddedCharHpCur").value).toBe("21");
    expect(spellsHost.querySelector(".spellName").value).toBe("Ray of Frost");
    expect(weaponsHost.querySelector(".attackName").value).toBe("Longsword");
  });
});
