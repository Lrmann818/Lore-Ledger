import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

// Creation Prepared Correctness C2-A and its recoverability correction, in a
// real browser. The unit suites cover the rules; this file covers what only a
// browser can prove: that the prepared controls are actually operable — by
// pointer and by keyboard — that the cap-disabled state is visible rather than
// silently inert, and that a legacy prepared list the shipped pre-C2-A picker
// produced can still be driven to a successful Finish.

/** The Cleric's "Prepared Spells" group (exact title: the wizard's spellbook variant differs). */
function preparedGroup(page) {
  return page.locator("#builderWizardSpellsBody .builderSpellGroup").filter({
    has: page.getByText("Prepared Spells", { exact: true })
  });
}

/** Ordinary candidate rows — remediation rows share the base class. */
function ordinaryRows(page) {
  return preparedGroup(page).locator(".builderSpellCheckItem:not(.builderPreparedFixItem)");
}

function fixRows(page) {
  return preparedGroup(page).locator(".builderPreparedFixItem");
}

/** Opens the prepared group's 1st-level disclosure so its rows are operable. */
async function openPreparedLevel(page) {
  const summary = preparedGroup(page).locator("details > summary").first();
  await expect(summary).toBeVisible();
  if (!(await preparedGroup(page).locator("details").first().evaluate((node) => node.open))) {
    await summary.click();
  }
  await expect(ordinaryRows(page).first()).toBeVisible();
}

/**
 * Builds a level-1 human cleric through the real wizard and stops on the
 * Spells step. WIS 12 => prepared capacity max(1, 1 + 1) = 2, small enough to
 * drive the cap with real interactions.
 * @param {import("@playwright/test").Page} page
 */
async function buildClericToSpellsStep(page, name) {
  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill(name);
  await page.locator("#builderWizardRace").selectOption("human");
  await page.locator("#builderWizardClass").selectOption("cleric");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepRaceChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClasses")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClassChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  for (const [suffix, value] of Object.entries({ Str: "10", Dex: "10", Con: "12", Int: "10", Wis: "12", Cha: "10" })) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
}

async function finishWizard(page) {
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await page.locator("#builderWizardFinish").click();
}

test("creation prepared picker enforces its cap visibly and is fully keyboard-operable", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Prepared Creation Smoke" });
  await buildClericToSpellsStep(page, "Cap Cleric");
  await openPreparedLevel(page);

  const count = preparedGroup(page).locator(".builderSpellGroupCount");
  await expect(count).toHaveText("0 / 2 prepared");
  // Positive control: a real candidate list rendered.
  expect(await ordinaryRows(page).count()).toBeGreaterThan(3);
  await expect(preparedGroup(page).locator(".builderSpellCheckItem.isDisabled")).toHaveCount(0);

  // Space toggles an enabled checkbox — the keyboard path, not a synthetic click.
  const firstBox = ordinaryRows(page).nth(0).locator("input[type=checkbox]");
  await firstBox.focus();
  await page.keyboard.press("Space");
  await expect(firstBox).toBeChecked();
  await expect(count).toHaveText("1 / 2 prepared");

  // Reach the cap with the second pick.
  await ordinaryRows(page).nth(1).locator("input[type=checkbox]").check();
  await expect(count).toHaveText("2 / 2 prepared");

  // At the cap the unchosen rows are disabled *and* visibly so.
  const blocked = ordinaryRows(page).nth(2);
  await expect(blocked.locator("input[type=checkbox]")).toBeDisabled();
  await expect(blocked).toHaveClass(/isDisabled/);
  await expect(blocked).toHaveCSS("cursor", "not-allowed");
  // The chosen rows stay enabled and are not muted.
  await expect(ordinaryRows(page).nth(0).locator("input[type=checkbox]")).toBeEnabled();
  await expect(ordinaryRows(page).nth(0)).not.toHaveClass(/isDisabled/);

  // Keyboard removal of a checked entry while at capacity.
  const secondBox = ordinaryRows(page).nth(1).locator("input[type=checkbox]");
  await secondBox.focus();
  await page.keyboard.press("Space");
  await expect(secondBox).not.toBeChecked();
  await expect(count).toHaveText("1 / 2 prepared");
  // Deselection re-enables the alternatives.
  await expect(blocked.locator("input[type=checkbox]")).toBeEnabled();
  await expect(blocked).not.toHaveClass(/isDisabled/);

  await finishWizard(page);
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  const adopted = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const entry = collection.entries.find((item) => item?.id === collection.activeId);
    return {
      prepared: entry.rest?.preparedByClass?.cleric ?? null,
      build: entry.build?.spellcasting?.cleric?.preparedIds ?? null
    };
  });
  expect(adopted.prepared).toHaveLength(1);
  expect(adopted.prepared).toEqual(adopted.build);

  // Reload persistence.
  await page.reload();
  await expect(page.locator("main")).toBeVisible();
  const afterReload = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const entry = collection.entries.find((item) => item?.name === "Cap Cleric");
    return entry?.rest?.preparedByClass?.cleric ?? null;
  });
  expect(afterReload).toEqual(adopted.prepared);

  await expectNoFatalSignals(page, fatalSignals);
});

