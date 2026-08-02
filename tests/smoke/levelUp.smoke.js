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

/**
 * Builds a level-1 caster of `classId` through the real wizard and Finishes,
 * skipping every optional spell pick. A prepared caster's empty prepared list
 * triggers the C2-B underfill confirmation, so Finish may need a second press.
 * @param {import("@playwright/test").Page} page
 */
async function createCasterOne(page, { classId, name, abilities }) {
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill(name);
  await page.locator("#builderWizardRace").selectOption("human");
  await page.locator("#builderWizardClass").selectOption(classId);
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepRaceChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClasses")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClassChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  for (const [suffix, value] of Object.entries(abilities)) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await page.locator("#builderWizardFinish").click();
  if (await page.locator("#builderWizardPanel").isVisible()) {
    await page.locator("#builderWizardFinish").click();
  }
  await expect(page.locator("#builderWizardPanel")).toBeHidden();
}

function capacityValue(page, classId) {
  return page.locator(`#levelUpSpellsBody .levelUpPreparedCapacityValue[data-class-id="${classId}"]`);
}

// C2-C in the real bundle. The unit suites own the arithmetic; these two cases
// cover what only a browser can show: that the informational Spells step is
// reachable when the *only* thing the level moves is prepared capacity, that
// the number displayed is the one a Long Rest will enforce (adjustments and
// spellbook included), and that it tracks pending picks live.
test("level up shows the adjustment-aware prepared capacity even when only capacity moves", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Level Up Capacity Smoke" });
  await page.setViewportSize({ width: 380, height: 820 });

  await page.getByRole("tab", { name: "Character" }).click();
  await createCasterOne(page, {
    classId: "cleric",
    name: "Capacity Cleric",
    abilities: { Str: "10", Dex: "12", Con: "12", Int: "10", Wis: "12", Cha: "10" }
  });

  // A stored Ability Adjustment (R5-A) and a real prepared list. Human +1 puts
  // Wis at 13 (+1); the +2 adjustment makes the true modifier +2. State is
  // mutated directly because source modules are not importable from the bundled
  // production build this smoke also runs against.
  await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const entry = collection.entries.find((item) => item?.id === collection.activeId);
    entry.overrides = { ...(entry.overrides || {}), abilities: { wis: 2 } };
    entry.rest = { ...(entry.rest || {}), preparedByClass: { cleric: ["bless"] } };
  });
  const restBefore = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const entry = collection.entries.find((item) => item?.id === collection.activeId);
    return JSON.stringify(entry.rest);
  });

  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionLevelUpBtn").click();
  await expect(page.locator("#levelUpStepClass")).toBeVisible();
  await page.locator("#levelUpNext").click();
  await expect(page.locator("#levelUpStepFeatures")).toBeVisible();
  await page.locator("#levelUpNext").click();

  // Cleric 1 → 2 grants no cantrip, no new spell level, and no domain spell —
  // capacity alone is why this step exists.
  await expect(page.locator("#levelUpStepSpells")).toBeVisible();
  await expect(page.locator("#levelUpSpellsBody")).toContainText("Cleric Spellcasting");
  // Wis 13 + 2 adjustment = 15 (+2): 1 + 2 = 3 → 2 + 2 = 4. Without the
  // adjustment the same character would read 2 → 3.
  await expect(capacityValue(page, "cleric")).toHaveText("3 → 4");
  await expect(page.locator("#levelUpSpellsBody")).toContainText(
    "Prepared spells are chosen when finishing a Long Rest, not here.");
  // No prepared picker is offered here. (R5-B2 does add a cantrip picker for
  // this cleric's unfilled level-1 cantrip allowance — that is a build choice,
  // not a prepared selection, and it is the point of that phase.)
  await expect(page.locator("#levelUpSpellsBody .builderSpellGroupTitle")
    .filter({ hasText: /^Prepared/ })).toHaveCount(0);
  await expect(page.locator("#levelUpSpellsBody .builderSpellGroupTitle")
    .filter({ hasText: /^Cantrips$/ })).toHaveCount(1);

  const bodyOverflow = await page.locator("#levelUpPanel .levelUpBody").evaluate(
    (node) => node.scrollWidth - node.clientWidth
  );
  expect(bodyOverflow).toBeLessThanOrEqual(1);

  // Escape closes cleanly and prepared play-state is untouched.
  await page.keyboard.press("Escape");
  await expect(page.locator("#levelUpPanel")).toBeHidden();
  const afterCancel = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const entry = collection.entries.find((item) => item?.id === collection.activeId);
    return { rest: JSON.stringify(entry.rest), levels: entry.build.levels.length };
  });
  expect(afterCancel.rest).toBe(restBefore);
  expect(afterCancel.levels).toBe(1);
  expect(await readCharacterSnapshots(page)).toHaveLength(0);

  // Applying keeps the prepared list byte-identical.
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionLevelUpBtn").click();
  for (const _ of [0, 1, 2, 3]) {
    if (await page.locator("#levelUpApply").isVisible()) break;
    await page.locator("#levelUpNext").click();
  }
  await expect(page.locator("#levelUpStepSummary")).toBeVisible();
  // R5-B2: this cleric's cantrips were never chosen, so the first Apply is the
  // inline under-cap acknowledgement and commits nothing.
  await page.locator("#levelUpApply").click();
  await expect(page.locator("#levelUpSummaryBody .builderUnderCapConfirmation")).toBeVisible();
  await expect(page.locator("#levelUpApply")).toHaveText("Apply Anyway");
  await page.locator("#levelUpApply").click();
  await expect(page.locator("#levelUpPanel")).toBeHidden();
  const afterApply = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const entry = collection.entries.find((item) => item?.id === collection.activeId);
    return { rest: JSON.stringify(entry.rest), levels: entry.build.levels.length };
  });
  expect(afterApply.levels).toBe(2);
  expect(afterApply.rest).toBe(restBefore);

  await expectNoFatalSignals(page, fatalSignals);
});

