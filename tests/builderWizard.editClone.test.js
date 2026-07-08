// Regression coverage for the "Edit in Builder" DataCloneError.
//
// The active character is read via getActiveCharacter(state). In dev / local /
// preview / ?dev=1 sessions the state-mutation guard (js/utils/dev.js) returns
// its values wrapped in a recursive Proxy. The builder wizard seeds edit mode
// by cloning `character.build`; using structuredClone on a proxied build throws
// DataCloneError ("could not be cloned"), which crashed "Edit in Builder".
// clonePlainBuild() must read through the proxy and hand the wizard plain,
// fully-detached, structured-cloneable data.

import { afterEach, describe, expect, it } from "vitest";

import { clonePlainBuild } from "../js/pages/character/builderWizard.js";
import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { getBuilderFinishSheetSeedPatch } from "../js/domain/builderSheetSeeding.js";
import { installStateMutationGuard, withAllowedStateMutation } from "../js/utils/dev.js";

function makeSeededBuilderState() {
  const entry = makeDefaultBuilderCharacterEntry("Clone Target");
  entry.build.raceId = "dragonborn";
  entry.build.backgroundId = "acolyte";
  entry.build.levels = [{ classId: "fighter", hp: null }];
  entry.build.choicesByLevel = { 1: { "class-skill-fighter": ["athletics", "intimidation"] } };
  entry.build.equipment.weaponIds = ["greatsword"];
  entry.build.equipment.startingChoices = { "fighter:0": { optionIndex: "0", label: "Chain mail" } };
  Object.assign(entry, getBuilderFinishSheetSeedPatch(entry));
  return { characters: { activeId: entry.id, entries: [entry] } };
}

describe("builder edit clone (clonePlainBuild)", () => {
  afterEach(() => {
    // Nothing global to restore; the guard proxies a fresh state each test.
  });

  it("detaches a guarded (proxied) build so it clones without a DataCloneError", () => {
    const rawState = makeSeededBuilderState();
    const { state: guarded, enabled } = installStateMutationGuard(rawState, { mode: "warn" });
    expect(enabled).toBe(true);

    const guardedBuild = guarded.characters.entries[0].build;

    // The guard proxy is exactly what breaks structuredClone in the browser.
    // (Node's structuredClone likewise rejects proxied objects/arrays.)
    expect(() => structuredClone(guardedBuild)).toThrow();

    // The wizard's clone helper must succeed and produce a plain, detached copy.
    const cloned = clonePlainBuild(guardedBuild);
    expect(() => structuredClone(cloned)).not.toThrow();

    // The clone is deep-equal to the underlying data but shares no references
    // with live state (editing the wizard draft must never touch the entry).
    expect(cloned).toEqual(rawState.characters.entries[0].build);
    expect(cloned).not.toBe(rawState.characters.entries[0].build);
    expect(cloned.levels).not.toBe(rawState.characters.entries[0].build.levels);
    expect(cloned.choicesByLevel).not.toBe(rawState.characters.entries[0].build.choicesByLevel);
    expect(cloned.equipment.startingChoices).not.toBe(
      rawState.characters.entries[0].build.equipment.startingChoices
    );

    // Mutating the clone leaves the live (guarded) entry untouched.
    cloned.levels.push({ classId: "wizard", hp: null });
    withAllowedStateMutation(() => {}); // no-op; keep guard depth balanced
    expect(rawState.characters.entries[0].build.levels).toHaveLength(1);
  });

  it("contains only plain objects and arrays (no proxy/exotic prototypes)", () => {
    const rawState = makeSeededBuilderState();
    const { state: guarded } = installStateMutationGuard(rawState, { mode: "warn" });
    const cloned = clonePlainBuild(guarded.characters.entries[0].build);

    const nonPlain = [];
    const seen = new Set();
    const walk = (value, path) => {
      if (!value || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
        nonPlain.push({ path, proto: String(proto) });
      }
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
    };
    walk(cloned, "build");
    expect(nonPlain).toEqual([]);
  });

  it("is null-safe for missing or malformed build data", () => {
    expect(clonePlainBuild(undefined)).toBeNull();
    expect(clonePlainBuild(null)).toBeNull();
  });
});
