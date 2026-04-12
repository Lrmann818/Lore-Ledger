import { afterEach, describe, expect, it, vi } from "vitest";

import { CURRENT_SCHEMA_VERSION, migrateState, sanitizeForSave } from "../js/state.js";
import {
  createCampaignInVault,
  deleteCampaignFromVault,
  LEGACY_MIGRATION_CAMPAIGN_ID,
  normalizeCampaignVault,
  projectActiveCampaignState,
  renameCampaignInVault,
  wrapLegacyStateInVault
} from "../js/storage/campaignVault.js";
import { loadAll, saveAllLocal, switchCampaign } from "../js/storage/persistence.js";
import {
  legacyTextKey_spellNotes,
  migrateLegacySpellNotesToCampaignScope,
  textKey_spellNotes
} from "../js/storage/texts-idb.js";

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

function makeEnsureMapManager(state) {
  return vi.fn(() => {
    if (!state.map || typeof state.map !== "object") {
      state.map = { activeMapId: null, maps: [], undo: [], redo: [] };
    }
    if (!Array.isArray(state.map.maps)) state.map.maps = [];
    if (!state.map.ui || typeof state.map.ui !== "object") {
      state.map.ui = { activeTool: "brush", brushSize: 6 };
    }
    if (!state.map.maps.length) {
      state.map.maps.push({
        id: "map_default",
        name: "World Map",
        bgBlobId: null,
        drawingBlobId: null,
        brushSize: 6,
        colorKey: "grey"
      });
    }
    if (!state.map.activeMapId) state.map.activeMapId = state.map.maps[0].id;
  });
}

