// Location cards panel renderer and wiring.
// Dependencies are injected by initLocationsPanel so this module stays page-agnostic.

import { enhanceSelectDropdown } from "../../../ui/selectDropdown.js";
import { attachSearchHighlightOverlay } from "../../../ui/searchHighlightOverlay.js";
import { renderSectionTabs, wireSectionCrud } from "./cards/shared/cardsShared.js";
import { pickAndStorePortrait } from "./cards/shared/cardPortraitShared.js";
import { makeFieldSearchMatcher } from "./cards/shared/cardSearchShared.js";
import { attachCardSearchHighlights } from "./cards/shared/cardSearchHighlightShared.js";
import { createMoveButton, createCollapseButton } from "./cards/shared/cardHeaderControlsShared.js";
import { enhanceSelectOnce } from "./cards/shared/cardSelectShared.js";
import { createDeleteButton, createSectionSelectRow } from "./cards/shared/cardFooterShared.js";
import { renderCardPortrait } from "./cards/shared/cardPortraitRenderShared.js";
import { createCardIncrementalDomPatcher } from "./cards/shared/cardIncrementalPatchShared.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { requireMany } from "../../../utils/domGuards.js";
import { startJumpDebugRun, queueJumpDebugCheckpoints } from "../../../ui/jumpDebug.js";
import * as masonry from "../../../ui/masonryLayout.js";

const USE_INCREMENTAL_CARDS = true;
const USE_INCREMENTAL_PORTRAIT = true;
const USE_INCREMENTAL_REORDER = true;
const MASONRY_OPTIONS = { panelName: "location", minCardWidth: 175, gapVar: "--cards-grid-gap" };
const matchesSearch = makeFieldSearchMatcher(["title", "notes"]);

