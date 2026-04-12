import { expect, test } from "@playwright/test";
import {
  expectNoFatalSignals,
  openSmokeApp
} from "./helpers/smokeApp.js";

async function writeStoredCombatPanelOrder(page, panelOrder) {
  // Campaign creation saves through the app's debounced SaveManager; let that
  // initial write settle before seeding the persisted Combat workspace layout.
  await page.waitForTimeout(700);
  await expect.poll(async () => page.evaluate((nextPanelOrder) => {
    const storageKey = "localCampaignTracker_v1";
    const raw = window.localStorage.getItem(storageKey);
    const vault = raw ? JSON.parse(raw) : null;
    const activeCampaignId = vault?.appShell?.activeCampaignId;
    if (!activeCampaignId || !vault?.campaignDocs?.[activeCampaignId]?.combat?.workspace) return false;
    vault.campaignDocs[activeCampaignId].combat.workspace.panelOrder = nextPanelOrder;
    window.localStorage.setItem(storageKey, JSON.stringify(vault));
    return true;
  }, panelOrder)).toBe(true);
}

test("combat tab keeps Combat Cards as a movable full-column owner", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Combat Shell Smoke" });

  await writeStoredCombatPanelOrder(page, ["combatRoundPanel", "combatCardsPanel"]);
  await page.reload();
  await expect(page.locator("main")).toBeVisible();

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

  await expect(page.locator("#combatCol1 > #combatCardsPanel")).toBeVisible();
  await expect(page.locator("#combatCol0 > #combatRoundPanel")).toBeVisible();
  await expect(page.locator("#combatCol0 > #combatEmbeddedPanels")).toBeAttached();
  await expect(page.locator("#combatCol1 > #combatRoundPanel")).toHaveCount(0);
  await expect(page.locator("#combatCol1 > #combatEmbeddedPanels")).toHaveCount(0);
  await expect(page.locator("#combatCardsPanel .sectionMoves")).toHaveCount(1);
  await expect(page.locator("#combatRoundPanel .sectionMoves")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.workspace?.panelOrder))
    .toEqual(["combatRoundPanel", "combatCardsPanel"]);

  await page.locator("#combatCardsPanel .sectionMoves button[title='Move section up']").click();
  await expect(page.locator("#combatCol0 > #combatCardsPanel")).toBeVisible();
  await expect(page.locator("#combatCol1 > #combatRoundPanel")).toBeVisible();
  await expect(page.locator("#combatCol1 > #combatEmbeddedPanels")).toBeAttached();
  await expect(page.locator("#combatCol0 > #combatRoundPanel")).toHaveCount(0);
  await expect(page.locator("#combatCol0 > #combatEmbeddedPanels")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.workspace?.panelOrder))
    .toEqual(["combatCardsPanel", "combatRoundPanel"]);

  await page.locator("#combatRoundPanel > .panelHeader").click();
  await expect(page.locator("#combatRoundPanel")).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.workspace?.panelCollapsed))
    .toEqual({ combatRoundPanel: true });

  await expectNoFatalSignals(page, fatalSignals);
});

