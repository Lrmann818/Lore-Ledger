import { describe, expect, it } from "vitest";

import {
  addTempHp,
  advanceStatusEffects,
  advanceTurn,
  applyDamage,
  applyHealing,
  applyTurnAdvanceUndoEntry,
  clearCombatEncounter,
  createCombatParticipantFromSource,
  createDefaultCombatEncounter,
  createTurnAdvanceUndoEntry,
  findCombatSource,
  getCombatSourceDisplayName,
  getCombatSourceListKey,
  inferCombatRoleFromSource,
  makeStatusEffect,
  normalizeCombatDeathSaves,
  normalizeCombatEncounter,
  normalizeCombatRole,
  normalizeCombatSourceType,
  normalizeStatusDurationMode,
  normalizeStatusEffects,
  statusEffectsFromText,
  undoLastTurnAdvance
} from "../js/domain/combat.js";

function participant(overrides = {}) {
  return {
    id: "cmb_1",
    name: "Arlen",
    role: "party",
    source: {
      type: "party",
      id: "party_1",
      sectionId: "party",
      group: ""
    },
    hpCurrent: 12,
    hpMax: 20,
    tempHp: 0,
    deathSaves: { successes: 0, failures: 0 },
    statusEffects: [],
    ...overrides
  };
}

describe("combat domain helpers", () => {
  describe("participant/source helpers", () => {
    it("normalizes missing and malformed death save counts to the supported 0..3 range", () => {
      expect(normalizeCombatDeathSaves(undefined)).toEqual({ successes: 0, failures: 0 });
      expect(normalizeCombatDeathSaves({ successes: 7, failures: -2 })).toEqual({ successes: 3, failures: 0 });
      expect(normalizeCombatEncounter({
        participants: [{ id: "cmb_1", deathSaves: { successes: "2", failures: "bad" } }]
      }).participants[0].deathSaves).toEqual({ successes: 2, failures: 0 });
    });

    it("normalizes source type aliases and resolves backing tracker lists", () => {
      expect(normalizeCombatSourceType(" PARTY ")).toBe("party");
      expect(normalizeCombatSourceType("npcs")).toBe("npc");
      expect(normalizeCombatSourceType("locationsList")).toBe("location");
      expect(normalizeCombatSourceType(undefined, { id: "loc_abc" })).toBe("location");
      expect(normalizeCombatSourceType("dragon")).toBeNull();

      expect(getCombatSourceListKey("party")).toBe("party");
      expect(getCombatSourceListKey("npc")).toBe("npcs");
      expect(getCombatSourceListKey("location")).toBe("locationsList");
      expect(getCombatSourceListKey("unknown")).toBeNull();
    });

    it("finds canonical tracker sources without copying or mutating them", () => {
      const npc = { id: "npc_1", name: "Bandit" };
      const tracker = {
        party: [{ id: "party_1", name: "Tess" }],
        npcs: [npc],
        locationsList: [{ id: "loc_1", title: "Docks" }]
      };

      expect(findCombatSource(tracker, { type: "npc", id: "npc_1" })).toEqual({
        type: "npc",
        listKey: "npcs",
        card: npc
      });
      expect(findCombatSource(tracker, { type: "npc", id: "missing" })).toBeNull();
      expect(findCombatSource(tracker, { type: "dragon", id: "npc_1" })).toBeNull();
    });

    it("creates encounter-local participants from sources with independent combat values", () => {
      const source = {
        id: "npc_1",
        name: "Bandit",
        sectionId: "sec_enemy",
        group: "hostile",
        hpCurrent: 7,
        hpMax: 11,
        tempHp: 2,
        status: "Poisoned, Frightened"
      };

      const first = createCombatParticipantFromSource(source, {
        id: "cmb_a",
        sourceType: "npc"
      });
      const duplicate = createCombatParticipantFromSource(source, {
        id: "cmb_b",
        sourceType: "npc"
      });

      expect(first).toMatchObject({
        id: "cmb_a",
        name: "Bandit",
        role: "enemy",
        source: {
          type: "npc",
          id: "npc_1",
          sectionId: "sec_enemy",
          group: "hostile"
        },
        hpCurrent: 7,
        hpMax: 11,
        tempHp: 2,
        deathSaves: { successes: 0, failures: 0 }
      });
      expect(first.statusEffects.map((effect) => effect.label)).toEqual(["Poisoned", "Frightened"]);
      expect(duplicate.id).toBe("cmb_b");
      expect(duplicate.source).toEqual(first.source);
      expect(duplicate.statusEffects).not.toBe(first.statusEffects);

      first.hpCurrent = 1;
      first.statusEffects[0].label = "Changed";
      expect(source.hpCurrent).toBe(7);
      expect(duplicate.statusEffects[0].label).toBe("Poisoned");
    });

    it("uses display-name fallbacks and role overrides defensively", () => {
      expect(getCombatSourceDisplayName({ title: "Old Mill" })).toBe("Old Mill");
      expect(getCombatSourceDisplayName({})).toBe("Unnamed participant");
      expect(normalizeCombatRole("hostile")).toBe("enemy");

      expect(
        inferCombatRoleFromSource({ id: "npc_2", sectionId: "friendly" }, { roleOverride: "enemy" })
      ).toBe("enemy");
      expect(inferCombatRoleFromSource({ id: "party_1" }, { sourceType: "party" })).toBe("party");
      expect(
        inferCombatRoleFromSource(
          { id: "npc_3", sectionId: "sec_1", group: "undecided" },
          { sourceType: "npc", sections: [{ id: "sec_1", name: "Monsters" }] }
        )
      ).toBe("enemy");
      expect(inferCombatRoleFromSource({ id: "loc_1" }, { sourceType: "location" })).toBe("npc");
    });
  });

  describe("HP and temp HP math", () => {
    it("applies damage to temp HP first and clamps current HP at zero", () => {
      expect(applyDamage({ hpCurrent: 10, hpMax: 12, tempHp: 4 }, 7)).toEqual({
        hpCurrent: 7,
        hpMax: 12,
        tempHp: 0,
        damageToTempHp: 4,
        damageToHp: 3,
        unappliedDamage: 0
      });

      expect(applyDamage({ hpCurrent: 3, hpMax: 10, tempHp: 0 }, 8)).toMatchObject({
        hpCurrent: 0,
        damageToHp: 3,
        unappliedDamage: 5
      });
    });

    it("handles unknown HP and invalid damage without inventing current HP", () => {
      expect(applyDamage({ hpCurrent: null, hpMax: 20, tempHp: 5 }, 8)).toEqual({
        hpCurrent: null,
        hpMax: 20,
        tempHp: 0,
        damageToTempHp: 5,
        damageToHp: 0,
        unappliedDamage: 3
      });

      expect(applyDamage({ hpCurrent: 10, hpMax: 20, tempHp: 1 }, -4)).toMatchObject({
        hpCurrent: 10,
        tempHp: 1,
        damageToHp: 0,
        damageToTempHp: 0
      });
    });

    it("heals current HP only and keeps temp HP separate", () => {
      expect(applyHealing({ hpCurrent: 5, hpMax: 8, tempHp: 6 }, 10)).toEqual({
        hpCurrent: 8,
        hpMax: 8,
        tempHp: 6,
        healingApplied: 3
      });

      expect(applyHealing({ hpCurrent: null, hpMax: 8, tempHp: 6 }, 5)).toEqual({
        hpCurrent: null,
        hpMax: 8,
        tempHp: 6,
        healingApplied: 0
      });
    });

    it("adds temp HP to existing temp HP", () => {
      expect(addTempHp({ hpCurrent: 5, hpMax: 8, tempHp: 3 }, 4)).toEqual({
        hpCurrent: 5,
        hpMax: 8,
        tempHp: 7,
        tempHpAdded: 4
      });

      expect(addTempHp({ hpCurrent: 5, hpMax: 8, tempHp: 3 }, "bad")).toMatchObject({
        tempHp: 3,
        tempHpAdded: 0
      });
    });
  });

  describe("status effect factories and timing", () => {
    it("creates normalized status effects and parses legacy status text", () => {
      expect(makeStatusEffect({
        id: "status_1",
        label: "Blessed",
        durationMode: "rounds",
        duration: 2
      })).toEqual({
        id: "status_1",
        label: "Blessed",
        durationMode: "rounds",
        duration: 2,
        remaining: 2,
        expired: false
      });

      expect(statusEffectsFromText("Poisoned; Frightened\n  Charmed ").map((effect) => effect.label)).toEqual([
        "Poisoned",
        "Frightened",
        "Charmed"
      ]);

      expect(normalizeStatusEffects(["Prone", "", { id: "s2", label: "Slow", durationMode: "time", remaining: 12 }]))
        .toEqual([
          expect.objectContaining({ label: "Prone", durationMode: "none", remaining: null }),
          expect.objectContaining({ id: "s2", label: "Slow", durationMode: "time", remaining: 12 })
        ]);
    });

    it("advances time effects every turn and round effects only when the order wraps", () => {
      const effects = [
        makeStatusEffect({ id: "time_1", label: "Haste", durationMode: "time", remaining: 12 }),
        makeStatusEffect({ id: "round_1", label: "Bless", durationMode: "rounds", remaining: 2 }),
        makeStatusEffect({ id: "plain_1", label: "Prone" })
      ];

      expect(advanceStatusEffects(effects, { secondsElapsed: 6, roundAdvanced: false })).toEqual([
        expect.objectContaining({ id: "time_1", remaining: 6, expired: false }),
        expect.objectContaining({ id: "round_1", remaining: 2, expired: false }),
        expect.objectContaining({ id: "plain_1", remaining: null, expired: false })
      ]);

      expect(advanceStatusEffects(effects, { secondsElapsed: 20, roundAdvanced: true })).toEqual([
        expect.objectContaining({ id: "time_1", remaining: 0, expired: true }),
        expect.objectContaining({ id: "round_1", remaining: 1, expired: false }),
        expect.objectContaining({ id: "plain_1", durationMode: "none", expired: false })
      ]);

      expect(advanceStatusEffects(effects, { secondsElapsed: 0, roundAdvanced: false })[0])
        .toMatchObject({ id: "time_1", remaining: 12, expired: false });
    });

    it("normalizes minute and hour duration aliases to timed effects in seconds", () => {
      expect(normalizeStatusDurationMode("minutes")).toBe("time");
      expect(normalizeStatusDurationMode("hours")).toBe("time");
      expect(makeStatusEffect({ id: "s_minutes", label: "Invisible", durationMode: "minutes", remaining: 2 }))
        .toMatchObject({ durationMode: "time", duration: 120, remaining: 120, expired: false });
      expect(makeStatusEffect({ id: "s_hours", label: "Ward", durationMode: "hours", duration: 1 }))
        .toMatchObject({ durationMode: "time", duration: 3600, remaining: 3600, expired: false });
    });
  });

  describe("turn advance and undo helpers", () => {
    it("advances active participant, elapsed time, undo history, and timed statuses", () => {
      const encounter = createDefaultCombatEncounter({
        round: 2,
        activeParticipantId: "cmb_1",
        elapsedSeconds: 18,
        secondsPerTurn: 6,
        participants: [
          participant({
            id: "cmb_1",
            statusEffects: [
              makeStatusEffect({ id: "s_time", label: "Haste", durationMode: "time", remaining: 12 })
            ]
          }),
          participant({ id: "cmb_2", name: "Bandit", role: "enemy" }),
          participant({ id: "cmb_3", name: "Sage", role: "npc" })
        ]
      });

      const result = advanceTurn(encounter, { now: "2026-04-11T12:00:00.000Z", undoId: "undo_1" });

      expect(result.didAdvance).toBe(true);
      expect(result.roundAdvanced).toBe(false);
      expect(result.encounter).toMatchObject({
        round: 2,
        activeParticipantId: "cmb_2",
        elapsedSeconds: 24,
        updatedAt: "2026-04-11T12:00:00.000Z"
      });
      expect(result.encounter.participants[0].statusEffects[0]).toMatchObject({
        id: "s_time",
        remaining: 6,
        expired: false
      });
      expect(result.undoEntry).toMatchObject({
        id: "undo_1",
        type: "turnAdvance",
        before: {
          round: 2,
          activeParticipantId: "cmb_1",
          elapsedSeconds: 18
        },
        after: {
          round: 2,
          activeParticipantId: "cmb_2",
          elapsedSeconds: 24
        }
      });
      expect(result.encounter.undoStack).toHaveLength(1);
    });

    it("increments the round when the order wraps and starts at the first participant when none is active", () => {
      const wrapped = advanceTurn(createDefaultCombatEncounter({
        round: 1,
        activeParticipantId: "cmb_2",
        participants: [
          participant({ id: "cmb_1" }),
          participant({
            id: "cmb_2",
            statusEffects: [
              makeStatusEffect({ id: "s_round", label: "Bless", durationMode: "rounds", remaining: 1 })
            ]
          })
        ]
      }));

      expect(wrapped.roundAdvanced).toBe(true);
      expect(wrapped.encounter.round).toBe(2);
      expect(wrapped.encounter.activeParticipantId).toBe("cmb_1");
      expect(wrapped.encounter.participants[1].statusEffects[0]).toMatchObject({
        remaining: 0,
        expired: true
      });

      const started = advanceTurn(createDefaultCombatEncounter({
        activeParticipantId: null,
        participants: [participant({ id: "cmb_1" })]
      }));
      expect(started.encounter.activeParticipantId).toBe("cmb_1");
      expect(started.encounter.elapsedSeconds).toBe(6);
      expect(started.roundAdvanced).toBe(false);
    });

    it("returns a defensive no-op for empty encounters", () => {
      const result = advanceTurn({ round: 3, activeParticipantId: "missing", participants: [] });

      expect(result).toMatchObject({
        undoEntry: null,
        didAdvance: false,
        roundAdvanced: false
      });
      expect(result.encounter).toMatchObject({
        round: 3,
        activeParticipantId: null,
        elapsedSeconds: 0,
        participants: [],
        undoStack: []
      });
    });

    it("applies turn undo without reverting unrelated participant edits", () => {
      const before = createDefaultCombatEncounter({
        round: 1,
        activeParticipantId: "cmb_1",
        elapsedSeconds: 0,
        participants: [
          participant({
            id: "cmb_1",
            hpCurrent: 10,
            statusEffects: [
              makeStatusEffect({ id: "s_time", label: "Haste", durationMode: "time", remaining: 6 })
            ]
          })
        ]
      });
      const after = {
        ...before,
        activeParticipantId: "cmb_1",
        elapsedSeconds: 6,
        participants: [
          {
            ...before.participants[0],
            hpCurrent: 2,
            tempHp: 5,
            statusEffects: [
              makeStatusEffect({ id: "s_time", label: "Haste", durationMode: "time", remaining: 0 })
            ]
          }
        ]
      };
      const undoEntry = createTurnAdvanceUndoEntry(before, after, { id: "undo_1" });
      const editedAfterAdvance = {
        ...after,
        participants: [{ ...after.participants[0], hpCurrent: 1, tempHp: 8 }],
        undoStack: [undoEntry]
      };

      const result = undoLastTurnAdvance(editedAfterAdvance);

      expect(result.applied).toBe(true);
      expect(result.undoEntry).toEqual(undoEntry);
      expect(result.encounter).toMatchObject({
        round: 1,
        activeParticipantId: "cmb_1",
        elapsedSeconds: 0,
        undoStack: []
      });
      expect(result.encounter.participants[0]).toMatchObject({
        hpCurrent: 1,
        tempHp: 8
      });
      expect(result.encounter.participants[0].statusEffects[0]).toMatchObject({
        id: "s_time",
        remaining: 6,
        expired: false
      });
    });

    it("rejects malformed undo entries without changing the encounter", () => {
      const encounter = createDefaultCombatEncounter({
        round: 4,
        activeParticipantId: "cmb_1",
        elapsedSeconds: 18,
        participants: [participant({ id: "cmb_1" })]
      });

      expect(applyTurnAdvanceUndoEntry(encounter, { type: "bad" })).toEqual({
        encounter,
        applied: false
      });
      expect(undoLastTurnAdvance({ ...encounter, undoStack: [{ type: "bad" }] })).toMatchObject({
        applied: false,
        undoEntry: null,
        encounter: {
          ...encounter,
          undoStack: [{ type: "bad" }]
        }
      });
    });

    it("normalizes malformed encounters without keeping invalid active participants", () => {
      expect(normalizeCombatEncounter({
        round: 0,
        activeParticipantId: "missing",
        secondsPerTurn: 0,
        elapsedSeconds: -1,
        participants: [{ id: "", name: "bad" }, participant({ id: "cmb_ok" })],
        undoStack: "bad"
      })).toMatchObject({
        round: 1,
        activeParticipantId: null,
        secondsPerTurn: 6,
        elapsedSeconds: 0,
        participants: [expect.objectContaining({ id: "cmb_ok" })],
        undoStack: []
      });
    });
  });

  describe("clear encounter helper", () => {
    it("resets the disposable encounter state to defaults", () => {
      expect(clearCombatEncounter()).toEqual({
        id: null,
        createdAt: null,
        updatedAt: null,
        round: 1,
        activeParticipantId: null,
        elapsedSeconds: 0,
        secondsPerTurn: 6,
        participants: [],
        undoStack: []
      });
    });
  });
});
