import { describe, expect, it } from "vitest";

import { addTrackerCardToCombatEncounter } from "../js/domain/combatTrackerActions.js";

describe("tracker add-to-combat actions", () => {
  it("appends duplicate encounter-local participants without mutating the source tracker card", () => {
    const npc = {
      id: "npc_1",
      name: "Bandit",
      sectionId: "sec_foe",
      hpCurrent: 7,
      hpMax: 11,
      status: "Poisoned"
    };
    const state = {
      tracker: {
        npcs: [npc],
        npcSections: [{ id: "sec_foe", name: "Foes" }]
      },
      combat: {
        workspace: {
          panelOrder: ["combatCardsPanel"],
          embeddedPanels: [],
          panelCollapsed: {}
        },
        encounter: {
          id: "enc_existing",
          createdAt: "2026-04-11T10:00:00.000Z",
          updatedAt: "2026-04-11T10:00:00.000Z",
          round: 1,
          activeParticipantId: null,
          elapsedSeconds: 0,
          secondsPerTurn: 6,
          participants: [],
          undoStack: []
        }
      }
    };

    const first = addTrackerCardToCombatEncounter(state, { type: "npc", id: "npc_1" }, {
      now: "2026-04-11T10:01:00.000Z",
      participantId: "cmb_a"
    });
    const duplicate = addTrackerCardToCombatEncounter(state, { type: "npc", id: "npc_1" }, {
      now: "2026-04-11T10:02:00.000Z",
      participantId: "cmb_b"
    });

    expect(first.added).toBe(true);
    expect(duplicate.added).toBe(true);
    expect(state.tracker.npcs).toEqual([npc]);
    expect(state.combat.workspace.panelOrder).toEqual(["combatCardsPanel"]);
    expect(state.combat.encounter).toMatchObject({
      id: "enc_existing",
      createdAt: "2026-04-11T10:00:00.000Z",
      updatedAt: "2026-04-11T10:02:00.000Z"
    });
    expect(state.combat.encounter.participants).toHaveLength(2);
    expect(state.combat.encounter.participants.map((participant) => participant.id)).toEqual(["cmb_a", "cmb_b"]);
    expect(state.combat.encounter.participants.map((participant) => participant.source)).toEqual([
      { type: "npc", id: "npc_1", sectionId: "sec_foe", group: "" },
      { type: "npc", id: "npc_1", sectionId: "sec_foe", group: "" }
    ]);
    expect(state.combat.encounter.participants[0]).toMatchObject({
      name: "Bandit",
      role: "enemy",
      hpCurrent: 7,
      hpMax: 11
    });

    state.combat.encounter.participants[0].hpCurrent = 1;
    state.combat.encounter.participants[0].statusEffects[0].label = "Changed";
    expect(npc.hpCurrent).toBe(7);
    expect(state.combat.encounter.participants[1].statusEffects[0].label).toBe("Poisoned");
  });

  it("creates missing combat buckets only after resolving a valid tracker source", () => {
    const noCampaignState = { combat: null };

    expect(addTrackerCardToCombatEncounter(noCampaignState, { type: "npc", id: "npc_1" })).toEqual({
      added: false,
      participant: null,
      encounter: null,
      reason: "missing-source"
    });
    expect(noCampaignState.combat).toBeNull();

    const state = {
      tracker: {
        party: [{ id: "party_1", name: "Tess", sectionId: "party_main" }],
        partySections: [{ id: "party_main", name: "Main" }]
      }
    };

    const result = addTrackerCardToCombatEncounter(state, { type: "party", id: "party_1" }, {
      now: "2026-04-11T11:00:00.000Z",
      encounterId: "enc_new",
      participantId: "cmb_party"
    });

    expect(result.added).toBe(true);
    expect(state.combat).toEqual({
      workspace: {
        panelOrder: [],
        embeddedPanels: [],
        panelCollapsed: {}
      },
      encounter: expect.objectContaining({
        id: "enc_new",
        createdAt: "2026-04-11T11:00:00.000Z",
        updatedAt: "2026-04-11T11:00:00.000Z",
        participants: [
          expect.objectContaining({
            id: "cmb_party",
            name: "Tess",
            role: "party",
            source: { type: "party", id: "party_1", sectionId: "party_main", group: "" }
          })
        ]
      })
    });
  });

  it("repairs malformed combat buckets defensively while keeping canonical tracker data separate", () => {
    const state = {
      tracker: {
        locationsList: [{ id: "loc_1", title: "Old Mill", sectionId: "loc_main" }],
        locSections: [{ id: "loc_main", name: "Places" }]
      },
      combat: {
        workspace: {
          panelOrder: "bad",
          embeddedPanels: null,
          panelCollapsed: []
        },
        encounter: {
          round: "bad",
          participants: "bad",
          undoStack: "bad"
        }
      }
    };

    const result = addTrackerCardToCombatEncounter(state, { type: "location", id: "loc_1" }, {
      now: "2026-04-11T12:00:00.000Z",
      participantId: "cmb_loc"
    });

    expect(result.added).toBe(true);
    expect(state.tracker.locationsList).toEqual([{ id: "loc_1", title: "Old Mill", sectionId: "loc_main" }]);
    expect(state.combat.workspace).toEqual({
      panelOrder: [],
      embeddedPanels: [],
      panelCollapsed: {}
    });
    expect(state.combat.encounter).toMatchObject({
      round: 1,
      activeParticipantId: null,
      elapsedSeconds: 0,
      secondsPerTurn: 6,
      undoStack: [],
      participants: [
        expect.objectContaining({
          id: "cmb_loc",
          name: "Old Mill",
          role: "npc",
          source: { type: "location", id: "loc_1", sectionId: "loc_main", group: "" }
        })
      ]
    });
  });
});
