// @vitest-environment jsdom
// Attack "Recalculate from Build" dialog (matrix #9): explicit action only,
// preview before mutation, per-field acceptance, user-owned fields
// untouched, unlinked attacks link through an explicit weapon picker.

import { afterEach, describe, expect, it, vi } from "vitest";

import { initAttacksPanel } from "../js/pages/character/panels/attackPanel.js";
import { attackWeaponSeedMarker, deriveWeaponAttack } from "../js/domain/attackRecalculation.js";
import { makeDefaultBuilderCharacterEntry, makeDefaultCharacterEntry } from "../js/domain/characterHelpers.js";
import { deriveCharacter } from "../js/domain/rules/deriveCharacter.js";
import { BUILTIN_CONTENT_REGISTRY, getContentByKind } from "../js/domain/rules/registry.js";

function makeBuilderCharacter({ levels = 5, str = 16, dex = 14 } = {}) {
  const character = makeDefaultBuilderCharacterEntry("Recalc Tester");
  character.build.levels = Array.from({ length: levels }, () => ({ classId: "fighter", hp: null }));
  character.build.abilities.base = { str, dex, con: 14, int: 10, wis: 10, cha: 8 };
  return character;
}

/** A longsword attack seeded from a LEVEL 1 build (stale at level 5). */
function staleLongswordAttack() {
  const level1 = makeBuilderCharacter({ levels: 1 });
  const derived = deriveCharacter(level1, BUILTIN_CONTENT_REGISTRY);
  const longsword = getContentByKind(BUILTIN_CONTENT_REGISTRY, "weapon", "longsword");
  return {
    id: "atk_linked",
    ...deriveWeaponAttack(longsword, derived),
    notes: "Family heirloom.",
    builderSeed: attackWeaponSeedMarker("longsword")
  };
}

function setupDom() {
  document.body.innerHTML = `
    <section class="panel" id="charAttacksPanel">
      <div id="attackList"></div>
      <button id="addAttackBtn" type="button">+ Weapon</button>
    </section>
  `;
}

function makeState(character) {
  return {
    appShell: { activeCampaignId: "camp1" },
    characters: { activeId: character.id, entries: [character] }
  };
}

let api = null;
let SaveManager = null;

function initPanel(character) {
  setupDom();
  const state = makeState(character);
  SaveManager = { markDirty: vi.fn() };
  api = initAttacksPanel({ state, SaveManager, uiConfirm: vi.fn(async () => true) });
  return state;
}

const overlay = () => document.querySelector(".attackRecalcOverlay");
const dialogBody = () => document.querySelector(".attackRecalcBody");
const dialogButton = (label) =>
  Array.from(document.querySelectorAll(".attackRecalcFooter button, .attackRecalcOverlay button"))
    .find((btn) => btn.textContent === label);

function openDialogFor(attackId) {
  const row = document.querySelector(`.attackRow[data-attack-id="${attackId}"]`);
  row.querySelector(".attackRecalcBtn").click();
}

afterEach(() => {
  api?.destroy?.();
  api = null;
  document.body.innerHTML = "";
});

describe("recalculate affordance visibility", () => {
  it("shows the button on builder characters only", () => {
    const character = makeBuilderCharacter();
    character.attacks = [staleLongswordAttack()];
    initPanel(character);
    expect(document.querySelector(".attackRecalcBtn")).toBeTruthy();
    expect(document.querySelector(".attackRecalcBtn").getAttribute("aria-label"))
      .toBe("Recalculate from Build");
    api.destroy();

    const freeform = makeDefaultCharacterEntry("Freeform");
    freeform.attacks = [{ id: "atk_1", name: "Club", bonus: "+2", damage: "1d4", range: "", type: "" }];
    initPanel(freeform);
    expect(document.querySelector(".attackRecalcBtn")).toBeNull();
  });
});

