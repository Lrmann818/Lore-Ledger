import { expect, test } from "@playwright/test";
import {
  expectNoFatalSignals,
  openMapWorkspace,
  openSmokeApp
} from "./helpers/smokeApp.js";

async function closeOpenDropdown(page) {
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => (
    Array.from(document.querySelectorAll(".dropdownMenu"))
      .filter((menu) => menu.hidden === false)
      .length
  ))).toBe(0);
}

async function expectEnhancedDropdownOpen(page, buttonLocator, { openWith = "click" } = {}) {
  const button = buttonLocator.first();
  const selectedLabel = ((await button.textContent()) || "").trim();

  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".dropdownMenu:visible")).toHaveCount(0);

  if (openWith === "keyboard") {
    await button.focus();
    await button.press("ArrowDown");
  } else {
    await button.click();
  }

  await expect.poll(() => page.evaluate(() => {
    const openMenus = Array.from(document.querySelectorAll(".dropdownMenu"))
      .filter((menu) => menu.hidden === false);
    const menu = openMenus[0] || null;
    const rect = menu?.getBoundingClientRect?.() || null;
    return {
      count: openMenus.length,
      text: (menu?.textContent || "").trim(),
      inViewport: !!rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight,
    };
  })).toEqual(expect.objectContaining({
    count: 1,
    inViewport: true,
  }));
  await expect(button).toHaveAttribute("aria-expanded", "true");
  if (selectedLabel) {
    await expect.poll(() => page.evaluate(() => (
      Array.from(document.querySelectorAll(".dropdownMenu"))
        .filter((menu) => menu.hidden === false)
        .map((menu) => (menu.textContent || "").trim())
        .join(" ")
    ))).toContain(selectedLabel);
  }
  return { button };
}

async function inspectOpenMenuHitTarget(page, { buttonSelector, optionIndex = 1 } = {}) {
  return page.evaluate(({ buttonSelector: selector, optionIndex: index }) => {
    const menu = Array.from(document.querySelectorAll(".dropdownMenu"))
      .find((candidate) => candidate.hidden === false);
    const button = selector ? document.querySelector(selector) : null;
    const options = menu
      ? Array.from(menu.querySelectorAll("button:not([disabled])"))
      : [];
    const option = options[index] || options[0] || null;
    if (!menu || !button || !option) return null;

    const menuRect = menu.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    const point = {
      x: Math.round(optionRect.left + (optionRect.width / 2)),
      y: Math.round(optionRect.top + (optionRect.height / 2)),
    };
    const hit = document.elementFromPoint(point.x, point.y);
    const menuStyle = getComputedStyle(menu);

    return {
      buttonRect: {
        top: buttonRect.top,
        bottom: buttonRect.bottom,
      },
      menuParent: menu.parentElement?.nodeName || null,
      menuPointerEvents: menuStyle.pointerEvents,
      menuRect: {
        top: menuRect.top,
        bottom: menuRect.bottom,
      },
      menuZIndex: menuStyle.zIndex,
      optionText: (option.textContent || "").trim(),
      point,
      hitNode: hit?.nodeName || null,
      hitClassName: hit?.className || "",
      menuContainsHit: !!hit && menu.contains(hit),
      optionContainsHit: !!hit && option.contains(hit),
    };
  }, { buttonSelector, optionIndex });
}

