import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

/**
 * Builds a level-1 half-orc cleric through the real wizard. Extracted so the
 * prepared-synchronization tests below start from the same shipped Finish
 * seeding as the original rest test.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
async function createRestCleric(page, name) {
  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill(name);
  await page.locator("#builderWizardRace").selectOption("half-orc");
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
  for (const [suffix, value] of Object.entries({ Str: "10", Dex: "10", Con: "12", Int: "10", Wis: "16", Cha: "10" })) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();
}

/** The "Prepared" toggle state of a builder-managed row, by registry id. */
async function readPreparedToggles(page, rootSelector) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return null;
    /** @type {Record<string, string>} */
    const out = {};
    for (const row of root.querySelectorAll(".spellRow")) {
      const name = row.querySelector(".spellName")?.value || "";
      const toggle = [...row.querySelectorAll(".spellToggle")]
        .find((button) => button.textContent === "Prepared");
      if (name && toggle) out[name] = toggle.getAttribute("aria-pressed") || "";
    }
    return out;
  }, rootSelector);
}

async function installRestState(page) {
  // Mutated directly on the state object — source modules (characterHelpers,
  // dev) are not importable from the bundled production build this smoke also
  // runs against. The freeform entry carries only the fields the rest flow
  // and this test's assertions read; it is never activated in the UI.
  await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const cleric = collection.entries.find((entry) => entry?.id === collection.activeId);
    cleric.hpCur = 4;
    cleric.hpMax = 16;
    // The manufactured 16 replaces the Finish-derived max: declare it as an
    // intentional fixed override so the calc-aware rest flow honors it.
    cleric.hpMaxCalc = { mode: "fixed", adjustment: 0 };
    cleric.rest = { hitDiceSpent: { "class:cleric": 1 }, preparedByClass: { cleric: ["cure-wounds"] } };
    cleric.deathSaves = { successes: 1, failures: 1 };
    cleric.build.spellcasting.cleric.preparedIds = ["cure-wounds"];

    collection.entries.push({
      id: "char_rest_freeform",
      name: "Unaffected Freeform",
      build: null,
      hpCur: 3,
      hpMax: 10,
      hitDieAmt: 1,
      hitDieSize: 8,
      rest: { hitDiceSpent: {}, preparedByClass: {} },
      deathSaves: { successes: 0, failures: 0 },
      resources: [],
      attacks: [],
      spells: { levels: [] }
    });
  });
}

