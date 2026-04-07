// @ts-check
// js/storage/blobReplacement.js

/** @typedef {typeof import("./blobs.js").putBlob} PutBlobFn */
/** @typedef {typeof import("./blobs.js").deleteBlob} DeleteBlobFn */
/** @typedef {import("./saveManager.js").SaveManager} SaveManager */

/**
 * Safely replace a blob-backed asset by committing the new blob and state
 * reference before deleting the old blob.
 *
 * @param {{
 *   oldBlobId?: string | null,
 *   nextBlob?: Blob | null,
 *   putBlob?: PutBlobFn,
 *   deleteBlob?: DeleteBlobFn,
 *   SaveManager?: SaveManager,
 *   applyBlobId?: (blobId: string | null) => unknown
 * }} options
 * @returns {Promise<string | null>}
 */
export async function replaceStoredBlob({
  oldBlobId = null,
  nextBlob = null,
  putBlob,
  deleteBlob,
  SaveManager,
  applyBlobId,
} = {}) {
  if (nextBlob !== null && !(nextBlob instanceof Blob)) {
    throw new Error("replaceStoredBlob: nextBlob must be a Blob or null");
  }
  if (typeof putBlob !== "function") throw new Error("replaceStoredBlob: putBlob is required");
  if (typeof deleteBlob !== "function") throw new Error("replaceStoredBlob: deleteBlob is required");
  if (typeof SaveManager?.markDirty !== "function") throw new Error("replaceStoredBlob: SaveManager.markDirty is required");
  if (typeof SaveManager?.flush !== "function") throw new Error("replaceStoredBlob: SaveManager.flush is required");
  if (typeof applyBlobId !== "function") throw new Error("replaceStoredBlob: applyBlobId is required");

  let nextBlobId = null;
  let applied = false;

  try {
    nextBlobId = nextBlob ? await putBlob(nextBlob) : null;

    applied = true;
    const appliedResult = applyBlobId(nextBlobId);
    if (appliedResult === false) {
      throw new Error("replaceStoredBlob: applyBlobId returned false");
    }

    SaveManager.markDirty();
    const flushed = await SaveManager.flush();
    if (!flushed) throw new Error("replaceStoredBlob: SaveManager.flush() failed");

    if (oldBlobId && oldBlobId !== nextBlobId) {
      try {
        await deleteBlob(oldBlobId);
      } catch (err) {
        console.warn("Failed to delete replaced blob:", err);
      }
    }

    return nextBlobId;
  } catch (err) {
    if (applied) {
      try {
        applyBlobId(oldBlobId || null);
      } catch (rollbackErr) {
        console.warn("replaceStoredBlob: failed to restore previous blob reference.", rollbackErr);
      }
    }

    if (nextBlobId && nextBlobId !== oldBlobId) {
      try {
        await deleteBlob(nextBlobId);
      } catch (cleanupErr) {
        console.warn("replaceStoredBlob: failed to delete staged blob after rollback.", cleanupErr);
      }
    }

    throw err;
  }
}
