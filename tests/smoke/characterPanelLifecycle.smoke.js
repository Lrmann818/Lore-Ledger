import { expect, test } from "@playwright/test";
import {
  cycleCampaignShell,
  ensureActiveCharacter,
  expectNoFatalSignals,
  openSmokeApp,
  reopenCampaignFromHub,
  returnToHubFromSettings,
  submitPromptDialog
} from "./helpers/smokeApp.js";

const CAMPAIGN_NAME = "Character Lifecycle Smoke";

// The character page controller is initialized inside initTrackerPage(...) and
// destroyed with it whenever the campaign shell changes
// (destroyCampaignModules() -> initCampaignModules() in app.js). These tests
// drive that real lifecycle through the Hub instead of importing source
// modules into the page, so they run identically against the dev server and
// the built production bundle. The panel add controls and ability inputs live
// in the static index.html shell: a destroy() that leaked listeners would
// leave them double-bound after re-init, and the exact-count / exact-value
// assertions below would fail.

async function readActiveCharacterPanelState(page) {
  return page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const entries = Array.isArray(collection?.entries) ? collection.entries : [];
    const character = entries.find((entry) => entry?.id === collection?.activeId) || {};
    const attacks = Array.isArray(character.attacks) ? character.attacks : [];
    const resources = Array.isArray(character.resources) ? character.resources : [];
    return {
      attackCount: attacks.length,
      attackNames: attacks.map((attack) => attack?.name || ""),
      hpCur: character.hpCur ?? null,
      resourceCount: resources.length,
      firstResourceCur: resources[0]?.cur ?? null,
    };
  });
}

async function readActiveCharacterAbilitiesState(page) {
  return page.evaluate(() => {
    const collection = globalThis.__APP_STATE__?.characters;
    const entries = Array.isArray(collection?.entries) ? collection.entries : [];
    const character = entries.find((entry) => entry?.id === collection?.activeId) || {};
    const abilities = character.abilities || {};
    const skills = character.skills || {};
    const saveOptions = character.saveOptions || {};
    const saveMisc = saveOptions.misc || {};
    const str = abilities.str || {};
    const athletics = skills.athletics || {};

    return {
      strScore: str.score ?? null,
      strSaveProf: !!str.saveProf,
      strSaveMisc: saveMisc.str ?? null,
      athleticsLevel: athletics.level ?? null,
      athleticsMisc: athletics.misc ?? null,
      athleticsValue: athletics.value ?? null,
    };
  });
}

/**
 * While the app sits on the Hub the campaign modules are destroyed; poking a
 * static control must be a no-op. If a stale listener survived destroy() it
 * would either throw here (caught by the fatal-signal check) or stack with the
 * fresh listener after re-init (caught by the exact-count assertions).
 */
async function pokeStaticControlWhileDestroyed(page, elementId) {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el instanceof HTMLElement) el.click();
  }, elementId);
}

test("character panels stay safe after repeated character page init", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: CAMPAIGN_NAME });

  await ensureActiveCharacter(page);

  // Two full Hub round trips: the character page has now been initialized
  // three times against the same static DOM shell.
  await cycleCampaignShell(page, CAMPAIGN_NAME);
  await cycleCampaignShell(page, CAMPAIGN_NAME);
  await ensureActiveCharacter(page);

  const weaponsBefore = await page.locator("#attackList .attackRow").count();
  await page.locator("#addAttackBtn").click();
  await expect(page.locator("#attackList .attackRow")).toHaveCount(weaponsBefore + 1);

  // Add spell level now lives behind the Spells header ⋯ overflow menu. The
  // point of this case is unchanged: after three page inits the action must
  // still fire exactly once, so the menu must also still be bound exactly once.
  const spellLevelsBefore = await page.locator("#spellLevels .spellLevel").count();
  await page.locator("#spellsOptionsBtn").click();
  await page.locator("#addSpellLevelBtn").click();
  await submitPromptDialog(page, "Lifecycle Level");
  await expect(page.locator("#spellLevels .spellLevel")).toHaveCount(spellLevelsBefore + 1);

  const inventoryTabsBefore = await page.locator("#inventoryTabs .sessionTab").count();
  await page.locator("#addInventoryBtn").click();
  await submitPromptDialog(page, "Lifecycle Satchel");
  await expect(page.locator("#inventoryTabs .sessionTab")).toHaveCount(inventoryTabsBefore + 1);

  const resourceTilesBefore = await page.locator('#charVitalsTiles .charTile[data-vital-key^="res:"]').count();
  await page.locator("#addResourceBtn").click();
  await expect(page.locator('#charVitalsTiles .charTile[data-vital-key^="res:"]')).toHaveCount(resourceTilesBefore + 1);

  await expectNoFatalSignals(page, fatalSignals);
});