test("Long Rest prepared flow preserves No, applies Yes, and stays character-isolated", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Rest Smoke" });
  await createRestCleric(page, "Rest Cleric");
  await installRestState(page);
  await expect(page.locator("#charName")).toHaveValue("Rest Cleric");

  await page.locator("#charLongRestBtn").click();
  await expect(page.locator("#characterRestOverlay")).toBeVisible();
  await expect(page.locator("#characterRestOverlay")).toContainText("Would you like to change your prepared spells?");
  // C1: the current-versus-effective count is on screen and accurate before
  // the Yes/No choice, while the picker itself stays disclosed under "Yes".
  await expect(page.locator('input[name="characterRestPreparedChoice"][value="no"]')).toBeChecked();
  await expect(page.locator(".characterRestPreparedCount")).toBeVisible();
  await expect(page.locator(".characterRestPreparedCount")).toHaveText("Cleric — 1 of 4 prepared");
  await expect(page.locator(".characterRestPreparedLists")).toBeHidden();
  await page.getByRole("button", { name: "Take Long Rest" }).click();
  await expect(page.locator("#characterRestOverlay")).toBeHidden();
  const afterNo = await page.evaluate(() => globalThis.__APP_STATE__.characters.entries.map((entry) => ({
    id: entry.id,
    isBuilder: !!entry.build,
    hpCur: entry.hpCur,
    prepared: entry.rest?.preparedByClass?.cleric || [],
    deathSaves: entry.deathSaves,
  })));
  expect(afterNo).toEqual(expect.arrayContaining([
    expect.objectContaining({ isBuilder: true, hpCur: 16, prepared: ["cure-wounds"], deathSaves: { successes: 0, failures: 0 } }),
    expect.objectContaining({ id: "char_rest_freeform", hpCur: 3 }),
  ]));

  await page.evaluate(() => {
    const state = globalThis.__APP_STATE__;
    const cleric = state.characters.entries.find((entry) => entry?.build);
    cleric.hpCur = 5;
  });
  await page.locator("#charLongRestBtn").click();
  await expect(page.locator("#characterRestOverlay")).toBeVisible();
  await page.locator('input[name="characterRestPreparedChoice"][value="yes"]').check();
  await expect(page.locator(".characterRestPreparedLists")).toBeVisible();
  await page.locator('.characterRestSpellRow:has-text("Cure Wounds") input[type="checkbox"]').uncheck();
  // Both the summary line and the picker heading track the toggle.
  await expect(page.locator(".characterRestPreparedCount")).toHaveText("Cleric — 0 of 4 prepared");
  await page.getByRole("button", { name: "Take Long Rest" }).click();
  await expect(page.locator("#characterRestOverlay")).toBeHidden();
  await expect.poll(() => page.evaluate(() => {
    const cleric = globalThis.__APP_STATE__.characters.entries.find((entry) => entry?.build);
    return { hpCur: cleric.hpCur, prepared: cleric.rest?.preparedByClass?.cleric || [] };
  })).toEqual({ hpCur: 16, prepared: [] });

  await page.evaluate(() => {
    const state = globalThis.__APP_STATE__;
    const cleric = state.characters.entries.find((entry) => entry?.build);
    cleric.hpCur = 5;
    cleric.deathSaves = { successes: 2, failures: 1 };
    cleric.rest.preparedByClass = { cleric: ["cure-wounds"] };
  });
  await page.locator("#charLongRestBtn").click();
  await expect(page.locator("#characterRestOverlay")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => {
    const overlay = document.getElementById("characterRestOverlay");
    return !!overlay?.contains(document.activeElement);
  })).toBe(true);
  const beforeRace = await page.evaluate(() => globalThis.__APP_STATE__.characters.entries.map((entry) => ({
    id: entry.id,
    hpCur: entry.hpCur,
    deathSaves: entry.deathSaves,
    rest: entry.rest
  })));
  await page.evaluate(() => {
    globalThis.__APP_STATE__.characters.activeId = "char_rest_freeform";
  });
  await page.getByRole("button", { name: "Take Long Rest" }).click();
  await expect(page.locator("#characterRestOverlay")).toBeHidden();
  await expect(page.locator("#statusText")).toContainText("Rest was canceled because the active character changed.");
  const afterRace = await page.evaluate(() => globalThis.__APP_STATE__.characters.entries.map((entry) => ({
    id: entry.id,
    hpCur: entry.hpCur,
    deathSaves: entry.deathSaves,
    rest: entry.rest
  })));
  expect(afterRace).toEqual(beforeRace);

  await page.evaluate(() => {
    const state = globalThis.__APP_STATE__;
    state.characters.activeId = state.characters.entries.find((entry) => entry?.build)?.id || null;
  });
  await page.locator("#charSelector").selectOption("char_rest_freeform");
  await expect.poll(() => page.evaluate(() => globalThis.__APP_STATE__.characters.activeId)).toBe("char_rest_freeform");
  await page.locator("#charShortRestBtn").click();
  await expect(page.locator("#characterRestOverlay")).toBeVisible();
  await page.locator("input[data-rest-pool-id='manual']").fill("1");
  await page.getByRole("button", { name: "Take Short Rest" }).click();
  await expect(page.locator("#characterRestOverlay")).toBeHidden();
  await expect.poll(() => page.evaluate(() => {
    const freeform = globalThis.__APP_STATE__.characters.entries.find((entry) => entry?.id === "char_rest_freeform");
    return { hpCur: freeform.hpCur, spent: freeform.rest?.hitDiceSpent?.manual || 0 };
  })).toEqual(expect.objectContaining({ hpCur: expect.any(Number), spent: 1 }));
  const shortRestHp = await page.evaluate(() => globalThis.__APP_STATE__.characters.entries.find((entry) => entry?.id === "char_rest_freeform")?.hpCur);
  expect(shortRestHp).toBeGreaterThan(3);

  await expectNoFatalSignals(page, fatalSignals);
});