test("enhanced selects and shared popovers open", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  const trackerFilter = page.locator("#locFilter + .selectDropdown");
  const trackerFilterButton = trackerFilter.locator("button").first();
  const trackerFilterMenu = trackerFilter.locator(".dropdownMenu");

  await expect(trackerFilterButton).toHaveAttribute("aria-expanded", "false");
  await expect(trackerFilterMenu).toBeHidden();
  await trackerFilterButton.click();
  await expect(trackerFilterButton).toHaveAttribute("aria-expanded", "true");
  await expect(trackerFilterMenu).toBeVisible();

  await openMapWorkspace(page);

  const mapToolButton = page.locator("#toolDropdownBtn");
  const mapToolMenu = page.locator("#toolDropdownMenu");

  await expect(mapToolButton).toHaveAttribute("aria-expanded", "false");
  await expect(mapToolMenu).toBeHidden();
  await mapToolButton.click();
  await expect(mapToolButton).toHaveAttribute("aria-expanded", "true");
  await expect(mapToolMenu).toBeVisible();

  const calcButton = page.locator("#calcBtn");
  const calcMenu = page.locator("#calcMenu");

  await expect(calcButton).toHaveAttribute("aria-expanded", "false");
  await expect(calcMenu).toBeHidden();
  await calcButton.click();
  await expect(calcButton).toHaveAttribute("aria-expanded", "true");
  await expect(calcMenu).toBeVisible();

  await expectNoFatalSignals(page, fatalSignals);
});

test("card-level tracker dropdowns open and stay wired after rerender", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  await page.locator("#addNpcBtn").click();
  await page.locator("#addPartyBtn").click();
  await page.locator("#addLocBtn").click();

  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(1);
  await expect(page.locator("#locCards .trackerCard")).toHaveCount(1);

  await expectEnhancedDropdownOpen(
    page,
    page.locator("#npcCards .trackerCard .npcCardFooter .selectDropdown .cardSelectBtn")
  );
  await closeOpenDropdown(page);

  await expectEnhancedDropdownOpen(
    page,
    page.locator("#partyCards .trackerCard .npcCardFooter .selectDropdown .cardSelectBtn")
  );
  await closeOpenDropdown(page);

  await expectEnhancedDropdownOpen(
    page,
    page.locator("#locCards .trackerCard .npcCollapsible .selectDropdown .cardSelectBtn"),
    { openWith: "keyboard" }
  );
  await page.locator("#locCards .trackerCard .npcCollapsible select.cardSelect").first().selectOption("dungeon");

  const locationTypeButton = page.locator("#locCards .trackerCard .npcCollapsible .selectDropdown .cardSelectBtn").first();
  await expect(locationTypeButton).toContainText("Dungeon");
  await expect.poll(() => page.evaluate(() => (
    Array.from(document.querySelectorAll(".dropdownMenu"))
      .filter((menu) => menu.hidden === false)
      .length
  ))).toBe(0);

  await expectEnhancedDropdownOpen(
    page,
    page.locator("#locCards .trackerCard .npcCardFooter .selectDropdown .cardSelectBtn")
  );
  await closeOpenDropdown(page);

  await expectEnhancedDropdownOpen(
    page,
    locationTypeButton,
    { openWith: "keyboard" }
  );
  await closeOpenDropdown(page);

  await expectNoFatalSignals(page, fatalSignals);
});

test("card-level tracker dropdown options stay clickable in the body-ported card menu path", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  const fatalSignals = await openSmokeApp(page);

  await page.locator("#addNpcBtn").click();
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);

  const buttonSelector = "#npcCards .trackerCard .npcCardFooter .selectDropdown .cardSelectBtn";
  const button = page.locator(buttonSelector).first();

  await expectEnhancedDropdownOpen(page, button);

  const layerInfo = await inspectOpenMenuHitTarget(page, { buttonSelector, optionIndex: 1 });
  expect(layerInfo).not.toBeNull();
  expect(layerInfo).toEqual(expect.objectContaining({
    menuParent: "BODY",
    menuPointerEvents: "auto",
    menuContainsHit: true,
  }));
  expect(layerInfo?.optionContainsHit).toBe(true);
  expect(Number(layerInfo?.menuZIndex)).toBeGreaterThan(200);

  await page.mouse.click(layerInfo.point.x, layerInfo.point.y);
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(0);
  await expect(page.locator("#npcCards .mutedSmall")).toContainText("No NPCs in this section yet.");
  await expect.poll(() => page.evaluate(() => (
    Array.from(document.querySelectorAll(".dropdownMenu"))
      .filter((menu) => menu.hidden === false)
      .length
  ))).toBe(0);

  await expectNoFatalSignals(page, fatalSignals);
});
