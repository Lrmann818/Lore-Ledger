import { describe, expect, it } from "vitest";

import {
  getActiveCharacter,
  getCharacterById,
  isBuilderCharacter,
  makeDefaultBuilderCharacterEntry,
  makeDefaultCharacterBuild,
  makeDefaultCharacterEntry,
  makeDefaultCharacterOverrides,
  normalizeCharacterOverrides
} from "../js/domain/characterHelpers.js";

function makeState(overrides = {}) {
  return {
    characters: { activeId: null, entries: [], ...overrides }
  };
}

describe("getActiveCharacter", () => {
  it("returns null when state is null", () => {
    expect(getActiveCharacter(null)).toBeNull();
  });

  it("returns null when state is undefined", () => {
    expect(getActiveCharacter(undefined)).toBeNull();
  });

  it("returns null when characters is missing", () => {
    expect(getActiveCharacter({})).toBeNull();
  });

  it("returns null when entries is not an array", () => {
    expect(getActiveCharacter({ characters: { activeId: "x", entries: null } })).toBeNull();
  });

  it("returns null when activeId is null", () => {
    const state = makeState({ activeId: null, entries: [{ id: "char_a", name: "Mira" }] });
    expect(getActiveCharacter(state)).toBeNull();
  });

  it("returns null when entries is empty", () => {
    const state = makeState({ activeId: "char_a", entries: [] });
    expect(getActiveCharacter(state)).toBeNull();
  });

  it("returns null when activeId does not match any entry", () => {
    const state = makeState({ activeId: "char_x", entries: [{ id: "char_a", name: "Mira" }] });
    expect(getActiveCharacter(state)).toBeNull();
  });

  it("returns the active entry when activeId matches", () => {
    const entry = { id: "char_a", name: "Mira" };
    const state = makeState({ activeId: "char_a", entries: [entry] });
    expect(getActiveCharacter(state)).toBe(entry);
  });

  it("returns the correct entry when multiple entries exist", () => {
    const a = { id: "char_a", name: "Mira" };
    const b = { id: "char_b", name: "Arlen" };
    const state = makeState({ activeId: "char_b", entries: [a, b] });
    expect(getActiveCharacter(state)).toBe(b);
  });
});

describe("makeDefaultCharacterEntry", () => {
  it("seeds the Step 2 status field", () => {
    expect(makeDefaultCharacterEntry("Mira")).toMatchObject({
      name: "Mira",
      status: ""
    });
  });

  it("seeds the Step 3 foundation fields without enabling builder mode", () => {
    expect(makeDefaultCharacterEntry("Mira")).toMatchObject({
      name: "Mira",
      build: null,
      overrides: makeDefaultCharacterOverrides()
    });
  });
});

describe("makeDefaultCharacterBuild", () => {
  it("returns the minimal Step 3 builder metadata shape", () => {
    expect(makeDefaultCharacterBuild()).toEqual({
      version: 1,
      ruleset: "srd-5.1",
      raceId: null,
      classId: null,
      subclassId: null,
      backgroundId: null,
      level: 1,
      abilityMethod: "manual",
      abilities: {
        base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
      },
      choicesByLevel: {}
    });
  });

  it("returns fresh nested objects", () => {
    const first = makeDefaultCharacterBuild();
    const second = makeDefaultCharacterBuild();

    first.abilities.base.str = 12;
    first.choicesByLevel["1"] = { test: true };

    expect(first).not.toBe(second);
    expect(first.abilities).not.toBe(second.abilities);
    expect(first.abilities.base).not.toBe(second.abilities.base);
    expect(first.choicesByLevel).not.toBe(second.choicesByLevel);
    expect(second.abilities.base.str).toBe(10);
    expect(second.choicesByLevel).toEqual({});
  });
});

describe("makeDefaultBuilderCharacterEntry", () => {
  it("uses the default character entry shape with builder metadata enabled", () => {
    const entry = makeDefaultBuilderCharacterEntry("Builder Mira");

    expect(entry).toMatchObject({
      name: "Builder Mira",
      classLevel: "",
      race: "",
      background: "",
      overrides: makeDefaultCharacterOverrides(),
      build: makeDefaultCharacterBuild()
    });
    expect(isBuilderCharacter(entry)).toBe(true);
  });
});

