import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

// Builder wizard happy path: create a Dragonborn fighter through every
// wizard step (identity → race & background choices → classes & levels →
// class choices → abilities → equipment → summary), Finish, and verify the
// sheet is seeded (features/languages text, derived Breath Weapon card,
// Builder Summary) and that the builder character persists across a full
// reload.

async function readActiveCharacter(page) {
  return page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const entries = Array.isArray(collection?.entries) ? collection.entries : [];
    const character = entries.find((entry) => entry?.id === collection?.activeId);
    return character ? JSON.parse(JSON.stringify(character)) : null;
  });
}

test("builder wizard dragonborn happy path seeds the character sheet", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Wizard Smoke" });

  await page.getByRole("tab", { name: "Character" }).click();

  // Open the wizard through the character action menu.
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await expect(page.locator("#builderWizardStepIdentity")).toBeVisible();

  // Step 1 — identity.
  await page.locator("#builderWizardName").fill("Smoke Dragonborn");
  await page.locator("#builderWizardRace").selectOption("dragonborn");
  await page.locator("#builderWizardClass").selectOption("fighter");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click();

  // Step 2 — race & background choices (Dragonborn ancestry is required).
  await expect(page.locator("#builderWizardStepRaceChoices")).toBeVisible();
  await page.locator("#builderWizardDraconicAncestry").selectOption("black");
  // The choice preview reflects the ancestry-derived mechanics.
  await expect(page.locator("#builderWizardRaceChoicePreview")).toContainText("Black");
  await page.locator("#builderWizardNext").click();

  // Step 3 — classes & levels (fighter block seeded from identity).
  await expect(page.locator("#builderWizardStepClasses")).toBeVisible();
  await expect(page.locator("#builderWizardClassesBody")).toContainText("Character Level: 1");
  await page.locator("#builderWizardNext").click();

  // Step 4 — class choices (fighter skills + fighting style).
  await expect(page.locator("#builderWizardStepClassChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();

  // Step 5 — abilities (manual method is the default).
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  const abilityValues = { Str: "15", Dex: "14", Con: "13", Int: "12", Wis: "10", Cha: "8" };
  for (const [suffix, value] of Object.entries(abilityValues)) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click();

  // Step 6 — equipment (fighter is not a caster, so no spells step).
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator("#builderWizardNext").click();

  // Step 7 — summary review, then Finish.
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await expect(page.locator("#builderWizardSummary")).toContainText("Dragonborn");
  await expect(page.locator("#builderWizardSummary")).toContainText("Fighter 1");
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  // The created character is active, in builder mode, with the chosen
  // level-by-level build.
  const created = await readActiveCharacter(page);
  expect(created).not.toBeNull();
  expect(created.name).toBe("Smoke Dragonborn");
  expect(created.build).not.toBeNull();
  expect(created.build.raceId).toBe("dragonborn");
  expect(created.build.backgroundId).toBe("acolyte");
  expect(created.build.levels).toEqual([{ classId: "fighter", hp: null }]);

  // Finish-time seeding landed in the user-owned sheet fields.
  await expect(page.locator("#charFeatures")).toHaveValue(/Dragonborn Traits/);
  await expect(page.locator("#charFeatures")).toHaveValue(/Draconic Ancestry: Black/);
  await expect(page.locator("#charFeatures")).toHaveValue(/resistance to acid damage/);
  await expect(page.locator("#charFeatures")).toHaveValue(/Second Wind \(Fighter 1\)/);
  await expect(page.locator("#charLanguages")).toHaveValue(/Draconic/);

  // Derived Breath Weapon card renders in Abilities & Features, and the
  // Builder Summary panel is shown for builder characters.
  await expect(page.locator("#charAbilitiesFeaturesList")).toContainText("Breath Weapon");
  await expect(page.locator("#charBuilderSummaryPanel")).toBeVisible();

  // The seeded sheet survives a full reload (persistence round trip).
  await page.waitForTimeout(1500);
  await page.reload();
  await page.getByRole("tab", { name: "Character" }).click();
  await expect(page.locator("#charFeatures")).toHaveValue(/Draconic Ancestry: Black/);
  const restored = await readActiveCharacter(page);
  expect(restored.build).not.toBeNull();
  expect(restored.build.raceId).toBe("dragonborn");
  expect(restored.build.levels).toEqual([{ classId: "fighter", hp: null }]);
  expect(restored.manualFeatureCards).toEqual([]);

  await expectNoFatalSignals(page, fatalSignals);
});

// Regression guard for "Edit in Builder". The active character is read via
// getActiveCharacter(state), which — on localhost / preview / ?dev=1 sessions —
// returns values wrapped by the dev state-mutation guard's recursive Proxy
// (js/utils/dev.js). The wizard used to `structuredClone(character.build)` to
// seed edit mode, and structuredClone throws DataCloneError on a Proxy, so
// clicking "Edit in Builder" crashed with
// "Failed to execute 'structuredClone' … could not be cloned" and the wizard
// never opened. This drives a create → edit round trip and asserts the wizard
// opens, edits persist, and no fatal console signals fire — proving the edit
// flow receives only plain, cloneable build data.
test("builder wizard edit mode opens without a clone crash and persists edits", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Edit Smoke" });

  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();

  // A half-orc fighter has no required race choices and is not a caster, so it
  // reaches Finish with minimal input.
  await page.locator("#builderWizardName").fill("Edit Target");
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

  const created = await readActiveCharacter(page);
  expect(created.build.levels).toEqual([{ classId: "fighter", hp: null }]);

  // Re-open the same character in the wizard via "Edit in Builder".
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionEditBuilderBtn").click();

  // Before the fix this threw DataCloneError inside open() and the wizard
  // stayed hidden. It must now open in edit mode, pre-populated from the
  // cloned build (proving the build was read through the guard proxy safely).
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await expect(page.locator("#builderWizardTitle")).toHaveText("Edit with Builder");
  await expect(page.locator("#builderWizardStepIdentity")).toBeVisible();
  await expect(page.locator("#builderWizardName")).toHaveValue("Edit Target");
  await expect(page.locator("#builderWizardRace")).toHaveValue("half-orc");
  await expect(page.locator("#builderWizardBackground")).toHaveValue("acolyte");

  // Rename in place, advance to the Summary step (Finish is only shown there;
  // abilities round-tripped from the clone so validation passes), Finish, and
  // confirm the edit applied to the same character while the rest of the build
  // round-tripped intact.
  await page.locator("#builderWizardName").fill("Edit Target Renamed");
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepRaceChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClasses")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClassChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepEquipment")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepSummary")).toBeVisible();
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  const edited = await readActiveCharacter(page);
  expect(edited.id).toBe(created.id);
  expect(edited.name).toBe("Edit Target Renamed");
  expect(edited.build.raceId).toBe("half-orc");
  expect(edited.build.backgroundId).toBe("acolyte");
  expect(edited.build.levels).toEqual([{ classId: "fighter", hp: null }]);

  await expectNoFatalSignals(page, fatalSignals);
});

