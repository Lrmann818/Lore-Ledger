import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp, waitForAppShell } from "./helpers/smokeApp.js";

// Custom content authoring (matrix #15): author a custom spell entirely
// through the Manage Custom Content form, verify inline validation keeps
// typed input, the saved record registers (list row + summary count),
// survives a full reload, and appears in the builder wizard's class spell
// picker via its classIds.

test("custom spell authored through the manager reaches the builder spell picker", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Custom Content Smoke" });

  // Author the spell: Data & Settings → Custom Content → Manage.
  await page.locator("#settingsBtn").click();
  await expect(page.locator("#dataPanelPanel")).toBeVisible();
  await page.locator("#dataCustomContentManageBtn").click();
  await expect(page.locator("#customContentPanel")).toBeVisible();
  await expect(page.locator("#customContentBody")).toContainText("no custom content yet");

  await page.getByRole("button", { name: "New Spell" }).click();
  await page.locator("#customContentInput-name").fill("Smoke Bolt");

  // Saving too early reports inline plain-language errors and keeps input.
  await page.getByRole("button", { name: "Save Spell" }).click();
  await expect(page.locator("#customContentError-school")).toBeVisible();
  await expect(page.locator("#customContentInput-name")).toHaveValue("Smoke Bolt");

  await page.locator("#customContentInput-level").selectOption("1");
  await page.locator("#customContentInput-school").selectOption("evocation");
  await page.locator("#customContentInput-range").fill("60 feet");
  await page.locator("#customContentInput-duration").fill("Instantaneous");
  await page.locator("#customContentInput-desc").fill("A bolt of thick smoke slams into one target.");
  await page.locator('#customContentBody [data-checklist="classIds"] input[value="wizard"]').check();
  await page.getByRole("button", { name: "Save Spell" }).click();

  await expect(page.locator("#customContentBody")).toContainText("spell:smoke-bolt");
  await expect(page.locator("#dataCustomContentSummary")).toContainText("1 custom record");

  await page.locator("#customContentClose").click();
  await expect(page.locator("#customContentPanel")).toBeHidden();
  await page.locator("#dataPanelClose").click();

  // Persistence: the record survives a full reload.
  await page.waitForTimeout(1500);
  await page.reload();
  await waitForAppShell(page);
  const customAfterReload = await page.evaluate(
    () => JSON.parse(JSON.stringify(globalThis.__APP_STATE__?.content?.custom ?? []))
  );
  expect(customAfterReload).toHaveLength(1);
  expect(customAfterReload[0]).toMatchObject({
    id: "smoke-bolt",
    kind: "spell",
    name: "Smoke Bolt",
    source: "custom",
    level: 1,
    classIds: ["wizard"]
  });

  // The authored spell shows up in the builder wizard's Wizard spell picker.
  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill("Smoke Caster");
  await page.locator("#builderWizardRace").selectOption("human");
  await page.locator("#builderWizardClass").selectOption("wizard");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click(); // → race & background choices
  await page.locator("#builderWizardNext").click(); // → classes & levels
  await page.locator("#builderWizardNext").click(); // → class choices
  await page.locator("#builderWizardNext").click(); // → abilities
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  const abilityValues = { Str: "8", Dex: "14", Con: "13", Int: "15", Wis: "12", Cha: "10" };
  for (const [suffix, value] of Object.entries(abilityValues)) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click(); // → spells (wizard is a caster)
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  await page.locator('input[aria-label="Filter Wizard spells"]').fill("Smoke Bolt");
  await expect(page.locator("#builderWizardStepSpells")).toContainText("Smoke Bolt");
  await page.locator("#builderWizardCancel").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  await expectNoFatalSignals(page, fatalSignals);
});
