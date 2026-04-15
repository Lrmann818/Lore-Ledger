import { expect, test } from "@playwright/test";
import { ensureActiveCharacter, expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

async function reinitCharacterPageForLifecycleTest(page, characterOverrides = {}) {
  await page.evaluate(async (overrides) => {
    const load = (path) => import(new URL(path, window.location.href).href);
    const [
      characterPageMod,
      stateMod,
      saveManagerMod,
      popoversMod,
      characterHelpersMod,
    ] = await Promise.all([
      load("js/pages/character/characterPage.js"),
      load("js/state.js"),
      load("js/storage/saveManager.js"),
      load("js/ui/popovers.js"),
      load("js/domain/characterHelpers.js"),
    ]);

    globalThis.__characterLifecycleHarness?.destroy?.();
    globalThis.__characterLifecyclePromptCounter = 0;

    const testState = stateMod.migrateState(stateMod.sanitizeForSave(stateMod.state));
    const entry = {
      ...characterHelpersMod.makeDefaultCharacterEntry("Lifecycle Character"),
      id: "char_lifecycle_smoke",
      inventoryItems: [{ title: "Inventory", notes: "" }],
      activeInventoryIndex: 0,
      inventorySearch: "",
      spells: { levels: [] },
      resources: [{ id: "res_1", name: "Ki", cur: 1, max: 2 }],
      attacks: [],
      ...overrides,
    };
    testState.characters = {
      activeId: entry.id,
      entries: [entry],
    };

    const SaveManager = saveManagerMod.createSaveManager({
      saveAll: () => true,
      setStatus: () => {},
    });
    SaveManager.init();

    const Popovers = popoversMod.createPopoverManager({
      positionFn: () => {},
    });

    const controller = characterPageMod.initCharacterPageUI({
      state: testState,
      SaveManager,
      Popovers,
      uiPrompt: async (_message, opts = {}) => {
        const next = ++globalThis.__characterLifecyclePromptCounter;
        return `${opts.defaultValue || "Item"} ${next}`;
      },
      uiAlert: async () => {},
      uiConfirm: async () => true,
      setStatus: () => {},
      ImagePicker: null,
      pickCropStorePortrait: async () => undefined,
      deleteBlob: async () => true,
      putBlob: async () => true,
      cropImageModal: null,
      getPortraitAspect: () => 1,
      blobIdToObjectUrl: async () => null,
      autoSizeInput: () => {},
      enhanceNumberSteppers: () => {},
      applyTextareaSize: () => {},
      textKey_spellNotes: (spellId) => `spellNotes:${spellId}`,
      putText: async () => {},
      getText: async () => "",
      deleteText: async () => {},
    });

    globalThis.__characterLifecycleHarness = {
      state: testState,
      destroy() {
        try { controller?.destroy?.(); } catch { /* noop */ }
        try { Popovers?.destroy?.(); } catch { /* noop */ }
      },
    };
  }, characterOverrides);
}

async function destroyCharacterPageLifecycleHarness(page) {
  await page.evaluate(() => {
    globalThis.__characterLifecycleHarness?.destroy?.();
  });
}

async function readCharacterLifecycleState(page) {
  return page.evaluate(() => {
    const collection = globalThis.__characterLifecycleHarness?.state?.characters;
    const character = collection?.entries?.find((entry) => entry?.id === collection?.activeId) || {};
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

async function readCharacterAbilitiesLifecycleState(page) {
  return page.evaluate(() => {
    const collection = globalThis.__characterLifecycleHarness?.state?.characters;
    const character = collection?.entries?.find((entry) => entry?.id === collection?.activeId) || {};
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

test("character panels stay safe after repeated character page init", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  await ensureActiveCharacter(page);

  await reinitCharacterPageForLifecycleTest(page);
  await reinitCharacterPageForLifecycleTest(page);

  const weaponsBefore = await page.locator("#attackList .attackRow").count();
  await page.locator("#addAttackBtn").click();
  await expect(page.locator("#attackList .attackRow")).toHaveCount(weaponsBefore + 1);

  const spellLevelsBefore = await page.locator("#spellLevels .spellLevel").count();
  await page.locator("#addSpellLevelBtn").click();
  await expect(page.locator("#spellLevels .spellLevel")).toHaveCount(spellLevelsBefore + 1);

  const inventoryTabsBefore = await page.locator("#inventoryTabs .sessionTab").count();
  await page.locator("#addInventoryBtn").click();
  await expect(page.locator("#inventoryTabs .sessionTab")).toHaveCount(inventoryTabsBefore + 1);

  const resourceTilesBefore = await page.locator('#charVitalsTiles .charTile[data-vital-key^="res:"]').count();
  await page.locator("#addResourceBtn").click();
  await expect(page.locator('#charVitalsTiles .charTile[data-vital-key^="res:"]')).toHaveCount(resourceTilesBefore + 1);

  await expectNoFatalSignals(page, fatalSignals);
});

test("attack panel listeners are removed on destroy and rebound once on re-init", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  await ensureActiveCharacter(page);

  await reinitCharacterPageForLifecycleTest(page, {
    attacks: [{ id: "atk_seed", name: "Dagger", notes: "", bonus: "+5", damage: "1d4+3", range: "20/60", type: "Piercing" }]
  });

  const nameInput = page.locator("#attackList .attackRow").first().locator(".attackName");
  await nameInput.fill("Shortsword");
  await expect.poll(() => readCharacterLifecycleState(page).then((state) => state.attackNames[0])).toBe("Shortsword");

  await destroyCharacterPageLifecycleHarness(page);

  await nameInput.fill("Hammer");
  await page.locator("#addAttackBtn").click();

  await expect.poll(() => readCharacterLifecycleState(page)).toEqual({
    attackCount: 1,
    attackNames: ["Shortsword"],
    hpCur: null,
    resourceCount: 1,
    firstResourceCur: 1,
  });
  await expect(page.locator("#attackList .attackRow")).toHaveCount(1);

  await reinitCharacterPageForLifecycleTest(page, {
    attacks: [{ id: "atk_fresh", name: "Bow", notes: "", bonus: "+4", damage: "1d6+2", range: "80/320", type: "Piercing" }]
  });

  const freshNameInput = page.locator("#attackList .attackRow").first().locator(".attackName");
  await freshNameInput.fill("Longbow");
  await page.locator("#addAttackBtn").click();

  await expect.poll(() => readCharacterLifecycleState(page)).toEqual({
    attackCount: 2,
    attackNames: ["", "Longbow"],
    hpCur: null,
    resourceCount: 1,
    firstResourceCur: 1,
  });
  await expect(page.locator("#attackList .attackRow")).toHaveCount(2);

  await expectNoFatalSignals(page, fatalSignals);
});

test("vitals panel listeners are removed on destroy and rebound once on re-init", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  await ensureActiveCharacter(page);

  await reinitCharacterPageForLifecycleTest(page, {
    hpCur: 9,
    resources: [{ id: "res_seed", name: "Ki", cur: 1, max: 2 }]
  });

  const hpCurInput = page.locator("#charHpCur");
  await hpCurInput.fill("11");

  const resourceCurInput = page.locator('#charVitalsTiles .resourceTile input[placeholder="Cur"]').first();
  await resourceCurInput.fill("2");
  await page.locator("#addResourceBtn").click();

  await expect.poll(() => readCharacterLifecycleState(page)).toEqual({
    attackCount: 0,
    attackNames: [],
    hpCur: 11,
    resourceCount: 2,
    firstResourceCur: 2,
  });

  await destroyCharacterPageLifecycleHarness(page);

  await hpCurInput.fill("15");
  await resourceCurInput.fill("7");
  await page.locator("#addResourceBtn").click();

  await expect.poll(() => readCharacterLifecycleState(page)).toEqual({
    attackCount: 0,
    attackNames: [],
    hpCur: 11,
    resourceCount: 2,
    firstResourceCur: 2,
  });
  await expect(page.locator('#charVitalsTiles .charTile[data-vital-key^="res:"]')).toHaveCount(2);

  await reinitCharacterPageForLifecycleTest(page, {
    hpCur: 3,
    resources: [{ id: "res_fresh", name: "Rage", cur: 4, max: 6 }]
  });

  const freshHpCurInput = page.locator("#charHpCur");
  const freshResourceCurInput = page.locator('#charVitalsTiles .resourceTile input[placeholder="Cur"]').first();
  await freshHpCurInput.fill("7");
  await freshResourceCurInput.fill("5");
  await page.locator("#addResourceBtn").click();

  await expect.poll(() => readCharacterLifecycleState(page)).toEqual({
    attackCount: 0,
    attackNames: [],
    hpCur: 7,
    resourceCount: 2,
    firstResourceCur: 5,
  });
  await expect(page.locator('#charVitalsTiles .charTile[data-vital-key^="res:"]')).toHaveCount(2);

  await expectNoFatalSignals(page, fatalSignals);
});

test("abilities panel listeners are removed on destroy and rebound once on re-init", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  await ensureActiveCharacter(page);

  await reinitCharacterPageForLifecycleTest(page, {
    proficiency: 2,
    abilities: {
      str: { score: 10, saveProf: false },
    },
    skills: {
      athletics: { level: "none", misc: 0, value: 0 }
    },
    saveOptions: {
      misc: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      modToAll: ""
    }
  });

  const strBlock = page.locator('.abilityBlock[data-ability="str"]');
  const strScoreInput = strBlock.locator(".abilityScore");
  const strSaveProfInput = strBlock.locator('[data-stat="saveProf"]');
  const athleticsBtn = strBlock.locator(".skillProfBtn");

  await expect(athleticsBtn).toHaveCount(1);
  await expect(strBlock.locator(".abilityMoves")).toHaveCount(1);
  await expect(strBlock.locator(".abilityMoves .moveBtn")).toHaveCount(2);

  await strScoreInput.fill("14");
  await strSaveProfInput.check();
  await page.locator("#saveOptionsBtn").click();
  await page.locator("#miscSave_str").fill("1");
  await athleticsBtn.click();

  const firstSkillMenu = page.locator(".skillProfMenu:not([hidden])").first();
  await expect(firstSkillMenu).toBeVisible();
  await firstSkillMenu.getByRole("checkbox", { name: "Proficient", exact: true }).check();

  await expect.poll(() => readCharacterAbilitiesLifecycleState(page)).toEqual({
    strScore: 14,
    strSaveProf: true,
    strSaveMisc: 1,
    athleticsLevel: "prof",
    athleticsMisc: 0,
    athleticsValue: 4,
  });

  await destroyCharacterPageLifecycleHarness(page);

  await expect(strBlock.locator(".skillProfBtn")).toHaveCount(0);
  await expect(strBlock.locator(".abilityMoves")).toHaveCount(0);

  await strScoreInput.fill("8");
  await strSaveProfInput.uncheck();

  await expect.poll(() => readCharacterAbilitiesLifecycleState(page)).toEqual({
    strScore: 14,
    strSaveProf: true,
    strSaveMisc: 1,
    athleticsLevel: "prof",
    athleticsMisc: 0,
    athleticsValue: 4,
  });

  await reinitCharacterPageForLifecycleTest(page, {
    proficiency: 3,
    abilities: {
      str: { score: 10, saveProf: false },
    },
    skills: {
      athletics: { level: "none", misc: 0, value: 0 }
    },
    saveOptions: {
      misc: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      modToAll: ""
    }
  });

  const freshStrBlock = page.locator('.abilityBlock[data-ability="str"]');
  const freshStrScoreInput = freshStrBlock.locator(".abilityScore");
  const freshStrSaveProfInput = freshStrBlock.locator('[data-stat="saveProf"]');
  const freshAthleticsBtn = freshStrBlock.locator(".skillProfBtn");

  await expect(freshAthleticsBtn).toHaveCount(1);
  await expect(freshStrBlock.locator(".abilityMoves")).toHaveCount(1);
  await expect(freshStrBlock.locator(".abilityMoves .moveBtn")).toHaveCount(2);

  await freshStrScoreInput.fill("16");
  await freshStrSaveProfInput.check();
  await page.locator("#saveOptionsBtn").click();
  await page.locator("#miscSave_str").fill("2");
  await freshAthleticsBtn.click();

  const secondSkillMenu = page.locator(".skillProfMenu:not([hidden])").first();
  await expect(secondSkillMenu).toBeVisible();
  await secondSkillMenu.getByRole("checkbox", { name: "Expert (double)", exact: true }).check();

  await expect.poll(() => readCharacterAbilitiesLifecycleState(page)).toEqual({
    strScore: 16,
    strSaveProf: true,
    strSaveMisc: 2,
    athleticsLevel: "expert",
    athleticsMisc: 0,
    athleticsValue: 9,
  });

  await expectNoFatalSignals(page, fatalSignals);
});
