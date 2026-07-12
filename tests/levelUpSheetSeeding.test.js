// Level Up sheet patching: getLevelUpSheetSeedPatch() applies exactly the
// documented level-up deltas (accumulate HP/slots, recompute-if-untouched
// AC/DC/attack, additive duplicate-aware content) and never touches
// user-owned play-state.
import { describe, expect, it } from "vitest";

import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { getLevelUpSheetSeedPatch } from "../js/domain/builderSheetSeeding.js";
import { BUILTIN_CONTENT_REGISTRY } from "../js/domain/rules/registry.js";

const registry = BUILTIN_CONTENT_REGISTRY;

function levelsOf(...classIds) {
  return classIds.map((classId) => ({ classId, hp: null }));
}

function makeCharacter({
  levels = levelsOf("fighter"),
  base = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  raceId = "human",
  subclassByClass = {},
  choicesByLevel = {},
  spellcasting = {},
  sheet = {}
} = {}) {
  const character = makeDefaultBuilderCharacterEntry("Level Up Mira");
  character.build.raceId = raceId;
  character.build.backgroundId = "acolyte";
  character.build.levels = levels;
  character.build.subclassByClass = subclassByClass;
  character.build.choicesByLevel = choicesByLevel;
  character.build.spellcasting = spellcasting;
  character.build.abilities.base = { ...base };
  Object.assign(character, sheet);
  return character;
}

/** Clones `before` and appends one level (plus optional draft changes). */
function withAppendedLevel(before, classId, { hp = null, mutateBuild } = {}) {
  const after = JSON.parse(JSON.stringify(before));
  after.build.levels.push({ classId, hp });
  if (mutateBuild) mutateBuild(after.build);
  return after;
}

describe("HP accumulate policy", () => {
  // Human Fighter, base Con 13 (+1 human = 14, mod +2).
  // L1 = 10 + 2 = 12; each later level averages 6 + 2 = 8.

  it("raises hpMax and hpCur by the derived delta", () => {
    const before = makeCharacter({ sheet: { hpMax: 12, hpCur: 12 } });
    const after = withAppendedLevel(before, "fighter");
    const { patch, warnings } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.hpMax).toBe(20);
    expect(patch.hpCur).toBe(20);
    expect(warnings).toEqual([]);
  });

  it("keeps a wounded character wounded (same gap)", () => {
    const before = makeCharacter({ sheet: { hpMax: 12, hpCur: 5 } });
    const after = withAppendedLevel(before, "fighter");
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.hpMax).toBe(20);
    expect(patch.hpCur).toBe(13);
  });

  it("preserves a manual hpMax offset (99 becomes 99 + delta)", () => {
    const before = makeCharacter({ sheet: { hpMax: 99, hpCur: 99 } });
    const after = withAppendedLevel(before, "fighter");
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.hpMax).toBe(107);
    expect(patch.hpCur).toBe(107);
  });

  it("uses the recorded roll instead of the average", () => {
    const before = makeCharacter({ sheet: { hpMax: 12, hpCur: 12 } });
    const after = withAppendedLevel(before, "fighter", { hp: 10 });
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.hpMax).toBe(24); // 12 + (10 + 2)
  });

  it("applies a retroactive Constitution increase across all levels", () => {
    const before = makeCharacter({
      levels: levelsOf("fighter", "fighter", "fighter"),
      sheet: { hpMax: 28, hpCur: 28 } // 10+6+6 + 3×2
    });
    const after = withAppendedLevel(before, "fighter", {
      mutateBuild: (build) => {
        build.choicesByLevel["4"] = { "asi-4": { type: "asi", increases: { con: 2 } } };
      }
    });
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    // Con 14 → 16 (+2 → +3): after = 10+6+6+6 + 4×3 = 40; delta 12.
    expect(patch.hpMax).toBe(40);
    expect(patch.hpCur).toBe(40);
  });

  it("skips the HP patch and warns when Constitution is missing", () => {
    const before = makeCharacter({
      base: { str: 15 }, // no con
      sheet: { hpMax: 12, hpCur: 12 }
    });
    const after = withAppendedLevel(before, "fighter");
    const { patch, warnings } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.hpMax).toBeUndefined();
    expect(patch.hpCur).toBeUndefined();
    expect(warnings.join(" ")).toContain("Constitution");
  });

  it("leaves an untracked hpCur untracked when hpMax accumulates", () => {
    const before = makeCharacter({ sheet: { hpMax: 12, hpCur: null } });
    const after = withAppendedLevel(before, "fighter");
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.hpMax).toBe(20);
    expect(patch.hpCur).toBeUndefined();
  });
});

