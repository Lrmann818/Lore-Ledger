import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

async function installRestState(page) {
  await page.evaluate(async () => {
    const load = (path) => import(new URL(path, window.location.href).href);
    const [helpersMod, devMod] = await Promise.all([
      load("js/domain/characterHelpers.js"),
      load("js/utils/dev.js"),
    ]);
    const freeform = helpersMod.makeDefaultCharacterEntry("Unaffected Freeform");
    freeform.id = "char_rest_freeform";
    freeform.hpCur = 3;
    freeform.hpMax = 10;

    devMod.withAllowedStateMutation(() => {
      const collection = globalThis.__APP_STATE__.characters;
      const cleric = collection.entries.find((entry) => entry?.id === collection.activeId);
      cleric.hpCur = 4;
      cleric.hpMax = 16;
      cleric.rest = { hitDiceSpent: { "class:cleric": 1 }, preparedByClass: { cleric: ["cure-wounds"] } };
      cleric.deathSaves = { successes: 1, failures: 1 };
      cleric.build.spellcasting.cleric.preparedIds = ["cure-wounds"];
      collection.entries.push(freeform);
    });
  });
}

test("Long Rest prepared flow preserves No, applies Yes, and stays character-isolated", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Rest Smoke" });
  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill("Rest Cleric");
  await page.locator("#builderWizardRace").selectOption("half-orc");
  await page.locator("#builderWizardClass").selectOption("cleric");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepRaceChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClasses")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClassChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  for (const [suffix, value] of Object.entries({ Str: "10", Dex: "10", Con: "12", Int: "10", Wis: "16", Cha: "10" })) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();
  await installRestState(page);
  await expect(page.locator("#charName")).toHaveValue("Rest Cleric");

  await page.locator("#charLongRestBtn").click();
  await expect(page.locator("#characterRestOverlay")).toBeVisible();
  await expect(page.locator("#characterRestOverlay")).toContainText("Would you like to change your prepared spells?");
  await page.getByRole("button", { name: "Take Long Rest" }).click();
  await expect(page.locator("#characterRestOverlay")).toBeHidden();
  const afterNo = await page.evaluate(() => globalThis.__APP_STATE__.characters.entries.map((entry) => ({
    id: entry.id,
    isBuilder: !!entry.build,
    hpCur: entry.hpCur,
    prepared: entry.rest?.preparedByClass?.cleric || [],
    deathSaves: entry.deathSaves,
  })));
  expect(afterNo).toEqual(expect.arrayContaining([
    expect.objectContaining({ isBuilder: true, hpCur: 16, prepared: ["cure-wounds"], deathSaves: { successes: 0, failures: 0 } }),
    expect.objectContaining({ id: "char_rest_freeform", hpCur: 3 }),
  ]));

  await page.evaluate(async () => {
    const devMod = await import(new URL("js/utils/dev.js", window.location.href).href);
    devMod.withAllowedStateMutation(() => {
      const state = globalThis.__APP_STATE__;
      const cleric = state.characters.entries.find((entry) => entry?.build);
      cleric.hpCur = 5;
    });
  });
  await page.locator("#charLongRestBtn").click();
  await expect(page.locator("#characterRestOverlay")).toBeVisible();
  await page.locator('input[name="characterRestPreparedChoice"][value="yes"]').check();
  await page.locator('.characterRestSpellRow:has-text("Cure Wounds") input[type="checkbox"]').uncheck();
  await page.getByRole("button", { name: "Take Long Rest" }).click();
  await expect(page.locator("#characterRestOverlay")).toBeHidden();
  await expect.poll(() => page.evaluate(() => {
    const cleric = globalThis.__APP_STATE__.characters.entries.find((entry) => entry?.build);
    return { hpCur: cleric.hpCur, prepared: cleric.rest?.preparedByClass?.cleric || [] };
  })).toEqual({ hpCur: 16, prepared: [] });

  await expectNoFatalSignals(page, fatalSignals);
});
