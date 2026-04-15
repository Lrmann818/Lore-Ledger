import { describe, expect, it } from "vitest";

import {
  EMBEDDED_PANEL_DEFS,
  EMBEDDED_PANEL_HOST_SELECTORS,
  addEmbeddedPanel,
  embeddedPanelDomId,
  getAvailableEmbeddedPanels,
  getSpellsEmbeddedViewModel,
  getVitalsEmbeddedViewModel,
  getWeaponsEmbeddedViewModel,
  moveEmbeddedPanel,
  removeEmbeddedPanel,
} from "../js/pages/combat/combatEmbeddedPanels.js";

// DOM render functions require a browser DOM and are covered by the
// Playwright smoke tests in tests/smoke/combatShell.smoke.js.

// ─── EMBEDDED_PANEL_DEFS ─────────────────────────────────────────────────────

describe("EMBEDDED_PANEL_DEFS", () => {
  it("defines the five supported panel ids in order", () => {
    expect(EMBEDDED_PANEL_DEFS.map((d) => d.id)).toEqual([
      "vitals", "spells", "weapons", "equipment", "abilities"
    ]);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(EMBEDDED_PANEL_DEFS)).toBe(true);
  });

  it("has a non-empty label for each panel", () => {
    for (const def of EMBEDDED_PANEL_DEFS) {
      expect(typeof def.label).toBe("string");
      expect(def.label.length).toBeGreaterThan(0);
    }
  });

  it("includes equipment and abilities definitions", () => {
    const ids = EMBEDDED_PANEL_DEFS.map((d) => d.id);
    expect(ids).toContain("equipment");
    expect(ids).toContain("abilities");
  });
});

describe("EMBEDDED_PANEL_HOST_SELECTORS", () => {
  it("defines scoped source-panel hosts for all five panels", () => {
    expect(Object.keys(EMBEDDED_PANEL_HOST_SELECTORS)).toEqual([
      "vitals", "spells", "weapons", "equipment", "abilities"
    ]);
  });

  it("uses combat-scoped selectors for vitals, spells, and weapons outer elements", () => {
    expect(EMBEDDED_PANEL_HOST_SELECTORS.vitals.panelEl).toBe("#combatEmbeddedVitalsSource");
    expect(EMBEDDED_PANEL_HOST_SELECTORS.spells.containerEl).toBe("#combatEmbeddedSpellLevels");
    expect(EMBEDDED_PANEL_HOST_SELECTORS.weapons.listEl).toBe("#combatEmbeddedAttackList");
  });

  it("uses a combat-scoped panelEl for the equipment selector", () => {
    expect(EMBEDDED_PANEL_HOST_SELECTORS.equipment.panelEl).toBe("#combatEmbeddedEquipmentSource");
  });

  it("uses combat-scoped panel + abilityGrid selectors for abilities", () => {
    expect(EMBEDDED_PANEL_HOST_SELECTORS.abilities.panel).toBe("#combatEmbeddedAbilitiesSource");
    expect(EMBEDDED_PANEL_HOST_SELECTORS.abilities.abilityGrid).toBe("#combatEmbeddedAbilitiesSource .abilityGrid");
  });

  it("does not reference character-page global ids in any selector", () => {
    const allSelectors = Object.values(EMBEDDED_PANEL_HOST_SELECTORS)
      .flatMap((s) => Object.values(s));
    expect(allSelectors).not.toContain("#charVitalsPanel");
    expect(allSelectors).not.toContain("#charSpellsPanel");
    expect(allSelectors).not.toContain("#charAttacksPanel");
    expect(allSelectors).not.toContain("#charEquipmentPanel");
    expect(allSelectors).not.toContain("#charAbilitiesPanel");
  });
});

// ─── getAvailableEmbeddedPanels ──────────────────────────────────────────────

describe("getAvailableEmbeddedPanels", () => {
  it("returns all five panels when none are active", () => {
    expect(getAvailableEmbeddedPanels([])).toHaveLength(5);
  });

  it("excludes panels already in the active list", () => {
    const available = getAvailableEmbeddedPanels(["vitals"]);
    expect(available.map((d) => d.id)).toEqual(["spells", "weapons", "equipment", "abilities"]);
  });

  it("excludes the new equipment and abilities panels when active", () => {
    const available = getAvailableEmbeddedPanels(["equipment", "abilities"]);
    expect(available.map((d) => d.id)).toEqual(["vitals", "spells", "weapons"]);
  });

  it("excludes multiple active panels", () => {
    const available = getAvailableEmbeddedPanels(["spells", "weapons"]);
    expect(available.map((d) => d.id)).toEqual(["vitals", "equipment", "abilities"]);
  });

  it("returns empty when all five panels are active", () => {
    expect(getAvailableEmbeddedPanels(["vitals", "spells", "weapons", "equipment", "abilities"])).toHaveLength(0);
  });

  it("handles null safely", () => {
    expect(getAvailableEmbeddedPanels(/** @type {any} */ (null))).toHaveLength(5);
  });

  it("ignores unknown ids in activeIds without masking valid panels", () => {
    const available = getAvailableEmbeddedPanels(["notes", "inventory"]);
    expect(available).toHaveLength(5);
  });
});

