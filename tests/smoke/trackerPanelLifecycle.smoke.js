import { expect, test } from "@playwright/test";
import {
  cycleCampaignShell,
  expectNoFatalSignals,
  openSmokeApp,
  submitPromptDialog
} from "./helpers/smokeApp.js";

const CAMPAIGN_NAME = "Tracker Lifecycle Smoke";

// The tracker page controller is destroyed and re-created by the real app
// whenever the campaign shell changes (destroyCampaignModules() ->
// initCampaignModules() in app.js). Driving that lifecycle through the Hub
// exercises the same repeated-init path the old dev-only harness simulated by
// importing source modules into the page — but it works against the built
// production bundle too. The add controls below live in the static index.html
// shell, so a destroy() that leaks listeners would leave them double-bound and
// the exact-count assertions would see two cards/tabs per click.
test("tracker card panels stay single-bound after repeated tracker page init", async ({ page }) => {
  const fatalSignals = await openSmokeApp(page, { campaignName: CAMPAIGN_NAME });

  // Campaign creation ran the first init; each Hub round trip is a full
  // destroy + re-init, so the static buttons have been (re)bound three times.
  await cycleCampaignShell(page, CAMPAIGN_NAME);
  await cycleCampaignShell(page, CAMPAIGN_NAME);

  await page.locator("#addNpcBtn").click();
  await expect(page.locator("#npcCards .trackerCard")).toHaveCount(1);

  await page.locator("#addPartyBtn").click();
  await expect(page.locator("#partyCards .trackerCard")).toHaveCount(1);

  await page.locator("#addLocBtn").click();
  await expect(page.locator("#locCards .trackerCard")).toHaveCount(1);

  const npcTabsBefore = await page.locator("#npcTabs [role='tab']").count();
  await page.locator("#addNpcSectionBtn").click();
  await submitPromptDialog(page, "Lifecycle NPC Section");
  await expect(page.locator("#npcTabs [role='tab']")).toHaveCount(npcTabsBefore + 1);

  const partyTabsBefore = await page.locator("#partyTabs [role='tab']").count();
  await page.locator("#addPartySectionBtn").click();
  await submitPromptDialog(page, "Lifecycle Party Section");
  await expect(page.locator("#partyTabs [role='tab']")).toHaveCount(partyTabsBefore + 1);

  const locTabsBefore = await page.locator("#locTabs [role='tab']").count();
  await page.locator("#addLocSectionBtn").click();
  await submitPromptDialog(page, "Lifecycle Location Section");
  await expect(page.locator("#locTabs [role='tab']")).toHaveCount(locTabsBefore + 1);

  await expectNoFatalSignals(page, fatalSignals);
});