test("combat owned columns keep the intended mobile stacking order", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  const fatalSignals = await openSmokeApp(page, { campaignName: "Combat Mobile Layout Smoke" });

  await writeStoredCombatPanelOrder(page, ["combatRoundPanel", "combatCardsPanel"]);
  await page.reload();
  await expect(page.locator("main")).toBeVisible();

  await page.getByRole("tab", { name: "Combat" }).click();
  await page.locator("[data-add-embedded-panel='vitals']").click();

  const layout = await page.evaluate(() => {
    const cards = document.getElementById("combatCardsPanel");
    const round = document.getElementById("combatRoundPanel");
    const embedded = document.getElementById("combatEmbeddedPanels");
    const columns = document.getElementById("combatColumns");
    return {
      cardsParent: cards?.parentElement?.id || "",
      roundParent: round?.parentElement?.id || "",
      embeddedParent: embedded?.parentElement?.id || "",
      columnsTemplate: columns ? getComputedStyle(columns).gridTemplateColumns : "",
      cardsTop: cards?.getBoundingClientRect().top || 0,
      roundTop: round?.getBoundingClientRect().top || 0,
      embeddedTop: embedded?.getBoundingClientRect().top || 0
    };
  });

  expect(layout.cardsParent).toBe("combatCol1");
  expect(layout.roundParent).toBe("combatCol0");
  expect(layout.embeddedParent).toBe("combatCol0");
  expect(layout.columnsTemplate.trim().split(/\s+/)).toHaveLength(1);
  expect(layout.cardsTop).toBeGreaterThan(layout.roundTop);
  expect(layout.embeddedTop).toBeGreaterThan(layout.roundTop);
  expect(layout.cardsTop).toBeGreaterThan(layout.embeddedTop);

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
  await expect(combatButton).toHaveText("Added");
  await expect(combatButton).toHaveClass(/combatActionSuccess/);
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

test("combat cards support turn, role, order (↑/↓ buttons), remove, undo, and clear flows", async ({ page }) => {
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

  // Role override — encounter-only, does not touch source section
  await expect(page.locator(".combatCard").first().locator(".combatRoleSelect")).toHaveClass(/panelSelect/);
  await expect(page.locator(".combatCard").first().locator(".combatCardHeader .selectDropdown .panelSelectBtn")).toBeVisible();
  await page.locator(".combatCard").first().locator(".combatRoleSelect").selectOption("enemy");
  await expect.poll(() => page.evaluate(() => ({
    role: globalThis.__APP_STATE__?.combat?.encounter?.participants?.[0]?.role,
    sourceGroup: globalThis.__APP_STATE__?.tracker?.npcs?.[0]?.group
  }))).toEqual({ role: "enemy", sourceGroup: "undecided" });

  // Enemy role should apply the role-tint class
  await expect(page.locator(".combatCard").first()).toHaveClass(/combatRole-enemy/);

  // HP modal flow: click HP area → modal opens → enter amount → Damage → modal closes
  await page.locator(".combatCard").first().locator(".combatHpBtn").click();
  await expect(page.locator("#combatHpModal")).toBeVisible();
  await page.locator("#combatHpModal .combatHpModalInput").fill("4");
  await page.locator("#combatHpModal [data-combat-hp-action='damage']").click();
  await expect(page.locator("#combatHpModal")).not.toBeVisible();
  await expect(page.locator(".combatCard").first().locator(".combatHpValue")).toHaveText("6");

  await expect.poll(() => page.evaluate(() => ({
    firstHp: globalThis.__APP_STATE__?.combat?.encounter?.participants?.[0]?.hpCurrent,
    duplicateHp: globalThis.__APP_STATE__?.combat?.encounter?.participants?.[1]?.hpCurrent,
    sourceHp: globalThis.__APP_STATE__?.tracker?.npcs?.[0]?.hpCurrent
  }))).toEqual({ firstHp: 6, duplicateHp: 10, sourceHp: 6 });

  // Tracker writeback — current HP updates
  await page.getByRole("tab", { name: "Tracker" }).click();
  await expect(page.locator("#npcCards .trackerCard .npcHpInput").nth(0)).toHaveValue("6");
  await page.getByRole("tab", { name: "Combat" }).click();

  // Move order with ↓ button (reusing moveBtn style)
  await page.locator(".combatCard").first().locator("button[title='Move later in order']").click();
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.encounter?.participants?.map((p) => p.hpCurrent)))
    .toEqual([10, 6]);

  // Make active
  await page.locator(".combatCard").first().locator("button[data-combat-action='make-active']").click();
  await expect(page.locator(".combatCard").first().locator(".combatActiveBadge")).toHaveText("Active");

  // No initiative counter / order badge on any card
  await expect(page.locator(".combatOrderBadge")).toHaveCount(0);

  // Turn controls: display area opens modal, Save persists, Cancel leaves it alone.
  await expect(page.locator("#combatTurnSecondsInput")).toHaveCount(0);
  await page.locator("#combatTurnSecondsButton").click();
  await expect(page.locator("#combatTurnSecondsModal")).toBeVisible();
  await expect(page.locator("#combatTurnSecondsModal .combatTurnSecondsModalInput")).toHaveValue("6");
  await page.locator("#combatTurnSecondsModal .combatTurnSecondsModalInput").fill("9");
  await page.locator("#combatTurnSecondsModal [data-combat-turn-seconds-save]").click();
  await expect(page.locator("#combatTurnSecondsModal")).not.toBeVisible();
  await expect(page.locator("#combatTurnSecondsValue")).toHaveText("9s");
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.encounter?.secondsPerTurn))
    .toBe(9);

  await page.locator("#combatTurnSecondsButton").click();
  await expect(page.locator("#combatTurnSecondsModal")).toBeVisible();
  await page.locator("#combatTurnSecondsModal .combatTurnSecondsModalInput").fill("12");
  await page.locator("#combatTurnSecondsModal [data-combat-turn-seconds-close]").last().click();
  await expect(page.locator("#combatTurnSecondsModal")).not.toBeVisible();
  await expect(page.locator("#combatTurnSecondsValue")).toHaveText("9s");
  await page.locator("#combatNextTurnBtn").click();
  await expect(page.locator("#combatElapsedValue")).toHaveText("00:09");
  await expect(page.locator("#combatUndoBtn")).toBeEnabled();

  await page.locator("#combatUndoBtn").click();
  await expect(page.locator("#combatElapsedValue")).toHaveText("00:00");

  await page.locator(".combatCard").last().locator("button[data-combat-action='remove']").click();
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

