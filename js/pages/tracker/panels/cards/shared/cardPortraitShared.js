/**
 * Shared portrait pick/crop/store flow for tracker cards.
 * Panels remain responsible only for re-render after a successful commit.
 */
import { replaceStoredBlob } from "../../../../../storage/blobReplacement.js";

/** @typedef {typeof import("../../../../../features/portraitFlow.js").pickCropStorePortrait} PickCropStorePortraitFn */
/** @typedef {typeof import("../../../../../storage/blobs.js").deleteBlob} DeleteBlobFn */
/** @typedef {typeof import("../../../../../storage/blobs.js").putBlob} PutBlobFn */
/** @typedef {import("../../../../../storage/saveManager.js").SaveManager} SaveManager */
/**
 * @typedef {{
 *   pickCropStorePortrait?: PickCropStorePortraitFn,
 *   ImagePicker?: { pickOne?: (options?: { accept?: string }) => Promise<File | null> },
 *   cropImageModal?: (
 *     file: File,
 *     options?: {
 *       aspect?: number,
 *       outSize?: number,
 *       mime?: string,
 *       quality?: number,
 *       setStatus?: (message: string) => void
 *     }
 *   ) => Promise<Blob | null>,
 *   getPortraitAspect?: (selector: string) => number,
 *   deleteBlob?: DeleteBlobFn,
 *   putBlob?: PutBlobFn,
 *   SaveManager?: SaveManager,
 *   uiAlert?: (message: string, options?: { title?: string }) => Promise<unknown> | unknown
 * }} PortraitFlowDeps
 */
/**
 * @template TItem
 * @typedef {{
 *   itemId?: string,
 *   getItemById?: (itemId: string | undefined) => TItem | null,
 *   getBlobId?: (item: TItem) => string | null | undefined,
 *   setBlobId?: (item: TItem, blobId: string | null) => void,
 *   deps?: PortraitFlowDeps,
 *   setStatus?: (message: string) => void
 * }} PickAndStorePortraitOptions
 */

/**
 * @template TItem
 * @param {PickAndStorePortraitOptions<TItem>} [options]
 * @returns {Promise<boolean>}
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
    SaveManager,
    uiAlert,
  } = deps || {};

  if (!pickCropStorePortrait || !ImagePicker || !cropImageModal || !getPortraitAspect || !deleteBlob || !putBlob || !SaveManager) {
    console.warn("pickAndStorePortrait: portrait flow dependencies missing; cannot pick image.");
    return false;
  }

  const portraitBlob = await pickCropStorePortrait({
    picker: ImagePicker,
    cropImageModal,
    getPortraitAspect,
    aspectSelector: ".npcPortraitTop",
    setStatus,
  });

  if (typeof portraitBlob === "undefined") return false;

  try {
    await replaceStoredBlob({
      oldBlobId: getBlobId(item),
      nextBlob: portraitBlob,
      putBlob,
      deleteBlob,
      SaveManager,
      applyBlobId: (blobId) => {
        return setBlobId(item, blobId || null);
      }
    });
    return true;
  } catch (err) {
    console.error("Portrait replacement failed:", err);
    setStatus?.("Could not save image. Consider exporting a backup.");
    try {
      await uiAlert?.("Could not save that image (storage may be full).", { title: "Save Failed" });
    } catch (_) {}
    return false;
  }
}
