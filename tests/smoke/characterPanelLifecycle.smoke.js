import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

async function reinitCharacterPageForLifecycleTest(page) {
  await page.evaluate(async () => {
    const load = (path) => import(`/CampaignTracker/${path}`);
    const [
      characterPageMod,
      stateMod,
      saveManagerMod,
      popoversMod,
    ] = await Promise.all([
      load("js/pages/character/characterPage.js"),
      load("js/state.js"),
      load("js/storage/saveManager.js"),
      load("js/ui/popovers.js"),
    ]);

    globalThis.__characterLifecycleHarness?.destroy?.();
    globalThis.__characterLifecyclePromptCounter = 0;

    const testState = stateMod.migrateState(stateMod.sanitizeForSave(stateMod.state));
    testState.character = {
      ...testState.character,
      inventoryItems: [{ title: "Inventory", notes: "" }],
      activeInventoryIndex: 0,
      inventorySearch: "",
      spells: { levels: [] },
      resources: [{ id: "res_1", name: "Ki", cur: 1, max: 2 }],
      attacks: []
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
      destroy() {
        try { controller?.destroy?.(); } catch { /* noop */ }
        try { Popovers?.destroy?.(); } catch { /* noop */ }
      },
    };
  });
}

test("character panels stay safe after repeated character page init", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  await page.getByRole("tab", { name: "Character" }).click();
  await expect(page.getByRole("tab", { name: "Character" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#page-character")).toBeVisible();

  await reinitCharacterPageForLifecycleTest(page);
  await reinitCharacterPageForLifecycleTest(page);

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
