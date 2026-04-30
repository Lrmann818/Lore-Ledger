import { describe, expect, it } from "vitest";

import { getBuilderFinishSheetSeedPatch } from "../js/domain/builderSheetSeeding.js";
import { makeDefaultBuilderCharacterEntry, makeDefaultCharacterEntry } from "../js/domain/characterHelpers.js";

function makeDragonbornBuilder({ ancestryId = "red", features = "", languages = "" } = {}) {
  const character = makeDefaultBuilderCharacterEntry("Dragon Mira");
  character.build.raceId = "dragonborn";
  character.build.classId = "class_fighter";
  character.build.backgroundId = "background_soldier";
  character.build.choicesByLevel = {
    "1": {
      "dragonborn-ancestry": ancestryId
    }
  };
  character.features = features;
  character.languages = languages;
  return character;
}

describe("builder finish sheet seeding", () => {
  it("seeds Dragonborn passive trait text and fixed languages", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeDragonbornBuilder({ ancestryId: "red" }));

    expect(patch.features).toBe([
      "Dragonborn Traits",
      "Draconic Ancestry: Red",
      "Damage Resistance: You have resistance to fire damage."
    ].join("\n"));
    expect(patch.languages).toBe("Common\nDraconic");
  });

  it("uses the selected ancestry damage type from derivation", () => {
    const bluePatch = getBuilderFinishSheetSeedPatch(makeDragonbornBuilder({ ancestryId: "blue" }));
    const whitePatch = getBuilderFinishSheetSeedPatch(makeDragonbornBuilder({ ancestryId: "white" }));

    expect(bluePatch.features).toContain("Damage Resistance: You have resistance to lightning damage.");
    expect(whitePatch.features).toContain("Damage Resistance: You have resistance to cold damage.");
  });

  it("preserves existing text and appends only missing feature lines", () => {
    const existing = "Custom note  \nDraconic Ancestry: Ruby\nDamage Resistance: House rule";
    const patch = getBuilderFinishSheetSeedPatch(makeDragonbornBuilder({ features: existing }));

    expect(patch.features).toBe(`${existing}\nDragonborn Traits`);
    expect(patch.features.match(/Draconic Ancestry:/g)).toHaveLength(1);
    expect(patch.features.match(/Damage Resistance:/g)).toHaveLength(1);
  });

  it("does not duplicate existing languages across case or separators", () => {
    const patch = getBuilderFinishSheetSeedPatch(makeDragonbornBuilder({
      languages: "common, Elvish; DRACONIC\nDwarvish"
    }));

    expect(patch.languages).toBeUndefined();
  });

  it("does not seed non-Dragonborn or freeform characters", () => {
    const builder = makeDefaultBuilderCharacterEntry("Human Mira");
    builder.build.raceId = "race_human";

    expect(getBuilderFinishSheetSeedPatch(builder)).toEqual({});
    expect(getBuilderFinishSheetSeedPatch(makeDefaultCharacterEntry("Freeform Mira"))).toEqual({});
  });
});
