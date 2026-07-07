import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

// Builder wizard happy path: create a Dragonborn fighter through every
// wizard step (identity → race & background choices → classes & levels →
// class choices → abilities → equipment → summary), Finish, and verify the
// sheet is seeded (features/languages text, derived Breath Weapon card,
// Builder Summary) and that the builder character persists across a full
// reload.

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
  await page.locator("#builderWizardClass").selectOption("fighter");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click();

  // Step 2 — race & background choices (Dragonborn ancestry is required).
  await expect(page.locator("#builderWizardStepRaceChoices")).toBeVisible();
  await page.locator("#builderWizardDraconicAncestry").selectOption("black");
  // The choice preview reflects the ancestry-derived mechanics.
  await expect(page.locator("#builderWizardRaceChoicePreview")).toContainText("Black");
  await page.locator("#builderWizardNext").click();

  // Step 3 — classes & levels (fighter block seeded from identity).
  await expect(page.locator("#builderWizardStepClasses")).toBeVisible();
  await expect(page.locator("#builderWizardClassesBody")).toContainText("Character Level: 1");
  await page.locator("#builderWizardNext").click();

  // Step 4 — class choices (fighter skills + fighting style).
  await expect(page.locator("#builderWizardStepClassChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();

  // Step 5 — abilities (manual method is the default).
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  const abilityValues = { Str: "15", Dex: "14", Con: "13", Int: "12", Wis: "10", Cha: "8" };
  for (const [suffix, value] of Object.entries(abilityValues)) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click();

  // Step 6 — equipment (fighter is not a caster, so no spells step).
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator("#builderWizardNext").click();

  // Step 7 — summary review, then Finish.
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await expect(page.locator("#builderWizardSummary")).toContainText("Dragonborn");
  await expect(page.locator("#builderWizardSummary")).toContainText("Fighter 1");
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  // The created character is active, in builder mode, with the chosen
  // level-by-level build.
  const created = await readActiveCharacter(page);
  expect(created).not.toBeNull();
  expect(created.name).toBe("Smoke Dragonborn");
  expect(created.build).not.toBeNull();
  expect(created.build.raceId).toBe("dragonborn");
  expect(created.build.backgroundId).toBe("acolyte");
  expect(created.build.levels).toEqual([{ classId: "fighter", hp: null }]);

  // Finish-time seeding landed in the user-owned sheet fields.
  await expect(page.locator("#charFeatures")).toHaveValue(/Dragonborn Traits/);
  await expect(page.locator("#charFeatures")).toHaveValue(/Draconic Ancestry: Black/);
  await expect(page.locator("#charFeatures")).toHaveValue(/resistance to acid damage/);
  await expect(page.locator("#charFeatures")).toHaveValue(/Second Wind \(Fighter 1\)/);
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
  expect(restored.build.levels).toEqual([{ classId: "fighter", hp: null }]);
  expect(restored.manualFeatureCards).toEqual([]);

  await expectNoFatalSignals(page, fatalSignals);
});
