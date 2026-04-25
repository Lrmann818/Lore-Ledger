import { afterEach, describe, expect, it, vi } from "vitest";

import { buildTraitsData } from "../scripts/adapters/traitsAdapter.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const TRAIT_FIXTURES = [
  makeTrait("breath-weapon", {
    name: "Breath Weapon",
    desc: [
      "Your draconic ancestry determines the size, shape, and damage type of the exhalation.",
      "The saving throw type is determined by your draconic ancestry.",
    ],
  }),
  makeTrait("damage-resistance", {
    name: "Damage Resistance",
    desc: ["You have resistance to the damage type associated with your draconic ancestry."],
  }),
  makeTrait("darkvision", {
    name: "Darkvision",
    desc: ["You have superior vision in dark and dim conditions."],
  }),
  makeTrait("draconic-ancestry", {
    name: "Draconic Ancestry",
    desc: ["You have draconic ancestry. Choose one type of dragon."],
  }),
  makeTrait("draconic-ancestry-black", {
    name: "Draconic Ancestry (Black)",
    desc: ["Black dragon ancestry mechanics live in draconic-ancestries.json."],
  }),
];

function makeTrait(id, overrides = {}) {
  return {
    index: id,
    name: titleCase(id),
    desc: [`Description for ${id}.`],
    url: `/api/2014/traits/${id}`,
    ...overrides,
  };
}

function titleCase(value) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stubSrdFetch({ traits = TRAIT_FIXTURES } = {}) {
  const fixtures = {
    "/api/2014/traits": {
      count: traits.length,
      results: traits.map((trait) => ({
        index: trait.index,
        name: trait.name,
        url: trait.url,
      })),
    },
    ...Object.fromEntries(
      traits.map((trait) => [`/api/2014/traits/${trait.index}`, trait])
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

function byId(entries, id) {
  return entries.find((entry) => entry.id === id);
}

describe("traits adapter", () => {
  it("creates stable trait records for referenced traits only", async () => {
    stubSrdFetch();

    const entries = await buildTraitsData({
      referencedTraitIds: ["breath-weapon", "damage-resistance", "darkvision", "draconic-ancestry"],
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      "breath-weapon",
      "damage-resistance",
      "darkvision",
      "draconic-ancestry",
    ]);
    expect(entries.some((entry) => entry.id === "draconic-ancestry-black")).toBe(false);
  });

  it("includes source and provenance fields on generated records", async () => {
    stubSrdFetch();

    const entries = await buildTraitsData({
      referencedTraitIds: ["breath-weapon", "damage-resistance", "darkvision"],
    });

    expect(entries.every((entry) => entry.kind === "trait")).toBe(true);
    expect(entries.every((entry) => entry.source === "srd-5.1")).toBe(true);
    expect(entries.every((entry) => typeof entry.id === "string")).toBe(true);
    expect(entries.every((entry) => typeof entry.name === "string")).toBe(true);
    expect(entries.every((entry) => typeof entry.description === "string")).toBe(true);
  });

  it("joins SRD description paragraphs without anchor-testing exact text", async () => {
    stubSrdFetch();

    const entries = await buildTraitsData({
      referencedTraitIds: ["breath-weapon"],
    });

    expect(byId(entries, "breath-weapon").description).toContain(
      "Your draconic ancestry determines"
    );
    expect(byId(entries, "breath-weapon").description).toContain("\n\n");
  });

  it("adds derivedFrom to Dragonborn traits whose mechanics depend on ancestry", async () => {
    stubSrdFetch();

    const entries = await buildTraitsData({
      referencedTraitIds: ["breath-weapon", "damage-resistance"],
    });

    expect(byId(entries, "breath-weapon")).toMatchObject({
      derivedFrom: "dragonborn-ancestry",
    });
    expect(byId(entries, "damage-resistance")).toMatchObject({
      derivedFrom: "dragonborn-ancestry",
    });
  });

  it("does not add bogus derivedFrom to non-derived traits", async () => {
    stubSrdFetch();

    const entries = await buildTraitsData({
      referencedTraitIds: ["draconic-ancestry", "darkvision"],
    });

    expect(byId(entries, "draconic-ancestry")).not.toHaveProperty("derivedFrom");
    expect(byId(entries, "darkvision")).not.toHaveProperty("derivedFrom");
  });

  it("throws when a referenced trait is missing from the API list", async () => {
    stubSrdFetch();

    await expect(buildTraitsData({
      referencedTraitIds: ["missing-trait"],
    })).rejects.toThrow("Referenced trait IDs missing from SRD API");
  });

  it("throws instead of silently generating malformed required fields", async () => {
    stubSrdFetch({
      traits: [
        makeTrait("breath-weapon", {
          name: "",
        }),
      ],
    });

    await expect(buildTraitsData({
      referencedTraitIds: ["breath-weapon"],
    })).rejects.toThrow("missing name");
  });

  it("throws when required description text is malformed", async () => {
    stubSrdFetch({
      traits: [
        makeTrait("breath-weapon", {
          desc: [],
        }),
      ],
    });

    await expect(buildTraitsData({
      referencedTraitIds: ["breath-weapon"],
    })).rejects.toThrow("missing description");
  });
});