test("HP modal applies heal and temp HP correctly", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Combat HP Modal Smoke" });

  await page.locator("#addNpcBtn").click();
  await page.locator("#npcCards .trackerCard .npcHpInput").nth(0).fill("5");
  await page.locator("#npcCards .trackerCard .npcHpInput").nth(1).fill("10");
  await page.locator("#npcCards .trackerCard .npcCardFooter button[title='Add to combat']").first().click();

  await page.getByRole("tab", { name: "Combat" }).click();
  await expect(page.locator(".combatCard")).toHaveCount(1);

  const card = page.locator(".combatCard").first();
  await expect(card.locator(".combatHpValue")).toHaveText("5");
  const normalHpColor = await card.locator(".combatHpValue").evaluate((el) => getComputedStyle(el).color);

  // Temp HP — the single HP value turns blue without rendering a separate temp HP area
  await card.locator(".combatHpBtn").click();
  await expect(page.locator("#combatHpModal")).toBeVisible();
  await page.locator("#combatHpModal .combatHpModalInput").fill("3");
  await page.locator("#combatHpModal [data-combat-hp-action='temp']").click();
  await expect(page.locator("#combatHpModal")).not.toBeVisible();
  await expect(card.locator(".combatTempHpBadge")).toHaveCount(0);
  await expect(card.locator(".combatHpValue")).toHaveText("8");
  await expect(card.locator(".combatHpBtn")).toHaveClass(/hasTempHp/);
  await expect.poll(() => card.locator(".combatHpValue").evaluate((el) => getComputedStyle(el).color))
    .not.toBe(normalHpColor);

  // Damage hits temp HP first, then current HP
  await card.locator(".combatHpBtn").click();
  await page.locator("#combatHpModal .combatHpModalInput").fill("5");
  await page.locator("#combatHpModal [data-combat-hp-action='damage']").click();
  await expect(card.locator(".combatHpValue")).toHaveText("3");
  await expect(card.locator(".combatHpBtn")).not.toHaveClass(/hasTempHp/);
  await expect.poll(() => card.locator(".combatHpValue").evaluate((el) => getComputedStyle(el).color))
    .toBe(normalHpColor);

  // Zero HP — the same single HP value turns red via a zero-state class
  await card.locator(".combatHpBtn").click();
  await page.locator("#combatHpModal .combatHpModalInput").fill("3");
  await page.locator("#combatHpModal [data-combat-hp-action='damage']").click();
  await expect(card.locator(".combatHpValue")).toHaveText("0");
  await expect(card.locator(".combatHpBtn")).toHaveClass(/isZeroHp/);

  // Heal
  await card.locator(".combatHpBtn").click();
  await page.locator("#combatHpModal .combatHpModalInput").fill("5");
  await page.locator("#combatHpModal [data-combat-hp-action='heal']").click();
  await expect(card.locator(".combatHpValue")).toHaveText("5");

  // Cancel closes without change
  await card.locator(".combatHpBtn").click();
  await page.locator("#combatHpModal [data-combat-hp-close]").first().click();
  await expect(page.locator("#combatHpModal")).not.toBeVisible();
  await expect(card.locator(".combatHpValue")).toHaveText("5");

  await expectNoFatalSignals(page, fatalSignals);
});