describe("multi-campaign persistence foundation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("migrates legacy single-campaign state into a one-campaign vault and mirrors the canonical campaign name", async () => {
    const legacyState = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      tracker: {
        campaignTitle: "Moonfall",
        misc: "Recovered misc"
      },
      character: {
        equipment: "50 ft rope"
      },
      map: {},
      ui: {
        theme: "light",
        textareaHeights: { trackerNotes: 88 },
        panelCollapsed: {}
      }
    };
    const { getStoredValue } = installLocalStorageMock(JSON.stringify(legacyState));
    const state = makeState();
    const vaultRuntime = { current: null };
    const ensureMapManager = makeEnsureMapManager(state);
    const markDirty = vi.fn();

    const ok = await loadAll({
      storageKey: "test-storage",
      state,
      migrateState,
      ensureMapManager,
      sanitizeForSave,
      dataUrlToBlob: vi.fn(),
      putBlob: vi.fn(),
      setStatus: vi.fn(),
      markDirty,
      vaultRuntime
    });

    expect(ok).toBe(true);
    expect(markDirty).toHaveBeenCalledTimes(1);
    expect(state.appShell.activeCampaignId).toEqual(expect.any(String));
    expect(state.tracker.campaignTitle).toBe("Moonfall");
    expect(state.character.inventoryItems[0].notes).toBe("50 ft rope");

    const activeCampaignId = state.appShell.activeCampaignId;
    expect(vaultRuntime.current.campaignIndex.order).toEqual([activeCampaignId]);
    expect(vaultRuntime.current.campaignIndex.entries[activeCampaignId].name).toBe("Moonfall");
    expect(vaultRuntime.current.campaignDocs[activeCampaignId].tracker.campaignTitle).toBe("Moonfall");

    const saveOk = saveAllLocal({
      storageKey: "test-storage",
      state,
      migrateState,
      sanitizeForSave,
      vaultRuntime
    });

    expect(saveOk).toBe(true);

    const stored = JSON.parse(getStoredValue());
    expect(stored.vaultVersion).toBe(1);
    expect(stored.app.preferences.playHubOpenSound).toBe(false);
    expect(stored.appShell.activeCampaignId).toBe(activeCampaignId);
    expect(stored.appShell.ui.theme).toBe("light");
    expect(stored.campaignIndex.entries[activeCampaignId]).toMatchObject({
      id: activeCampaignId,
      name: "Moonfall"
    });
    expect(stored.campaignDocs[activeCampaignId]).toMatchObject({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      tracker: expect.objectContaining({
        campaignTitle: "Moonfall",
        misc: "Recovered misc"
      })
    });
  });

  it("uses a stable campaign id when wrapping legacy single-campaign state", () => {
    const legacyState = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      tracker: { campaignTitle: "Moonfall" },
      character: {},
      map: {},
      ui: { theme: "light", textareaHeights: {}, panelCollapsed: {} }
    };

    const first = wrapLegacyStateInVault({
      legacyState,
      migrateState,
      sanitizeForSave,
      now: "2026-04-01T00:00:00.000Z"
    });
    const second = wrapLegacyStateInVault({
      legacyState,
      migrateState,
      sanitizeForSave,
      now: "2026-04-02T00:00:00.000Z"
    });

    expect(first.activeCampaignId).toBe(LEGACY_MIGRATION_CAMPAIGN_ID);
    expect(second.activeCampaignId).toBe(LEGACY_MIGRATION_CAMPAIGN_ID);
    expect(first.vault.campaignIndex.order).toEqual([LEGACY_MIGRATION_CAMPAIGN_ID]);
    expect(second.vault.campaignIndex.order).toEqual([LEGACY_MIGRATION_CAMPAIGN_ID]);
  });

  it("uses the canonical active campaign id from the vault and mirrors the index name back into tracker compatibility state", async () => {
    installLocalStorageMock(JSON.stringify({
      vaultVersion: 1,
      appShell: {
        activeCampaignId: "missing_campaign",
        ui: {
          theme: "dark",
          activeTab: "tracker",
          textareaHeights: {},
          panelCollapsed: {},
          calc: { memory: "4" }
        }
      },
      campaignIndex: {
        order: ["campaign_beta", "campaign_alpha"],
        entries: {
          campaign_alpha: {
            id: "campaign_alpha",
            name: "Alpha Canon",
            createdAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-01T00:00:00.000Z",
            lastOpenedAt: null
          },
          campaign_beta: {
            id: "campaign_beta",
            name: "Beta Canon",
            createdAt: "2026-04-02T00:00:00.000Z",
            updatedAt: "2026-04-02T00:00:00.000Z",
            lastOpenedAt: null
          }
        }
      },
      campaignDocs: {
        campaign_alpha: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          tracker: { campaignTitle: "Alpha Drifted", misc: "alpha" },
          character: {},
          map: {}
        },
        campaign_beta: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          tracker: { campaignTitle: "Beta Drifted", misc: "beta" },
          character: {},
          map: {}
        }
      }
    }));

    const state = makeState();
    const ensureMapManager = makeEnsureMapManager(state);
    const vaultRuntime = { current: null };

    const ok = await loadAll({
      storageKey: "test-storage",
      state,
      migrateState,
      ensureMapManager,
      sanitizeForSave,
      dataUrlToBlob: vi.fn(),
      putBlob: vi.fn(),
      setStatus: vi.fn(),
      markDirty: vi.fn(),
      vaultRuntime
    });

    expect(ok).toBe(true);
    expect(state.appShell.activeCampaignId).toBe("campaign_beta");
    expect(state.app.preferences.playHubOpenSound).toBe(false);
    expect(state.tracker.campaignTitle).toBe("Beta Canon");
    expect(state.tracker.misc).toBe("beta");
    expect(state.ui.theme).toBe("dark");
  });

  it("drops index-only corrupted campaigns instead of fabricating blank documents during vault normalization", () => {
    const { vault } = normalizeCampaignVault({
      vaultVersion: 1,
      appShell: {
        activeCampaignId: "campaign_broken",
        ui: { theme: "dark" }
      },
      campaignIndex: {
        order: ["campaign_broken", "campaign_valid"],
        entries: {
          campaign_broken: {
            id: "campaign_broken",
            name: "Broken Phantom",
            createdAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-01T00:00:00.000Z",
            lastOpenedAt: null
          },
          campaign_valid: {
            id: "campaign_valid",
            name: "Valid Canon",
            createdAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-01T00:00:00.000Z",
            lastOpenedAt: null
          }
        }
      },
      campaignDocs: {
        campaign_valid: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          tracker: { campaignTitle: "Valid Drifted", misc: "keep" },
          character: {},
          map: {}
        },
        campaign_doc_only: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          tracker: { campaignTitle: "Doc Only Canon", misc: "doc" },
          character: {},
          map: {}
        }
      }
    }, {
      migrateState,
      sanitizeForSave,
      now: "2026-04-08T00:00:00.000Z"
    });

    expect(vault.appShell.activeCampaignId).toBe("campaign_valid");
    expect(vault.app.preferences.playHubOpenSound).toBe(false);
    expect(vault.campaignIndex.order).toEqual(["campaign_valid", "campaign_doc_only"]);
    expect(vault.campaignIndex.entries.campaign_broken).toBeUndefined();
    expect(vault.campaignDocs.campaign_broken).toBeUndefined();
    expect(vault.campaignIndex.entries.campaign_doc_only.name).toBe("Doc Only Canon");
  });

  it("backfills combat defaults when normalizing old campaign documents", () => {
    const { vault } = normalizeCampaignVault({
      vaultVersion: 1,
      appShell: {
        activeCampaignId: "campaign_alpha",
        ui: { theme: "dark" }
      },
      campaignIndex: {
        order: ["campaign_alpha"],
        entries: {
          campaign_alpha: {
            id: "campaign_alpha",
            name: "Alpha",
            createdAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-01T00:00:00.000Z",
            lastOpenedAt: null
          }
        }
      },
      campaignDocs: {
        campaign_alpha: {
          schemaVersion: 2,
          tracker: { campaignTitle: "Alpha", misc: "old doc" },
          character: {},
          map: {}
        }
      }
    }, {
      migrateState,
      sanitizeForSave,
      now: "2026-04-08T00:00:00.000Z"
    });

    const projected = projectActiveCampaignState(vault, migrateState);

    expect(vault.campaignDocs.campaign_alpha.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(vault.campaignDocs.campaign_alpha.combat).toEqual({
      workspace: {
        panelOrder: [],
        embeddedPanels: [],
        panelCollapsed: {}
      },
      encounter: {
        id: null,
        createdAt: null,
        updatedAt: null,
        round: 1,
        activeParticipantId: null,
        elapsedSeconds: 0,
        secondsPerTurn: 6,
        participants: [],
        undoStack: []
      }
    });
    expect(projected.appShell.activeCampaignId).toBe("campaign_alpha");
    expect(projected.tracker.misc).toBe("old doc");
    expect(projected.combat).toEqual(vault.campaignDocs.campaign_alpha.combat);
  });

  it("isolates campaign documents by id and projects the selected campaign back into runtime state", () => {
    const { getStoredValue } = installLocalStorageMock();
    const state = makeState();
    const vaultRuntime = { current: null };

    state.appShell.activeCampaignId = "campaign_alpha";
    state.tracker.campaignTitle = "Alpha";
    state.tracker.misc = "alpha notes";
    state.combat.encounter.round = 2;
    state.combat.encounter.elapsedSeconds = 18;
    state.combat.workspace.embeddedPanels = ["vitals"];

    expect(saveAllLocal({
      storageKey: "test-storage",
      state,
      migrateState,
      sanitizeForSave,
      vaultRuntime
    })).toBe(true);

    state.appShell.activeCampaignId = "campaign_beta";
    state.tracker.campaignTitle = "Beta";
    state.tracker.misc = "beta notes";
    state.combat.encounter.round = 7;
    state.combat.encounter.elapsedSeconds = 144;
    state.combat.workspace.embeddedPanels = ["spells"];

    expect(saveAllLocal({
      storageKey: "test-storage",
      state,
      migrateState,
      sanitizeForSave,
      vaultRuntime
    })).toBe(true);

    expect(vaultRuntime.current.campaignIndex.order).toEqual(["campaign_alpha", "campaign_beta"]);
    expect(vaultRuntime.current.campaignDocs.campaign_alpha.tracker.misc).toBe("alpha notes");
    expect(vaultRuntime.current.campaignDocs.campaign_beta.tracker.misc).toBe("beta notes");
    expect(vaultRuntime.current.campaignDocs.campaign_alpha.combat.encounter.round).toBe(2);
    expect(vaultRuntime.current.campaignDocs.campaign_alpha.combat.encounter.elapsedSeconds).toBe(18);
    expect(vaultRuntime.current.campaignDocs.campaign_alpha.combat.workspace.embeddedPanels).toEqual(["vitals"]);
    expect(vaultRuntime.current.campaignDocs.campaign_beta.combat.encounter.round).toBe(7);
    expect(vaultRuntime.current.campaignDocs.campaign_beta.combat.encounter.elapsedSeconds).toBe(144);
    expect(vaultRuntime.current.campaignDocs.campaign_beta.combat.workspace.embeddedPanels).toEqual(["spells"]);

    switchCampaign({
      state,
      vaultRuntime,
      campaignId: "campaign_alpha",
      migrateState,
      sanitizeForSave
    });
    expect(state.appShell.activeCampaignId).toBe("campaign_alpha");
    expect(state.tracker.campaignTitle).toBe("Alpha");
    expect(state.tracker.misc).toBe("alpha notes");
    expect(state.combat.encounter.round).toBe(2);
    expect(state.combat.encounter.elapsedSeconds).toBe(18);
    expect(state.combat.workspace.embeddedPanels).toEqual(["vitals"]);

    switchCampaign({
      state,
      vaultRuntime,
      campaignId: "campaign_beta",
      migrateState,
      sanitizeForSave
    });
    expect(state.appShell.activeCampaignId).toBe("campaign_beta");
    expect(state.tracker.campaignTitle).toBe("Beta");
    expect(state.tracker.misc).toBe("beta notes");
    expect(state.combat.encounter.round).toBe(7);
    expect(state.combat.encounter.elapsedSeconds).toBe(144);
    expect(state.combat.workspace.embeddedPanels).toEqual(["spells"]);

    const stored = JSON.parse(getStoredValue());
    expect(stored.campaignDocs.campaign_alpha.tracker.misc).toBe("alpha notes");
    expect(stored.campaignDocs.campaign_beta.tracker.misc).toBe("beta notes");
    expect(stored.campaignDocs.campaign_alpha.combat.encounter.round).toBe(2);
    expect(stored.campaignDocs.campaign_beta.combat.encounter.round).toBe(7);
  });

  it("does not serialize scratch runtime campaign buckets when there is no active campaign", () => {
    const { getStoredValue } = installLocalStorageMock();
    const state = makeState();
    const vaultRuntime = { current: null };

    state.appShell.activeCampaignId = "campaign_saved";
    state.tracker.campaignTitle = "Saved Campaign";
    state.tracker.misc = "keep me";

    expect(saveAllLocal({
      storageKey: "test-storage",
      state,
      migrateState,
      sanitizeForSave,
      vaultRuntime
    })).toBe(true);

    state.appShell.activeCampaignId = null;
    state.tracker.campaignTitle = "Scratch Campaign";
    state.tracker.misc = "scratch only";
    state.ui.theme = "dark";
    state.app.preferences.playHubOpenSound = true;

    expect(saveAllLocal({
      storageKey: "test-storage",
      state,
      migrateState,
      sanitizeForSave,
      vaultRuntime
    })).toBe(true);

    const stored = JSON.parse(getStoredValue());
    expect(stored.appShell.activeCampaignId).toBeNull();
    expect(Object.keys(stored.campaignDocs)).toEqual(["campaign_saved"]);
    expect(stored.campaignDocs.campaign_saved.tracker.campaignTitle).toBe("Saved Campaign");
    expect(stored.campaignDocs.campaign_saved.tracker.misc).toBe("keep me");
    expect(stored.appShell.ui.theme).toBe("dark");
    expect(stored.app.preferences.playHubOpenSound).toBe(true);
  });

  it("keeps app preferences app-scoped when switching between campaigns", () => {
    installLocalStorageMock();
    const state = makeState();
    const vaultRuntime = { current: null };

    state.appShell.activeCampaignId = "campaign_alpha";
    state.tracker.campaignTitle = "Alpha";
    state.app.preferences.playHubOpenSound = true;

    expect(saveAllLocal({
      storageKey: "test-storage",
      state,
      migrateState,
      sanitizeForSave,
      vaultRuntime
    })).toBe(true);

    state.appShell.activeCampaignId = "campaign_beta";
    state.tracker.campaignTitle = "Beta";
    state.app.preferences.playHubOpenSound = false;

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

    expect(state.app.preferences.playHubOpenSound).toBe(false);
    expect(vaultRuntime.current.app.preferences.playHubOpenSound).toBe(false);
    expect(vaultRuntime.current.campaignDocs.campaign_alpha.app).toBeUndefined();
    expect(vaultRuntime.current.campaignDocs.campaign_beta.app).toBeUndefined();
  });

  it("creates a new campaign with canonical metadata and default document content", () => {
    const { vault } = normalizeCampaignVault(null, {
      migrateState,
      sanitizeForSave,
      now: "2026-04-08T00:00:00.000Z"
    });

    const created = createCampaignInVault(vault, {
      migrateState,
      sanitizeForSave,
      name: "  Moonfall  ",
      campaignId: "campaign_new",
      now: "2026-04-08T01:00:00.000Z"
    });

    expect(created.campaignId).toBe("campaign_new");
    expect(created.vault.campaignIndex.order).toEqual(["campaign_new"]);
    expect(created.vault.campaignIndex.entries.campaign_new).toMatchObject({
      id: "campaign_new",
      name: "Moonfall",
      createdAt: "2026-04-08T01:00:00.000Z",
      updatedAt: "2026-04-08T01:00:00.000Z",
      lastOpenedAt: null
    });
    expect(created.vault.campaignDocs.campaign_new.tracker.campaignTitle).toBe("Moonfall");
    expect(created.vault.campaignDocs.campaign_new.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(created.vault.campaignDocs.campaign_new.combat).toMatchObject({
      workspace: {
        panelOrder: [],
        embeddedPanels: [],
        panelCollapsed: {}
      },
      encounter: {
        round: 1,
        elapsedSeconds: 0,
        secondsPerTurn: 6,
        participants: [],
        undoStack: []
      }
    });
  });

  it("renames the canonical campaign metadata and mirrors the name into the stored campaign doc", () => {
    const created = createCampaignInVault(normalizeCampaignVault(null, {
      migrateState,
      sanitizeForSave,
      now: "2026-04-08T00:00:00.000Z"
    }).vault, {
      migrateState,
      sanitizeForSave,
      name: "Original Name",
      campaignId: "campaign_alpha",
      now: "2026-04-08T01:00:00.000Z"
    });

    const renamed = renameCampaignInVault(
      created.vault,
      "campaign_alpha",
      "  Final Name  ",
      { now: "2026-04-08T02:00:00.000Z" }
    );

    expect(renamed.campaignIndex.entries.campaign_alpha.name).toBe("Final Name");
    expect(renamed.campaignIndex.entries.campaign_alpha.updatedAt).toBe("2026-04-08T02:00:00.000Z");
    expect(renamed.campaignDocs.campaign_alpha.tracker.campaignTitle).toBe("Final Name");
  });

  it("deletes the active campaign cleanly back to a null-active hub projection", () => {
    const created = createCampaignInVault(normalizeCampaignVault(null, {
      migrateState,
      sanitizeForSave,
      now: "2026-04-08T00:00:00.000Z"
    }).vault, {
      migrateState,
      sanitizeForSave,
      name: "Moonfall",
      campaignId: "campaign_alpha",
      now: "2026-04-08T01:00:00.000Z"
    });

    created.vault.appShell.activeCampaignId = "campaign_alpha";

    const deleted = deleteCampaignFromVault(created.vault, "campaign_alpha");
    const projected = projectActiveCampaignState(deleted, migrateState);

    expect(deleted.appShell.activeCampaignId).toBeNull();
    expect(deleted.campaignIndex.order).toEqual([]);
    expect(deleted.campaignIndex.entries.campaign_alpha).toBeUndefined();
    expect(deleted.campaignDocs.campaign_alpha).toBeUndefined();
    expect(projected.appShell.activeCampaignId).toBeNull();
    expect(projected.tracker.campaignTitle).toBe("My Campaign");
  });

  it("scopes spell note keys by campaign id and migrates legacy notes without collisions", async () => {
    expect(textKey_spellNotes("campaign_alpha", "spell_fireball")).toBe("spell_notes_campaign_alpha__spell_fireball");
    expect(textKey_spellNotes("campaign_beta", "spell_fireball")).toBe("spell_notes_campaign_beta__spell_fireball");
    expect(textKey_spellNotes("campaign_alpha", "spell_fireball")).not.toBe(
      textKey_spellNotes("campaign_beta", "spell_fireball")
    );

    const textStore = new Map([
      [legacyTextKey_spellNotes("spell_fireball"), "Legacy fireball notes"],
      [textKey_spellNotes("campaign_beta", "spell_fireball"), "Beta fireball notes"]
    ]);

    const changed = await migrateLegacySpellNotesToCampaignScope(
      "campaign_alpha",
      ["spell_fireball", "spell_fireball"],
      {
        getTextRecord: async (id) => (
          textStore.has(id)
            ? { id, text: textStore.get(id), updatedAt: 0 }
            : null
        ),
        putText: async (text, id) => {
          textStore.set(id, String(text ?? ""));
          return id;
        },
        deleteText: async (id) => {
          textStore.delete(id);
        }
      }
    );

    expect(changed).toBe(true);
    expect(textStore.get(textKey_spellNotes("campaign_alpha", "spell_fireball"))).toBe("Legacy fireball notes");
    expect(textStore.get(textKey_spellNotes("campaign_beta", "spell_fireball"))).toBe("Beta fireball notes");
    expect(textStore.has(legacyTextKey_spellNotes("spell_fireball"))).toBe(false);
  });
});
