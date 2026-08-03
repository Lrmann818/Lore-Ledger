import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp, submitPromptDialog } from "./helpers/smokeApp.js";

// The max-level spellbook correction in a real browser, at 380 × 820.
//
// The unit suites own the rules. This case covers what only a browser can
// prove: that a genuinely level-20 wizard built through the real creation
// wizard has its Level Up action disabled, that the Character Spells ⋯ menu
// reaches the correction by keyboard alone, that a keyboard-selected spell
// really lands on canonical state and both Spells surfaces, that it survives a
// reload, that focus returns to the menu trigger, and that none of it
// introduces horizontal overflow at phone width.

const CHARACTER_SPELLS = "#spellLevels";
const COMBAT_SPELLS = "#combatEmbeddedSpellLevels";

async function readActiveCharacter(page) {
  return page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const entries = Array.isArray(collection?.entries) ? collection.entries : [];
    const character = entries.find((entry) => entry?.id === collection?.activeId);
    return character ? JSON.parse(JSON.stringify(character)) : null;
  });
}

/** Every spell-row name rendered in one Spells surface. */
async function readRowNames(page, container) {
  return page.locator(`${container} .spellRow input.spellName`)
    .evaluateAll((nodes) => nodes.map((node) => node.value).filter(Boolean));
}

