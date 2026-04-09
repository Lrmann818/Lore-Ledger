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

/**
 * @param {import("@playwright/test").Page} page
 */
async function getHubAtmosphereState(page) {
  const state = await page.evaluate(() => {
    const hero = document.querySelector(".hubHero");
    const backdropImage = document.querySelector(".hubBackdropImage");
    const backdropWash = document.querySelector(".hubBackdropWash");
    if (!(hero instanceof HTMLElement) || !(backdropImage instanceof HTMLElement) || !(backdropWash instanceof HTMLElement)) return null;

    const heroRect = hero.getBoundingClientRect();
    const backdropRect = backdropImage.getBoundingClientRect();
    const washRect = backdropWash.getBoundingClientRect();

    return {
      heroBackgroundImage: getComputedStyle(hero).backgroundImage,
      backdropBackgroundImage: getComputedStyle(backdropImage).backgroundImage,
      backdropPosition: getComputedStyle(backdropImage).position,
      washPosition: getComputedStyle(backdropWash).position,
      backdropParentTag: backdropImage.parentElement?.tagName ?? null,
      washParentTag: backdropWash.parentElement?.tagName ?? null,
      backdropPageAncestorId: backdropImage.closest(".page")?.id ?? null,
      washPageAncestorId: backdropWash.closest(".page")?.id ?? null,
      backdropBorderRadius: getComputedStyle(backdropImage).borderRadius,
      heroBottom: heroRect.bottom,
      backdropTop: backdropRect.top,
      backdropLeft: backdropRect.left,
      backdropWidth: backdropRect.width,
      backdropHeight: backdropRect.height,
      washTop: washRect.top,
      washLeft: washRect.left,
      washWidth: washRect.width,
      washHeight: washRect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });

  expect(state).not.toBeNull();
  if (!state) throw new Error("Expected Hub atmosphere elements to be present");
  return state;
}

/**
 * @param {import("@playwright/test").Page} page
 */
async function getHubShellLayoutState(page) {
  const state = await page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector("main");
    const backdrop = document.querySelector(".hubBackdropImage");
    const shell = document.querySelector(".hubShell");
    if (!(main instanceof HTMLElement) || !(backdrop instanceof HTMLElement) || !(shell instanceof HTMLElement)) return null;

    const maxWidth = doc.clientWidth;
    const offenders = Array.from(document.querySelectorAll("body *"))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          selector: el.id ? `#${el.id}` : String(el.className || el.tagName.toLowerCase()),
          left: rect.left,
          right: rect.right
        };
      })
      .filter((item) => item.right > maxWidth + 0.5 || (item.left < -0.5 && item.right > 0.5))
      .slice(0, 8);

    return {
      clientWidth: doc.clientWidth,
      docScrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      mainScrollWidth: main.scrollWidth,
      backdropRight: backdrop.getBoundingClientRect().right,
      backdropZIndex: getComputedStyle(backdrop).zIndex,
      shellScrollWidth: shell.scrollWidth,
      shellClientWidth: shell.clientWidth,
      htmlBgColor: getComputedStyle(doc).backgroundColor,
      bodyBgColor: getComputedStyle(document.body).backgroundColor,
      mainBgColor: getComputedStyle(main).backgroundColor,
      mainZIndex: getComputedStyle(main).zIndex,
      offenders
    };
  });

  expect(state).not.toBeNull();
  if (!state) throw new Error("Expected Hub shell layout state to be present");
  return state;
}

test("first-run users land on the Campaign Hub and the empty state hides after creating a campaign", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { ensureCampaign: false });
  await expectHubShell(page);
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