describe("makeDefaultCharacterOverrides", () => {
  it("returns the first-slice override shape", () => {
    expect(makeDefaultCharacterOverrides()).toEqual({
      abilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      saves: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      skills: {},
      initiative: 0
    });
  });

  it("returns fresh nested objects", () => {
    const first = makeDefaultCharacterOverrides();
    const second = makeDefaultCharacterOverrides();

    first.abilities.str = 9;
    first.skills.stealth = 4;

    expect(first).not.toBe(second);
    expect(first.abilities).not.toBe(second.abilities);
    expect(first.saves).not.toBe(second.saves);
    expect(first.skills).not.toBe(second.skills);
    expect(second.abilities.str).toBe(0);
    expect(second.skills).toEqual({});
  });
});

describe("normalizeCharacterOverrides", () => {
  it("normalizes malformed and partial override data through one shared helper", () => {
    expect(normalizeCharacterOverrides({
      abilities: { str: "2", dex: "bad", cha: -1 },
      saves: { con: 1 },
      skills: { athletics: "3", "": 9, " stealth ": 2, perception: Number.NaN },
      initiative: "4"
    })).toEqual({
      abilities: { str: 2, dex: 0, con: 0, int: 0, wis: 0, cha: -1 },
      saves: { str: 0, dex: 0, con: 1, int: 0, wis: 0, cha: 0 },
      skills: { athletics: 3, stealth: 2 },
      initiative: 4
    });
  });

  it("falls back to the default override shape for malformed input", () => {
    expect(normalizeCharacterOverrides("bad")).toEqual(makeDefaultCharacterOverrides());
    expect(normalizeCharacterOverrides(null)).toEqual(makeDefaultCharacterOverrides());
  });
});

describe("isBuilderCharacter", () => {
  it("returns true only when build has a meaningful Step 3 builder shape", () => {
    expect(isBuilderCharacter(null)).toBe(false);
    expect(isBuilderCharacter({})).toBe(false);
    expect(isBuilderCharacter({ build: null })).toBe(false);
    expect(isBuilderCharacter({ build: [] })).toBe(false);
    expect(isBuilderCharacter({ build: "fighter" })).toBe(false);
    expect(isBuilderCharacter({ build: {} })).toBe(false);
    expect(isBuilderCharacter({ build: { arbitrary: true } })).toBe(false);
    expect(isBuilderCharacter({ build: { classId: null, raceId: null } })).toBe(false);
    expect(isBuilderCharacter({ build: { classId: "class_fighter" } })).toBe(true);
    expect(isBuilderCharacter({ build: { version: 1, ruleset: "srd-5.2.1" } })).toBe(true);
    expect(isBuilderCharacter({ build: { abilities: { base: { str: 15 } } } })).toBe(true);
  });
});

describe("getCharacterById", () => {
  it("returns null when state is null", () => {
    expect(getCharacterById(null, "char_a")).toBeNull();
  });

  it("returns null when state is undefined", () => {
    expect(getCharacterById(undefined, "char_a")).toBeNull();
  });

  it("returns null when id is null", () => {
    const state = makeState({ entries: [{ id: "char_a" }] });
    expect(getCharacterById(state, null)).toBeNull();
  });

  it("returns null when id is undefined", () => {
    const state = makeState({ entries: [{ id: "char_a" }] });
    expect(getCharacterById(state, undefined)).toBeNull();
  });

  it("returns null when id is not a string", () => {
    const state = makeState({ entries: [{ id: "char_a" }] });
    expect(getCharacterById(state, 42)).toBeNull();
  });

  it("returns null when characters is missing", () => {
    expect(getCharacterById({}, "char_a")).toBeNull();
  });

  it("returns null when entries is not an array", () => {
    expect(getCharacterById({ characters: { activeId: null, entries: null } }, "char_a")).toBeNull();
  });

  it("returns null when the id is not found", () => {
    const state = makeState({ entries: [{ id: "char_a", name: "Mira" }] });
    expect(getCharacterById(state, "char_missing")).toBeNull();
  });

  it("returns the entry when found by id", () => {
    const entry = { id: "char_a", name: "Mira" };
    const state = makeState({ entries: [entry] });
    expect(getCharacterById(state, "char_a")).toBe(entry);
  });

  it("returns the correct entry from multiple entries", () => {
    const a = { id: "char_a", name: "Mira" };
    const b = { id: "char_b", name: "Arlen" };
    const state = makeState({ entries: [a, b] });
    expect(getCharacterById(state, "char_b")).toBe(b);
  });

  it("works regardless of whether the entry is active", () => {
    const a = { id: "char_a", name: "Mira" };
    const b = { id: "char_b", name: "Arlen" };
    const state = makeState({ activeId: "char_a", entries: [a, b] });
    // char_b is NOT active but should still be findable
    expect(getCharacterById(state, "char_b")).toBe(b);
  });
});
