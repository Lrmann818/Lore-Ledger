import { describe, expect, it } from "vitest";

import {
  COMBAT_CORE_PANEL_IDS,
  COMBAT_ROLE_SELECT_CLASSES,
  COMBAT_STATUS_MODE_SELECT_CLASSES,
  COMBAT_STATUS_DURATION_OPTIONS,
  formatCombatElapsedTime,
  formatStatusEffectDetail,
  getCombatCardViewModels,
  getCombatRoundControlsViewModel,
  getCombatShellViewModel
} from "../js/pages/combat/combatPage.js";
import {
  COMBAT_CARDS_PANEL_ID,
  COMBAT_COLUMN_OWNER_PANEL_ORDER,
  COMBAT_EMBEDDED_PANEL_HOST_ID,
  COMBAT_ROUND_PANEL_ID,
  normalizeCombatColumnOwnerPanelOrder
} from "../js/pages/combat/combatSectionReorder.js";

describe("combat page shell helpers", () => {
  it("defines the always-present core combat panels", () => {
    expect(COMBAT_CORE_PANEL_IDS).toEqual(["combatCardsPanel", "combatRoundPanel"]);
  });

  it("defines Combat Cards as the column-owning panel and keeps embedded panels with the other core panel", () => {
    expect(COMBAT_CARDS_PANEL_ID).toBe("combatCardsPanel");
    expect(COMBAT_ROUND_PANEL_ID).toBe("combatRoundPanel");
    expect(COMBAT_EMBEDDED_PANEL_HOST_ID).toBe("combatEmbeddedPanels");
    expect(COMBAT_COLUMN_OWNER_PANEL_ORDER).toEqual(["combatCardsPanel", "combatRoundPanel"]);
  });

  it("normalizes persisted combat core panel order while preserving the chosen Combat Cards side", () => {
    expect(normalizeCombatColumnOwnerPanelOrder(["combatCardsPanel", "combatRoundPanel"]))
      .toEqual(["combatCardsPanel", "combatRoundPanel"]);
    expect(normalizeCombatColumnOwnerPanelOrder(["combatRoundPanel", "combatCardsPanel"]))
      .toEqual(["combatRoundPanel", "combatCardsPanel"]);
    expect(normalizeCombatColumnOwnerPanelOrder(["combatCardsPanel"]))
      .toEqual(["combatCardsPanel", "combatRoundPanel"]);
    expect(normalizeCombatColumnOwnerPanelOrder(["combatRoundPanel"]))
      .toEqual(["combatRoundPanel", "combatCardsPanel"]);
    expect(normalizeCombatColumnOwnerPanelOrder(["notesPanel", "combatRoundPanel"]))
      .toEqual(["combatRoundPanel", "combatCardsPanel"]);
    expect(normalizeCombatColumnOwnerPanelOrder(["combatCardsPanel", "notesPanel"]))
      .toEqual(["combatCardsPanel", "combatRoundPanel"]);
  });

  it("formats elapsed encounter time for the shell timer", () => {
    expect(formatCombatElapsedTime(0)).toBe("00:00");
    expect(formatCombatElapsedTime(65)).toBe("01:05");
    expect(formatCombatElapsedTime(3661)).toBe("1:01:01");
    expect(formatCombatElapsedTime(-12)).toBe("00:00");
  });

  it("defines the locked status duration choices for the modal", () => {
    expect(COMBAT_STATUS_DURATION_OPTIONS.map((option) => option.value)).toEqual([
      "none",
      "rounds",
      "seconds",
      "minutes",
      "hours"
    ]);
  });

  it("uses shared app select classes for Combat dropdowns", () => {
    expect(COMBAT_ROLE_SELECT_CLASSES.split(" ")).toEqual(expect.arrayContaining(["panelSelect", "combatRoleSelect"]));
    expect(COMBAT_STATUS_MODE_SELECT_CLASSES.split(" ")).toEqual(expect.arrayContaining(["settingsSelect", "combatStatusModalModeSelect"]));
  });

  it("formats status time remaining as seconds, mm:ss, and hh:mm", () => {
    expect(formatStatusEffectDetail(6, "time")).toBe("(6s)");
    expect(formatStatusEffectDetail(60, "time")).toBe("(01:00)");
    expect(formatStatusEffectDetail(3599, "time")).toBe("(59:59)");
    expect(formatStatusEffectDetail(3600, "time")).toBe("(01:00)");
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

  it("builds combat card view models — no initiative counter, includes portraitBlobId from canonical source", () => {
    const state = {
      tracker: {
        party: [
          {
            id: "party_1",
            name: "Arlen",
            hpCurrent: 7,
            hpMax: 10,
            tempHp: 0,
            imgBlobId: "blob_arlen",
            status: ""
          }
        ],
        npcs: [
          {
            id: "npc_1",
            name: "Bandit",
            hpCurrent: 5,
            hpMax: 11,
            tempHp: 4,
            imgBlobId: null,
            status: "Haste, Bless"
          }
        ]
      },
      combat: {
        encounter: {
          activeParticipantId: "cmb_2",
          participants: [
            {
              id: "cmb_1",
              name: "Arlen",
              role: "party",
              source: { type: "party", id: "party_1", sectionId: "", group: "" },
              hpCurrent: 7,
              hpMax: 10,
              tempHp: 0,
              statusEffects: []
            },
            {
              id: "cmb_2",
              name: "Bandit",
              role: "enemy",
              source: { type: "npc", id: "npc_1", sectionId: "", group: "" },
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
    };

    const cards = getCombatCardViewModels(state);

    // No initiative/order counter in the view model (removed per v1 spec).
    expect(cards[0]).not.toHaveProperty("orderLabel");
    expect(cards[1]).not.toHaveProperty("orderLabel");

    // portraitBlobId is resolved from the canonical source — never from encounter state.
    expect(cards[0].portraitBlobId).toBe("blob_arlen");
    expect(cards[1].portraitBlobId).toBeNull(); // npc_1 has imgBlobId: null

    expect(cards).toEqual([
      expect.objectContaining({
        id: "cmb_1",
        name: "Arlen",
        role: "party",
        roleLabel: "Party",
        isActive: false,
        canMoveUp: false,
        canMoveDown: true,
        hpCurrentLabel: "7",
        hpMaxLabel: "10",
        hpDisplayLabel: "7",
        hasTempHp: false,
        portraitBlobId: "blob_arlen",
        statusEffects: []
      }),
      expect.objectContaining({
        id: "cmb_2",
        role: "enemy",
        roleLabel: "Enemy",
        isActive: true,
        canMoveUp: true,
        canMoveDown: false,
        hpCurrentLabel: "5",
        hpMaxLabel: "11",
        hpDisplayLabel: "9",
        tempHp: 4,
        hasTempHp: true,
        portraitBlobId: null,
        statusEffects: [
          {
            id: "s_1",
            label: "Haste",
            detail: "(6s)",
            durationMode: "seconds",
            durationInputValue: "6",
            remainingLabel: "6s",
            expired: false
          },
          {
            id: "s_2",
            label: "Bless",
            detail: "(0 rd)",
            durationMode: "rounds",
            durationInputValue: "0",
            remainingLabel: "0 rd",
            expired: true
          }
        ]
      })
    ]);
  });

  it("returns portraitBlobId null when tracker has no matching source", () => {
    const state = {
      // no tracker property
      combat: {
        encounter: {
          participants: [
            {
              id: "cmb_1",
              name: "Ghost",
              role: "npc",
              source: { type: "npc", id: "npc_99", sectionId: "", group: "" },
              hpCurrent: null,
              hpMax: null,
              tempHp: 0,
              statusEffects: []
            }
          ]
        }
      }
    };
    const cards = getCombatCardViewModels(state);
    expect(cards[0].portraitBlobId).toBeNull();
  });

  it("uses a single combat-card HP display value of current plus temp HP and tracks temp HP as color state only", () => {
    const cards = getCombatCardViewModels({
      tracker: {
        npcs: [{ id: "npc_1", name: "Ogre", hpCurrent: 42, hpMax: 49, tempHp: 14 }]
      },
      combat: {
        encounter: {
          participants: [
            {
              id: "cmb_1",
              name: "Ogre",
              role: "enemy",
              source: { type: "npc", id: "npc_1", sectionId: "", group: "" },
              hpCurrent: 42,
              hpMax: 49,
              tempHp: 14,
              statusEffects: []
            },
            {
              id: "cmb_2",
              name: "Mystery",
              role: "npc",
              source: { type: "npc", id: "missing", sectionId: "", group: "" },
              hpCurrent: null,
              hpMax: null,
              tempHp: 0,
              statusEffects: []
            }
          ]
        }
      }
    });

    expect(cards[0]).toMatchObject({
      hpCurrentLabel: "42",
      hpMaxLabel: "49",
      hpDisplayLabel: "56",
      hasTempHp: true,
      hpState: "temp",
      tempHp: 14
    });
    expect(cards[0]).not.toHaveProperty("tempHpLabel");
    expect(cards[1]).toMatchObject({
      hpDisplayLabel: "--",
      hpState: "normal",
      hasTempHp: false
    });
  });

  it("marks the single visible HP value as zero-state only when displayed HP reaches 0", () => {
    const cards = getCombatCardViewModels({
      combat: {
        encounter: {
          participants: [
            {
              id: "cmb_zero",
              name: "Downed",
              role: "party",
              source: { type: "party", id: "party_1", sectionId: "", group: "" },
              hpCurrent: 0,
              hpMax: 10,
              tempHp: 0,
              statusEffects: []
            },
            {
              id: "cmb_temp",
              name: "Shielded",
              role: "party",
              source: { type: "party", id: "party_2", sectionId: "", group: "" },
              hpCurrent: 0,
              hpMax: 10,
              tempHp: 3,
              statusEffects: []
            }
          ]
        }
      }
    });

    expect(cards[0]).toMatchObject({
      hpDisplayLabel: "0",
      hpState: "zero",
      hasTempHp: false
    });
    expect(cards[1]).toMatchObject({
      hpDisplayLabel: "3",
      hpState: "temp",
      hasTempHp: true
    });
  });

  it("builds status row view data with label and remaining count kept separate", () => {
    const cards = getCombatCardViewModels({
      combat: {
        encounter: {
          participants: [
            {
              id: "cmb_1",
              name: "Mage",
              role: "npc",
              source: { type: "npc", id: "npc_1", sectionId: "", group: "" },
              hpCurrent: 1,
              hpMax: 1,
              tempHp: 0,
              statusEffects: [
                { id: "s_minute", label: "Invisible", durationMode: "time", duration: 120, remaining: 60, expired: false },
                { id: "s_hour", label: "Ward", durationMode: "time", duration: 7200, remaining: 3660, expired: false }
              ]
            }
          ]
        }
      }
    });

    expect(cards[0].statusEffects).toEqual([
      expect.objectContaining({
        label: "Invisible",
        detail: "(01:00)",
        remainingLabel: "01:00",
        durationMode: "seconds"
      }),
      expect.objectContaining({
        label: "Ward",
        detail: "(01:01)",
        remainingLabel: "01:01",
        durationMode: "seconds"
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

  it("role tint classes are deterministic from the view model role field", () => {
    // The CSS class combatRole-{role} is applied from the view model.
    // Here we verify that the role field is one of the three valid values.
    const state = {
      combat: {
        encounter: {
          participants: [
            { id: "p", name: "P", role: "party", source: { type: "party", id: "x", sectionId: "", group: "" }, hpCurrent: null, hpMax: null, tempHp: 0, statusEffects: [] },
            { id: "e", name: "E", role: "enemy", source: { type: "npc", id: "y", sectionId: "", group: "" }, hpCurrent: null, hpMax: null, tempHp: 0, statusEffects: [] },
            { id: "n", name: "N", role: "npc", source: { type: "npc", id: "z", sectionId: "", group: "" }, hpCurrent: null, hpMax: null, tempHp: 0, statusEffects: [] }
          ]
        }
      }
    };
    const cards = getCombatCardViewModels(state);
    expect(cards[0].role).toBe("party");
    expect(cards[1].role).toBe("enemy");
    expect(cards[2].role).toBe("npc");
    // CSS class combatRole-party / enemy / npc applied from this field — no CSS tint for party (normal).
  });
});
