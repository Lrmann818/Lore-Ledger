import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

// Restore Character (R3) happy path through the real UI: build a Fighter 1,
// level it to Fighter 2 (which captures one pre-Level-Up snapshot), then open
// Restore Character from the action menu and restore the retained Level 1
// snapshot as a SEPARATE playable character. Verifies the source stays
// Fighter 2, the restored copy is Level 1 with a different top-level id, the
// snapshot is retained (never consumed), everything survives a reload, and a
// second restore of the same snapshot yields a "(2)"-suffixed copy. Also covers
// keyboard/focus behavior, Escape-before-submission, and phone-width layout.
//
// Fighter is used per the R3 spec's flow; a Fighter carries no spell notes, so
// spell-note independence is left to the engine unit tests
// (tests/characterSnapshots.restore.test.js) rather than exercised here.

async function readEntries(page) {
  return page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const entries = Array.isArray(collection?.entries) ? collection.entries : [];
    return JSON.parse(JSON.stringify(entries));
  });
}

async function readActiveId(page) {
  return page.evaluate(() => globalThis.__APP_STATE__?.characters?.activeId ?? null);
}

async function readSnapshots(page) {
  return page.evaluate(() => {
    const snapshots = globalThis.__APP_STATE__?.characters?.snapshots;
    return Array.isArray(snapshots) ? JSON.parse(JSON.stringify(snapshots)) : [];
  });
}

async function createFighterOne(page) {
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill("Smoke Leveler");
  await page.locator("#builderWizardRace").selectOption("half-orc");
  await page.locator("#builderWizardClass").selectOption("fighter");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepRaceChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClasses")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClassChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  const abilityValues = { Str: "15", Dex: "14", Con: "13", Int: "12", Wis: "10", Cha: "8" };
  for (const [suffix, value] of Object.entries(abilityValues)) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();
}

async function levelUpToFighterTwo(page) {
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionLevelUpBtn").click();
  await expect(page.locator("#levelUpStepClass")).toBeVisible();
  await page.locator("#levelUpNext").click(); // class → features
  await expect(page.locator("#levelUpStepFeatures")).toBeVisible();
  await page.locator("#levelUpNext").click(); // features → hp
  await expect(page.locator("#levelUpStepHp")).toBeVisible();
  await page.locator("#levelUpNext").click(); // hp → summary
  await expect(page.locator("#levelUpStepSummary")).toBeVisible();
  await page.locator("#levelUpApply").click();
  await expect(page.locator("#levelUpPanel")).toBeHidden();
}

async function openRestoreDialog(page) {
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionRestoreBtn").click();
  await expect(page.locator("#restoreCharacterPanel")).toBeVisible();
}

