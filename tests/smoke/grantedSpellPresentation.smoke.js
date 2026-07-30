import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

// C2-D granted-spell presentation in a real browser. The unit suite covers the
// rules; this file covers what only a browser can prove: that genuinely seeded
// `builderGranted` rows — produced by the real wizard, not by hand-built markup
// — present correctly on *both* Spells surfaces, that the wording distinguishes
// a granted cantrip from a granted leveled spell, that Known and Cast stay
// operable through the Combat surface and synchronize back to the Character
// sheet, and that a non-granted control row keeps its working Prepared toggle.
//
// Both surfaces are driven through the one shared `spellsPanel.js`: the Combat
// workspace's embedded Spells panel calls `initSpellsPanel()` against the same
// canonical character data, so this exercises the production implementation
// rather than two copies of bespoke markup.

const GRANTED_LEVELED = "Bless";
const GRANTED_CANTRIP = "Fire Bolt";
const CONTROL_SPELL = "Guiding Bolt";
const CHARACTER_SPELLS = "#page-character #spellLevels";
const COMBAT_SPELLS = "#combatEmbeddedSpellLevels";

/** Granted *leveled* spells really are always prepared. */
const LEVELED_VARIANT = {
  badge: "Always Prepared",
  explanation: /^Granted by your build\. It stays prepared and does not use your ordinary prepared spell capacity\.$/
};
/** Granted *cantrips* are never prepared at all (C2-D review correction). */
const CANTRIP_VARIANT = {
  badge: "Granted Cantrip",
  explanation: /^Granted by your build\. Cantrips are not prepared and do not use ordinary prepared spell capacity\.$/
};

/**
 * Builds a level-1 Life Domain cleric through the real wizard and prepares one
 * ordinary spell. Life Domain grants Bless and Cure Wounds at cleric level 1,
 * so Finish seeding writes real `builderGranted` leveled rows; WIS 12 gives a
 * prepared capacity of 2, leaving Guiding Bolt as an ordinary control row.
 *
 * With `highElf: true` the character is an Elf → High Elf, whose required
 * wizard-cantrip build choice seeds a real `builderGranted` *cantrip* row
 * (`grantType: "known_cantrip"`, stored at `prepared: false`) on the same
 * character — so one sheet carries both presentation variants at once.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 * @param {{ highElf?: boolean }} [opts]
 */
