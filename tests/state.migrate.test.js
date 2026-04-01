import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, migrateState } from "../js/state.js";

describe("migrateState", () => {
  it("migrates unversioned saves by creating required buckets and root UI defaults", () => {
    const migrated = migrateState({
      tracker: {
        ui: {
          textareaHeigts: { sessionNotes: 88 },
          theme: "dark"
        }
      }
    });

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.tracker.sessions).toEqual([{ title: "Session 1", notes: "" }]);
    expect(migrated.tracker.npcs).toEqual([]);
    expect(migrated.tracker.party).toEqual([]);
    expect(migrated.tracker.locationsList).toEqual([]);
    expect(migrated.tracker.campaignTitle).toBe("My Campaign");
    expect(migrated.tracker.activeSessionIndex).toBe(0);
    expect(migrated.tracker.ui.textareaHeights).toEqual({ sessionNotes: 88 });
    expect(migrated.map.maps).toEqual([]);
    expect(migrated.map.activeMapId).toBeNull();
    expect(migrated.map.ui).toMatchObject({ activeTool: "brush", brushSize: 6 });
    expect(migrated.ui).toEqual(
      expect.objectContaining({
        theme: "system",
        textareaHeights: {},
        panelCollapsed: {}
      })
    );
  });

  it("migrates legacy map.character data into character and seeds inventory from equipment", () => {
    const migrated = migrateState({
      map: {
        character: {
          equipment: "Rope and grappling hook",
          activeInventoryIndex: 4
        }
      }
    });

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.map.character).toBeUndefined();
    expect(migrated.character.equipment).toBe("Rope and grappling hook");
    expect(migrated.character.inventoryItems).toEqual([
      { title: "Inventory", notes: "Rope and grappling hook" }
    ]);
    expect(migrated.character.activeInventoryIndex).toBe(0);
    expect(migrated.character.inventorySearch).toBe("");
  });

  it("migrates legacy spell buckets into spells.levels", () => {
    const migrated = migrateState({
      character: {
        spells: {
          cantrips: "Light\nMage Hand",
          lvl1: { used: "1", total: "4", list: "Shield\nMagic Missile" },
          lvl2: { used: "", total: null, list: "Invisibility" },
          lvl3: {}
        }
      }
    });

    const [cantrips, level1, level2, level3] = migrated.character.spells.levels;

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.character.spells.levels).toHaveLength(4);
    expect(cantrips).toMatchObject({ label: "Cantrips", hasSlots: false });
    expect(cantrips.spells.map((spell) => spell.name)).toEqual(["Light", "Mage Hand"]);
    expect(level1).toMatchObject({ label: "1st Level", hasSlots: true, used: 1, total: 4 });
    expect(level1.spells.map((spell) => spell.name)).toEqual(["Shield", "Magic Missile"]);
    expect(level2).toMatchObject({ label: "2nd Level", used: null, total: null });
    expect(level2.spells.map((spell) => spell.name)).toEqual(["Invisibility"]);
    expect(level3).toMatchObject({ label: "3rd Level", used: null, total: null });
  });

  it("migrates legacy single-resource fields into the resources array", () => {
    const migrated = migrateState({
      character: {
        resourceName: "Ki",
        resourceCur: 2,
        resourceMax: 5
      }
    });

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.character.resources).toHaveLength(1);
    expect(migrated.character.resources[0]).toMatchObject({
      name: "Ki",
      cur: 2,
      max: 5
    });
    expect("resourceName" in migrated.character).toBe(false);
    expect("resourceCur" in migrated.character).toBe(false);
    expect("resourceMax" in migrated.character).toBe(false);
  });

  it("migrates schema v1 saves without inventoryItems into the v2 inventory structure", () => {
    const migrated = migrateState({
      schemaVersion: 1,
      character: {
        equipment: "Bedroll"
      }
    });

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.character.inventoryItems).toEqual([
      { title: "Inventory", notes: "Bedroll" }
    ]);
  });

  it("migrates schema v1 saves with blank inventory notes by copying legacy equipment once", () => {
    const migrated = migrateState({
      schemaVersion: 1,
      character: {
        equipment: "Lantern",
        inventoryItems: [{ title: "", notes: "" }]
      }
    });

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.character.inventoryItems).toEqual([
      { title: "Inventory", notes: "Lantern" }
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

  describe("defensive malformed-input coverage", () => {
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

    it("treats array-valued top-level buckets as objects and keeps them as arrays", () => {
      const migrated = migrateState({
        tracker: [],
        character: [],
        map: [],
        ui: []
      });

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(Array.isArray(migrated.tracker)).toBe(true);
      expect(Array.isArray(migrated.character)).toBe(true);
      expect(Array.isArray(migrated.map)).toBe(true);
      expect(Array.isArray(migrated.ui)).toBe(true);
      expect(migrated.tracker.sessions).toEqual([{ title: "Session 1", notes: "" }]);
      expect(migrated.character.inventoryItems).toEqual([{ title: "Inventory", notes: "" }]);
      expect(migrated.map.ui).toEqual({ activeTool: "brush", brushSize: 6 });
      expect(migrated.ui.theme).toBe("system");
      expect(migrated.ui.dice.history).toEqual([]);
      expect(migrated.ui.calc.history).toEqual([]);
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

    it("throws for schema v1 saves whose first inventory item is null when legacy equipment needs backfill", () => {
      expect(() => migrateState({
        schemaVersion: 1,
        character: {
          equipment: "Bedroll",
          inventoryItems: [null]
        }
      })).toThrow(TypeError);
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
});
