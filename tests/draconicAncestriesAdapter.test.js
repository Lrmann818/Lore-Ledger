import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDraconicAncestriesData } from "../scripts/adapters/draconicAncestriesAdapter.js";

const ANCESTRY_FIXTURES = [
  ["black", "Acid", "line", 30, "dex"],
  ["blue", "Lightning", "line", 30, "dex"],
  ["brass", "Fire", "line", 30, "dex"],
  ["bronze", "Lightning", "line", 30, "dex"],
  ["copper", "Acid", "line", 30, "dex"],
  ["gold", "Fire", "cone", 15, "dex"],
  ["green", "Poison", "cone", 15, "con"],
  ["red", "Fire", "cone", 15, "dex"],
  ["silver", "Cold", "cone", 15, "con"],
  ["white", "Cold", "cone", 15, "con"],
];

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeParentTrait(optionIds = ANCESTRY_FIXTURES.map(([id]) => id)) {
  return {
    index: "draconic-ancestry",
    name: "Draconic Ancestry",
    trait_specific: {
      subtrait_options: {
        choose: 1,
        from: {
          option_set_type: "options_array",
          options: optionIds.map((id) => ({
            option_type: "reference",
            item: {
              index: `draconic-ancestry-${id}`,
              name: `Draconic Ancestry (${titleCase(id)})`,
              url: `/api/2014/traits/draconic-ancestry-${id}`,
            },
          })),
        },
      },
    },
  };
}

function makeAncestryTrait(id, damageType, shape, size, saveAbility, overrides = {}) {
  return {
    index: `draconic-ancestry-${id}`,
    name: `Draconic Ancestry (${titleCase(id)})`,
    parent: {
      index: "draconic-ancestry",
      name: "Draconic Ancestry",
      url: "/api/2014/traits/draconic-ancestry",
    },
    trait_specific: {
      damage_type: {
        index: damageType.toLowerCase(),
        name: damageType,
        url: `/api/2014/damage-types/${damageType.toLowerCase()}`,
      },
      breath_weapon: {
        area_of_effect: {
          size,
          type: shape,
        },
        dc: {
          dc_type: {
            index: saveAbility,
            name: saveAbility.toUpperCase(),
            url: `/api/2014/ability-scores/${saveAbility}`,
          },
        },
      },
    },
    ...overrides,
  };
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function stubSrdFetch({ parentTrait = makeParentTrait(), ancestryTraits = makeDefaultAncestryTraits() } = {}) {
  const fixtures = {
    "/api/2014/traits/draconic-ancestry": parentTrait,
    ...Object.fromEntries(
      ancestryTraits.map((trait) => [`/api/2014/traits/${trait.index}`, trait])
    ),
  };
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

function makeDefaultAncestryTraits() {
  return ANCESTRY_FIXTURES.map(([id, damageType, shape, size, saveAbility]) => (
    makeAncestryTrait(id, damageType, shape, size, saveAbility)
  ));
}

function byId(entries, id) {
  return entries.find((entry) => entry.id === id);
}

describe("draconic ancestries adapter", () => {
  it("produces exactly 10 stable ancestry records", async () => {
    stubSrdFetch();

    const entries = await buildDraconicAncestriesData();

    expect(entries).toHaveLength(10);
    expect(entries.map((entry) => entry.id)).toEqual([
      "black",
      "blue",
      "brass",
      "bronze",
      "copper",
      "gold",
      "green",
      "red",
      "silver",
      "white",
    ]);
  });

  it("maps Black to acid, 5-by-30-foot line, and Dexterity save", async () => {
    stubSrdFetch();

    const entries = await buildDraconicAncestriesData();

    expect(byId(entries, "black")).toMatchObject({
      damageType: "acid",
      breathWeapon: { shape: "line", width: 5, length: 30 },
      saveAbility: "dex",
    });
  });

  it("maps Gold to fire, 15-foot cone, and Dexterity save", async () => {
    stubSrdFetch();

    const entries = await buildDraconicAncestriesData();

    expect(byId(entries, "gold")).toMatchObject({
      damageType: "fire",
      breathWeapon: { shape: "cone", size: 15 },
      saveAbility: "dex",
    });
  });

  it("maps Green to poison, 15-foot cone, and Constitution save", async () => {
    stubSrdFetch();

    const entries = await buildDraconicAncestriesData();

    expect(byId(entries, "green")).toMatchObject({
      damageType: "poison",
      breathWeapon: { shape: "cone", size: 15 },
      saveAbility: "con",
    });
  });

  it("maps Silver to cold, 15-foot cone, and Constitution save", async () => {
    stubSrdFetch();

    const entries = await buildDraconicAncestriesData();

    expect(byId(entries, "silver")).toMatchObject({
      damageType: "cold",
      breathWeapon: { shape: "cone", size: 15 },
      saveAbility: "con",
    });
  });

  it("includes source and provenance on every generated record", async () => {
    stubSrdFetch();

    const entries = await buildDraconicAncestriesData();

    expect(entries.every((entry) => entry.kind === "ancestry")).toBe(true);
    expect(entries.every((entry) => entry.source === "srd-5.1")).toBe(true);
    expect(entries.every((entry) => entry.sourceTraitId === "draconic-ancestry")).toBe(true);
  });

  it("throws instead of silently generating malformed mechanics", async () => {
    const ancestryTraits = makeDefaultAncestryTraits();
    ancestryTraits[0] = makeAncestryTrait("black", "Acid", "sphere", 30, "dex");
    stubSrdFetch({ ancestryTraits });

    await expect(buildDraconicAncestriesData()).rejects.toThrow(
      "unsupported breath weapon shape"
    );
  });

  it("throws when the parent trait does not expose exactly 10 options", async () => {
    stubSrdFetch({
      parentTrait: makeParentTrait(["black"]),
      ancestryTraits: [makeAncestryTrait("black", "Acid", "line", 30, "dex")],
    });

    await expect(buildDraconicAncestriesData()).rejects.toThrow(
      "Expected 10 Draconic Ancestry options"
    );
  });
});