// ─── addEmbeddedPanel ────────────────────────────────────────────────────────

describe("addEmbeddedPanel", () => {
  it("adds a valid panel id to an empty array", () => {
    const arr = [];
    expect(addEmbeddedPanel(arr, "vitals")).toBe(true);
    expect(arr).toEqual(["vitals"]);
  });

  it("adds equipment and abilities panel ids", () => {
    const arr = [];
    expect(addEmbeddedPanel(arr, "equipment")).toBe(true);
    expect(addEmbeddedPanel(arr, "abilities")).toBe(true);
    expect(arr).toEqual(["equipment", "abilities"]);
  });

  it("adds all five panels sequentially", () => {
    const arr = [];
    ["vitals", "spells", "weapons", "equipment", "abilities"].forEach((id) => {
      expect(addEmbeddedPanel(arr, id)).toBe(true);
    });
    expect(arr).toEqual(["vitals", "spells", "weapons", "equipment", "abilities"]);
  });

  it("prevents adding a duplicate panel id", () => {
    const arr = ["vitals"];
    expect(addEmbeddedPanel(arr, "vitals")).toBe(false);
    expect(arr).toEqual(["vitals"]);
  });

  it("rejects unknown panel ids", () => {
    const arr = [];
    expect(addEmbeddedPanel(arr, "notes")).toBe(false);
    expect(addEmbeddedPanel(arr, "inventory")).toBe(false);
    expect(addEmbeddedPanel(arr, "")).toBe(false);
    expect(arr).toHaveLength(0);
  });

  it("does not add once all five are already active", () => {
    const arr = ["vitals", "spells", "weapons", "equipment", "abilities"];
    expect(addEmbeddedPanel(arr, "vitals")).toBe(false);
    expect(arr).toHaveLength(5);
  });
});

// ─── removeEmbeddedPanel ─────────────────────────────────────────────────────

describe("removeEmbeddedPanel", () => {
  it("removes an existing panel id", () => {
    const arr = ["vitals", "spells"];
    expect(removeEmbeddedPanel(arr, "vitals")).toBe(true);
    expect(arr).toEqual(["spells"]);
  });

  it("removes equipment and abilities panel ids", () => {
    const arr = ["vitals", "equipment", "abilities"];
    expect(removeEmbeddedPanel(arr, "equipment")).toBe(true);
    expect(arr).toEqual(["vitals", "abilities"]);
    expect(removeEmbeddedPanel(arr, "abilities")).toBe(true);
    expect(arr).toEqual(["vitals"]);
  });

  it("removes the middle element correctly", () => {
    const arr = ["vitals", "spells", "weapons"];
    expect(removeEmbeddedPanel(arr, "spells")).toBe(true);
    expect(arr).toEqual(["vitals", "weapons"]);
  });

  it("returns false when id is not in the array", () => {
    const arr = ["spells"];
    expect(removeEmbeddedPanel(arr, "vitals")).toBe(false);
    expect(arr).toEqual(["spells"]);
  });

  it("returns false for an empty array", () => {
    expect(removeEmbeddedPanel([], "vitals")).toBe(false);
  });

  it("allows re-adding after removal (round-trip)", () => {
    const arr = ["vitals"];
    removeEmbeddedPanel(arr, "vitals");
    expect(addEmbeddedPanel(arr, "vitals")).toBe(true);
    expect(arr).toEqual(["vitals"]);
  });

  it("remove then re-add works for equipment and abilities", () => {
    const arr = ["equipment", "abilities"];
    removeEmbeddedPanel(arr, "equipment");
    removeEmbeddedPanel(arr, "abilities");
    expect(addEmbeddedPanel(arr, "equipment")).toBe(true);
    expect(addEmbeddedPanel(arr, "abilities")).toBe(true);
    expect(arr).toEqual(["equipment", "abilities"]);
  });
});

