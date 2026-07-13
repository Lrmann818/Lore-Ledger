// @vitest-environment jsdom
// B3 feature detail seeding: builder characters get display-only
// rules-reference cards in Abilities & Features — class/subclass features
// (chosen subfeatures replace their parents), chosen feats, and race traits,
// each with its full SRD description. Reference cards are live-derived at
// render time, start collapsed, and never write state.

import { afterEach, describe, expect, it, vi } from "vitest";

import { initAbilitiesFeaturesPanel } from "../js/pages/character/panels/abilitiesFeaturesPanel.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

function setupDom() {
  document.body.innerHTML = `
    <section class="panel" id="charAbilitiesFeaturesPanel">
      <div id="charAbilitiesFeaturesList"></div>
      <div id="charAbilitiesFeaturesEmpty">No features yet.</div>
      <button id="addFeatureCardBtn" type="button">+ Feature</button>
    </section>
  `;
}

function makeFighter({
  levels = 3,
  raceId = "dwarf",
  subclass = "champion",
  choicesByLevel = {}
} = {}) {
  const character = makeDefaultBuilderCharacterEntry("Reference Mira");
  character.id = "char_ref";
  character.build.raceId = raceId;
  character.build.backgroundId = "acolyte";
  character.build.levels = Array.from({ length: levels }, () => ({ classId: "fighter", hp: null }));
  character.build.subclassByClass = subclass ? { fighter: subclass } : {};
  character.build.choicesByLevel = choicesByLevel;
  character.build.abilities.base = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
  return character;
}

function makeState(character) {
  return {
    appShell: { activeCampaignId: "camp1" },
    characters: { activeId: character.id, entries: [character] }
  };
}

function initPanel(state) {
  const SaveManager = { markDirty: vi.fn() };
  const api = initAbilitiesFeaturesPanel({ state, SaveManager });
  return { api, SaveManager };
}

function referenceCards() {
  return Array.from(document.querySelectorAll('[data-feature-kind="reference"]'));
}

function cardById(id) {
  return document.querySelector(`[data-feature-id="${id}"]`);
}

let panels = [];

afterEach(() => {
  panels.forEach((api) => api?.destroy?.());
  panels = [];
  document.body.innerHTML = "";
});

describe("rules-reference feature cards", () => {
  it("renders class/subclass features and race traits with full descriptions", () => {
    setupDom();
    const state = makeState(makeFighter());
    const { api, SaveManager } = initPanel(state);
    panels.push(api);

    const cards = referenceCards();
    expect(cards.length).toBeGreaterThan(3);

    const secondWind = cardById("ref:feature:second-wind");
    expect(secondWind).toBeTruthy();
    expect(secondWind.querySelector(".featureActionTitle").textContent).toBe("Second Wind");
    expect(secondWind.querySelector(".featureActionSource").textContent).toBe("Fighter 1");
    expect(secondWind.querySelector(".featureReferenceDescription").textContent)
      .toContain("regain hit points equal to 1d10");

    // Champion's Improved Critical arrives with the subclass at fighter 3.
    const improvedCritical = cardById("ref:feature:improved-critical");
    expect(improvedCritical).toBeTruthy();
    expect(improvedCritical.querySelector(".featureActionSource").textContent).toBe("Fighter 3");

    // Dwarf race trait with its registry description.
    const darkvision = cardById("ref:trait:darkvision");
    expect(darkvision).toBeTruthy();
    expect(darkvision.querySelector(".featureActionSource").textContent).toBe("Dwarf");
    expect(darkvision.querySelector(".featureReferenceDescription").textContent.length).toBeGreaterThan(20);

    expect(SaveManager.markDirty).not.toHaveBeenCalled();
  });

  it("shows the chosen subfeature instead of its parent choice feature", () => {
    setupDom();
    const state = makeState(makeFighter({
      choicesByLevel: { "1": { "feature-fighter-fighting-style": "fighter-fighting-style-archery" } }
    }));
    const { api } = initPanel(state);
    panels.push(api);

    expect(cardById("ref:feature:fighter-fighting-style-archery")).toBeTruthy();
    expect(cardById("ref:feature:fighter-fighting-style")).toBeNull();
  });

  it("includes chosen feats with their descriptions", () => {
    setupDom();
    const state = makeState(makeFighter({
      levels: 4,
      choicesByLevel: { "4": { "asi-4": { type: "feat", featId: "grappler" } } }
    }));
    const { api } = initPanel(state);
    panels.push(api);

    const grappler = cardById("ref:feat:grappler");
    expect(grappler).toBeTruthy();
    expect(grappler.querySelector(".featureActionSource").textContent).toBe("Feat");
    expect(grappler.querySelector(".featureReferenceDescription").textContent).toContain("grapple");
  });

  it("renders no reference cards for freeform characters", () => {
    setupDom();
    const state = makeState({ id: "char_ref", name: "Manual", build: null, manualFeatureCards: [] });
    const { api } = initPanel(state);
    panels.push(api);

    expect(referenceCards()).toHaveLength(0);
  });

  it("starts collapsed and expands via the header without writing state", () => {
    setupDom();
    const character = makeFighter();
    const state = makeState(character);
    const before = JSON.stringify(character);
    const { api, SaveManager } = initPanel(state);
    panels.push(api);

    const card = cardById("ref:feature:second-wind");
    expect(card.dataset.featureCollapsed).toBe("true");

    card.querySelector("[data-feature-collapse-header]").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    expect(card.dataset.featureCollapsed).toBe("false");
    expect(JSON.stringify(state.characters.entries[0])).toBe(before);
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
  });

  it("reference cards carry no edit, move, or use controls", () => {
    setupDom();
    const state = makeState(makeFighter());
    const { api } = initPanel(state);
    panels.push(api);

    for (const card of referenceCards()) {
      expect(card.querySelectorAll("button")).toHaveLength(0);
    }
  });

  it("exposes raceTraits on deriveCharacter, excluding choice-derived traits", () => {
    const dragonborn = makeFighter({ raceId: "dragonborn", subclass: null });
    dragonborn.build.choicesByLevel = { "1": { "dragonborn-ancestry": "red" } };
    const derived = deriveCharacter(dragonborn, BUILTIN_CONTENT_REGISTRY);
    const ids = derived.raceTraits.map((trait) => trait.id);
    // Breath Weapon / Damage Resistance derive from the ancestry choice and
    // stay live-derived through the feature-action card, not listed as traits.
    expect(ids).not.toContain("breath-weapon");
    expect(ids).not.toContain("damage-resistance");
    expect(derived.raceTraits.every((trait) => trait.source === "Dragonborn")).toBe(true);

    const freeform = deriveCharacter({ id: "x", name: "F", build: null }, BUILTIN_CONTENT_REGISTRY);
    expect(freeform.raceTraits).toEqual([]);
  });
});
