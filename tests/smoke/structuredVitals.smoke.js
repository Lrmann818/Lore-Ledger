import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp, waitForAppShell } from "./helpers/smokeApp.js";

// F2 structured vitals: spell save DC / spell attack, Armor Class, and max HP
// follow the calculation contract — derived by default for builder characters
// (with live updates and explicit adjustments), fixed only through the
// intentional override, freeform casters declare their own profile, and
// freeform AC / max HP stay plain manual inputs.

async function readActiveCharacter(page) {
  return page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const character = collection?.entries?.find((entry) => entry?.id === collection?.activeId);
    return JSON.parse(JSON.stringify(character ?? null));
  });
}

function tile(page, key) {
  return page.locator(`#charVitalsTiles .charTile[data-vital-key="${key}"]`);
}

async function createBuilderCleric(page, { name = "Vitals Cleric" } = {}) {
  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill(name);
  await page.locator("#builderWizardRace").selectOption("human");
  await page.locator("#builderWizardClass").selectOption("cleric");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click(); // → race & background choices
  await page.locator("#builderWizardNext").click(); // → classes & levels
  await page.locator("#builderWizardNext").click(); // → class choices
  await page.locator("#builderWizardNext").click(); // → abilities
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  // Human +1 all: Wis 16 (+3), Dex 15 (+2), Con 14 (+2), prof +2.
  for (const [suffix, value] of Object.entries({ Str: "8", Dex: "14", Con: "13", Int: "10", Wis: "15", Cha: "12" })) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click(); // → spells (cleric is a caster)
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  await page.locator("#builderWizardNext").click(); // → equipment (none)
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator("#builderWizardNext").click(); // → summary
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();
}

test("builder vitals derive live, take adjustments and fixed overrides, and persist", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Structured Vitals Smoke" });
  await createBuilderCleric(page);

  // Finish stamped all three calc blocks and filled the flat mirrors.
  await expect.poll(async () => {
    const c = await readActiveCharacter(page);
    return {
      spell: c?.spellcastingCalc?.mode,
      ac: c?.acCalc?.mode,
      hp: c?.hpMaxCalc?.mode,
      dc: c?.spellDC,
      acValue: c?.ac,
      hpMax: c?.hpMax
    };
  }).toEqual({ spell: "derived", ac: "derived", hp: "derived", dc: 13, acValue: 12, hpMax: 10 });

  // Tiles show read-only derived values with provenance; the snapshot inputs
  // are hidden together with their stepper wrappers.
  await expect(tile(page, "spellDC").locator(".spellDerivedValue")).toHaveText("13");
  await expect(tile(page, "spellDC").locator(".vitalCalcProvenance")).toContainText("Wisdom");
  await expect(tile(page, "spellAtk").locator(".spellDerivedValue")).toHaveText("+5");
  await expect(page.locator("#charSpellDC")).toBeHidden();
  await expect(tile(page, "ac").locator(".acDerivedValue")).toHaveText("12");
  await expect(tile(page, "ac").locator(".vitalCalcProvenance")).toContainText("10 + Dex");
  await expect(page.locator("#charAC")).toBeHidden();
  await expect(tile(page, "hp").locator(".hpMaxDerivedValue")).toHaveText("10");
  await expect(page.locator("#charHpMax")).toBeHidden();
  // Current HP stays a live editable input.
  await expect(page.locator("#charHpCur")).toBeVisible();
  await expect(page.locator("#charHpCur")).toHaveValue("10");

  // Raise Wisdom through Edit in Builder → spell DC/attack update AUTOMATICALLY.
  await page.locator("#charBuilderIdentityEditBtn").click();
  await expect(page.locator("#builderWizardTitle")).toHaveText("Edit with Builder");
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  await page.locator("#builderWizardAbilityWis").fill("17"); // 18 → +4
  await page.locator("#builderWizardNext").click(); // → spells
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  await page.locator("#builderWizardNext").click(); // → equipment
  await page.locator("#builderWizardNext").click(); // → summary
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();
  await expect(tile(page, "spellDC").locator(".spellDerivedValue")).toHaveText("14");
  await expect(tile(page, "spellAtk").locator(".spellDerivedValue")).toHaveText("+6");

  // Add an explicit +1 AC adjustment through the calculation editor.
  await tile(page, "ac").locator(".vitalCalcEditBtn").click();
  await expect(page.locator(".scalarCalcDialogPanel")).toBeVisible();
  await page.locator('input[aria-label="Armor Class adjustment"]').fill("1");
  await expect(page.locator(".scalarCalcPreviewBody")).toContainText("13");
  await page.locator("[data-scalar-calc-save]").click();
  await expect(page.locator(".scalarCalcDialogPanel")).toBeHidden();
  await expect(tile(page, "ac").locator(".acDerivedValue")).toHaveText("13");
  await expect.poll(async () => (await readActiveCharacter(page))?.acCalc).toEqual({ mode: "derived", adjustment: 1 });

  // Switch max HP to an intentional fixed override.
  await tile(page, "hp").locator(".vitalCalcEditBtn").click();
  await expect(page.locator(".scalarCalcDialogPanel")).toBeVisible();
  await page.locator('select[aria-label="How maximum HP is calculated"]').selectOption("fixed");
  await page.locator('input[aria-label="Fixed maximum HP"]').fill("25");
  await page.locator("[data-scalar-calc-save]").click();
  await expect(tile(page, "hp").locator(".hpMaxDerivedValue")).toHaveText("25");
  await expect(tile(page, "hp").locator(".vitalCalcProvenance")).toHaveText("Fixed value");
  await expect.poll(async () => {
    const c = await readActiveCharacter(page);
    return { mode: c?.hpMaxCalc?.mode, hpMax: c?.hpMax, hpCur: c?.hpCur };
  }).toEqual({ mode: "fixed", hpMax: 25, hpCur: 10 }); // raising the max never auto-heals

  // Escape cancels without mutating.
  await tile(page, "hp").locator(".vitalCalcEditBtn").click();
  await page.locator('input[aria-label="Fixed maximum HP"]').fill("99");
  await page.keyboard.press("Escape");
  await expect(page.locator(".scalarCalcDialogPanel")).toBeHidden();
  await expect.poll(async () => (await readActiveCharacter(page))?.hpMax).toBe(25);

  // Everything survives a full reload (derived values re-derive, fixed stays).
  await page.waitForTimeout(1500);
  await page.reload();
  await waitForAppShell(page);
  await page.getByRole("tab", { name: "Character" }).click();
  await expect(tile(page, "spellDC").locator(".spellDerivedValue")).toHaveText("14");
  await expect(tile(page, "ac").locator(".acDerivedValue")).toHaveText("13");
  await expect(tile(page, "hp").locator(".hpMaxDerivedValue")).toHaveText("25");
  await expect(tile(page, "hp").locator(".vitalCalcProvenance")).toHaveText("Fixed value");

  await expectNoFatalSignals(page, fatalSignals);
});

