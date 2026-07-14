import { describe, expect, it } from "vitest";

import {
  ATTACK_WEAPON_SEED_PREFIX,
  RECALCULABLE_ATTACK_FIELDS,
  attackWeaponSeedMarker,
  deriveWeaponAttack,
  getAttackRecalculationProposal,
  getAttackSourceWeaponId
} from "../js/domain/attackRecalculation.js";
import { getBuilderFinishSheetSeedPatch } from "../js/domain/builderSheetSeeding.js";
import { makeDefaultBuilderCharacterEntry, makeDefaultCharacterEntry } from "../js/domain/characterHelpers.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import { BUILTIN_CONTENT } from "../js/domain/rules/builtinContent.js";
import {
  BUILTIN_CONTENT_REGISTRY,
  createContentRegistry,
  getContentByKind,
  normalizeCustomContent
} from "../js/domain/rules/registry.js";

function makeFighter({ levels = 1, str = 16, dex = 14 } = {}) {
  const character = makeDefaultBuilderCharacterEntry("Attack Tester");
  character.build.levels = Array.from({ length: levels }, () => ({ classId: "fighter", hp: null }));
  character.build.abilities.base = { str, dex, con: 14, int: 10, wis: 10, cha: 8 };
  return character;
}

function derivedFor(character, registry = BUILTIN_CONTENT_REGISTRY) {
  return deriveCharacter(character, registry);
}

describe("attack source markers", () => {
  it("round-trips a weapon id through the builderSeed marker", () => {
    const marker = attackWeaponSeedMarker("longsword");
    expect(marker).toBe(`${ATTACK_WEAPON_SEED_PREFIX}longsword`);
    expect(getAttackSourceWeaponId({ builderSeed: marker })).toBe("longsword");
  });

  it("returns no source for unmarked, foreign-marked, or malformed attacks", () => {
    expect(getAttackSourceWeaponId({ name: "Longsword" })).toBe("");
    expect(getAttackSourceWeaponId({ builderSeed: "class-resource:rage" })).toBe("");
    expect(getAttackSourceWeaponId(null)).toBe("");
    expect(getAttackSourceWeaponId("weapon:longsword")).toBe("");
  });
});

describe("deriveWeaponAttack (the canonical calculator)", () => {
  it("uses STR + proficiency for a plain melee weapon", () => {
    const derived = derivedFor(makeFighter()); // STR 16 (+3), prof +2
    const longsword = getContentByKind(BUILTIN_CONTENT_REGISTRY, "weapon", "longsword");
    expect(deriveWeaponAttack(longsword, derived)).toEqual({
      name: "Longsword",
      bonus: "+5",
      damage: "1d8+3",
      range: "Melee",
      type: "Slashing"
    });
  });

  it("uses DEX for ranged weapons and formats the range", () => {
    const derived = derivedFor(makeFighter()); // DEX 14 (+2)
    const longbow = getContentByKind(BUILTIN_CONTENT_REGISTRY, "weapon", "longbow");
    const row = deriveWeaponAttack(longbow, derived);
    expect(row.bonus).toBe("+4");
    expect(row.damage).toBe("1d8+2");
    expect(row.range).toMatch(/^\d+\/\d+ ft\.$/);
  });

  it("uses the better of STR/DEX for finesse weapons", () => {
    const derived = derivedFor(makeFighter({ str: 10, dex: 18 })); // DEX wins (+4)
    const dagger = getContentByKind(BUILTIN_CONTENT_REGISTRY, "weapon", "dagger");
    const row = deriveWeaponAttack(dagger, derived);
    expect(row.bonus).toBe("+6");
    expect(row.damage).toBe("1d4+4");
  });
});

