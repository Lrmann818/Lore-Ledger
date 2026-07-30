// @vitest-environment jsdom
// C2-D granted-spell presentation: a spell row carrying the `builderGranted`
// marker drops the manual/DM `Prepared` toggle and shows a non-interactive
// "Always Prepared" marker plus a visible explanation that the grant consumes
// no ordinary preparation capacity. Everything else about the row — Known,
// Cast, name, notes, SRD details — is untouched, the presentation is decided by
// `builderGranted` alone (never by the stored `prepared` boolean), and render
// neither repairs the row nor marks the campaign dirty.

import { afterEach, describe, expect, it, vi } from "vitest";

import { initSpellsPanel } from "../js/pages/character/panels/spellsPanel.js";
import { enhanceNumberSteppers } from "../js/features/numberSteppers.js";
import { getActiveCharacter } from "../js/domain/characterHelpers.js";

const CAPACITY_EXPLANATION = /does not use your ordinary prepared spell capacity/i;

function makeState(levels) {
  return {
    appShell: { activeCampaignId: "camp1" },
    characters: {
      activeId: "c1",
      entries: [{ id: "c1", name: "Tester", spells: { levels } }]
    }
  };
}

function setupDom() {
  document.body.innerHTML = `
    <section class="panel" id="charSpellsPanel">
      <div id="spellLevels"></div>
      <button id="addSpellLevelBtn" type="button">+ Level</button>
    </section>
  `;
}

function initPanel(state) {
  const SaveManager = { markDirty: vi.fn() };
  const api = initSpellsPanel({ state, SaveManager, enhanceNumberSteppers });
  return { api, SaveManager };
}

function firstLevel(spells) {
  return [{
    id: "lvl1",
    label: "1st Level",
    hasSlots: true,
    used: 2,
    total: 2,
    collapsed: false,
    spells
  }];
}

/** A Life-Domain-style granted row exactly as Finish seeding writes it. */
function grantedRow(overrides = {}) {
  return {
    id: "sp_granted",
    name: "Bless",
    notesCollapsed: true,
    known: true,
    prepared: true,
    expended: false,
    builderSpellId: "bless",
    builderGranted: true,
    ...overrides
  };
}

/** An ordinary builder-managed (marker, no grant) row. */
function builderRow(overrides = {}) {
  return {
    id: "sp_builder",
    name: "Guiding Bolt",
    notesCollapsed: true,
    known: true,
    prepared: true,
    expended: false,
    builderSpellId: "guiding-bolt",
    ...overrides
  };
}

/** A manual/user-authored row: no builder marker at all. */
function manualRow(overrides = {}) {
  return {
    id: "sp_manual",
    name: "My Homebrew Ward",
    notesCollapsed: true,
    known: true,
    prepared: false,
    expended: false,
    ...overrides
  };
}

function rowByName(name) {
  return [...document.querySelectorAll(".spellRow")]
    .find((row) => row.querySelector(".spellName")?.value === name) || null;
}

function toggleByLabel(row, label) {
  return [...row.querySelectorAll(".spellToggle")]
    .find((button) => button.textContent === label) || null;
}

function storedSpell(state, spellId) {
  return getActiveCharacter(state).spells.levels
    .flatMap((level) => level.spells || [])
    .find((spell) => spell.id === spellId) || null;
}

let panels = [];

afterEach(() => {
  panels.forEach((api) => api?.destroy?.());
  panels = [];
  document.body.innerHTML = "";
});

