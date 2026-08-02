import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

// R5-B2 in a real browser, at 380 × 820.
//
// The unit suites own the rules. These two cases cover what only a browser can
// prove: that the new caps are actually operable and visibly disabled rather
// than silently inert, that the acknowledgement is reachable and focusable by
// keyboard alone, that the Level Up Spells step really offers an earlier
// shortfall, that the persisted record survives a reload, and that none of it
// introduces horizontal overflow at phone width.

const CANTRIP_GROUP = "Cantrips";

function group(page, container, title) {
  return page.locator(`${container} .builderSpellGroup`).filter({
    has: page.locator(".builderSpellGroupTitle", { hasText: new RegExp(`^${title}$`) })
  });
}

function rowsOf(groupLocator) {
  return groupLocator.locator(".builderSpellCheckItem");
}

async function readActiveCharacter(page) {
  return page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const entries = Array.isArray(collection?.entries) ? collection.entries : [];
    const character = entries.find((entry) => entry?.id === collection?.activeId);
    return character ? JSON.parse(JSON.stringify(character)) : null;
  });
}

/** The page's own horizontal overflow (the repo's phone-width convention). */
async function pageOverflow(page) {
  return page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** One container's horizontal overflow, e.g. an open wizard body. */
async function containerOverflow(page, selector) {
  return page.locator(selector).evaluate((node) => node.scrollWidth - node.clientWidth);
}

/** Walks the real creation wizard to the Spells step for a Human Wizard 1. */
async function wizardToSpellsStep(page, name) {
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill(name);
  await page.locator("#builderWizardRace").selectOption("human");
  await page.locator("#builderWizardClass").selectOption("wizard");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepRaceChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClasses")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClassChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  for (const [suffix, value] of Object.entries({
    Str: "10", Dex: "14", Con: "13", Int: "15", Wis: "12", Cha: "8"
  })) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
}

test("creation caps the spell pickers and takes one keyboard acknowledgement", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Under Cap Smoke" });
  await page.setViewportSize({ width: 380, height: 820 });
  await page.getByRole("tab", { name: "Character" }).click();
  await wizardToSpellsStep(page, "Cap Wizard");

  const cantrips = group(page, "#builderWizardSpellsBody", CANTRIP_GROUP);
  const count = cantrips.locator(".builderSpellGroupCount");
  await expect(count).toHaveText("0 / 3 known");
  // Positive control: a real candidate list longer than the allowance.
  expect(await rowsOf(cantrips).count()).toBeGreaterThan(4);
  await expect(cantrips.locator(".builderSpellCheckItem.isDisabled")).toHaveCount(0);

  // Space toggles — the keyboard path, not a synthetic click.
  for (let i = 0; i < 3; i += 1) {
    const box = rowsOf(cantrips).nth(i).locator("input[type=checkbox]");
    await box.focus();
    await page.keyboard.press("Space");
    await expect(box).toBeChecked();
  }
  await expect(count).toHaveText("3 / 3 known");

  // At the cap the unchosen rows are disabled *and* visibly so.
  const blocked = rowsOf(cantrips).nth(3);
  await expect(blocked.locator("input[type=checkbox]")).toBeDisabled();
  await expect(blocked).toHaveClass(/isDisabled/);
  await expect(blocked).toHaveCSS("cursor", "not-allowed");
  // A chosen row stays enabled and removable by keyboard.
  const chosen = rowsOf(cantrips).nth(2).locator("input[type=checkbox]");
  await chosen.focus();
  await page.keyboard.press("Space");
  await expect(chosen).not.toBeChecked();
  await expect(count).toHaveText("2 / 3 known");
  await expect(blocked.locator("input[type=checkbox]")).toBeEnabled();

  // The spellbook now shows its allowance too, and is left empty on purpose.
  const spellbook = group(page, "#builderWizardSpellsBody", "Spellbook");
  await expect(spellbook.locator(".builderSpellGroupCount"))
    .toHaveText("0 / 6 in spellbook (start with 6, +2 per wizard level)");

  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await expect(page.locator(".builderUnderCapChoices"))
    .toContainText("Wizard cantrips: 2 of 3 chosen");
  await expect(page.locator(".builderUnderCapChoices")).toContainText("allowed");

  // The review affordance is keyboard-operable and lands focus in the step.
  const review = page.getByRole("button", { name: "Review spell choices" });
  await review.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  const focusedInStep = await page.evaluate(() =>
    !!document.activeElement?.closest("#builderWizardSpellsBody"));
  expect(focusedInStep).toBe(true);

  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();

  // First Finish is the acknowledgement; focus moves to the inline alert.
  await page.locator("#builderWizardFinish").click();
  const alert = page.locator(".builderUnderCapConfirmation");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toContainText("this is allowed");
  await expect(alert).toBeFocused();
  await expect(page.locator("#builderWizardFinish")).toHaveText("Finish Anyway");
  await expect(page.locator("#builderWizardPanel")).toBeVisible();

  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  expect(await containerOverflow(page, "#builderWizardPanel")).toBeLessThanOrEqual(1);

  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  const created = await readActiveCharacter(page);
  expect(created.name).toBe("Cap Wizard");
  expect(created.build.spellcasting.wizard.cantripIds).toHaveLength(2);
  expect(created.underCapAckLevels).toEqual([1]);

  await page.reload();
  await expect(page.locator("main")).toBeVisible();
  const afterReload = await readActiveCharacter(page);
  expect(afterReload.underCapAckLevels).toEqual([1]);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await expectNoFatalSignals(page, fatalSignals);
});

