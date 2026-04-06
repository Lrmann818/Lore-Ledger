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

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ cardId: string, className: string, title?: string }} expected
 */
async function expectActiveControlInCard(page, { cardId, className, title } = {}) {
  await expect.poll(() => page.evaluate(({ cardId, className, title }) => {
    const active = document.activeElement;
    const activeCardId = active?.closest(".trackerCard")?.dataset.cardId || null;
    const matchesClass = !!active?.classList?.contains(className);
    const matchesTitle = title ? active?.getAttribute?.("title") === title : true;
    return activeCardId === cardId && matchesClass && matchesTitle;
  }, { cardId, className, title })).toBe(true);
}

test("party panel keeps portrait, search, section, reorder, and collapse behavior after controller scoping", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  await page.locator("#addPartyBtn").click();
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#partyCards .npcPortraitTop")).toContainText("Click to add image");
  const firstPartyCard = page.locator("#partyCards .trackerCard").first();
  const firstPartyCardId = await firstPartyCard.getAttribute("data-card-id");
  if (!firstPartyCardId) throw new Error("Expected first party card id");

  await firstPartyCard.locator(".cardPortraitToggleBtnOverlay").click();
  await expect(firstPartyCard.locator(".npcPortraitTop")).toHaveCount(0);
  await expect(firstPartyCard.locator(".cardPortraitToggleBtnHeader")).toHaveCount(1);
  await expectActiveControlInCard(page, {
    cardId: firstPartyCardId,
    className: "cardPortraitToggleBtnHeader",
    title: "Show image",
  });

  await firstPartyCard.locator(".cardPortraitToggleBtnHeader").click();
  await expect(firstPartyCard.locator(".npcPortraitTop")).toHaveCount(1);
  await expect(firstPartyCard.locator(".cardPortraitToggleBtnOverlay")).toHaveCount(1);
  await expectActiveControlInCard(page, {
    cardId: firstPartyCardId,
    className: "cardPortraitToggleBtnOverlay",
    title: "Hide image",
  });

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

  const reloadedFirstPartyCard = page.locator("#partyCards .trackerCard").first();
  await reloadedFirstPartyCard.locator(".npcNameBig").fill("Alpha");
  await expect(reloadedFirstPartyCard.locator(".npcNameBig")).toHaveValue("Alpha");

  await page.locator("#addPartyBtn").click();
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(2);
  await page.locator("#partyCards .trackerCard").first().locator(".npcNameBig").fill("Beta");
  await expect.poll(() => getCardNames(page.locator("#partyCards"))).toEqual(["Beta", "Alpha"]);

  await page.locator("#partySearch").fill("Beta");
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#partyCards .trackerCard .npcNameBig")).toHaveValue("Beta");
  await page.locator("#partySearch").fill("");
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(2);

  const movedPartyCard = page.locator("#partyCards .trackerCard").first();
  const movedPartyCardId = await movedPartyCard.getAttribute("data-card-id");
  if (!movedPartyCardId) throw new Error("Expected moved party card id");
  await movedPartyCard.getByTitle("Move card down").click();
  await expect.poll(() => getCardNames(page.locator("#partyCards"))).toEqual(["Alpha", "Beta"]);
  await expectActiveControlInCard(page, {
    cardId: movedPartyCardId,
    className: "moveBtn",
    title: "Move card down",
  });

  const topPartyCard = page.locator("#partyCards .trackerCard").first();
  const topPartyCardId = await topPartyCard.getAttribute("data-card-id");
  if (!topPartyCardId) throw new Error("Expected top party card id");
  await topPartyCard.locator(".cardCollapseBtn").click();
  await expect(topPartyCard.locator(".npcCollapsible")).toBeHidden();
  await expect(topPartyCard.locator(".npcCardFooter")).toBeHidden();
  await expectActiveControlInCard(page, {
    cardId: topPartyCardId,
    className: "cardCollapseBtn",
  });
  await topPartyCard.locator(".cardCollapseBtn").click();
  await expect(topPartyCard.locator(".npcCollapsible")).toBeVisible();
  await expect(topPartyCard.locator(".npcCardFooter")).toBeVisible();
  await expectActiveControlInCard(page, {
    cardId: topPartyCardId,
    className: "cardCollapseBtn",
  });

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
  const firstLocCard = page.locator("#locCards .trackerCard").first();
  const firstLocCardId = await firstLocCard.getAttribute("data-card-id");
  if (!firstLocCardId) throw new Error("Expected first location card id");

  await firstLocCard.locator(".cardPortraitToggleBtnOverlay").click();
  await expect(firstLocCard.locator(".npcPortraitTop")).toHaveCount(0);
  await expect(firstLocCard.locator(".cardPortraitToggleBtnHeader")).toHaveCount(1);
  await expectActiveControlInCard(page, {
    cardId: firstLocCardId,
    className: "cardPortraitToggleBtnHeader",
    title: "Show image",
  });

  await firstLocCard.locator(".cardPortraitToggleBtnHeader").click();
  await expect(firstLocCard.locator(".npcPortraitTop")).toHaveCount(1);
  await expect(firstLocCard.locator(".cardPortraitToggleBtnOverlay")).toHaveCount(1);
  await expectActiveControlInCard(page, {
    cardId: firstLocCardId,
    className: "cardPortraitToggleBtnOverlay",
    title: "Hide image",
  });

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

  const reloadedFirstLocCard = page.locator("#locCards .trackerCard").first();
  await reloadedFirstLocCard.locator(".npcNameBig").fill("Harbor");
  await expect(reloadedFirstLocCard.locator(".npcNameBig")).toHaveValue("Harbor");

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

  const movedLocCard = page.locator("#locCards .trackerCard").first();
  const movedLocCardId = await movedLocCard.getAttribute("data-card-id");
  if (!movedLocCardId) throw new Error("Expected moved location card id");
  await movedLocCard.getByTitle("Move card down").click();
  await expect.poll(() => getCardNames(page.locator("#locCards"))).toEqual(["Harbor", "Ruins"]);
  await expectActiveControlInCard(page, {
    cardId: movedLocCardId,
    className: "moveBtn",
    title: "Move card down",
  });

  const topLocCard = page.locator("#locCards .trackerCard").first();
  const topLocCardId = await topLocCard.getAttribute("data-card-id");
  if (!topLocCardId) throw new Error("Expected top location card id");
  await topLocCard.locator(".cardCollapseBtn").click();
  await expect(topLocCard.locator(".npcCollapsible")).toBeHidden();
  await expect(topLocCard.locator(".npcCardFooter")).toBeHidden();
  await expectActiveControlInCard(page, {
    cardId: topLocCardId,
    className: "cardCollapseBtn",
  });
  await topLocCard.locator(".cardCollapseBtn").click();
  await expect(topLocCard.locator(".npcCollapsible")).toBeVisible();
  await expect(topLocCard.locator(".npcCardFooter")).toBeVisible();
  await expectActiveControlInCard(page, {
    cardId: topLocCardId,
    className: "cardCollapseBtn",
  });

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
