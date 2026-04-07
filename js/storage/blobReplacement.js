// @ts-check
// js/storage/blobReplacement.js

/** @typedef {typeof import("./blobs.js").putBlob} PutBlobFn */
/** @typedef {typeof import("./blobs.js").deleteBlob} DeleteBlobFn */
/** @typedef {import("./saveManager.js").SaveManager} SaveManager */

/**
 * @param {{
 *   SaveManager?: SaveManager,
 *   applyStateChange?: () => unknown | Promise<unknown>,
 *   rollbackStateChange?: () => unknown | Promise<unknown>
 * }} options
 * @returns {Promise<void>}
 */
async function commitStructuredStateChange({
  SaveManager,
  applyStateChange,
  rollbackStateChange,
} = {}) {
  if (typeof SaveManager?.markDirty !== "function") {
    throw new Error("commitStructuredStateChange: SaveManager.markDirty is required");
  }
  if (typeof SaveManager?.flush !== "function") {
    throw new Error("commitStructuredStateChange: SaveManager.flush is required");
  }
  if (typeof applyStateChange !== "function") {
    throw new Error("commitStructuredStateChange: applyStateChange is required");
  }
  if (typeof rollbackStateChange !== "function") {
    throw new Error("commitStructuredStateChange: rollbackStateChange is required");
  }

  let applied = false;

  try {
    const appliedResult = await applyStateChange();
    if (appliedResult === false) {
      throw new Error("commitStructuredStateChange: applyStateChange returned false");
    }

    applied = true;
    SaveManager.markDirty();

    const flushed = await SaveManager.flush();
    if (!flushed) {
      throw new Error("commitStructuredStateChange: SaveManager.flush() failed");
    }
  } catch (err) {
    if (applied) {
      try {
        await rollbackStateChange();
      } catch (rollbackErr) {
        console.warn("commitStructuredStateChange: failed to restore previous state.", rollbackErr);
      }
    }
    throw err;
  }
}

/**
 * Safely commit a structured state change before deleting any now-unreferenced blobs.
 *
 * @param {{
 *   blobIdsToDelete?: Array<string | null | undefined>,
 *   deleteBlob?: DeleteBlobFn,
 *   SaveManager?: SaveManager,
 *   applyStateChange?: () => unknown | Promise<unknown>,
 *   rollbackStateChange?: () => unknown | Promise<unknown>
 * }} options
 * @returns {Promise<void>}
 */
export async function commitStateChangeWithDeferredBlobDeletion({
  blobIdsToDelete = [],
  deleteBlob,
  SaveManager,
  applyStateChange,
  rollbackStateChange,
} = {}) {
  if (typeof deleteBlob !== "function") {
    throw new Error("commitStateChangeWithDeferredBlobDeletion: deleteBlob is required");
  }

  await commitStructuredStateChange({
    SaveManager,
    applyStateChange,
    rollbackStateChange,
  });

  const uniqueBlobIds = Array.from(new Set(
    blobIdsToDelete.filter((blobId) => typeof blobId === "string" && blobId),
  ));

  for (const blobId of uniqueBlobIds) {
    try {
      await deleteBlob(blobId);
    } catch (err) {
      console.warn("Failed to delete blob after committed state change:", err);
    }
  }
}

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

  try {
    nextBlobId = nextBlob ? await putBlob(nextBlob) : null;

    await commitStructuredStateChange({
      SaveManager,
      applyStateChange: () => applyBlobId(nextBlobId),
      rollbackStateChange: () => applyBlobId(oldBlobId || null),
    });

    if (oldBlobId && oldBlobId !== nextBlobId) {
      try {
        await deleteBlob(oldBlobId);
      } catch (err) {
        console.warn("Failed to delete replaced blob:", err);
      }
    }

    return nextBlobId;
  } catch (err) {
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