async function fillPromptDialog(page, value) {
  await expect(page.locator("#uiDialogInput")).toBeVisible();
  await page.locator("#uiDialogInput").fill(value);
  await page.locator("#uiDialogOk").click();
  await expect(page.locator("#uiDialogOverlay")).toBeHidden();
}

async function inventoryTabTitles(page) {
  return page.locator("#inventoryTabs .sessionTab").allTextContents();
}

async function selectCharacter(page, id) {
  await page.evaluate((characterId) => {
    const selector = document.getElementById("charSelector");
    if (!(selector instanceof HTMLSelectElement)) return;
    selector.value = characterId;
    selector.dispatchEvent(new Event("change", { bubbles: true }));
  }, id);
}

// Regression guard for Equipment / Inventory pockets leaking across character
// switches. Creating a builder character seeds a "Starting Gear" pocket; a
// freeform character keeps its own pockets. Switching the active character must
// fully rebind the Equipment panel so pockets, and the add-pocket control, only
// ever operate on the currently active character.
test("inventory pockets stay isolated per character across switching", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Inventory Smoke" });
  await page.getByRole("tab", { name: "Character" }).click();

  // Builder character — at Finish, loose starting gear merges into the general
  // "Inventory" pocket and the Barbarian's fixed Explorer's Pack becomes its
  // own pocket listing that pack's SRD contents.
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill("Inv Builder");
  await page.locator("#builderWizardRace").selectOption("half-orc");
  await page.locator("#builderWizardClass").selectOption("barbarian");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  const abilityValues = { Str: "15", Dex: "14", Con: "13", Int: "12", Wis: "10", Cha: "8" };
  for (const [suffix, value] of Object.entries(abilityValues)) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardNext").click();
  await page.locator("#builderWizardFinish").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();
  const builderId = await page.evaluate(() => String(globalThis.__APP_STATE__?.characters?.activeId || ""));
  expect(await inventoryTabTitles(page)).toEqual(["Inventory", "Explorer's Pack"]);
  // Loose gear lands in Inventory; the pack pocket holds the pack's contents.
  await expect(page.locator("#inventoryNotesBox")).toHaveValue(/Javelin ×4/);
  await page.locator("#inventoryTabs .sessionTab", { hasText: "Explorer's Pack" }).click();
  await expect(page.locator("#inventoryNotesBox")).toHaveValue(/Bedroll/);
  await page.locator("#inventoryTabs .sessionTab", { hasText: "Inventory" }).first().click();

  // Freeform character with its own distinctive pocket.
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBtn").click();
  await expect(page.locator("#charName")).toBeVisible();
  const freeformId = await page.evaluate(() => String(globalThis.__APP_STATE__?.characters?.activeId || ""));
  expect(await inventoryTabTitles(page)).toEqual(["Inventory"]);
  await page.locator("#addInventoryBtn").click();
  await fillPromptDialog(page, "Freeform Pocket");
  expect(await inventoryTabTitles(page)).toEqual(["Inventory", "Freeform Pocket"]);

  // Switch to the builder character: only its pockets appear, and its
  // add-pocket control still works and targets the builder character only.
  await selectCharacter(page, builderId);
  await expect(page.locator("#inventoryTabs .sessionTab")).toHaveCount(2);
  expect(await inventoryTabTitles(page)).toEqual(["Inventory", "Explorer's Pack"]);
  await page.locator("#addInventoryBtn").click();
  await fillPromptDialog(page, "Builder Pocket");
  expect(await inventoryTabTitles(page)).toEqual(["Inventory", "Explorer's Pack", "Builder Pocket"]);

  // Switch back to the freeform character: its pockets are intact and never
  // received the builder's "Builder Pocket" or "Explorer's Pack".
  await selectCharacter(page, freeformId);
  await expect(page.locator("#inventoryTabs .sessionTab")).toHaveCount(2);
  const freeformTitles = await inventoryTabTitles(page);
  expect(freeformTitles).toEqual(["Inventory", "Freeform Pocket"]);
  expect(freeformTitles).not.toContain("Explorer's Pack");
  expect(freeformTitles).not.toContain("Builder Pocket");

  // The freeform add-pocket control is still usable after repeated switching.
  await page.locator("#addInventoryBtn").click();
  await fillPromptDialog(page, "Freeform Pocket Two");
  expect(await inventoryTabTitles(page)).toEqual(["Inventory", "Freeform Pocket", "Freeform Pocket Two"]);

  await expectNoFatalSignals(page, fatalSignals);
});