describe("AC / Spell DC / Spell Attack recompute-if-untouched", () => {
  it("updates AC when the stored value matches derived-before", () => {
    // Dex 14 (+1 human = 15, +2): unarmored AC 12. Dex ASI +2 → 16/17? No —
    // Dex 15 → 17 (+3): AC 13.
    const before = makeCharacter({
      levels: levelsOf("fighter", "fighter", "fighter"),
      subclassByClass: { fighter: "champion" },
      sheet: { ac: 12 }
    });
    const after = withAppendedLevel(before, "fighter", {
      mutateBuild: (build) => {
        build.choicesByLevel["4"] = { "asi-4": { type: "asi", increases: { dex: 2 } } };
      }
    });
    const { patch, preserved } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.ac).toBe(13);
    expect(preserved).toEqual([]);
  });

  it("preserves a diverged manual AC and reports it", () => {
    const before = makeCharacter({
      levels: levelsOf("fighter", "fighter", "fighter"),
      subclassByClass: { fighter: "champion" },
      sheet: { ac: 18 }
    });
    const after = withAppendedLevel(before, "fighter", {
      mutateBuild: (build) => {
        build.choicesByLevel["4"] = { "asi-4": { type: "asi", increases: { dex: 2 } } };
      }
    });
    const { patch, preserved } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.ac).toBeUndefined();
    expect(preserved).toContain("Armor Class 18 — manual value kept");
  });

  it("updates spellDC/spellAttack across a proficiency threshold when untouched", () => {
    // Wizard, Int 15 (+1 human = 16, +3). Level 4 → 5: prof 2 → 3.
    const before = makeCharacter({
      levels: levelsOf("wizard", "wizard", "wizard", "wizard"),
      base: { str: 8, dex: 14, con: 13, int: 15, wis: 10, cha: 10 },
      subclassByClass: { wizard: "evocation" },
      sheet: { spellDC: 13, spellAttack: 5 }
    });
    const after = withAppendedLevel(before, "wizard");
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.spellDC).toBe(14);
    expect(patch.spellAttack).toBe(6);
  });

  it("preserves diverged spellDC/spellAttack and reports them", () => {
    const before = makeCharacter({
      levels: levelsOf("wizard", "wizard", "wizard", "wizard"),
      base: { str: 8, dex: 14, con: 13, int: 15, wis: 10, cha: 10 },
      subclassByClass: { wizard: "evocation" },
      sheet: { spellDC: 17, spellAttack: 9 }
    });
    const after = withAppendedLevel(before, "wizard");
    const { patch, preserved } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.spellDC).toBeUndefined();
    expect(patch.spellAttack).toBeUndefined();
    expect(preserved).toContain("Spell Save DC 17 — manual value kept");
    expect(preserved).toContain("Spell Attack 9 — manual value kept");
  });
});