async function createLifeDomainCleric(page, name, opts = {}) {
  const { highElf = false } = opts;
  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill(name);
  if (highElf) {
    await page.locator("#builderWizardRace").selectOption("elf");
    await expect(page.locator("#builderWizardSubraceField")).toBeVisible();
    await page.locator("#builderWizardSubrace").selectOption("high-elf");
  } else {
    await page.locator("#builderWizardRace").selectOption("human");
  }
  await page.locator("#builderWizardClass").selectOption("cleric");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click();

  await expect(page.locator("#builderWizardStepRaceChoices")).toBeVisible();
  if (highElf) {
    // The High Elf wizard cantrip is a required build choice; resolving it is
    // what produces a genuine granted-cantrip row at Finish.
    const cantripSelect = page.locator('#builderWizardOriginChoices select[data-choice-id="high-elf-cantrip"]');
    await expect(cantripSelect).toBeVisible();
    await cantripSelect.selectOption("fire-bolt");
  }
  await page.locator("#builderWizardNext").click();

  await expect(page.locator("#builderWizardStepClasses")).toBeVisible();
  const subclassSelect = page.locator("#builderWizardStepClasses .builderSubclassField select");
  await expect(subclassSelect).toHaveCount(1);
  await subclassSelect.selectOption("life");
  await page.locator("#builderWizardNext").click();

  await expect(page.locator("#builderWizardStepClassChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  for (const [suffix, value] of Object.entries({ Str: "10", Dex: "10", Con: "12", Int: "10", Wis: "12", Cha: "10" })) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click();

  // Prepare exactly one ordinary spell. The filter opens every level's
  // disclosure, so the row is operable without hunting for a summary.
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  const preparedGroup = page.locator("#builderWizardSpellsBody .builderSpellGroup").filter({
    has: page.getByText("Prepared Spells", { exact: true })
  });
  // The grants are read-only context in the wizard and never ordinary picks.
  await expect(page.locator(".builderGrantedSpells")).toContainText(GRANTED_LEVELED);
  await page.locator("#builderWizardSpellsBody .builderSpellFilterField input").fill("Guiding");
  const controlRow = preparedGroup.locator(".builderSpellCheckItem").filter({ hasText: CONTROL_SPELL });
  await expect(controlRow).toHaveCount(1);
  await controlRow.locator("input[type=checkbox]").check();
  await expect(preparedGroup.locator(".builderSpellGroupCount")).toHaveText("1 / 2 prepared");

  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await page.locator("#builderWizardFinish").click();
  if (await page.locator("#builderWizardFinish").textContent() === "Finish Anyway") {
    await page.locator("#builderWizardFinish").click();
  }
  await expect(page.locator("#builderWizardPanel")).toBeHidden();
}

/**
 * Rows carry their spell name in an <input> value, which no text-based locator
 * can see, so resolve the row's position first and address it by index.
 * @param {import("@playwright/test").Page} page
 */
async function spellRowIndex(page, rootSelector, spellName) {
  return page.evaluate(({ selector, name }) => {
    const root = document.querySelector(selector);
    if (!root) return -1;
    return [...root.querySelectorAll(".spellRow")]
      .findIndex((row) => row.querySelector(".spellName")?.value === name);
  }, { selector: rootSelector, name: spellName });
}

async function spellRow(page, rootSelector, spellName) {
  const index = await spellRowIndex(page, rootSelector, spellName);
  expect(index, `${spellName} row missing from ${rootSelector}`).toBeGreaterThanOrEqual(0);
  return page.locator(`${rootSelector} .spellRow`).nth(index);
}

/** The persisted shape of one spell row, read from canonical state. */
async function readStoredSpell(page, spellName) {
  return page.evaluate((name) => {
    const collection = globalThis.__APP_STATE__.characters;
    const entry = collection.entries.find((item) => item?.id === collection.activeId);
    return (entry.spells.levels.flatMap((level) => level.spells || []))
      .find((spell) => spell.name === name) ?? null;
  }, spellName);
}

/**
 * Asserts the full C2-D presentation contract on one surface, for one row, in
 * the wording variant that row is entitled to.
 * @param {import("@playwright/test").Page} page
 */
async function expectGrantedPresentation(page, rootSelector, spellName, variant) {
  const row = await spellRow(page, rootSelector, spellName);

  // The non-interactive marker, labelled exactly for this grant's kind.
  const badge = row.locator(".spellGrantBadge");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText(variant.badge);
  await expect(badge).toHaveJSProperty("tagName", "SPAN");

  // A visible explanation, not a tooltip.
  const explanation = row.locator(".spellGrantExplain");
  await expect(explanation).toBeVisible();
  await expect(explanation).toHaveText(variant.explanation);

  // No interactive Prepared control anywhere in the row.
  await expect(row.getByRole("button", { name: /prepared/i })).toHaveCount(0);
  await expect(row.locator(".spellGrantNote").locator("button, input, a, [tabindex]")).toHaveCount(0);

  // Known and Cast stay visible and enabled.
  await expect(row.getByRole("button", { name: "Known", exact: true })).toBeEnabled();
  await expect(row.getByRole("button", { name: "Cast", exact: true })).toBeEnabled();

  if (variant === CANTRIP_VARIANT) {
    // A cantrip is never prepared: the leveled wording must not leak here.
    await expect(row).not.toContainText("Always Prepared");
    await expect(row).not.toContainText(/stays prepared/i);
  }
  return row;
}

/**
 * The non-granted positive control keeps its manual/DM override toggle.
 * @param {import("@playwright/test").Page} page
 */
async function expectControlPresentation(page, rootSelector) {
  const row = await spellRow(page, rootSelector, CONTROL_SPELL);
  await expect(row.locator(".spellGrantNote")).toHaveCount(0);
  const prepared = row.getByRole("button", { name: "Prepared — manual or DM override" });
  await expect(prepared).toBeVisible();
  await expect(prepared).toBeEnabled();
  return prepared;
}

test("granted leveled spells read as Always Prepared on both the Character and Combat Spells panels", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Granted Spell Smoke" });
  await createLifeDomainCleric(page, "Granted Cleric");

  // Positive control on the data itself: these really are seeded grants.
  const seeded = await readStoredSpell(page, GRANTED_LEVELED);
  expect(seeded).toMatchObject({ builderGranted: true, builderSpellId: "bless", prepared: true });
  const control = await readStoredSpell(page, CONTROL_SPELL);
  expect(control).toMatchObject({ builderSpellId: "guiding-bolt", prepared: true });
  expect(control.builderGranted).toBeUndefined();

  // --- Character Spells panel -------------------------------------------
  await expectGrantedPresentation(page, CHARACTER_SPELLS, GRANTED_LEVELED, LEVELED_VARIANT);
  const characterControlToggle = await expectControlPresentation(page, CHARACTER_SPELLS);
  await expect(characterControlToggle).toHaveAttribute("aria-pressed", "true");

  // --- Combat embedded Spells panel — same shared implementation ---------
  await page.getByRole("tab", { name: "Combat" }).click();
  await page.locator('[data-add-embedded-panel="spells"]').click();
  await expect(page.locator(COMBAT_SPELLS)).toBeVisible();
  await expectGrantedPresentation(page, COMBAT_SPELLS, GRANTED_LEVELED, LEVELED_VARIANT);
  await expectControlPresentation(page, COMBAT_SPELLS);

  // Known and Cast are usable through Combat and land on canonical data.
  const combatGranted = await spellRow(page, COMBAT_SPELLS, GRANTED_LEVELED);
  const combatCast = combatGranted.getByRole("button", { name: "Cast", exact: true });
  await expect(combatCast).toHaveAttribute("aria-pressed", "false");
  await combatCast.click();
  await expect(combatCast).toHaveAttribute("aria-pressed", "true");
  const combatKnown = combatGranted.getByRole("button", { name: "Known", exact: true });
  await combatKnown.focus();
  await page.keyboard.press("Enter");
  await expect(combatKnown).toHaveAttribute("aria-pressed", "false");

  // Only the intended fields moved; the grant marker and prepared flag stand.
  await expect.poll(() => readStoredSpell(page, GRANTED_LEVELED))
    .toMatchObject({ expended: true, known: false, prepared: true, builderGranted: true });

  // The non-granted control's Prepared toggle still works from Combat.
  const combatControlToggle = await expectControlPresentation(page, COMBAT_SPELLS);
  await combatControlToggle.click();
  await expect(combatControlToggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => readStoredSpell(page, CONTROL_SPELL))
    .toMatchObject({ prepared: false, known: true, expended: false });

  // --- Synchronization back to the Character surface ---------------------
  await page.getByRole("tab", { name: "Character" }).click();
  await expect(page.locator("#page-character")).toBeVisible();
  await expectGrantedPresentation(page, CHARACTER_SPELLS, GRANTED_LEVELED, LEVELED_VARIANT);
  const characterGranted = await spellRow(page, CHARACTER_SPELLS, GRANTED_LEVELED);
  await expect(characterGranted.getByRole("button", { name: "Cast", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(characterGranted.getByRole("button", { name: "Known", exact: true }))
    .toHaveAttribute("aria-pressed", "false");
  await expect(await expectControlPresentation(page, CHARACTER_SPELLS))
    .toHaveAttribute("aria-pressed", "false");

  // The presentation survives a reload of the persisted campaign.
  await page.reload();
  await expect(page.locator("main")).toBeVisible();
  await page.getByRole("tab", { name: "Character" }).click();
  await expect(page.locator("#page-character")).toBeVisible();
  await expectGrantedPresentation(page, CHARACTER_SPELLS, GRANTED_LEVELED, LEVELED_VARIANT);
  await expect(await readStoredSpell(page, GRANTED_LEVELED))
    .toMatchObject({ builderGranted: true, prepared: true, expended: true, known: false });

  await expectNoFatalSignals(page, fatalSignals);
});

test("a granted cantrip reads as Granted Cantrip, never Always Prepared, on both surfaces", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Granted Cantrip Smoke" });
  // One High Elf Life Domain cleric carries both grant kinds at once.
  await createLifeDomainCleric(page, "Cantrip Cleric", { highElf: true });

  // Positive control on the data: seeding really wrote a granted cantrip at
  // `prepared: false` alongside a granted leveled spell at `prepared: true`.
  const cantrip = await readStoredSpell(page, GRANTED_CANTRIP);
  expect(cantrip).toMatchObject({
    builderGranted: true, builderSpellId: "fire-bolt", prepared: false, known: true
  });
  await expect(await readStoredSpell(page, GRANTED_LEVELED))
    .toMatchObject({ builderGranted: true, builderSpellId: "bless", prepared: true });

  // --- Character Spells panel: both variants on one sheet ----------------
  await expectGrantedPresentation(page, CHARACTER_SPELLS, GRANTED_CANTRIP, CANTRIP_VARIANT);
  await expectGrantedPresentation(page, CHARACTER_SPELLS, GRANTED_LEVELED, LEVELED_VARIANT);
  await expectControlPresentation(page, CHARACTER_SPELLS);

  // --- Combat embedded Spells panel — same shared implementation ---------
  await page.getByRole("tab", { name: "Combat" }).click();
  await page.locator('[data-add-embedded-panel="spells"]').click();
  await expect(page.locator(COMBAT_SPELLS)).toBeVisible();
  await expectGrantedPresentation(page, COMBAT_SPELLS, GRANTED_CANTRIP, CANTRIP_VARIANT);
  await expectGrantedPresentation(page, COMBAT_SPELLS, GRANTED_LEVELED, LEVELED_VARIANT);

  // Known and Cast on the cantrip row are usable through Combat, write only
  // their own field, and leave `prepared: false` and the grant marker alone.
  const combatCantrip = await spellRow(page, COMBAT_SPELLS, GRANTED_CANTRIP);
  const combatCast = combatCantrip.getByRole("button", { name: "Cast", exact: true });
  await combatCast.click();
  await expect(combatCast).toHaveAttribute("aria-pressed", "true");
  const combatKnown = combatCantrip.getByRole("button", { name: "Known", exact: true });
  await combatKnown.focus();
  await page.keyboard.press("Enter");
  await expect(combatKnown).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => readStoredSpell(page, GRANTED_CANTRIP))
    .toMatchObject({ expended: true, known: false, prepared: false, builderGranted: true });

  // --- Back to the Character surface, then reload ------------------------
  await page.getByRole("tab", { name: "Character" }).click();
  await expect(page.locator("#page-character")).toBeVisible();
  const characterCantrip = await expectGrantedPresentation(
    page, CHARACTER_SPELLS, GRANTED_CANTRIP, CANTRIP_VARIANT);
  await expect(characterCantrip.getByRole("button", { name: "Cast", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(characterCantrip.getByRole("button", { name: "Known", exact: true }))
    .toHaveAttribute("aria-pressed", "false");

  await page.reload();
  await expect(page.locator("main")).toBeVisible();
  await page.getByRole("tab", { name: "Character" }).click();
  await expect(page.locator("#page-character")).toBeVisible();
  await expectGrantedPresentation(page, CHARACTER_SPELLS, GRANTED_CANTRIP, CANTRIP_VARIANT);
  await expectGrantedPresentation(page, CHARACTER_SPELLS, GRANTED_LEVELED, LEVELED_VARIANT);
  await expect(await readStoredSpell(page, GRANTED_CANTRIP))
    .toMatchObject({ builderGranted: true, prepared: false, expended: true, known: false });

  await expectNoFatalSignals(page, fatalSignals);
});

test("both granted markers and their explanations stay usable at 380px", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Granted Narrow Smoke" });
  await page.setViewportSize({ width: 380, height: 820 });
  // High Elf Life Domain cleric: a granted cantrip and a granted leveled spell
  // on the same sheet, so both wordings are proved at this width.
  await createLifeDomainCleric(page, "Narrow Cleric", { highElf: true });

  const panel = page.locator("#charSpellsPanel");
  const panelBox = await panel.boundingBox();

  for (const [spellName, variant] of [[GRANTED_CANTRIP, CANTRIP_VARIANT], [GRANTED_LEVELED, LEVELED_VARIANT]]) {
    const row = await expectGrantedPresentation(page, CHARACTER_SPELLS, spellName, variant);

    const rowOverflow = await row.evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(rowOverflow, `${spellName} row overflow`).toBeLessThanOrEqual(1);

    // The marker, the explanation, and both remaining controls stay inside the
    // panel's box rather than being clipped or pushed off-screen.
    for (const locator of [
      row.locator(".spellGrantBadge"),
      row.locator(".spellGrantExplain"),
      row.getByRole("button", { name: "Known", exact: true }),
      row.getByRole("button", { name: "Cast", exact: true })
    ]) {
      await expect(locator).toBeVisible();
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(panelBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
      expect(box.height).toBeGreaterThan(0);
    }

    // Both controls are keyboard-operable at this width.
    const known = row.getByRole("button", { name: "Known", exact: true });
    await known.focus();
    await expect(known).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(known).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Enter");
    await expect(known).toHaveAttribute("aria-pressed", "true");
  }

  const pageOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);
  const panelOverflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(panelOverflow).toBeLessThanOrEqual(1);

  await expectNoFatalSignals(page, fatalSignals);
});
