import { afterEach, describe, expect, it, vi } from "vitest";

import { pickAndStorePortrait } from "../js/pages/tracker/panels/cards/shared/cardPortraitShared.js";
import { deleteTrackerCardWithBlobCleanup } from "../js/pages/tracker/panels/cards/shared/cardDeletionShared.js";
import { createStateActions } from "../js/domain/stateActions.js";
import { installStateMutationGuard } from "../js/utils/dev.js";
import { createMapBackgroundActions } from "../js/pages/map/mapBackgroundActions.js";
import { persistDrawingSnapshot } from "../js/pages/map/mapPersistence.js";
import { deleteMapWithBlobCleanup } from "../js/pages/map/mapListUI.js";

function makeSaveManager({
  flush = vi.fn(async () => true),
  reportError = vi.fn()
} = {}) {
  return {
    markDirty: vi.fn(),
    flush,
    reportError
  };
}

function waitForAsyncWork() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function makeGuardedTrackerState(overrides = {}) {
  const rawState = {
    tracker: {
      npcs: [],
      party: [],
      locationsList: [],
      ...overrides.tracker
    },
    character: {
      ...overrides.character
    },
    map: {
      ...overrides.map
    },
    ...overrides
  };
  return installStateMutationGuard(rawState, { mode: "throw" }).state;
}

