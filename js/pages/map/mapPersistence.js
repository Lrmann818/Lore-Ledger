// @ts-check
// js/pages/map/mapPersistence.js

import { replaceStoredBlob } from "../../storage/blobReplacement.js";

/** @typedef {import("../../state.js").MapEntry} MapEntry */
/** @typedef {typeof import("../../storage/blobs.js").blobIdToObjectUrl} BlobIdToObjectUrlFn */
/** @typedef {typeof import("../../storage/blobs.js").putBlob} PutBlobFn */
/** @typedef {typeof import("../../storage/blobs.js").deleteBlob} DeleteBlobFn */
/** @typedef {import("../../storage/saveManager.js").SaveManager} SaveManager */

/**
 * @param {{
 *   drawLayer: HTMLCanvasElement,
 *   getActiveMap: () => MapEntry,
 *   putBlob?: PutBlobFn,
 *   deleteBlob?: DeleteBlobFn,
 *   SaveManager: SaveManager
 * }} options
 * @returns {Promise<void>}
 */
export function persistDrawingSnapshot({
  drawLayer,
  getActiveMap,
  putBlob,
  deleteBlob,
  SaveManager
}) {
  return new Promise((resolve) => {
    const mp = getActiveMap();

    drawLayer.toBlob(async (blob) => {
      if (!blob) { resolve(); return; }
      if (!putBlob) {
        resolve();
        return;
      }

      try {
        await replaceStoredBlob({
          oldBlobId: mp.drawingBlobId,
          nextBlob: blob,
          putBlob,
          deleteBlob,
          SaveManager,
          applyBlobId: (blobId) => {
            mp.drawingBlobId = blobId || null;
          }
        });
      } catch (err) {
        console.error("Failed to persist map drawing blob:", err);
      }
      resolve();
    }, "image/png");
  });
}

/**
 * @param {{ mp?: MapEntry | null, blobIdToObjectUrl?: BlobIdToObjectUrlFn }} options
 * @returns {Promise<HTMLImageElement | null>}
 */
export async function loadMapBackgroundImage({ mp, blobIdToObjectUrl }) {
  if (!mp?.bgBlobId || !blobIdToObjectUrl) return null;

  let url = null;
  try { url = await blobIdToObjectUrl(mp.bgBlobId); }
  catch (err) { console.warn("Failed to load map background blob:", err); }

  if (!url) return null;

  const img = new Image();
  await new Promise((res) => {
    img.onload = () => res();
    img.onerror = () => res();
    img.src = url;
  });
  return img;
}

/**
 * @param {{
 *   mp?: MapEntry | null,
 *   blobIdToObjectUrl?: BlobIdToObjectUrlFn,
 *   drawCtx: CanvasRenderingContext2D,
 *   drawLayer: HTMLCanvasElement
 * }} options
 * @returns {Promise<void>}
 */
export async function loadMapDrawingLayer({ mp, blobIdToObjectUrl, drawCtx, drawLayer }) {
  drawCtx.clearRect(0, 0, drawLayer.width, drawLayer.height);
  if (!mp?.drawingBlobId || !blobIdToObjectUrl) return;

  let url = null;
  try { url = await blobIdToObjectUrl(mp.drawingBlobId); }
  catch (err) { console.warn("Failed to load map drawing blob:", err); }

  if (!url) return;

  const img = new Image();
  await new Promise((res) => {
    img.onload = () => { drawCtx.drawImage(img, 0, 0); res(); };
    img.onerror = () => res();
    img.src = url;
  });
}