// ─── moveEmbeddedPanel ───────────────────────────────────────────────────────

describe("moveEmbeddedPanel", () => {
  it("reorders embedded panels in the persisted embeddedPanels array", () => {
    const arr = ["vitals", "spells", "weapons"];
    expect(moveEmbeddedPanel(arr, "weapons", -1)).toBe(true);
    expect(arr).toEqual(["vitals", "weapons", "spells"]);

    expect(moveEmbeddedPanel(arr, "vitals", 1)).toBe(true);
    expect(arr).toEqual(["weapons", "vitals", "spells"]);
  });

  it("reorders equipment and abilities panels", () => {
    const arr = ["vitals", "equipment", "abilities"];
    expect(moveEmbeddedPanel(arr, "abilities", -1)).toBe(true);
    expect(arr).toEqual(["vitals", "abilities", "equipment"]);
  });

  it("does not move unknown panels or move past the list bounds", () => {
    const arr = ["vitals", "spells"];
    expect(moveEmbeddedPanel(arr, "vitals", -1)).toBe(false);
    expect(moveEmbeddedPanel(arr, "spells", 1)).toBe(false);
    expect(moveEmbeddedPanel(arr, "notes", 1)).toBe(false);
    expect(arr).toEqual(["vitals", "spells"]);
  });
});

// ─── embeddedPanelDomId ──────────────────────────────────────────────────────

describe("embeddedPanelDomId", () => {
  it("prefixes with combatEmbeddedPanel_ for all five panels", () => {
    expect(embeddedPanelDomId("vitals")).toBe("combatEmbeddedPanel_vitals");
    expect(embeddedPanelDomId("spells")).toBe("combatEmbeddedPanel_spells");
    expect(embeddedPanelDomId("weapons")).toBe("combatEmbeddedPanel_weapons");
    expect(embeddedPanelDomId("equipment")).toBe("combatEmbeddedPanel_equipment");
    expect(embeddedPanelDomId("abilities")).toBe("combatEmbeddedPanel_abilities");
  });
});

/** Creates a minimal state with an active character entry for view model tests. */
function makeStateWithChar(charData) {
  return { characters: { activeId: "char_test", entries: [{ id: "char_test", ...charData }] } };
}

// ─── getVitalsEmbeddedViewModel ──────────────────────────────────────────────

describe("getVitalsEmbeddedViewModel", () => {
  it("returns safe defaults from completely empty state", () => {
    const vm = getVitalsEmbeddedViewModel({});
    expect(vm.hp).toBe("—");
    expect(vm.hpMax).toBe("—");
    expect(vm.ac).toBeNull();
    expect(vm.initiative).toBeNull();
    expect(vm.speed).toBeNull();
    expect(vm.proficiency).toBeNull();
    expect(vm.spellAttack).toBeNull();
    expect(vm.spellDC).toBeNull();
    expect(vm.resources).toEqual([]);
  });

  it("reads all numeric stat fields from the active character", () => {
    const state = makeStateWithChar({
      hpCur: 8,
      hpMax: 12,
      ac: 15,
      initiative: 3,
      speed: 30,
      proficiency: 4,
      spellAttack: 7,
      spellDC: 15,
      resources: []
    });
    const vm = getVitalsEmbeddedViewModel(state);
    expect(vm.hp).toBe("8");
    expect(vm.hpMax).toBe("12");
    expect(vm.ac).toBe("15");
    expect(vm.initiative).toBe("3");
    expect(vm.speed).toBe("30");
    expect(vm.proficiency).toBe("4");
    expect(vm.spellAttack).toBe("7");
    expect(vm.spellDC).toBe("15");
  });

  it("converts zero values to strings (does not treat 0 as null)", () => {
    const vm = getVitalsEmbeddedViewModel(makeStateWithChar({ hpCur: 0, hpMax: 10, ac: 0 }));
    expect(vm.hp).toBe("0");
    expect(vm.ac).toBe("0");
  });

  it("maps resources correctly", () => {
    const state = makeStateWithChar({
      hpCur: 5, hpMax: 10,
      resources: [
        { id: "res_1", name: "Ki", cur: 3, max: 5 },
        { id: "res_2", name: "", cur: null, max: null }
      ]
    });
    const vm = getVitalsEmbeddedViewModel(state);
    expect(vm.resources).toEqual([
      { name: "Ki", cur: "3", max: "5" },
      { name: "", cur: "—", max: "—" }
    ]);
  });

  it("handles null, undefined, and missing character defensively", () => {
    expect(() => getVitalsEmbeddedViewModel(null)).not.toThrow();
    expect(() => getVitalsEmbeddedViewModel(undefined)).not.toThrow();
    expect(() => getVitalsEmbeddedViewModel({})).not.toThrow();
    const vm = getVitalsEmbeddedViewModel({});
    expect(vm.hp).toBe("—");
    expect(vm.resources).toEqual([]);
  });
});

