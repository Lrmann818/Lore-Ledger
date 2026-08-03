// @vitest-environment jsdom
// The Character page's Spells header ⋯ overflow menu.
//
// The direct "+ Level" header button was replaced by a ⋯ menu carrying the same
// add-level action plus "Add Spellbook Choices" (the max-level spellbook
// correction). Two things must hold:
//
//   1. The relocated add-level action is byte-identical in behavior — one
//      activation is still exactly one prompt and one added level, with no
//      duplicate listeners after a rerender/reinitialization.
//   2. The Combat workspace's embedded Spells host, which supplies neither
//      `Popovers` nor a `spellbookCorrection` handle and scopes its own ids
//      under its own root, keeps its direct "+ Level" button and never renders
//      or wires the correction action.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSpellsPanel } from "../js/pages/character/panels/spellsPanel.js";

/** The character-page Spells header exactly as index.html renders it. */
function setupCharacterDom() {
  document.body.innerHTML = `
    <section class="panel" id="charSpellsPanel">
      <div class="row between items-center spellsHeader">
        <h2 class="m0">Spells</h2>
        <div class="spellsOptionsDropdown" id="spellsOptionsDropdown">
          <button id="spellsOptionsBtn" type="button" class="moveBtn" aria-haspopup="menu"
            aria-expanded="false" aria-controls="spellsOptionsMenu"
            title="Spell options" aria-label="Spell options">&#8943;</button>
          <div class="spellsOptionsMenu" id="spellsOptionsMenu" role="menu"
            aria-labelledby="spellsOptionsBtn" hidden aria-hidden="true">
            <button type="button" role="menuitem" class="swatchOption spellsOptionsItem" id="addSpellLevelBtn">Add spell level</button>
            <button type="button" role="menuitem" class="swatchOption spellsOptionsItem" id="addSpellbookChoicesBtn">Add Spellbook Choices</button>
          </div>
        </div>
      </div>
      <div id="spellLevels" class="spellLevels"></div>
    </section>
  `;
}

/** The Combat embedded host exactly as combatEmbeddedPanels.js renders it. */
function setupCombatDom() {
  document.body.innerHTML = `
    <div id="combatHost">
      <section class="panel" id="combatEmbeddedSpellsSource">
        <div class="row between items-center">
          <h2 class="m0">Spells</h2>
          <button id="combatEmbeddedAddSpellLevelBtn" type="button" class="headerAddBtn">+ Level</button>
        </div>
        <div id="combatEmbeddedSpellLevels" class="spellLevels"></div>
      </section>
    </div>
  `;
}

function createFakePopovers() {
  const handles = [];
  const setOpen = (reg, open) => {
    reg.menu.hidden = !open;
    reg.menu.setAttribute("aria-hidden", open ? "false" : "true");
    reg.button.setAttribute("aria-expanded", open ? "true" : "false");
  };
  return {
    handles,
    register(args) {
      const reg = { button: args.button, menu: args.menu };
      const handle = {
        reg,
        args,
        open: vi.fn(() => setOpen(reg, true)),
        close: vi.fn(() => setOpen(reg, false)),
        toggle: vi.fn(() => setOpen(reg, reg.menu.hidden)),
        reposition: vi.fn(),
        destroy: vi.fn(() => setOpen(reg, false))
      };
      handles.push(handle);
      if (args.wireButton !== false) {
        args.button.addEventListener("click", (event) => {
          event.preventDefault();
          handle.toggle();
        });
      }
      return handle;
    }
  };
}

function makeState(levels = []) {
  return {
    appShell: { activeCampaignId: "camp1" },
    characters: {
      activeId: "c1",
      entries: [{ id: "c1", name: "Tester", spells: { levels } }]
    }
  };
}

function makeCorrection({ available = true } = {}) {
  const listeners = new Set();
  return {
    isAvailable: vi.fn(() => available),
    open: vi.fn(),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    setAvailable(next) {
      available = next;
      for (const listener of listeners) listener();
    },
    listeners
  };
}