test("narrow hub layouts keep the icon in the upper-right beside the hero copy", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fatalSignals = await openSmokeApp(page, { ensureCampaign: false });

  await expectHubShell(page);

  const hero = page.locator(".hubHero");
  const copy = page.locator(".hubHeroCopy");
  const visual = page.locator(".hubHeroVisual");
  const intro = page.locator("#hubIntroCopy");

  const [heroBox, copyBox, visualBox, introBox] = await Promise.all([
    hero.boundingBox(),
    copy.boundingBox(),
    visual.boundingBox(),
    intro.boundingBox()
  ]);

  expect(heroBox).not.toBeNull();
  expect(copyBox).not.toBeNull();
  expect(visualBox).not.toBeNull();
  expect(introBox).not.toBeNull();

  if (!heroBox || !copyBox || !visualBox || !introBox) {
    throw new Error("Expected Hub hero layout boxes to be available");
  }

  expect(visualBox.y).toBeLessThan(introBox.y);
  expect(visualBox.x + visualBox.width / 2).toBeGreaterThan(heroBox.x + heroBox.width * 0.7);
  expect(visualBox.x).toBeGreaterThan(copyBox.x + copyBox.width * 0.45);

  await expectNoFatalSignals(page, fatalSignals);
});

test("wide hub layouts use the desktop full-screen atmosphere backdrop", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  const fatalSignals = await openSmokeApp(page, { ensureCampaign: false });

  await expectHubShell(page);
  const state = await getHubAtmosphereState(page);

  expect(state.backdropBackgroundImage).toContain("hub-atmosphere-desktop-v2.webp");
  expect(state.heroBackgroundImage).not.toContain("hub-atmosphere");
  expect(state.backdropPosition).toBe("fixed");
  expect(state.washPosition).toBe("fixed");
  expect(state.backdropParentTag).toBe("BODY");
  expect(state.washParentTag).toBe("BODY");
  expect(state.backdropPageAncestorId).toBeNull();
  expect(state.washPageAncestorId).toBeNull();
  expect(state.backdropBorderRadius).toBe("0px");
  expect(Math.abs(state.backdropTop)).toBeLessThan(1);
  expect(Math.abs(state.backdropLeft)).toBeLessThan(1);
  expect(Math.abs(state.washTop)).toBeLessThan(1);
  expect(Math.abs(state.washLeft)).toBeLessThan(1);
  expect(state.backdropWidth).toBeGreaterThanOrEqual(state.viewportWidth - 0.5);
  expect(state.backdropHeight).toBeGreaterThanOrEqual(state.viewportHeight - 0.5);
  expect(state.washWidth).toBeGreaterThanOrEqual(state.viewportWidth - 0.5);
  expect(state.washHeight).toBeGreaterThanOrEqual(state.viewportHeight - 0.5);
  expect(state.heroBottom).toBeGreaterThan(0);

  await expectNoFatalSignals(page, fatalSignals);
});

test("narrow hub layouts use the mobile full-screen atmosphere backdrop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fatalSignals = await openSmokeApp(page, { ensureCampaign: false });

  await expectHubShell(page);
  const state = await getHubAtmosphereState(page);

  expect(state.backdropBackgroundImage).toContain("hub-atmosphere-mobile-v2.webp");
  expect(state.heroBackgroundImage).not.toContain("hub-atmosphere");
  expect(state.backdropPosition).toBe("fixed");
  expect(state.washPosition).toBe("fixed");
  expect(state.backdropParentTag).toBe("BODY");
  expect(state.washParentTag).toBe("BODY");
  expect(state.backdropPageAncestorId).toBeNull();
  expect(state.washPageAncestorId).toBeNull();
  expect(state.backdropBorderRadius).toBe("0px");
  expect(Math.abs(state.backdropTop)).toBeLessThan(1);
  expect(Math.abs(state.backdropLeft)).toBeLessThan(1);
  expect(Math.abs(state.washTop)).toBeLessThan(1);
  expect(Math.abs(state.washLeft)).toBeLessThan(1);
  expect(state.backdropWidth).toBeGreaterThanOrEqual(state.viewportWidth - 0.5);
  expect(state.backdropHeight).toBeGreaterThanOrEqual(state.viewportHeight - 0.5);
  expect(state.washWidth).toBeGreaterThanOrEqual(state.viewportWidth - 0.5);
  expect(state.washHeight).toBeGreaterThanOrEqual(state.viewportHeight - 0.5);
  expect(state.heroBottom).toBeGreaterThan(0);

  await expectNoFatalSignals(page, fatalSignals);
});