async function pageOverflow(page) {
  return page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function containerOverflow(page, selector) {
  return page.locator(selector).evaluate((node) => node.scrollWidth - node.clientWidth);
}

/**
 * Builds a real Wizard 20 through the creation wizard and deliberately leaves
 * the spellbook empty, acknowledging the shortfall — exactly the stranded state
 * the correction exists for.
 */
async function createUnderfilledWizard20(page, name) {
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

  // Classes step: 19 more wizard levels, taking the character to 20.
  await expect(page.locator("#builderWizardStepClasses")).toBeVisible();
  const addLevel = page.locator(".builderAddLevelBtn");
  for (let i = 0; i < 19; i += 1) await addLevel.click();
  await expect(page.locator(".builderClassesTotal")).toHaveText("Character Level: 20 / 20");
  // At the cap the wizard offers no further level.
  await expect(addLevel).toHaveCount(0);

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

  // Leave the whole 44-spell spellbook allowance unused on purpose.
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();

  // Finishing short is legal but takes one explicit acknowledgement (R5-B2).
  await page.locator("#builderWizardFinish").click();
  const finish = page.locator("#builderWizardFinish");
  if (await finish.isVisible()) {
    await expect(finish).toHaveText("Finish Anyway");
    await finish.click();
  }
  await expect(page.locator("#builderWizardPanel")).toBeHidden();
}

test("a stranded level-20 wizard fills its spellbook from the Spells menu", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Spellbook Smoke" });
  await page.setViewportSize({ width: 380, height: 820 });
  await page.getByRole("tab", { name: "Character" }).click();
  await createUnderfilledWizard20(page, "Stranded Wizard");

  // The stranding precondition: level 20, empty spellbook, Level Up disabled.
  const created = await readActiveCharacter(page);
  expect(created.build.levels).toHaveLength(20);
  expect(created.build.spellcasting.wizard.knownIds).toEqual([]);
  await page.locator("#charActionMenuBtn").click();
  await expect(page.locator("#charActionLevelUpBtn")).toBeDisabled();
  await page.locator("#charActionMenuBtn").click();

  // --- The Character Spells ⋯ menu, by keyboard alone --------------------
  const trigger = page.locator("#spellsOptionsBtn");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  // Arrow navigation lands on the add-level item first, then the correction.
  await expect(page.locator("#addSpellLevelBtn")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#addSpellbookChoicesBtn")).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.locator("#spellbookChoicesOverlay");
  await expect(dialog).toBeVisible();
  const count = page.locator("#spellbookChoicesBody .builderSpellGroupCount");
  await expect(count).toHaveText("0 / 44 in spellbook");
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  expect(await containerOverflow(page, "#spellbookChoicesPanel")).toBeLessThanOrEqual(1);

  // Cancel first: focus must return to the menu trigger, nothing committed.
  await page.locator("#spellbookChoicesCancel").click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect((await readActiveCharacter(page)).build.spellcasting.wizard.knownIds).toEqual([]);

  // --- Reopen and commit one keyboard-selected spell ---------------------
  await page.keyboard.press("ArrowDown");
  await page.locator("#addSpellbookChoicesBtn").click();
  await expect(dialog).toBeVisible();

  const rows = page.locator("#spellbookChoicesBody .builderSpellCheckItem");
  expect(await rows.count()).toBeGreaterThan(10);

  // The dialog's own scoped styling is actually applied — the reused wizard
  // classes are scoped to the two wizard panels, so an unstyled dialog would
  // render the list as inline text with no grid and no pointer affordance.
  await expect(page.locator("#spellbookChoicesBody .builderSpellCheckList"))
    .toHaveCSS("display", "grid");
  await expect(rows.nth(0)).toHaveCSS("display", "flex");
  await expect(rows.nth(0)).toHaveCSS("cursor", "pointer");

  const firstBox = rows.nth(0).locator("input[type=checkbox]");
  const chosenName = (await rows.nth(0).locator("span").innerText()).split(" — ")[0];
  await firstBox.focus();
  await page.keyboard.press("Space");
  await expect(firstBox).toBeChecked();
  await expect(count).toHaveText("1 / 44 in spellbook");

  await page.locator("#spellbookChoicesApply").click();
  await expect(dialog).toBeHidden();

  // Canonical state grew by exactly one, and prepared play-state is untouched.
  const updated = await readActiveCharacter(page);
  expect(updated.build.spellcasting.wizard.knownIds).toHaveLength(1);
  expect(updated.rest.preparedByClass).toEqual(created.rest.preparedByClass);
  expect(updated.underCapAckLevels).toEqual(created.underCapAckLevels);

  // The Character Spells panel shows the new canonical row.
  await expect.poll(() => readRowNames(page, CHARACTER_SPELLS)).toContain(chosenName);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  expect(await containerOverflow(page, "#charSpellsPanel")).toBeLessThanOrEqual(1);

  // --- The Combat embedded Spells panel agrees, and offers no correction --
  await page.getByRole("tab", { name: "Combat" }).click();
  await page.locator('[data-add-embedded-panel="spells"]').click();
  await expect(page.locator(COMBAT_SPELLS)).toBeVisible();
  await expect.poll(() => readRowNames(page, COMBAT_SPELLS)).toContain(chosenName);
  // Combat keeps its own direct "+ Level" button and exposes no ⋯ menu.
  await expect(page.locator("#combatEmbeddedAddSpellLevelBtn")).toBeVisible();
  await expect(page.locator("#combatEmbeddedSpellsSource #spellsOptionsBtn")).toHaveCount(0);
  await expect(page.locator("#combatEmbeddedSpellsSource #addSpellbookChoicesBtn")).toHaveCount(0);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  // --- Reload persistence ------------------------------------------------
  await page.reload();
  await expect(page.locator("main")).toBeVisible();
  const reloaded = await readActiveCharacter(page);
  expect(reloaded.build.spellcasting.wizard.knownIds)
    .toEqual(updated.build.spellcasting.wizard.knownIds);
  await page.getByRole("tab", { name: "Character" }).click();
  await expect.poll(() => readRowNames(page, CHARACTER_SPELLS)).toContain(chosenName);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  await expectNoFatalSignals(page, fatalSignals);
});

test("the disabled cap state is visible and Add spell level restores focus", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Spellbook Style Smoke" });
  await page.setViewportSize({ width: 380, height: 820 });
  await page.getByRole("tab", { name: "Character" }).click();
  await createUnderfilledWizard20(page, "Style Wizard");

  // --- Add spell level: the real prompt, then focus back on the trigger ----
  const trigger = page.locator("#spellsOptionsBtn");
  const levelsBefore = await page.locator(`${CHARACTER_SPELLS} .spellLevel`).count();
  await trigger.click();
  await page.locator("#addSpellLevelBtn").click();
  await submitPromptDialog(page, "Focus Check Level");
  await expect(page.locator(`${CHARACTER_SPELLS} .spellLevel`)).toHaveCount(levelsBefore + 1);
  await expect(trigger).toBeFocused();

  // Cancelling the prompt also returns focus.
  await trigger.click();
  await page.locator("#addSpellLevelBtn").click();
  await page.locator("#uiDialogCancel").click();
  await expect(page.locator(`${CHARACTER_SPELLS} .spellLevel`)).toHaveCount(levelsBefore + 1);
  await expect(trigger).toBeFocused();

  // --- The correction dialog's disabled cap state is genuinely styled ------
  await trigger.click();
  await page.locator("#addSpellbookChoicesBtn").click();
  await expect(page.locator("#spellbookChoicesOverlay")).toBeVisible();

  const rows = page.locator("#spellbookChoicesBody .builderSpellCheckItem");
  // Positive control: no row is muted before the allowance is reached.
  await expect(page.locator("#spellbookChoicesBody .builderSpellCheckItem.isDisabled"))
    .toHaveCount(0);

  // Reaching a 44-spell allowance by keystroke is impractical here (the unit
  // suite drives the cap logic). What only the browser can prove is that the
  // disabled *rule* resolves for this panel at all: the wizard classes this
  // dialog reuses are scoped to #builderWizardPanel/#levelUpPanel, so before
  // the scoped copies were added these declarations reached nothing. Toggle the
  // real class on a real row and read the real cascade.
  const styles = await page.evaluate(() => {
    const row = document.querySelector("#spellbookChoicesBody .builderSpellCheckItem");
    if (!row) return null;
    const before = getComputedStyle(row);
    const enabled = { color: before.color, cursor: before.cursor };
    row.classList.add("isDisabled");
    const after = getComputedStyle(row);
    const disabled = { color: after.color, cursor: after.cursor };
    row.classList.remove("isDisabled");
    return { enabled, disabled };
  });
  expect(styles).not.toBeNull();
  expect(styles.enabled.cursor).toBe("pointer");
  expect(styles.disabled.cursor).toBe("not-allowed");
  expect(styles.disabled.color).not.toBe(styles.enabled.color);

  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  expect(await containerOverflow(page, "#spellbookChoicesPanel")).toBeLessThanOrEqual(1);

  await expectNoFatalSignals(page, fatalSignals);
});