const optionsBtn = () => document.getElementById("spellsOptionsBtn");
const optionsMenu = () => document.getElementById("spellsOptionsMenu");
const addLevelBtn = () => document.getElementById("addSpellLevelBtn");
const spellbookBtn = () => document.getElementById("addSpellbookChoicesBtn");

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Character Spells overflow menu", () => {
  let Popovers;
  let correction;
  let uiPrompt;
  let api;

  beforeEach(() => {
    setupCharacterDom();
    Popovers = createFakePopovers();
    correction = makeCorrection();
    uiPrompt = vi.fn().mockResolvedValue("4th Level");
  });

  function init(state = makeState()) {
    const SaveManager = { markDirty: vi.fn() };
    api = initSpellsPanel({
      state,
      SaveManager,
      Popovers,
      spellbookCorrection: correction,
      uiPrompt
    });
    return { state, SaveManager };
  }

  it("registers the menu with the shared popover system", () => {
    init();
    expect(Popovers.handles).toHaveLength(1);
    const { args } = Popovers.handles[0];
    expect(args.button).toBe(optionsBtn());
    expect(args.menu).toBe(optionsMenu());
    expect(args.closeOnOutside).toBe(true);
    expect(args.closeOnEsc).toBe(true);
    expect(args.wireButton).toBe(true);
    // The trigger starts collapsed and the menu starts hidden.
    expect(optionsBtn().getAttribute("aria-expanded")).toBe("false");
    expect(optionsMenu().hidden).toBe(true);
  });

  it("toggles aria-expanded through the popover system", () => {
    init();
    optionsBtn().click();
    expect(optionsMenu().hidden).toBe(false);
    expect(optionsBtn().getAttribute("aria-expanded")).toBe("true");

    optionsBtn().click();
    expect(optionsMenu().hidden).toBe(true);
    expect(optionsBtn().getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps Add spell level a single action with no duplicate listeners", async () => {
    const { state, SaveManager } = init(makeState());
    optionsBtn().click();
    addLevelBtn().click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(uiPrompt).toHaveBeenCalledTimes(1);
    const levels = state.characters.entries[0].spells.levels;
    expect(levels.filter((level) => level.label === "4th Level")).toHaveLength(1);
    expect(SaveManager.markDirty).toHaveBeenCalledTimes(1);
  });

  it("does not multiply the add-level listener across reinitialization", async () => {
    const state = makeState();
    const { SaveManager } = init(state);
    api.destroy();
    api = initSpellsPanel({
      state, SaveManager, Popovers, spellbookCorrection: correction, uiPrompt
    });

    addLevelBtn().click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(uiPrompt).toHaveBeenCalledTimes(1);
    expect(state.characters.entries[0].spells.levels
      .filter((level) => level.label === "4th Level")).toHaveLength(1);
  });

  it("dismisses the menu when an item is activated", () => {
    init();
    optionsBtn().click();
    expect(optionsMenu().hidden).toBe(false);

    spellbookBtn().click();
    expect(Popovers.handles[0].close).toHaveBeenCalled();
    expect(optionsMenu().hidden).toBe(true);
  });

  it("opens the correction and hands it the trigger for focus restoration", () => {
    init();
    optionsBtn().click();
    spellbookBtn().click();

    expect(correction.open).toHaveBeenCalledTimes(1);
    expect(correction.open.mock.calls[0][0]).toEqual({ returnFocusTo: optionsBtn() });
  });

  it("hides the correction item when the character is not eligible", () => {
    correction = makeCorrection({ available: false });
    init();
    expect(spellbookBtn().hidden).toBe(true);
    expect(spellbookBtn().disabled).toBe(true);
    expect(spellbookBtn().getAttribute("aria-disabled")).toBe("true");

    // Positive control: Add spell level is unaffected by eligibility.
    expect(addLevelBtn().hidden).toBe(false);
    expect(addLevelBtn().disabled).toBe(false);
  });

  it("re-derives the correction item when availability changes", () => {
    correction = makeCorrection({ available: false });
    init();
    expect(spellbookBtn().hidden).toBe(true);

    correction.setAvailable(true);
    expect(spellbookBtn().hidden).toBe(false);
    expect(spellbookBtn().getAttribute("aria-disabled")).toBe("false");
  });

  it("refuses to open a correction that is no longer available", () => {
    init();
    optionsBtn().click();
    correction.isAvailable.mockReturnValue(false);
    spellbookBtn().click();

    expect(correction.open).not.toHaveBeenCalled();
    expect(spellbookBtn().hidden).toBe(true);
  });

  it("moves focus through the menu with the arrow keys and closes on Escape", () => {
    init();
    optionsBtn().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(optionsMenu().hidden).toBe(false);
    expect(document.activeElement).toBe(addLevelBtn());

    optionsMenu().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(spellbookBtn());

    optionsMenu().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(addLevelBtn());

    optionsMenu().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(spellbookBtn());

    optionsMenu().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(optionsMenu().hidden).toBe(true);
    expect(document.activeElement).toBe(optionsBtn());
  });

  it("skips a hidden item during keyboard navigation", () => {
    correction = makeCorrection({ available: false });
    init();
    optionsBtn().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(addLevelBtn());

    // Only one enabled item, so navigation wraps to it rather than the hidden one.
    optionsMenu().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(addLevelBtn());
  });

  it("destroys the popover registration and unsubscribes on teardown", () => {
    init();
    expect(correction.listeners.size).toBe(1);
    api.destroy();
    api = null;

    expect(Popovers.handles[0].destroy).toHaveBeenCalledTimes(1);
    expect(correction.listeners.size).toBe(0);
  });

  it("pins the shipped index.html menu semantics, not just this fixture", () => {
    // The fixture above is a copy; this asserts the real shipped markup, so a
    // regression in index.html cannot hide behind a correct test double.
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const header = html.slice(
      html.indexOf('id="spellsOptionsDropdown"'),
      html.indexOf('id="spellLevels"')
    );
    expect(header).toContain('aria-haspopup="menu"');
    expect(header).toContain('aria-controls="spellsOptionsMenu"');
    expect(header).toContain('aria-label="Spell options"');
    expect(header).toContain('role="menu"');
    expect(header).toContain('aria-labelledby="spellsOptionsBtn"');
    expect(header.match(/role="menuitem"/g)).toHaveLength(2);
    expect(header).toContain('id="addSpellLevelBtn"');
    expect(header).toContain('id="addSpellbookChoicesBtn"');
  });

  it("carries coherent menu semantics and relationships", () => {
    init();
    const trigger = optionsBtn();
    const menu = optionsMenu();

    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
    expect(trigger.getAttribute("aria-label")).toBe("Spell options");
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("aria-labelledby")).toBe(trigger.id);
    for (const item of [addLevelBtn(), spellbookBtn()]) {
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.type).toBe("button");
    }

    // aria-hidden tracks the open state alongside aria-expanded.
    expect(menu.getAttribute("aria-hidden")).toBe("true");
    trigger.click();
    expect(menu.getAttribute("aria-hidden")).toBe("false");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("returns focus to the trigger after Add spell level completes", async () => {
    const { state } = init(makeState());
    optionsBtn().click();
    addLevelBtn().focus();
    addLevelBtn().click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(state.characters.entries[0].spells.levels
      .some((level) => level.label === "4th Level")).toBe(true);
    expect(document.activeElement).toBe(optionsBtn());
  });

  it("returns focus to the trigger when Add spell level is cancelled", async () => {
    uiPrompt = vi.fn().mockResolvedValue(null);
    const { state } = init(makeState());
    const levelsBefore = state.characters.entries[0].spells.levels.length;
    optionsBtn().click();
    addLevelBtn().focus();
    addLevelBtn().click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Nothing was added, and focus still came back.
    expect(state.characters.entries[0].spells.levels).toHaveLength(levelsBefore);
    expect(document.activeElement).toBe(optionsBtn());
  });
});

