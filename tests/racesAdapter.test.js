import { afterEach, describe, expect, it, vi } from "vitest";

import { buildRacesData } from "../scripts/adapters/racesAdapter.js";

const LANGUAGE_OPTIONS = [
  "dwarvish",
  "elvish",
  "giant",
  "gnomish",
  "goblin",
  "halfling",
  "orc",
  "abyssal",
  "celestial",
  "draconic",
  "deep-speech",
  "infernal",
  "primordial",
  "sylvan",
  "undercommon",
];

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeRace(overrides = {}) {
  return {
    index: "dwarf",
    name: "Dwarf",
    speed: 25,
    size: "Medium",
    ability_bonuses: [
      { ability_score: { index: "con" }, bonus: 2 },
    ],
    traits: [
      { index: "darkvision" },
      { index: "dwarven-resilience" },
    ],
    languages: [
      { index: "common" },
      { index: "dwarvish" },
    ],
    subraces: [
      { index: "hill-dwarf" },
    ],
    age: "Dwarves mature at the same rate as humans.",
    alignment: "Most dwarves are lawful.",
    size_description: "Dwarves are Medium.",
    language_desc: "You can speak Common and Dwarvish.",
    ...overrides,
  };
}

function makeLanguageOptions({ choose = 1, optionIds = LANGUAGE_OPTIONS } = {}) {
  return {
    choose,
    type: "languages",
    from: {
      option_set_type: "options_array",
      options: optionIds.map((id) => ({
        option_type: "reference",
        item: { index: id },
      })),
    },
  };
}

function makeSubrace(overrides = {}) {
  return {
    index: "hill-dwarf",
    name: "Hill Dwarf",
    race: { index: "dwarf" },
    ability_bonuses: [
      { ability_score: { index: "wis" }, bonus: 1 },
    ],
    racial_traits: [
      { index: "dwarven-toughness" },
    ],
    desc: "As a hill dwarf, you have keen senses.",
    ...overrides,
  };
}

function stubSrdFetch(fixtures) {
  const responses = new Map(Object.entries(fixtures));
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const key = String(url).replace("https://www.dnd5eapi.co", "");
    if (!responses.has(key)) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return {
      ok: true,
      json: async () => responses.get(key),
    };
  }));
}

async function buildWithRaces(races, subraces = []) {
  stubSrdFetch({
    "/api/2014/races": {
      count: races.length,
      results: races.map((race) => ({ index: race.index })),
    },
    ...Object.fromEntries(races.map((race) => [`/api/2014/races/${race.index}`, race])),
    "/api/2014/subraces": {
      count: subraces.length,
      results: subraces.map((subrace) => ({ index: subrace.index })),
    },
    ...Object.fromEntries(subraces.map((subrace) => [`/api/2014/subraces/${subrace.index}`, subrace])),
  });

  return buildRacesData();
}

function byId(entries, id) {
  return entries.find((entry) => entry.id === id);
}

describe("races adapter choices", () => {
  it("adds a list-backed language choice from Human language options", async () => {
    const entries = await buildWithRaces([
      makeRace({
        index: "human",
        name: "Human",
        speed: 30,
        ability_bonuses: [
          { ability_score: { index: "str" }, bonus: 1 },
          { ability_score: { index: "dex" }, bonus: 1 },
        ],
        traits: [],
        languages: [{ index: "common" }],
        subraces: [],
        language_options: makeLanguageOptions(),
      }),
    ]);

    expect(byId(entries, "human").choices).toEqual([
      {
        id: "human-language",
        kind: "language",
        count: 1,
        from: { type: "list", options: LANGUAGE_OPTIONS },
        source: "race:human",
      },
    ]);
  });

  it("adds a list-backed language choice for any race with language options", async () => {
    const entries = await buildWithRaces([
      makeRace({
        index: "half-elf",
        name: "Half-Elf",
        languages: [{ index: "common" }, { index: "elvish" }],
        subraces: [],
        language_options: makeLanguageOptions({ optionIds: ["dwarvish", "giant", "deep-speech"] }),
      }),
    ]);

    expect(byId(entries, "half-elf").choices).toEqual([
      {
        id: "half-elf-language",
        kind: "language",
        count: 1,
        from: { type: "list", options: ["dwarvish", "giant", "deep-speech"] },
        source: "race:half-elf",
      },
    ]);
  });

  it("adds the hardcoded Dragonborn ancestry choice", async () => {
    const entries = await buildWithRaces([
      makeRace({
        index: "dragonborn",
        name: "Dragonborn",
        ability_bonuses: [
          { ability_score: { index: "str" }, bonus: 2 },
          { ability_score: { index: "cha" }, bonus: 1 },
        ],
        traits: [
          { index: "draconic-ancestry" },
          { index: "breath-weapon" },
          { index: "damage-resistance" },
        ],
        languages: [{ index: "common" }, { index: "draconic" }],
        subraces: [],
      }),
    ]);

    expect(byId(entries, "dragonborn").choices).toEqual([
      {
        id: "dragonborn-ancestry",
        kind: "ancestry",
        count: 1,
        from: { type: "list", source: "draconic-ancestries" },
        source: "race:dragonborn",
      },
    ]);
  });

  it("does not add choices to races without build-time choices", async () => {
    const entries = await buildWithRaces([makeRace()]);

    expect(byId(entries, "dwarf")).not.toHaveProperty("choices");
  });

  it("preserves existing generated race and subrace fields", async () => {
    const entries = await buildWithRaces([makeRace()], [makeSubrace()]);

    expect(byId(entries, "dwarf")).toMatchObject({
      id: "dwarf",
      kind: "race",
      source: "srd-5.1",
      size: "Medium",
      speed: 25,
      abilityScoreIncreases: [{ ability: "con", bonus: 2 }],
      traits: ["darkvision", "dwarven-resilience"],
      languages: ["common", "dwarvish"],
      subraceIds: ["hill-dwarf"],
    });
    expect(byId(entries, "hill-dwarf")).toMatchObject({
      id: "hill-dwarf",
      kind: "subrace",
      parentRace: "dwarf",
      abilityScoreIncreases: [{ ability: "wis", bonus: 1 }],
      traits: ["dwarven-toughness"],
      // Dwarven Toughness is a mechanic (max HP +1 per level), emitted as a
      // structured field so computeMaxHp can consume it without name matching.
      hpPerLevelBonus: 1,
    });
  });

  it("does not emit hpPerLevelBonus for subraces without a per-level HP trait", async () => {
    const entries = await buildWithRaces(
      [makeRace()],
      [makeSubrace({ index: "lightfoot-halfling", racial_traits: [{ index: "naturally-stealthy" }] })]
    );
    expect(byId(entries, "lightfoot-halfling")).not.toHaveProperty("hpPerLevelBonus");
  });
});