test("pending wizard spellbook additions move the resulting prepared capacity live", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Level Up Spellbook Smoke" });
  await page.setViewportSize({ width: 380, height: 820 });

  await page.getByRole("tab", { name: "Character" }).click();
  await createCasterOne(page, {
    classId: "wizard",
    name: "Spellbook Wizard",
    abilities: { Str: "10", Dex: "12", Con: "12", Int: "15", Wis: "10", Cha: "10" }
  });

  // An under-filled spellbook: the formula allows more than the book holds, so
  // the book is the real limit on both sides of the level.
  await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const entry = collection.entries.find((item) => item?.id === collection.activeId);
    entry.build.spellcasting = entry.build.spellcasting || {};
    entry.build.spellcasting.wizard = {
      ...(entry.build.spellcasting.wizard || { cantripIds: [], preparedIds: [] }),
      knownIds: ["magic-missile", "shield"]
    };
  });

  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionLevelUpBtn").click();
  await expect(page.locator("#levelUpStepClass")).toBeVisible();
  await page.locator("#levelUpNext").click();
  // Wizard 2 unlocks the arcane tradition.
  await expect(page.locator("#levelUpStepSubclass")).toBeVisible();
  await page.locator("#levelUpSubclassSelect").selectOption("evocation");
  await page.locator("#levelUpNext").click();
  for (const _ of [0, 1, 2]) {
    if (await page.locator("#levelUpStepSpells").isVisible()) break;
    await page.locator("#levelUpNext").click();
  }
  await expect(page.locator("#levelUpStepSpells")).toBeVisible();

  // Int 16 (+3): the formula reads 4 → 5, but the two-spell book bounds both
  // sides at 2, so no change is claimed until the book actually grows.
  await expect(capacityValue(page, "wizard")).toHaveText("2");

  // Scoped to the spellbook group: R5-B2 also offers this wizard's unfilled
  // level-1 cantrips here, and a cantrip pick must not move prepared capacity.
  const spellbookGroup = page.locator("#levelUpSpellsBody .builderSpellGroup").filter({
    has: page.locator(".builderSpellGroupTitle", { hasText: /^Spellbook additions/ })
  });
  const additions = spellbookGroup.locator(".builderSpellCheckItem input[type=checkbox]");
  expect(await additions.count()).toBeGreaterThan(2);

  // Keyboard operation, not a synthetic click: Space toggles the addition and
  // the capacity value follows it in both directions.
  const first = additions.nth(0);
  await first.focus();
  await page.keyboard.press("Space");
  await expect(first).toBeChecked();
  await expect(capacityValue(page, "wizard")).toHaveText("2 → 3");

  await additions.nth(1).check();
  await expect(capacityValue(page, "wizard")).toHaveText("2 → 4");

  await first.focus();
  await page.keyboard.press("Space");
  await expect(first).not.toBeChecked();
  await expect(capacityValue(page, "wizard")).toHaveText("2 → 3");

  const bodyOverflow = await page.locator("#levelUpPanel .levelUpBody").evaluate(
    (node) => node.scrollWidth - node.clientWidth
  );
  expect(bodyOverflow).toBeLessThanOrEqual(1);

  await page.keyboard.press("Escape");
  await expect(page.locator("#levelUpPanel")).toBeHidden();
  const untouched = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const entry = collection.entries.find((item) => item?.id === collection.activeId);
    return {
      book: entry.build.spellcasting.wizard.knownIds,
      levels: entry.build.levels.length
    };
  });
  expect(untouched.book).toEqual(["magic-missile", "shield"]);
  expect(untouched.levels).toBe(1);

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
