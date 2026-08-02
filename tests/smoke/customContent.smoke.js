import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp, waitForAppShell } from "./helpers/smokeApp.js";

// Custom content authoring (matrix #15): author a custom spell entirely
// through the Manage Custom Content form, verify inline validation keeps
// typed input, the saved record registers (list row + summary count),
// survives a full reload, and appears in the builder wizard's class spell
// picker via its classIds.

test("custom spell authored through the manager reaches the builder spell picker", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Custom Content Smoke" });

  // Author the spell: Data & Settings → Custom Content → Manage.
  await page.locator("#settingsBtn").click();
  await expect(page.locator("#dataPanelPanel")).toBeVisible();
  await page.locator("#dataCustomContentManageBtn").click();
  await expect(page.locator("#customContentPanel")).toBeVisible();
  await expect(page.locator("#customContentBody")).toContainText("no custom content yet");

  await page.getByRole("button", { name: "New Spell" }).click();
  await page.locator("#customContentInput-name").fill("Smoke Bolt");

  // Saving too early reports inline plain-language errors and keeps input.
  await page.getByRole("button", { name: "Save Spell" }).click();
  await expect(page.locator("#customContentError-school")).toBeVisible();
  await expect(page.locator("#customContentInput-name")).toHaveValue("Smoke Bolt");

  await page.locator("#customContentInput-level").selectOption("1");
  await page.locator("#customContentInput-school").selectOption("evocation");
  await page.locator("#customContentInput-range").fill("60 feet");
  await page.locator("#customContentInput-duration").fill("Instantaneous");
  await page.locator("#customContentInput-desc").fill("A bolt of thick smoke slams into one target.");
  await page.locator('#customContentBody [data-checklist="classIds"] input[value="wizard"]').check();
  await page.getByRole("button", { name: "Save Spell" }).click();

  await expect(page.locator("#customContentBody")).toContainText("spell:smoke-bolt");
  await expect(page.locator("#dataCustomContentSummary")).toContainText("1 custom record");

  await page.locator("#customContentClose").click();
  await expect(page.locator("#customContentPanel")).toBeHidden();
  await page.locator("#dataPanelClose").click();

  // Persistence: the record survives a full reload.
  await page.waitForTimeout(1500);
  await page.reload();
  await waitForAppShell(page);
  const customAfterReload = await page.evaluate(
    () => JSON.parse(JSON.stringify(globalThis.__APP_STATE__?.content?.custom ?? []))
  );
  expect(customAfterReload).toHaveLength(1);
  expect(customAfterReload[0]).toMatchObject({
    id: "smoke-bolt",
    kind: "spell",
    name: "Smoke Bolt",
    source: "custom",
    level: 1,
    classIds: ["wizard"]
  });

  // The authored spell shows up in the builder wizard's Wizard spell picker.
  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill("Smoke Caster");
  await page.locator("#builderWizardRace").selectOption("human");
  await page.locator("#builderWizardClass").selectOption("wizard");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click(); // → race & background choices
  await page.locator("#builderWizardNext").click(); // → classes & levels
  await page.locator("#builderWizardNext").click(); // → class choices
  await page.locator("#builderWizardNext").click(); // → abilities
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  const abilityValues = { Str: "8", Dex: "14", Con: "13", Int: "15", Wis: "12", Cha: "10" };
  for (const [suffix, value] of Object.entries(abilityValues)) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click(); // → spells (wizard is a caster)
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  await page.locator('input[aria-label="Filter Wizard spells"]').fill("Smoke Bolt");
  await expect(page.locator("#builderWizardStepSpells")).toContainText("Smoke Bolt");
  await page.locator("#builderWizardCancel").click();
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  await expectNoFatalSignals(page, fatalSignals);
});