describe("preview and apply for a linked attack", () => {
  it("previews old and proposed values without mutating anything", () => {
    const character = makeBuilderCharacter({ levels: 5 }); // prof +3 → bonus +6
    character.attacks = [staleLongswordAttack()];
    const state = initPanel(character);

    openDialogFor("atk_linked");
    expect(overlay().hidden).toBe(false);
    expect(dialogBody().textContent).toContain("Proposed from Longsword");
    const bonusRow = dialogBody().querySelector('[data-field="bonus"]');
    expect(bonusRow.textContent).toContain("+5 changes to +6");
    expect(bonusRow.querySelector("input[type=checkbox]").checked).toBe(true);
    expect(dialogBody().querySelector('[data-field="damage"]').textContent).toContain("unchanged");

    // Cancel: no mutation, no dirty save.
    dialogButton("Cancel").click();
    expect(overlay().hidden).toBe(true);
    expect(state.characters.entries[0].attacks[0].bonus).toBe("+5");
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
  });

  it("Escape cancels without mutation", () => {
    const character = makeBuilderCharacter({ levels: 5 });
    character.attacks = [staleLongswordAttack()];
    const state = initPanel(character);
    openDialogFor("atk_linked");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(overlay().hidden).toBe(true);
    expect(state.characters.entries[0].attacks[0].bonus).toBe("+5");
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
  });

  it("applies checked changes atomically and preserves name and notes", () => {
    const character = makeBuilderCharacter({ levels: 5 });
    const attack = { ...staleLongswordAttack(), name: "Heirloom Blade" };
    character.attacks = [attack];
    const state = initPanel(character);

    openDialogFor("atk_linked");
    dialogButton("Apply Changes").click();

    expect(overlay().hidden).toBe(true);
    const saved = state.characters.entries[0].attacks[0];
    expect(saved).toMatchObject({
      name: "Heirloom Blade",
      notes: "Family heirloom.",
      bonus: "+6",
      damage: "1d8+3",
      builderSeed: attackWeaponSeedMarker("longsword")
    });
    expect(SaveManager.markDirty).toHaveBeenCalled();
  });

  it("lets the user keep a customized field by unchecking it", () => {
    // STR 18 at level 5: both bonus (+7) and damage (1d8+4) change.
    const character = makeBuilderCharacter({ levels: 5, str: 18 });
    character.attacks = [staleLongswordAttack()];
    const state = initPanel(character);

    openDialogFor("atk_linked");
    const damageBox = dialogBody().querySelector('[data-recalc-field="damage"]');
    expect(damageBox).toBeTruthy();
    damageBox.checked = false;
    damageBox.dispatchEvent(new Event("change", { bubbles: true }));
    dialogButton("Apply Changes").click();

    const saved = state.characters.entries[0].attacks[0];
    expect(saved.bonus).toBe("+7");
    expect(saved.damage).toBe("1d8+3"); // kept as the user chose
  });

  it("shows a friendly no-change result with no write", () => {
    const character = makeBuilderCharacter({ levels: 5 });
    const derived = deriveCharacter(character, BUILTIN_CONTENT_REGISTRY);
    const longsword = getContentByKind(BUILTIN_CONTENT_REGISTRY, "weapon", "longsword");
    character.attacks = [{
      id: "atk_linked",
      ...deriveWeaponAttack(longsword, derived),
      builderSeed: attackWeaponSeedMarker("longsword")
    }];
    initPanel(character);

    openDialogFor("atk_linked");
    expect(dialogBody().textContent).toContain("already matches");
    expect(dialogButton("Apply Changes")).toBeUndefined();
    dialogButton("Close").click();
    expect(overlay().hidden).toBe(true);
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
  });
});

describe("unlinked and broken-link attacks", () => {
  it("explains, requires an explicit weapon choice, then links on apply", () => {
    const character = makeBuilderCharacter({ levels: 5 });
    character.attacks = [{
      id: "atk_manual", name: "Old Sword", bonus: "+1", damage: "1d8", range: "", type: "", notes: "rusty"
    }];
    const state = initPanel(character);

    openDialogFor("atk_manual");
    expect(dialogBody().textContent).toContain("isn't linked");
    const previewBtn = dialogButton("Preview Changes");
    expect(previewBtn.disabled).toBe(true);

    const select = dialogBody().querySelector(".attackRecalcWeaponSelect");
    select.value = "longsword";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(previewBtn.disabled).toBe(false);
    previewBtn.click();

    expect(dialogBody().textContent).toContain("Proposed from Longsword");
    expect(dialogBody().textContent).toContain("link this entry to Longsword");
    dialogButton("Apply Changes").click();

    const saved = state.characters.entries[0].attacks[0];
    expect(saved).toMatchObject({
      name: "Old Sword",
      notes: "rusty",
      bonus: "+6",
      damage: "1d8+3",
      range: "Melee",
      type: "Slashing",
      builderSeed: attackWeaponSeedMarker("longsword")
    });
  });

  it("treats a broken link as relinkable with the reason shown", () => {
    const character = makeBuilderCharacter();
    character.attacks = [{
      id: "atk_broken", name: "Star Blade", bonus: "+9", damage: "2d6",
      range: "", type: "", builderSeed: attackWeaponSeedMarker("removed-custom-blade")
    }];
    initPanel(character);

    openDialogFor("atk_broken");
    expect(dialogBody().textContent).toContain('"removed-custom-blade"');
    expect(dialogBody().querySelector(".attackRecalcWeaponSelect")).toBeTruthy();
    dialogButton("Cancel").click();
    expect(overlay().hidden).toBe(true);
  });
});
