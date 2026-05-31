import { expect, test } from "@playwright/test";
import {
  ensureActiveCharacter,
  expectNoFatalSignals,
  openMapWorkspace,
  openSmokeApp,
} from "./helpers/smokeApp.js";

async function readAbilityHeaderLayout(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#charAbilitiesPanel .abilityBlock")).map((block) => {
      const headerTop = block.querySelector(".abilityHeaderTop");
      const stats = block.querySelector(".abilityStats");
      const moves = block.querySelector(".abilityMoves");
      if (!(headerTop instanceof HTMLElement) || !(stats instanceof HTMLElement) || !(moves instanceof HTMLElement)) {
        return null;
      }

      const topRect = headerTop.getBoundingClientRect();
      const statsRect = stats.getBoundingClientRect();
      const movesRect = moves.getBoundingClientRect();
      return {
        topBottom: topRect.bottom,
        statsTop: statsRect.top,
        movesBottom: movesRect.bottom,
      };
    })
  );
}

test("ability headers keep move buttons clear of the save row at the narrow two-column width", async ({ page }) => {
  await page.setViewportSize({ width: 381, height: 844 });
  const fatalSignals = await openSmokeApp(page);

  await ensureActiveCharacter(page);

  const gridColumns = await page.evaluate(() => {
    const grid = document.querySelector("#charAbilitiesPanel .abilityGrid");
    if (!(grid instanceof HTMLElement)) return 0;
    return getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
  });
  expect(gridColumns).toBe(2);

  const layout = await readAbilityHeaderLayout(page);
  expect(layout.every(Boolean)).toBe(true);
  for (const block of layout) {
    if (!block) continue;
    expect(block.statsTop - block.topBottom).toBeGreaterThanOrEqual(2);
    expect(block.statsTop - block.movesBottom).toBeGreaterThanOrEqual(2);
  }

  await expectNoFatalSignals(page, fatalSignals);
});

test("ability headers stay clear and the grid collapses cleanly in the mobile single-column layout", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  const fatalSignals = await openSmokeApp(page);

  await ensureActiveCharacter(page);

  const gridColumns = await page.evaluate(() => {
    const grid = document.querySelector("#charAbilitiesPanel .abilityGrid");
    if (!(grid instanceof HTMLElement)) return 0;
    return getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
  });
  expect(gridColumns).toBe(1);

  const layout = await readAbilityHeaderLayout(page);
  expect(layout.every(Boolean)).toBe(true);
  for (const block of layout) {
    if (!block) continue;
    expect(block.statsTop - block.topBottom).toBeGreaterThanOrEqual(2);
    expect(block.statsTop - block.movesBottom).toBeGreaterThanOrEqual(2);
  }

  await expectNoFatalSignals(page, fatalSignals);
});

test("map workspace uses a panel title and keeps the toolbar shell inside the panel at narrower widths", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  const fatalSignals = await openSmokeApp(page);

  await openMapWorkspace(page);
  await expect(page.getByRole("heading", { name: "Map" })).toBeVisible();

  const state = await page.evaluate(() => {
    const panel = document.querySelector("#page-map .mapPanel");
    const mapbar = document.querySelector("#page-map .mapbar");
    const title = document.getElementById("mapPanelTitle");
    if (!(panel instanceof HTMLElement) || !(mapbar instanceof HTMLElement) || !(title instanceof HTMLElement)) {
      return null;
    }

    return {
      titleTag: title.tagName,
      panelScrollWidth: panel.scrollWidth,
      panelClientWidth: panel.clientWidth,
      mapbarScrollWidth: mapbar.scrollWidth,
      mapbarClientWidth: mapbar.clientWidth,
    };
  });

  expect(state).not.toBeNull();
  if (!state) throw new Error("Expected map panel title and toolbar shell to be present");

  expect(state.titleTag).toBe("H2");
  expect(state.panelScrollWidth).toBeLessThanOrEqual(state.panelClientWidth + 2);
  expect(state.mapbarScrollWidth).toBeLessThanOrEqual(state.mapbarClientWidth + 2);

  await expectNoFatalSignals(page, fatalSignals);
});