function createLocationCardsController(deps = {}) {
  const {
    state,
    SaveManager,
    Popovers,
    uiPrompt,
    uiAlert,
    uiConfirm,
    setStatus,
    makeLocation,
    pickCropStorePortrait,
    ImagePicker,
    deleteBlob,
    putBlob,
    cropImageModal,
    getPortraitAspect,
    blobIdToObjectUrl,
    cardsEl,
    addBtn,
    searchEl,
    filterEl,
    tabsEl,
    addSectionBtn,
    renameSectionBtn,
    deleteSectionBtn,
    updateTrackerField,
    updateTrackerCardField,
    setCardPortraitHidden,
    addTrackerCard,
    removeTrackerCard,
    swapTrackerCards,
    mutateTracker,
  } = deps;

  const listenerController = new AbortController();
  const listenerSignal = listenerController.signal;
  /** @type {Array<() => void>} */
  const destroyFns = [];
  let initialized = false;
  let destroyed = false;
  let filterDropdownApi = null;
  const addDestroy = (destroyFn) => {
    if (typeof destroyFn === "function") destroyFns.push(destroyFn);
  };
  const addListener = (target, type, handler, options) => {
    if (!target || typeof target.addEventListener !== "function") return;
    const listenerOptions =
      typeof options === "boolean"
        ? { capture: options }
        : (options || {});
    target.addEventListener(type, handler, { ...listenerOptions, signal: listenerSignal });
  };
  addDestroy(() => listenerController.abort());
  addDestroy(() => {
    try { filterDropdownApi?.destroy?.(); } catch { /* noop */ }
    filterDropdownApi = null;
  });
  addDestroy(() => masonry.detach(cardsEl));

  const getLocationById = (locationId) => state?.tracker?.locationsList?.find((location) => location.id === locationId) || null;
  const getSearchQuery = () => (state?.tracker?.locSearch || "").trim();
  const getTypeFilter = () => state?.tracker?.locFilter || "all";
  const getVisibleLocations = () => {
    const sectionId = state.tracker.locActiveSectionId;
    const query = getSearchQuery();
    const typeFilter = getTypeFilter();
    return state.tracker.locationsList
      .filter((location) => !sectionId ? true : ((location.sectionId || "") === sectionId))
      .filter((location) => typeFilter === "all" ? true : ((location.type || "town") === typeFilter))
      .filter((location) => matchesSearch(location, query));
  };
  const cardDomPatcher = createCardIncrementalDomPatcher({
    cardsEl,
    blobIdToObjectUrl,
  });
  const scheduleLocationMasonryRelayout = () => cardDomPatcher.scheduleMasonryRelayout();
  const focusLocationCardCollapseButton = (cardId, fallbackEl = null) => cardDomPatcher.focusCollapseButton(cardId, fallbackEl);
  const patchLocationCardReorder = (cardId, adjacentId, dir) => cardDomPatcher.patchReorder(cardId, adjacentId, dir);
  const patchLocationCardCollapsed = (cardId, collapsed, focusEl = null) => cardDomPatcher.patchCollapsed(cardId, collapsed, focusEl);
  const patchLocationCardPortrait = (cardId, hidden, focusEl = null) => cardDomPatcher.patchPortrait({
    cardId,
    hidden,
    focusEl,
    getItemById: getLocationById,
    getBlobId: (location) => location.imgBlobId,
    getAltText: (location) => location.title || "Location Image",
    onPick: (location) => pickLocImage(location.id),
    onToggleHidden: (location, nextHidden) => setLocPortraitHidden(location.id, nextHidden),
  });

  function renderLocationCards() {
    if (!state) return;

    const prevScroll = cardsEl.scrollTop;
    const shouldMaskRerender = prevScroll > 0;
    if (shouldMaskRerender) cardsEl.classList.add("cardsRerenderMask");

    const raf = requestAnimationFrame;
    const renderRun = startJumpDebugRun({
      panel: "location",
      cardId: "render",
      action: "render",
      panelEl: cardsEl,
      getCardEl: () => cardsEl?.querySelector(".trackerCard"),
    });
    renderRun?.log("before-dom-rebuild");

    const query = getSearchQuery();
    const list = getVisibleLocations();
    cardsEl.innerHTML = "";

    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "mutedSmall";
      empty.textContent = query
        ? "No locations match your search in this section."
        : "No locations in this section yet. Click “+ Add Location”.";
      cardsEl.appendChild(empty);
      masonry.attach(cardsEl, MASONRY_OPTIONS);
      masonry.relayout(cardsEl);
      raf(() => raf(() => {
        cardsEl.scrollTop = prevScroll;
        if (shouldMaskRerender) cardsEl.classList.remove("cardsRerenderMask");
      }));
      renderRun?.log("after-dom-rebuild-relayout");
      queueJumpDebugCheckpoints(renderRun);
      return;
    }

    list.forEach((location) => cardsEl.appendChild(renderLocationCard(location)));
    masonry.attach(cardsEl, MASONRY_OPTIONS);
    masonry.relayout(cardsEl);
    raf(() => raf(() => {
      cardsEl.scrollTop = prevScroll;
      if (shouldMaskRerender) cardsEl.classList.remove("cardsRerenderMask");
    }));
    renderRun?.log("after-dom-rebuild-relayout");
    queueJumpDebugCheckpoints(renderRun);
  }

  function updateLoc(id, patch, rerender = true) {
    const updates = Object.entries(patch || {});
    if (!updates.length) return;

    let changed = false;
    updates.forEach(([field, value]) => {
      if (updateTrackerCardField("locations", id, field, value, { queueSave: false })) {
        changed = true;
      }
    });
    if (!changed) return;

    SaveManager.markDirty();
    if (rerender) renderLocationCards();
  }

  function setLocPortraitHidden(id, hidden) {
    if (!setCardPortraitHidden("locations", id, hidden, { queueSave: false })) return;
    SaveManager.markDirty();
    const focusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (USE_INCREMENTAL_CARDS && USE_INCREMENTAL_PORTRAIT && patchLocationCardPortrait(id, hidden, focusEl)) return;
    renderLocationCards();
  }

  function moveLocCard(id, dir) {
    const visible = getVisibleLocations();
    const pos = visible.findIndex((location) => location.id === id);
    const newPos = pos + dir;
    if (pos === -1 || newPos < 0 || newPos >= visible.length) return;

    const action = dir < 0 ? "moveUp" : "moveDown";
    const jumpRun = startJumpDebugRun({
      panel: "location",
      cardId: id,
      action,
      panelEl: cardsEl,
      getCardEl: () => cardsEl?.querySelector(`.trackerCard[data-card-id="${id}"]`),
    });
    jumpRun?.log("before-swap");

    const aId = visible[pos].id;
    const bId = visible[newPos].id;

    if (!swapTrackerCards("locations", aId, bId)) return;
    jumpRun?.log("after-swap");

    if (USE_INCREMENTAL_CARDS && USE_INCREMENTAL_REORDER && patchLocationCardReorder(aId, bId, dir)) {
      jumpRun?.log("after-incremental-reorder");
      queueJumpDebugCheckpoints(jumpRun);
      return;
    }

    renderLocationCards();
    jumpRun?.log("after-render");
    queueJumpDebugCheckpoints(jumpRun);
  }

  async function pickLocImage(id) {
    if (!pickCropStorePortrait || !ImagePicker || !cropImageModal || !getPortraitAspect || !deleteBlob || !putBlob) {
      console.warn("Location portrait flow dependencies missing; cannot pick image.");
      return;
    }

    let pickedBlobId = null;
    const ok = await pickAndStorePortrait({
      itemId: id,
      getItemById: getLocationById,
      getBlobId: (location) => location.imgBlobId,
      setBlobId: (_location, blobId) => {
        pickedBlobId = blobId;
      },
      deps: {
        pickCropStorePortrait,
        ImagePicker,
        deleteBlob,
        putBlob,
        cropImageModal,
        getPortraitAspect,
      },
      setStatus,
    });
    if (!ok) return;
    updateLoc(id, { imgBlobId: pickedBlobId });
  }

  async function deleteLoc(id) {
    const location = getLocationById(id);
    if (!location) return;

    if (uiConfirm) {
      const ok = await uiConfirm(`Delete location "${location.title || "Unnamed"}"?`, { title: "Delete Location", okText: "Delete" });
      if (!ok) return;
    }

    if (location.imgBlobId && deleteBlob) {
      try { await deleteBlob(location.imgBlobId); }
      catch (err) { console.warn("Failed to delete location image blob:", err); }
    }

    if (!removeTrackerCard("locations", id)) return;
    renderLocTabs();
    renderLocationCards();
  }

  function renderLocationCard(location) {
    const card = document.createElement("div");
    card.className = "trackerCard npcCardStack";
    card.dataset.cardId = location.id;

    const isCollapsed = !!location.collapsed;
    card.classList.toggle("collapsed", isCollapsed);

    const body = document.createElement("div");
    body.className = "npcCardBodyStack";

    const headerRow = document.createElement("div");
    headerRow.className = "npcHeaderRow";

    const titleInput = document.createElement("input");
    titleInput.className = "npcField npcNameBig";
    titleInput.placeholder = "Location name (Town, Dungeon, Region...)";
    titleInput.value = location.title || "";
    titleInput.addEventListener("input", () => updateLoc(location.id, { title: titleInput.value }, false));

    const moveUp = createMoveButton({
      direction: -1,
      onMove: () => {
        moveLocCard(location.id, -1);
      },
    });

    const moveDown = createMoveButton({
      direction: +1,
      onMove: () => {
        moveLocCard(location.id, +1);
      },
    });

    const toggle = createCollapseButton({
      isCollapsed,
      onToggle: () => {
        const currentCollapsed = !!getLocationById(location.id)?.collapsed;
        const nextCollapsed = !currentCollapsed;
        const action = currentCollapsed ? "expand" : "collapse";
        const jumpRun = startJumpDebugRun({
          panel: "location",
          cardId: location.id,
          action,
          panelEl: cardsEl,
          getCardEl: () => cardsEl?.querySelector(`.trackerCard[data-card-id="${location.id}"]`) || card,
        });
        jumpRun?.log("before-click-handler");

        updateLoc(location.id, { collapsed: nextCollapsed }, false);
        jumpRun?.log("after-state-update");

        if (USE_INCREMENTAL_CARDS && patchLocationCardCollapsed(location.id, nextCollapsed, toggle)) {
          jumpRun?.log("after-incremental-patch");
          queueJumpDebugCheckpoints(jumpRun);
          return;
        }

        renderLocationCards();
        jumpRun?.log("after-render");
        focusLocationCardCollapseButton(location.id);
        queueJumpDebugCheckpoints(jumpRun);
      },
    });

    headerRow.appendChild(titleInput);
    headerRow.appendChild(moveUp);
    headerRow.appendChild(moveDown);

    const portrait = renderCardPortrait({
      blobId: location.imgBlobId,
      altText: location.title || "Location Image",
      blobIdToObjectUrl,
      onPick: () => pickLocImage(location.id),
      isHidden: !!location.portraitHidden,
      onToggleHidden: (hidden) => setLocPortraitHidden(location.id, hidden),
      headerControlsEl: headerRow,
      onImageLoad: scheduleLocationMasonryRelayout,
    });
    headerRow.appendChild(toggle);

    const collapsible = document.createElement("div");
    collapsible.className = "npcCollapsible";
    collapsible.hidden = isCollapsed;

    const typeBlock = document.createElement("div");
    typeBlock.className = "npcBlock";

    const typeLabel = document.createElement("div");
    typeLabel.className = "npcMiniLabel";
    typeLabel.textContent = "Type";

    const typeSelect = document.createElement("select");
    typeSelect.className = "cardSelect";
    typeSelect.innerHTML = `
    <option value="town">Town</option>
    <option value="dungeon">Dungeon</option>
    <option value="region">Region</option>
    <option value="other">Other</option>
  `;
    typeSelect.value = location.type || "other";
    typeSelect.addEventListener("change", () => updateLoc(location.id, { type: typeSelect.value }));

    typeBlock.appendChild(typeLabel);
    typeBlock.appendChild(typeSelect);

    enhanceSelectOnce({
      select: typeSelect,
      Popovers,
      enhanceSelectDropdown,
      buttonClass: "cardSelectBtn",
      optionClass: "swatchOption",
      groupLabelClass: "dropdownGroupLabel",
      preferRight: true,
    });

    const notesBlock = document.createElement("div");
    notesBlock.className = "npcBlock";

    const notesLabel = document.createElement("div");
    notesLabel.className = "npcMiniLabel";
    notesLabel.textContent = "Notes";

    const notesArea = document.createElement("textarea");
    notesArea.className = "npcTextarea npcNotesBox";
    notesArea.placeholder = "Details, hooks, NPCs here, secrets...";
    notesArea.value = location.notes || "";
    notesArea.addEventListener("input", () => updateLoc(location.id, { notes: notesArea.value }, false));

    notesBlock.appendChild(notesLabel);
    notesBlock.appendChild(notesArea);

    const footer = document.createElement("div");
    footer.className = "npcCardFooter";

    const { sectionWrap } = createSectionSelectRow({
      sections: state.tracker.locSections || [],
      value: location.sectionId || state.tracker.locActiveSectionId,
      onChange: (newVal) => {
        updateLoc(location.id, { sectionId: newVal }, true);
        renderLocTabs();
      },
      enhanceSelectOnce,
      Popovers,
      enhanceSelectDropdown,
      buttonClass: "cardSelectBtn",
      optionClass: "swatchOption",
      groupLabelClass: "dropdownGroupLabel",
      preferRight: true,
    });

    const del = createDeleteButton({
      className: "npcSmallBtn danger",
      text: "Delete",
      onDelete: () => deleteLoc(location.id),
    });

    footer.appendChild(sectionWrap);
    footer.appendChild(del);

    collapsible.appendChild(typeBlock);
    collapsible.appendChild(notesBlock);

    body.appendChild(headerRow);
    body.appendChild(collapsible);

    if (portrait) card.appendChild(portrait);
    card.appendChild(body);

    footer.hidden = isCollapsed;
    card.appendChild(footer);

    attachCardSearchHighlights({
      cardEl: card,
      getQuery: () => (state.tracker.locSearch || ""),
      attachSearchHighlightOverlay,
      selector: "input, textarea",
    });

    return card;
  }

  function setActiveSection(sectionId) {
    updateTrackerField("locActiveSectionId", sectionId);
    renderLocTabs();
    renderLocationCards();
  }

  function renderLocTabs() {
    const query = state.tracker.locSearch || "";
    const typeFilter = getTypeFilter();
    renderSectionTabs({
      tabsEl,
      sections: state.tracker.locSections || [],
      activeId: state.tracker.locActiveSectionId,
      query,
      tabClass: "npcTab",
      sectionMatches: (sec, query) =>
        state.tracker.locationsList.some((location) => {
          if (location.sectionId !== sec.id) return false;
          if (typeFilter !== "all" && (location.type || "town") !== typeFilter) return false;
          return matchesSearch(location, query);
        }),
      onSelect: (id) => setActiveSection(id),
    });
  }

  function setSearch(query) {
    updateTrackerField("locSearch", query);
    renderLocTabs();
    renderLocationCards();
  }

  function setFilter(filter) {
    updateTrackerField("locFilter", filter);
    renderLocTabs();
    renderLocationCards();
  }

  function addLocation() {
    const location = makeLocation();
    if (typeof state.tracker.locActiveSectionId === "string" && state.tracker.locActiveSectionId) {
      location.sectionId = state.tracker.locActiveSectionId;
    }
    addTrackerCard("locations", location, { atStart: true });
    renderLocTabs();
    renderLocationCards();
  }

  function initToolbar() {
    mutateTracker((tracker) => {
      if (typeof tracker.locSearch !== "string") tracker.locSearch = "";
      if (typeof tracker.locFilter !== "string") tracker.locFilter = "all";
      if (!Array.isArray(tracker.locationsList)) tracker.locationsList = [];
      return true;
    }, { queueSave: false });

    searchEl.value = state.tracker.locSearch;
    filterEl.value = state.tracker.locFilter;

    addListener(searchEl, "input", () => {
      setSearch(searchEl.value);
    });

    addListener(filterEl, "change", () => {
      setFilter(filterEl.value);
    });

    addListener(addBtn, "click", () => {
      addLocation();
    });
  }

  function init() {
    if (initialized || destroyed) return;
    initialized = true;

    masonry.attach(cardsEl, MASONRY_OPTIONS);

    if (filterEl && Popovers && !filterEl.dataset.dropdownEnhanced) {
      filterDropdownApi = enhanceSelectDropdown({
        select: filterEl,
        Popovers,
        buttonClass: "panelSelectBtn",
        optionClass: "swatchOption",
        groupLabelClass: "dropdownGroupLabel",
        preferRight: false,
      });
    }

    wireSectionCrud({
      state,
      SaveManager,
      uiPrompt,
      uiAlert,
      uiConfirm,
      setStatus,
      addSectionBtn,
      renameSectionBtn,
      deleteSectionBtn,
      sectionsKey: "locSections",
      activeKey: "locActiveSectionId",
      idPrefix: "locsec",
      newTitle: "New Location Section",
      renameTitle: "Rename Location Section",
      deleteTitle: "Delete Location Section",
      deleteConfirmText: (secName) => `Delete section "${secName}"? Locations in it will be moved to the first section.`,
      renderTabs: renderLocTabs,
      renderCards: renderLocationCards,
      onDeleteMoveItems: (deleteId, fallbackId) => {
        mutateTracker((tracker) => {
          tracker.locationsList.forEach((location) => {
            if (location.sectionId === deleteId) location.sectionId = fallbackId;
          });
          return true;
        }, { queueSave: false });
      },
      listenerSignal,
    });

    initToolbar();
    renderLocTabs();
    renderLocationCards();
  }

  return {
    init,
    render() {
      renderLocationCards();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      initialized = false;
      for (let i = destroyFns.length - 1; i >= 0; i--) {
        destroyFns[i]?.();
      }
    },
  };
}