describe("C2-D granted spell presentation", () => {
  it("marks a granted row Always Prepared and explains that it uses no ordinary capacity", () => {
    setupDom();
    const state = makeState(firstLevel([grantedRow(), builderRow()]));
    const { api } = initPanel(state);
    panels.push(api);

    const row = rowByName("Bless");
    expect(row).toBeTruthy();

    const badge = row.querySelector(".spellGrantBadge");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe("Always Prepared");

    // The explanation is rendered text in the row, not a tooltip: it survives
    // stripping every title/aria attribute in the row.
    row.querySelectorAll("*").forEach((node) => {
      node.removeAttribute("title");
      node.removeAttribute("aria-label");
    });
    expect(row.textContent).toMatch(CAPACITY_EXPLANATION);
    expect(row.querySelector(".spellGrantExplain").textContent).toMatch(CAPACITY_EXPLANATION);

    // Positive control: the ordinary builder-managed row alongside it gets no
    // marker, so the assertion above cannot pass by rendering it everywhere.
    const ordinary = rowByName("Guiding Bolt");
    expect(ordinary.querySelector(".spellGrantNote")).toBeNull();
    expect(ordinary.textContent).not.toMatch(CAPACITY_EXPLANATION);
  });

  it("renders the marker and explanation while the row's notes stay collapsed", () => {
    setupDom();
    const state = makeState(firstLevel([grantedRow({ notesCollapsed: true })]));
    const { api } = initPanel(state);
    panels.push(api);

    const row = rowByName("Bless");
    // Notes really are collapsed — nothing is disclosed here.
    expect(row.querySelector(".spellNotes")).toBeNull();
    expect(row.querySelector(".spellGrantBadge").textContent).toBe("Always Prepared");
    expect(row.textContent).toMatch(CAPACITY_EXPLANATION);
  });

  it("renders no interactive Prepared control on a granted row", () => {
    setupDom();
    const state = makeState(firstLevel([grantedRow(), manualRow()]));
    const { api } = initPanel(state);
    panels.push(api);

    const row = rowByName("Bless");
    expect(toggleByLabel(row, "Prepared")).toBeNull();
    expect([...row.querySelectorAll("button")]
      .some((button) => button.getAttribute("aria-label") === "Prepared — manual or DM override"))
      .toBe(false);

    // The marker itself is inert: not a button, not focusable, no handler hook.
    const badge = row.querySelector(".spellGrantBadge");
    expect(badge.tagName).toBe("SPAN");
    expect(badge.hasAttribute("tabindex")).toBe(false);
    expect(row.querySelector(".spellGrantNote").querySelector("button, input, a, [tabindex]"))
      .toBeNull();

    // Positive control: the manual row in the same panel still has one.
    expect(toggleByLabel(rowByName("My Homebrew Ward"), "Prepared")).toBeTruthy();
  });

  it("keeps Known and Cast present and usable on a granted row", () => {
    setupDom();
    const state = makeState(firstLevel([grantedRow()]));
    const { api, SaveManager } = initPanel(state);
    panels.push(api);

    const row = rowByName("Bless");
    const known = toggleByLabel(row, "Known");
    const cast = toggleByLabel(row, "Cast");
    expect(known).toBeTruthy();
    expect(cast).toBeTruthy();
    for (const button of [known, cast]) {
      expect(button.type).toBe("button");
      expect(button.disabled).toBe(false);
      expect(button.hasAttribute("hidden")).toBe(false);
    }
    expect(known.getAttribute("aria-pressed")).toBe("true");
    expect(cast.getAttribute("aria-pressed")).toBe("false");

    known.click();
    expect(known.getAttribute("aria-pressed")).toBe("false");
    expect(storedSpell(state, "sp_granted")).toMatchObject({
      known: false, prepared: true, expended: false, builderGranted: true
    });
    expect(SaveManager.markDirty).toHaveBeenCalledTimes(1);

    cast.click();
    expect(cast.getAttribute("aria-pressed")).toBe("true");
    expect(storedSpell(state, "sp_granted")).toMatchObject({
      known: false, prepared: true, expended: true, builderGranted: true
    });
    expect(SaveManager.markDirty).toHaveBeenCalledTimes(2);

    // The marker survives the in-place toggle refresh.
    expect(rowByName("Bless").querySelector(".spellGrantBadge").textContent)
      .toBe("Always Prepared");
  });

  it("renders the marker without mutating the row or marking the campaign dirty", () => {
    setupDom();
    const state = makeState(firstLevel([
      grantedRow(),
      grantedRow({ id: "sp_granted_stale", name: "Cure Wounds", builderSpellId: "cure-wounds", prepared: false }),
      manualRow()
    ]));
    const before = JSON.stringify(getActiveCharacter(state).spells);
    const { api, SaveManager } = initPanel(state);
    panels.push(api);

    // Positive control: the markers really did render during this init.
    expect(document.querySelectorAll(".spellGrantBadge")).toHaveLength(2);
    expect(JSON.stringify(getActiveCharacter(state).spells)).toBe(before);
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
  });

  it("keeps the manual/DM override toggle on a manual row", () => {
    setupDom();
    const state = makeState(firstLevel([manualRow(), grantedRow()]));
    const { api, SaveManager } = initPanel(state);
    panels.push(api);

    const row = rowByName("My Homebrew Ward");
    const prepared = toggleByLabel(row, "Prepared");
    expect(prepared).toBeTruthy();
    expect(prepared.title).toBe("Manual/DM prepared override");
    expect(prepared.getAttribute("aria-label")).toBe("Prepared — manual or DM override");
    expect(prepared.getAttribute("aria-pressed")).toBe("false");
    expect(row.querySelector(".spellGrantNote")).toBeNull();

    prepared.click();
    expect(prepared.getAttribute("aria-pressed")).toBe("true");
    expect(storedSpell(state, "sp_manual")).toMatchObject({
      prepared: true, known: true, expended: false
    });
    expect(SaveManager.markDirty).toHaveBeenCalledTimes(1);
  });

  it("keeps the Prepared toggle on an ordinary builder-managed row", () => {
    setupDom();
    const state = makeState(firstLevel([builderRow(), grantedRow()]));
    const { api, SaveManager } = initPanel(state);
    panels.push(api);

    const row = rowByName("Guiding Bolt");
    const prepared = toggleByLabel(row, "Prepared");
    expect(prepared).toBeTruthy();
    expect(prepared.title).toBe("Manual/DM prepared override");
    expect(prepared.getAttribute("aria-label")).toBe("Prepared — manual or DM override");
    expect(prepared.getAttribute("aria-pressed")).toBe("true");
    expect(row.querySelector(".spellGrantNote")).toBeNull();

    prepared.click();
    expect(prepared.getAttribute("aria-pressed")).toBe("false");
    expect(storedSpell(state, "sp_builder")).toMatchObject({
      prepared: false, known: true, expended: false, builderSpellId: "guiding-bolt"
    });
    expect(storedSpell(state, "sp_builder").builderGranted).toBeUndefined();
    expect(SaveManager.markDirty).toHaveBeenCalledTimes(1);
  });

  it("drives the presentation from builderGranted, not from the stored prepared boolean", () => {
    setupDom();
    const state = makeState(firstLevel([
      // Granted, but stored prepared: false — a legacy/malformed row.
      grantedRow({ id: "sp_granted_false", name: "Cure Wounds", builderSpellId: "cure-wounds", prepared: false }),
      // Not granted, but stored prepared: true — the mirror-image control.
      builderRow({ prepared: true })
    ]));
    const before = JSON.stringify(getActiveCharacter(state).spells);
    const { api, SaveManager } = initPanel(state);
    panels.push(api);

    const granted = rowByName("Cure Wounds");
    expect(granted.querySelector(".spellGrantBadge").textContent).toBe("Always Prepared");
    expect(granted.textContent).toMatch(CAPACITY_EXPLANATION);
    expect(toggleByLabel(granted, "Prepared")).toBeNull();

    const ordinary = rowByName("Guiding Bolt");
    expect(ordinary.querySelector(".spellGrantNote")).toBeNull();
    expect(toggleByLabel(ordinary, "Prepared").getAttribute("aria-pressed")).toBe("true");

    // The false boolean on the granted row is displayed around, never repaired.
    expect(storedSpell(state, "sp_granted_false").prepared).toBe(false);
    expect(JSON.stringify(getActiveCharacter(state).spells)).toBe(before);
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
  });

  it("leaves the rest of a granted row — name, SRD details, notes — unchanged", () => {
    setupDom();
    const state = makeState(firstLevel([grantedRow({ notesCollapsed: false })]));
    const { api } = initPanel(state);
    panels.push(api);

    const row = rowByName("Bless");
    expect(row.querySelector(".spellName").value).toBe("Bless");
    // B2 detail block still resolves from the registry for this granted row.
    expect(row.querySelector(".spellSrdDetails")).toBeTruthy();
    expect(row.querySelector(".spellSrdHead").textContent).toContain("Enchantment");
    expect(row.querySelector(".spellNotes textarea")).toBeTruthy();
    // Move + delete controls are untouched.
    expect(row.querySelectorAll(".spellMiniBtns button")).toHaveLength(3);
  });
});
