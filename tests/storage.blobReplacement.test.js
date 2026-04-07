import { describe, expect, it, vi } from "vitest";

import { replaceStoredBlob } from "../js/storage/blobReplacement.js";

function makeSaveManager({ flush = vi.fn(async () => true) } = {}) {
  return {
    markDirty: vi.fn(),
    flush
  };
}

describe("replaceStoredBlob", () => {
  it("writes the new blob, flushes the state update, then deletes the old blob", async () => {
    const steps = [];
    let currentBlobId = "old-blob";
    const saveManager = makeSaveManager({
      flush: vi.fn(async () => {
        steps.push(`flush:${currentBlobId}`);
        return true;
      })
    });
    const putBlob = vi.fn(async () => {
      steps.push("put:new-blob");
      return "new-blob";
    });
    const deleteBlob = vi.fn(async (blobId) => {
      steps.push(`delete:${blobId}`);
    });

    const result = await replaceStoredBlob({
      oldBlobId: currentBlobId,
      nextBlob: new Blob(["portrait"], { type: "image/webp" }),
      putBlob,
      deleteBlob,
      SaveManager: saveManager,
      applyBlobId: (blobId) => {
        currentBlobId = blobId;
        steps.push(`apply:${blobId}`);
      }
    });

    expect(result).toBe("new-blob");
    expect(currentBlobId).toBe("new-blob");
    expect(saveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(saveManager.flush).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledWith("old-blob");
    expect(steps).toEqual([
      "put:new-blob",
      "apply:new-blob",
      "flush:new-blob",
      "delete:old-blob"
    ]);
  });

  it("keeps the old blob reference intact when storing the replacement fails", async () => {
    let currentBlobId = "old-blob";
    const saveManager = makeSaveManager();
    const putBlob = vi.fn(async () => {
      throw new Error("quota exceeded");
    });
    const deleteBlob = vi.fn(async () => {});

    await expect(replaceStoredBlob({
      oldBlobId: currentBlobId,
      nextBlob: new Blob(["portrait"], { type: "image/webp" }),
      putBlob,
      deleteBlob,
      SaveManager: saveManager,
      applyBlobId: (blobId) => {
        currentBlobId = blobId;
      }
    })).rejects.toThrow("quota exceeded");

    expect(currentBlobId).toBe("old-blob");
    expect(saveManager.markDirty).not.toHaveBeenCalled();
    expect(saveManager.flush).not.toHaveBeenCalled();
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it("restores the old reference and cleans up the staged blob when flush fails", async () => {
    const steps = [];
    let currentBlobId = "old-blob";
    const saveManager = makeSaveManager({
      flush: vi.fn(async () => {
        steps.push(`flush:${currentBlobId}`);
        return false;
      })
    });
    const putBlob = vi.fn(async () => {
      steps.push("put:new-blob");
      return "new-blob";
    });
    const deleteBlob = vi.fn(async (blobId) => {
      steps.push(`delete:${blobId}`);
    });

    await expect(replaceStoredBlob({
      oldBlobId: currentBlobId,
      nextBlob: new Blob(["portrait"], { type: "image/webp" }),
      putBlob,
      deleteBlob,
      SaveManager: saveManager,
      applyBlobId: (blobId) => {
        currentBlobId = blobId;
        steps.push(`apply:${blobId}`);
      }
    })).rejects.toThrow("SaveManager.flush() failed");

    expect(currentBlobId).toBe("old-blob");
    expect(saveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(saveManager.flush).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledWith("new-blob");
    expect(steps).toEqual([
      "put:new-blob",
      "apply:new-blob",
      "flush:new-blob",
      "apply:old-blob",
      "delete:new-blob"
    ]);
  });
});
