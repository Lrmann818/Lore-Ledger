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

  it("preserves the campaign-scoped combat bucket in the save payload", () => {
    const state = makeState();
    state.combat.workspace.panelOrder = ["combatCardsPanel", "combatRoundPanel"];
    state.combat.workspace.embeddedPanels = ["vitals"];
    state.combat.workspace.panelCollapsed = { combatRoundPanel: true };
    state.combat.encounter = {
      ...state.combat.encounter,
      id: "enc_1",
      round: 3,
      activeParticipantId: "cmb_2",
      elapsedSeconds: 72,
      secondsPerTurn: 12,
      participants: [{ id: "cmb_1" }, { id: "cmb_2" }],
      undoStack: [{ type: "nextTurn" }]
    };

    const sanitized = sanitizeForSave(state);

    expect(sanitized.combat).not.toBe(state.combat);
    expect(sanitized.combat).toEqual(state.combat);
    expect(sanitized.combat.workspace.panelOrder).toEqual(["combatCardsPanel", "combatRoundPanel"]);
    expect(sanitized.combat.workspace.embeddedPanels).toEqual(["vitals"]);
    expect(sanitized.combat.workspace.panelCollapsed).toEqual({ combatRoundPanel: true });
    expect(sanitized.combat.encounter).toMatchObject({
      id: "enc_1",
      round: 3,
      activeParticipantId: "cmb_2",
      elapsedSeconds: 72,
      secondsPerTurn: 12,
      participants: [{ id: "cmb_1" }, { id: "cmb_2" }],
      undoStack: [{ type: "nextTurn" }]
    });
  });

  it("includes sanitized app-level preferences without mutating live state", () => {
    const state = makeState();
    state.app.preferences.playHubOpenSound = true;

    const sanitized = sanitizeForSave(state);

    expect(sanitized.app).not.toBe(state.app);
    expect(sanitized.app.preferences).toEqual({
      playHubOpenSound: true
    });

    sanitized.app.preferences.playHubOpenSound = false;
    expect(state.app.preferences.playHubOpenSound).toBe(true);
  });

  it("defaults missing app-level preferences to false in the save payload", () => {
    const sanitized = sanitizeForSave({
      schemaVersion: 3,
      tracker: {},
      character: {},
      map: {},
      combat: {},
      ui: {}
    });

    expect(sanitized.app.preferences.playHubOpenSound).toBe(false);
  });
});