describe("spell slot growth", () => {
  function wizardSheetSpells({ used, total }) {
    return {
      levels: [
        {
          id: "lvl1", label: "1st Level", hasSlots: true, used, total,
          collapsed: false, spells: []
        }
      ]
    };
  }

  it("grows total and available by the delta without refilling spent slots", () => {
    // Wizard 2 → 3: 1st-level slots 3 → 4; 2nd-level slots 0 → 2.
    const before = makeCharacter({
      levels: levelsOf("wizard", "wizard"),
      base: { str: 8, dex: 14, con: 13, int: 15, wis: 10, cha: 10 },
      sheet: { spells: wizardSheetSpells({ used: 1, total: 3 }) } // 2 spent
    });
    const after = withAppendedLevel(before, "wizard");
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    const first = patch.spells.levels.find((level) => level.label === "1st Level");
    expect(first.total).toBe(4);
    expect(first.used).toBe(2); // still 2 spent
    const second = patch.spells.levels.find((level) => level.label === "2nd Level");
    expect(second.total).toBe(2);
    expect(second.used).toBe(2); // brand-new capacity arrives available
  });

  it("keeps a fully spent row fully spent", () => {
    const before = makeCharacter({
      levels: levelsOf("wizard", "wizard"),
      base: { str: 8, dex: 14, con: 13, int: 15, wis: 10, cha: 10 },
      sheet: { spells: wizardSheetSpells({ used: 0, total: 3 }) }
    });
    const after = withAppendedLevel(before, "wizard");
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    const first = patch.spells.levels.find((level) => level.label === "1st Level");
    expect(first.total).toBe(4);
    expect(first.used).toBe(1); // only the newly gained slot is available
  });

  it("grows Pact Magic slots separately from standard slots", () => {
    // Warlock 1 → 2: pact 1 → 2 slots at slot level 1.
    const before = makeCharacter({
      levels: levelsOf("warlock"),
      base: { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 15 },
      sheet: {
        spells: {
          levels: [
            { id: "pact", label: "Pact Magic (1st Level)", hasSlots: true, used: 0, total: 1, collapsed: false, spells: [] }
          ]
        }
      }
    });
    const after = withAppendedLevel(before, "warlock");
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    const pact = patch.spells.levels.find((level) => String(level.label).includes("Pact"));
    expect(pact.total).toBe(2);
    expect(pact.used).toBe(1); // the spent slot stays spent
  });

  it("moves the Pact Magic row to the new slot level label", () => {
    // Warlock 2 → 3: still 2 slots, but slot level 1 → 2.
    const before = makeCharacter({
      levels: levelsOf("warlock", "warlock"),
      base: { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 15 },
      sheet: {
        spells: {
          levels: [
            { id: "pact", label: "Pact Magic (1st Level)", hasSlots: true, used: 2, total: 2, collapsed: false, spells: [] }
          ]
        }
      }
    });
    const after = withAppendedLevel(before, "warlock");
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    const pact = patch.spells.levels.find((level) => String(level.label).includes("Pact"));
    expect(pact.label).toBe("Pact Magic (2nd Level)");
    expect(pact.total).toBe(2);
    expect(pact.used).toBe(2);
  });
});

