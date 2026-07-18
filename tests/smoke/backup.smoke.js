import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createCampaignFromHub, ensureActiveCharacter, expectNoFatalSignals, openSmokeApp, readStoredSpellNote } from "./helpers/smokeApp.js";

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
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        value: undefined
      });
    } catch {
      window.showSaveFilePicker = undefined;
    }
  });

  const fatalSignals = await openSmokeApp(page);
  const campaignTitle = "Smoke Backup Chronicle";
  const npcName = "Roundtrip Scout";
  const spellNoteText = "Backup keeps the Shield note.";

  await page.locator("#campaignTitle").fill(campaignTitle);
  await expect(page.locator("#campaignTitle")).toHaveText(campaignTitle);

  await page.getByRole("button", { name: "+ NPC" }).click();
  await expect(page.locator(".npcNameBig")).toHaveCount(1);
  await page.locator(".npcNameBig").first().fill(npcName);
  await expect(page.locator(".npcNameBig").first()).toHaveValue(npcName);

  await ensureActiveCharacter(page);
  const firstSpellLevel = page.locator("#spellLevels .spellLevel").first();
  await firstSpellLevel.getByRole("button", { name: "+ Spell" }).click();
  const spellRow = firstSpellLevel.locator(".spellRow").last();
  await spellRow.locator(".spellName").fill("Shield");
  await spellRow.locator(".spellSpellCollapseBtn").click();
  const spellNotes = spellRow.locator("textarea[id^='spellNotes_']");
  await spellNotes.fill(spellNoteText);
  const spellId = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const character = collection?.entries?.find((entry) => entry?.id === collection?.activeId);
    const spellsList = character?.spells?.levels?.[0]?.spells || [];
    return spellsList.at(-1)?.id || "";
  });
  await expect.poll(() => readStoredSpellNote(page, spellId)).toBe(spellNoteText);

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
  expect(Object.values(exported.texts || {})).toContain(spellNoteText);

  const baseURL = testInfo.project.use.baseURL ?? "http://127.0.0.1:4173/";
  const importContext = await browser.newContext({ baseURL });

  try {
    const importPage = await importContext.newPage();
    const importSignals = await openSmokeApp(importPage, { ensureCampaign: false });

    await expect(importPage.locator("#page-hub")).toBeVisible();
    await createCampaignFromHub(importPage, "Import Placeholder Chronicle");
    await openDataPanel(importPage);

    await importPage.locator("#dataImportFile").setInputFiles(backupPath);

    const importDialog = await expectAppDialog(importPage, {
      title: "Import complete",
      message: /did not include images/i
    });
    await importDialog.getByRole("button", { name: "OK" }).click();

    await expect(importPage.locator("#campaignTitle")).toHaveText(campaignTitle);
    await expect(importPage.locator(".npcNameBig").first()).toHaveValue(npcName);
    await ensureActiveCharacter(importPage);
    await expect(importPage.locator(`#spellNotes_${spellId}`)).toHaveValue(spellNoteText);

    await expectNoFatalSignals(importPage, importSignals);
  } finally {
    await importContext.close();
  }

  await expectNoFatalSignals(page, fatalSignals);
});

test("backup export uses the file system save picker in a desktop installed-PWA-like runtime when available", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__backupShareCalls = 0;
    globalThis.__backupPickerCalls = 0;
    globalThis.__backupPickerClosed = false;
    globalThis.__backupPickerOptions = null;
    globalThis.__backupSavedJson = "";

    const buildMediaQueryList = (matches, media) => ({
      matches,
      media,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      }
    });

    const originalMatchMedia = window.matchMedia?.bind(window);
    window.matchMedia = (query) => {
      if (query === "(display-mode: standalone)") {
        return buildMediaQueryList(true, query);
      }
      return originalMatchMedia
        ? originalMatchMedia(query)
        : buildMediaQueryList(false, query);
    };

    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async (options) => {
        globalThis.__backupPickerCalls += 1;
        globalThis.__backupPickerOptions = options;
        return {
          async createWritable() {
            return {
              async write(fileBlob) {
                globalThis.__backupSavedJson = await fileBlob.text();
              },
              async close() {
                globalThis.__backupPickerClosed = true;
              }
            };
          }
        };
      }
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        globalThis.__backupShareCalls += 1;
      }
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel"
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 0
    });
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15"
    });
  });

  const fatalSignals = await openSmokeApp(page);
  await openDataPanel(page);

  let downloadSeen = false;
  page.on("download", () => {
    downloadSeen = true;
  });

  await page.getByRole("button", { name: "Export Backup (.json)" }).click();

  await expect.poll(() => page.evaluate(() => globalThis.__backupPickerCalls || 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => globalThis.__backupPickerClosed || false)).toBe(true);
  await expect.poll(() => page.evaluate(() => globalThis.__backupShareCalls || 0)).toBe(0);
  await expect.poll(() => downloadSeen).toBe(false);

  const pickerOptions = await page.evaluate(() => globalThis.__backupPickerOptions);
  expect(pickerOptions?.suggestedName).toMatch(/^campaign-backup-\d{4}-\d{2}-\d{2}\.json$/);
  expect(pickerOptions?.types).toEqual([
    {
      description: "Lore Ledger Backup",
      accept: {
        "application/json": [".json"]
      }
    }
  ]);

  const exported = JSON.parse(await page.evaluate(() => globalThis.__backupSavedJson));
  expect(exported.version).toBe(2);
  await expectNoFatalSignals(page, fatalSignals);
});

test("backup export stays on direct download in a macOS installed-PWA-like runtime", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    globalThis.__backupShareCalls = 0;

    const buildMediaQueryList = (matches, media) => ({
      matches,
      media,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      }
    });

    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: undefined
    });
    const originalMatchMedia = window.matchMedia?.bind(window);
    window.matchMedia = (query) => {
      if (query === "(display-mode: standalone)") {
        return buildMediaQueryList(true, query);
      }
      return originalMatchMedia
        ? originalMatchMedia(query)
        : buildMediaQueryList(false, query);
    };

    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        globalThis.__backupShareCalls += 1;
      }
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel"
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 0
    });
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15"
    });
  });

  const fatalSignals = await openSmokeApp(page);
  await openDataPanel(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Backup (.json)" }).click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(backupPath);

  expect(download.suggestedFilename()).toMatch(/^campaign-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await expect.poll(() => page.evaluate(() => globalThis.__backupShareCalls || 0)).toBe(0);
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
