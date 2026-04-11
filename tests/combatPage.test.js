import { describe, expect, it } from "vitest";

import {
  COMBAT_CORE_PANEL_IDS,
  formatCombatElapsedTime,
  getCombatCardViewModels,
  getCombatRoundControlsViewModel,
  getCombatShellViewModel
} from "../js/pages/combat/combatPage.js";

describe("combat page shell helpers", () => {
  it("defines the always-present core combat panels", () => {
    expect(COMBAT_CORE_PANEL_IDS).toEqual(["combatCardsPanel", "combatRoundPanel"]);
  });

  it("formats elapsed encounter time for the shell timer", () => {
    expect(formatCombatElapsedTime(0)).toBe("00:00");
    expect(formatCombatElapsedTime(65)).toBe("01:05");
    expect(formatCombatElapsedTime(3661)).toBe("1:01:01");
    expect(formatCombatElapsedTime(-12)).toBe("00:00");
  });

  it("builds a safe empty-state view model from default combat state", () => {
    expect(
      getCombatShellViewModel({
        combat: {
          workspace: {
            panelOrder: [],
            embeddedPanels: [],
            panelCollapsed: {}
          },
          encounter: {
            id: null,
            createdAt: null,
            updatedAt: null,
            round: 1,
            activeParticipantId: null,
            elapsedSeconds: 0,
            secondsPerTurn: 6,
            participants: [],
            undoStack: []
          }
        }
      })
    ).toEqual({
      isEmpty: true,
      participantCount: 0,
      round: 1,
      elapsedSeconds: 0,
      elapsedLabel: "00:00",
      secondsPerTurn: 6
    });
  });

  it("normalizes malformed shell values without mutating future combat features", () => {
    const state = {
      combat: {
        encounter: {
          round: "4",
          elapsedSeconds: 125,
          secondsPerTurn: "9",
          participants: [{ id: "cmb_1" }, { id: "cmb_2" }]
        }
      }
    };

    expect(getCombatShellViewModel(state)).toEqual({
      isEmpty: false,
      participantCount: 2,
      round: 4,
      elapsedSeconds: 125,
      elapsedLabel: "02:05",
      secondsPerTurn: 9
    });
    expect(state.combat.encounter.participants).toEqual([{ id: "cmb_1" }, { id: "cmb_2" }]);
  });

  it("builds combat card view models with active, role, HP, temp HP, order, and status data", () => {
    expect(
      getCombatCardViewModels({
        combat: {
          encounter: {
            activeParticipantId: "cmb_2",
            participants: [
              {
                id: "cmb_1",
                name: "Arlen",
                role: "party",
                source: { type: "party", id: "party_1" },
                hpCurrent: 7,
                hpMax: 10,
                tempHp: 0,
                statusEffects: []
              },
              {
                id: "cmb_2",
                name: "Bandit",
                role: "enemy",
                source: { type: "npc", id: "npc_1" },
                hpCurrent: 5,
                hpMax: 11,
                tempHp: 4,
                statusEffects: [
                  {
                    id: "s_1",
                    label: "Haste",
                    durationMode: "time",
                    duration: 12,
                    remaining: 6,
                    expired: false
                  },
                  {
                    id: "s_2",
                    label: "Bless",
                    durationMode: "rounds",
                    duration: 1,
                    remaining: 0,
                    expired: true
                  }
                ]
              }
            ]
          }
        }
      })
    ).toEqual([
      expect.objectContaining({
        id: "cmb_1",
        name: "Arlen",
        role: "party",
        roleLabel: "Party",
        orderLabel: "1",
        isActive: false,
        canMoveUp: false,
        canMoveDown: true,
        hpCurrentLabel: "7",
        hpMaxLabel: "10",
        hasTempHp: false,
        statusEffects: []
      }),
      expect.objectContaining({
        id: "cmb_2",
        role: "enemy",
        roleLabel: "Enemy",
        orderLabel: "2",
        isActive: true,
        canMoveUp: true,
        canMoveDown: false,
        hpCurrentLabel: "5",
        hpMaxLabel: "11",
        tempHp: 4,
        hasTempHp: true,
        statusEffects: [
          { id: "s_1", label: "Haste", detail: "(6s)", expired: false },
          { id: "s_2", label: "Bless", detail: "(0 rd)", expired: true }
        ]
      })
    ]);
  });

  it("builds round control state from participants and undo history", () => {
    expect(getCombatRoundControlsViewModel({ combat: { encounter: {} } })).toEqual({
      canNextTurn: false,
      canUndo: false,
      canClear: false
    });

    expect(
      getCombatRoundControlsViewModel({
        combat: {
          encounter: {
            round: 2,
            elapsedSeconds: 6,
            participants: [{ id: "cmb_1" }],
            undoStack: [{ type: "turnAdvance" }]
          }
        }
      })
    ).toEqual({
      canNextTurn: true,
      canUndo: true,
      canClear: true
    });
  });
});
