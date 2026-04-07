import { describe, expect, it, vi } from "vitest";

import { pickAndStorePortrait } from "../js/pages/tracker/panels/cards/shared/cardPortraitShared.js";
import { createMapBackgroundActions } from "../js/pages/map/mapBackgroundActions.js";
import { persistDrawingSnapshot } from "../js/pages/map/mapPersistence.js";

function makeSaveManager({ flush = vi.fn(async () => true) } = {}) {
  return {
    markDirty: vi.fn(),
    flush
  };
}

function waitForAsyncWork() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("asset replacement flows", () => {
  it("keeps the old tracker portrait when the replacement flush fails", async () => {
    const item = { id: "npc-1", imgBlobId: "old-portrait" };
    const saveManager = makeSaveManager({
      flush: vi.fn(async () => false)
    });
    const deleteBlob = vi.fn(async () => {});
    const uiAlert = vi.fn(async () => {});
    const setStatus = vi.fn();

    const ok = await pickAndStorePortrait({
      itemId: item.id,
      getItemById: (id) => (id === item.id ? item : null),
      getBlobId: (npc) => npc.imgBlobId,
      setBlobId: (npc, blobId) => {
        npc.imgBlobId = blobId;
      },
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
    expect(item.imgBlobId).toBe("old-portrait");
    expect(saveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(saveManager.flush).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledWith("new-portrait");
    expect(uiAlert).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenLastCalledWith("Could not save image. Consider exporting a backup.");
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
    expect(deleteBlob).not.toHaveBeenCalled();
  });
});
