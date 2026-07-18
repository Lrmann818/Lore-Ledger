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
 * @param {import("@playwright/test").Page} page
 */
export async function waitForAppShell(page) {
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("#appSplash")).toBeHidden();
}

/**
 * Opens the app and waits for the top-level shell to finish rendering.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ ensureCampaign?: boolean, campaignName?: string }} [opts]
 * @returns {Promise<{ consoleErrors: string[], pageErrors: string[] }>}
 */
export async function openSmokeApp(page, opts = {}) {
  const {
    ensureCampaign = true,
    campaignName = "My Campaign"
  } = opts;
  const fatalSignals = watchForFatalSignals(page);
  await page.goto("/");
  await waitForAppShell(page);
  if (ensureCampaign && await page.locator("#page-hub").isVisible()) {
    await createCampaignFromHub(page, campaignName);
  }
  return fatalSignals;
}

/**
 * @param {import("@playwright/test").Page} page
 */
export async function expectHubShell(page) {
  await expect(page.locator("body")).toHaveAttribute("data-shell-mode", "hub");
  await expect(page.locator("#page-hub")).toBeVisible();
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Lore Ledger" })).toBeVisible();
  await expect(page.getByText("Keep your world within reach.")).toBeVisible();
  await expect(page.locator(".hubHeroIconImage")).toBeVisible();
  await expect(page.locator("#campaignTabs")).toBeHidden();
  await expect(page.getByRole("tab", { name: "Hub" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Data & Settings" })).toHaveCount(0);
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

  await expect(page.locator("body")).toHaveAttribute("data-shell-mode", "campaign");
  await expect(page.locator(".topbar")).toBeVisible();
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
 * Ensures the current campaign has a selected character and the Character page
 * panels have bound to it. Step 1 multi-character support intentionally starts
 * fresh campaigns with an empty collection, so smoke tests that exercise
 * Character panels need to create/select a character first.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string>}
 */
export async function ensureActiveCharacter(page) {
  if (await page.locator("#page-hub").isVisible()) {
    await createCampaignFromHub(page, "Smoke Test Campaign");
  }

  const characterTab = page.getByRole("tab", { name: "Character" });
  if ((await characterTab.getAttribute("aria-selected")) !== "true") {
    await characterTab.click();
  }
  await expect(characterTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#page-character")).toBeVisible();

  const hasActiveCharacter = async () => page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const entries = Array.isArray(collection?.entries) ? collection.entries : [];
    return entries.some((entry) => entry?.id && entry.id === collection?.activeId);
  });

  if (!(await hasActiveCharacter())) {
    const emptyCreateButton = page.locator("#charEmptyStateYes");
    if (await emptyCreateButton.isVisible()) {
      await emptyCreateButton.click();
    } else {
      const selectedExisting = await page.evaluate(() => {
        const selector = document.getElementById("charSelector");
        if (!(selector instanceof HTMLSelectElement)) return false;
        const option = Array.from(selector.options).find((candidate) => candidate.value && !candidate.disabled);
        if (!option) return false;
        selector.value = option.value;
        selector.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      });

      if (!selectedExisting) {
        await page.locator("#charActionMenuBtn").click();
        await page.locator("#charActionNewBtn").click();
      }
    }
  }

  await expect.poll(hasActiveCharacter).toBe(true);
  await expect(page.locator("#charName")).toBeVisible();
  await expect(page.locator("#charVitalsTiles")).toBeVisible();
  await expect(page.locator("#attackList")).toBeVisible();
  await expect(page.locator("#spellLevels")).toBeVisible();
  await expect(page.locator(".abilityBlock").first()).toBeVisible();
  await expect.poll(() => page.locator("#spellLevels .spellLevel").count()).toBeGreaterThan(0);

  return page.evaluate(() => String(globalThis.__APP_STATE__?.characters?.activeId || ""));
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
 * From the Campaign Hub, opens an existing campaign by name and waits for the
 * campaign shell to come back.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} campaignName
 */
export async function reopenCampaignFromHub(page, campaignName) {
  await expectHubShell(page);
  const campaignItem = page
    .locator("#hubCampaignList .hubCampaignItem")
    .filter({ hasText: campaignName });
  await campaignItem.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("tab", { name: "Tracker" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#campaignTitle")).toHaveText(campaignName);
}

/**
 * Leaves the active campaign for the Hub and re-opens it. This drives the
 * app's real campaign-module lifecycle (`destroyCampaignModules()` followed by
 * `initCampaignModules()` in `app.js`), so page controllers are torn down and
 * re-initialized exactly as they are in production. It is the preview-safe way
 * for smoke tests to exercise a destroy + re-init cycle: it works identically
 * against the dev server and the built `dist/` bundle, unlike `import()`ing
 * source modules into the page (which only the dev server can serve).
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} campaignName
 */
export async function cycleCampaignShell(page, campaignName) {
  await returnToHubFromSettings(page);
  await reopenCampaignFromHub(page, campaignName);
}

/**
 * Fills and submits the app's shared prompt dialog (`initDialogs()` UI). The
 * trailing hidden assertion doubles as a duplicate-binding guard: a
 * double-bound trigger button queues a second prompt, which keeps the overlay
 * on screen and fails the expectation.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} value
 */
export async function submitPromptDialog(page, value) {
  const overlay = page.locator("#uiDialogOverlay").filter({ has: page.locator(".uiDialogPanel") });
  await expect(overlay).toBeVisible();
  await overlay.locator("#uiDialogInput").fill(value);
  await overlay.locator("#uiDialogOk").click();
  await expect(page.locator("#uiDialogOverlay")).toBeHidden();
}

/**
 * Reads the persisted spell-note body for the active campaign straight from
 * the app's IndexedDB texts store using only public browser APIs, so it works
 * identically in dev-server and production-preview smoke runs. The database /
 * store / key shapes intentionally mirror the persisted storage contract
 * (`js/storage/idb.js` + `js/storage/texts-idb.js`) — this is the same
 * storage seam class as reading `localStorage["localCampaignTracker_v1"]`
 * directly, asserting on the artifact the app actually persists. If the
 * storage contract ever changes shape, update this reader alongside it.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} spellId
 * @returns {Promise<string>} the stored note text, or "" when missing
 */
export async function readStoredSpellNote(page, spellId) {
  return page.evaluate(async (id) => {
    const campaignId = globalThis.__APP_STATE__?.appShell?.activeCampaignId;
    if (!campaignId) return "";
    const textKey = `spell_notes_${campaignId}__${id}`;
    const db = await new Promise((resolve, reject) => {
      const openReq = indexedDB.open("localCampaignTracker_db");
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => reject(openReq.error);
    });
    try {
      if (!db.objectStoreNames.contains("texts")) return "";
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction("texts", "readonly");
        const getReq = tx.objectStore("texts").get(textKey);
        getReq.onsuccess = () => resolve(getReq.result ?? null);
        getReq.onerror = () => reject(getReq.error);
      });
      return record?.text ?? "";
    } finally {
      db.close();
    }
  }, spellId);
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
