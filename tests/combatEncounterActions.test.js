import { describe, expect, it } from "vitest";

import {
  addCombatParticipantStatusEffect,
  advanceCombatTurn,
  applyCombatParticipantHpAction,
  clearCombat,
  moveCombatParticipant,
  removeCombatParticipantStatusEffect,
  removeCombatParticipant,
  setCombatParticipantRole,
  updateCombatParticipantStatusEffect,
  undoCombatTurn
} from "../js/domain/combatEncounterActions.js";
import {
  createDefaultCombatEncounter,
  makeStatusEffect
} from "../js/domain/combat.js";

function makeState() {
  const npc = {
    id: "npc_1",
    name: "Bandit",
    sectionId: "sec_enemy",
    group: "foe",
    hpCurrent: 10,
    hpMax: 12,
    tempHp: 3,
    status: "Poisoned",
    notes: "canonical notes stay put"
  };
  return {
    tracker: {
      npcs: [npc],
      party: [],
      locationsList: []
    },
    combat: {
      workspace: {
        panelOrder: ["combatRoundPanel", "combatCardsPanel"],
        embeddedPanels: [],
        panelCollapsed: { combatRoundPanel: true }
      },
      encounter: createDefaultCombatEncounter({
        id: "enc_1",
        createdAt: "2026-04-11T12:00:00.000Z",
        round: 1,
        activeParticipantId: "cmb_1",
        elapsedSeconds: 0,
        secondsPerTurn: 6,
        participants: [
          {
            id: "cmb_1",
            name: "Bandit",
            role: "enemy",
            source: { type: "npc", id: "npc_1", sectionId: "sec_enemy", group: "foe" },
            hpCurrent: 10,
            hpMax: 12,
            tempHp: 3,
            statusEffects: [
              makeStatusEffect({ id: "s_time", label: "Haste", durationMode: "time", remaining: 12 })
            ]
          },
          {
            id: "cmb_2",
            name: "Bandit",
            role: "enemy",
            source: { type: "npc", id: "npc_1", sectionId: "sec_enemy", group: "foe" },
            hpCurrent: 10,
            hpMax: 12,
            tempHp: 3,
            statusEffects: []
          }
        ],
        undoStack: []
      })
    }
  };
}

