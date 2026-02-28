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
import { createStateActions } from "../../../domain/stateActions.js";
import { requireMany, getNoopDestroyApi } from "../../../utils/domGuards.js";
import { startJumpDebugRun, queueJumpDebugCheckpoints } from "../../../ui/jumpDebug.js";
import * as masonry from "../../../ui/masonryLayout.js";

let _cardsEl = null;
let _state = null;
let _blobIdToObjectUrl = null;

// Optional: Popovers manager, used to enhance native <select> open menus.
let _Popovers = null;

// Injected helper functions.
let _pickLocImage = null;
let _updateLoc = null;
let _setLocPortraitHidden = null;
let _moveLocCard = null;
let _deleteLoc = null;
const MASONRY_OPTIONS = { panelName: "location", minCardWidth: 175, gapVar: "--cards-grid-gap" };

/**
 * Locations toolbar wiring (search / filter / add)
 * Kept in the same module as Location cards to avoid over-splitting.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.addBtn
 * @param {HTMLInputElement} opts.searchEl
 * @param {HTMLSelectElement} opts.filterEl
 * @param {Function} opts.makeLocation
 * @param {Function} opts.render
 */
function initLocationsToolbar({
  addBtn,
  searchEl,
  filterEl,
  makeLocation,
  render,
  renderTabs,
  updateTrackerField,
  addTrackerCard,
  mutateTracker,
}) {
  const s = _state;
  if (!s?.tracker) return;

  // Defaults for persisted toolbar state
  mutateTracker?.((tracker) => {
    if (typeof tracker.locSearch !== "string") tracker.locSearch = "";
    if (typeof tracker.locFilter !== "string") tracker.locFilter = "all";
    if (!Array.isArray(tracker.locationsList)) tracker.locationsList = [];
    return true;
  }, { queueSave: false });

  // Initialize UI from state
  searchEl.value = s.tracker.locSearch;
  filterEl.value = s.tracker.locFilter;

  // Wiring
  searchEl.addEventListener("input", () => {
    updateTrackerField?.("locSearch", searchEl.value);
    if (renderTabs) renderTabs();
    render();
  });

  filterEl.addEventListener("change", () => {
    updateTrackerField?.("locFilter", filterEl.value);
    if (renderTabs) renderTabs();
    render();
  });

  addBtn.addEventListener("click", () => {
    const loc = makeLocation();
    // If sections are enabled, add to the active section.
    if (typeof s.tracker.locActiveSectionId === "string" && s.tracker.locActiveSectionId) {
      loc.sectionId = s.tracker.locActiveSectionId;
    }
    addTrackerCard?.("locations", loc, { atStart: true });
    if (renderTabs) renderTabs();
    render();
  });
}

function initLocationCards(deps = {}) {
  _state = deps.state || _state;
  _cardsEl = deps.cardsEl;
  _pickLocImage = deps.pickLocImage;
  _updateLoc = deps.updateLoc;
  _setLocPortraitHidden = deps.setLocPortraitHidden;
  _moveLocCard = deps.moveLocCard;
  _deleteLoc = deps.deleteLoc;
}

const matchesSearch = makeFieldSearchMatcher(["title", "notes"]);

export function renderLocationCards() {
  if (!_cardsEl) return;
  if (!_state) return;

  const prevScroll = _cardsEl.scrollTop; // keep scroll position
  const shouldMaskRerender = prevScroll > 0;
  if (shouldMaskRerender) _cardsEl.classList.add("cardsRerenderMask");
  const raf = requestAnimationFrame;
  const renderRun = startJumpDebugRun({
    panel: "location",
    cardId: "render",
    action: "render",
    panelEl: _cardsEl,
    getCardEl: () => _cardsEl?.querySelector(".npcCard"),
  });
  renderRun?.log("before-dom-rebuild");
  const sectionId = _state.tracker.locActiveSectionId;
  const q = (_state.tracker.locSearch || "").trim();
  const typeFilter = _state.tracker.locFilter || "all";

  const list = _state.tracker.locationsList
    .filter(l => !sectionId ? true : ((l.sectionId || "") === sectionId))
    .filter(l => typeFilter === "all" ? true : ((l.type || "town") === typeFilter))
    .filter(l => matchesSearch(l, q));

  _cardsEl.innerHTML = "";

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "mutedSmall";
    empty.textContent = q
      ? "No locations match your search in this section."
      : "No locations in this section yet. Click “+ Add Location”.";
    _cardsEl.appendChild(empty);
    masonry.attach(_cardsEl, MASONRY_OPTIONS);
    masonry.relayout(_cardsEl);
    raf(() => raf(() => {
      _cardsEl.scrollTop = prevScroll;
      if (shouldMaskRerender) _cardsEl.classList.remove("cardsRerenderMask");
    }));
    renderRun?.log("after-dom-rebuild-relayout");
    queueJumpDebugCheckpoints(renderRun);
    return;
  }

  list.forEach(loc => _cardsEl.appendChild(renderLocationCard(loc)));
  masonry.attach(_cardsEl, MASONRY_OPTIONS);
  masonry.relayout(_cardsEl);
  raf(() => raf(() => {
    _cardsEl.scrollTop = prevScroll;
    if (shouldMaskRerender) _cardsEl.classList.remove("cardsRerenderMask");
  }));
  renderRun?.log("after-dom-rebuild-relayout");
  queueJumpDebugCheckpoints(renderRun);
}

