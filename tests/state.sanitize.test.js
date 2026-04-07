import { describe, expect, it } from "vitest";

import { migrateState, sanitizeForSave } from "../js/state.js";

function makeState() {
  return migrateState(undefined);
}

describe("sanitizeForSave", () => {
  it("shallow-copies tracker and character top-level buckets before returning the save payload", () => {
    const state = makeState();
    state.tracker.campaignTitle = "Moonfall";
    state.tracker.npcs = [{ id: "npc_1", name: "Miri" }];
    state.character.name = "Arlen";
    state.character.inventoryItems = [{ title: "Inventory", notes: "50 ft. rope" }];

    const sanitized = sanitizeForSave(state);

    expect(sanitized.tracker).not.toBe(state.tracker);
    expect(sanitized.character).not.toBe(state.character);
    expect(sanitized.tracker).toEqual(state.tracker);
    expect(sanitized.character).toEqual(state.character);

    sanitized.tracker.campaignTitle = "Changed in payload";
    sanitized.character.name = "Changed in payload";

    expect(state.tracker.campaignTitle).toBe("Moonfall");
    expect(state.character.name).toBe("Arlen");
  });
});
