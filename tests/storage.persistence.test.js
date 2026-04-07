import { afterEach, describe, expect, it, vi } from "vitest";

import { CURRENT_SCHEMA_VERSION, migrateState, sanitizeForSave } from "../js/state.js";
import { loadAll, saveAllLocal } from "../js/storage/persistence.js";

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

describe("saveAllLocal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("persists the sanitized state shape without runtime-only fields and does not mutate live state", () => {
    const { getStoredValue, localStorageMock } = installLocalStorageMock();
    const state = makeState();

    state.map.undo = ["old undo"];
    state.map.redo = ["old redo"];
    state.ui.dice = {
      history: [{ text: "1d20", t: 1 }],
      last: { count: 2, sides: 20, mod: 3, mode: "adv" }
    };
    state.ui.calc = {
      history: ["2+2"],
      memory: "4"
    };

    const ok = saveAllLocal({
      storageKey: "test-storage",
      state,
      currentSchemaVersion: CURRENT_SCHEMA_VERSION,
      sanitizeForSave
    });

    expect(ok).toBe(true);
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);

    const saved = JSON.parse(getStoredValue());
    expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(saved.map.undo).toBeUndefined();
    expect(saved.map.redo).toBeUndefined();
    expect(saved.ui.dice).toBeUndefined();
    expect(saved.ui.calc).toEqual({ memory: "4" });
    expect(state.map.undo).toEqual(["old undo"]);
    expect(state.map.redo).toEqual(["old redo"]);
    expect(state.ui.dice).toEqual({
      history: [{ text: "1d20", t: 1 }],
      last: { count: 2, sides: 20, mod: 3, mode: "adv" }
    });
    expect(state.ui.calc).toEqual({
      history: ["2+2"],
      memory: "4"
    });
  });

  it("returns false when localStorage throws", () => {
    const { localStorageMock } = installLocalStorageMock();
    localStorageMock.setItem.mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const ok = saveAllLocal({
      storageKey: "test-storage",
      state: makeState(),
      sanitizeForSave
    });

    expect(ok).toBe(false);
  });

  it("canonicalizes drifted hitDieAmount into hitDieAmt before persisting", () => {
    const { getStoredValue } = installLocalStorageMock();
    const state = makeState();

    delete state.character.hitDieAmt;
    state.character.hitDieAmount = 7;

    const ok = saveAllLocal({
      storageKey: "test-storage",
      state,
      currentSchemaVersion: CURRENT_SCHEMA_VERSION,
      sanitizeForSave
    });

    expect(ok).toBe(true);

    const saved = JSON.parse(getStoredValue());
    expect(saved.character.hitDieAmt).toBe(7);
    expect("hitDieAmount" in saved.character).toBe(false);

    expect("hitDieAmt" in state.character).toBe(false);
    expect(state.character.hitDieAmount).toBe(7);
  });

});

