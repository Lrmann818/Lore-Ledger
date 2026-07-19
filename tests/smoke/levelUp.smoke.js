import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

// Level Up happy path: create a Fighter 1 through the builder wizard, run the
// Level Up flow to Fighter 2 (Class → Features → Hit Points → Summary),
// Apply, and verify exactly one level was appended, max/current HP grew by
// the level's delta, Action Surge was seeded into Features, and everything
// survives a reload. Also checks the panel at a phone-width viewport.

async function readActiveCharacter(page) {
  return page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const entries = Array.isArray(collection?.entries) ? collection.entries : [];
    const character = entries.find((entry) => entry?.id === collection?.activeId);
    return character ? JSON.parse(JSON.stringify(character)) : null;
  });
}

async function readCharacterSnapshots(page) {
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

test("level up takes a Fighter 1 to Fighter 2 with more HP and Action Surge", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Level Up Smoke" });

  await page.getByRole("tab", { name: "Character" }).click();
  await createFighterOne(page);

  const created = await readActiveCharacter(page);
  expect(created.build.levels).toEqual([{ classId: "fighter", hp: null }]);
  // Half-orc fighter, Con 14 (+2): level 1 max HP is 10 + 2 = 12.
  const hpBefore = created.hpMax;
  expect(hpBefore).toBe(12);

  // Cancel path first: opening and cancelling must change nothing.
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionLevelUpBtn").click();
  await expect(page.locator("#levelUpPanel")).toBeVisible();
  await expect(page.locator("#levelUpTitle")).toHaveText("Level Up — Level 1 → 2");
  await page.locator("#levelUpCancel").click();
  await expect(page.locator("#levelUpPanel")).toBeHidden();
  const afterCancel = await readActiveCharacter(page);
  expect(afterCancel.build.levels).toHaveLength(1);
  expect(afterCancel.hpMax).toBe(hpBefore);
  // R1: opening and canceling Level Up never captures a snapshot.
  expect(await readCharacterSnapshots(page)).toHaveLength(0);

  // The real Level Up: continue as Fighter (default), review the gained
  // Action Surge feature, keep the SRD-average HP, and Apply.
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionLevelUpBtn").click();
  await expect(page.locator("#levelUpStepClass")).toBeVisible();
  await expect(page.locator("#levelUpClassBody")).toContainText("Continue as Fighter");
  await page.locator("#levelUpNext").click();

  await expect(page.locator("#levelUpStepFeatures")).toBeVisible();
  await expect(page.locator("#levelUpFeaturesBody")).toContainText("Action Surge");
  await page.locator("#levelUpNext").click();

  await expect(page.locator("#levelUpStepHp")).toBeVisible();
  await expect(page.locator("#levelUpHpBody")).toContainText("d10");
  // Average is the default: 6 + 2 (Con) = +8 HP.
  await expect(page.locator("#levelUpHpBody")).toContainText("+8 HP");
  await page.locator("#levelUpNext").click();

  await expect(page.locator("#levelUpStepSummary")).toBeVisible();
  await expect(page.locator("#levelUpSummaryBody")).toContainText("1 → 2");
  await expect(page.locator("#levelUpSummaryBody")).toContainText("12 → 20");
  await expect(page.locator("#levelUpSummaryBody")).toContainText("Action Surge");
  // Phase 2: the summary announces the newly unlocked resource pool.
  await expect(page.locator("#levelUpSummaryBody")).toContainText("new (1)");
  await page.locator("#levelUpApply").click();
  await expect(page.locator("#levelUpPanel")).toBeHidden();

  const leveled = await readActiveCharacter(page);
  expect(leveled.id).toBe(created.id);
  expect(leveled.build.levels).toEqual([
    { classId: "fighter", hp: null },
    { classId: "fighter", hp: null }
  ]);
  expect(leveled.hpMax).toBe(20);
  expect(leveled.hpCur).toBe(20);

  // R1: the successful apply captured exactly one complete pre-Level-Up
  // snapshot in the same commit — the character as it was at Fighter 1.
  const snapshots = await readCharacterSnapshots(page);
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({
    kind: "pre-level-up",
    sourceCharacterId: created.id,
    sourceName: "Smoke Leveler",
    classSummary: "Fighter 1",
    fromLevel: 1,
    toLevel: 2,
    toClassId: "fighter"
  });
  expect(snapshots[0].id).toMatch(/^csnap_/);
  expect(snapshots[0].payload.hpMax).toBe(12);
  expect(snapshots[0].payload.build.levels).toHaveLength(1);
  // Phase 2: Second Wind seeded at creation, Action Surge added by Level Up,
  // both as canonical resources with recovery metadata and stable markers.
  const secondWind = leveled.resources.find((resource) => resource.builderSeed === "class-resource:second-wind");
  expect(secondWind).toMatchObject({ name: "Second Wind", cur: 1, max: 1, recovery: "shortOrLongRest" });
  const actionSurge = leveled.resources.find((resource) => resource.builderSeed === "class-resource:action-surge");
  expect(actionSurge).toMatchObject({ name: "Action Surge", cur: 1, max: 1, recovery: "shortOrLongRest" });

  // The sheet shows Fighter 2, the seeded Action Surge feature text, and the
  // Vitals resource tiles for both pools.
  await expect(page.locator("#charClassLevel")).toHaveValue(/Fighter 2/);
  await expect(page.locator("#charFeatures")).toHaveValue(/Action Surge/);
  await expect(page.locator(".resourceTile .resourceTitle", { hasText: "Second Wind" })).toBeVisible();
  await expect(page.locator(".resourceTile .resourceTitle", { hasText: "Action Surge" })).toBeVisible();

  // Level 20 disable state is unit-tested; here we confirm the action stays
  // available for the level-2 character.
  await page.locator("#charActionMenuBtn").click();
  await expect(page.locator("#charActionLevelUpBtn")).toBeEnabled();
  await page.keyboard.press("Escape");

  // Persistence round trip.
  await page.waitForTimeout(1500);
  await page.reload();
  await page.getByRole("tab", { name: "Character" }).click();
  const restored = await readActiveCharacter(page);
  expect(restored.build.levels).toHaveLength(2);
  expect(restored.hpMax).toBe(20);
  await expect(page.locator("#charFeatures")).toHaveValue(/Action Surge/);
  // R1: the snapshot persisted through the campaign vault and the reload.
  const restoredSnapshots = await readCharacterSnapshots(page);
  expect(restoredSnapshots).toHaveLength(1);
  expect(restoredSnapshots[0]).toMatchObject({
    sourceCharacterId: created.id,
    fromLevel: 1,
    toLevel: 2
  });

  await expectNoFatalSignals(page, fatalSignals);
});

