// js/pages/map/mapListUI.js

import { enhanceSelectDropdown } from "../../ui/selectDropdown.js";
import { safeAsync } from "../../ui/safeAsync.js";
import { requireEl, getNoopDestroyApi } from "../../utils/domGuards.js";
import { commitStateChangeWithDeferredBlobDeletion } from "../../storage/blobReplacement.js";
import {
  loadMapBackgroundImage,
  loadMapDrawingLayer
} from "./mapPersistence.js";

/**
 * @param {{
 *   mapState?: { maps?: Array<{ id?: string, bgBlobId?: string | null, drawingBlobId?: string | null }>, activeMapId?: string | null },
 *   mapId?: string,
 *   SaveManager?: import("../../storage/saveManager.js").SaveManager,
 *   deleteBlob?: typeof import("../../storage/blobs.js").deleteBlob,
 *   newMapEntry?: (name?: string) => { id?: string } | null
 * }} options
 * @returns {Promise<boolean>}
 */
export async function deleteMapWithBlobCleanup({
  mapState,
  mapId,
  SaveManager,
  deleteBlob,
  newMapEntry,
} = {}) {
  if (!mapState || !Array.isArray(mapState.maps)) {
    throw new Error("deleteMapWithBlobCleanup: mapState.maps is required");
  }

  const mapToDelete = mapState.maps.find((mapEntry) => mapEntry?.id === mapId) || null;
  if (!mapToDelete) return false;

  const previousMaps = mapState.maps.slice();
  const previousActiveMapId = mapState.activeMapId;

  await commitStateChangeWithDeferredBlobDeletion({
    SaveManager,
    deleteBlob,
    blobIdsToDelete: [mapToDelete.bgBlobId, mapToDelete.drawingBlobId],
    applyStateChange: () => {
      mapState.maps = previousMaps.filter((mapEntry) => mapEntry.id !== mapToDelete.id);
      if (!mapState.maps.length) {
        mapState.maps = [newMapEntry?.("World Map") || { id: previousActiveMapId || "map_1" }];
      }
      mapState.activeMapId = mapState.maps[0].id;
    },
    rollbackStateChange: () => {
      mapState.maps = previousMaps;
      mapState.activeMapId = previousActiveMapId;
    }
  });

  return true;
}