test("a legacy prepared list stays visible, removable, and cancellable in Edit in Builder", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Prepared Legacy Smoke" });
  await buildClericToSpellsStep(page, "Legacy Cleric");
  await finishWizard(page);
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  // Reshape the saved build into what the shipped pre-C2-A picker produced: a
  // Life Domain cleric whose ordinary prepared list holds a granted domain
  // spell. State is mutated directly because source modules are not importable
  // from the bundled production build this smoke also runs against.
  await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const entry = collection.entries.find((item) => item?.id === collection.activeId);
    entry.build.subclassByClass = { cleric: "life" };
    entry.build.spellcasting.cleric.preparedIds = ["bless", "bane"];
    entry.rest.preparedByClass = { cleric: ["bless", "bane"] };
  });
  const savedBefore = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    return JSON.stringify(collection.entries.find((item) => item?.id === collection.activeId));
  });

  const openEditor = async () => {
    await page.locator("#charActionMenuBtn").click();
    await page.locator("#charActionEditBuilderBtn").click();
    await expect(page.locator("#builderWizardPanel")).toBeVisible();
    for (let i = 0; i < 5; i += 1) {
      if (await page.locator("#builderWizardStepSpells").isVisible()) break;
      await page.locator("#builderWizardNext").click();
    }
    await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  };

  await openEditor();

  // The grant is read-only context and is absent from the ordinary candidates.
  await expect(page.locator(".builderGrantedSpells")).toContainText("Bless");
  await openPreparedLevel(page);
  await expect(ordinaryRows(page).filter({ hasText: "Bless" })).toHaveCount(0);
  await expect(ordinaryRows(page).filter({ hasText: "Bane" })).toHaveCount(1);

  // The redundant raw id is surfaced as its own removable remediation row.
  await expect(fixRows(page)).toHaveCount(1);
  await expect(fixRows(page).first()).toContainText("Bless");
  await expect(fixRows(page).first()).toContainText("already always prepared");
  const fixBox = fixRows(page).first().locator("input[type=checkbox]");
  await expect(fixBox).toBeChecked();
  await expect(fixBox).toBeEnabled();

  // Finish is blocked while it remains, and the wizard returns to this step.
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  await expect(page.locator(".builderSpellsValidation")).toContainText("always prepared");

  // Removing it by keyboard, then cancelling, must leave storage untouched.
  await openPreparedLevel(page);
  await fixRows(page).first().locator("input[type=checkbox]").focus();
  await page.keyboard.press("Space");
  await expect(fixRows(page)).toHaveCount(0);
  await page.locator("#builderWizardCancel").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();
  const savedAfterCancel = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    return JSON.stringify(collection.entries.find((item) => item?.id === collection.activeId));
  });
  expect(savedAfterCancel).toBe(savedBefore);

  // Reopen, remove it again, and Finish for real this time.
  await openEditor();
  await openPreparedLevel(page);
  await expect(fixRows(page)).toHaveCount(1); // positive control: cancel really preserved it
  // click(), not uncheck(): removing the row detaches it, so uncheck()'s
  // post-condition read has nothing left to verify against.
  await fixRows(page).first().locator("input[type=checkbox]").click();
  await expect(fixRows(page)).toHaveCount(0);

  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  const finalBuild = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const entry = collection.entries.find((item) => item?.id === collection.activeId);
    return {
      prepared: entry.build.spellcasting.cleric.preparedIds,
      granted: entry.spells.levels
        .flatMap((level) => level.spells)
        .filter((spell) => spell.builderGranted === true)
        .map((spell) => spell.builderSpellId)
    };
  });
  expect(finalBuild.prepared).toEqual(["bane"]);
  // Granted access still flows from the build, not from the prepared list.
  expect(finalBuild.granted).toContain("bless");

  await expectNoFatalSignals(page, fatalSignals);
});
