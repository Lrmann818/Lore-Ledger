import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp, waitForAppShell } from "./helpers/smokeApp.js";

// Attack "Recalculate from Build" (matrix #9): build a fighter with a
// longsword (Finish seeds the attack with its stable weapon marker), raise
// STR through Edit in Builder and verify the persisted attack does NOT
// change automatically, then explicitly recalculate — preview shows old →
// proposed values, Apply updates the row — and confirm the recalculated
// attack survives a full reload.

async function readActiveAttacks(page) {
  return page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const character = collection?.entries?.find((entry) => entry?.id === collection?.activeId);
    return JSON.parse(JSON.stringify(character?.attacks ?? []));
  });
}

test("attack recalculation is explicit, previewed, applied, and persistent", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Attack Recalc Smoke" });

  // Build a level-1 fighter with a longsword (STR 15 +1 human → 16 (+3), prof +2 → +5).
  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill("Recalc Hero");
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
  await page.locator("#builderWizardNext").click(); // → equipment (fighter has no spells step)
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator('select[aria-label="Add a weapon"]').selectOption("longsword");
  await expect(page.locator(".builderWeaponRow")).toContainText("Longsword");
  await page.locator("#builderWizardNext").click(); // → summary
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  // The seeded attack carries the stable weapon marker.
  await expect.poll(() => readActiveAttacks(page)).toEqual([
    expect.objectContaining({
      name: "Longsword",
      bonus: "+5",
      damage: "1d8+3",
      builderSeed: "weapon:longsword"
    })
  ]);

  // Raise STR to 18 through Edit in Builder. The attack must NOT change.
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

  const attacksAfterEdit = await readActiveAttacks(page);
  expect(attacksAfterEdit).toHaveLength(1);
  expect(attacksAfterEdit[0]).toMatchObject({ bonus: "+5", damage: "1d8+3" });

  // Explicit recalculation: preview shows old → proposed, then Apply.
  const attackRow = page.locator(".attackRow").first();
  await attackRow.getByRole("button", { name: "Recalculate from Build" }).click();
  await expect(page.locator(".attackRecalcPanel")).toBeVisible();
  await expect(page.locator(".attackRecalcBody")).toContainText("Proposed from Longsword");
  await expect(page.locator('.attackRecalcRow[data-field="bonus"]')).toContainText("+5 changes to +6");
  await expect(page.locator('.attackRecalcRow[data-field="damage"]')).toContainText("1d8+3 changes to 1d8+4");
  await expect(page.locator('.attackRecalcRow[data-field="range"]')).toContainText("unchanged");
  await page.getByRole("button", { name: "Apply Changes" }).click();
  await expect(page.locator(".attackRecalcPanel")).toBeHidden();
  await expect(attackRow.locator(".attackBonus")).toHaveValue("+6");
  await expect(attackRow.locator(".attackDamage")).toHaveValue("1d8+4");

  // Reopening now reports no changes (no meaningless writes offered).
  await attackRow.getByRole("button", { name: "Recalculate from Build" }).click();
  await expect(page.locator(".attackRecalcBody")).toContainText("already matches");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".attackRecalcPanel")).toBeHidden();

  // The recalculated attack survives a full reload.
  await page.waitForTimeout(1500);
  await page.reload();
  await waitForAppShell(page);
  await page.getByRole("tab", { name: "Character" }).click();
  await expect.poll(() => readActiveAttacks(page)).toEqual([
    expect.objectContaining({
      name: "Longsword",
      bonus: "+6",
      damage: "1d8+4",
      builderSeed: "weapon:longsword"
    })
  ]);

  await expectNoFatalSignals(page, fatalSignals);
});
