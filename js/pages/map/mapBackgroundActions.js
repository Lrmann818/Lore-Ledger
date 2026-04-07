// js/pages/map/mapBackgroundActions.js

import { replaceStoredBlob } from "../../storage/blobReplacement.js";

export function createMapBackgroundActions({
  setStatus,
  uiAlert,
  SaveManager,
  getActiveMap,
  blobIdToObjectUrl,
  putBlob,
  deleteBlob,
  renderMap,
  commitDrawingSnapshot,
  canvas,
  ctx,
  drawLayer,
  getBgImg,
  setBgImg
}) {
  function setMapImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    (async () => {
      setStatus("Saving map image...");

      const mp = getActiveMap();
      let nextBgBlobId = null;
      try {
        nextBgBlobId = await replaceStoredBlob({
          oldBlobId: mp.bgBlobId,
          nextBlob: file,
          putBlob,
          deleteBlob,
          SaveManager,
          applyBlobId: (blobId) => {
            mp.bgBlobId = blobId || null;
          }
        });
      } catch (err) {
        console.error("Failed to save map image blob:", err);
        setStatus("Could not save map image. Consider exporting a backup.");
        await uiAlert("Could not save that map image (storage may be full).", { title: "Save Failed" });
        return;
      }

      let url = null;
      try { url = await blobIdToObjectUrl(nextBgBlobId); }
      catch (err) { console.warn("Failed to load map background blob:", err); }
      setBgImg(new Image());
      getBgImg().onload = () => {
        renderMap({ canvas, ctx, drawLayer, bgImg: getBgImg() });
        void commitDrawingSnapshot();
      };
      getBgImg().src = url;
    })();
  }

  async function removeMapImage() {
    const mp = getActiveMap();
    if (mp.bgBlobId) {
      try { await deleteBlob(mp.bgBlobId); }
      catch (err) { console.warn("Failed to delete map image blob:", err); }
    }
    mp.bgBlobId = null;
    setBgImg(null);
    renderMap({ canvas, ctx, drawLayer, bgImg: getBgImg() });
    await commitDrawingSnapshot();
    SaveManager.markDirty();
  }

  return { setMapImage, removeMapImage };
}