function makeMapState(overrides = {}) {
  return {
    maps: [],
    activeMapId: null,
    ui: {
      brushSize: 6,
      activeTool: "brush",
      ...overrides.ui
    },
    ...overrides
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("asset replacement flows", () => {
  it("updates tracker portraits through state actions and persists the replacement", async () => {
    const state = makeGuardedTrackerState({
      tracker: {
        npcs: [{ id: "npc-1", imgBlobId: "old-portrait" }]
      }
    });
    const saveManager = makeSaveManager({
      flush: vi.fn(async () => true)
    });
    const deleteBlob = vi.fn(async () => {});
    const actions = createStateActions({ state, SaveManager: saveManager });

    const ok = await pickAndStorePortrait({
      itemId: "npc-1",
      getItemById: (id) => state.tracker.npcs.find((npc) => npc.id === id) || null,
      getBlobId: (npc) => npc.imgBlobId,
      setBlobId: (_npc, blobId) => actions.updateTrackerCardField("npc", "npc-1", "imgBlobId", blobId, { queueSave: false }),
      deps: {
        pickCropStorePortrait: vi.fn(async () => new Blob(["portrait"], { type: "image/webp" })),
        ImagePicker: {},
        cropImageModal: vi.fn(),
        getPortraitAspect: vi.fn(),
        deleteBlob,
        putBlob: vi.fn(async () => "new-portrait"),
        SaveManager: saveManager,
        uiAlert: vi.fn(async () => {}),
      },
      setStatus: vi.fn(),
    });

    expect(ok).toBe(true);
    expect(state.tracker.npcs[0].imgBlobId).toBe("new-portrait");
    expect(saveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(saveManager.flush).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledWith("old-portrait");
  });

  it("keeps the old tracker portrait when the replacement flush fails", async () => {
    const state = makeGuardedTrackerState({
      tracker: {
        npcs: [{ id: "npc-1", imgBlobId: "old-portrait" }]
      }
    });
    const saveManager = makeSaveManager({
      flush: vi.fn(async () => false)
    });
    const deleteBlob = vi.fn(async () => {});
    const uiAlert = vi.fn(async () => {});
    const setStatus = vi.fn();
    const actions = createStateActions({ state, SaveManager: saveManager });

    const ok = await pickAndStorePortrait({
      itemId: "npc-1",
      getItemById: (id) => state.tracker.npcs.find((npc) => npc.id === id) || null,
      getBlobId: (npc) => npc.imgBlobId,
      setBlobId: (_npc, blobId) => actions.updateTrackerCardField("npc", "npc-1", "imgBlobId", blobId, { queueSave: false }),
      deps: {
        pickCropStorePortrait: vi.fn(async () => new Blob(["portrait"], { type: "image/webp" })),
        ImagePicker: {},
        cropImageModal: vi.fn(),
        getPortraitAspect: vi.fn(),
        deleteBlob,
        putBlob: vi.fn(async () => "new-portrait"),
        SaveManager: saveManager,
        uiAlert,
      },
      setStatus,
    });

    expect(ok).toBe(false);
    expect(state.tracker.npcs[0].imgBlobId).toBe("old-portrait");
    expect(saveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(saveManager.flush).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledWith("new-portrait");
    expect(uiAlert).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenLastCalledWith("Could not save image. Consider exporting a backup.");
  });

  it("deletes a tracker portrait only after the card removal is durably saved", async () => {
    const state = makeGuardedTrackerState({
      tracker: {
        npcs: [{ id: "npc-1", imgBlobId: "old-portrait" }]
      }
    });
    const steps = [];
    const saveManager = {
      markDirty: vi.fn(() => {
        steps.push("markDirty");
      }),
      flush: vi.fn(async () => {
        steps.push("flush");
        return true;
      })
    };
    const deleteBlob = vi.fn(async (blobId) => {
      steps.push(`delete:${blobId}`);
    });
    const actions = createStateActions({ state, SaveManager: saveManager });

    const ok = await deleteTrackerCardWithBlobCleanup({
      type: "npc",
      itemId: "npc-1",
      getItemById: (id) => state.tracker.npcs.find((npc) => npc.id === id) || null,
      mutateTracker: actions.mutateTracker,
      SaveManager: saveManager,
      deleteBlob,
    });

    expect(ok).toBe(true);
    expect(state.tracker.npcs).toHaveLength(0);
    expect(deleteBlob).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledWith("old-portrait");
    expect(steps).toEqual([
      "markDirty",
      "flush",
      "delete:old-portrait"
    ]);
  });

  it("restores the tracker card and keeps its portrait when delete flush fails", async () => {
    const state = makeGuardedTrackerState({
      tracker: {
        npcs: [{ id: "npc-1", imgBlobId: "old-portrait" }]
      }
    });
    const saveManager = makeSaveManager({
      flush: vi.fn(async () => false)
    });
    const deleteBlob = vi.fn(async () => {});
    const actions = createStateActions({ state, SaveManager: saveManager });

    await expect(deleteTrackerCardWithBlobCleanup({
      type: "npc",
      itemId: "npc-1",
      getItemById: (id) => state.tracker.npcs.find((npc) => npc.id === id) || null,
      mutateTracker: actions.mutateTracker,
      SaveManager: saveManager,
      deleteBlob,
    })).rejects.toThrow("SaveManager.flush() failed");

    expect(state.tracker.npcs).toHaveLength(1);
    expect(state.tracker.npcs[0].imgBlobId).toBe("old-portrait");
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it("keeps the old map background and skips redraw work when flush fails", async () => {
    const mp = { bgBlobId: "old-bg" };
    const saveManager = makeSaveManager({
      flush: vi.fn(async () => false)
    });
    const setStatus = vi.fn();
    const uiAlert = vi.fn(async () => {});
    const deleteBlob = vi.fn(async () => {});
    const renderMap = vi.fn();
    const commitDrawingSnapshot = vi.fn(async () => {});

    const { setMapImage } = createMapBackgroundActions({
      setStatus,
      uiAlert,
      SaveManager: saveManager,
      getActiveMap: () => mp,
      blobIdToObjectUrl: vi.fn(async () => "blob:next"),
      putBlob: vi.fn(async () => "new-bg"),
      deleteBlob,
      renderMap,
      commitDrawingSnapshot,
      canvas: {},
      ctx: {},
      drawLayer: {},
      getBgImg: () => null,
      setBgImg: vi.fn()
    });

    setMapImage({ target: { files: [new Blob(["bg"], { type: "image/png" })] } });
    await waitForAsyncWork();

    expect(mp.bgBlobId).toBe("old-bg");
    expect(saveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(saveManager.flush).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledWith("new-bg");
    expect(renderMap).not.toHaveBeenCalled();
    expect(commitDrawingSnapshot).not.toHaveBeenCalled();
    expect(uiAlert).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenLastCalledWith("Could not save map image. Consider exporting a backup.");
  });

  it("removes the map background only after the state change is durably saved", async () => {
    const mp = { bgBlobId: "old-bg" };
    const steps = [];
    const saveManager = {
      markDirty: vi.fn(() => {
        steps.push("markDirty");
      }),
      flush: vi.fn(async () => {
        steps.push("flush");
        return true;
      })
    };
    const deleteBlob = vi.fn(async (blobId) => {
      steps.push(`delete:${blobId}`);
    });
    const setBgImg = vi.fn();
    const renderMap = vi.fn();
    const commitDrawingSnapshot = vi.fn(async () => {});

    const { removeMapImage } = createMapBackgroundActions({
      setStatus: vi.fn(),
      uiAlert: vi.fn(async () => {}),
      SaveManager: saveManager,
      getActiveMap: () => mp,
      blobIdToObjectUrl: vi.fn(async () => null),
      putBlob: vi.fn(async () => "unused"),
      deleteBlob,
      renderMap,
      commitDrawingSnapshot,
      canvas: {},
      ctx: {},
      drawLayer: {},
      getBgImg: () => null,
      setBgImg
    });

    await removeMapImage();

    expect(mp.bgBlobId).toBeNull();
    expect(setBgImg).toHaveBeenCalledWith(null);
    expect(renderMap).toHaveBeenCalledTimes(1);
    expect(commitDrawingSnapshot).toHaveBeenCalledTimes(1);
    expect(steps).toEqual([
      "markDirty",
      "flush",
      "delete:old-bg"
    ]);
  });

  it("restores the map background reference and skips blob deletion when remove flush fails", async () => {
    const mp = { bgBlobId: "old-bg" };
    const saveManager = makeSaveManager({
      flush: vi.fn(async () => false)
    });
    const deleteBlob = vi.fn(async () => {});
    const renderMap = vi.fn();
    const commitDrawingSnapshot = vi.fn(async () => {});
    const setBgImg = vi.fn();

    const { removeMapImage } = createMapBackgroundActions({
      setStatus: vi.fn(),
      uiAlert: vi.fn(async () => {}),
      SaveManager: saveManager,
      getActiveMap: () => mp,
      blobIdToObjectUrl: vi.fn(async () => null),
      putBlob: vi.fn(async () => "unused"),
      deleteBlob,
      renderMap,
      commitDrawingSnapshot,
      canvas: {},
      ctx: {},
      drawLayer: {},
      getBgImg: () => null,
      setBgImg
    });

    await expect(removeMapImage()).rejects.toThrow("SaveManager.flush() failed");

    expect(mp.bgBlobId).toBe("old-bg");
    expect(setBgImg).not.toHaveBeenCalled();
    expect(renderMap).not.toHaveBeenCalled();
    expect(commitDrawingSnapshot).not.toHaveBeenCalled();
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it("deletes map blobs only after the map removal is durably saved", async () => {
    const mapState = makeMapState({
      maps: [
        { id: "map-1", name: "World Map", bgBlobId: "bg-1", drawingBlobId: "draw-1", brushSize: 6, colorKey: "grey" },
        { id: "map-2", name: "Town Map", bgBlobId: null, drawingBlobId: null, brushSize: 6, colorKey: "blue" }
      ],
      activeMapId: "map-1",
    });
    const steps = [];
    const saveManager = {
      markDirty: vi.fn(() => {
        steps.push("markDirty");
      }),
      flush: vi.fn(async () => {
        steps.push("flush");
        return true;
      })
    };
    const deleteBlob = vi.fn(async (blobId) => {
      steps.push(`delete:${blobId}`);
    });
    const newMapEntry = vi.fn((name = "World Map") => ({
      id: "map-3",
      name,
      bgBlobId: null,
      drawingBlobId: null,
      brushSize: 6,
      colorKey: "grey"
    }));

    const ok = await deleteMapWithBlobCleanup({
      mapState,
      mapId: "map-1",
      SaveManager: saveManager,
      deleteBlob,
      newMapEntry
    });

    expect(ok).toBe(true);
    expect(mapState.maps.map((mapEntry) => mapEntry.id)).toEqual(["map-2"]);
    expect(mapState.activeMapId).toBe("map-2");
    expect(deleteBlob).toHaveBeenCalledTimes(2);
    expect(deleteBlob).toHaveBeenNthCalledWith(1, "bg-1");
    expect(deleteBlob).toHaveBeenNthCalledWith(2, "draw-1");
    expect(steps).toEqual([
      "markDirty",
      "flush",
      "delete:bg-1",
      "delete:draw-1"
    ]);
  });

  it("restores the deleted map and skips blob deletion when map removal flush fails", async () => {
    const mapState = makeMapState({
      maps: [
        { id: "map-1", name: "World Map", bgBlobId: "bg-1", drawingBlobId: "draw-1", brushSize: 6, colorKey: "grey" },
        { id: "map-2", name: "Town Map", bgBlobId: null, drawingBlobId: null, brushSize: 6, colorKey: "blue" }
      ],
      activeMapId: "map-1",
    });
    const saveManager = makeSaveManager({
      flush: vi.fn(async () => false)
    });
    const deleteBlob = vi.fn(async () => {});

    await expect(deleteMapWithBlobCleanup({
      mapState,
      mapId: "map-1",
      SaveManager: saveManager,
      deleteBlob,
      newMapEntry: vi.fn((name = "World Map") => ({
        id: "map-3",
        name,
        bgBlobId: null,
        drawingBlobId: null,
        brushSize: 6,
        colorKey: "grey"
      }))
    })).rejects.toThrow("SaveManager.flush() failed");

    expect(mapState.maps.map((mapEntry) => mapEntry.id)).toEqual(["map-1", "map-2"]);
    expect(mapState.activeMapId).toBe("map-1");
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it("resolves cleanly and keeps the old drawing snapshot when storing the new snapshot fails", async () => {
    const mp = { drawingBlobId: "old-drawing" };
    const saveManager = makeSaveManager();
    const deleteBlob = vi.fn(async () => {});

    await expect(persistDrawingSnapshot({
      drawLayer: {
        toBlob(callback) {
          callback(new Blob(["drawing"], { type: "image/png" }));
        }
      },
      getActiveMap: () => mp,
      putBlob: vi.fn(async () => {
        throw new Error("quota exceeded");
      }),
      deleteBlob,
      SaveManager: saveManager
    })).resolves.toBeUndefined();

    expect(mp.drawingBlobId).toBe("old-drawing");
    expect(saveManager.markDirty).not.toHaveBeenCalled();
    expect(saveManager.flush).not.toHaveBeenCalled();
    expect(saveManager.reportError).toHaveBeenCalledTimes(1);
    expect(deleteBlob).not.toHaveBeenCalled();
  });
});
