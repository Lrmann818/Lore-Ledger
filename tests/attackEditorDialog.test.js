// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { initAttacksPanel } from "../js/pages/character/panels/attackPanel.js";
import {
  buildWeaponAttackCalc,
  getAttackSourceWeaponId
} from "../js/domain/attackCalculation.js";
import { makeDefaultBuilderCharacterEntry, makeDefaultCharacterEntry } from "../js/domain/characterHelpers.js";
import { getActiveCharacter } from "../js/domain/characterHelpers.js";
import { notifyPanelDataChanged } from "../js/ui/panelInvalidation.js";

function builderFighterState({ str = 16, levels = 1, attacks = [] } = {}) {
  const entry = makeDefaultBuilderCharacterEntry("Attack Tester");
  entry.build.levels = Array.from({ length: levels }, () => ({ classId: "fighter", hp: null }));
  entry.build.abilities.base = { str, dex: 14, con: 14, int: 10, wis: 10, cha: 8 };
  entry.build.equipment = { armorId: null, shield: false, weaponIds: [], startingChoices: {}, notes: "" };
  entry.attacks = attacks;
  return { characters: { activeId: entry.id, entries: [entry] } };
}

function freeformState({ attacks = [] } = {}) {
  const entry = makeDefaultCharacterEntry("Freeform");
  entry.abilities.str = { score: 16, mod: null, save: null };
  entry.proficiency = 2;
  entry.attacks = attacks;
  return { characters: { activeId: entry.id, entries: [entry] } };
}

function weaponAttack(id, overrides = {}) {
  return { id, name: "Longsword", notes: "", bonus: "+5", damage: "1d8+3", range: "Melee", type: "Slashing", calc: buildWeaponAttackCalc("longsword"), builderSeed: "weapon:longsword", ...overrides };
}

function setupDom() {
  document.body.innerHTML = `
    <section class="panel" id="charAttacksPanel">
      <div id="attackList"></div>
      <button id="addAttackBtn" type="button">+ Weapon</button>
    </section>
  `;
}

function initPanel(state) {
  const SaveManager = { markDirty: vi.fn() };
  const api = initAttacksPanel({ state, SaveManager, uiConfirm: async () => true, setStatus: vi.fn() });
  return { api, SaveManager };
}

let panels = [];
function track(api) { panels.push(api); return api; }

afterEach(() => {
  panels.forEach((api) => api?.destroy?.());
  panels = [];
  document.querySelector(".attackEditorOverlay")?.remove();
  document.body.innerHTML = "";
});

function firstRow() {
  return document.querySelector(".attackRow");
}
function derivedValue(cls) {
  return document.querySelector(`.attackDerivedValue.${cls}`)?.textContent || "";
}

describe("live-derived structured attack rows", () => {
  it("renders read-only derived values for a weapon-linked attack", () => {
    const state = builderFighterState({ str: 16, attacks: [weaponAttack("a1")] });
    setupDom();
    track(initPanel(state).api);

    expect(firstRow().classList.contains("attackRowDerived")).toBe(true);
    expect(derivedValue("attackBonusValue")).toBe("+5"); // STR 16 (+3) + prof +2
    expect(derivedValue("attackDamageValue")).toBe("1d8+3");
    // No editable inputs for the derived fields.
    expect(document.querySelector(".attackRow input.attackBonus")).toBeNull();
    // Name stays editable.
    expect(document.querySelector(".attackRow input.attackName")).toBeTruthy();
  });

  it("updates the displayed bonus automatically when Strength changes — no recalc action", () => {
    const state = builderFighterState({ str: 16, attacks: [weaponAttack("a1")] });
    setupDom();
    track(initPanel(state).api);
    expect(derivedValue("attackBonusValue")).toBe("+5");

    // Simulate a build ability change (STR 16 → 18) and a character-fields
    // notification (the freeform/live path). The row re-derives with no
    // Recalc button involved.
    getActiveCharacter(state).build.abilities.base.str = 18;
    notifyPanelDataChanged("character-fields", { source: {} });

    expect(derivedValue("attackBonusValue")).toBe("+6"); // STR 18 (+4) + prof +2
    expect(derivedValue("attackDamageValue")).toBe("1d8+4");
  });

  it("keeps a non-proficient attack without the proficiency bonus", () => {
    const calc = { ...buildWeaponAttackCalc("longsword"), proficient: false };
    const state = builderFighterState({ str: 16, attacks: [weaponAttack("a1", { calc })] });
    setupDom();
    track(initPanel(state).api);
    expect(derivedValue("attackBonusValue")).toBe("+3"); // STR +3, no proficiency
  });
});

describe("legacy and fixed rows stay editable text", () => {
  it("renders editable inputs for a legacy row with no calc block", () => {
    const legacy = { id: "l1", name: "Old Club", bonus: "+2", damage: "1d4", range: "Melee", type: "Bludgeoning" };
    const state = builderFighterState({ attacks: [legacy] });
    setupDom();
    track(initPanel(state).api);
    expect(firstRow().classList.contains("attackRowDerived")).toBe(false);
    expect(document.querySelector(".attackRow input.attackBonus")?.value).toBe("+2");
  });

  it("renders a fixed-mode row as editable text with a Fixed badge", () => {
    const fixed = weaponAttack("f1", { calc: { ...buildWeaponAttackCalc("longsword"), mode: "fixed" }, bonus: "+99", damage: "10d6" });
    const state = builderFighterState({ attacks: [fixed] });
    setupDom();
    track(initPanel(state).api);
    expect(document.querySelector(".attackRow input.attackBonus")?.value).toBe("+99");
    expect(document.querySelector(".attackFixedBadge")).toBeTruthy();
  });
});