test("status modal can add, edit, and remove status effects; countdown and undo work", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Combat Status Smoke" });

  await page.locator("#addNpcBtn").click();
  await page.locator("#npcCards .trackerCard .npcCardFooter button[title='Add to combat']").first().click();
  await page.getByRole("tab", { name: "Combat" }).click();
  await expect(page.locator(".combatCard")).toHaveCount(1);

  const card = page.locator(".combatCard").first();

  // Open status modal via "+ Status Effect" button
  await card.locator("button[data-combat-action='status-modal-open-add']").click();
  await expect(page.locator("#combatStatusModal")).toBeVisible();

  // Fill label + timed duration
  await page.locator("#combatStatusModal .combatStatusModalLabelInput").fill("Burning");
  await expect(page.locator("#combatStatusModal .combatStatusModalModeSelect")).toHaveClass(/settingsSelect/);
  await expect(page.locator("#combatStatusModal .combatStatusModalDuration .selectDropdown .settingsSelectBtn")).toBeVisible();
  await page.locator("#combatStatusModal .combatStatusModalModeSelect").selectOption("seconds");
  await page.locator("#combatStatusModal .combatStatusModalDurationInput").fill("6");
  await page.locator("#combatStatusModal [data-combat-status-apply]").click();
  await expect(page.locator("#combatStatusModal")).not.toBeVisible();

  await expect(card.locator(".combatStatusCompactRow")).toHaveCount(1);
  await expect(card.locator(".combatStatusCompactRow").locator(".combatStatusGearBtn")).toBeVisible();
  await expect(card.locator(".combatStatusNameBox")).toHaveText("Burning");
  await expect(card.locator(".combatStatusDurationBox")).toHaveText("6s");
  await expect.poll(() => page.evaluate(() => ({
    statusEffects: globalThis.__APP_STATE__?.combat?.encounter?.participants?.[0]?.statusEffects,
    sourceStatus: globalThis.__APP_STATE__?.tracker?.npcs?.[0]?.status
  }))).toEqual(expect.objectContaining({
    sourceStatus: "Burning"
  }));

  // Edit via gear button — modal pre-fills with existing data
  await card.locator(".combatStatusGearBtn").first().click();
  await expect(page.locator("#combatStatusModal")).toBeVisible();
  await expect(page.locator("#combatStatusModal .combatStatusModalLabelInput")).toHaveValue("Burning");
  await page.locator("#combatStatusModal .combatStatusModalLabelInput").fill("Burning Fast");
  await page.locator("#combatStatusModal .combatStatusModalDurationInput").fill("6");
  await page.locator("#combatStatusModal [data-combat-status-apply]").click();
  await expect(page.locator("#combatStatusModal")).not.toBeVisible();

  await expect(card.locator(".combatStatusNameBox")).toHaveText("Burning Fast");
  await expect(card.locator(".combatStatusDurationBox")).toHaveText("6s");
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.tracker?.npcs?.[0]?.status))
    .toBe("Burning Fast");

  // Status countdown on Next Turn
  await page.locator("#combatNextTurnBtn").click();
  await expect(card.locator(".combatStatusNameBox")).toHaveText("Burning Fast");
  await expect(card.locator(".combatStatusDurationBox")).toHaveText("0s");
  await expect(card.locator(".combatStatusCompactRow")).toHaveClass(/isExpired/);
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.encounter?.participants?.[0]?.statusEffects?.[0]))
    .toEqual(expect.objectContaining({ remaining: 0, expired: true }));

  // Undo restores status
  await page.locator("#combatUndoBtn").click();
  await expect(card.locator(".combatStatusNameBox")).toHaveText("Burning Fast");
  await expect(card.locator(".combatStatusDurationBox")).toHaveText("6s");
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.encounter?.participants?.[0]?.statusEffects?.[0]))
    .toEqual(expect.objectContaining({ remaining: 6, expired: false }));

  // Remove via modal
  await card.locator(".combatStatusGearBtn").first().click();
  await expect(page.locator("#combatStatusModal [data-combat-status-remove]")).toBeVisible();
  await page.locator("#combatStatusModal [data-combat-status-remove]").click();
  await expect(page.locator("#combatStatusModal")).not.toBeVisible();

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

