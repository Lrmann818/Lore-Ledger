import { expect, test } from "@playwright/test";
import { openSmokeApp } from "./helpers/smokeApp.js";

// Keyboard-only + 380px overflow verification for the structured attack editor.
test("attack editor is keyboard-operable and does not overflow at 380px", async ({ page }) => {
  await openSmokeApp(page, { campaignName: "Attack KB" });
  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await page.locator("#builderWizardName").fill("KB Hero");
  await page.locator("#builderWizardRace").selectOption("human");
  await page.locator("#builderWizardClass").selectOption("fighter");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  for (const [s, v] of Object.entries({ Str: "16", Dex: "14", Con: "13", Int: "12", Wis: "10", Cha: "8" })) {
    await page.locator(`#builderWizardAbility${s}`).fill(v);
  }
  await page.locator("#builderWizardNext").click();
  await page.locator('select[aria-label="Add a weapon"]').selectOption("longsword");
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  const row = page.locator(".attackRow").first();
  // Open the editor from the keyboard: focus the Edit button and press Enter.
  await row.getByRole("button", { name: "Edit weapon calculation" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".attackEditorPanel")).toBeVisible();

  // No horizontal overflow of the document at 380px.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // Tab stays trapped inside the dialog.
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  const trapped = await page.evaluate(() => !!document.activeElement?.closest(".attackEditorPanel"));
  expect(trapped).toBe(true);

  // Escape closes and returns focus to the opener, with no mutation.
  const before = await page.evaluate(() => {
    const c = globalThis.__APP_STATE__.characters;
    return JSON.stringify(c.entries.find((e) => e.id === c.activeId).attacks);
  });
  await page.keyboard.press("Escape");
  await expect(page.locator(".attackEditorPanel")).toBeHidden();
  await expect.poll(() => page.evaluate(() =>
    document.activeElement?.classList.contains("attackEditBtn"))).toBe(true);
  const after = await page.evaluate(() => {
    const c = globalThis.__APP_STATE__.characters;
    return JSON.stringify(c.entries.find((e) => e.id === c.activeId).attacks);
  });
  expect(after).toBe(before);
});
