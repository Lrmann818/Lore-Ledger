import { expect, test } from "@playwright/test";
import {
  createCampaignFromHub,
  expectHubShell,
  expectNoFatalSignals,
  expectTrackerShell,
  openMapWorkspace,
  openSmokeApp,
  returnToHubFromSettings
} from "./helpers/smokeApp.js";

const STORAGE_KEY = "localCampaignTracker_v1";

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} expectedTitle
 */
async function waitForSavedCampaignTitle(page, expectedTitle) {
  await expect.poll(async () => page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      const activeCampaignId = parsed?.appShell?.activeCampaignId;
      if (!activeCampaignId) return null;
      return parsed?.campaignIndex?.entries?.[activeCampaignId]?.name ?? null;
    } catch {
      return null;
    }
  }, STORAGE_KEY)).toBe(expectedTitle);
}

test("first-run users land on the Campaign Hub and the empty state hides after creating a campaign", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);
  await expectHubShell(page);
  await expect(page.locator("#campaignTitle")).toHaveText("Lore Ledger");
  await expect(page.locator("#hubEmptyState")).toBeVisible();

  await createCampaignFromHub(page, "Smoke Test Chronicle");
  await returnToHubFromSettings(page);
  await expect(page.locator("#hubEmptyState")).toBeHidden();
  await expect(page.locator("#hubCampaignList")).toContainText("Smoke Test Chronicle");
  await page.getByRole("button", { name: "Open" }).click();

  await openMapWorkspace(page);
  await expect(page.locator("#mapSelect")).toHaveValue(/.+/);
  await expect(page.locator("#mapSelect option").first()).toHaveText("World Map");
  await expect(page.locator("#mapCanvas")).toBeVisible();

  await expectNoFatalSignals(page, fatalSignals);
});

test("campaign title survives a reload", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);
  const updatedTitle = "Smoke Test Chronicle";
  const campaignTitle = page.locator("#campaignTitle");

  await expectHubShell(page);
  await createCampaignFromHub(page, "Original Smoke Chronicle");
  await expectTrackerShell(page);
  await expect(campaignTitle).toHaveText("Original Smoke Chronicle");

  await campaignTitle.fill(updatedTitle);
  await expect(campaignTitle).toHaveText(updatedTitle);

  await waitForSavedCampaignTitle(page, updatedTitle);

  await page.reload();

  await expectTrackerShell(page);
  await expect(page.locator("#campaignTitle")).toHaveText(updatedTitle);

  await expectNoFatalSignals(page, fatalSignals);
});

test("Hub is reachable from Settings rather than the topbar", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  await expectHubShell(page);
  await expect(page.getByRole("tab", { name: "Hub" })).toHaveCount(0);

  await createCampaignFromHub(page, "Settings Route Chronicle");
  await expect(page.locator("#campaignTabs")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Hub" })).toHaveCount(0);

  await returnToHubFromSettings(page);
  await expect(page.locator("#hubCampaignList")).toContainText("Settings Route Chronicle");

  await expectNoFatalSignals(page, fatalSignals);
});

test("hub supports rename and active delete safely, including the last-campaign empty state", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);
  const originalName = "Hub Smoke Chronicle";
  const renamedName = "Renamed Hub Chronicle";

  await expectHubShell(page);
  await createCampaignFromHub(page, originalName);

  await returnToHubFromSettings(page);
  await expect(page.locator("#hubCampaignList")).toContainText(originalName);

  await page.getByRole("button", { name: "Rename" }).click();
  await page.locator("#uiDialogInput").fill(renamedName);
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.locator("#hubCampaignList")).toContainText(renamedName);

  await page.getByRole("button", { name: "Open" }).click();
  await expectTrackerShell(page);
  await expect(page.locator("#campaignTitle")).toHaveText(renamedName);

  await returnToHubFromSettings(page);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.locator("#uiDialogInput").fill(renamedName);
  await page.locator("#uiDialogOk").click();

  await expectHubShell(page);
  await expect(page.locator("#campaignTitle")).toHaveText("Lore Ledger");
  await expect(page.locator("#hubEmptyState")).toBeVisible();
  await expect.poll(async () => page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!Object.prototype.hasOwnProperty.call(parsed?.appShell || {}, "activeCampaignId")) {
        return "missing";
      }
      return parsed.appShell.activeCampaignId;
    } catch {
      return "parse-error";
    }
  }, STORAGE_KEY)).toBeNull();

  await expectNoFatalSignals(page, fatalSignals);
});
