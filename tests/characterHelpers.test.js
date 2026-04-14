import { describe, expect, it } from "vitest";

import { getActiveCharacter, getCharacterById } from "../js/domain/characterHelpers.js";

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
