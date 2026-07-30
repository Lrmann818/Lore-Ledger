// @vitest-environment jsdom
// C2-D granted-spell presentation: a spell row carrying the `builderGranted`
// marker drops the manual/DM `Prepared` toggle and shows a non-interactive
// marker plus a visible explanation that the grant consumes no ordinary
// preparation capacity. Everything else about the row — Known, Cast, name,
// notes, SRD details — is untouched, and render neither repairs the row nor
// marks the campaign dirty.
//
// Marker *presence* and Prepared suppression are decided by `builderGranted`
// alone. Only the marker's wording is level-sensitive, live-derived from
// `builderSpellId` through the active registry (C2-D review correction):
// leveled grants read "Always Prepared", granted cantrips read "Granted
// Cantrip" (a cantrip is never prepared), and an unresolvable record falls back
// to the neutral "Granted Spell". The stored `prepared` boolean never selects
// the wording.

import { afterEach, describe, expect, it, vi } from "vitest";

import { initSpellsPanel } from "../js/pages/character/panels/spellsPanel.js";
import { enhanceNumberSteppers } from "../js/features/numberSteppers.js";
import { getActiveCharacter } from "../js/domain/characterHelpers.js";
import { setActiveCustomContent } from "../js/domain/rules/registry.js";

/** Matches whichever capacity sentence a granted row is entitled to. */
const CAPACITY_EXPLANATION = /do(es)? not use (your )?ordinary prepared spell capacity/i;
const LEVELED_EXPLANATION = /It stays prepared and does not use your ordinary prepared spell capacity\./;
const CANTRIP_EXPLANATION = /Cantrips are not prepared and do not use ordinary prepared spell capacity\./;
const FALLBACK_EXPLANATION = /^Granted by your build\. It does not use ordinary prepared spell capacity\.$/;
const STAYS_PREPARED = /stays prepared/i;

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

function cantripLevel(spells) {
  return {
    id: "lvl0",
    label: "Cantrips",
    hasSlots: false,
    used: null,
    total: null,
    collapsed: false,
    spells
  };
}

/** A Life-Domain-style granted leveled row exactly as Finish seeding writes it. */
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

/**
 * A High-Elf-style granted cantrip row exactly as Finish seeding writes it:
 * `grantType: "known_cantrip"` seeds `prepared: false, builderGranted: true`.
 */
function grantedCantripRow(overrides = {}) {
  return {
    id: "sp_granted_cantrip",
    name: "Fire Bolt",
    notesCollapsed: true,
    known: true,
    prepared: false,
    expended: false,
    builderSpellId: "fire-bolt",
    builderGranted: true,
    ...overrides
  };
}

