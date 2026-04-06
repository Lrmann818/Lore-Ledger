import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, expectTrackerShell, openSmokeApp } from "./helpers/smokeApp.js";

const FIXTURE_IMAGE = path.resolve("public/icons/favicon-32x32.png");

/**
 * @param {import("@playwright/test").Page} page
 */
async function openNpcPortraitChooser(page) {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#npcCards .npcPortraitTop").first().click();
  return chooserPromise;
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
async function addNpcSection(page, name) {
  await page.locator("#addNpcSectionBtn").click();
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

test("npc panel keeps portrait toggle, search, section move, reorder, and collapse behavior after incremental patch extraction", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  await page.locator("#addNpcBtn").click();
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);
  const firstNpcCard = page.locator("#npcCards .trackerCard").first();
  const firstNpcCardId = await firstNpcCard.getAttribute("data-card-id");
  if (!firstNpcCardId) throw new Error("Expected first NPC card id");

  await firstNpcCard.locator(".cardPortraitToggleBtnOverlay").click();
  await expect(firstNpcCard.locator(".npcPortraitTop")).toHaveCount(0);
  await expect(firstNpcCard.locator(".cardPortraitToggleBtnHeader")).toHaveCount(1);
  await expectActiveControlInCard(page, {
    cardId: firstNpcCardId,
    className: "cardPortraitToggleBtnHeader",
    title: "Show image",
  });

  await firstNpcCard.locator(".cardPortraitToggleBtnHeader").click();
  await expect(firstNpcCard.locator(".npcPortraitTop")).toHaveCount(1);
  await expect(firstNpcCard.locator(".cardPortraitToggleBtnOverlay")).toHaveCount(1);
  await expectActiveControlInCard(page, {
    cardId: firstNpcCardId,
    className: "cardPortraitToggleBtnOverlay",
    title: "Hide image",
  });

  const saveChooser = await openNpcPortraitChooser(page);
  await saveChooser.setFiles(FIXTURE_IMAGE);
  await expect(page.getByText("Crop portrait")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Crop portrait")).toHaveCount(0);
  await expect(firstNpcCard.locator(".npcPortraitTop img")).toHaveCount(1);

  await page.reload();
  await expectTrackerShell(page);
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#npcCards .npcPortraitTop img")).toHaveCount(1);

  const reloadedFirstNpcCard = page.locator("#npcCards .trackerCard").first();
  await reloadedFirstNpcCard.locator(".npcNameBig").fill("Alpha");
  await expect(reloadedFirstNpcCard.locator(".npcNameBig")).toHaveValue("Alpha");

  await page.locator("#addNpcBtn").click();
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(2);
  await page.locator("#npcCards .trackerCard").first().locator(".npcNameBig").fill("Beta");
  await expect.poll(() => getCardNames(page.locator("#npcCards"))).toEqual(["Beta", "Alpha"]);

  await page.locator("#npcSearch").fill("Beta");
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#npcCards .trackerCard .npcNameBig")).toHaveValue("Beta");
  await page.locator("#npcSearch").fill("");
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(2);

  const movedNpcCard = page.locator("#npcCards .trackerCard").first();
  const movedNpcCardId = await movedNpcCard.getAttribute("data-card-id");
  if (!movedNpcCardId) throw new Error("Expected moved NPC card id");
  await movedNpcCard.getByTitle("Move card down").click();
  await expect.poll(() => getCardNames(page.locator("#npcCards"))).toEqual(["Alpha", "Beta"]);
  await expectActiveControlInCard(page, {
    cardId: movedNpcCardId,
    className: "moveBtn",
    title: "Move card down",
  });

  const topNpcCard = page.locator("#npcCards .trackerCard").first();
  const topNpcCardId = await topNpcCard.getAttribute("data-card-id");
  if (!topNpcCardId) throw new Error("Expected top NPC card id");
  await topNpcCard.locator(".cardCollapseBtn").click();
  await expect(topNpcCard.locator(".npcCollapsible")).toBeHidden();
  await expect(topNpcCard.locator(".npcCardFooter")).toBeHidden();
  await expectActiveControlInCard(page, {
    cardId: topNpcCardId,
    className: "cardCollapseBtn",
  });
  await topNpcCard.locator(".cardCollapseBtn").click();
  await expect(topNpcCard.locator(".npcCollapsible")).toBeVisible();
  await expect(topNpcCard.locator(".npcCardFooter")).toBeVisible();
  await expectActiveControlInCard(page, {
    cardId: topNpcCardId,
    className: "cardCollapseBtn",
  });

  await addNpcSection(page, "Travel");
  await expect(page.locator("#npcTabs")).toContainText("Travel");
  await page.locator("#npcTabs").getByRole("tab", { name: "Friendly" }).click();
  await topNpcCard.locator(".npcCardFooter select.cardSelect").selectOption({ label: "Travel" });
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);
  await page.locator("#npcTabs").getByRole("tab", { name: "Travel" }).click();
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#npcCards .trackerCard .npcNameBig")).toHaveValue("Alpha");

  await expectNoFatalSignals(page, fatalSignals);
});
