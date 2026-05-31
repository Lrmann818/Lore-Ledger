import { expect, test } from "@playwright/test";
import {
  expectNoFatalSignals,
  expectTrackerShell,
  openSmokeApp,
  waitForAppShell,
} from "./helpers/smokeApp.js";

const STORAGE_KEY = "localCampaignTracker_v1";

async function waitForSavedFirstSessionId(page, expectedId) {
  await expect.poll(async () =>
    page.evaluate(({ key }) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        const campaignId = parsed?.appShell?.activeCampaignId;
        if (!campaignId) return null;
        const sessions = parsed?.campaignDocs?.[campaignId]?.tracker?.sessions;
        return Array.isArray(sessions) ? (sessions[0]?.id ?? null) : null;
      } catch {
        return null;
      }
    }, { key: STORAGE_KEY })
  ).toBe(expectedId);
}

test("dragged session tab order persists after a full page reload", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);
  await expectTrackerShell(page);

  // Add a second session so there is something to reorder.
  await page.locator("#addSessionBtn").click();
  await expect(page.locator("#sessionTabs .sessionTab")).toHaveCount(2);

  // Capture stable session IDs from the DOM before the drag.
  const [id0Before, id1Before] = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#sessionTabs .sessionTab"))
      .map((el) => el.dataset.sessionId ?? "")
  );

  const tab0Box = await page.locator("#sessionTabs .sessionTab").nth(0).boundingBox();
  const tab1Box = await page.locator("#sessionTabs .sessionTab").nth(1).boundingBox();
  if (!tab0Box || !tab1Box) throw new Error("Session tabs not in viewport for drag test");

  // Drag tab 0 past tab 1's horizontal midpoint.
  const startX = tab0Box.x + tab0Box.width / 2;
  const startY = tab0Box.y + tab0Box.height / 2;
  const endX = tab1Box.x + tab1Box.width * 0.6;
  const endY = tab1Box.y + tab1Box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();

  // Tab order must have swapped — id1 is now first, id0 is now second.
  await expect(page.locator("#sessionTabs .sessionTab").nth(0)).toHaveAttribute("data-session-id", id1Before);
  await expect(page.locator("#sessionTabs .sessionTab").nth(1)).toHaveAttribute("data-session-id", id0Before);

  // Wait for the reordered sessions array to flush to localStorage before reloading.
  await waitForSavedFirstSessionId(page, id1Before);

  await page.reload();
  await waitForAppShell(page);
  await expectTrackerShell(page);

  // Count and order must survive a full page reload.
  await expect(page.locator("#sessionTabs .sessionTab")).toHaveCount(2);
  await expect(page.locator("#sessionTabs .sessionTab").nth(0)).toHaveAttribute("data-session-id", id1Before);
  await expect(page.locator("#sessionTabs .sessionTab").nth(1)).toHaveAttribute("data-session-id", id0Before);

  await expectNoFatalSignals(page, fatalSignals);
});

test("desktop drag reorder keeps row scroll locked and shows a drop cue", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);
  await expectTrackerShell(page);

  for (let i = 0; i < 6; i += 1) {
    await page.locator("#addSessionBtn").click();
  }
  await expect(page.locator("#sessionTabs .sessionTab")).toHaveCount(7);

  const lockedScrollLeft = await page.evaluate(() => {
    const wrap = document.querySelector(".sessionTabsWrap");
    if (!(wrap instanceof HTMLElement)) return 0;
    wrap.scrollLeft = 120;
    return wrap.scrollLeft;
  });

  const source = page.locator("#sessionTabs .sessionTab").nth(2);
  const target = page.locator("#sessionTabs .sessionTab").nth(3);
  const sourceId = await source.getAttribute("data-session-id");
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceId || !sourceBox || !targetBox) {
    throw new Error("Session tabs are not ready for desktop overflow drag smoke test.");
  }

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width * 0.7;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });

  await expect.poll(() => page.evaluate(() => {
    const cue = document.querySelector(".tabReorderDropCue");
    return cue instanceof HTMLElement ? cue.style.left : "";
  })).not.toBe("");
  await expect.poll(() => page.evaluate(() => {
    const wrap = document.querySelector(".sessionTabsWrap");
    return wrap instanceof HTMLElement ? wrap.scrollLeft : -1;
  })).toBe(lockedScrollLeft);

  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => document.querySelector(".tabReorderDropCue") === null)).toBe(true);
  await expect(page.locator("#sessionTabs .sessionTab").nth(3)).toHaveAttribute("data-session-id", sourceId);
  await expectNoFatalSignals(page, fatalSignals);
});