test("freeform casters declare a profile; freeform AC and max HP stay manual", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Freeform Vitals Smoke" });
  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBtn").click();

  // Freeform sheet inputs: proficiency +3, Charisma 18 (+4).
  await page.evaluate(async () => {
    const load = (path) => import(new URL(path, window.location.href).href);
    const devMod = await load("js/utils/dev.js");
    devMod.withAllowedStateMutation(() => {
      const collection = globalThis.__APP_STATE__.characters;
      const character = collection.entries.find((entry) => entry?.id === collection.activeId);
      character.proficiency = 3;
      character.abilities = { ...(character.abilities || {}), cha: { score: 18 } };
      return true;
    });
  });

  // AC and HP tiles have no calculation affordance for freeform characters —
  // the manual inputs are the whole story.
  await expect(page.locator("#charAC")).toBeVisible();
  await expect(page.locator("#charHpMax")).toBeVisible();
  await expect(tile(page, "ac").locator(".vitalCalcEditBtn")).toHaveCount(0);
  await expect(tile(page, "hp").locator(".vitalCalcEditBtn")).toHaveCount(0);

  // The spell tiles offer the editor: declare Charisma as the casting ability.
  // (A freeform legacy sheet opens in Fixed mode; switch to Calculated first.)
  await tile(page, "spellDC").locator(".vitalCalcEditBtn").click();
  await expect(page.locator(".spellCalcDialogMarker")).toBeVisible();
  await page.locator('select[aria-label="How spell DC and attack are calculated"]').selectOption("derived");
  await page.locator('select[aria-label="Add a spellcasting ability"]').selectOption("cha");
  await expect(page.locator(".spellCalcPreviewBody")).toContainText("DC 15");
  await page.locator("[data-spell-calc-save]").click();
  await expect(page.locator(".spellCalcDialogMarker")).toBeHidden();

  // DC = 8 + 3 + 4, attack = +7, derived through the same engine.
  await expect(tile(page, "spellDC").locator(".spellDerivedValue")).toHaveText("15");
  await expect(tile(page, "spellAtk").locator(".spellDerivedValue")).toHaveText("+7");
  await expect(tile(page, "spellDC").locator(".vitalCalcProvenance")).toContainText("Charisma");
  await expect.poll(async () => {
    const c = await readActiveCharacter(page);
    return { dc: c?.spellDC, attack: c?.spellAttack, mode: c?.spellcastingCalc?.mode };
  }).toEqual({ dc: 15, attack: 7, mode: "derived" });

  await expectNoFatalSignals(page, fatalSignals);
});

test("vitals calculation editor is keyboard-operable and fits at 380px", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Vitals KB Smoke" });
  await createBuilderCleric(page, { name: "KB Cleric" });
  await expect(tile(page, "ac").locator(".acDerivedValue")).toHaveText("12");

  await page.setViewportSize({ width: 380, height: 800 });

  // Open the AC editor from the keyboard.
  await tile(page, "ac").locator(".vitalCalcEditBtn").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".scalarCalcDialogPanel")).toBeVisible();

  // No horizontal overflow of the document at 380px.
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // Tab stays trapped inside the dialog.
  for (let i = 0; i < 10; i++) await page.keyboard.press("Tab");
  const trapped = await page.evaluate(() => !!document.activeElement?.closest(".scalarCalcDialogPanel"));
  expect(trapped).toBe(true);

  // Escape closes, returns focus to the opener, and mutates nothing.
  const before = await page.evaluate(() => {
    const c = globalThis.__APP_STATE__.characters;
    return JSON.stringify(c.entries.find((e) => e.id === c.activeId).acCalc);
  });
  await page.keyboard.press("Escape");
  await expect(page.locator(".scalarCalcDialogPanel")).toBeHidden();
  await expect.poll(() => page.evaluate(() =>
    document.activeElement?.closest(".charTile")?.dataset?.vitalKey)).toBe("ac");
  const after = await page.evaluate(() => {
    const c = globalThis.__APP_STATE__.characters;
    return JSON.stringify(c.entries.find((e) => e.id === c.activeId).acCalc);
  });
  expect(after).toBe(before);

  await expectNoFatalSignals(page, fatalSignals);
});