describe("structured attack editor dialog", () => {
  function openEditor() {
    firstRow().querySelector(".attackEditBtn").click();
    return document.querySelector(".attackEditorOverlay");
  }

  it("previews without mutating, and applies an explicit adjustment", () => {
    const state = builderFighterState({ str: 16, attacks: [weaponAttack("a1", { notes: "keep me" })] });
    setupDom();
    const { SaveManager } = initPanel(state);
    track(panels[panels.length - 1] || null);

    const overlay = openEditor();
    expect(overlay.hidden).toBe(false);
    expect(overlay.querySelector(".attackEditorPreviewLine").textContent).toContain("+5");

    // Set an attack adjustment of +1, preview updates.
    const adj = overlay.querySelector('input[aria-label="Extra attack bonus"]');
    adj.value = "1";
    adj.dispatchEvent(new Event("input", { bubbles: true }));
    expect(overlay.querySelector(".attackEditorPreviewLine").textContent).toContain("+6");

    // Nothing mutated yet.
    expect(getActiveCharacter(state).attacks[0].calc.attackAdjustment).toBe(0);

    overlay.querySelector(".attackEditorFooter .npcSmallBtn:last-child").click();
    const applied = getActiveCharacter(state).attacks[0];
    expect(applied.calc.attackAdjustment).toBe(1);
    expect(applied.notes).toBe("keep me"); // user-owned field untouched
    expect(derivedValue("attackBonusValue")).toBe("+6"); // +5 calc, +1 adjustment
  });

  it("Cancel/Escape never mutate", () => {
    const state = builderFighterState({ attacks: [weaponAttack("a1")] });
    setupDom();
    track(initPanel(state).api);

    const overlay = openEditor();
    const adj = overlay.querySelector('input[aria-label="Extra attack bonus"]');
    adj.value = "5";
    adj.dispatchEvent(new Event("input", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(overlay.hidden).toBe(true);
    expect(getActiveCharacter(state).attacks[0].calc.attackAdjustment).toBe(0);
  });

  it("converts a legacy row to a weapon-linked structured attack (no name matching)", () => {
    const legacy = { id: "l1", name: "My Blade", bonus: "+1", damage: "1d8", range: "", type: "" };
    const state = builderFighterState({ str: 16, attacks: [legacy] });
    setupDom();
    track(initPanel(state).api);

    // Legacy row has no source inferred from its name.
    expect(getAttackSourceWeaponId(getActiveCharacter(state).attacks[0])).toBe("");

    const overlay = openEditor();
    // Switch to weapon mode and pick a weapon explicitly.
    const modeSelect = overlay.querySelector('select[aria-label="How this weapon is calculated"]');
    modeSelect.value = "weapon";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    const weaponSelect = overlay.querySelector('select[aria-label="Weapon this attack uses"]');
    weaponSelect.value = "longsword";
    weaponSelect.dispatchEvent(new Event("change", { bubbles: true }));

    overlay.querySelector(".attackEditorFooter .npcSmallBtn:last-child").click();
    const converted = getActiveCharacter(state).attacks[0];
    expect(converted.calc.mode).toBe("weapon");
    expect(converted.calc.weaponId).toBe("longsword");
    expect(getAttackSourceWeaponId(converted)).toBe("longsword"); // marker stamped
    expect(converted.name).toBe("My Blade"); // user name preserved
    expect(derivedValue("attackBonusValue")).toBe("+5");
  });

  it("switches a derived attack to fixed mode and stops recalculating", () => {
    const state = builderFighterState({ str: 16, attacks: [weaponAttack("a1")] });
    setupDom();
    track(initPanel(state).api);

    const overlay = openEditor();
    const modeSelect = overlay.querySelector('select[aria-label="How this weapon is calculated"]');
    modeSelect.value = "fixed";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    // Fixed fields pre-filled with the current values.
    const bonusInput = overlay.querySelector('input[aria-label="Attack bonus"]');
    expect(bonusInput.value).toBe("+5");
    bonusInput.value = "+7";
    bonusInput.dispatchEvent(new Event("input", { bubbles: true }));
    overlay.querySelector(".attackEditorFooter .npcSmallBtn:last-child").click();

    const applied = getActiveCharacter(state).attacks[0];
    expect(applied.calc.mode).toBe("fixed");
    expect(applied.bonus).toBe("+7");
    // Now editable text (fixed), and a STR change does not move it.
    expect(document.querySelector(".attackRow input.attackBonus")?.value).toBe("+7");
    getActiveCharacter(state).attacks[0].bonus = "+7";
    getActiveCharacter(state).build.abilities.base.str = 20;
    notifyPanelDataChanged("character-fields", { source: {} });
    expect(document.querySelector(".attackRow input.attackBonus")?.value).toBe("+7");
  });
});

describe("freeform characters use the same calculator", () => {
  it("derives an ability-mode attack from freeform sheet scores", () => {
    const calc = { ...buildWeaponAttackCalc(""), mode: "ability", ability: "str", proficient: true, baseDamage: "1d8", damageType: "slashing" };
    const attack = { id: "a1", name: "Improvised", bonus: "", damage: "", range: "", type: "", calc };
    const state = freeformState({ attacks: [attack] });
    setupDom();
    track(initPanel(state).api);
    // Freeform STR 16 (+3) + manual proficiency 2 = +5.
    expect(derivedValue("attackBonusValue")).toBe("+5");
    expect(derivedValue("attackDamageValue")).toBe("1d8+3");
  });
});