// ─── getSpellsEmbeddedViewModel ──────────────────────────────────────────────

describe("getSpellsEmbeddedViewModel", () => {
  it("returns empty levels from state with no spells", () => {
    expect(getSpellsEmbeddedViewModel({}).levels).toEqual([]);
  });

  it("returns empty levels when spells object is missing levels", () => {
    expect(getSpellsEmbeddedViewModel(makeStateWithChar({ spells: {} })).levels).toEqual([]);
  });

  it("maps a spell level and its spells", () => {
    const state = makeStateWithChar({
      spells: {
        levels: [
          {
            id: "lvl_1",
            label: "1st Level",
            hasSlots: true,
            used: 1,
            total: 3,
            collapsed: false,
            spells: [
              { id: "sp_1", name: "Magic Missile", known: true, prepared: true, expended: false },
              { id: "sp_2", name: "Shield", known: true, prepared: false, expended: true }
            ]
          }
        ]
      }
    });
    const vm = getSpellsEmbeddedViewModel(state);
    expect(vm.levels).toHaveLength(1);
    expect(vm.levels[0]).toEqual({
      id: "lvl_1",
      label: "1st Level",
      hasSlots: true,
      used: "1",
      total: "3",
      collapsed: false,
      spells: [
        { id: "sp_1", name: "Magic Missile", known: true, prepared: true, expended: false },
        { id: "sp_2", name: "Shield", known: true, prepared: false, expended: true }
      ]
    });
  });

  it("renders null slots as dashes", () => {
    const state = makeStateWithChar({
      spells: {
        levels: [{
          id: "l1", label: "Cantrips", hasSlots: false,
          used: null, total: null, collapsed: false, spells: []
        }]
      }
    });
    const vm = getSpellsEmbeddedViewModel(state);
    expect(vm.levels[0].used).toBe("—");
    expect(vm.levels[0].total).toBe("—");
  });

  it("defaults known to true when missing", () => {
    const state = makeStateWithChar({
      spells: { levels: [{ id: "l1", label: "1st", hasSlots: true, collapsed: false, spells: [{ id: "sp_1", name: "Foo" }] }] }
    });
    const vm = getSpellsEmbeddedViewModel(state);
    expect(vm.levels[0].spells[0].known).toBe(true);
  });

  it("handles null/undefined state defensively", () => {
    expect(() => getSpellsEmbeddedViewModel(null)).not.toThrow();
    expect(getSpellsEmbeddedViewModel(null).levels).toEqual([]);
  });
});

// ─── getWeaponsEmbeddedViewModel ─────────────────────────────────────────────

describe("getWeaponsEmbeddedViewModel", () => {
  it("returns empty attacks from state with no weapons", () => {
    expect(getWeaponsEmbeddedViewModel({}).attacks).toEqual([]);
  });

  it("maps weapons from the active character's attacks", () => {
    const state = makeStateWithChar({
      attacks: [
        { id: "atk_1", name: "Dagger", bonus: "+5", damage: "1d4+3", range: "20/60", type: "Piercing" }
      ]
    });
    const vm = getWeaponsEmbeddedViewModel(state);
    expect(vm.attacks).toEqual([
      { id: "atk_1", name: "Dagger", bonus: "+5", damage: "1d4+3", range: "20/60", type: "Piercing" }
    ]);
  });

  it("handles malformed attack entries defensively", () => {
    const state = makeStateWithChar({
      attacks: [null, undefined, {}, { id: "atk_2", name: "Sword" }]
    });
    const vm = getWeaponsEmbeddedViewModel(state);
    expect(vm.attacks).toHaveLength(4);
    expect(vm.attacks[0]).toEqual({ id: "", name: "", bonus: "", damage: "", range: "", type: "" });
    expect(vm.attacks[3]).toEqual({ id: "atk_2", name: "Sword", bonus: "", damage: "", range: "", type: "" });
  });

  it("handles null/undefined state defensively", () => {
    expect(() => getWeaponsEmbeddedViewModel(null)).not.toThrow();
    expect(getWeaponsEmbeddedViewModel(null).attacks).toEqual([]);
  });
});