describe("loadAll", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns false without touching state when there is no stored payload", async () => {
    installLocalStorageMock(null);

    const state = makeState();
    state.tracker.campaignTitle = "Before load";

    const migrateStateMock = vi.fn();
    const ensureMapManager = makeEnsureMapManager(state);
    const setStatus = vi.fn();
    const markDirty = vi.fn();

    const ok = await loadAll({
      storageKey: "test-storage",
      state,
      migrateState: migrateStateMock,
      ensureMapManager,
      dataUrlToBlob: vi.fn(),
      putBlob: vi.fn(),
      setStatus,
      markDirty
    });

    expect(ok).toBe(false);
    expect(state.tracker.campaignTitle).toBe("Before load");
    expect(migrateStateMock).not.toHaveBeenCalled();
    expect(ensureMapManager).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();
  });

  it("clones migrated state, folds legacy map fields, and marks dirty for rewrite", async () => {
    installLocalStorageMock("{\"saved\":true}");

    const state = makeState();
    const migrated = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      tracker: {
        campaignTitle: "Loaded Campaign",
        sessions: [{ title: "Session 4", notes: "Recovered notes" }],
        sessionSearch: "",
        activeSessionIndex: 0,
        npcs: [{ name: "Miri", imgDataUrl: "data:image/png;base64,QQ==" }],
        npcActiveGroup: "friendly",
        npcSearch: "",
        party: [{ name: "Arlen", imgDataUrl: "data:image/jpeg;base64,QQ==" }],
        partySearch: "",
        locationsList: [{ title: "Harbor", imgDataUrl: "data:image/webp;base64,QQ==", imgBlobId: "keep-blob" }],
        locSearch: "",
        locFilter: "all",
        misc: "",
        ui: { textareaHeigts: { sessionNotes: 91 } }
      },
      character: makeState().character,
      map: {
        activeMapId: null,
        maps: [],
        undo: ["stale undo"],
        redo: ["stale redo"],
        bgDataUrl: "data:image/png;base64,QQ==",
        drawingBlobId: "legacy-drawing-blob",
        brushSize: 13,
        colorKey: "forest"
      },
      ui: {
        theme: "light",
        textareaHeights: {},
        panelCollapsed: {},
        dice: { history: ["stale"], last: { count: 7, sides: 20, mod: 1, mode: "adv" } },
        calc: { history: ["2+2"] }
      }
    };

    const migrateStateMock = vi.fn(() => migrated);
    const ensureMapManager = vi.fn(() => {
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
          brushSize: null,
          colorKey: ""
        });
        state.map.activeMapId = "map_default";
      }
    });

    let nextBlobId = 1;
    const dataUrlToBlob = vi.fn((dataUrl) => ({ dataUrl }));
    const putBlob = vi.fn(async () => `blob_${nextBlobId++}`);
    const setStatus = vi.fn();
    const markDirty = vi.fn();

    const ok = await loadAll({
      storageKey: "test-storage",
      state,
      migrateState: migrateStateMock,
      ensureMapManager,
      dataUrlToBlob,
      putBlob,
      setStatus,
      markDirty
    });

    expect(ok).toBe(true);
    expect(migrateStateMock).toHaveBeenCalledWith({ saved: true });
    expect(ensureMapManager).toHaveBeenCalledTimes(1);
    expect(markDirty).toHaveBeenCalledTimes(1);
    expect(setStatus).not.toHaveBeenCalled();

    expect(state.tracker).not.toBe(migrated.tracker);
    expect(state.map).not.toBe(migrated.map);
    state.tracker.campaignTitle = "Mutated after load";
    state.tracker.npcs[0].name = "Changed NPC";
    state.map.maps[0].name = "Changed map";
    expect(migrated.tracker.campaignTitle).toBe("Loaded Campaign");
    expect(migrated.tracker.npcs[0].name).toBe("Miri");
    expect(migrated.map.maps).toEqual([]);

    expect(state.map.undo).toEqual([]);
    expect(state.map.redo).toEqual([]);
    expect(state.tracker.ui.textareaHeights).toEqual({ sessionNotes: 91 });

    expect(dataUrlToBlob).toHaveBeenCalledTimes(3);
    expect(putBlob).toHaveBeenCalledTimes(3);
    expect(state.tracker.npcs[0]).toMatchObject({ imgBlobId: "blob_1" });
    expect("imgDataUrl" in state.tracker.npcs[0]).toBe(false);
    expect(state.tracker.party[0]).toMatchObject({ imgBlobId: "blob_2" });
    expect(state.tracker.locationsList[0].imgBlobId).toBe("keep-blob");

    expect(state.map.maps[0]).toMatchObject({
      bgBlobId: "blob_3",
      drawingBlobId: "legacy-drawing-blob",
      brushSize: 13,
      colorKey: "forest"
    });
    expect("bgDataUrl" in state.map).toBe(false);
    expect("drawingBlobId" in state.map).toBe(false);
    expect("brushSize" in state.map).toBe(false);
    expect("colorKey" in state.map).toBe(false);
  });

  it("repairs partial current-schema payloads and replaces stale buckets instead of merging them", async () => {
    installLocalStorageMock(JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      tracker: {
        campaignTitle: "Loaded Campaign"
      },
      ui: {
        theme: "light"
      }
    }));

    const state = makeState();
    state.tracker.npcs = [{ name: "Stale NPC" }];
    state.character.inventoryItems = [{ title: "Stale", notes: "Should not survive" }];
    state.ui.panelCollapsed = { tracker: true };

    const ensureMapManager = makeEnsureMapManager(state);
    const markDirty = vi.fn();
    const setStatus = vi.fn();

    const ok = await loadAll({
      storageKey: "test-storage",
      state,
      migrateState,
      ensureMapManager,
      dataUrlToBlob: vi.fn(),
      putBlob: vi.fn(),
      setStatus,
      markDirty
    });

    expect(ok).toBe(true);
    expect(markDirty).toHaveBeenCalledTimes(1);
    expect(setStatus).not.toHaveBeenCalled();
    expect(state.tracker.campaignTitle).toBe("Loaded Campaign");
    expect(state.tracker.sessions).toEqual([{ title: "Session 1", notes: "" }]);
    expect(state.tracker.npcs).toEqual([]);
    expect(state.character.inventoryItems).toEqual([{ title: "Inventory", notes: "" }]);
    expect(state.ui.theme).toBe("light");
    expect(state.ui.panelCollapsed).toEqual({});
    expect(state.map.maps).toHaveLength(1);
    expect(state.map.activeMapId).toBe("map_default");
  });

  it("safely normalizes malformed array buckets before the state is rewritten", async () => {
    installLocalStorageMock(JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      tracker: [],
      character: [],
      map: [],
      ui: []
    }));

    const state = makeState();
    const ensureMapManager = makeEnsureMapManager(state);
    const markDirty = vi.fn();
    const setStatus = vi.fn();

    const ok = await loadAll({
      storageKey: "test-storage",
      state,
      migrateState,
      ensureMapManager,
      dataUrlToBlob: vi.fn(),
      putBlob: vi.fn(),
      setStatus,
      markDirty
    });

    expect(ok).toBe(true);
    expect(markDirty).toHaveBeenCalledTimes(1);
    expect(setStatus).not.toHaveBeenCalled();
    expect(Array.isArray(state.tracker)).toBe(false);
    expect(Array.isArray(state.character)).toBe(false);
    expect(Array.isArray(state.map)).toBe(false);
    expect(Array.isArray(state.ui)).toBe(false);
    expect(state.tracker.sessions).toEqual([{ title: "Session 1", notes: "" }]);
    expect(state.character.inventoryItems).toEqual([{ title: "Inventory", notes: "" }]);
    expect(state.map.maps).toHaveLength(1);
    expect(state.ui.theme).toBe("system");
  });

  it("returns false and leaves state alone when storage payload is corrupt", async () => {
    installLocalStorageMock("{ definitely not json }");

    const state = makeState();
    state.tracker.campaignTitle = "Before load";

    const setStatus = vi.fn();
    const markDirty = vi.fn();

    const ok = await loadAll({
      storageKey: "test-storage",
      state,
      migrateState: vi.fn(),
      ensureMapManager: vi.fn(),
      dataUrlToBlob: vi.fn(),
      putBlob: vi.fn(),
      setStatus,
      markDirty
    });

    expect(ok).toBe(false);
    expect(state.tracker.campaignTitle).toBe("Before load");
    expect(setStatus).toHaveBeenCalledWith("Loaded with issues. Consider exporting a backup.");
    expect(markDirty).not.toHaveBeenCalled();
  });

  it("round-trips a representative current saved shape through save and load", async () => {
    const { getStoredValue } = installLocalStorageMock();

    const sourceState = makeState();
    sourceState.tracker.campaignTitle = "Moonfall";
    sourceState.tracker.sessions = [
      { title: "Session 1", notes: "Camped near the ruins." },
      { title: "Session 2", notes: "Entered the lower vault." }
    ];
    sourceState.tracker.sessionSearch = "vault";
    sourceState.tracker.activeSessionIndex = 1;
    sourceState.tracker.npcs = [{ name: "Miri", imgBlobId: "blob_npc_1" }];
    sourceState.tracker.party = [{ name: "Arlen", imgBlobId: null }];
    sourceState.tracker.locationsList = [{ title: "Old Keep", imgBlobId: "blob_loc_1" }];
    sourceState.tracker.misc = "Watch the eastern road.";
    sourceState.tracker.ui.textareaHeights = { sessionNotes: 116 };

    sourceState.character.name = "Tamsin Vale";
    sourceState.character.classLevel = "Fighter 5";
    sourceState.character.race = "Human";
    sourceState.character.hpCur = 26;
    sourceState.character.hpMax = 34;
    sourceState.character.hitDieAmt = 3;
    sourceState.character.hitDieSize = 10;
    sourceState.character.ac = 17;
    sourceState.character.speed = 30;
    sourceState.character.proficiency = 3;
    sourceState.character.resources = [{ id: "res_second_wind", name: "Second Wind", cur: 1, max: 1 }];
    sourceState.character.attacks = [{ id: "atk_1", name: "Longsword", bonus: "+6", damage: "1d8+4" }];
    sourceState.character.inventoryItems = [
      { title: "Inventory", notes: "50 ft. rope" },
      { title: "Pack", notes: "Torches x5" }
    ];
    sourceState.character.activeInventoryIndex = 1;
    sourceState.character.inventorySearch = "torch";
    sourceState.character.equipment = "Explorer's pack";
    sourceState.character.spells = {
      levels: [{
        id: "spell_level_cantrips",
        label: "Cantrips",
        hasSlots: false,
        used: null,
        total: null,
        collapsed: false,
        spells: [{
          id: "spell_light",
          name: "Light",
          notesCollapsed: true,
          known: true,
          prepared: false,
          expended: false
        }]
      }]
    };

    sourceState.map.activeMapId = "map_ruins";
    sourceState.map.maps = [{
      id: "map_ruins",
      name: "Ruined Keep",
      bgBlobId: "blob_bg_1",
      drawingBlobId: "blob_draw_1",
      brushSize: 11,
      colorKey: "forest"
    }];
    sourceState.map.ui = { activeTool: "eraser", brushSize: 11, viewScale: 1.25 };
    sourceState.map.undo = ["runtime-only undo"];
    sourceState.map.redo = ["runtime-only redo"];

    sourceState.ui.theme = "light";
    sourceState.ui.textareaHeights = { characterNotes: 88 };
    sourceState.ui.panelCollapsed = { trackerMisc: true };
    sourceState.ui.dice = {
      history: [{ text: "1d20+6", t: 100 }],
      last: { count: 2, sides: 20, mod: 6, mode: "adv" }
    };
    sourceState.ui.calc = {
      history: ["2+2"],
      memory: "17"
    };

    const expectedPersisted = sanitizeForSave(structuredClone(sourceState), {
      currentSchemaVersion: CURRENT_SCHEMA_VERSION
    });

    const saveOk = saveAllLocal({
      storageKey: "test-storage",
      state: sourceState,
      currentSchemaVersion: CURRENT_SCHEMA_VERSION,
      sanitizeForSave
    });

    expect(saveOk).toBe(true);

    const storedRaw = getStoredValue();
    const storedParsed = JSON.parse(storedRaw);
    expect(storedParsed).toEqual(expectedPersisted);
    expect(storedParsed.character.hitDieAmt).toBe(3);
    expect("hitDieAmount" in storedParsed.character).toBe(false);

    const loadedState = makeState();
    loadedState.tracker.campaignTitle = "Stale campaign";
    loadedState.character.inventoryItems = [{ title: "Stale", notes: "Should be replaced" }];
    loadedState.map.maps = [];

    const setStatus = vi.fn();
    const markDirty = vi.fn();
    const ensureMapManager = makeEnsureMapManager(loadedState);

    const loadOk = await loadAll({
      storageKey: "test-storage",
      state: loadedState,
      migrateState,
      ensureMapManager,
      dataUrlToBlob: vi.fn(),
      putBlob: vi.fn(),
      setStatus,
      markDirty
    });

    expect(loadOk).toBe(true);
    expect(setStatus).not.toHaveBeenCalled();
    expect(markDirty).toHaveBeenCalledTimes(1);
    expect(loadedState.map.undo).toEqual([]);
    expect(loadedState.map.redo).toEqual([]);
    expect(loadedState.ui.dice.history).toEqual([]);
    expect(loadedState.ui.calc.history).toEqual([]);
    expect(sanitizeForSave(loadedState)).toEqual(expectedPersisted);
  });
});