describe("Character Spells overflow menu — no Popovers fallback", () => {
  let correction;
  let uiPrompt;
  let api;

  beforeEach(() => {
    setupCharacterDom();
    correction = makeCorrection();
    uiPrompt = vi.fn().mockResolvedValue("4th Level");
  });

  afterEach(() => {
    api?.destroy();
    api = null;
  });

  function init(state = makeState()) {
    const SaveManager = { markDirty: vi.fn() };
    // No `Popovers` at all — the panel must still provide a usable menu.
    api = initSpellsPanel({ state, SaveManager, spellbookCorrection: correction, uiPrompt });
    return { state, SaveManager };
  }

  it("toggles the menu and keeps aria state coherent", () => {
    init();
    expect(optionsMenu().hidden).toBe(true);
    optionsBtn().click();
    expect(optionsMenu().hidden).toBe(false);
    expect(optionsBtn().getAttribute("aria-expanded")).toBe("true");
    expect(optionsMenu().getAttribute("aria-hidden")).toBe("false");

    optionsBtn().click();
    expect(optionsMenu().hidden).toBe(true);
    expect(optionsBtn().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape and returns focus to the trigger", () => {
    init();
    optionsBtn().click();
    addLevelBtn().focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(optionsMenu().hidden).toBe(true);
    expect(document.activeElement).toBe(optionsBtn());
  });

  it("closes on an outside click but not on inert space inside the menu", () => {
    init();
    optionsBtn().click();

    // Inert chrome inside the menu (its own padding) leaves it open.
    optionsMenu().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(optionsMenu().hidden).toBe(false);

    // Outside: closes.
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(optionsMenu().hidden).toBe(true);

    // Activating an item also dismisses (menu semantics), which is why the
    // inert-space case above is the meaningful "stays open" control.
    optionsBtn().click();
    expect(optionsMenu().hidden).toBe(false);
    spellbookBtn().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(optionsMenu().hidden).toBe(true);
  });

  it("removes its document listeners on destroy and rebinds exactly once", () => {
    const state = makeState();
    const { SaveManager } = init(state);
    api.destroy();

    // After teardown the stale document listeners must be gone: an Escape or an
    // outside click must not resurrect behavior against a destroyed panel.
    optionsMenu().hidden = false;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(optionsMenu().hidden).toBe(false);

    // Re-init binds one fresh set; one click still equals one toggle.
    api = initSpellsPanel({ state, SaveManager, spellbookCorrection: correction, uiPrompt });
    optionsMenu().hidden = true;
    optionsBtn().click();
    expect(optionsMenu().hidden).toBe(false);
    optionsBtn().click();
    expect(optionsMenu().hidden).toBe(true);
  });

  it("still opens the correction and restores focus after add-level", async () => {
    const { state } = init(makeState());
    optionsBtn().click();
    spellbookBtn().click();
    expect(correction.open).toHaveBeenCalledTimes(1);
    expect(optionsMenu().hidden).toBe(true);

    optionsBtn().click();
    addLevelBtn().focus();
    addLevelBtn().click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(state.characters.entries[0].spells.levels
      .some((level) => level.label === "4th Level")).toBe(true);
    expect(document.activeElement).toBe(optionsBtn());
  });
});

describe("Combat embedded Spells host", () => {
  it("keeps its direct + Level button and exposes no correction action", async () => {
    setupCombatDom();
    const Popovers = createFakePopovers();
    const uiPrompt = vi.fn().mockResolvedValue("4th Level");
    const state = makeState();
    const SaveManager = { markDirty: vi.fn() };
    const root = document.getElementById("combatHost");

    const api = initSpellsPanel({
      state,
      SaveManager,
      root,
      selectors: {
        panelEl: "#combatEmbeddedSpellsSource",
        containerEl: "#combatEmbeddedSpellLevels",
        addLevelBtnEl: "#combatEmbeddedAddSpellLevelBtn"
      },
      uiPrompt
    });

    // No overflow menu is built and no popover is registered for this host.
    expect(Popovers.handles).toHaveLength(0);
    expect(document.getElementById("spellsOptionsBtn")).toBeNull();
    expect(document.getElementById("addSpellbookChoicesBtn")).toBeNull();

    // The direct + Level button still works, unchanged.
    document.getElementById("combatEmbeddedAddSpellLevelBtn").click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(uiPrompt).toHaveBeenCalledTimes(1);
    expect(state.characters.entries[0].spells.levels
      .filter((level) => level.label === "4th Level")).toHaveLength(1);

    api.destroy();
  });

  it("renders a canonical builder-seeded spell row added by the correction", () => {
    setupCombatDom();
    const state = makeState([{
      id: "lvl1",
      label: "1st Level",
      hasSlots: true,
      used: 4,
      total: 4,
      collapsed: false,
      // Exactly the row shape the spells-only correction patch seeds.
      spells: [{
        id: "spell_new",
        name: "Magic Missile",
        notesCollapsed: true,
        known: true,
        prepared: false,
        expended: false,
        builderSpellId: "magic-missile"
      }]
    }]);
    const SaveManager = { markDirty: vi.fn() };
    const root = document.getElementById("combatHost");

    const api = initSpellsPanel({
      state,
      SaveManager,
      root,
      selectors: {
        panelEl: "#combatEmbeddedSpellsSource",
        containerEl: "#combatEmbeddedSpellLevels",
        addLevelBtnEl: "#combatEmbeddedAddSpellLevelBtn"
      }
    });

    const container = document.getElementById("combatEmbeddedSpellLevels");
    const names = Array.from(container.querySelectorAll("input.spellName")).map((el) => el.value);
    expect(names).toContain("Magic Missile");

    api.destroy();
  });
});