// Integration checkpoint for matrix #15: author a full custom class (feature
// sub-record, resource pool, granted spell) through the form, build a
// character with it, Finish, and verify the seeded sheet (resource tile with
// the class-resource marker, rules-reference feature card, always-prepared
// grant), then edit the class in place and confirm everything survives a
// reload through the campaign-vault path.
test("custom class authored through the manager drives the builder end to end", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: "Custom Class Smoke" });

  // Author the class.
  await page.locator("#settingsBtn").click();
  await page.locator("#dataCustomContentManageBtn").click();
  await expect(page.locator("#customContentPanel")).toBeVisible();
  await page.getByRole("button", { name: "New Class" }).click();

  await page.locator("#customContentInput-name").fill("Runesmith");
  await page.locator("#customContentInput-hitDie").selectOption("10");
  await page.locator('#customContentBody [data-checklist="savingThrowProficiencies"] input[value="con"]').check();
  await page.locator('#customContentBody [data-checklist="savingThrowProficiencies"] input[value="int"]').check();
  await page.locator('#customContentBody [data-checklist="skillChoicesFrom"] input[value="arcana"]').check();
  await page.locator('#customContentBody [data-checklist="skillChoicesFrom"] input[value="history"]').check();

  await page.getByRole("button", { name: "+ Add feature" }).click();
  await page.locator(".featureLevel").fill("1");
  await page.locator(".featureName").fill("Runic Focus");
  await page.locator(".featureDesc").fill("You channel magic through carved runes.");

  await page.locator("#customContentInput-progression").selectOption("full");
  await page.locator("#customContentInput-spellAbility").selectOption("int");
  await page.locator("#customContentInput-preparationMode").selectOption("known");
  await page.locator("#customContentInput-spellsKnown").fill("2, 3, 4");

  await page.getByRole("button", { name: "+ Add resource pool" }).click();
  await page.locator(".resourceName").fill("Runes");
  await page.locator(".resourceMaxType").selectOption("byClassLevel");
  await page.locator(".resourceByLevel").fill("2, 2, 3");
  await page.locator(".resourceRecovery").selectOption("longRest");

  await page.getByRole("button", { name: "+ Add granted spell" }).click();
  await page.locator(".grantLevel").fill("1");
  await page.locator(".grantSpell").selectOption("cure-wounds");

  await page.getByRole("button", { name: "Save Class" }).click();
  await expect(page.locator("#customContentBody")).toContainText("class:runesmith");
  await expect(page.locator("#customContentBody")).toContainText("feature:runic-focus");
  await expect(page.locator("#dataCustomContentSummary")).toContainText("2 custom records");

  // Escape closes the manager (list view) but leaves the Data panel open.
  await page.keyboard.press("Escape");
  await expect(page.locator("#customContentPanel")).toBeHidden();
  await expect(page.locator("#dataPanelPanel")).toBeVisible();
  await page.locator("#dataPanelClose").click();

  // Build a character with the authored class.
  await page.getByRole("tab", { name: "Character" }).click();
  await page.locator("#charActionMenuBtn").click();
  await page.locator("#charActionNewBuilderBtn").click();
  await expect(page.locator("#builderWizardPanel")).toBeVisible();
  await page.locator("#builderWizardName").fill("Rune Tester");
  await page.locator("#builderWizardRace").selectOption("human");
  await page.locator("#builderWizardClass").selectOption("runesmith");
  await page.locator("#builderWizardBackground").selectOption("acolyte");
  await page.locator("#builderWizardNext").click(); // → race & background choices
  await page.locator("#builderWizardNext").click(); // → classes & levels
  await page.locator("#builderWizardNext").click(); // → class choices
  await page.locator("#builderWizardNext").click(); // → abilities
  await expect(page.locator("#builderWizardStepAbilities")).toBeVisible();
  const abilityValues = { Str: "10", Dex: "12", Con: "14", Int: "15", Wis: "10", Cha: "8" };
  for (const [suffix, value] of Object.entries(abilityValues)) {
    await page.locator(`#builderWizardAbility${suffix}`).fill(value);
  }
  await page.locator("#builderWizardNext").click(); // → spells (custom full caster)
  await expect(page.locator("#builderWizardStepSpells")).toBeVisible();
  await expect(page.locator("#builderWizardStepSpells")).toContainText("Runesmith Spellcasting");
  // The class-level granted spell is always prepared from level 1.
  await expect(page.locator("#builderWizardStepSpells")).toContainText("Cure Wounds");
  await page.locator("#builderWizardNext").click(); // → equipment
  await page.locator("#builderWizardNext").click(); // → summary
  await expect(page.locator("#builderWizardFinish")).toBeVisible();
  await page.locator("#builderWizardFinish").click();
  // R5-B2: the custom full caster's cantrip/known allowances are left unfilled,
  // so the first Finish is the inline under-cap acknowledgement.
  if (await page.locator("#builderWizardFinish").textContent() === "Finish Anyway") {
    await page.locator("#builderWizardFinish").click();
  }
  await expect(page.locator("#builderWizardPanel")).toBeHidden();

  // Finish seeded the class-resource pool with its marker, and the feature
  // renders as a rules-reference card.
  await expect.poll(async () => page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const character = collection?.entries?.find((entry) => entry?.id === collection?.activeId);
    return JSON.parse(JSON.stringify(character?.resources ?? []));
  })).toEqual(expect.arrayContaining([
    expect.objectContaining({
      name: "Runes",
      max: 2,
      cur: 2,
      recovery: "longRest",
      builderSeed: "class-resource:runes"
    })
  ]));
  await expect(page.getByText("Runic Focus").first()).toBeVisible();

  // Edit the class in place: the id stays stable, the name changes.
  await page.locator("#settingsBtn").click();
  await page.locator("#dataCustomContentManageBtn").click();
  const classRow = page.locator(".customContentRow", { hasText: "class:runesmith" });
  await classRow.getByRole("button", { name: /^Edit/ }).click();
  await expect(page.locator("#customContentInput-name")).toHaveValue("Runesmith");
  await page.locator("#customContentInput-name").fill("Runesmith Prime");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator("#customContentBody")).toContainText("Runesmith Prime");
  await expect(page.locator("#customContentBody")).toContainText("class:runesmith");
  await page.locator("#customContentClose").click();
  await page.locator("#dataPanelClose").click();

  // Everything survives a reload through the campaign vault.
  await page.waitForTimeout(1500);
  await page.reload();
  await waitForAppShell(page);
  const afterReload = await page.evaluate(() => {
    const state = globalThis.__APP_STATE__;
    const collection = state?.characters;
    const character = collection?.entries?.find((entry) => entry?.id === collection?.activeId);
    return JSON.parse(JSON.stringify({
      custom: state?.content?.custom ?? [],
      resources: character?.resources ?? [],
      buildLevels: character?.build?.levels ?? []
    }));
  });
  expect(afterReload.custom).toHaveLength(2);
  expect(afterReload.custom.find((record) => record.kind === "class")).toMatchObject({
    id: "runesmith",
    name: "Runesmith Prime"
  });
  expect(afterReload.buildLevels).toEqual([{ classId: "runesmith", hp: null }]);
  expect(afterReload.resources).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "Runes", builderSeed: "class-resource:runes" })
  ]));

  await expectNoFatalSignals(page, fatalSignals);
});