test("level up panel stays usable at phone width", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Level Up Mobile Smoke" });
  await page.setViewportSize({ width: 380, height: 800 });

  await page.getByRole("tab", { name: "Character" }).click();
  await createFighterOne(page);

  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionLevelUpBtn").click();
  await expect(page.locator("#levelUpPanel")).toBeVisible();

  // No horizontal overflow in the panel body at phone width.
  const bodyOverflow = await page.locator("#levelUpPanel .levelUpBody").evaluate(
    (node) => node.scrollWidth - node.clientWidth
  );
  expect(bodyOverflow).toBeLessThanOrEqual(1);

  // The HP step's Max / Average / Roll row is the likeliest to wrap badly.
  await page.locator("#levelUpNext").click(); // class → features
  await page.locator("#levelUpNext").click(); // features → hp
  await expect(page.locator("#levelUpStepHp")).toBeVisible();
  const hpOverflow = await page.locator("#levelUpHpBody").evaluate(
    (node) => node.scrollWidth - node.clientWidth
  );
  expect(hpOverflow).toBeLessThanOrEqual(1);
  const modeButtons = page.locator("#levelUpHpBody .levelUpHpModeBtn");
  await expect(modeButtons).toHaveCount(3);
  const maxButton = modeButtons.first();
  const box = await maxButton.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(40); // tap target stays usable

  // Roll mode uses the injected die seam in app code; in the real app it
  // must produce a valid in-range result and update the math line.
  await modeButtons.nth(2).click();
  await expect(page.locator("#levelUpHpBody")).toContainText(/rolled \d+/);

  // Escape closes cleanly without mutating.
  await page.keyboard.press("Escape");
  await expect(page.locator("#levelUpPanel")).toBeHidden();
  const character = await readActiveCharacter(page);
  expect(character.build.levels).toHaveLength(1);

  await expectNoFatalSignals(page, fatalSignals);
});