test("attack panel listeners are removed on destroy and rebound once on re-init", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: CAMPAIGN_NAME });

  await ensureActiveCharacter(page);

  await page.locator("#addAttackBtn").click();
  await expect(page.locator("#attackList .attackRow")).toHaveCount(1);
  await page.locator("#attackList .attackRow").first().locator(".attackName").fill("Shortsword");
  await expect.poll(() => readActiveCharacterPanelState(page).then((state) => state.attackNames[0])).toBe("Shortsword");

  await returnToHubFromSettings(page);
  await pokeStaticControlWhileDestroyed(page, "addAttackBtn");

  await reopenCampaignFromHub(page, CAMPAIGN_NAME);
  await ensureActiveCharacter(page);

  // The persisted attack renders exactly once and the Hub-time poke left no
  // trace behind.
  await expect(page.locator("#attackList .attackRow")).toHaveCount(1);
  await expect(page.locator("#attackList .attackRow").first().locator(".attackName")).toHaveValue("Shortsword");

  await page.locator("#attackList .attackRow").first().locator(".attackName").fill("Longbow");
  await expect.poll(() => readActiveCharacterPanelState(page).then((state) => state.attackNames)).toEqual(["Longbow"]);

  // New attacks are prepended; a double-bound add button would produce three
  // rows here instead of two.
  await page.locator("#addAttackBtn").click();
  await expect(page.locator("#attackList .attackRow")).toHaveCount(2);
  await expect.poll(() => readActiveCharacterPanelState(page).then((state) => state.attackNames)).toEqual(["", "Longbow"]);

  await expectNoFatalSignals(page, fatalSignals);
});

test("vitals panel listeners are removed on destroy and rebound once on re-init", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: CAMPAIGN_NAME });

  await ensureActiveCharacter(page);

  const resourceTiles = page.locator('#charVitalsTiles .charTile[data-vital-key^="res:"]');

  await page.locator("#charHpCur").fill("11");

  // The vitals panel seeds one blank resource row for a fresh character, so
  // count relative to whatever the first render produced. A double-bound add
  // button would jump by two.
  const resourcesBefore = (await readActiveCharacterPanelState(page)).resourceCount;
  const tilesBefore = await resourceTiles.count();
  await page.locator("#addResourceBtn").click();
  await expect(resourceTiles).toHaveCount(tilesBefore + 1);
  await page.locator('#charVitalsTiles .resourceTile input[placeholder="Cur"]').first().fill("2");

  await expect.poll(() => readActiveCharacterPanelState(page)).toMatchObject({
    hpCur: 11,
    resourceCount: resourcesBefore + 1,
    firstResourceCur: 2,
  });

  await returnToHubFromSettings(page);
  await pokeStaticControlWhileDestroyed(page, "addResourceBtn");

  await reopenCampaignFromHub(page, CAMPAIGN_NAME);
  await ensureActiveCharacter(page);

  // Persisted vitals render exactly once; the destroyed-time poke added
  // nothing.
  await expect(page.locator("#charHpCur")).toHaveValue("11");
  await expect(resourceTiles).toHaveCount(tilesBefore + 1);

  await page.locator("#charHpCur").fill("7");
  await page.locator('#charVitalsTiles .resourceTile input[placeholder="Cur"]').first().fill("5");
  await page.locator("#addResourceBtn").click();

  await expect.poll(() => readActiveCharacterPanelState(page)).toMatchObject({
    hpCur: 7,
    resourceCount: resourcesBefore + 2,
    firstResourceCur: 5,
  });
  await expect(resourceTiles).toHaveCount(tilesBefore + 2);

  await expectNoFatalSignals(page, fatalSignals);
});