test("restore recreates the pre-Level-Up snapshot as a separate playable character", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Restore Smoke" });
  await page.getByRole("tab", { name: "Character" }).click();

  await createFighterOne(page);
  const created = (await readEntries(page))[0];
  expect(created.build.levels).toHaveLength(1);

  await levelUpToFighterTwo(page);
  const afterLevelUp = await readEntries(page);
  expect(afterLevelUp).toHaveLength(1);
  expect(afterLevelUp[0].build.levels).toHaveLength(2);
  const snapshotsAfterLevelUp = await readSnapshots(page);
  expect(snapshotsAfterLevelUp).toHaveLength(1);
  expect(snapshotsAfterLevelUp[0]).toMatchObject({ sourceCharacterId: created.id, fromLevel: 1, toLevel: 2 });

  // Restore Character stays available and lists the retained Level 1 snapshot.
  await openRestoreDialog(page);
  await expect(page.locator(".restoreCharacterRowPrimary").first()).toHaveText("Level 1 — Fighter 1");
  await expect(page.locator("#restoreCharacterEmpty")).toBeHidden();

  // Restore → confirm → engine → persistence → finalize.
  await page.locator(".restoreCharacterRestoreBtn").first().click();
  await expect(page.locator("#uiDialogOverlay")).toBeVisible();
  await expect(page.locator("#uiDialogTitle")).toHaveText('Restore "Smoke Leveler" as it was at Level 1?');
  await page.locator("#uiDialogOk").click();
  await expect(page.locator("#restoreCharacterPanel")).toBeHidden();
  await expect(page.locator("#statusText")).toContainText('Restored "Smoke Leveler — Restored Level 1"');

  // Two playable characters now exist; the restored copy is active.
  const entries = await readEntries(page);
  expect(entries).toHaveLength(2);
  const source = entries.find((e) => e.id === created.id);
  const restored = entries.find((e) => e.id !== created.id);
  expect(source.build.levels).toHaveLength(2);           // source untouched: Fighter 2
  expect(restored.build.levels).toHaveLength(1);          // restored: Level 1
  expect(restored.id).not.toBe(source.id);               // distinct top-level ids
  expect(restored.name).toBe("Smoke Leveler — Restored Level 1");
  expect(restored.restoredFromSnapshotId).toBe(snapshotsAfterLevelUp[0].id);
  expect(await readActiveId(page)).toBe(restored.id);
  // The snapshot is retained (never consumed).
  expect(await readSnapshots(page)).toHaveLength(1);

  // Persistence round trip: both characters and the snapshot survive reload.
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByRole("tab", { name: "Character" }).click();
  const reloaded = await readEntries(page);
  expect(reloaded).toHaveLength(2);
  expect(reloaded.find((e) => e.id === source.id).build.levels).toHaveLength(2);
  expect(reloaded.find((e) => e.id === restored.id).build.levels).toHaveLength(1);
  expect(await readSnapshots(page)).toHaveLength(1);
  // The restored character is usable (its sheet renders its class/level label).
  await page.locator("#charSelector").selectOption(restored.id);
  await expect(page.locator("#charClassLevel")).toHaveValue(/Fighter 1/);

  // Restoring the same snapshot again yields a separate "(2)" copy.
  await openRestoreDialog(page);
  await page.locator(".restoreCharacterRestoreBtn").first().click();
  await expect(page.locator("#uiDialogOverlay")).toBeVisible();
  await page.locator("#uiDialogOk").click();
  await expect(page.locator("#restoreCharacterPanel")).toBeHidden();
  const afterSecond = await readEntries(page);
  expect(afterSecond).toHaveLength(3);
  expect(afterSecond.some((e) => e.name === "Smoke Leveler — Restored Level 1 (2)")).toBe(true);
  // Still exactly one snapshot — repeated restores never consume it.
  expect(await readSnapshots(page)).toHaveLength(1);

  await expectNoFatalSignals(page, fatalSignals);
});

test("Restore Character keyboard, focus, and Escape-before-submission", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Restore Keyboard Smoke" });
  await page.getByRole("tab", { name: "Character" }).click();

  // Empty state is reachable and explains the feature (no snapshots yet).
  await openRestoreDialog(page);
  await expect(page.locator("#restoreCharacterEmpty")).toBeVisible();
  await expect(page.locator("#restoreCharacterEmpty")).toContainText("No snapshots yet.");
  // Focus is inside the dialog.
  const focusInside = await page.evaluate(() =>
    !!document.activeElement?.closest?.("#restoreCharacterPanel"));
  expect(focusInside).toBe(true);
  // Escape closes before any restore has committed.
  await page.keyboard.press("Escape");
  await expect(page.locator("#restoreCharacterPanel")).toBeHidden();

  // Keyboard opening: ArrowDown opens the action menu.
  await page.locator("#charActionMenuBtn").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#charActionDropdownMenu")).toBeVisible();
  await page.keyboard.press("Escape");

  await expectNoFatalSignals(page, fatalSignals);
});

test("Restore Character dialog fits phone width without horizontal overflow", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Restore Mobile Smoke" });
  await page.setViewportSize({ width: 380, height: 800 });
  await page.getByRole("tab", { name: "Character" }).click();

  await createFighterOne(page);
  await levelUpToFighterTwo(page);
  await openRestoreDialog(page);

  const bodyOverflow = await page.locator("#restoreCharacterBody").evaluate(
    (node) => node.scrollWidth - node.clientWidth
  );
  expect(bodyOverflow).toBeLessThanOrEqual(1);
  const rowOverflow = await page.locator(".restoreCharacterRow").first().evaluate(
    (node) => node.scrollWidth - node.clientWidth
  );
  expect(rowOverflow).toBeLessThanOrEqual(1);
  // The Restore button stays comfortably tappable.
  const box = await page.locator(".restoreCharacterRestoreBtn").first().boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(28);

  await expectNoFatalSignals(page, fatalSignals);
});
