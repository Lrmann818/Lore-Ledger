import { describe, expect, it } from "vitest";

import { backfillInventoryItemsFromLegacyEquipment, CURRENT_SCHEMA_VERSION, migrateState, normalizeInventoryItems } from "../js/state.js";

function cloneState(value) {
  return structuredClone(value);
}

/** Returns the first (and typically only) active character entry from a migrated state. */
function activeEntry(migrated) {
  return migrated.characters?.entries?.[0] ?? null;
}

function expectDefaultSingleSession(sessions) {
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toEqual(expect.objectContaining({
    id: expect.any(String),
    title: "Session 1",
    notes: ""
  }));
}

const EMPTY_CHARACTERS = { activeId: null, entries: [] };

const DEFAULT_COMBAT_STATE = {
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
};

describe("migrateState", () => {
  describe("backfillInventoryItemsFromLegacyEquipment", () => {
    it("seeds a default inventory item from legacy equipment when inventory is missing", () => {
      expect(backfillInventoryItemsFromLegacyEquipment(undefined, "Bedroll")).toEqual([
        { title: "Inventory", notes: "Bedroll" }
      ]);
    });

    it("repairs a malformed first inventory item when legacy equipment needs a one-time backfill", () => {
      expect(backfillInventoryItemsFromLegacyEquipment([null], "Bedroll")).toEqual([
        { title: "Inventory", notes: "Bedroll" }
      ]);
    });

    it("preserves existing inventory notes instead of overwriting them with legacy equipment text", () => {
      const existing = [{ title: "Pack", notes: "Already migrated" }];

      expect(backfillInventoryItemsFromLegacyEquipment(existing, "Lantern")).toBe(existing);
      expect(existing).toEqual([{ title: "Pack", notes: "Already migrated" }]);
    });
  });

  describe("legacy version paths", () => {
    it("upgrades unversioned saves through v1 and v2, preserving legacy theme, spells, resources, and map.character", () => {
      const migrated = migrateState({
        tracker: {
          ui: {
            textareaHeigts: { sessionNotes: 88 },
            theme: "dark"
          }
        },
        map: {
          character: {
            equipment: "Rope and grappling hook",
            spells: {
              cantrips: "Light\nMage Hand",
              lvl1: { used: "1", total: "4", list: "Shield\nMagic Missile" },
              lvl2: { used: "", total: null, list: "Invisibility" },
              lvl3: {}
            },
            resourceName: "Ki",
            resourceCur: 2,
            resourceMax: 5
          }
        }
      });

      const entry = activeEntry(migrated);
      const [cantrips, level1, level2, level3] = entry.spells.levels;

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.map.character).toBeUndefined();
      expect(entry.equipment).toBe("Rope and grappling hook");
      expect(entry.inventoryItems).toEqual([
        expect.objectContaining({ id: expect.any(String), title: "Inventory", notes: "Rope and grappling hook" })
      ]);
      expectDefaultSingleSession(migrated.tracker.sessions);
      expect(migrated.tracker.npcs).toEqual([]);
      expect(migrated.tracker.party).toEqual([]);
      expect(migrated.tracker.locationsList).toEqual([]);
      expect(migrated.tracker.campaignTitle).toBe("My Campaign");
      expect(migrated.tracker.activeSessionIndex).toBe(0);
      expect(migrated.tracker.ui.textareaHeights).toEqual({ sessionNotes: 88 });
      expect(entry.resources).toHaveLength(1);
      expect(entry.resources[0]).toMatchObject({
        name: "Ki",
        cur: 2,
        max: 5
      });
      expect("resourceName" in entry).toBe(false);
      expect("resourceCur" in entry).toBe(false);
      expect("resourceMax" in entry).toBe(false);
      expect(entry.spells.levels).toHaveLength(4);
      expect(cantrips).toMatchObject({ label: "Cantrips", hasSlots: false });
      expect(cantrips.spells.map((spell) => spell.name)).toEqual(["Light", "Mage Hand"]);
      expect(level1).toMatchObject({ label: "1st Level", hasSlots: true, used: 1, total: 4 });
      expect(level1.spells.map((spell) => spell.name)).toEqual(["Shield", "Magic Missile"]);
      expect(level2).toMatchObject({ label: "2nd Level", used: null, total: null });
      expect(level2.spells.map((spell) => spell.name)).toEqual(["Invisibility"]);
      expect(level3).toMatchObject({ label: "3rd Level", used: null, total: null });
      expect(migrated.map.maps).toEqual([]);
      expect(migrated.map.activeMapId).toBeNull();
      expect(migrated.map.ui).toEqual({ activeTool: "brush", brushSize: 6 });
      expect(migrated.combat).toEqual(DEFAULT_COMBAT_STATE);
      expect(migrated.app.preferences.playHubOpenSound).toBe(false);
      expect(migrated.ui).toEqual(
        expect.objectContaining({
          theme: "dark",
          textareaHeights: {},
          panelCollapsed: {}
        })
      );
    });

    it("treats malformed or negative schemaVersion values as legacy v0 saves", () => {
      const malformedVersion = migrateState({
        schemaVersion: "not-a-number",
        character: {
          equipment: "Bedroll"
        }
      });
      const negativeVersion = migrateState({
        schemaVersion: -4,
        character: {
          equipment: "Lantern"
        }
      });

      expect(malformedVersion.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(activeEntry(malformedVersion).inventoryItems).toEqual([
        expect.objectContaining({ id: expect.any(String), title: "Inventory", notes: "Bedroll" })
      ]);
      expect(negativeVersion.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(activeEntry(negativeVersion).inventoryItems).toEqual([
        expect.objectContaining({ id: expect.any(String), title: "Inventory", notes: "Lantern" })
      ]);
    });

    it("upgrades schema v1 saves into the v2 inventory structure", () => {
      const missingInventory = migrateState({
        schemaVersion: 1,
        character: {
          equipment: "Bedroll"
        }
      });
      const blankNotes = migrateState({
        schemaVersion: 1,
        character: {
          equipment: "Lantern",
          inventoryItems: [{ title: "", notes: "" }]
        }
      });
      const fractionalVersion = migrateState({
        schemaVersion: 1.9,
        character: {
          equipment: "Tinderbox"
        }
      });

      expect(missingInventory.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(activeEntry(missingInventory).inventoryItems).toEqual([
        expect.objectContaining({ id: expect.any(String), title: "Inventory", notes: "Bedroll" })
      ]);
      expect(activeEntry(blankNotes).inventoryItems).toEqual([
        expect.objectContaining({ id: expect.any(String), title: "Inventory", notes: "Lantern" })
      ]);
      expect(activeEntry(fractionalVersion).inventoryItems).toEqual([
        expect.objectContaining({ id: expect.any(String), title: "Inventory", notes: "Tinderbox" })
      ]);
    });

    it("upgrades schema v2 saves into v3 combat workspace state", () => {
      const migrated = migrateState({
        schemaVersion: 2,
        tracker: {
          campaignTitle: "Moonfall",
          misc: "Preserve this"
        },
        character: {
          inventoryItems: [{ title: "Inventory", notes: "Rations" }]
        },
        map: {
          activeMapId: null,
          maps: []
        },
        ui: {
          theme: "forest"
        }
      });

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(CURRENT_SCHEMA_VERSION).toBe(7);
      expect(migrated.combat).toEqual(DEFAULT_COMBAT_STATE);
      expect(migrated.tracker.campaignTitle).toBe("Moonfall");
      expect(migrated.tracker.misc).toBe("Preserve this");
      expect(activeEntry(migrated).inventoryItems).toEqual([
        expect.objectContaining({ id: expect.any(String), title: "Inventory", notes: "Rations" })
      ]);
      expect(migrated.ui.theme).toBe("forest");
    });

    it("upgrades schema v4 saves into v5 linked-card metadata", () => {
      const migrated = migrateState({
        schemaVersion: 4,
        tracker: {
          npcs: [{ id: "npc_1", name: "Scout" }],
          party: [{ id: "party_1", name: "Tess" }],
          locationsList: [{ id: "loc_1", title: "Old Mill" }]
        },
        characters: {
          activeId: "char_a",
          entries: [{ id: "char_a", name: "Arlen" }]
        }
      });

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.tracker.npcs[0].characterId).toBeNull();
      expect(migrated.tracker.party[0].characterId).toBeNull();
      expect(migrated.tracker.locationsList[0].characterId).toBeUndefined();
      expect(activeEntry(migrated).status).toBe("");
    });

    it("upgrades schema v5 saves by assigning stable ids to tracker sessions", () => {
      const migrated = migrateState({
        schemaVersion: 5,
        tracker: {
          sessions: [
            { title: "Alpha", notes: "A" },
            { title: "Bravo", notes: "B" }
          ],
          activeSessionIndex: 1
        }
      });

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.tracker.sessions).toHaveLength(2);
      expect(migrated.tracker.sessions[0]).toEqual(expect.objectContaining({
        id: expect.any(String),
        title: "Alpha",
        notes: "A"
      }));
      expect(migrated.tracker.sessions[1]).toEqual(expect.objectContaining({
        id: expect.any(String),
        title: "Bravo",
        notes: "B"
      }));
      expect(migrated.tracker.sessions[0].id).not.toBe(migrated.tracker.sessions[1].id);
      expect(migrated.tracker.activeSessionIndex).toBe(1);
    });

    it("upgrades schema v6 saves by assigning stable ids to character inventory items", () => {
      const migrated = migrateState({
        schemaVersion: 6,
        characters: {
          activeId: "char_a",
          entries: [
            {
              id: "char_a",
              inventoryItems: [
                { title: "Weapons", notes: "Sword" },
                { title: "Consumables", notes: "Potions" }
              ],
              activeInventoryIndex: 1
            }
          ]
        }
      });

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      const entry = activeEntry(migrated);
      expect(entry.inventoryItems).toHaveLength(2);
      expect(entry.inventoryItems[0]).toEqual(expect.objectContaining({
        id: expect.any(String),
        title: "Weapons",
        notes: "Sword"
      }));
      expect(entry.inventoryItems[1]).toEqual(expect.objectContaining({
        id: expect.any(String),
        title: "Consumables",
        notes: "Potions"
      }));
      expect(entry.inventoryItems[0].id).not.toBe(entry.inventoryItems[1].id);
      expect(entry.activeInventoryIndex).toBe(1);
    });

    it("normalizeInventoryItems preserves existing stable ids and only generates new ones for missing or duplicate ids", () => {
      const result = normalizeInventoryItems([
        { id: "inv_existing", title: "Pack", notes: "Rope" },
        { title: "Consumables", notes: "Potions" },
        { id: "inv_existing", title: "Weapons", notes: "Sword" }
      ]);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe("inv_existing");
      expect(result[0].title).toBe("Pack");
      expect(result[1].id).toEqual(expect.any(String));
      expect(result[1].id).not.toBe("inv_existing");
      expect(result[2].id).toEqual(expect.any(String));
      expect(result[2].id).not.toBe("inv_existing");
      expect(result[1].id).not.toBe(result[2].id);
    });

    it("repairs malformed combat state while keeping workspace limited to composition data", () => {
      const preserved = migrateState({
        schemaVersion: 3,
        combat: {
          workspace: {
            panelOrder: ["combatCardsPanel", "combatRoundPanel"],
            embeddedPanels: ["vitals"],
            panelCollapsed: { combatRoundPanel: true },
            copiedSpellNotes: { spell_1: "must not persist here" },
            spells: [{ id: "spell_1", notes: "must not persist here" }]
          },
          encounter: {
            id: "enc_1",
            createdAt: "2026-04-11T00:00:00.000Z",
            updatedAt: "2026-04-11T00:05:00.000Z",
            round: 4.8,
            activeParticipantId: "cmb_1",
            elapsedSeconds: 42,
            secondsPerTurn: 10,
            participants: [{ id: "cmb_1" }],
            undoStack: [{ type: "nextTurn" }],
            customEncounterFlag: "keep"
          }
        }
      });
      const repaired = migrateState({
        schemaVersion: 3,
        combat: {
          workspace: {
            panelOrder: "bad",
            embeddedPanels: null,
            panelCollapsed: []
          },
          encounter: {
            id: "",
            createdAt: 12,
            updatedAt: {},
            round: 0,
            activeParticipantId: "",
            elapsedSeconds: -5,
            secondsPerTurn: 0,
            participants: "bad",
            undoStack: null
          }
        }
      });
      const replaced = migrateState({
        schemaVersion: 3,
        combat: []
      });

      expect(preserved.combat.workspace).toMatchObject({
        panelOrder: ["combatCardsPanel", "combatRoundPanel"],
        embeddedPanels: ["vitals"],
        panelCollapsed: { combatRoundPanel: true }
      });
      expect(preserved.combat.workspace.copiedSpellNotes).toBeUndefined();
      expect(preserved.combat.workspace.spells).toBeUndefined();
      expect(preserved.combat.encounter).toMatchObject({
        id: "enc_1",
        createdAt: "2026-04-11T00:00:00.000Z",
        updatedAt: "2026-04-11T00:05:00.000Z",
        round: 4,
        activeParticipantId: "cmb_1",
        elapsedSeconds: 42,
        secondsPerTurn: 10,
        participants: [{ id: "cmb_1" }],
        undoStack: [{ type: "nextTurn" }],
        customEncounterFlag: "keep"
      });
      expect(repaired.combat).toEqual(DEFAULT_COMBAT_STATE);
      expect(replaced.combat).toEqual(DEFAULT_COMBAT_STATE);
    });

    it("accepts already-current saves and still applies load-time UI normalization", () => {
      const migrated = migrateState({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        tracker: {},
        character: {
          inventoryItems: [{ title: "Inventory", notes: "Pack" }]
        },
        map: {
          activeMapId: null,
          maps: [],
          undo: ["old"],
          redo: ["older"]
        },
        ui: {
          theme: "light",
          dice: {
            history: ["stale"],
            last: { count: 9, sides: 1, mod: 7, mode: "weird" }
          },
          calc: {
            history: ["2+2"]
          }
        }
      });

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.ui.theme).toBe("light");
      expect(migrated.ui.dice.history).toEqual([]);
      expect(migrated.ui.dice.last).toEqual({
        count: 1,
        sides: 2,
        mod: 0,
        mode: "normal"
      });
      expect(migrated.ui.calc.history).toEqual([]);
      expect(activeEntry(migrated).inventoryItems).toEqual([
        expect.objectContaining({ id: expect.any(String), title: "Inventory", notes: "Pack" })
      ]);
      expect(migrated.combat).toEqual(DEFAULT_COMBAT_STATE);
      expect(migrated.app.preferences.playHubOpenSound).toBe(false);
    });

    it("sanitizes existing app preferences without treating missing legacy values as enabled", () => {
      const missing = migrateState({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        app: {}
      });
      const malformed = migrateState({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        app: {
          preferences: {
            playHubOpenSound: "yes",
            retainedPreference: "keep"
          }
        }
      });
      const enabled = migrateState({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        app: {
          preferences: {
            playHubOpenSound: true
          }
        }
      });

      expect(missing.app.preferences.playHubOpenSound).toBe(false);
      expect(malformed.app.preferences.playHubOpenSound).toBe(false);
      expect(malformed.app.preferences.retainedPreference).toBe("keep");
      expect(enabled.app.preferences.playHubOpenSound).toBe(true);
    });

    it("accepts future schema versions as-is and only normalizes load-time UI state", () => {
      const migrated = migrateState({
        schemaVersion: CURRENT_SCHEMA_VERSION + 5,
        tracker: "future payload",
        ui: {
          dice: {
            history: ["stale"],
            last: { count: 8, sides: "5000", mod: 9, mode: "adv" }
          },
          calc: {
            history: ["1+1"]
          }
        }
      });

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 5);
      expect(migrated.tracker).toBe("future payload");
      expect(migrated.ui.dice.history).toEqual([]);
      expect(migrated.ui.dice.last).toEqual({
        count: 1,
        sides: 1000,
        mod: 0,
        mode: "adv"
      });
      expect(migrated.ui.calc.history).toEqual([]);
    });
  });

  describe("defaults and invariants", () => {
    it("fills missing optional buckets and nested arrays/objects without overwriting existing values", () => {
      const migrated = migrateState({
        tracker: {
          campaignTitle: "Vault 13"
        },
        character: {
          imgBlobId: "portrait_1",
          money: null,
          personality: "bad",
          resources: "bad",
          abilities: null,
          skills: null,
          ui: "bad",
          inventoryItems: [],
          activeInventoryIndex: 9,
          spells: {
            levels: "bad"
          }
        },
        map: {
          ui: {}
        },
        ui: {}
      });

      const entry = activeEntry(migrated);

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.tracker.campaignTitle).toBe("Vault 13");
      expectDefaultSingleSession(migrated.tracker.sessions);
      expect(migrated.tracker.ui.textareaHeights).toEqual({});
      expect(entry.imgBlobId).toBe("portrait_1");
      expect(entry.money).toEqual({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
      expect(entry.personality).toEqual({
        traits: "",
        ideals: "",
        bonds: "",
        flaws: "",
        notes: ""
      });
      expect(entry.resources).toEqual([]);
      expect(entry.abilities).toEqual({});
      expect(entry.skills).toEqual({});
      expect(entry.ui.textareaHeights).toEqual({});
      expect(entry.spells).toEqual({ levels: [] });
      expect(entry.inventoryItems).toEqual([
        expect.objectContaining({ id: expect.any(String), title: "Inventory", notes: "" })
      ]);
      expect(entry.activeInventoryIndex).toBe(0);
      expect(entry.inventorySearch).toBe("");
      expect(entry.hitDieAmt).toBeNull();
      expect(entry.hitDieSize).toBeNull();
      expect(migrated.map.maps).toEqual([]);
      expect(migrated.map.activeMapId).toBeNull();
      expect(migrated.map.ui).toEqual({ activeTool: "brush", brushSize: 6 });
      expect(migrated.ui).toEqual(
        expect.objectContaining({
          theme: "system",
          textareaHeights: {},
          panelCollapsed: {}
        })
      );
    });

    it("clamps activeInventoryIndex into the migrated inventory range", () => {
      const negativeIndex = migrateState({
        character: {
          inventoryItems: [{ title: "Inventory", notes: "A" }],
          activeInventoryIndex: -2
        }
      });
      const tooLargeIndex = migrateState({
        character: {
          inventoryItems: [
            { title: "Inventory", notes: "A" },
            { title: "Pack", notes: "B" }
          ],
          activeInventoryIndex: 99
        }
      });

      expect(activeEntry(negativeIndex).activeInventoryIndex).toBe(0);
      expect(activeEntry(tooLargeIndex).activeInventoryIndex).toBe(1);
    });

    it("preserves existing root ui.theme over legacy tracker theme duplicates", () => {
      const migrated = migrateState({
        tracker: {
          ui: {
            theme: "dark"
          }
        },
        ui: {
          theme: "light"
        }
      });

      expect(migrated.ui.theme).toBe("light");
    });

    it("removes legacy single-resource fields without duplicating an existing resources array", () => {
      const migrated = migrateState({
        character: {
          resources: [{ id: "r1", name: "Rage", cur: 1, max: 2 }],
          resourceName: "Ki",
          resourceCur: 2,
          resourceMax: 5
        }
      });

      const entry = activeEntry(migrated);

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(entry.resources).toEqual([{ id: "r1", name: "Rage", cur: 1, max: 2 }]);
      expect(migrated.combat).toEqual(DEFAULT_COMBAT_STATE);
      expect("resourceName" in entry).toBe(false);
      expect("resourceCur" in entry).toBe(false);
      expect("resourceMax" in entry).toBe(false);
    });

    it("drops empty legacy single-resource fields instead of creating a blank resource", () => {
      const migrated = migrateState({
        character: {
          resourceName: "",
          resourceCur: null,
          resourceMax: null
        }
      });

      // Character has no meaningful data, so no entry is created.
      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.characters).toEqual(EMPTY_CHARACTERS);
    });

    it("normalizes hit-die aliases to canonical hitDieAmt without dropping legacy saves", () => {
      const canonicalOnly = migrateState({
        character: {
          hitDieAmt: 4,
          hitDieSize: 8
        }
      });
      const legacyAliasOnly = migrateState({
        character: {
          hitDieAmount: 5,
          hitDieSize: 10
        }
      });
      const bothPresent = migrateState({
        character: {
          hitDieAmt: 6,
          hitDieAmount: 3,
          hitDieSize: 12
        }
      });

      expect(activeEntry(canonicalOnly).hitDieAmt).toBe(4);
      expect("hitDieAmount" in activeEntry(canonicalOnly)).toBe(false);
      expect(activeEntry(legacyAliasOnly).hitDieAmt).toBe(5);
      expect("hitDieAmount" in activeEntry(legacyAliasOnly)).toBe(false);
      expect(activeEntry(bothPresent).hitDieAmt).toBe(6);
      expect("hitDieAmount" in activeEntry(bothPresent)).toBe(false);
    });
  });

  describe("malformed and partial input", () => {
    it("falls back to a fresh migrated state for null, undefined, and primitive roots", () => {
      const inputs = [undefined, null, "broken save", 42];

      for (const input of inputs) {
        const migrated = migrateState(input);

        expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expectDefaultSingleSession(migrated.tracker.sessions);
        // No character data — collection should be empty.
        expect(migrated.characters).toEqual(EMPTY_CHARACTERS);
        expect(migrated.map).toMatchObject({
          activeMapId: null,
          maps: [],
          ui: { activeTool: "brush", brushSize: 6 }
        });
        expect(migrated.combat).toEqual(DEFAULT_COMBAT_STATE);
        expect(migrated.ui).toEqual(
          expect.objectContaining({
            theme: "system",
            textareaHeights: {},
            panelCollapsed: {}
          })
        );
      }
    });

    it("replaces primitive top-level buckets with migrated defaults", () => {
      const migrated = migrateState({
        tracker: "bad",
        character: 4,
        map: "bad",
        ui: "bad"
      });

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(Array.isArray(migrated.tracker)).toBe(false);
      expect(migrated.characters).toEqual(EMPTY_CHARACTERS);
      expect(Array.isArray(migrated.map)).toBe(false);
      expect(Array.isArray(migrated.ui)).toBe(false);
      expectDefaultSingleSession(migrated.tracker.sessions);
      expect(migrated.map.maps).toEqual([]);
      expect(migrated.combat).toEqual(DEFAULT_COMBAT_STATE);
      expect(migrated.ui.theme).toBe("system");
    });

    it("replaces array-valued top-level buckets with migrated object defaults", () => {
      const migrated = migrateState({
        tracker: [],
        character: [],
        map: [],
        ui: []
      });

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(Array.isArray(migrated.tracker)).toBe(false);
      expect(migrated.characters).toEqual(EMPTY_CHARACTERS);
      expect(Array.isArray(migrated.map)).toBe(false);
      expect(Array.isArray(migrated.ui)).toBe(false);
      expectDefaultSingleSession(migrated.tracker.sessions);
      expect(migrated.map.ui).toEqual({ activeTool: "brush", brushSize: 6 });
      expect(migrated.combat).toEqual(DEFAULT_COMBAT_STATE);
      expect(migrated.ui.theme).toBe("system");
      expect(migrated.ui.dice.history).toEqual([]);
      expect(migrated.ui.calc.history).toEqual([]);
    });

    it("repairs missing buckets and malformed nested defaults even when schemaVersion is already current", () => {
      const migrated = migrateState({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        tracker: {
          campaignTitle: "Vault 13"
        },
        character: {
          resources: null,
          ui: []
        },
        ui: {
          theme: "light"
        }
      });

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.tracker.campaignTitle).toBe("Vault 13");
      expectDefaultSingleSession(migrated.tracker.sessions);
      // Character has no meaningful data (resources null, ui array) — empty collection.
      expect(migrated.characters).toEqual(EMPTY_CHARACTERS);
      expect(migrated.map).toMatchObject({
        activeMapId: null,
        maps: [],
        ui: { activeTool: "brush", brushSize: 6 }
      });
      expect(migrated.combat).toEqual(DEFAULT_COMBAT_STATE);
      expect(migrated.ui).toEqual(
        expect.objectContaining({
          theme: "light",
          textareaHeights: {},
          panelCollapsed: {}
        })
      );
    });

    it("repairs current-schema inventory items with missing or duplicate ids", () => {
      const migrated = migrateState({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        characters: {
          activeId: "char_a",
          entries: [
            {
              id: "char_a",
              inventoryItems: [
                { id: "inv_alpha", title: "Alpha", notes: "A" },
                { title: "Bravo", notes: "B" },
                { id: "inv_alpha", title: "Charlie", notes: "C" }
              ],
              activeInventoryIndex: 2
            }
          ]
        }
      });

      const entry = activeEntry(migrated);
      expect(entry.inventoryItems).toHaveLength(3);
      expect(entry.inventoryItems[0].id).toBe("inv_alpha");
      expect(entry.inventoryItems[1].id).toEqual(expect.any(String));
      expect(entry.inventoryItems[1].id).not.toBe("inv_alpha");
      expect(entry.inventoryItems[2].id).toEqual(expect.any(String));
      expect(entry.inventoryItems[2].id).not.toBe("inv_alpha");
      expect(entry.inventoryItems[1].id).not.toBe(entry.inventoryItems[2].id);
      expect(entry.activeInventoryIndex).toBe(2);
    });

    it("repairs current-schema tracker sessions with missing or duplicate ids", () => {
      const migrated = migrateState({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        tracker: {
          sessions: [
            { id: "session_alpha", title: "Alpha", notes: "A" },
            { title: "Bravo", notes: "B" },
            { id: "session_alpha", title: "Charlie", notes: "C" }
          ],
          activeSessionIndex: 2
        }
      });

      expect(migrated.tracker.sessions).toHaveLength(3);
      expect(migrated.tracker.sessions[0]).toEqual(expect.objectContaining({
        id: "session_alpha",
        title: "Alpha",
        notes: "A"
      }));
      expect(migrated.tracker.sessions[1]).toEqual(expect.objectContaining({
        id: expect.any(String),
        title: "Bravo",
        notes: "B"
      }));
      expect(migrated.tracker.sessions[2]).toEqual(expect.objectContaining({
        id: expect.any(String),
        title: "Charlie",
        notes: "C"
      }));
      expect(migrated.tracker.sessions[1].id).not.toBe("session_alpha");
      expect(migrated.tracker.sessions[2].id).not.toBe("session_alpha");
      expect(migrated.tracker.sessions[1].id).not.toBe(migrated.tracker.sessions[2].id);
      expect(migrated.tracker.activeSessionIndex).toBe(2);
    });

    it("migrates legacy map.character even when sibling map fields are malformed", () => {
      const migrated = migrateState({
        map: {
          character: {
            equipment: "Rope"
          },
          maps: "bad",
          ui: "bad"
        }
      });

      const entry = activeEntry(migrated);

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.map.character).toBeUndefined();
      expect(entry.equipment).toBe("Rope");
      expect(entry.inventoryItems).toEqual([
        expect.objectContaining({ id: expect.any(String), title: "Inventory", notes: "Rope" })
      ]);
      expect(migrated.map.maps).toEqual([]);
      expect(migrated.map.ui).toEqual({ activeTool: "brush", brushSize: 6 });
      expect(migrated.combat).toEqual(DEFAULT_COMBAT_STATE);
    });

    it("resets malformed spells values to an empty v2 levels array", () => {
      const migrated = migrateState({
        character: {
          spells: "not an object"
        }
      });

      // Character has no meaningful data after spells reset — empty collection.
      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.characters).toEqual(EMPTY_CHARACTERS);
      expect(migrated.combat).toEqual(DEFAULT_COMBAT_STATE);
    });

    it("migrates legacy spell text while preserving NaN for non-numeric slot counts", () => {
      const migrated = migrateState({
        character: {
          spells: {
            cantrips: "Light",
            lvl1: { used: "abc", total: "5", list: "Shield" }
          }
        }
      });

      const entry = activeEntry(migrated);
      const [cantrips, level1] = entry.spells.levels;

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(cantrips.spells.map((spell) => spell.name)).toEqual(["Light"]);
      expect(Number.isNaN(level1.used)).toBe(true);
      expect(level1.total).toBe(5);
      expect(level1.spells.map((spell) => spell.name)).toEqual(["Shield"]);
    });

  });

  describe("stability", () => {
    it("is idempotent after a legacy save has been migrated once", () => {
      const legacy = {
        tracker: {
          ui: {
            theme: "dark"
          }
        },
        character: {
          equipment: "Rations",
          resourceName: "Ki",
          resourceCur: 1,
          resourceMax: 3,
          spells: {
            cantrips: "Light"
          }
        }
      };

      const migratedOnce = migrateState(cloneState(legacy));
      const migratedTwice = migrateState(cloneState(migratedOnce));

      expect(migratedTwice).toEqual(migratedOnce);
    });
  });
});