/** A granted row whose registry record cannot be resolved. */
function unresolvedGrantedRow(overrides = {}) {
  return {
    id: "sp_granted_unresolved",
    name: "Ghost Grant",
    notesCollapsed: true,
    known: true,
    prepared: true,
    expended: false,
    builderSpellId: "not-a-real-spell",
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
  // The active registry is module-level state: reset it so a case that loads
  // custom content cannot leak into the builtin-only cases.
  setActiveCustomContent([]);
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
    expect(row.querySelector(".spellGrantExplain").textContent).toMatch(LEVELED_EXPLANATION);

    // Positive control: the ordinary builder-managed row alongside it gets no
    // marker, so the assertion above cannot pass by rendering it everywhere.
    const ordinary = rowByName("Guiding Bolt");
    expect(ordinary.querySelector(".spellGrantNote")).toBeNull();
    expect(ordinary.textContent).not.toMatch(CAPACITY_EXPLANATION);
  });

  it("marks a granted cantrip Granted Cantrip and never claims it stays prepared", () => {
    setupDom();
    // Seeding writes a granted cantrip at `prepared: false`; the leveled grant
    // beside it is the positive control that the wording really is per-row.
    const state = makeState([
      cantripLevel([grantedCantripRow()]),
      ...firstLevel([grantedRow(), builderRow()])
    ]);
    const { api } = initPanel(state);
    panels.push(api);

    const cantrip = rowByName("Fire Bolt");
    expect(cantrip).toBeTruthy();
    const badge = cantrip.querySelector(".spellGrantBadge");
    expect(badge.textContent).toBe("Granted Cantrip");
    expect(badge.textContent).not.toBe("Always Prepared");

    // The explanation is visible text, not a tooltip, and never says the
    // cantrip "stays prepared" — cantrips are not prepared at all.
    cantrip.querySelectorAll("*").forEach((node) => {
      node.removeAttribute("title");
      node.removeAttribute("aria-label");
    });
    expect(cantrip.querySelector(".spellGrantExplain").textContent).toMatch(CANTRIP_EXPLANATION);
    expect(cantrip.textContent).toMatch(CAPACITY_EXPLANATION);
    expect(cantrip.textContent).not.toMatch(STAYS_PREPARED);
    expect(cantrip.textContent).not.toContain("Always Prepared");

    // Positive control: the leveled grant in the same panel is unchanged.
    const leveled = rowByName("Bless");
    expect(leveled.querySelector(".spellGrantBadge").textContent).toBe("Always Prepared");
    expect(leveled.querySelector(".spellGrantExplain").textContent).toMatch(LEVELED_EXPLANATION);
  });

  it("renders no interactive Prepared control on a granted cantrip row", () => {
    setupDom();
    const state = makeState([cantripLevel([grantedCantripRow()]), ...firstLevel([manualRow()])]);
    const { api } = initPanel(state);
    panels.push(api);

    const cantrip = rowByName("Fire Bolt");
    expect(toggleByLabel(cantrip, "Prepared")).toBeNull();
    expect([...cantrip.querySelectorAll("button")]
      .some((button) => button.getAttribute("aria-label") === "Prepared — manual or DM override"))
      .toBe(false);
    expect(cantrip.querySelector(".spellGrantNote").querySelector("button, input, a, [tabindex]"))
      .toBeNull();

    // Positive control: the manual row in the same panel still has one.
    expect(toggleByLabel(rowByName("My Homebrew Ward"), "Prepared")).toBeTruthy();
  });

  it("keeps Known and Cast usable on a granted cantrip, writing only their own field", () => {
    setupDom();
    const state = makeState([cantripLevel([grantedCantripRow()])]);
    const { api, SaveManager } = initPanel(state);
    panels.push(api);

    const row = rowByName("Fire Bolt");
    const known = toggleByLabel(row, "Known");
    const cast = toggleByLabel(row, "Cast");
    expect(known.disabled).toBe(false);
    expect(cast.disabled).toBe(false);

    known.click();
    expect(known.getAttribute("aria-pressed")).toBe("false");
    expect(storedSpell(state, "sp_granted_cantrip")).toMatchObject({
      known: false, prepared: false, expended: false, builderGranted: true, builderSpellId: "fire-bolt"
    });
    expect(SaveManager.markDirty).toHaveBeenCalledTimes(1);

    cast.click();
    expect(cast.getAttribute("aria-pressed")).toBe("true");
    expect(storedSpell(state, "sp_granted_cantrip")).toMatchObject({
      known: false, prepared: false, expended: true, builderGranted: true
    });
    expect(SaveManager.markDirty).toHaveBeenCalledTimes(2);

    // The cantrip wording survives the in-place toggle refresh.
    expect(rowByName("Fire Bolt").querySelector(".spellGrantBadge").textContent)
      .toBe("Granted Cantrip");
  });

  it("falls back to neutral Granted Spell wording for missing and malformed registry levels", () => {
    setupDom();
    // A custom-content registry whose four spells differ *only* in the runtime
    // type of `level`. A string level must not be parsed: `"0"` may not become
    // a cantrip and `"1"` may not become a leveled grant, because a badge that
    // guesses wrong about a malformed record is worse than one that declines.
    setActiveCustomContent([
      { id: "custom-num-cantrip", kind: "spell", name: "Numeric Zero", level: 0, classIds: ["cleric"] },
      { id: "custom-num-leveled", kind: "spell", name: "Numeric One", level: 1, classIds: ["cleric"] },
      { id: "custom-str-cantrip", kind: "spell", name: "String Zero", level: "0", classIds: ["cleric"] },
      { id: "custom-str-leveled", kind: "spell", name: "String One", level: "1", classIds: ["cleric"] }
    ]);

    const state = makeState(firstLevel([
      unresolvedGrantedRow(),
      // A granted row with no marker id at all — equally unresolvable, and it
      // must not coerce a missing level into "cantrip".
      unresolvedGrantedRow({ id: "sp_granted_nomarker", name: "Markerless Grant", builderSpellId: undefined }),
      unresolvedGrantedRow({ id: "sp_str_cantrip", name: "String Zero", builderSpellId: "custom-str-cantrip" }),
      unresolvedGrantedRow({ id: "sp_str_leveled", name: "String One", builderSpellId: "custom-str-leveled", prepared: false }),
      unresolvedGrantedRow({ id: "sp_num_cantrip", name: "Numeric Zero", builderSpellId: "custom-num-cantrip" }),
      unresolvedGrantedRow({ id: "sp_num_leveled", name: "Numeric One", builderSpellId: "custom-num-leveled" }),
      grantedRow()
    ]));
    const before = JSON.stringify(getActiveCharacter(state).spells);
    const { api, SaveManager } = initPanel(state);
    panels.push(api);

    for (const name of ["Ghost Grant", "Markerless Grant", "String Zero", "String One"]) {
      const row = rowByName(name);
      expect(row, `${name} row missing`).toBeTruthy();
      expect(row.querySelector(".spellGrantBadge").textContent, name).toBe("Granted Spell");
      expect(row.querySelector(".spellGrantExplain").textContent).toMatch(FALLBACK_EXPLANATION);
      expect(row.textContent).not.toMatch(STAYS_PREPARED);
      expect(row.textContent).not.toContain("Always Prepared");
      expect(row.textContent).not.toContain("Granted Cantrip");
      // Suppression is still driven by `builderGranted`, not by resolvability.
      expect(toggleByLabel(row, "Prepared")).toBeNull();
      expect(toggleByLabel(row, "Known")).toBeTruthy();
      expect(toggleByLabel(row, "Cast")).toBeTruthy();
    }

    // Positive controls: numerically-levelled records from the *same* custom
    // registry still resolve, so the rows above cannot read "Granted Spell"
    // merely because custom content failed to load.
    expect(rowByName("Numeric Zero").querySelector(".spellGrantBadge").textContent).toBe("Granted Cantrip");
    expect(rowByName("Numeric One").querySelector(".spellGrantBadge").textContent).toBe("Always Prepared");
    // …and a builtin grant in the same panel still reads leveled.
    expect(rowByName("Bless").querySelector(".spellGrantBadge").textContent).toBe("Always Prepared");

    // Nothing was repaired or persisted on the way through.
    expect(JSON.stringify(getActiveCharacter(state).spells)).toBe(before);
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
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
    const state = makeState([
      cantripLevel([grantedCantripRow()]),
      ...firstLevel([
        grantedRow(),
        grantedRow({ id: "sp_granted_stale", name: "Cure Wounds", builderSpellId: "cure-wounds", prepared: false }),
        unresolvedGrantedRow(),
        manualRow()
      ])
    ]);
    const before = JSON.stringify(getActiveCharacter(state).spells);
    const { api, SaveManager } = initPanel(state);
    panels.push(api);

    // Positive control: every marker variant really did render during this init.
    expect([...document.querySelectorAll(".spellGrantBadge")].map((node) => node.textContent))
      .toEqual(["Granted Cantrip", "Always Prepared", "Always Prepared", "Granted Spell"]);
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

  it("takes the wording from the registry level, never from the stored prepared boolean", () => {
    setupDom();
    // Both rows carry the "wrong" prepared boolean for their kind, so a label
    // derived from `prepared` would swap them.
    const state = makeState([
      cantripLevel([grantedCantripRow({ prepared: true })]),
      ...firstLevel([grantedRow({ prepared: false })])
    ]);
    const before = JSON.stringify(getActiveCharacter(state).spells);
    const { api, SaveManager } = initPanel(state);
    panels.push(api);

    const cantrip = rowByName("Fire Bolt");
    expect(cantrip.querySelector(".spellGrantBadge").textContent).toBe("Granted Cantrip");
    expect(cantrip.querySelector(".spellGrantExplain").textContent).toMatch(CANTRIP_EXPLANATION);
    expect(cantrip.textContent).not.toMatch(STAYS_PREPARED);

    const leveled = rowByName("Bless");
    expect(leveled.querySelector(".spellGrantBadge").textContent).toBe("Always Prepared");
    expect(leveled.querySelector(".spellGrantExplain").textContent).toMatch(LEVELED_EXPLANATION);

    // Neither stored boolean was read for the label, nor rewritten to suit it.
    expect(storedSpell(state, "sp_granted_cantrip").prepared).toBe(true);
    expect(storedSpell(state, "sp_granted").prepared).toBe(false);
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
