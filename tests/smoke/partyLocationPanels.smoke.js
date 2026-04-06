import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, expectTrackerShell, openSmokeApp } from "./helpers/smokeApp.js";

const FIXTURE_IMAGE = path.resolve("public/icons/favicon-32x32.png");

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} panelSelector
 */
async function openPortraitChooser(page, panelSelector) {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator(`${panelSelector} .npcPortraitTop`).first().click();
  return chooserPromise;
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} buttonSelector
 * @param {string} name
 */
async function addSection(page, buttonSelector, name) {
  await page.locator(buttonSelector).click();
  await expect(page.locator("#uiDialogOverlay")).toBeVisible();
  await page.locator("#uiDialogInput").fill(name);
  await page.locator("#uiDialogOk").click();
  await expect(page.locator("#uiDialogOverlay")).toBeHidden();
}

/**
 * @param {import("@playwright/test").Locator} panelCards
 * @returns {Promise<string[]>}
 */
async function getCardNames(panelCards) {
  return panelCards.locator(".npcNameBig").evaluateAll((els) => els.map((el) => el.value));
}

test("party panel keeps portrait, search, section, reorder, and collapse behavior after controller scoping", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  await page.locator("#addPartyBtn").click();
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#partyCards .npcPortraitTop")).toContainText("Click to add image");

  const cancelChooser = await openPortraitChooser(page, "#partyCards");
  await cancelChooser.setFiles(FIXTURE_IMAGE);
  await expect(page.getByText("Crop portrait")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Crop portrait")).toHaveCount(0);
  await expect(page.locator("#partyCards .npcPortraitTop")).toContainText("Click to add image");
  await expect(page.locator("#partyCards .npcPortraitTop img")).toHaveCount(0);

  const saveChooser = await openPortraitChooser(page, "#partyCards");
  await saveChooser.setFiles(FIXTURE_IMAGE);
  await expect(page.getByText("Crop portrait")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Crop portrait")).toHaveCount(0);
  await expect(page.locator("#partyCards .npcPortraitTop img")).toHaveCount(1);
  await expect(page.locator("#statusText")).toContainText("Saved locally.");

  await page.reload();
  await expectTrackerShell(page);
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#partyCards .npcPortraitTop img")).toHaveCount(1);

  const firstPartyCard = page.locator("#partyCards .trackerCard").first();
  await firstPartyCard.locator(".npcNameBig").fill("Alpha");
  await expect(firstPartyCard.locator(".npcNameBig")).toHaveValue("Alpha");

  await page.locator("#addPartyBtn").click();
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(2);
  await page.locator("#partyCards .trackerCard").first().locator(".npcNameBig").fill("Beta");
  await expect.poll(() => getCardNames(page.locator("#partyCards"))).toEqual(["Beta", "Alpha"]);

  await page.locator("#partySearch").fill("Beta");
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#partyCards .trackerCard .npcNameBig")).toHaveValue("Beta");
  await page.locator("#partySearch").fill("");
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(2);

  await page.locator("#partyCards .trackerCard").first().getByTitle("Move card down").click();
  await expect.poll(() => getCardNames(page.locator("#partyCards"))).toEqual(["Alpha", "Beta"]);

  const topPartyCard = page.locator("#partyCards .trackerCard").first();
  await topPartyCard.locator(".cardCollapseBtn").click();
  await expect(topPartyCard.locator(".npcCollapsible")).toBeHidden();
  await expect(topPartyCard.locator(".npcCardFooter")).toBeHidden();
  await topPartyCard.locator(".cardCollapseBtn").click();
  await expect(topPartyCard.locator(".npcCollapsible")).toBeVisible();
  await expect(topPartyCard.locator(".npcCardFooter")).toBeVisible();

  await addSection(page, "#addPartySectionBtn", "Travel");
  await expect(page.locator("#partyTabs")).toContainText("Travel");
  await page.locator("#partyTabs").getByRole("tab", { name: "Main" }).click();
  await topPartyCard.locator(".npcCardFooter select.cardSelect").selectOption({ label: "Travel" });
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(1);
  await page.locator("#partyTabs").getByRole("tab", { name: "Travel" }).click();
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#partyCards .trackerCard .npcNameBig")).toHaveValue("Alpha");

  await expectNoFatalSignals(page, fatalSignals);
});

test("location panel keeps portrait, filter, section, reorder, and collapse behavior after controller scoping", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  await page.locator("#addLocBtn").click();
  await expect(page.locator("#locCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#locCards .npcPortraitTop")).toContainText("Click to add image");

  const cancelChooser = await openPortraitChooser(page, "#locCards");
  await cancelChooser.setFiles(FIXTURE_IMAGE);
  await expect(page.getByText("Crop portrait")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Crop portrait")).toHaveCount(0);
  await expect(page.locator("#locCards .npcPortraitTop")).toContainText("Click to add image");
  await expect(page.locator("#locCards .npcPortraitTop img")).toHaveCount(0);

  const saveChooser = await openPortraitChooser(page, "#locCards");
  await saveChooser.setFiles(FIXTURE_IMAGE);
  await expect(page.getByText("Crop portrait")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Crop portrait")).toHaveCount(0);
  await expect(page.locator("#locCards .npcPortraitTop img")).toHaveCount(1);
  await expect(page.locator("#statusText")).toContainText("Saved locally.");

  await page.reload();
  await expectTrackerShell(page);
  await expect(page.locator("#locCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#locCards .npcPortraitTop img")).toHaveCount(1);

  const firstLocCard = page.locator("#locCards .trackerCard").first();
  await firstLocCard.locator(".npcNameBig").fill("Harbor");
  await expect(firstLocCard.locator(".npcNameBig")).toHaveValue("Harbor");

  await page.locator("#addLocBtn").click();
  await expect(page.locator("#locCards .trackerCard")).toHaveCount(2);
  const newestLocCard = page.locator("#locCards .trackerCard").first();
  await newestLocCard.locator(".npcNameBig").fill("Ruins");
  await newestLocCard.locator("select.cardSelect").first().selectOption("dungeon");
  await expect.poll(() => getCardNames(page.locator("#locCards"))).toEqual(["Ruins", "Harbor"]);

  await page.locator("#locSearch").fill("Ruins");
  await expect(page.locator("#locCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#locCards .trackerCard .npcNameBig")).toHaveValue("Ruins");
  await page.locator("#locSearch").fill("");
  await expect(page.locator("#locCards .trackerCard")).toHaveCount(2);

  await page.locator("#locFilter").selectOption("dungeon");
  await expect(page.locator("#locCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#locCards .trackerCard .npcNameBig")).toHaveValue("Ruins");
  await page.locator("#locFilter").selectOption("all");
  await expect(page.locator("#locCards .trackerCard")).toHaveCount(2);

  await page.locator("#locCards .trackerCard").first().getByTitle("Move card down").click();
  await expect.poll(() => getCardNames(page.locator("#locCards"))).toEqual(["Harbor", "Ruins"]);

  const topLocCard = page.locator("#locCards .trackerCard").first();
  await topLocCard.locator(".cardCollapseBtn").click();
  await expect(topLocCard.locator(".npcCollapsible")).toBeHidden();
  await expect(topLocCard.locator(".npcCardFooter")).toBeHidden();
  await topLocCard.locator(".cardCollapseBtn").click();
  await expect(topLocCard.locator(".npcCollapsible")).toBeVisible();
  await expect(topLocCard.locator(".npcCardFooter")).toBeVisible();

  await addSection(page, "#addLocSectionBtn", "Travel");
  await expect(page.locator("#locTabs")).toContainText("Travel");
  await page.locator("#locTabs").getByRole("tab", { name: "Main" }).click();
  await topLocCard.locator(".npcCardFooter select.cardSelect").selectOption({ label: "Travel" });
  await expect(page.locator("#locCards .trackerCard")).toHaveCount(1);
  await page.locator("#locTabs").getByRole("tab", { name: "Travel" }).click();
  await expect(page.locator("#locCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#locCards .trackerCard .npcNameBig")).toHaveValue("Harbor");

  await expectNoFatalSignals(page, fatalSignals);
});