// Initialize Locations panel wiring + CRUD handlers.
export function initLocationsPanel(deps = {}) {
  const {
    SaveManager,
    Popovers,
    uiPrompt,
    uiAlert,
    uiConfirm,
    makeLocation,
    pickCropStorePortrait,
    ImagePicker,
    deleteBlob,
    putBlob,
    cropImageModal,
    getPortraitAspect,
    setStatus,
    blobIdToObjectUrl,
  } = deps;
  const state = deps.state;

  if (!state) throw new Error("initLocationsPanel requires state");
  if (!blobIdToObjectUrl) throw new Error("initLocationsPanel requires blobIdToObjectUrl");
  if (!SaveManager) throw new Error("initLocationsPanel: missing SaveManager");
  if (!makeLocation) throw new Error("initLocationsPanel: missing makeLocation");

  const {
    updateTrackerField,
    updateTrackerCardField,
    setCardPortraitHidden,
    addTrackerCard,
    removeTrackerCard,
    swapTrackerCards,
    mutateTracker,
  } = createStateActions({ state, SaveManager });

  mutateTracker((tracker) => {
    if (!Array.isArray(tracker.locationsList)) tracker.locationsList = [];
    if (typeof tracker.locSearch !== "string") tracker.locSearch = "";
    if (typeof tracker.locFilter !== "string") tracker.locFilter = "all";

    if (!Array.isArray(tracker.locSections) || tracker.locSections.length === 0) {
      tracker.locSections = [{
        id: "locsec_" + Math.random().toString(36).slice(2) + Date.now().toString(36),
        name: "Main",
      }];
    }
    if (typeof tracker.locActiveSectionId !== "string" || !tracker.locActiveSectionId) {
      tracker.locActiveSectionId = tracker.locSections[0].id;
    }
    if (!tracker.locSections.some((section) => section.id === tracker.locActiveSectionId)) {
      tracker.locActiveSectionId = tracker.locSections[0].id;
    }

    const defaultSectionId = tracker.locSections[0].id;
    tracker.locationsList.forEach((location) => {
      if (!location.sectionId) location.sectionId = defaultSectionId;
    });

    if (typeof tracker.locations === "string") {
      const old = tracker.locations.trim();
      if (old && tracker.locationsList.length === 0) {
        tracker.locationsList.push(makeLocation({ title: "Imported Locations", notes: old }));
      }
    }
    return true;
  }, { queueSave: false });

  const required = {
    cardsEl: "#locCards",
    addBtn: "#addLocBtn",
    searchEl: "#locSearch",
    filterEl: "#locFilter",
    tabsEl: "#locTabs",
    addSectionBtn: "#addLocSectionBtn",
    renameSectionBtn: "#renameLocSectionBtn",
    deleteSectionBtn: "#deleteLocSectionBtn",
  };
  const guard = requireMany(required, { root: document, setStatus, context: "Locations panel" });
  if (!guard.ok) return guard.destroy;

  const controller = createLocationCardsController({
    state,
    SaveManager,
    Popovers: Popovers || null,
    uiPrompt,
    uiAlert,
    uiConfirm,
    setStatus,
    makeLocation,
    pickCropStorePortrait,
    ImagePicker,
    deleteBlob,
    putBlob,
    cropImageModal,
    getPortraitAspect,
    blobIdToObjectUrl,
    ...guard.els,
    updateTrackerField,
    updateTrackerCardField,
    setCardPortraitHidden,
    addTrackerCard,
    removeTrackerCard,
    swapTrackerCards,
    mutateTracker,
  });

  controller.init();

  return {
    render() {
      controller.render();
    },
    destroy() {
      controller.destroy();
    },
  };
}
