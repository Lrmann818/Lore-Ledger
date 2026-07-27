import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

// R5-B1 end-to-end: create a builder character that skips required choices,
// prove the contextual banner appears above the character columns, resolve the
// choices through the real Complete Choices dialog, and prove the banner
// disappears and the seeded content survives a reload.
//
// The load-bearing negative is that permitted under-cap spell selections (this
// wizard's cantrips and spellbook) never raise the banner and never appear in
// the dialog — that system is R5-B2.

const BANNER = "#charIncompleteChoices";
const BANNER_BTN = "#charIncompleteChoicesBtn";
const PANEL = "#completeChoicesPanel";
const BODY = "#completeChoicesBody";

async function readActiveCharacter(page) {
  return page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const entries = Array.isArray(collection?.entries) ? collection.entries : [];
    const character = entries.find((entry) => entry?.id === collection?.activeId);
    return character ? JSON.parse(JSON.stringify(character)) : null;
  });
}

/**
 * Creates a Human Acolyte Wizard 1 through the real wizard, skipping every
 * optional-at-creation choice: two Acolyte languages, one Human language, the
 * Wizard skill pair, plus the (permitted) cantrip and spellbook allowances.
 */
async function createIncompleteWizard(page, name) {
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill(name);
  await page.locator("#builderWizardRace").selectOption("human");
  await page.locator("#builderWizardClass").selectOption("wizard");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click();

  // Origin choices (languages) — deliberately skipped.
  await expect(page.locator("#builderWizardStepRaceChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClasses")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  // Class choices (skills) — deliberately skipped.
  await expect(page.locator("#builderWizardStepClassChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();

  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  const abilities = { Str: "10", Dex: "14", Con: "13", Int: "15", Wis: "12", Cha: "8" };
  for (const [suffix, value] of Object.entries(abilities)) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click();

  // Spells — cantrips and spellbook deliberately left under their maxima.
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator("#builderWizardNext").click();

  // The Summary keeps required work and permitted under-cap counts apart.
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await expect(page.locator(".builderIncompleteChoices")).toContainText("Required choices not finished");
  await expect(page.locator(".builderIncompleteChoices")).toContainText("Acolyte languages: 0 of 2 chosen");
  await expect(page.locator(".builderUnderCapChoices")).toContainText("Wizard cantrips: 0 of 3 chosen");
  await expect(page.locator(".builderUnderCapChoices")).toContainText("allowed");
  await expect(page.locator(".builderIncompleteChoices")).not.toContainText("cantrips");

  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();
}

test("incomplete required choices raise a banner that Complete Choices clears", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Complete Choices Smoke" });
  await page.getByRole("tab", { name: "Character" }).click();
  await createIncompleteWizard(page, "Unfinished Wizard");

  // 1. The banner is visible and sits above the character columns, outside
  //    every panel.
  const banner = page.locator(BANNER);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Character setup is incomplete");
  const placement = await page.evaluate(() => {
    const el = document.querySelector("#charIncompleteChoices");
    const columns = document.querySelector("#charColumns");
    return {
      beforeColumns: !!(el.compareDocumentPosition(columns) & Node.DOCUMENT_POSITION_FOLLOWING),
      insidePanel: !!el.closest(".panel"),
      insideColumns: !!el.closest("#charColumns"),
      parentId: el.parentElement?.id || ""
    };
  });
  expect(placement.beforeColumns).toBe(true);
  expect(placement.insidePanel).toBe(false);
  expect(placement.insideColumns).toBe(false);
  expect(placement.parentId).toBe("page-character");

  // 2. Under-cap spell allowances are NOT what raised it.
  await expect(banner).not.toContainText("cantrip");
  await expect(banner).not.toContainText("spellbook");

  // 3 + 4. The dialog opens from the banner and lists only required work.
  await page.locator(BANNER_BTN).click();
  await expect(page.locator(PANEL)).toBeVisible();
  const dialogBody = page.locator(BODY);
  await expect(dialogBody).toContainText("Human language");
  await expect(dialogBody).toContainText("Acolyte languages");
  await expect(dialogBody).toContainText("Wizard skills");
  await expect(dialogBody).not.toContainText("cantrip");
  await expect(dialogBody).not.toContainText("spellbook");
  await expect(dialogBody).not.toContainText("prepared");

  // 5. Resolve everything through the real controls.
  const humanItem = dialogBody.locator('[data-choice-key="choice:human-language"] select');
  await humanItem.selectOption("dwarvish");
  const acolyteSelects = dialogBody.locator('[data-choice-key="choice:acolyte-language"] select');
  await expect(acolyteSelects).toHaveCount(2);
  await acolyteSelects.nth(0).selectOption("elvish");
  await acolyteSelects.nth(1).selectOption("giant");
  const skillSelects = dialogBody.locator('[data-choice-key="choice:class-skill-wizard"] select');
  await expect(skillSelects).toHaveCount(2);
  await skillSelects.nth(0).selectOption("arcana");
  await skillSelects.nth(1).selectOption("history");

  await page.locator("#completeChoicesApply").click();
  await expect(page.locator(PANEL)).toBeHidden();

  // 6. Newly seeded language content appears exactly once.
  const seededLanguages = await page.locator("#charLanguages").inputValue();
  expect(seededLanguages).toContain("Dwarvish");
  expect(seededLanguages).toContain("Elvish");
  expect(seededLanguages).toContain("Giant");
  expect(seededLanguages.split("Dwarvish").length - 1).toBe(1);

  // The choices really landed in canonical build data.
  const saved = await readActiveCharacter(page);
  const flat = Object.assign({}, ...Object.values(saved.build.choicesByLevel || {}));
  expect(flat["human-language"]).toBe("dwarvish");
  expect(flat["acolyte-language"]).toEqual(["elvish", "giant"]);
  expect(flat["class-skill-wizard"]).toEqual(["arcana", "history"]);
  // The under-cap spell allowances are untouched and still under their maxima.
  expect(saved.build.spellcasting?.wizard?.cantripIds ?? []).toEqual([]);

  // 7. The banner is gone immediately.
  await expect(page.locator(BANNER)).toBeHidden();

  // 8. Reload preserves both the completed choices and the banner's absence.
  await page.reload();
  await page.getByRole("tab", { name: "Character" }).click();
  await expect(page.locator(BANNER)).toBeHidden();
  const reloaded = await readActiveCharacter(page);
  const reloadedFlat = Object.assign({}, ...Object.values(reloaded.build.choicesByLevel || {}));
  expect(reloadedFlat["acolyte-language"]).toEqual(["elvish", "giant"]);
  expect(await page.locator("#charLanguages").inputValue()).toContain("Elvish");

  await expectNoFatalSignals(page, fatalSignals);
});

test("freeform and completed builder characters never show the banner", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Banner Exclusions Smoke" });
  await page.getByRole("tab", { name: "Character" }).click();

  // An incomplete builder character establishes that the banner CAN appear in
  // this campaign — without it the two negatives below would be vacuous.
  await createIncompleteWizard(page, "Still Unfinished");
  await expect(page.locator(BANNER)).toBeVisible();

  // A freeform character: no build at all.
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBtn").click();
  await expect(page.locator(BANNER)).toBeHidden();

  // Switching back to the incomplete builder character brings it back.
  await page.locator("#charSelector").selectOption({ label: "Still Unfinished" });
  await expect(page.locator(BANNER)).toBeVisible();

  // Completing the character hides it for good.
  await page.locator(BANNER_BTN).click();
  await expect(page.locator(PANEL)).toBeVisible();
  await page.locator('[data-choice-key="choice:human-language"] select').selectOption("dwarvish");
  const acolyte = page.locator('[data-choice-key="choice:acolyte-language"] select');
  await acolyte.nth(0).selectOption("elvish");
  await acolyte.nth(1).selectOption("giant");
  const skills = page.locator('[data-choice-key="choice:class-skill-wizard"] select');
  await skills.nth(0).selectOption("arcana");
  await skills.nth(1).selectOption("history");
  await page.locator("#completeChoicesApply").click();
  await expect(page.locator(PANEL)).toBeHidden();
  await expect(page.locator(BANNER)).toBeHidden();

  await expectNoFatalSignals(page, fatalSignals);
});

test("Complete Choices is keyboard operable and restores focus on Escape", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Complete Choices Keyboard" });
  await page.getByRole("tab", { name: "Character" }).click();
  await createIncompleteWizard(page, "Keyboard Wizard");

  // Open from the keyboard.
  await page.locator(BANNER_BTN).focus();
  await expect(page.locator(BANNER_BTN)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(PANEL)).toBeVisible();

  // Focus lands inside the dialog on the first unresolved control.
  const focusedInsidePanel = await page.evaluate(() =>
    !!document.activeElement?.closest("#completeChoicesPanel"));
  expect(focusedInsidePanel).toBe(true);

  // Tab stays trapped inside the panel.
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    const stillInside = await page.evaluate(() =>
      !!document.activeElement?.closest("#completeChoicesPanel"));
    expect(stillInside).toBe(true);
  }

  // Escape closes and returns focus to the invoking banner button.
  await page.keyboard.press("Escape");
  await expect(page.locator(PANEL)).toBeHidden();
  await expect(page.locator(BANNER_BTN)).toBeFocused();
  // Escaping is a cancel: nothing was written.
  const untouched = await readActiveCharacter(page);
  expect(Object.assign({}, ...Object.values(untouched.build.choicesByLevel || {}))["human-language"])
    .toBeUndefined();
  await expect(page.locator(BANNER)).toBeVisible();

  await expectNoFatalSignals(page, fatalSignals);
});

