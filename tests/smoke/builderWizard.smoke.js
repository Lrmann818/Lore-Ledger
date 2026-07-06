import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

// Builder wizard happy path: create a Dragonborn through every wizard step,
// Finish, and verify the sheet is seeded (features/languages text, derived
// Breath Weapon card, Builder Summary) and that the builder character
// persists across a full reload.

async function readActiveCharacter(page) {
  return page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const entries = Array.isArray(collection?.entries) ? collection.entries : [];
    const character = entries.find((entry) => entry?.id === collection?.activeId);
    return character ? JSON.parse(JSON.stringify(character)) : null;
  });
}

test("builder wizard dragonborn happy path seeds the character sheet", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Wizard Smoke" });

  await page.getByRole("tab", { name: "Character" }).click();

  // Open the wizard through the character action menu.
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await expect(page.locator("#builderWizardStepIdentity")).toBeVisible();

  // Step 1 — identity.
  await page.locator("#builderWizardName").fill("Smoke Dragonborn");
  await page.locator("#builderWizardRace").selectOption("dragonborn");
  await page.locator("#builderWizardClass").selectOption("class_fighter");
  await page.locator("#builderWizardBackground").selectOption("background_soldier");
  await page.locator("#builderWizardNext").click();

  // Step 2 — race choices (only shown for Dragonborn).
  await expect(page.locator("#builderWizardStepRaceChoices")).toBeVisible();
  await page.locator("#builderWizardDraconicAncestry").selectOption("black");
  // The choice preview reflects the ancestry-derived mechanics.
  await expect(page.locator("#builderWizardRaceChoicePreview")).toContainText("Black");
  await page.locator("#builderWizardNext").click();

  // Step 3 — abilities (manual method is the default).
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  const abilityValues = { Str: "15", Dex: "14", Con: "13", Int: "12", Wis: "10", Cha: "8" };
  for (const [suffix, value] of Object.entries(abilityValues)) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click();

  // Step 4 — summary review, then Finish.
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await expect(page.locator("#builderWizardSummary")).toContainText("Dragonborn");
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  // The created character is active, in builder mode, with the chosen build.
  const created = await readActiveCharacter(page);
  expect(created).not.toBeNull();
  expect(created.name).toBe("Smoke Dragonborn");
  expect(created.build).not.toBeNull();
  expect(created.build.raceId).toBe("dragonborn");
  expect(created.build.classId).toBe("class_fighter");
  expect(created.build.backgroundId).toBe("background_soldier");

  // Finish-time seeding landed in the user-owned sheet fields.
  await expect(page.locator("#charFeatures")).toHaveValue(/Dragonborn Traits/);
  await expect(page.locator("#charFeatures")).toHaveValue(/Draconic Ancestry: Black/);
  await expect(page.locator("#charFeatures")).toHaveValue(/resistance to acid damage/);
  await expect(page.locator("#charLanguages")).toHaveValue(/Draconic/);

  // Derived Breath Weapon card renders in Abilities & Features, and the
  // Builder Summary panel is shown for builder characters.
  await expect(page.locator("#charAbilitiesFeaturesList")).toContainText("Breath Weapon");
  await expect(page.locator("#charBuilderSummaryPanel")).toBeVisible();

  // The seeded sheet survives a full reload (persistence round trip).
  await page.waitForTimeout(1500);
  await page.reload();
  await page.getByRole("tab", { name: "Character" }).click();
  await expect(page.locator("#charFeatures")).toHaveValue(/Draconic Ancestry: Black/);
  const restored = await readActiveCharacter(page);
  expect(restored.build).not.toBeNull();
  expect(restored.build.raceId).toBe("dragonborn");
  expect(restored.manualFeatureCards).toEqual([]);

  await expectNoFatalSignals(page, fatalSignals);
});
