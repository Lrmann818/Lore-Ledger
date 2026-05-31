import { devices, expect, test } from "@playwright/test";

import {
  expectNoFatalSignals,
  expectTrackerShell,
  openSmokeApp,
} from "./helpers/smokeApp.js";

async function dispatchTouchDrag(client, points, { holdMs = 0, stepMs = 16 } = {}) {
  const [start, ...moves] = points;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: start.x, y: start.y }],
  });

  if (holdMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, holdMs));
  }

  for (const point of moves) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: point.x, y: point.y }],
    });
    if (stepMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, stepMs));
    }
  }

  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

test("mobile session tabs allow swipe scrolling and deliberate hold-to-drag reorder", async ({ browser }) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
  });
  const page = await context.newPage();
  const fatalSignals = await openSmokeApp(page, { campaignName: "Touch Smoke Campaign" });
  await expectTrackerShell(page);

  for (let i = 0; i < 6; i += 1) {
    await page.locator("#addSessionBtn").click();
  }
  await expect(page.locator("#sessionTabs .sessionTab")).toHaveCount(7);

  const client = await context.newCDPSession(page);
  const firstTab = page.locator("#sessionTabs .sessionTab").first();
  const firstTabBox = await firstTab.boundingBox();
  if (!firstTabBox) throw new Error("First session tab is not visible for touch scroll smoke test.");

  const startX = firstTabBox.x + (firstTabBox.width / 2);
  const startY = firstTabBox.y + (firstTabBox.height / 2);

  await dispatchTouchDrag(client, [
    { x: startX, y: startY },
    { x: startX - 48, y: startY + 2 },
    { x: startX - 96, y: startY + 3 },
    { x: startX - 148, y: startY + 4 },
  ]);

  await expect.poll(() => page.evaluate(() => {
    const wrap = document.querySelector(".sessionTabsWrap");
    return wrap instanceof HTMLElement ? wrap.scrollLeft : 0;
  })).toBeGreaterThan(20);

  await page.evaluate(() => {
    const wrap = document.querySelector(".sessionTabsWrap");
    if (wrap instanceof HTMLElement) wrap.scrollLeft = 0;
  });
  await page.evaluate(() => {
    document.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  const secondTab = page.locator("#sessionTabs .sessionTab").nth(1);
  await secondTab.tap();
  await expect(secondTab).toHaveClass(/active/);

  const thirdTab = page.locator("#sessionTabs .sessionTab").nth(2);
  const thirdTabIdBefore = await thirdTab.getAttribute("data-session-id");
  const thirdTabBox = await thirdTab.boundingBox();
  if (!thirdTabBox || !thirdTabIdBefore) {
    throw new Error("Third session tab is not ready for hold-to-drag reorder smoke test.");
  }

  const dragStartX = thirdTabBox.x + (thirdTabBox.width / 2);
  const dragStartY = thirdTabBox.y + (thirdTabBox.height / 2);
  await dispatchTouchDrag(client, [
    { x: dragStartX, y: dragStartY },
    { x: dragStartX + 90, y: dragStartY },
    { x: dragStartX + 150, y: dragStartY },
  ], { holdMs: 220 });

  await expect(page.locator("#sessionTabs .sessionTab").nth(3)).toHaveAttribute("data-session-id", thirdTabIdBefore);

  await expectNoFatalSignals(page, fatalSignals);
  await context.close();
});
