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
  await expect(page.locator("#combatCardsStatus")).toHaveText("2 combatants in combat.");
  await expect(page.locator(".combatCard")).toHaveCount(2);

  await expectNoFatalSignals(page, fatalSignals);
});

test("combat cards support Slice 5 turn, role, HP, order, remove, undo, and clear flows", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Combat Cards Smoke" });

  await page.locator("#addNpcBtn").click();
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);
  await page.locator("#npcCards .trackerCard .npcHpInput").nth(0).fill("10");
  await page.locator("#npcCards .trackerCard .npcHpInput").nth(1).fill("12");

  const combatButton = page.locator("#npcCards .trackerCard .npcCardFooter button[title='Add to combat']").first();
  await combatButton.click();
  await combatButton.click();

  await page.getByRole("tab", { name: "Combat" }).click();
  await expect(page.locator(".combatCard")).toHaveCount(2);
  await expect(page.locator("#combatNextTurnBtn")).toBeEnabled();
  await expect(page.locator("#combatClearBtn")).toBeEnabled();

  await page.locator(".combatCard").first().locator(".combatRoleSelect").selectOption("enemy");
  await expect.poll(() => page.evaluate(() => ({
    role: globalThis.__APP_STATE__?.combat?.encounter?.participants?.[0]?.role,
    sourceGroup: globalThis.__APP_STATE__?.tracker?.npcs?.[0]?.group
  }))).toEqual({ role: "enemy", sourceGroup: "undecided" });

  await page.locator(".combatCard").first().locator(".combatHpAmountInput").fill("4");
  await page.locator(".combatCard").first().getByRole("button", { name: "Damage" }).click();
  await expect(page.locator(".combatCard").first().locator(".combatHpValue")).toHaveText("6 / 12");
  await expect.poll(() => page.evaluate(() => ({
    firstHp: globalThis.__APP_STATE__?.combat?.encounter?.participants?.[0]?.hpCurrent,
    duplicateHp: globalThis.__APP_STATE__?.combat?.encounter?.participants?.[1]?.hpCurrent,
    sourceHp: globalThis.__APP_STATE__?.tracker?.npcs?.[0]?.hpCurrent
  }))).toEqual({ firstHp: 6, duplicateHp: 10, sourceHp: 6 });
  await page.getByRole("tab", { name: "Tracker" }).click();
  await expect(page.locator("#npcCards .trackerCard .npcHpInput").nth(0)).toHaveValue("6");
  await page.getByRole("tab", { name: "Combat" }).click();

  await page.locator(".combatCard").first().getByRole("button", { name: "Down" }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.encounter?.participants?.map((p) => p.hpCurrent)))
    .toEqual([10, 6]);

  await page.locator(".combatCard").first().getByRole("button", { name: "Make Active" }).click();
  await expect(page.locator(".combatCard").first().locator(".combatActiveBadge")).toHaveText("Active");

  await page.locator("#combatTurnSecondsInput").fill("9");
  await page.locator("#combatTurnSecondsInput").blur();
  await page.locator("#combatNextTurnBtn").click();
  await expect(page.locator("#combatElapsedValue")).toHaveText("00:09");
  await expect(page.locator("#combatUndoBtn")).toBeEnabled();

  await page.locator("#combatUndoBtn").click();
  await expect(page.locator("#combatElapsedValue")).toHaveText("00:00");

  await page.locator(".combatCard").last().getByRole("button", { name: "Remove" }).click();
  await expect(page.locator(".combatCard")).toHaveCount(1);
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);

  const workspaceOrderBeforeClear = await page.evaluate(() => globalThis.__APP_STATE__?.combat?.workspace?.panelOrder);
  await page.locator("#combatClearBtn").click();
  await expect(page.locator("#uiDialogTitle")).toHaveText("Clear Combat");
  await page.locator("#uiDialogOk").click();
  await expect(page.locator("#combatEmptyState")).toBeVisible();
  await expect(page.locator(".combatCard")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.workspace?.panelOrder))
    .toEqual(workspaceOrderBeforeClear);

  await expectNoFatalSignals(page, fatalSignals);
});

test("combat status effects can be added, edited, expired by turns, undone, and removed", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Combat Status Smoke" });

  await page.locator("#addNpcBtn").click();
  await page.locator("#npcCards .trackerCard .npcCardFooter button[title='Add to combat']").first().click();
  await page.getByRole("tab", { name: "Combat" }).click();
  await expect(page.locator(".combatCard")).toHaveCount(1);

  const card = page.locator(".combatCard").first();
  const composer = card.locator(".combatStatusComposer");
  await composer.locator(".combatStatusAddLabelInput").fill("Burning");
  await composer.locator(".combatStatusModeSelect").selectOption("time");
  await composer.locator(".combatStatusDurationInput").fill("6");
  await composer.getByRole("button", { name: "Add Status" }).click();
  await expect(card.locator(".combatStatusChip")).toHaveText("Burning (6s)");
  await expect.poll(() => page.evaluate(() => ({
    statusEffects: globalThis.__APP_STATE__?.combat?.encounter?.participants?.[0]?.statusEffects,
    sourceStatus: globalThis.__APP_STATE__?.tracker?.npcs?.[0]?.status
  }))).toEqual(expect.objectContaining({
    sourceStatus: "Burning"
  }));

  const effectRow = card.locator(".combatStatusEffect").first();
  await effectRow.locator(".combatStatusLabelInput").fill("Burning Fast");
  await effectRow.locator(".combatStatusDurationInput").fill("6");
  await effectRow.getByRole("button", { name: "Save" }).click();
  await expect(card.locator(".combatStatusChip")).toHaveText("Burning Fast (6s)");
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.tracker?.npcs?.[0]?.status))
    .toBe("Burning Fast");

  await page.locator("#combatNextTurnBtn").click();
  await expect(card.locator(".combatStatusChip")).toHaveText("Burning Fast (0s)");
  await expect(card.locator(".combatStatusEffect")).toHaveClass(/isExpired/);
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.encounter?.participants?.[0]?.statusEffects?.[0]))
    .toEqual(expect.objectContaining({ remaining: 0, expired: true }));

  await page.locator("#combatUndoBtn").click();
  await expect(card.locator(".combatStatusChip")).toHaveText("Burning Fast (6s)");
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.encounter?.participants?.[0]?.statusEffects?.[0]))
    .toEqual(expect.objectContaining({ remaining: 6, expired: false }));

  await card.locator(".combatStatusEffect").first().getByRole("button", { name: "Remove" }).click();
  await expect(card.locator(".combatNoStatus")).toHaveText("No status effects");
  await expect.poll(() => page.evaluate(() => ({
    effects: globalThis.__APP_STATE__?.combat?.encounter?.participants?.[0]?.statusEffects,
    sourceStatus: globalThis.__APP_STATE__?.tracker?.npcs?.[0]?.status
  }))).toEqual({
    effects: [],
    sourceStatus: ""
  });

  await expectNoFatalSignals(page, fatalSignals);
});
