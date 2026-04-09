import { expect } from "@playwright/test";

/**
 * @param {import("@playwright/test").Page} page
 * @returns {{ consoleErrors: string[], pageErrors: string[] }}
 */
export function watchForFatalSignals(page) {
  /** @type {string[]} */
  const consoleErrors = [];
  /** @type {string[]} */
  const pageErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(String(error));
  });

  return { consoleErrors, pageErrors };
}

/**
 * Opens the app and waits for the top-level shell to finish rendering.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ consoleErrors: string[], pageErrors: string[] }>}
 */
export async function openSmokeApp(page) {
  const fatalSignals = watchForFatalSignals(page);
  await page.goto("/");
  await expect(page.locator("#campaignTitle")).toBeVisible();
  return fatalSignals;
}

/**
 * @param {import("@playwright/test").Page} page
 */
export async function expectHubShell(page) {
  await expect(page.locator("#page-hub")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome to Lore Ledger" })).toBeVisible();
  await expect(page.locator("#campaignTabs")).toBeHidden();
  await expect(page.getByRole("tab", { name: "Hub" })).toHaveCount(0);
}

/**
 * @param {import("@playwright/test").Page} page
 */
export async function expectTrackerShell(page) {
  const trackerTab = page.getByRole("tab", { name: "Tracker" });
  if ((await trackerTab.getAttribute("aria-selected")) !== "true") {
    if (await page.locator("#page-hub").isVisible()) {
      await createCampaignFromHub(page, "Smoke Test Campaign");
    }
  }

  await expect(page.locator("#campaignTabs")).toBeVisible();
  await expect(trackerTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#campaignTitle")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} campaignName
 */
export async function createCampaignFromHub(page, campaignName) {
  await expectHubShell(page);
  await page.locator("#hubCampaignNameInput").fill(campaignName);
  await page.locator("#hubCreateForm").getByRole("button", { name: "Create Campaign" }).click();
  await expect(page.getByRole("tab", { name: "Tracker" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(page.locator("#campaignTitle")).toHaveText(campaignName);
}

/**
 * @param {import("@playwright/test").Page} page
 */
export async function returnToHubFromSettings(page) {
  await page.getByRole("button", { name: "Data & Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Data & Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Return to Campaign Hub" }).click();
  await expect(page.getByRole("dialog", { name: "Data & Settings" })).toBeHidden();
  await expectHubShell(page);
}

/**
 * @param {import("@playwright/test").Page} page
 */
export async function openMapWorkspace(page) {
  await page.getByRole("tab", { name: "Map" }).click();
  await expect(page.getByRole("tab", { name: "Map" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#page-map")).toBeVisible();
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ consoleErrors: string[], pageErrors: string[] }} fatalSignals
 */
export async function expectNoFatalSignals(page, fatalSignals) {
  await expect(page.locator("#statusText")).not.toContainText(/failed to initialize|something went wrong/i);
  expect(fatalSignals.consoleErrors).toEqual([]);
  expect(fatalSignals.pageErrors).toEqual([]);
}