describe("additive spell and feature content", () => {
  it("appends newly known spells without deleting existing rows", () => {
    const before = makeCharacter({
      levels: levelsOf("bard"),
      base: { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 15 },
      spellcasting: { bard: { cantripIds: [], knownIds: ["cure-wounds"], preparedIds: [] } },
      sheet: {
        spells: {
          levels: [
            {
              id: "lvl1", label: "1st Level", hasSlots: true, used: 2, total: 2, collapsed: false,
              spells: [
                { id: "s1", name: "Cure Wounds", notesCollapsed: true, known: true, prepared: false, expended: false, builderSpellId: "cure-wounds" },
                { id: "s2", name: "My Homebrew Zap", notesCollapsed: false, known: true, prepared: true, expended: true }
              ]
            }
          ]
        }
      }
    });
    const after = withAppendedLevel(before, "bard", {
      mutateBuild: (build) => {
        build.spellcasting.bard.knownIds.push("healing-word");
      }
    });
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    const first = patch.spells.levels.find((level) => level.label === "1st Level");
    const names = first.spells.map((spell) => spell.name);
    expect(names).toContain("Cure Wounds");
    expect(names).toContain("My Homebrew Zap");
    expect(names).toContain("Healing Word");
    const homebrew = first.spells.find((spell) => spell.name === "My Homebrew Zap");
    expect(homebrew).toMatchObject({ prepared: true, expended: true, notesCollapsed: false });
  });

  it("appends wizard spellbook additions without touching prepared state", () => {
    const before = makeCharacter({
      levels: levelsOf("wizard"),
      base: { str: 8, dex: 14, con: 13, int: 15, wis: 10, cha: 10 },
      spellcasting: { wizard: { cantripIds: [], knownIds: ["magic-missile"], preparedIds: ["magic-missile"] } },
      sheet: {
        rest: { hitDiceSpent: {}, preparedByClass: { wizard: ["magic-missile"] } },
        spells: {
          levels: [
            {
              id: "lvl1", label: "1st Level", hasSlots: true, used: 2, total: 2, collapsed: false,
              spells: [
                { id: "s1", name: "Magic Missile", notesCollapsed: true, known: true, prepared: true, expended: false, builderSpellId: "magic-missile" }
              ]
            }
          ]
        }
      }
    });
    const after = withAppendedLevel(before, "wizard", {
      mutateBuild: (build) => {
        build.spellcasting.wizard.knownIds.push("shield", "thunderwave");
      }
    });
    const result = getLevelUpSheetSeedPatch(before, after, registry);
    const first = result.patch.spells.levels.find((level) => level.label === "1st Level");
    const names = first.spells.map((spell) => spell.name);
    expect(names).toEqual(expect.arrayContaining(["Magic Missile", "Shield", "Thunderwave"]));
    const shield = first.spells.find((spell) => spell.name === "Shield");
    expect(shield.prepared).toBe(false);
    const missile = first.spells.find((spell) => spell.name === "Magic Missile");
    expect(missile.prepared).toBe(true);
    // The patch never writes rest state or the build.
    expect(result.patch.rest).toBeUndefined();
    expect(result.patch.build).toBeUndefined();
  });

  it("appends only the new level's feature lines, once", () => {
    const before = makeCharacter({
      levels: levelsOf("fighter", "fighter", "fighter", "fighter"),
      subclassByClass: { fighter: "champion" },
      sheet: { features: "Second Wind (Fighter 1) — my own reworded note" }
    });
    const after = withAppendedLevel(before, "fighter");
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.features).toContain("Extra Attack (Fighter 5)");
    // Earlier features are not re-seeded by the level-up patch.
    expect(patch.features.match(/Second Wind/g)).toHaveLength(1);
  });

  it("does not re-append a feature line the user edited (dedupe by head)", () => {
    const before = makeCharacter({
      levels: levelsOf("fighter", "fighter", "fighter", "fighter"),
      subclassByClass: { fighter: "champion" },
      sheet: { features: "Extra Attack (Fighter 5) — my heavily edited description" }
    });
    const after = withAppendedLevel(before, "fighter");
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.features).toBeUndefined();
  });

  it("appends a feat line when the ASI slot chose a feat", () => {
    const before = makeCharacter({
      levels: levelsOf("fighter", "fighter", "fighter"),
      subclassByClass: { fighter: "champion" },
      sheet: { features: "" }
    });
    const after = withAppendedLevel(before, "fighter", {
      mutateBuild: (build) => {
        build.choicesByLevel["4"] = { "asi-4": { type: "feat", featId: "grappler" } };
      }
    });
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.features).toContain("Grappler (Feat)");
  });

  it("appends multiclass proficiency labels additively", () => {
    const before = makeCharacter({
      levels: levelsOf("wizard"),
      base: { str: 15, dex: 14, con: 13, int: 15, wis: 10, cha: 8 },
      sheet: { armorProf: "", weaponProf: "" }
    });
    const after = withAppendedLevel(before, "fighter");
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.armorProf).toContain("Light armor");
    expect(patch.weaponProf).toContain("Martial weapons");
  });
});