export function initMapListUI({
  mapState,
  SaveManager,
  Popovers,
  addListener: addOwnedListener,
  ensureMapManager,
  getActiveMap,
  newMapEntry,
  uiPrompt,
  uiConfirm,
  uiAlert,
  blobIdToObjectUrl,
  deleteBlob,
  // canvas dependencies:
  drawCtx,
  drawLayer,
  canvas,
  ctx,
  // bgImg state lives in mapPage:
  getBgImg,
  setBgImg,
  // drawing persistence:
  commitDrawingSnapshot,
  clearHistory,
  // UI helpers from toolbar module / mapPage:
  setActiveToolUI,
  setActiveColorUI,
  renderMap,
  setStatus
}) {
  const NOOP_MAP_LIST_API = {
    refreshMapSelect: () => { },
    loadActiveMapIntoCanvas: async () => { },
    switchMap: async () => { },
    destroy: getNoopDestroyApi().destroy
  };

  if (!setStatus) throw new Error("initMapListUI requires setStatus");
  if (typeof addOwnedListener !== "function") {
    throw new Error("initMapListUI requires deps.addListener (controller-owned listener attachment)");
  }
  if (!mapState || typeof mapState !== "object") {
    throw new Error("initMapListUI requires mapState");
  }
  if (typeof clearHistory !== "function") {
    throw new Error("initMapListUI requires clearHistory");
  }
  mapState.ui ||= {};
  const addListener = addOwnedListener;

  const mapSelect = requireEl("#mapSelect", document, { prefix: "initMapListUI", warn: false });
  const addMapBtn = requireEl("#addMapBtn", document, { prefix: "initMapListUI", warn: false });
  const renameMapBtn = requireEl("#renameMapBtn", document, { prefix: "initMapListUI", warn: false });
  const deleteMapBtn = requireEl("#deleteMapBtn", document, { prefix: "initMapListUI", warn: false });
  const brush = requireEl("#brushSize", document, { prefix: "initMapListUI", warn: false });

  if (!mapSelect || !addMapBtn || !renameMapBtn || !deleteMapBtn || !brush) {
    setStatus("Map list controls unavailable (missing expected UI elements).", { stickyMs: 5000 });
    return NOOP_MAP_LIST_API;
  }

  // Enhance the Map <select> so the OPEN menu matches the Map Tools dropdown.
  // Closed control keeps the same sizing/style as the original select.
  if (mapSelect && Popovers && !mapSelect.dataset.dropdownEnhanced) {
    enhanceSelectDropdown({
      select: mapSelect,
      Popovers,
      buttonClass: "mapSelectBtn",
      optionClass: "swatchOption",
      groupLabelClass: "dropdownGroupLabel",
      preferRight: false
    });
    // Ensure label is correct immediately
    try { mapSelect.dispatchEvent(new Event("selectDropdown:sync")); } catch { }
  }

  function refreshMapSelect() {
    ensureMapManager();
    mapSelect.innerHTML = "";
    const maps = Array.isArray(mapState.maps) ? mapState.maps : [];
    for (const mp of maps) {
      const opt = document.createElement("option");
      opt.value = mp.id;
      opt.textContent = mp.name || "Map";
      if (mp.id === mapState.activeMapId) opt.selected = true;
      mapSelect.appendChild(opt);
    }
    try { mapSelect.dispatchEvent(new Event("selectDropdown:rebuild")); } catch { }
  }

  async function loadActiveMapIntoCanvas() {
    const mp = getActiveMap();

    clearHistory();

    brush.value = mapState.ui.brushSize;
    mp.brushSize = mapState.ui.brushSize;
    setActiveToolUI(mapState.ui.activeTool);
    setActiveColorUI(mp.colorKey);

    setBgImg(await loadMapBackgroundImage({ mp, blobIdToObjectUrl }));

    await loadMapDrawingLayer({ mp, blobIdToObjectUrl, drawCtx, drawLayer });

    renderMap({ canvas, ctx, drawLayer, bgImg: getBgImg() });
  }

  async function switchMap(newId) {
    await commitDrawingSnapshot();
    mapState.activeMapId = newId;
    SaveManager.markDirty(); refreshMapSelect();
    await loadActiveMapIntoCanvas();
  }

  addListener(
    addMapBtn,
    "click",
    safeAsync(async () => {
      const name = await uiPrompt("Name for the new map?", { defaultValue: "New Map", title: "New Map" });
      if (name == null) return;
      const mp = newMapEntry(name.trim() || "New Map");
      mapState.maps.push(mp);
      await switchMap(mp.id);
    }, (err) => {
      console.error(err);
      setStatus("Add map failed.");
    })
  );

  addListener(
    renameMapBtn,
    "click",
    safeAsync(async () => {
      const mp = getActiveMap();
      const name = await uiPrompt("Rename map", { defaultValue: mp.name || "Map", title: "Rename Map" });
      if (name == null) return;
      mp.name = name.trim() || mp.name;
      SaveManager.markDirty(); refreshMapSelect();
    }, (err) => {
      console.error(err);
      setStatus("Rename map failed.");
    })
  );

  addListener(
    deleteMapBtn,
    "click",
    safeAsync(async () => {
      if (mapState.maps.length <= 1) {
        await uiAlert("You must keep at least one map.", { title: "Notice" });
        return;
      }
      const mp = getActiveMap();
      const ok = await uiConfirm(`Delete map "${mp.name || "Map"}"? This cannot be undone.`, { title: "Delete Map", okText: "Delete" });
      if (!ok) return;

      await deleteMapWithBlobCleanup({
        mapState,
        mapId: mp.id,
        SaveManager,
        deleteBlob,
        newMapEntry,
      });

      refreshMapSelect();
      await loadActiveMapIntoCanvas();
    }, (err) => {
      console.error(err);
      setStatus("Delete map failed.");
    })
  );

  addListener(
    mapSelect,
    "change",
    safeAsync(async () => {
      await switchMap(mapSelect.value);
    }, (err) => {
      console.error(err);
      setStatus("Switch map failed.");
    })
  );

  refreshMapSelect();
  loadActiveMapIntoCanvas();

  const destroy = () => { };

  return { refreshMapSelect, loadActiveMapIntoCanvas, switchMap, destroy };
}
