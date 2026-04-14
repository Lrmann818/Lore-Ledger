import { describe, expect, it, vi } from "vitest";

import { migrateState, sanitizeForSave } from "../js/state.js";

function makeState() {
  return migrateState(undefined);
}

/** Returns the first (and only) character entry from a migrated state. */
function activeEntry(state) {
  return state.characters?.entries?.[0] ?? null;
}

describe("sanitizeForSave", () => {
  it("shallow-copies tracker and characters top-level buckets before returning the save payload", () => {
    const state = makeState();

    // Populate a character entry via direct manipulation (simulating Task 7 UI)
    const charEntry = {
      id: "char_test",
      name: "Arlen",
      inventoryItems: [{ title: "Inventory", notes: "50 ft. rope" }]
    };
    state.characters = { activeId: "char_test", entries: [charEntry] };
    state.tracker.campaignTitle = "Moonfall";
    state.tracker.npcs = [{ id: "npc_1", name: "Miri" }];

    const sanitized = sanitizeForSave(state);

    expect(sanitized.tracker).not.toBe(state.tracker);
    expect(sanitized.characters).not.toBe(state.characters);
    expect(sanitized.tracker).toEqual(state.tracker);
    expect(sanitized.characters).toEqual(state.characters);

    sanitized.tracker.campaignTitle = "Changed in payload";
    sanitized.characters.activeId = "changed";

    expect(state.tracker.campaignTitle).toBe("Moonfall");
    expect(state.characters.activeId).toBe("char_test");
  });

  it("leaves legacy hitDieAmount in an entry untouched so migration remains the canonical normalization layer", () => {
    const state = makeState();
    const entry = {
      id: "char_test",
      hitDieAmount: 7
    };
    state.characters = { activeId: "char_test", entries: [entry] };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sanitized = sanitizeForSave(state, { devAssertLegacyAliases: true });

    expect(sanitized.characters.entries[0].hitDieAmount).toBe(7);
    expect(state.characters.entries[0].hitDieAmount).toBe(7);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("hitDieAmount")
    );
  });

  it("preserves the campaign-scoped combat bucket in the save payload", () => {
    const state = makeState();
    state.combat.workspace.panelOrder = ["combatCardsPanel", "combatRoundPanel"];
    state.combat.workspace.embeddedPanels = ["vitals"];
    state.combat.workspace.panelCollapsed = { combatRoundPanel: true };
    state.combat.workspace.copiedSpellNotes = { spell_1: "not workspace data" };
    state.combat.workspace.spells = [{ id: "spell_1", notes: "not workspace data" }];
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
    expect(sanitized.combat.workspace.panelOrder).toEqual(["combatCardsPanel", "combatRoundPanel"]);
    expect(sanitized.combat.workspace.embeddedPanels).toEqual(["vitals"]);
    expect(sanitized.combat.workspace.panelCollapsed).toEqual({ combatRoundPanel: true });
    expect(sanitized.combat.workspace.copiedSpellNotes).toBeUndefined();
    expect(sanitized.combat.workspace.spells).toBeUndefined();
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
      schemaVersion: 4,
      tracker: {},
      characters: { activeId: null, entries: [] },
      map: {},
      combat: {},
      ui: {}
    });

    expect(sanitized.app.preferences.playHubOpenSound).toBe(false);
  });
});