test("combat cards show portrait area and apply role tint; no initiative counter shown", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Combat Portrait Role Smoke" });

  await page.locator("#addNpcBtn").click();
  await page.locator("#npcCards .trackerCard .npcCardFooter button[title='Add to combat']").first().click();

  await page.getByRole("tab", { name: "Combat" }).click();
  await expect(page.locator(".combatCard")).toHaveCount(1);

  const card = page.locator(".combatCard").first();

  // Portrait area is always rendered (even as avatar fallback when no image set)
  await expect(card.locator(".combatCardPortrait")).toBeVisible();

  // No initiative counter / order badge
  await expect(card.locator(".combatOrderBadge")).toHaveCount(0);

  // Default role (npc inferred) gets appropriate class
  const roleClass = await card.getAttribute("class");
  expect(roleClass).toMatch(/combatRole-(party|enemy|npc)/);

  // Change to enemy — red tint class applied
  await card.locator(".combatRoleSelect").selectOption("enemy");
  await expect(card).toHaveClass(/combatRole-enemy/);
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el, "::before").backgroundColor))
    .not.toBe("rgba(0, 0, 0, 0)");

  // Change to npc — gray tint class applied
  await card.locator(".combatRoleSelect").selectOption("npc");
  await expect(card).toHaveClass(/combatRole-npc/);
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el, "::before").backgroundColor))
    .not.toBe("rgba(0, 0, 0, 0)");

  // Change to party — no special tint class (normal background)
  await card.locator(".combatRoleSelect").selectOption("party");
  await expect(card).toHaveClass(/combatRole-party/);
  // combatRole-party has no background override in CSS; verify the other tints are absent
  const finalClass = await card.getAttribute("class");
  expect(finalClass).not.toMatch(/combatRole-enemy|combatRole-npc/);
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el, "::before").content))
    .toBe("none");

  await expectNoFatalSignals(page, fatalSignals);
});

