import { expect, test } from "@playwright/test";
import {
  expectNoFatalSignals,
  openSmokeApp
} from "./helpers/smokeApp.js";

test("combat tab opens the shell panels and records shell layout state", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Combat Shell Smoke" });

  await page.getByRole("tab", { name: "Combat" }).click();
  await expect(page.getByRole("tab", { name: "Combat" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#page-combat")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Combat Cards" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Round Controls / Timer" })).toBeVisible();
  await expect(page.locator("#combatEmptyState")).toBeVisible();
  await expect(page.locator("#combatRoundValue")).toHaveText("1");
  await expect(page.locator("#combatElapsedValue")).toHaveText("00:00");
  await expect(page.locator("#combatTurnSecondsValue")).toHaveText("6s");

  await expect(page.locator("#combatNextTurnBtn")).toBeDisabled();
  await expect(page.locator("#combatUndoBtn")).toBeDisabled();
  await expect(page.locator("#combatClearBtn")).toBeDisabled();

  await page.locator("#combatCardsPanel .sectionMoves button[title='Move section down']").click();
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.workspace?.panelOrder))
    .toEqual(["combatRoundPanel", "combatCardsPanel"]);

  await page.locator("#combatRoundPanel > .panelHeader").click();
  await expect(page.locator("#combatRoundPanel")).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.workspace?.panelCollapsed))
    .toEqual({ combatRoundPanel: true });

  await expectNoFatalSignals(page, fatalSignals);
});

test("tracker card footer can add duplicate combat participants without removing the source card", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Combat Add Flow Smoke" });

  await page.locator("#addNpcBtn").click();
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);
  const cardId = await page.locator("#npcCards .trackerCard").first().getAttribute("data-card-id");

  const combatButton = page.locator("#npcCards .trackerCard .npcCardFooter button[title='Add to combat']").first();
  await expect(combatButton).toHaveText("Combat");
  await combatButton.click();
  await combatButton.click();

  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => {
    const participants = globalThis.__APP_STATE__?.combat?.encounter?.participants || [];
    return {
      count: participants.length,
      sourceIds: participants.map((participant) => participant.source?.id),
      ids: participants.map((participant) => participant.id)
    };
  })).toEqual(expect.objectContaining({
    count: 2,
    sourceIds: [cardId, cardId]
  }));
  await expect.poll(() => page.evaluate(() => {
    const participants = globalThis.__APP_STATE__?.combat?.encounter?.participants || [];
    return participants.length === 2 && participants[0].id !== participants[1].id;
  })).toBe(true);

  await page.getByRole("tab", { name: "Combat" }).click();
  await expect(page.locator("#combatCardsStatus")).toHaveText("2 combatants ready for cards.");

  await expectNoFatalSignals(page, fatalSignals);
});
