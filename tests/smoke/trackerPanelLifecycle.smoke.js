import { expect, test } from "@playwright/test";
import { expectNoFatalSignals, openSmokeApp } from "./helpers/smokeApp.js";

async function reinitTrackerPageForLifecycleTest(page) {
  await page.evaluate(async () => {
    const load = (path) => import(`/CampaignTracker/${path}`);
    const [
      trackerPageMod,
      stateMod,
      saveManagerMod,
      popoversMod,
      factoriesMod,
      numberMod,
    ] = await Promise.all([
      load("js/pages/tracker/trackerPage.js"),
      load("js/state.js"),
      load("js/storage/saveManager.js"),
      load("js/ui/popovers.js"),
      load("js/domain/factories.js"),
      load("js/utils/number.js"),
    ]);

    globalThis.__trackerLifecycleHarness?.destroy?.();
    globalThis.__trackerLifecyclePromptCounter = 0;

    const testState = stateMod.migrateState(stateMod.sanitizeForSave(stateMod.state));
    testState.tracker.sessions = [{ title: "Session 1", notes: "" }];
    testState.tracker.activeSessionIndex = 0;
    testState.tracker.npcs = [];
    testState.tracker.npcSearch = "";
    testState.tracker.npcSections = [];
    testState.tracker.npcActiveSectionId = "";
    testState.tracker.party = [];
    testState.tracker.partySearch = "";
    testState.tracker.partySections = [];
    testState.tracker.partyActiveSectionId = "";
    testState.tracker.locationsList = [];
    testState.tracker.locSearch = "";
    testState.tracker.locFilter = "all";
    testState.tracker.locSections = [];
    testState.tracker.locActiveSectionId = "";

    const SaveManager = saveManagerMod.createSaveManager({
      saveAll: () => true,
      setStatus: () => {},
    });
    SaveManager.init();

    const Popovers = popoversMod.createPopoverManager({
      positionFn: () => {},
    });

    const controller = trackerPageMod.initTrackerPage({
      state: testState,
      SaveManager,
      Popovers,
      uiPrompt: async (_message, opts = {}) => {
        const next = ++globalThis.__trackerLifecyclePromptCounter;
        return `${opts.defaultValue || "Section"} ${next}`;
      },
      uiAlert: async () => {},
      uiConfirm: async () => true,
      setStatus: () => {},
      makeNpc: factoriesMod.makeNpc,
      makePartyMember: factoriesMod.makePartyMember,
      makeLocation: factoriesMod.makeLocation,
      enhanceNumberSteppers: async () => {},
      numberOrNull: numberMod.numberOrNull,
      pickCropStorePortrait: null,
      ImagePicker: null,
      deleteBlob: async () => true,
      putBlob: async () => true,
      cropImageModal: null,
      getPortraitAspect: () => 1,
      blobIdToObjectUrl: () => null,
      textKey_spellNotes: () => "spellNotes",
      putText: async () => {},
      getText: async () => "",
      deleteText: async () => {},
      autoSizeInput: () => {},
      applyTextareaSize: () => {},
    });

    globalThis.__trackerLifecycleHarness = {
      destroy() {
        try { controller?.destroy?.(); } catch { /* noop */ }
        try { Popovers?.destroy?.(); } catch { /* noop */ }
      },
    };
  });
}

test("tracker card panels stay single-bound after repeated tracker page init", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page);

  await reinitTrackerPageForLifecycleTest(page);
  await reinitTrackerPageForLifecycleTest(page);

  await page.locator("#addNpcBtn").click();
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);

  await page.locator("#addPartyBtn").click();
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(1);

  await page.locator("#addLocBtn").click();
  await expect(page.locator("#locCards .trackerCard")).toHaveCount(1);

  const npcTabsBefore = await page.locator("#npcTabs [role='tab']").count();
  await page.locator("#addNpcSectionBtn").click();
  await expect(page.locator("#npcTabs [role='tab']")).toHaveCount(npcTabsBefore + 1);

  const partyTabsBefore = await page.locator("#partyTabs [role='tab']").count();
  await page.locator("#addPartySectionBtn").click();
  await expect(page.locator("#partyTabs [role='tab']")).toHaveCount(partyTabsBefore + 1);

  const locTabsBefore = await page.locator("#locTabs [role='tab']").count();
  await page.locator("#addLocSectionBtn").click();
  await expect(page.locator("#locTabs [role='tab']")).toHaveCount(locTabsBefore + 1);

  await expectNoFatalSignals(page, fatalSignals);
});
