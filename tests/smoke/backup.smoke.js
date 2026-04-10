import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

/**
 * @param {import("@playwright/test").Page} page
 */
async function openDataPanel(page) {
  await page.getByRole("button", { name: "Data & Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Data & Settings" })).toBeVisible();
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ title: string | RegExp, message: string | RegExp }} expected
 */
async function expectAppDialog(page, expected) {
  const overlay = page.locator("#uiDialogOverlay").filter({ has: page.locator(".uiDialogPanel") });
  await expect(overlay).toBeVisible();
  await expect(overlay.locator("#uiDialogTitle")).toHaveText(expected.title);
  await expect(overlay.locator("#uiDialogMessage")).toHaveText(expected.message);
  return overlay;
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ name: string, mimeType?: string, contents: string }} file
 */
async function importBackupFile(page, file) {
  await page.locator("#dataImportFile").setInputFiles({
    name: file.name,
    mimeType: file.mimeType ?? "application/json",
    buffer: Buffer.from(file.contents, "utf8")
  });
}

test("backup export round-trips tracker data into a fresh browser context", async ({ page, browser }, testInfo) => {
  const fatalSignals = await openSmokeApp(page);
  const campaignTitle = "Smoke Backup Chronicle";
  const npcName = "Roundtrip Scout";

  await page.locator("#campaignTitle").fill(campaignTitle);
  await expect(page.locator("#campaignTitle")).toHaveText(campaignTitle);

  await page.getByRole("button", { name: "+ NPC" }).click();
  await expect(page.locator(".npcNameBig")).toHaveCount(1);
  await page.locator(".npcNameBig").first().fill(npcName);
  await expect(page.locator(".npcNameBig").first()).toHaveValue(npcName);

  await openDataPanel(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Backup (.json)" }).click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(backupPath);

  expect(download.suggestedFilename()).toMatch(/^campaign-backup-\d{4}-\d{2}-\d{2}\.json$/);

  const exported = JSON.parse(await readFile(backupPath, "utf8"));
  expect(exported.version).toBe(2);
  expect(exported.state?.tracker?.campaignTitle).toBe(campaignTitle);
  expect(exported.state?.tracker?.npcs?.[0]?.name).toBe(npcName);

  const baseURL = testInfo.project.use.baseURL ?? "http://127.0.0.1:4173/";
  const importContext = await browser.newContext({ baseURL });

  try {
    const importPage = await importContext.newPage();
    const importSignals = await openSmokeApp(importPage, { ensureCampaign: false });

    await expect(importPage.locator("#page-hub")).toBeVisible();
    await openDataPanel(importPage);

    await importPage.locator("#dataImportFile").setInputFiles(backupPath);

    const importDialog = await expectAppDialog(importPage, {
      title: "Import complete",
      message: /did not include images/i
    });
    await importDialog.getByRole("button", { name: "OK" }).click();

    await expect(importPage.locator("#campaignTitle")).toHaveText(campaignTitle);
    await expect(importPage.locator(".npcNameBig").first()).toHaveValue(npcName);

    await expectNoFatalSignals(importPage, importSignals);
  } finally {
    await importContext.close();
  }

  await expectNoFatalSignals(page, fatalSignals);
});

test("invalid backup import leaves existing data untouched", async ({ page }) => {
  await openSmokeApp(page);
  await openDataPanel(page);

  await importBackupFile(page, {
    name: "invalid-backup.json",
    contents: "{ definitely not json"
  });

  const dialog = await expectAppDialog(page, {
    title: "Import failed",
    message: /valid json/i
  });
  await dialog.getByRole("button", { name: "OK" }).click();

  await expect(page.locator("#campaignTitle")).toHaveText("My Campaign");
});
