import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

const FIXTURE_IMAGE = path.resolve("public/icons/favicon-32x32.png");

/**
 * @param {import("@playwright/test").Page} page
 */
async function openNpcPortraitChooser(page) {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#npcCards .npcPortraitTop").first().click();
  return chooserPromise;
}

test("npc portrait picking opens the cropper and updates after save", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  await page.getByRole("button", { name: "+ NPC" }).click();
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#npcCards .npcPortraitTop")).toContainText("Click to add image");

  const cancelChooser = await openNpcPortraitChooser(page);
  await cancelChooser.setFiles(FIXTURE_IMAGE);
  await expect(page.getByText("Crop portrait")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Crop portrait")).toHaveCount(0);
  await expect(page.locator("#npcCards .npcPortraitTop")).toContainText("Click to add image");
  await expect(page.locator("#npcCards .npcPortraitTop img")).toHaveCount(0);

  const saveChooser = await openNpcPortraitChooser(page);
  await saveChooser.setFiles(FIXTURE_IMAGE);
  await expect(page.getByText("Crop portrait")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Crop portrait")).toHaveCount(0);
  await expect(page.locator("#npcCards .npcPortraitTop img")).toHaveCount(1);
  await expect(page.locator("#npcCards .npcPortraitTop")).not.toContainText("Click to add image");

  await expectNoFatalSignals(page, fatalSignals);
});
