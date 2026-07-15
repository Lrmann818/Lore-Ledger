import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp, waitForAppShell } from "./helpers/smokeApp.js";

// High Elf wizard-cantrip choice (reusable choice-based granted spells):
// build an Elf → High Elf, confirm the origin step requires exactly one
// wizard cantrip (blocking Finish until chosen, only wizard cantrips shown),
// pick one, confirm it appears in the summary with Intelligence provenance,
// Finish, and confirm the cantrip is on the sheet with Intelligence-based
// spell values and survives a reload.

async function readActiveCharacter(page) {
  return page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const character = collection?.entries?.find((entry) => entry?.id === collection?.activeId);
    return character ? JSON.parse(JSON.stringify(character)) : null;
  });
}

function grantedCantripNames(character) {
  const levels = character?.spells?.levels ?? [];
  const cantrips = levels.find((level) => /cantrip/i.test(level.label));
  return (cantrips?.spells ?? []).filter((s) => s.builderGranted).map((s) => s.builderSpellId);
}

test("High Elf requires and grants a wizard cantrip cast with Intelligence", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "High Elf Smoke" });

  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();

  await page.locator("#builderWizardName").fill("Aelar");
  await page.locator("#builderWizardRace").selectOption("elf");
  // Subrace picker appears for Elf.
  await expect(page.locator("#builderWizardSubraceField")).toBeVisible();
  await page.locator("#builderWizardSubrace").selectOption("high-elf");
  await page.locator("#builderWizardClass").selectOption("wizard");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click(); // → origin choices

  // The origin step shows a wizard-cantrip picker with only wizard cantrips.
  const cantripSelect = page.locator('#builderWizardOriginChoices select[data-choice-id="high-elf-cantrip"]');
  await expect(cantripSelect).toBeVisible();
  const optionValues = await cantripSelect.locator("option").evaluateAll((opts) =>
    opts.map((o) => o.value).filter(Boolean));
  expect(optionValues).toContain("fire-bolt");
  expect(optionValues).not.toContain("magic-missile"); // leveled spell excluded
  expect(optionValues).not.toContain("sacred-flame"); // non-wizard cantrip excluded

  // Finish is blocked while the required cantrip is unchosen.
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepRaceChoices")).toBeVisible();
  await expect(page.locator("#builderWizardRaceChoicesValidation")).toContainText(/cantrip is required/i);

  // Choose the cantrip and advance.
  await cantripSelect.selectOption("fire-bolt");
  await page.locator("#builderWizardNext").click(); // → classes & levels
  await page.locator("#builderWizardNext").click(); // → class choices
  await page.locator("#builderWizardNext").click(); // → abilities
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  const abilityValues = { Str: "10", Dex: "14", Con: "13", Int: "15", Wis: "12", Cha: "8" };
  for (const [suffix, value] of Object.entries(abilityValues)) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click(); // → spells
  await page.locator("#builderWizardNext").click(); // → equipment
  await page.locator("#builderWizardNext").click(); // → summary

  // The summary shows the chosen cantrip cast with Intelligence.
  await expect(page.locator("#builderWizardSummary")).toContainText("Granted Spells");
  await expect(page.locator("#builderWizardSummary")).toContainText("Fire Bolt (Intelligence)");

  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  // The granted cantrip is on the sheet, and INT drives the spell save DC
  // (8 + prof 2 + INT mod +3 = 13).
  await expect.poll(async () => grantedCantripNames(await readActiveCharacter(page))).toContain("fire-bolt");
  await expect.poll(async () => (await readActiveCharacter(page))?.spellDC).toBe(13);

  // Survives a full reload.
  await page.waitForTimeout(1500);
  await page.reload();
  await waitForAppShell(page);
  await page.getByRole("tab", { name: "Character" }).click();
  await expect.poll(async () => grantedCantripNames(await readActiveCharacter(page))).toContain("fire-bolt");

  await expectNoFatalSignals(page, fatalSignals);
});