test("hub shell stays within the viewport and keeps a dark root background on desktop and mobile", async ({ page }) => {
  const cases = [
    { width: 1365, height: 900 },
    { width: 390, height: 844 }
  ];

  for (const viewport of cases) {
    await page.setViewportSize(viewport);
    const fatalSignals = await openSmokeApp(page, { ensureCampaign: false });

    await expectHubShell(page);
    const state = await getHubShellLayoutState(page);

    expect(state.docScrollWidth).toBe(state.clientWidth);
    expect(state.bodyScrollWidth).toBe(state.clientWidth);
    expect(state.mainScrollWidth).toBe(state.clientWidth);
    expect(state.backdropRight).toBeLessThanOrEqual(state.clientWidth + 0.5);
    expect(state.backdropZIndex).toBe("0");
    expect(state.shellScrollWidth).toBe(state.shellClientWidth);
    expect(state.htmlBgColor).toBe("rgb(9, 7, 5)");
    expect(state.bodyBgColor).toBe("rgb(9, 7, 5)");
    expect(state.mainBgColor).toBe("rgba(0, 0, 0, 0)");
    expect(state.mainZIndex).toBe("2");
    expect(state.offenders).toEqual([]);

    await expectNoFatalSignals(page, fatalSignals);
  }
});

test("hub atmosphere layers stay anchored while the content scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 560 });
  const fatalSignals = await openSmokeApp(page, { ensureCampaign: false });

  await expectHubShell(page);

  const before = await page.evaluate(() => {
    const backdrop = document.querySelector(".hubBackdropImage");
    const wash = document.querySelector(".hubBackdropWash");
    const layout = document.querySelector(".hubLayout");
    if (!(backdrop instanceof HTMLElement) || !(wash instanceof HTMLElement) || !(layout instanceof HTMLElement)) return null;

    return {
      backdropTop: backdrop.getBoundingClientRect().top,
      washTop: wash.getBoundingClientRect().top,
      layoutTop: layout.getBoundingClientRect().top,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight
    };
  });

  expect(before).not.toBeNull();
  if (!before) throw new Error("Expected Hub backdrop and layout to be present");
  expect(before.scrollHeight).toBeGreaterThan(before.viewportHeight);

  await page.evaluate(() => window.scrollTo(0, 140));
  await page.waitForTimeout(100);

  const after = await page.evaluate(() => {
    const backdrop = document.querySelector(".hubBackdropImage");
    const wash = document.querySelector(".hubBackdropWash");
    const layout = document.querySelector(".hubLayout");
    if (!(backdrop instanceof HTMLElement) || !(wash instanceof HTMLElement) || !(layout instanceof HTMLElement)) return null;

    return {
      backdropTop: backdrop.getBoundingClientRect().top,
      washTop: wash.getBoundingClientRect().top,
      layoutTop: layout.getBoundingClientRect().top
    };
  });

  expect(after).not.toBeNull();
  if (!after) throw new Error("Expected Hub backdrop and layout to remain present");

  expect(Math.abs(after.backdropTop - before.backdropTop)).toBeLessThan(1);
  expect(Math.abs(after.washTop - before.washTop)).toBeLessThan(1);
  expect(after.layoutTop).toBeLessThan(before.layoutTop - 100);

  await expectNoFatalSignals(page, fatalSignals);
});

test("campaign title survives a reload", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { ensureCampaign: false });
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
  const fatalSignals = await openSmokeApp(page, { ensureCampaign: false });

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
  const fatalSignals = await openSmokeApp(page, { ensureCampaign: false });
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
