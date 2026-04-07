// Shared "pick → crop" helper for portrait-style images.
// Keeps app.js handlers tiny and consistent.

import { uiAlert } from "../ui/dialogs.js";
/**
 * Picks one image file, crops it via the shared crop modal, and returns the
 * prepared replacement blob for the caller to commit.
 *
 * @typedef {{
 *   picker?: { pickOne?: (options?: { accept?: string }) => Promise<File | null> },
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
 *   aspectSelector?: string,
 *   setStatus?: (message: string) => void,
 *   outSize?: number,
 *   mime?: string,
 *   quality?: number,
 *   onError?: (err: unknown) => void
 * }} PickCropStorePortraitOptions
 *
 * @param {PickCropStorePortraitOptions} [opts]
 * @returns {Promise<Blob|null|undefined>} Blob when ready, null when the user cancels, undefined on failure
 */
export async function pickCropStorePortrait(opts = {}) {
  const {
    picker,
    cropImageModal,
    getPortraitAspect,
    aspectSelector,
    setStatus,
    outSize = 512,
    mime = "image/webp",
    quality = 0.9,
    onError,
  } = opts || {};

  if (!picker?.pickOne) throw new Error("pickCropStorePortrait: missing picker.pickOne()");
  if (typeof cropImageModal !== "function") throw new Error("pickCropStorePortrait: missing cropImageModal");
  if (typeof getPortraitAspect !== "function") throw new Error("pickCropStorePortrait: missing getPortraitAspect");
  if (typeof aspectSelector !== "string" || !aspectSelector) throw new Error("pickCropStorePortrait: missing aspectSelector");
  if (typeof setStatus !== "function") throw new Error("pickCropStorePortrait: missing setStatus");

  const file = await picker.pickOne({ accept: "image/*" });
  if (!file) return null;

  try {
    setStatus("Saving image...");

    const aspect = getPortraitAspect(aspectSelector);
    const cropped = await cropImageModal(file, { aspect, outSize, mime, quality, setStatus });
    if (!cropped) return null; // user cancelled

    return cropped;
  } catch (err) {
    console.error("Portrait pick/crop/store failed:", err);
    setStatus("Could not save image. Consider exporting a backup.");
    if (typeof onError === "function") onError(err);
    else {
      // Fallback: keep prior behavior (some flows relied on this alert)
      try {
        // eslint-disable-next-line no-alert
        await uiAlert("Could not save that image (storage may be full).", { title: "Save Failed" });
      } catch (_) {}
    }
    return undefined;
  }
}