test("combat workspace panel picker adds embedded panels, persists selection, prevents duplicates, and supports animated reorder + remove", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Combat Embedded Panels Smoke" });

  await page.getByRole("tab", { name: "Combat" }).click();
  await expect(page.locator("#page-combat")).toBeVisible();

  // All three panels are available to add initially
  await expect(page.locator("[data-add-embedded-panel='vitals']")).toBeVisible();
  await expect(page.locator("[data-add-embedded-panel='spells']")).toBeVisible();
  await expect(page.locator("[data-add-embedded-panel='weapons']")).toBeVisible();

  // Add Vitals
  await page.locator("[data-add-embedded-panel='vitals']").click();
  await expect(page.locator("#combatEmbeddedPanel_vitals")).toBeVisible();
  await expect(page.locator("#combatCol1 > #combatEmbeddedPanels > #combatEmbeddedPanel_vitals")).toBeVisible();
  await expect(page.locator("#combatCol0 #combatEmbeddedPanel_vitals")).toHaveCount(0);

  // Vitals button disappears from picker (duplicate prevention)
  await expect(page.locator("[data-add-embedded-panel='vitals']")).not.toBeVisible();

  // State persists in workspace
  await expect.poll(() =>
    page.evaluate(() => globalThis.__APP_STATE__?.combat?.workspace?.embeddedPanels)
  ).toEqual(["vitals"]);

  // Add Spells
  await page.locator("[data-add-embedded-panel='spells']").click();
  await expect(page.locator("#combatEmbeddedPanel_spells")).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => globalThis.__APP_STATE__?.combat?.workspace?.embeddedPanels)
  ).toEqual(["vitals", "spells"]);

  // Reorder active embedded panels without affecting the core column-owner panels.
  const moveAnimation = await page.evaluate(async () => {
    const button = document.querySelector("#combatEmbeddedPanel_spells [data-move-embedded-panel='-1']");
    if (!(button instanceof HTMLButtonElement)) return { transition: "", order: [] };
    button.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const moved = document.querySelector("#combatEmbeddedPanel_spells");
    return {
      transition: moved instanceof HTMLElement ? moved.style.transition : "",
      order: Array.from(document.querySelectorAll("#combatEmbeddedPanels > [data-embedded-panel-id]"))
        .map((el) => el.getAttribute("data-embedded-panel-id"))
    };
  });
  expect(moveAnimation.transition).toContain("transform");
  expect(moveAnimation.order).toEqual(["spells", "vitals"]);
  await expect(page.locator("#combatCol1 > #combatEmbeddedPanels > #combatEmbeddedPanel_spells")).toBeVisible();
  await expect(page.locator("#combatCol1 > #combatEmbeddedPanels > #combatEmbeddedPanel_vitals")).toBeVisible();
  await expect(page.locator("#combatCol0 [data-embedded-panel-id]")).toHaveCount(0);
  await expect.poll(() =>
    page.evaluate(() => globalThis.__APP_STATE__?.combat?.workspace?.embeddedPanels)
  ).toEqual(["spells", "vitals"]);
  await expect.poll(() => page.evaluate(() =>
    Array.from(document.querySelectorAll("#combatEmbeddedPanels > [data-embedded-panel-id]"))
      .map((el) => el.getAttribute("data-embedded-panel-id"))
  )).toEqual(["spells", "vitals"]);
  await expect.poll(() =>
    page.evaluate(() => globalThis.__APP_STATE__?.combat?.workspace?.panelOrder)
  ).toEqual(["combatCardsPanel", "combatRoundPanel"]);

  // Reorder/remove controls live in the source panel header controls, not in
  // separate floating host chrome.
  await expect(page.locator("#combatEmbeddedPanel_vitals > .panelHeader")).toHaveCount(0);
  await expect(page.locator("#combatEmbeddedPanel_vitals > .combatEmbeddedPanelChrome")).toHaveCount(0);
  await expect(page.locator("#combatEmbeddedPanel_vitals [data-panel-header] .panelControls [data-move-embedded-panel]")).toHaveCount(2);
  await expect(page.locator("#combatEmbeddedPanel_vitals [data-panel-header] .panelControls [data-remove-embedded-panel='vitals']")).toBeVisible();
  await expect(page.locator("#combatEmbeddedPanel_vitals [data-toggle-embedded-panel]")).toHaveCount(0);

  // Remove the Vitals panel
  await page.locator("[data-remove-embedded-panel='vitals']").click();
  await expect(page.locator("#combatEmbeddedPanel_vitals")).not.toBeVisible();

  // Vitals is available in the picker again
  await expect(page.locator("[data-add-embedded-panel='vitals']")).toBeVisible();

  await expect.poll(() =>
    page.evaluate(() => globalThis.__APP_STATE__?.combat?.workspace?.embeddedPanels)
  ).toEqual(["spells"]);

  // Add all three — picker shows "All panels added." when full
  await page.locator("[data-add-embedded-panel='vitals']").click();
  await page.locator("[data-add-embedded-panel='weapons']").click();
  await expect(page.locator("[data-add-embedded-panel='vitals']")).not.toBeVisible();
  await expect(page.locator("[data-add-embedded-panel='spells']")).not.toBeVisible();
  await expect(page.locator("[data-add-embedded-panel='weapons']")).not.toBeVisible();
  await expect(page.locator("#combatPanelPickerRow")).toContainText("All panels added.");

  // Workspace layout (panelOrder) and encounter state are unaffected
  await expect.poll(() =>
    page.evaluate(() => globalThis.__APP_STATE__?.combat?.encounter?.participants?.length ?? 0)
  ).toBe(0);

  await expectNoFatalSignals(page, fatalSignals);
});