export function renderLocationCard(loc) {
  // Reuse the same card frame/classes as NPCs/Party
  const card = document.createElement("div");
  card.className = "npcCard npcCardStack";
  card.dataset.cardId = loc.id;

  const isCollapsed = !!loc.collapsed;
  card.classList.toggle("collapsed", isCollapsed);

  const body = document.createElement("div");
  body.className = "npcCardBodyStack";

  // Header row: Location name + collapse toggle
  const headerRow = document.createElement("div");
  headerRow.className = "npcHeaderRow";

  const titleInput = document.createElement("input");
  titleInput.className = "npcField npcNameBig";
  titleInput.placeholder = "Location name (Town, Dungeon, Region...)";
  titleInput.value = loc.title || "";
  titleInput.addEventListener("input", () => _updateLoc(loc.id, { title: titleInput.value }, false));

  const moveUp = createMoveButton({
    direction: -1,
    onMove: () => {
      _moveLocCard(loc.id, -1);
    },
  });

  const moveDown = createMoveButton({
    direction: +1,
    onMove: () => {
      _moveLocCard(loc.id, +1);
    },
  });

  const toggle = createCollapseButton({
    isCollapsed,
    onToggle: () => {
      const action = isCollapsed ? "expand" : "collapse";
      const jumpRun = startJumpDebugRun({
        panel: "location",
        cardId: loc.id,
        action,
        panelEl: _cardsEl,
        getCardEl: () => _cardsEl?.querySelector(`.npcCard[data-card-id="${loc.id}"]`) || card,
      });
      jumpRun?.log("before-click-handler");
      _updateLoc(loc.id, { collapsed: !isCollapsed }, true);
      jumpRun?.log("after-state-update");
      queueJumpDebugCheckpoints(jumpRun);
    },
  });

  headerRow.appendChild(titleInput);
  headerRow.appendChild(moveUp);
  headerRow.appendChild(moveDown);

  const portrait = renderCardPortrait({
    blobId: loc.imgBlobId,
    altText: loc.title || "Location Image",
    blobIdToObjectUrl: _blobIdToObjectUrl,
    onPick: () => _pickLocImage(loc.id),
    isHidden: !!loc.portraitHidden,
    onToggleHidden: (hidden) => _setLocPortraitHidden?.(loc.id, hidden),
    headerControlsEl: headerRow,
  });
  headerRow.appendChild(toggle);

  // Collapsible content
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
  // static-only template (no user text).
  typeSelect.innerHTML = `
    <option value="town">Town</option>
    <option value="dungeon">Dungeon</option>
    <option value="region">Region</option>
    <option value="other">Other</option>
  `;
  typeSelect.value = loc.type || "other";
  typeSelect.addEventListener("change", () => _updateLoc(loc.id, { type: typeSelect.value }));

  typeBlock.appendChild(typeLabel);
  typeBlock.appendChild(typeSelect);

  // Enhance the OPEN menu styling (closed look stays the same size as .cardSelect).
  // Must be called AFTER the select is attached to a parent element.
  enhanceSelectOnce({
    select: typeSelect,
    Popovers: _Popovers,
    enhanceSelectDropdown,
    buttonClass: "cardSelectBtn",
    optionClass: "swatchOption",
    groupLabelClass: "dropdownGroupLabel",
    preferRight: true
  });

  const notesBlock = document.createElement("div");
  notesBlock.className = "npcBlock";

  const notesLabel = document.createElement("div");
  notesLabel.className = "npcMiniLabel";
  notesLabel.textContent = "Notes";

  const notesArea = document.createElement("textarea");
  notesArea.className = "npcTextarea npcNotesBox";
  notesArea.placeholder = "Details, hooks, NPCs here, secrets...";
  notesArea.value = loc.notes || "";
  notesArea.addEventListener("input", () => _updateLoc(loc.id, { notes: notesArea.value }, false));

    // True in-field search highlight is attached for all inputs/textareas
    // near the end of renderLocationCard (after the query getter is defined).

  notesBlock.appendChild(notesLabel);
  notesBlock.appendChild(notesArea);

  const footer = document.createElement("div");
footer.className = "npcCardFooter";

// "Move between sections" dropdown (matches Party/NPC cards).
const { sectionWrap } = createSectionSelectRow({
  sections: _state.tracker.locSections || [],
  value: loc.sectionId || _state.tracker.locActiveSectionId,
  onChange: (newVal) => {
    _updateLoc(loc.id, { sectionId: newVal }, true);
    if (typeof window.renderLocationTabs === "function") window.renderLocationTabs();
  },
  enhanceSelectOnce,
  Popovers: _Popovers,
  enhanceSelectDropdown,
  buttonClass: "cardSelectBtn",
  optionClass: "swatchOption",
  groupLabelClass: "dropdownGroupLabel",
  preferRight: true
});

const del = createDeleteButton({
  className: "npcSmallBtn danger",
  text: "Delete",
  onDelete: () => _deleteLoc(loc.id),
});

  footer.appendChild(sectionWrap);
  footer.appendChild(del);

  // Build collapsible
  collapsible.appendChild(typeBlock);
  collapsible.appendChild(notesBlock);

  body.appendChild(headerRow);
  body.appendChild(collapsible);

  if (portrait) card.appendChild(portrait);
  card.appendChild(body);

  // Footer should also collapse
  footer.hidden = isCollapsed;
  card.appendChild(footer);

  
    // True in-field search highlight (every occurrence)
    const _getLocQuery = () => (_state.tracker.locSearch || "");
    attachCardSearchHighlights({
      cardEl: card,
      getQuery: _getLocQuery,
      attachSearchHighlightOverlay,
      selector: "input, textarea",
    });

return card;
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
    // portrait flow deps
    pickCropStorePortrait,
    ImagePicker,
    deleteBlob,
    putBlob,
    cropImageModal,
    getPortraitAspect,
    setStatus,
    blobIdToObjectUrl,
  } = deps;
  _state = deps.state;
  _blobIdToObjectUrl = blobIdToObjectUrl || _blobIdToObjectUrl;
  if (!_state) throw new Error("initLocationsPanel requires state");
  if (!_blobIdToObjectUrl) throw new Error("initLocationsPanel requires blobIdToObjectUrl");
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
  } = createStateActions({ state: _state, SaveManager });

  // store Popovers for dynamic card dropdown enhancements
  _Popovers = Popovers || null;

  mutateTracker((tracker) => {
    // Migrate legacy textarea content into a location card (only once).
    if (!Array.isArray(tracker.locationsList)) tracker.locationsList = [];
    if (typeof tracker.locSearch !== "string") tracker.locSearch = "";
    if (typeof tracker.locFilter !== "string") tracker.locFilter = "all";

    // Location sections (like Party)
    if (!Array.isArray(tracker.locSections) || tracker.locSections.length === 0) {
      tracker.locSections = [{
        id: "locsec_" + Math.random().toString(36).slice(2) + Date.now().toString(36),
        name: "Main"
      }];
    }
    if (typeof tracker.locActiveSectionId !== "string" || !tracker.locActiveSectionId) {
      tracker.locActiveSectionId = tracker.locSections[0].id;
    }
    if (!tracker.locSections.some(s => s.id === tracker.locActiveSectionId)) {
      tracker.locActiveSectionId = tracker.locSections[0].id;
    }
    // Ensure all locations belong to a section
    const defaultSectionId = tracker.locSections[0].id;
    tracker.locationsList.forEach(l => {
      if (!l.sectionId) l.sectionId = defaultSectionId;
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
    deleteSectionBtn: "#deleteLocSectionBtn"
  };
  const guard = requireMany(required, { root: document, setStatus, context: "Locations panel" });
  if (!guard.ok) return guard.destroy;
  const {
    cardsEl,
    addBtn,
    searchEl,
    filterEl,
    tabsEl,
    addSectionBtn,
    renameSectionBtn,
    deleteSectionBtn
  } = guard.els;
  masonry.attach(cardsEl, MASONRY_OPTIONS);

  // Enhance the type filter so its OPEN menu matches the Map Tools dropdown.
  // Closed control keeps the same size as the panel header select.
  if (filterEl && Popovers && !filterEl.dataset.dropdownEnhanced) {
    enhanceSelectDropdown({
      select: filterEl,
      Popovers,
      buttonClass: "panelSelectBtn",
      optionClass: "swatchOption",
      groupLabelClass: "dropdownGroupLabel",
      preferRight: false
    });
  }

  // (filterEl enhancement handled above)

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
    renderLocationCards();
  }

  function moveLocCard(id, dir) {
    const sectionId = _state.tracker.locActiveSectionId;
    const q = (_state.tracker.locSearch || "").trim();
    const typeFilter = _state.tracker.locFilter || "all";

    const visible = _state.tracker.locationsList
      .filter(l => (l.sectionId || "") === sectionId)
      .filter(l => typeFilter === "all" ? true : ((l.type || "town") === typeFilter))
      .filter(l => matchesSearch(l, q));

    const pos = visible.findIndex(l => l.id === id);
    const newPos = pos + dir;
    if (pos === -1 || newPos < 0 || newPos >= visible.length) return;
    const action = dir < 0 ? "moveUp" : "moveDown";
    const jumpRun = startJumpDebugRun({
      panel: "location",
      cardId: id,
      action,
      panelEl: _cardsEl,
      getCardEl: () => _cardsEl?.querySelector(`.npcCard[data-card-id="${id}"]`),
    });
    jumpRun?.log("before-swap");

    const aId = visible[pos].id;
    const bId = visible[newPos].id;

    if (!swapTrackerCards("locations", aId, bId)) return;
    jumpRun?.log("after-swap");
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
      getItemById: (locId) => _state?.tracker?.locationsList?.find(l => l.id === locId) || null,
      getBlobId: (loc) => loc.imgBlobId,
      setBlobId: (_loc, blobId) => {
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
    const loc = _state.tracker.locationsList.find(l => l.id === id);
    if (!loc) return;

    if (uiConfirm) {
      const ok = await uiConfirm(`Delete location "${loc.title || "Unnamed"}"?`, { title: "Delete Location", okText: "Delete" });
      if (!ok) return;
    }

    if (loc.imgBlobId && deleteBlob) {
      try { await deleteBlob(loc.imgBlobId); }
      catch (err) { console.warn("Failed to delete location image blob:", err); }
    }

    if (!removeTrackerCard("locations", id)) return;
    renderLocTabs();
    renderLocationCards();
  }

  initLocationCards({
    cardsEl,
    pickLocImage,
    updateLoc,
    setLocPortraitHidden,
    moveLocCard,
    deleteLoc
  });

  function setActiveSection(sectionId) {
    updateTrackerField("locActiveSectionId", sectionId);
    renderLocTabs();
    renderLocationCards();
  }

  function renderLocTabs() {
    const query = (_state.tracker.locSearch || "");
    const typeFilter = _state.tracker.locFilter || "all";
    renderSectionTabs({
      tabsEl,
      sections: _state.tracker.locSections || [],
      activeId: _state.tracker.locActiveSectionId,
      query,
      tabClass: "npcTab",
      sectionMatches: (sec, query) =>
        _state.tracker.locationsList.some(l => {
          if (l.sectionId !== sec.id) return false;
          if (typeFilter !== "all" && (l.type || "town") !== typeFilter) return false;
          return matchesSearch(l, query);
        }),
      onSelect: (id) => setActiveSection(id),
    });
  }

  // Allow cards/actions to refresh tabs if needed.
  window.renderLocTabs = renderLocTabs;

  // Section buttons
  wireSectionCrud({
    state: _state,
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
        tracker.locationsList.forEach(l => {
          if (l.sectionId === deleteId) l.sectionId = fallbackId;
        });
        return true;
      }, { queueSave: false });
    },
  });

  // Toolbar (search / filter / add)
  initLocationsToolbar({
    addBtn,
    searchEl,
    filterEl,
    makeLocation,
    renderTabs: () => renderLocTabs(),
    render: () => renderLocationCards(),
    updateTrackerField,
    addTrackerCard,
    mutateTracker,
  });

  // Initial render
  renderLocTabs();
  renderLocationCards();
  return { updateLoc, pickLocImage, deleteLoc };
}