describe("combat encounter actions", () => {
  it("applies combat HP actions to one encounter participant and writes only allowed canonical HP fields", () => {
    const state = makeState();

    const result = applyCombatParticipantHpAction(state, "cmb_1", "damage", 5, {
      now: "2026-04-11T12:01:00.000Z"
    });

    expect(result.changed).toBe(true);
    expect(result.wroteCanonical).toBe(true);
    expect(state.combat.encounter.participants[0]).toMatchObject({
      hpCurrent: 8,
      hpMax: 12,
      tempHp: 0
    });
    expect(state.combat.encounter.participants[1]).toMatchObject({
      hpCurrent: 10,
      tempHp: 3
    });
    expect(state.tracker.npcs[0]).toMatchObject({
      name: "Bandit",
      sectionId: "sec_enemy",
      group: "foe",
      hpCurrent: 8,
      hpMax: 12,
      tempHp: 0,
      status: "Poisoned",
      notes: "canonical notes stay put"
    });
  });

  it("adds, edits, and removes participant statuses while writing back only canonical status text", () => {
    const state = makeState();

    const added = addCombatParticipantStatusEffect(
      state,
      "cmb_1",
      { label: "Bless", durationMode: "rounds", remaining: 2 },
      { id: "s_bless", now: "2026-04-11T12:03:00.000Z" }
    );

    expect(added).toMatchObject({
      changed: true,
      wroteCanonical: true,
      effect: {
        id: "s_bless",
        label: "Bless",
        durationMode: "rounds",
        remaining: 2,
        expired: false
      }
    });
    expect(state.combat.encounter.participants[0].statusEffects.map((effect) => effect.label)).toEqual([
      "Haste",
      "Bless"
    ]);
    expect(state.combat.encounter.participants[1].statusEffects).toEqual([]);
    expect(state.tracker.npcs[0]).toMatchObject({
      name: "Bandit",
      hpCurrent: 10,
      hpMax: 12,
      tempHp: 3,
      notes: "canonical notes stay put",
      status: "Haste, Bless"
    });

    const edited = updateCombatParticipantStatusEffect(
      state,
      "cmb_1",
      "s_bless",
      { label: "Blessed", durationMode: "time", remaining: 0 },
      { now: "2026-04-11T12:04:00.000Z" }
    );

    expect(edited).toMatchObject({
      changed: true,
      wroteCanonical: true,
      effect: {
        id: "s_bless",
        label: "Blessed",
        durationMode: "time",
        remaining: 0,
        expired: true
      }
    });
    expect(state.tracker.npcs[0].status).toBe("Haste, Blessed");

    const removed = removeCombatParticipantStatusEffect(state, "cmb_1", "s_time", {
      now: "2026-04-11T12:05:00.000Z"
    });

    expect(removed).toMatchObject({
      changed: true,
      wroteCanonical: true,
      removed: expect.objectContaining({ id: "s_time", label: "Haste" })
    });
    expect(state.combat.encounter.participants[0].statusEffects.map((effect) => effect.label)).toEqual(["Blessed"]);
    expect(state.tracker.npcs[0].status).toBe("Blessed");
  });

  it("rejects status changes without labels", () => {
    const state = makeState();

    const result = addCombatParticipantStatusEffect(state, "cmb_1", { label: "  ", durationMode: "time", remaining: 12 });

    expect(result).toMatchObject({ changed: false, wroteCanonical: false, effect: null });
    expect(state.combat.encounter.participants[0].statusEffects).toHaveLength(1);
    expect(state.tracker.npcs[0].status).toBe("Poisoned");
  });

  it("keeps role overrides and order changes encounter-only", () => {
    const state = makeState();

    expect(setCombatParticipantRole(state, "cmb_1", "party").changed).toBe(true);
    expect(moveCombatParticipant(state, "cmb_2", -1).changed).toBe(true);

    expect(state.combat.encounter.participants.map((participant) => participant.id)).toEqual(["cmb_2", "cmb_1"]);
    expect(state.combat.encounter.participants[1]).toMatchObject({ id: "cmb_1", role: "party" });
    expect(state.tracker.npcs[0]).toMatchObject({
      group: "foe",
      sectionId: "sec_enemy"
    });
    expect(state.tracker.npcs[0].role).toBeUndefined();
  });

  it("removes participants from the encounter only", () => {
    const state = makeState();

    const result = removeCombatParticipant(state, "cmb_1");

    expect(result.changed).toBe(true);
    expect(result.removed).toMatchObject({ id: "cmb_1" });
    expect(state.combat.encounter.participants.map((participant) => participant.id)).toEqual(["cmb_2"]);
    expect(state.combat.encounter.activeParticipantId).toBe("cmb_2");
    expect(state.tracker.npcs).toHaveLength(1);
  });

  it("advances and undoes turn timing through the Slice 2 helper model", () => {
    const state = makeState();
    state.combat.encounter.activeParticipantId = "cmb_2";
    state.combat.encounter.participants[1].statusEffects = [
      makeStatusEffect({ id: "s_round", label: "Shield", durationMode: "rounds", remaining: 1 })
    ];

    const advanced = advanceCombatTurn(state, {
      now: "2026-04-11T12:02:00.000Z",
      undoId: "undo_1"
    });

    expect(advanced).toMatchObject({
      changed: true,
      didAdvance: true,
      roundAdvanced: true
    });
    expect(state.combat.encounter).toMatchObject({
      round: 2,
      activeParticipantId: "cmb_1",
      elapsedSeconds: 6
    });
    expect(state.combat.encounter.participants[0].statusEffects[0]).toMatchObject({
      id: "s_time",
      remaining: 6,
      expired: false
    });
    expect(state.combat.encounter.participants[1].statusEffects[0]).toMatchObject({
      id: "s_round",
      remaining: 0,
      expired: true
    });
    expect(state.combat.encounter.undoStack).toHaveLength(1);

    state.combat.encounter.participants[0].hpCurrent = 1;
    const undone = undoCombatTurn(state);

    expect(undone).toMatchObject({ changed: true, applied: true });
    expect(state.combat.encounter).toMatchObject({
      round: 1,
      activeParticipantId: "cmb_2",
      elapsedSeconds: 0,
      undoStack: []
    });
    expect(state.combat.encounter.participants[0]).toMatchObject({
      hpCurrent: 1,
      statusEffects: [
        expect.objectContaining({ id: "s_time", remaining: 12, expired: false })
      ]
    });
    expect(state.combat.encounter.participants[1].statusEffects[0]).toMatchObject({
      id: "s_round",
      remaining: 1,
      expired: false
    });
  });

  it("clears disposable encounter state while preserving workspace layout", () => {
    const state = makeState();

    const result = clearCombat(state);

    expect(result.changed).toBe(true);
    expect(state.combat.encounter).toEqual(createDefaultCombatEncounter());
    expect(state.combat.workspace).toEqual({
      panelOrder: ["combatRoundPanel", "combatCardsPanel"],
      embeddedPanels: [],
      panelCollapsed: { combatRoundPanel: true }
    });
  });
});