test("combat embedded panels preserve source-panel interactions against canonical character data", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Combat Embedded Fidelity Smoke" });

  await page.getByRole("tab", { name: "Combat" }).click();
  await page.locator("[data-add-embedded-panel='vitals']").click();
  await page.locator("[data-add-embedded-panel='spells']").click();
  await page.locator("[data-add-embedded-panel='weapons']").click();

  const vitals = page.locator("#combatEmbeddedPanel_vitals");
  const spells = page.locator("#combatEmbeddedPanel_spells");
  const weapons = page.locator("#combatEmbeddedPanel_weapons");

  // Fidelity markers: source-panel structures are hosted, not reduced summary rows.
  await expect(vitals.locator(".charTiles")).toBeVisible();
  await expect(spells.locator(".spellLevels")).toBeVisible();
  await expect(weapons.locator(".attackList")).toBeVisible();
  await expect(vitals.locator(".combatEmbedResourceRow")).toHaveCount(0);
  await expect(spells.locator(".combatEmbedSpellRow")).toHaveCount(0);
  await expect(weapons.locator(".combatEmbedWeaponRow")).toHaveCount(0);
  await expect(page.locator("#combatEmbeddedPanel_vitals > .panelHeader :is(h2, h3, h4)")).toHaveCount(0);
  await expect(page.locator("#combatEmbeddedPanel_spells > .panelHeader :is(h2, h3, h4)")).toHaveCount(0);
  await expect(page.locator("#combatEmbeddedPanel_weapons > .panelHeader :is(h2, h3, h4)")).toHaveCount(0);
  await expect(vitals.locator("#combatEmbeddedVitalsSource > .panelHeader h2")).toHaveText("Vitals");
  await expect(spells.locator("#combatEmbeddedSpellsSource > .row h2")).toHaveText("Spells");
  await expect(weapons.locator("#combatEmbeddedWeaponsSource > .row h2")).toHaveText("Weapons");
  await expect(vitals.locator("#combatEmbeddedVitalsSource h2")).toHaveCount(1);
  await expect(spells.locator("#combatEmbeddedSpellsSource h2")).toHaveCount(1);
  await expect(weapons.locator("#combatEmbeddedWeaponsSource h2")).toHaveCount(1);
  await expect(vitals.locator("#combatEmbeddedVitalsSource > [data-panel-header] .panelControls [data-move-embedded-panel]")).toHaveCount(2);
  await expect(spells.locator("#combatEmbeddedSpellsSource > [data-panel-header] .panelControls [data-move-embedded-panel]")).toHaveCount(2);
  await expect(weapons.locator("#combatEmbeddedWeaponsSource > [data-panel-header] .panelControls [data-move-embedded-panel]")).toHaveCount(2);
  await expect(page.locator("#combatEmbeddedPanels [data-toggle-embedded-panel]")).toHaveCount(0);

  // Embedded panels collapse/expand from the real source header and persist via
  // the existing combat workspace collapsed-state bucket.
  await vitals.locator("#combatEmbeddedVitalsSource > [data-panel-header] h2").click();
  await expect(vitals.locator("#combatEmbeddedVitalsSource")).toHaveAttribute("aria-expanded", "false");
  await expect(vitals.locator("#combatEmbeddedVitalsTiles")).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.combat?.workspace?.panelCollapsed))
    .toEqual({ combatEmbeddedPanel_vitals: true });
  await vitals.locator("#combatEmbeddedVitalsSource > [data-panel-header] h2").click();
  await expect(vitals.locator("#combatEmbeddedVitalsSource")).toHaveAttribute("aria-expanded", "true");
  await expect(vitals.locator("#combatEmbeddedVitalsTiles")).toBeVisible();

  // Vitals resource tracker interaction writes canonical character.resources.
  const resourceCountBefore = await page.evaluate(() => globalThis.__APP_STATE__?.character?.resources?.length ?? 0);
  const resourceCur = vitals.locator(".resourceTile input[placeholder='Cur']").first();
  await expect(resourceCur).toBeVisible();
  await resourceCur.fill("2");
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.character?.resources?.[0]?.cur))
    .toBe(2);

  await vitals.locator("#combatEmbeddedAddResourceBtn").click();
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.character?.resources?.length ?? 0))
    .toBe(resourceCountBefore + 1);

  // Spells keep level expand/collapse plus spell-row editing/toggles.
  await expect.poll(() => spells.locator(".spellLevel").count()).toBeGreaterThan(0);
  const firstLevel = spells.locator(".spellLevel").first();
  await firstLevel.locator(".spellCollapseBtn").click();
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.character?.spells?.levels?.[0]?.collapsed))
    .toBe(true);
  await expect(firstLevel.locator(".spellBody")).toHaveCount(0);

  await firstLevel.locator(".spellCollapseBtn").click();
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.character?.spells?.levels?.[0]?.collapsed))
    .toBe(false);

  const spellRowsBefore = await firstLevel.locator(".spellRow").count();
  await firstLevel.getByRole("button", { name: "+ Spell" }).click();
  await expect(firstLevel.locator(".spellRow")).toHaveCount(spellRowsBefore + 1);
  const spellRow = firstLevel.locator(".spellRow").last();
  await spellRow.locator(".spellName").fill("Magic Missile");
  await spellRow.getByRole("button", { name: "Prepared" }).click();
  await expect.poll(() => page.evaluate(() => {
    const spellsList = globalThis.__APP_STATE__?.character?.spells?.levels?.[0]?.spells || [];
    return spellsList.at(-1);
  })).toEqual(expect.objectContaining({
    name: "Magic Missile",
    prepared: true
  }));

  // Weapons / Attacks keep the editable source attack row behavior.
  await weapons.locator("#combatEmbeddedAddAttackBtn").click();
  const attackRow = weapons.locator(".attackRow").first();
  await expect(attackRow).toBeVisible();
  await attackRow.locator(".attackName").fill("Longbow");
  await attackRow.locator(".attackBonus").fill("+6");
  await attackRow.locator(".attackDamage").fill("1d8+3");
  await attackRow.locator(".attackRange").fill("150/600");
  await attackRow.locator(".attackType").fill("Piercing");
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__?.character?.attacks?.[0]))
    .toEqual(expect.objectContaining({
      name: "Longbow",
      bonus: "+6",
      damage: "1d8+3",
      range: "150/600",
      type: "Piercing"
    }));

  await expectNoFatalSignals(page, fatalSignals);
});