describe("getAttackRecalculationProposal", () => {
  function seededLongswordAttack(character, registry = BUILTIN_CONTENT_REGISTRY) {
    const derived = derivedFor(character, registry);
    const longsword = getContentByKind(registry, "weapon", "longsword");
    return {
      id: "atk_1",
      ...deriveWeaponAttack(longsword, derived),
      builderSeed: attackWeaponSeedMarker("longsword")
    };
  }

  it("reports no-change when the attack already matches the build", () => {
    const character = makeFighter();
    const attack = seededLongswordAttack(character);
    const proposal = getAttackRecalculationProposal(attack, character, BUILTIN_CONTENT_REGISTRY);
    expect(proposal.status).toBe("no-change");
    expect(proposal.patch).toBeNull();
    expect(proposal.weaponName).toBe("Longsword");
    expect(proposal.reason).toContain("already matches");
  });

  it("proposes only the changed fields after the build moves on", () => {
    const level1 = makeFighter();
    const attack = seededLongswordAttack(level1);
    // Five fighter levels later: proficiency +2 → +3. STR unchanged.
    const level5 = makeFighter({ levels: 5 });
    const proposal = getAttackRecalculationProposal(attack, level5, BUILTIN_CONTENT_REGISTRY);
    expect(proposal.status).toBe("ready");
    expect(proposal.patch).toEqual({ bonus: "+6" });
    const byKey = Object.fromEntries(proposal.fields.map((field) => [field.key, field]));
    expect(byKey.bonus).toMatchObject({ current: "+5", proposed: "+6", changed: true });
    expect(byKey.damage.changed).toBe(false);
    expect(byKey.range.changed).toBe(false);
    expect(byKey.type.changed).toBe(false);
    // The proposal exposes every recalculable field for the preview.
    expect(proposal.fields.map((field) => field.key))
      .toEqual(RECALCULABLE_ATTACK_FIELDS.map((field) => field.key));
  });

  it("never proposes name or notes changes, even for renamed attacks", () => {
    const character = makeFighter({ levels: 5 });
    const attack = {
      ...seededLongswordAttack(makeFighter()),
      name: "Heirloom Blade of My Grandmother",
      notes: "Never sharpen it."
    };
    const proposal = getAttackRecalculationProposal(attack, character, BUILTIN_CONTENT_REGISTRY);
    expect(proposal.status).toBe("ready");
    expect(Object.keys(proposal.patch)).toEqual(["bonus"]);
  });

  it("is unlinked (with guidance) when no marker exists — names are never matched", () => {
    const character = makeFighter();
    const attack = { id: "atk_manual", name: "Longsword", bonus: "+5", damage: "1d8+3", range: "Melee", type: "Slashing" };
    const proposal = getAttackRecalculationProposal(attack, character, BUILTIN_CONTENT_REGISTRY);
    expect(proposal.status).toBe("unlinked");
    expect(proposal.reason).toContain("isn't linked");
    expect(proposal.patch).toBeNull();
  });

  it("is unavailable for freeform characters", () => {
    const freeform = makeDefaultCharacterEntry("Freeform");
    const attack = { id: "atk_1", name: "Club", builderSeed: attackWeaponSeedMarker("club") };
    const proposal = getAttackRecalculationProposal(attack, freeform, BUILTIN_CONTENT_REGISTRY);
    expect(proposal.status).toBe("unavailable");
    expect(proposal.reason).toContain("builder");
  });

  it("offers relinking when the linked weapon no longer resolves", () => {
    const character = makeFighter();
    const attack = { id: "atk_1", name: "Star Blade", builderSeed: attackWeaponSeedMarker("removed-custom-blade") };
    const proposal = getAttackRecalculationProposal(attack, character, BUILTIN_CONTENT_REGISTRY);
    expect(proposal.status).toBe("unlinked");
    expect(proposal.reason).toContain('"removed-custom-blade"');
    expect(proposal.reason).toContain("relink");
  });

  it("links an unlinked attack when the user explicitly picks a weapon", () => {
    const character = makeFighter({ levels: 5 });
    const attack = { id: "atk_manual", name: "Old Sword", bonus: "+1", damage: "1d8", range: "", type: "" };
    const proposal = getAttackRecalculationProposal(attack, character, BUILTIN_CONTENT_REGISTRY, {
      weaponId: "longsword"
    });
    expect(proposal.status).toBe("ready");
    expect(proposal.patch).toMatchObject({
      bonus: "+6",
      damage: "1d8+3",
      range: "Melee",
      type: "Slashing",
      builderSeed: attackWeaponSeedMarker("longsword")
    });
  });

  it("stamps the link even when every field already matches", () => {
    const character = makeFighter();
    const attack = { ...seededLongswordAttack(character) };
    delete attack.builderSeed;
    const proposal = getAttackRecalculationProposal(attack, character, BUILTIN_CONTENT_REGISTRY, {
      weaponId: "longsword"
    });
    expect(proposal.status).toBe("ready");
    expect(proposal.patch).toEqual({ builderSeed: attackWeaponSeedMarker("longsword") });
  });

  it("recalculates from custom weapon records through the merged registry", () => {
    const customWeapon = {
      id: "star-blade",
      kind: "weapon",
      name: "Star Blade",
      source: "custom",
      weaponCategory: "martial",
      attackType: "melee",
      damage: "2d6",
      damageType: "radiant",
      properties: []
    };
    const { entries } = normalizeCustomContent([customWeapon]);
    const registry = createContentRegistry([...BUILTIN_CONTENT, ...entries]);
    const character = makeFighter();
    const attack = { id: "atk_1", name: "Star Blade", bonus: "", damage: "", range: "", type: "", builderSeed: attackWeaponSeedMarker("star-blade") };
    const proposal = getAttackRecalculationProposal(attack, character, registry);
    expect(proposal.status).toBe("ready");
    expect(proposal.patch).toEqual({
      bonus: "+5",
      damage: "2d6+3",
      range: "Melee",
      type: "Radiant"
    });
  });
});

describe("Finish seeding stamps stable attack provenance", () => {
  it("seeded weapon rows carry the weapon marker and match the calculator", () => {
    const character = makeFighter();
    character.build.equipment = { armorId: null, shield: false, weaponIds: ["longsword"], startingChoices: {}, notes: "" };
    const patch = getBuilderFinishSheetSeedPatch(character, BUILTIN_CONTENT_REGISTRY);
    const attack = patch.attacks.find((row) => row.name === "Longsword");
    expect(attack).toMatchObject({
      bonus: "+5",
      damage: "1d8+3",
      type: "Slashing",
      builderSeed: attackWeaponSeedMarker("longsword")
    });
    // A freshly seeded attack recalculates to no-change.
    const proposal = getAttackRecalculationProposal(attack, character, BUILTIN_CONTENT_REGISTRY);
    expect(proposal.status).toBe("no-change");
  });
});