test("banner and dialog stay usable at 380px with no horizontal overflow", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Complete Choices Narrow" });
  await page.setViewportSize({ width: 380, height: 800 });
  await page.getByRole("tab", { name: "Character" }).click();
  await createIncompleteWizard(page, "Narrow Wizard");

  await expect(page.locator(BANNER)).toBeVisible();
  const pageOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);

  // The banner's action is reachable and comfortably tappable.
  const btnBox = await page.locator(BANNER_BTN).boundingBox();
  expect(btnBox).not.toBeNull();
  expect(btnBox.height).toBeGreaterThanOrEqual(24);
  expect(btnBox.width).toBeGreaterThan(80);

  await page.locator(BANNER_BTN).click();
  await expect(page.locator(PANEL)).toBeVisible();

  // Dialog content scrolls internally rather than overflowing sideways.
  const scrollOverflow = await page.locator(".completeChoicesScroll").evaluate(
    (node) => node.scrollWidth - node.clientWidth
  );
  expect(scrollOverflow).toBeLessThanOrEqual(1);
  const narrowPageOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(narrowPageOverflow).toBeLessThanOrEqual(1);

  // Footer controls are not clipped out of the panel.
  const panelBox = await page.locator(PANEL).boundingBox();
  const applyBox = await page.locator("#completeChoicesApply").boundingBox();
  expect(applyBox).not.toBeNull();
  expect(applyBox.x).toBeGreaterThanOrEqual(panelBox.x - 1);
  expect(applyBox.x + applyBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);

  // A required choice's control is visible and operable at this width.
  const firstSelect = page.locator(`${BODY} select`).first();
  await expect(firstSelect).toBeVisible();

  await expectNoFatalSignals(page, fatalSignals);
});