// Regression guard for the Spells step spell list. A broad
// `#builderWizardPanel :is(input, select)` rule used to give every checkbox
// text-field styling (100% width, 36px min-height, padded rounded box), so the
// spell toggles rendered as large empty rectangles beside truncated names.
// Drive a level-1 sorcerer to the Spells step and assert the checkboxes render
// as compact toggles (not stretched fields) and the spell names are allowed to
// wrap.
test("builder wizard spells step renders compact checkbox rows", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Spells Smoke" });

  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();

  // Identity — a half-orc (no required race choices) sorcerer is a level-1
  // caster, so the Spells step is reachable without any blocking selections.
  await page.locator("#builderWizardName").fill("Smoke Sorcerer");
  await page.locator("#builderWizardRace").selectOption("half-orc");
  await page.locator("#builderWizardClass").selectOption("sorcerer");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click();

  // Origin (acolyte languages — optional), classes, and class choices all
  // advance without required input for this build.
  await expect(page.locator("#builderWizardStepRaceChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClasses")).toBeVisible();
  await page.locator("#builderWizardNext").click();
  await expect(page.locator("#builderWizardStepClassChoices")).toBeVisible();
  await page.locator("#builderWizardNext").click();

  // Abilities must be complete before the Spells step.
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  const abilityValues = { Str: "10", Dex: "14", Con: "13", Int: "12", Wis: "10", Cha: "15" };
  for (const [suffix, value] of Object.entries(abilityValues)) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click();

  // Spells step: the Sorcerer cantrip list (open by default) is present.
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  await expect(page.locator("#builderWizardSpellsBody")).toContainText("Sorcerer Spellcasting");
  const firstItem = page.locator("#builderWizardSpellsBody .builderSpellCheckItem").first();
  await expect(firstItem).toBeVisible();

  // The checkbox must render as a compact toggle, not stretched to the
  // text-field 36px min-height / full row width that caused the regression.
  const checkbox = firstItem.locator("input[type=checkbox]");
  const box = await checkbox.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(8);
  expect(box.width).toBeLessThanOrEqual(30);
  expect(box.height).toBeGreaterThan(8);
  expect(box.height).toBeLessThanOrEqual(30);

  // The checkbox toggles the selection (UI binding still wired).
  await checkbox.check();
  await expect(checkbox).toBeChecked();

  // Spell names are allowed to wrap instead of being truncated with an ellipsis.
  const nameWhiteSpace = await firstItem.locator("span").first().evaluate(
    (node) => getComputedStyle(node).whiteSpace
  );
  expect(nameWhiteSpace).not.toBe("nowrap");

  // The list stays usable and free of horizontal overflow at a narrow width.
  await page.setViewportSize({ width: 380, height: 900 });
  const narrowBox = await checkbox.boundingBox();
  expect(narrowBox).not.toBeNull();
  expect(narrowBox.width).toBeLessThanOrEqual(30);
  const overflow = await page.locator("#builderWizardSpellsBody").evaluate(
    (node) => node.scrollWidth - node.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await expectNoFatalSignals(page, fatalSignals);
});
