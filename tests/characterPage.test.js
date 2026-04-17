import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../js/pages/character/panels/equipmentPanel.js", () => ({
  initEquipmentPanel: () => ({ destroy: () => {} })
}));
vi.mock("../js/pages/character/panels/attackPanel.js", () => ({
  initAttacksPanel: () => ({ destroy: () => {} })
}));
vi.mock("../js/pages/character/characterSectionReorder.js", () => ({
  setupCharacterSectionReorder: () => ({ destroy: () => {} })
}));
vi.mock("../js/pages/character/panels/spellsPanel.js", () => ({
  initSpellsPanel: () => ({ destroy: () => {} })
}));
vi.mock("../js/pages/character/panels/vitalsPanel.js", () => ({
  initVitalsPanel: () => ({ destroy: () => {} })
}));
vi.mock("../js/pages/character/panels/basicsPanel.js", () => ({
  initBasicsPanel: () => ({ destroy: () => {} })
}));
vi.mock("../js/pages/character/panels/proficienciesPanel.js", () => ({
  initProficienciesPanel: () => ({ destroy: () => {} })
}));
vi.mock("../js/pages/character/panels/abilitiesPanel.js", () => ({
  initAbilitiesPanel: () => ({ destroy: () => {} })
}));
vi.mock("../js/pages/character/panels/personalityPanel.js", () => ({
  initPersonalityPanel: () => ({ destroy: () => {} }),
  setupCharacterCollapsibleTextareas: () => ({ destroy: () => {} })
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
    this.selected = false;
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
    ["charActionNewBuilderBtn", "new-builder", "New Builder Character"],
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
    observe() {}
    disconnect() {}
  });

  return { document, selector, actionMenu, actionMenuButton, actionMenuDropdown };
}

function installBuilderSummaryDom(document) {
  const root = document.getElementById("page-character");
  const columns = appendWithId(document, root, "div", "charColumns", "charColumns");
  const col = appendWithId(document, columns, "div", "charCol0", "charCol");
  const basics = appendWithId(document, col, "section", "charBasicsPanel", "panel");
  appendWithId(document, basics, "input", "charName");
  appendWithId(document, basics, "input", "charClassLevel");
  appendWithId(document, basics, "input", "charRace");
  appendWithId(document, basics, "input", "charBackground");

  const summary = appendWithId(document, col, "section", "charBuilderSummaryPanel", "panel builderSummaryPanel");
  summary.hidden = true;
  summary.setAttribute("aria-hidden", "true");
  appendWithId(document, summary, "h2", "charBuilderSummaryTitle").textContent = "Builder Summary";
  appendWithId(document, summary, "div", "charBuilderSummaryContent", "builderSummaryContent");
  return summary;
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
  speciesId = "species_elf",
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
      speciesId,
      backgroundId,
      level,
      abilities: { base: abilities }
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(html).toContain('class="panelBtnSm charActionMenuBtn" id="charActionMenuBtn"');
    expect(html).toContain('class="dropdownMenu charActionDropdownMenu" id="charActionDropdownMenu"');
    expect(html).not.toContain("charActionSelect");
    expect(html).not.toContain(">Character Actions<");

    const menuHtml = html.match(/id="charActionDropdownMenu"[\s\S]*?<\/div>/)?.[0] || "";
    const actions = Array.from(menuHtml.matchAll(/data-char-action="([^"]+)">([^<]+)<\/button>/g))
      .map((match) => ({ action: match[1], label: match[2] }));
    expect(actions).toEqual([
      { action: "new", label: "New Character" },
      { action: "new-builder", label: "New Builder Character" },
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
      calls.push(/** @type {CustomEvent} */ (event).detail);
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
      "New Builder Character",
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

  it("runs New Builder Character from the action overflow menu", async () => {
    const { actionMenuButton } = installCharacterSelectorDom();
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);

    const controller = initCharacterPageUI(deps);
    actionMenuButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    document.getElementById("charActionNewBuilderBtn").dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();

    const entries = deps.state.characters.entries;
    expect(entries).toHaveLength(3);
    expect(entries[2]).toMatchObject({
      name: "New Builder Character",
      build: makeDefaultCharacterBuild()
    });
    expect(isBuilderCharacter(entries[2])).toBe(true);
    expect(deps.state.characters.activeId).toBe(entries[2].id);
    expect(deps.SaveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(document.getElementById("charBuilderModeBadge").hidden).toBe(false);
    expect(document.getElementById("charActionDropdownMenu").hidden).toBe(true);

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
    expect(content.textContent).toContain("SpeciesElf");
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
        ruleset: "srd-5.2.1",
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

  it("leaves existing character fields editable for builder characters", () => {
    const { document } = installCharacterSelectorDom();
    installBuilderSummaryDom(document);
    const Popovers = createFakePopovers();
    const deps = createCharacterPageDeps(Popovers);
    deps.state.characters.entries[0] = makeBuilderCharacter({ id: "char_a" });

    const controller = initCharacterPageUI(deps);

    ["charName", "charClassLevel", "charRace", "charBackground"].forEach((id) => {
      const input = document.getElementById(id);
      expect(input.disabled).toBe(false);
      expect(input.readOnly).toBe(false);
      expect(input.getAttribute("readonly")).toBeNull();
      expect(input.getAttribute("aria-readonly")).toBeNull();
    });

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
        speciesId: null,
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
    expect(document.getElementById("charBuilderSummaryContent").textContent).toContain("SpeciesNot selected");
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