test("prepared deselection clears the sheet row on both Spells surfaces and survives reload", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Prepared Sync Smoke" });
  await createRestCleric(page, "Sync Cleric");

  await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const cleric = collection.entries.find((entry) => entry?.id === collection.activeId);
    cleric.hpCur = 4;
    cleric.hpMax = 16;
    cleric.hpMaxCalc = { mode: "fixed", adjustment: 0 };
    cleric.rest = { hitDiceSpent: {}, preparedByClass: {} };
    // A user-owned manual row that the sync must never touch.
    const first = cleric.spells.levels.find((level) => level.label === "1st Level");
    first.spells.push({
      id: "sp_manual_ward",
      name: "My Homebrew Ward",
      notesCollapsed: true,
      known: true,
      prepared: true,
      expended: false
    });
  });

  // 1) Prepare Cure Wounds through the real Long Rest flow: a row appears.
  await page.locator("#charLongRestBtn").click();
  await expect(page.locator("#characterRestOverlay")).toBeVisible();
  await page.locator('input[name="characterRestPreparedChoice"][value="yes"]').check();
  await page.locator('.characterRestSpellRow:has-text("Cure Wounds") input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Take Long Rest" }).click();
  await expect(page.locator("#characterRestOverlay")).toBeHidden();
  await expect.poll(() => readPreparedToggles(page, "#page-character #spellLevels"))
    .toMatchObject({ "Cure Wounds": "true", "My Homebrew Ward": "true" });

  // 2) Deselect it: the row must stay, lose its prepared flag, and keep its id.
  const rowIdBefore = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const cleric = collection.entries.find((entry) => entry?.id === collection.activeId);
    return (cleric.spells.levels.flatMap((level) => level.spells || []))
      .find((spell) => spell.builderSpellId === "cure-wounds")?.id;
  });
  expect(rowIdBefore).toBeTruthy();

  await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    collection.entries.find((entry) => entry?.id === collection.activeId).hpCur = 5;
  });
  await page.locator("#charLongRestBtn").click();
  await expect(page.locator("#characterRestOverlay")).toBeVisible();
  await page.locator('input[name="characterRestPreparedChoice"][value="yes"]').check();
  await page.locator('.characterRestSpellRow:has-text("Cure Wounds") input[type="checkbox"]').uncheck();
  await page.getByRole("button", { name: "Take Long Rest" }).click();
  await expect(page.locator("#characterRestOverlay")).toBeHidden();

  await expect.poll(() => readPreparedToggles(page, "#page-character #spellLevels"))
    .toMatchObject({ "Cure Wounds": "false", "My Homebrew Ward": "true" });

  const afterDeselect = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const cleric = collection.entries.find((entry) => entry?.id === collection.activeId);
    const rows = cleric.spells.levels.flatMap((level) => level.spells || []);
    return {
      prepared: cleric.rest?.preparedByClass?.cleric ?? null,
      cure: rows.find((spell) => spell.builderSpellId === "cure-wounds"),
      manual: rows.find((spell) => spell.id === "sp_manual_ward"),
      rowCount: rows.length
    };
  });
  expect(afterDeselect.prepared).toBeNull();
  expect(afterDeselect.cure).toMatchObject({ id: rowIdBefore, prepared: false, known: true });
  expect(afterDeselect.manual).toMatchObject({ prepared: true });

  // 3) The Combat workspace's embedded Spells panel agrees — same canonical data.
  await page.getByRole("tab", { name: "Combat" }).click();
  await page.locator('[data-add-embedded-panel="spells"]').click();
  await expect(page.locator("#combatEmbeddedSpellLevels")).toBeVisible();
  await expect.poll(() => readPreparedToggles(page, "#combatEmbeddedSpellLevels"))
    .toMatchObject({ "Cure Wounds": "false", "My Homebrew Ward": "true" });

  // 4) The cleared flag is persisted, not just rendered.
  await page.reload();
  await expect(page.locator("main")).toBeVisible();
  await page.getByRole("tab", { name: "Character" }).click();
  await expect.poll(() => readPreparedToggles(page, "#page-character #spellLevels"))
    .toMatchObject({ "Cure Wounds": "false", "My Homebrew Ward": "true" });
  const afterReload = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const cleric = collection.entries.find((entry) => entry?.id === collection.activeId);
    return (cleric.spells.levels.flatMap((level) => level.spells || []))
      .find((spell) => spell.builderSpellId === "cure-wounds");
  });
  expect(afterReload).toMatchObject({ id: rowIdBefore, prepared: false });

  await expectNoFatalSignals(page, fatalSignals);
});

