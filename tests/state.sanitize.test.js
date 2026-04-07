import { describe, expect, it, vi } from "vitest";

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

  it("leaves legacy hitDieAmount untouched so migration remains the canonical normalization layer", () => {
    const state = makeState();
    delete state.character.hitDieAmt;
    state.character.hitDieAmount = 7;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sanitized = sanitizeForSave(state, { devAssertLegacyAliases: true });

    expect("hitDieAmt" in sanitized.character).toBe(false);
    expect(sanitized.character.hitDieAmount).toBe(7);
    expect(state.character.hitDieAmount).toBe(7);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("character.hitDieAmount")
    );
  });
});