test("abilities panel listeners are removed on destroy and rebound once on re-init", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: CAMPAIGN_NAME });

  await ensureActiveCharacter(page);
  await page.locator("#charProf").fill("2");

  const strBlock = page.locator('.abilityBlock[data-ability="str"]');
  const athleticsBtn = strBlock.locator(".skillProfBtn");

  // The skill-proficiency buttons and ability reorder controls are injected by
  // the abilities panel controller, exactly once per init.
  await expect(athleticsBtn).toHaveCount(1);
  await expect(strBlock.locator(".abilityMoves")).toHaveCount(1);
  await expect(strBlock.locator(".abilityMoves .moveBtn")).toHaveCount(2);

  await strBlock.locator(".abilityScore").fill("14");
  await strBlock.locator('[data-stat="saveProf"]').check();
  await page.locator("#saveOptionsBtn").click();
  await page.locator("#miscSave_str").fill("1");
  await page.keyboard.press("Escape");
  await expect(page.locator("#saveOptionsBtn")).toHaveAttribute("aria-expanded", "false");

  await athleticsBtn.click();
  const firstSkillMenu = page.locator(".skillProfMenu:not([hidden])").first();
  await expect(firstSkillMenu).toBeVisible();
  await firstSkillMenu.getByRole("checkbox", { name: "Proficient", exact: true }).check();

  await expect.poll(() => readActiveCharacterAbilitiesState(page)).toEqual({
    strScore: 14,
    strSaveProf: true,
    strSaveMisc: 1,
    athleticsLevel: "prof",
    athleticsMisc: 0,
    athleticsValue: 4,
  });

  await returnToHubFromSettings(page);

  // destroy() really ran: the injected controls are removed with the
  // controller while the app sits on the Hub.
  await expect(strBlock.locator(".skillProfBtn")).toHaveCount(0);
  await expect(strBlock.locator(".abilityMoves")).toHaveCount(0);

  await reopenCampaignFromHub(page, CAMPAIGN_NAME);
  await ensureActiveCharacter(page);

  // Rebuilt exactly once — a leaked previous init would duplicate them.
  await expect(athleticsBtn).toHaveCount(1);
  await expect(strBlock.locator(".abilityMoves")).toHaveCount(1);
  await expect(strBlock.locator(".abilityMoves .moveBtn")).toHaveCount(2);

  await page.locator("#charProf").fill("3");
  await strBlock.locator(".abilityScore").fill("16");
  await page.locator("#saveOptionsBtn").click();
  await page.locator("#miscSave_str").fill("2");
  await page.keyboard.press("Escape");
  await expect(page.locator("#saveOptionsBtn")).toHaveAttribute("aria-expanded", "false");

  await athleticsBtn.click();
  const secondSkillMenu = page.locator(".skillProfMenu:not([hidden])").first();
  await expect(secondSkillMenu).toBeVisible();
  await secondSkillMenu.getByRole("checkbox", { name: "Expert (double)", exact: true }).check();

  await expect.poll(() => readActiveCharacterAbilitiesState(page)).toEqual({
    strScore: 16,
    strSaveProf: true,
    strSaveMisc: 2,
    athleticsLevel: "expert",
    athleticsMisc: 0,
    athleticsValue: 9,
  });

  await expectNoFatalSignals(page, fatalSignals);
});
