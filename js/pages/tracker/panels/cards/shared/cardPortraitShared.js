/**
 * Shared portrait pick/crop/store flow for tracker cards.
 * Panels remain responsible for SaveManager.markDirty() and re-render.
 */
export async function pickAndStorePortrait({
  itemId,
  getItemById,
  getBlobId,
  setBlobId,
  deps,
  setStatus,
} = {}) {
  if (typeof getItemById !== "function" || typeof getBlobId !== "function" || typeof setBlobId !== "function") {
    console.warn("pickAndStorePortrait: missing required item helpers.");
    return false;
  }

  const item = getItemById(itemId);
  if (!item) return false;

  const {
    pickCropStorePortrait,
    ImagePicker,
    cropImageModal,
    getPortraitAspect,
    deleteBlob,
    putBlob,
  } = deps || {};

  if (!pickCropStorePortrait || !ImagePicker || !cropImageModal || !getPortraitAspect || !deleteBlob || !putBlob) {
    console.warn("pickAndStorePortrait: portrait flow dependencies missing; cannot pick image.");
    return false;
  }

  const blobId = await pickCropStorePortrait({
    picker: ImagePicker,
    currentBlobId: getBlobId(item),
    deleteBlob,
    putBlob,
    cropImageModal,
    getPortraitAspect,
    aspectSelector: ".npcPortraitTop",
    setStatus,
  });

  // Match character portrait UX: cancelling the picker clears the portrait reference.
  if (typeof blobId === "undefined") return false;
  setBlobId(item, blobId || null);
  return true;
}