describe("user-owned play-state is untouched", () => {
  it("never patches inventory, resources, rest, death saves, feature uses, or attacks", () => {
    const before = makeCharacter({
      levels: levelsOf("fighter", "fighter"),
      subclassByClass: { fighter: "champion" },
      sheet: {
        hpMax: 20, hpCur: 9,
        inventoryItems: [{ id: "inv1", title: "My Renamed Pocket", notes: "Torch ×10", builderSeed: "starting-gear" }],
        resources: [{ id: "res1", name: "Rage", cur: 1, max: 3 }],
        rest: { hitDiceSpent: { "class:fighter": 1 }, preparedByClass: {} },
        deathSaves: { successes: 2, failures: 1 },
        featureUses: { "dragonborn-breath-weapon": { current: 0 } },
        attacks: [{ id: "atk1", name: "Longsword", notes: "", bonus: "+99", damage: "1d8+99", range: "Melee", type: "Slashing" }],
        manualFeatureCards: [{ id: "card1", title: "My Card" }]
      }
    });
    const after = withAppendedLevel(before, "fighter");
    const { patch } = getLevelUpSheetSeedPatch(before, after, registry);
    expect(patch.inventoryItems).toBeUndefined();
    expect(patch.resources).toBeUndefined();
    expect(patch.rest).toBeUndefined();
    expect(patch.deathSaves).toBeUndefined();
    expect(patch.featureUses).toBeUndefined();
    expect(patch.attacks).toBeUndefined();
    expect(patch.manualFeatureCards).toBeUndefined();
    expect(patch.personality).toBeUndefined();
  });

  it("prepared-caster capacity changes do not modify preparedIds or rest.preparedByClass", () => {
    const before = makeCharacter({
      levels: levelsOf("cleric"),
      base: { str: 8, dex: 14, con: 13, int: 10, wis: 15, cha: 10 },
      subclassByClass: { cleric: "life" },
      spellcasting: { cleric: { cantripIds: [], knownIds: [], preparedIds: ["bless"] } },
      sheet: { rest: { hitDiceSpent: {}, preparedByClass: { cleric: ["bless"] } } }
    });
    const beforeRest = JSON.stringify(before.rest);
    const beforePrepared = JSON.stringify(before.build.spellcasting.cleric.preparedIds);
    const after = withAppendedLevel(before, "cleric");
    const result = getLevelUpSheetSeedPatch(before, after, registry);
    expect(result.patch.rest).toBeUndefined();
    expect(JSON.stringify(before.rest)).toBe(beforeRest);
    expect(JSON.stringify(after.build.spellcasting.cleric.preparedIds)).toBe(beforePrepared);
  });

  it("is a no-op when before and after are the same leveled character", () => {
    const before = makeCharacter({
      levels: levelsOf("fighter", "fighter"),
      subclassByClass: { fighter: "champion" },
      sheet: { hpMax: 20, hpCur: 20, features: "Action Surge (Fighter 2) — desc" }
    });
    const after = withAppendedLevel(before, "fighter");
    const first = getLevelUpSheetSeedPatch(before, after, registry);
    const applied = { ...after, ...first.patch };
    const second = getLevelUpSheetSeedPatch(applied, applied, registry);
    expect(second.patch.hpMax).toBeUndefined();
    expect(second.patch.hpCur).toBeUndefined();
    expect(second.patch.features).toBeUndefined();
    expect(second.patch.spells).toBeUndefined();
  });

  it("returns an empty patch for freeform characters", () => {
    const freeform = { id: "c1", name: "Manual Mira", build: null, hpMax: 10 };
    const result = getLevelUpSheetSeedPatch(freeform, freeform, registry);
    expect(result.patch).toEqual({});
  });
});
