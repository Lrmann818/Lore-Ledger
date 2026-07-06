// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_SCHEMA_VERSION, migrateState, sanitizeForSave } from "../js/state.js";
import { projectActiveCampaignState, normalizeCampaignVault } from "../js/storage/campaignVault.js";
import { saveAllLocal, switchCampaign } from "../js/storage/persistence.js";
import { createThemeManager } from "../js/ui/theme.js";
import { resolveThemeChoiceFromStoredData } from "../js/ui/themeState.js";

function makeState() {
  return migrateState(undefined);
}

function installLocalStorageMock(initialValue = null) {
  let stored = initialValue;
  const localStorageMock = {
    getItem: vi.fn((key) => (key ? stored : null)),
    setItem: vi.fn((key, value) => {
      if (!key) throw new Error("missing key");
      stored = String(value);
    }),
    removeItem: vi.fn((key) => {
      if (key) stored = null;
    })
  };

  vi.stubGlobal("localStorage", localStorageMock);

  return {
    localStorageMock,
    getStoredValue: () => stored
  };
}

function installMatchMedia({ prefersDark = false } = {}) {
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn(() => ({
      matches: prefersDark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    })),
    configurable: true
  });
}

describe("campaign theme resolution", () => {
  beforeEach(() => {
    installMatchMedia({ prefersDark: false });
    document.documentElement.dataset.theme = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.dataset.theme = "";
  });

  it("resolves boot-time theme from the active campaign before the app-shell fallback", () => {
    expect(resolveThemeChoiceFromStoredData({
      vaultVersion: 1,
      appShell: {
        activeCampaignId: "campaign_beta",
        ui: { theme: "red-gold" }
      },
      campaignIndex: {
        order: ["campaign_alpha", "campaign_beta"],
        entries: {
          campaign_alpha: { id: "campaign_alpha", name: "Campaign A" },
          campaign_beta: { id: "campaign_beta", name: "Campaign B" }
        }
      },
      campaignDocs: {
        campaign_alpha: {
          tracker: { campaignTitle: "Campaign A", ui: { theme: "red-gold" } }
        },
        campaign_beta: {
          tracker: { campaignTitle: "Campaign B", ui: { theme: "green" } }
        }
      }
    })).toBe("green");
  });

  it("reapplies the active campaign theme to the document every time campaigns switch", () => {
    installLocalStorageMock();
    const state = makeState();
    const vaultRuntime = { current: null };
    const themeManager = createThemeManager({ state });

    state.appShell.activeCampaignId = "campaign_alpha";
    state.tracker.campaignTitle = "Campaign A";
    themeManager.applyTheme("red-gold");
    expect(saveAllLocal({
      storageKey: "test-storage",
      state,
      migrateState,
      sanitizeForSave,
      vaultRuntime
    })).toBe(true);

    state.appShell.activeCampaignId = "campaign_beta";
    state.tracker.campaignTitle = "Campaign B";
    themeManager.applyTheme("green");
    expect(saveAllLocal({
      storageKey: "test-storage",
      state,
      migrateState,
      sanitizeForSave,
      vaultRuntime
    })).toBe(true);

    switchCampaign({
      state,
      vaultRuntime,
      campaignId: "campaign_alpha",
      migrateState,
      sanitizeForSave
    });
    themeManager.initFromState();

    expect(state.ui.theme).toBe("red-gold");
    expect(state.tracker.ui.theme).toBe("red-gold");
    expect(document.documentElement.dataset.theme).toBe("red-gold");

    switchCampaign({
      state,
      vaultRuntime,
      campaignId: "campaign_beta",
      migrateState,
      sanitizeForSave
    });
    themeManager.initFromState();

    expect(state.ui.theme).toBe("green");
    expect(state.tracker.ui.theme).toBe("green");
    expect(document.documentElement.dataset.theme).toBe("green");

    switchCampaign({
      state,
      vaultRuntime,
      campaignId: "campaign_alpha",
      migrateState,
      sanitizeForSave
    });
    themeManager.initFromState();

    expect(state.ui.theme).toBe("red-gold");
    expect(state.tracker.ui.theme).toBe("red-gold");
    expect(document.documentElement.dataset.theme).toBe("red-gold");
    expect(vaultRuntime.current.campaignDocs.campaign_alpha.tracker.ui.theme).toBe("red-gold");
    expect(vaultRuntime.current.campaignDocs.campaign_beta.tracker.ui.theme).toBe("green");
  });

  it("falls back safely when a multi-campaign save opens a campaign with a missing or invalid theme", () => {
    for (const rawTheme of [undefined, "not-a-theme"]) {
      const { vault } = normalizeCampaignVault({
        vaultVersion: 1,
        appShell: {
          activeCampaignId: "campaign_beta",
          ui: { theme: "red-gold" }
        },
        campaignIndex: {
          order: ["campaign_alpha", "campaign_beta"],
          entries: {
            campaign_alpha: {
              id: "campaign_alpha",
              name: "Campaign A",
              createdAt: "2026-05-01T00:00:00.000Z",
              updatedAt: "2026-05-01T00:00:00.000Z",
              lastOpenedAt: null
            },
            campaign_beta: {
              id: "campaign_beta",
              name: "Campaign B",
              createdAt: "2026-05-02T00:00:00.000Z",
              updatedAt: "2026-05-02T00:00:00.000Z",
              lastOpenedAt: null
            }
          }
        },
        campaignDocs: {
          campaign_alpha: {
            schemaVersion: CURRENT_SCHEMA_VERSION,
            tracker: { campaignTitle: "Campaign A", ui: { theme: "red-gold" } },
            character: {},
            map: {}
          },
          campaign_beta: {
            schemaVersion: CURRENT_SCHEMA_VERSION,
            tracker: rawTheme === undefined
              ? { campaignTitle: "Campaign B", ui: {} }
              : { campaignTitle: "Campaign B", ui: { theme: rawTheme } },
            character: {},
            map: {}
          }
        }
      }, {
        migrateState,
        sanitizeForSave,
        now: "2026-05-29T00:00:00.000Z"
      });

      const projected = projectActiveCampaignState(vault, migrateState);
      const themeManager = createThemeManager({ state: projected });
      themeManager.initFromState();

      expect(projected.ui.theme).toBe("system");
      expect(projected.tracker.ui.theme).toBe("system");
      expect(document.documentElement.dataset.theme).toBe("light");
    }
  });
});
