import { describe, expect, it } from "vitest";

import { backfillInventoryItemsFromLegacyEquipment, CURRENT_SCHEMA_VERSION, migrateState } from "../js/state.js";

function cloneState(value) {
  return structuredClone(value);
}

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

      const [cantrips, level1, level2, level3] = migrated.character.spells.levels;

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.map.character).toBeUndefined();
      expect(migrated.character.equipment).toBe("Rope and grappling hook");
      expect(migrated.character.inventoryItems).toEqual([
        { title: "Inventory", notes: "Rope and grappling hook" }
      ]);
      expect(migrated.tracker.sessions).toEqual([{ title: "Session 1", notes: "" }]);
      expect(migrated.tracker.npcs).toEqual([]);
      expect(migrated.tracker.party).toEqual([]);
      expect(migrated.tracker.locationsList).toEqual([]);
      expect(migrated.tracker.campaignTitle).toBe("My Campaign");
      expect(migrated.tracker.activeSessionIndex).toBe(0);
      expect(migrated.tracker.ui.textareaHeights).toEqual({ sessionNotes: 88 });
      expect(migrated.character.resources).toHaveLength(1);
      expect(migrated.character.resources[0]).toMatchObject({
        name: "Ki",
        cur: 2,
        max: 5
      });
      expect("resourceName" in migrated.character).toBe(false);
      expect("resourceCur" in migrated.character).toBe(false);
      expect("resourceMax" in migrated.character).toBe(false);
      expect(migrated.character.spells.levels).toHaveLength(4);
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
      expect(malformedVersion.character.inventoryItems).toEqual([
        { title: "Inventory", notes: "Bedroll" }
      ]);
      expect(negativeVersion.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(negativeVersion.character.inventoryItems).toEqual([
        { title: "Inventory", notes: "Lantern" }
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
      expect(missingInventory.character.inventoryItems).toEqual([
        { title: "Inventory", notes: "Bedroll" }
      ]);
      expect(blankNotes.character.inventoryItems).toEqual([
        { title: "Inventory", notes: "Lantern" }
      ]);
      expect(fractionalVersion.character.inventoryItems).toEqual([
        { title: "Inventory", notes: "Tinderbox" }
      ]);
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
      expect(migrated.character.inventoryItems).toEqual([
        { title: "Inventory", notes: "Pack" }
      ]);
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

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.tracker.campaignTitle).toBe("Vault 13");
      expect(migrated.tracker.sessions).toEqual([{ title: "Session 1", notes: "" }]);
      expect(migrated.tracker.ui.textareaHeights).toEqual({});
      expect(migrated.character.imgBlobId).toBe("portrait_1");
      expect(migrated.character.money).toEqual({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
      expect(migrated.character.personality).toEqual({
        traits: "",
        ideals: "",
        bonds: "",
        flaws: "",
        notes: ""
      });
      expect(migrated.character.resources).toEqual([]);
      expect(migrated.character.abilities).toEqual({});
      expect(migrated.character.skills).toEqual({});
      expect(migrated.character.ui.textareaHeights).toEqual({});
      expect(migrated.character.spells).toEqual({ levels: [] });
      expect(migrated.character.inventoryItems).toEqual([{ title: "Inventory", notes: "" }]);
      expect(migrated.character.activeInventoryIndex).toBe(0);
      expect(migrated.character.inventorySearch).toBe("");
      expect(migrated.character.hitDieAmt).toBeNull();
      expect(migrated.character.hitDieSize).toBeNull();
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

      expect(negativeIndex.character.activeInventoryIndex).toBe(0);
      expect(tooLargeIndex.character.activeInventoryIndex).toBe(1);
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

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.character.resources).toEqual([{ id: "r1", name: "Rage", cur: 1, max: 2 }]);
      expect("resourceName" in migrated.character).toBe(false);
      expect("resourceCur" in migrated.character).toBe(false);
      expect("resourceMax" in migrated.character).toBe(false);
    });

    it("drops empty legacy single-resource fields instead of creating a blank resource", () => {
      const migrated = migrateState({
        character: {
          resourceName: "",
          resourceCur: null,
          resourceMax: null
        }
      });

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.character.resources).toEqual([]);
      expect("resourceName" in migrated.character).toBe(false);
      expect("resourceCur" in migrated.character).toBe(false);
      expect("resourceMax" in migrated.character).toBe(false);
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

      expect(canonicalOnly.character.hitDieAmt).toBe(4);
      expect("hitDieAmount" in canonicalOnly.character).toBe(false);
      expect(legacyAliasOnly.character.hitDieAmt).toBe(5);
      expect("hitDieAmount" in legacyAliasOnly.character).toBe(false);
      expect(bothPresent.character.hitDieAmt).toBe(6);
      expect("hitDieAmount" in bothPresent.character).toBe(false);
    });
  });

  describe("malformed and partial input", () => {
    it("falls back to a fresh migrated state for null, undefined, and primitive roots", () => {
      const inputs = [undefined, null, "broken save", 42];

      for (const input of inputs) {
        const migrated = migrateState(input);

        expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(migrated.tracker.sessions).toEqual([{ title: "Session 1", notes: "" }]);
        expect(migrated.character.inventoryItems).toEqual([{ title: "Inventory", notes: "" }]);
        expect(migrated.character.spells).toEqual({ levels: [] });
        expect(migrated.map).toMatchObject({
          activeMapId: null,
          maps: [],
          ui: { activeTool: "brush", brushSize: 6 }
        });
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
      expect(Array.isArray(migrated.character)).toBe(false);
      expect(Array.isArray(migrated.map)).toBe(false);
      expect(Array.isArray(migrated.ui)).toBe(false);
      expect(migrated.tracker.sessions).toEqual([{ title: "Session 1", notes: "" }]);
      expect(migrated.character.inventoryItems).toEqual([{ title: "Inventory", notes: "" }]);
      expect(migrated.map.maps).toEqual([]);
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
      expect(Array.isArray(migrated.character)).toBe(false);
      expect(Array.isArray(migrated.map)).toBe(false);
      expect(Array.isArray(migrated.ui)).toBe(false);
      expect(migrated.tracker.sessions).toEqual([{ title: "Session 1", notes: "" }]);
      expect(migrated.character.inventoryItems).toEqual([{ title: "Inventory", notes: "" }]);
      expect(migrated.map.ui).toEqual({ activeTool: "brush", brushSize: 6 });
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
      expect(migrated.tracker.sessions).toEqual([{ title: "Session 1", notes: "" }]);
      expect(migrated.character.resources).toEqual([]);
      expect(migrated.character.ui.textareaHeights).toEqual({});
      expect(migrated.map).toMatchObject({
        activeMapId: null,
        maps: [],
        ui: { activeTool: "brush", brushSize: 6 }
      });
      expect(migrated.ui).toEqual(
        expect.objectContaining({
          theme: "light",
          textareaHeights: {},
          panelCollapsed: {}
        })
      );
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

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.map.character).toBeUndefined();
      expect(migrated.character.equipment).toBe("Rope");
      expect(migrated.character.inventoryItems).toEqual([{ title: "Inventory", notes: "Rope" }]);
      expect(migrated.map.maps).toEqual([]);
      expect(migrated.map.ui).toEqual({ activeTool: "brush", brushSize: 6 });
    });

    it("resets malformed spells values to an empty v2 levels array", () => {
      const migrated = migrateState({
        character: {
          spells: "not an object"
        }
      });

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.character.spells).toEqual({ levels: [] });
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

      const [cantrips, level1] = migrated.character.spells.levels;

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