test("Long Rest dialog stays usable at 380px with no horizontal overflow", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Rest Narrow Smoke" });
  await page.setViewportSize({ width: 380, height: 800 });
  await createRestCleric(page, "Narrow Cleric");
  await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const cleric = collection.entries.find((entry) => entry?.id === collection.activeId);
    cleric.hpCur = 4;
    cleric.hpMax = 16;
    cleric.hpMaxCalc = { mode: "fixed", adjustment: 0 };
    cleric.rest = { hitDiceSpent: { "class:cleric": 1 }, preparedByClass: { cleric: ["cure-wounds"] } };
  });

  await page.locator("#charLongRestBtn").click();
  await expect(page.locator("#characterRestOverlay")).toBeVisible();

  // Counts are readable before the Yes/No choice, at this width.
  await expect(page.locator(".characterRestPreparedCount")).toBeVisible();
  const pageOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);

  // The panel scrolls vertically inside itself rather than sideways.
  const panelOverflow = await page.locator(".characterRestPanel").evaluate(
    (node) => node.scrollWidth - node.clientWidth);
  expect(panelOverflow).toBeLessThanOrEqual(1);

  // Disclose the picker by keyboard alone: Tab reaches the radio group, and
  // ArrowDown moves within it (Tab leaves a radio group by design).
  await page.keyboard.press("Tab");
  await expect(page.locator('input[name="characterRestPreparedChoice"][value="no"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('input[name="characterRestPreparedChoice"][value="yes"]')).toBeChecked();
  await expect(page.locator(".characterRestPreparedLists")).toBeVisible();
  const openOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(openOverflow).toBeLessThanOrEqual(1);

  // A spell checkbox is reachable and togglable by keyboard, and the count
  // tracks it live.
  await expect(page.locator(".characterRestPreparedCount")).toHaveText("Cleric — 1 of 4 prepared");
  await page.keyboard.press("Tab");
  const firstCheckbox = page.locator(".characterRestSpellRow input[type='checkbox']").first();
  await expect(firstCheckbox).toBeFocused();
  await page.keyboard.press(" ");
  await expect(firstCheckbox).toBeChecked();
  await expect(page.locator(".characterRestPreparedCount")).toHaveText("Cleric — 2 of 4 prepared");
  await page.keyboard.press(" ");
  await expect(firstCheckbox).not.toBeChecked();
  await expect(page.locator(".characterRestPreparedCount")).toHaveText("Cleric — 1 of 4 prepared");

  // A spell checkbox and its label stay inside the panel and remain tappable.
  const panelBox = await page.locator(".characterRestPanel").boundingBox();
  const spellRow = page.locator('.characterRestSpellRow:has-text("Cure Wounds")').first();
  await expect(spellRow).toBeVisible();
  const rowBox = await spellRow.boundingBox();
  expect(rowBox).not.toBeNull();
  expect(rowBox.x).toBeGreaterThanOrEqual(panelBox.x - 1);
  expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
  expect(rowBox.height).toBeGreaterThanOrEqual(16);

  // Footer controls are reachable, not clipped out of the panel.
  const applyButton = page.getByRole("button", { name: "Take Long Rest" });
  await expect(applyButton).toBeVisible();
  const applyBox = await applyButton.boundingBox();
  expect(applyBox).not.toBeNull();
  expect(applyBox.x).toBeGreaterThanOrEqual(panelBox.x - 1);
  expect(applyBox.x + applyBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);

  // Keyboard focus stays trapped inside the dialog at this width.
  await expect.poll(() => page.evaluate(() => {
    const overlay = document.getElementById("characterRestOverlay");
    return !!overlay?.contains(document.activeElement);
  })).toBe(true);

  // Escape cancels without mutating.
  await page.keyboard.press("Escape");
  await expect(page.locator("#characterRestOverlay")).toBeHidden();
  const untouched = await page.evaluate(() => {
    const collection = globalThis.__APP_STATE__.characters;
    const cleric = collection.entries.find((entry) => entry?.id === collection.activeId);
    return { hpCur: cleric.hpCur, prepared: cleric.rest?.preparedByClass?.cleric || [] };
  });
  expect(untouched).toEqual({ hpCur: 4, prepared: ["cure-wounds"] });

  await expectNoFatalSignals(page, fatalSignals);
});
