import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp, waitForAppShell } from "./helpers/smokeApp.js";

// Unified structured attacks: build a fighter with a longsword (Finish seeds
// a structured, live-deriving attack), rename it, raise STR through Edit in
// Builder and verify the displayed attack updates AUTOMATICALLY (no recalc
// action) while the custom name survives, confirm persistence across reload,
// then create a manual structured attack and an explicit adjustment through
// the editor and confirm a fixed attack does not derive.

async function readActiveAttacks(page) {
  return page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const character = collection?.entries?.find((entry) => entry?.id === collection?.activeId);
    return JSON.parse(JSON.stringify(character?.attacks ?? []));
  });
}

function firstRow(page) {
  return page.locator(".attackRow").first();
}

test("structured attacks derive live, edit through the editor, and persist", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Attack Editor Smoke" });

  // Build a level-1 fighter with a longsword (STR 15 +1 human → 16 (+3), prof +2 → +5).
  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill("Editor Hero");
  await page.locator("#builderWizardRace").selectOption("human");
  await page.locator("#builderWizardClass").selectOption("fighter");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click(); // → race & background choices
  await page.locator("#builderWizardNext").click(); // → classes & levels
  await page.locator("#builderWizardNext").click(); // → class choices
  await page.locator("#builderWizardNext").click(); // → abilities
  const abilityValues = { Str: "15", Dex: "14", Con: "13", Int: "12", Wis: "10", Cha: "8" };
  for (const [suffix, value] of Object.entries(abilityValues)) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click(); // → equipment
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator('select[aria-label="Add a weapon"]').selectOption("longsword");
  await expect(page.locator(".builderWeaponRow")).toContainText("Longsword");
  await page.locator("#builderWizardNext").click(); // → summary
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  // The seeded attack is structured (live-deriving) and carries the marker.
  await expect.poll(() => readActiveAttacks(page)).toEqual([
    expect.objectContaining({
      name: "Longsword",
      calc: expect.objectContaining({ mode: "weapon", weaponId: "longsword", proficient: true }),
      builderSeed: "weapon:longsword"
    })
  ]);

  // The row shows read-only derived values (+5 / 1d8+3), no editable bonus input.
  await expect(firstRow(page)).toHaveClass(/attackRowDerived/);
  await expect(firstRow(page).locator(".attackBonusValue")).toHaveText("+5");
  await expect(firstRow(page).locator(".attackDamageValue")).toHaveText("1d8+3");

  // Give it a custom name (user-owned).
  await firstRow(page).locator(".attackName").fill("Grandfather's Blade");

  // Raise STR to 18 through Edit in Builder. The attack updates AUTOMATICALLY.
  await page.locator("#charBuilderIdentityEditBtn").click();
  await expect(page.locator("#builderWizardTitle")).toHaveText("Edit with Builder");
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  await page.locator("#builderWizardAbilityStr").fill("18");
  await page.locator("#builderWizardNext").click(); // → equipment
  await page.locator("#builderWizardNext").click(); // → summary
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  // No Recalc button anywhere; the displayed values already reflect STR 19 (+4).
  await expect(page.getByRole("button", { name: "Recalculate from Build" })).toHaveCount(0);
  await expect(firstRow(page).locator(".attackBonusValue")).toHaveText("+6");
  await expect(firstRow(page).locator(".attackDamageValue")).toHaveText("1d8+4");
  // Custom name preserved.
  await expect(firstRow(page).locator(".attackName")).toHaveValue("Grandfather's Blade");

  // Add an explicit +1 attack adjustment through the editor.
  await firstRow(page).getByRole("button", { name: "Edit weapon calculation" }).click();
  await expect(page.locator(".attackEditorPanel")).toBeVisible();
  await page.locator('input[aria-label="Extra attack bonus"]').fill("1");
  await expect(page.locator(".attackEditorPreviewLine")).toContainText("+7");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".attackEditorPanel")).toBeHidden();
  await expect(firstRow(page).locator(".attackBonusValue")).toHaveText("+7");

  // Persist across a full reload: structured calc + adjustment survive.
  await page.waitForTimeout(1500);
  await page.reload();
  await waitForAppShell(page);
  await page.getByRole("tab", { name: "Character" }).click();
  await expect(firstRow(page).locator(".attackBonusValue")).toHaveText("+7");
  await expect.poll(() => readActiveAttacks(page)).toEqual([
    expect.objectContaining({
      name: "Grandfather's Blade",
      calc: expect.objectContaining({ mode: "weapon", weaponId: "longsword", attackAdjustment: 1 })
    })
  ]);

  // Create a manual structured attack: add a row, structure it in the editor.
  await page.locator("#addAttackBtn").click();
  const manualRow = page.locator(".attackRow").first();
  await manualRow.locator(".attackName").fill("Psychic Lash");
  await manualRow.getByRole("button", { name: "Edit weapon calculation" }).click();
  await expect(page.locator(".attackEditorPanel")).toBeVisible();
  // Ability mode is the default for a fresh row; set INT + base damage.
  await page.locator('select[aria-label="Ability used for the attack roll"]').selectOption("int");
  await page.locator('input[aria-label="Base damage dice"]').fill("1d8");
  await page.locator('input[aria-label="Damage type"]').fill("Psychic");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".attackEditorPanel")).toBeHidden();
  // INT 13 (12 +1 human) → +1, prof +2 → +3.
  await expect(manualRow).toHaveClass(/attackRowDerived/);
  await expect(manualRow.locator(".attackBonusValue")).toHaveText("+3");
  await expect(manualRow.locator(".attackDamageValue")).toHaveText("1d8+1");

  // A fixed attack does not derive: switch the manual row to fixed mode.
  await manualRow.getByRole("button", { name: "Edit weapon calculation" }).click();
  await page.locator('select[aria-label="How this weapon is calculated"]').selectOption("fixed");
  await page.locator('input[aria-label="Attack bonus"]').fill("+99");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".attackEditorPanel")).toBeHidden();
  // Fixed rows are editable text with a Fixed badge, not derived values.
  await expect(manualRow.locator("input.attackBonus")).toHaveValue("+99");
  await expect(manualRow.locator(".attackFixedBadge")).toBeVisible();

  await expectNoFatalSignals(page, fatalSignals);
});