test("level up offers the earlier shortfall and records the resulting level", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Under Cap Level Up Smoke" });
  await page.setViewportSize({ width: 380, height: 820 });
  await page.getByRole("tab", { name: "Character" }).click();
  await wizardToSpellsStep(page, "Backfill Wizard");

  // One cantrip of three, nothing in the spellbook: a deliberate shortfall the
  // next Level Up must give the player a chance to fill.
  await rowsOf(group(page, "#builderWizardSpellsBody", CANTRIP_GROUP)).nth(0)
    .locator("input[type=checkbox]").check();
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await page.locator("#builderWizardFinish").click();
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();
  expect((await readActiveCharacter(page)).underCapAckLevels).toEqual([1]);

  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionLevelUpBtn").click();
  await expect(page.locator("#levelUpStepClass")).toBeVisible();
  await page.locator("#levelUpNext").click();
  // Wizard picks its arcane tradition at level 2.
  await expect(page.locator("#levelUpStepSubclass")).toBeVisible();
  await page.locator("#levelUpSubclassBody select").selectOption("evocation");
  for (let i = 0; i < 4 && !(await page.locator("#levelUpStepSpells").isVisible()); i += 1) {
    await page.locator("#levelUpNext").click();
  }

  // The Spells step offers both the two spellbook spells this level adds and
  // the six never taken at level 1, plus the unfilled cantrip.
  await expect(page.locator("#levelUpStepSpells")).toBeVisible();
  const spellbook = group(page, "#levelUpSpellsBody", "Spellbook additions \\(2\\)");
  await expect(spellbook.locator(".builderSpellGroupCount")).toHaveText("0 / 8 chosen");
  await expect(spellbook).toContainText("6 choices are still unused from earlier levels");
  await expect(spellbook).toContainText("Choosing fewer than the maximum is allowed");
  const cantrips = group(page, "#levelUpSpellsBody", CANTRIP_GROUP);
  await expect(cantrips.locator(".builderSpellGroupCount")).toHaveText("1 / 3 chosen");

  // Fill one of the earlier gaps by keyboard, then leave the rest short.
  const box = rowsOf(cantrips).nth(0).locator("input[type=checkbox]");
  await box.focus();
  await page.keyboard.press("Space");
  await expect(cantrips.locator(".builderSpellGroupCount")).toHaveText("2 / 3 chosen");

  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  expect(await containerOverflow(page, "#levelUpPanel")).toBeLessThanOrEqual(1);

  for (let i = 0; i < 4 && !(await page.locator("#levelUpStepSummary").isVisible()); i += 1) {
    await page.locator("#levelUpNext").click();
  }
  await expect(page.locator("#levelUpStepSummary")).toBeVisible();
  await expect(page.locator("#levelUpSummaryBody"))
    .toContainText("Fewer than the maximum chosen at level 2");

  await page.locator("#levelUpApply").click();
  // Scoped to the Level Up panel: the closed creation wizard keeps its own
  // (hidden) Summary markup until it is next opened.
  const alert = page.locator("#levelUpSummaryBody .builderUnderCapConfirmation");
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  await expect(page.locator("#levelUpApply")).toHaveText("Apply Anyway");
  await expect(page.locator("#levelUpPanel")).toBeVisible();

  await page.locator("#levelUpApply").click();
  await expect(page.locator("#levelUpPanel")).toBeHidden();

  const leveled = await readActiveCharacter(page);
  expect(leveled.build.levels).toHaveLength(2);
  expect(leveled.build.spellcasting.wizard.cantripIds).toHaveLength(2);
  expect(leveled.underCapAckLevels).toEqual([1, 2]);

  await page.reload();
  await expect(page.locator("main")).toBeVisible();
  expect((await readActiveCharacter(page)).underCapAckLevels).toEqual([1, 2]);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await expectNoFatalSignals(page, fatalSignals);
});
