import { expect, test } from "@playwright/test";

import {
  createCampaignFromHub,
  expectHubShell,
  expectNoFatalSignals,
  expectTrackerShell,
  openSmokeApp
} from "./helpers/smokeApp.js";

const MIN_NATIVE_SPLASH_MS = 1800;

async function installNativeLaunchStub(page) {
  await page.addInitScript(() => {
    window.Capacitor = {
      isNativePlatform: () => true
    };
  });
}

test("native-style launches keep the splash up through the managed minimum before revealing the app shell", async ({ page }) => {
  await installNativeLaunchStub(page);
  const startedAt = Date.now();

  await page.goto("/");
  await expect(page.locator("#appSplash")).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.locator("#appSplash")).toBeVisible();
  await page.waitForFunction(() => document.getElementById("appSplash")?.hidden === true);

  const elapsed = await page.evaluate(() => performance.now() - (window.__APP_BOOT_STARTED_AT__ ?? 0));
  expect(elapsed).toBeGreaterThanOrEqual(MIN_NATIVE_SPLASH_MS - 25);
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(700);
  await expectHubShell(page);
});

test("native-style restores reveal the active campaign shell without leaving the Hub visible after splash handoff", async ({ page }) => {
  await installNativeLaunchStub(page);
  const fatalSignals = await openSmokeApp(page, { ensureCampaign: false });

  await createCampaignFromHub(page, "Splash Restore Chronicle");
  await expectTrackerShell(page);

  await page.reload();
  await expect(page.locator("#appSplash")).toBeVisible();
  await page.waitForFunction(() => document.getElementById("appSplash")?.hidden === true);

  await expectTrackerShell(page);
  await expect(page.locator("#page-hub")).toBeHidden();
  await expectNoFatalSignals(page, fatalSignals);
});
