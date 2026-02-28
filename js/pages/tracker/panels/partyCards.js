// Party cards panel renderer and wiring.
// Dependencies are injected by initPartyPanel so this module stays page-agnostic.

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
let _autoSizeInput = null;

// Optional: Popovers manager, used to enhance native <select> open menus.
let _Popovers = null;

// Injected helper functions.
let _matchesSearch = null;
let _enhanceNumberSteppers = null;
let _pickPartyImage = null;
let _updateParty = null;
let _setPartyPortraitHidden = null;
let _movePartyCard = null;
let _deleteParty = null;
let _numberOrNull = null;
let _renderPartyTabs = null;
const MASONRY_OPTIONS = { panelName: "party", minCardWidth: 175, gapVar: "--cards-grid-gap" };

const matchesSearch = makeFieldSearchMatcher(["name", "className", "status", "notes"]);

function initPartyCards(deps = {}) {
  _state = deps.state || _state;
  _cardsEl = deps.cardsEl;
  _matchesSearch = deps.matchesSearch;
  _enhanceNumberSteppers = deps.enhanceNumberSteppers;
  _pickPartyImage = deps.pickPartyImage;
  _updateParty = deps.updateParty;
  _setPartyPortraitHidden = deps.setPartyPortraitHidden;
  _movePartyCard = deps.movePartyCard;
  _deleteParty = deps.deleteParty;
  _numberOrNull = deps.numberOrNull;
  _renderPartyTabs = deps.renderPartyTabs;
}

export function renderPartyCards() {
  if (!_cardsEl) return;
  if (!_state) return;

  const prevScroll = _cardsEl.scrollTop; // keep scroll position
  const shouldMaskRerender = prevScroll > 0;
  if (shouldMaskRerender) _cardsEl.classList.add("cardsRerenderMask");
  const raf = requestAnimationFrame;
  const renderRun = startJumpDebugRun({
    panel: "party",
    cardId: "render",
    action: "render",
    panelEl: _cardsEl,
    getCardEl: () => _cardsEl?.querySelector(".npcCard"),
  });
  renderRun?.log("before-dom-rebuild");
  const q = (_state.tracker.partySearch || "").trim();
  const sectionId = _state.tracker.partyActiveSectionId;

  const list = _state.tracker.party
    .filter(m => m.sectionId === sectionId)
    .filter(m => _matchesSearch ? _matchesSearch(m, q) : true);

  _cardsEl.innerHTML = "";

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "mutedSmall";
    empty.textContent = q
      ? "No party members match your search in this section."
      : "No party members in this section yet. Click “+ Add Member”.";
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

  list.forEach(m => _cardsEl.appendChild(renderPartyCard(m)));
  if (_enhanceNumberSteppers) _enhanceNumberSteppers(_cardsEl);
  masonry.attach(_cardsEl, MASONRY_OPTIONS);
  masonry.relayout(_cardsEl);
  raf(() => raf(() => {
    _cardsEl.scrollTop = prevScroll;
    if (shouldMaskRerender) _cardsEl.classList.remove("cardsRerenderMask");
  }));
  renderRun?.log("after-dom-rebuild-relayout");
  queueJumpDebugCheckpoints(renderRun);
}

function numberOrNull(v) {
  return _numberOrNull ? _numberOrNull(v) : (v === "" || v == null ? null : Number(v));
}

function renderPartyCard(m) {
  // Reuse the NPC card styling classes so it looks identical
  const card = document.createElement("div");
  card.className = "npcCard npcCardStack";
  card.dataset.cardId = m.id;

  const isCollapsed = !!m.collapsed;
  card.classList.toggle("collapsed", isCollapsed);

  const body = document.createElement("div");
  body.className = "npcCardBodyStack";

  const headerRow = document.createElement("div");
  headerRow.className = "npcHeaderRow";

  const nameInput = document.createElement("input");
  nameInput.className = "npcField npcNameBig";
  nameInput.placeholder = "Name";
  nameInput.value = m.name || "";
  nameInput.addEventListener("input", () => _updateParty(m.id, { name: nameInput.value }, false));

  const moveUp = createMoveButton({
    direction: -1,
    onMove: () => {
      _movePartyCard(m.id, -1);
    },
  });

  const moveDown = createMoveButton({
    direction: +1,
    onMove: () => {
      _movePartyCard(m.id, +1);
    },
  });

  const toggle = createCollapseButton({
    isCollapsed,
    onToggle: () => {
      const action = isCollapsed ? "expand" : "collapse";
      const jumpRun = startJumpDebugRun({
        panel: "party",
        cardId: m.id,
        action,
        panelEl: _cardsEl,
        getCardEl: () => _cardsEl?.querySelector(`.npcCard[data-card-id="${m.id}"]`) || card,
      });
      jumpRun?.log("before-click-handler");
      _updateParty(m.id, { collapsed: !isCollapsed }, true);
      jumpRun?.log("after-state-update");
      queueJumpDebugCheckpoints(jumpRun);
    },
  });

  headerRow.appendChild(nameInput);
  headerRow.appendChild(moveUp);
  headerRow.appendChild(moveDown);

  const portrait = renderCardPortrait({
    blobId: m.imgBlobId,
    altText: m.name || "Party Member Portrait",
    blobIdToObjectUrl: _blobIdToObjectUrl,
    onPick: () => _pickPartyImage(m.id),
    isHidden: !!m.portraitHidden,
    onToggleHidden: (hidden) => _setPartyPortraitHidden?.(m.id, hidden),
    headerControlsEl: headerRow,
  });
  headerRow.appendChild(toggle);

  const collapsible = document.createElement("div");
  collapsible.className = "npcCollapsible";
  collapsible.hidden = isCollapsed;

  //   const classRow = … through notesBlock …

  const classRow = document.createElement("div");
  classRow.className = "npcRowBlock";

  const classLabel = document.createElement("div");
  classLabel.className = "npcMiniLabel";
  classLabel.textContent = "Class";

  const classInput = document.createElement("input");
  classInput.className = "npcField npcClass";
  classInput.placeholder = "Class / Role";
  classInput.value = m.className || "";
  classInput.classList.add("autosize");
  _autoSizeInput(classInput, { min: 60, max: 200 });
  classInput.addEventListener("input", () => _updateParty(m.id, { className: classInput.value }, false));

  classRow.appendChild(classLabel);
  classRow.appendChild(classInput);

  const hpRow = document.createElement("div");
  hpRow.className = "npcRowBlock npcHpRow";

  const hpLabel = document.createElement("div");
  hpLabel.className = "npcMiniLabel";
  hpLabel.textContent = "HP";

  const hpWrap = document.createElement("div");
  hpWrap.className = "npcHpWrap";

  const hpCur = document.createElement("input");
  hpCur.className = "npcField npcHpInput";
  hpCur.classList.add("num-lg");
  hpCur.classList.add("autosize");
  hpCur.type = "number";
  hpCur.placeholder = "Cur";
  hpCur.value = m.hpCurrent ?? "";
  _autoSizeInput(hpCur, { min: 30, max: 70 });
  hpCur.addEventListener("input", () => { _autoSizeInput(hpCur, { min: 30, max: 70 }); _updateParty(m.id, { hpCurrent: numberOrNull(hpCur.value) }, false); });

  const slash = document.createElement("span");
  slash.className = "muted";
  slash.textContent = "/";

  const hpMax = document.createElement("input");
  hpMax.className = "npcField npcHpInput";
  hpMax.classList.add("num-lg");
  hpMax.classList.add("autosize");
  hpMax.type = "number";
  hpMax.placeholder = "Max";
  hpMax.value = m.hpMax ?? "";
  _autoSizeInput(hpMax, { min: 30, max: 70 });
  hpMax.addEventListener("input", () => { _autoSizeInput(hpMax, { min: 30, max: 70 }); _updateParty(m.id, { hpMax: numberOrNull(hpMax.value) }, false); });

  hpWrap.appendChild(hpCur);
  hpWrap.appendChild(slash);
  hpWrap.appendChild(hpMax);

  hpRow.appendChild(hpLabel);
  hpRow.appendChild(hpWrap);

  const statusRow = document.createElement("div");
  statusRow.className = "npcRowBlock";

  const statusLabel = document.createElement("div");
  statusLabel.className = "npcMiniLabel";
  statusLabel.textContent = "Status Effects";

  const statusInput = document.createElement("input");
  statusInput.className = "npcField";
  statusInput.classList.add("statusInput");
  statusInput.placeholder = "Poisoned, Charmed…";
  statusInput.value = m.status || "";
  _autoSizeInput(statusInput, { min: 60, max: 300 });
  statusInput.addEventListener("input", () => _updateParty(m.id, { status: statusInput.value }, false));

  statusRow.appendChild(statusLabel);
  statusRow.appendChild(statusInput);

  const notesBlock = document.createElement("div");
  notesBlock.className = "npcBlock";

  const notesLabel = document.createElement("div");
  notesLabel.className = "npcMiniLabel";
  notesLabel.textContent = "Notes";

  const notesArea = document.createElement("textarea");
  notesArea.className = "npcTextarea npcNotesBox";
  notesArea.placeholder = "Anything important...";
  notesArea.value = m.notes || "";
  notesArea.addEventListener("input", () => _updateParty(m.id, { notes: notesArea.value }, false));

  // True in-field search highlight is attached for all inputs/textareas
  // near the end of renderPartyCard (after the query getter is defined).

  notesBlock.appendChild(notesLabel);
  notesBlock.appendChild(notesArea);

  collapsible.appendChild(classRow);
  collapsible.appendChild(hpRow);
  collapsible.appendChild(statusRow);
  collapsible.appendChild(notesBlock);

  const footer = document.createElement("div");
  footer.className = "npcCardFooter";

  // NPC-style "move between sections" via dropdown.
  const { sectionWrap } = createSectionSelectRow({
    sections: _state.tracker.partySections || [],
    value: m.sectionId || _state.tracker.partyActiveSectionId,
    onChange: (newVal) => {
      _updateParty(m.id, { sectionId: newVal }, true);
      if (_renderPartyTabs) _renderPartyTabs(); // so tab filtering (search) stays accurate
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
    onDelete: () => _deleteParty(m.id),
  });

  footer.appendChild(sectionWrap);
  footer.appendChild(del);

  body.appendChild(headerRow);
  body.appendChild(collapsible);

  if (portrait) card.appendChild(portrait);
  card.appendChild(body);

  footer.hidden = isCollapsed;
  card.appendChild(footer);


  // True in-field search highlight (every occurrence)
  const _getPartyQuery = () => (_state.tracker.partySearch || "");
  // Search highlight: exclude HP inputs entirely (cur/max) so numeric HP never gets marked.
  attachCardSearchHighlights({
    cardEl: card,
    getQuery: _getPartyQuery,
    attachSearchHighlightOverlay,
  });

  return card;
}


// Initialize Party panel wiring + CRUD handlers.
// Returns handlers for optional external wiring.
export function initPartyPanel(deps = {}) {
  const {
    SaveManager,
    Popovers,
    uiPrompt,
    uiAlert,
    uiConfirm,
    makePartyMember,
    enhanceNumberSteppers,
    numberOrNull,
    // portrait flow deps
    pickCropStorePortrait,
    ImagePicker,
    deleteBlob,
    putBlob,
    cropImageModal,
    getPortraitAspect,
    setStatus,
    blobIdToObjectUrl,
    autoSizeInput,
  } = deps;
  _state = deps.state;
  _blobIdToObjectUrl = blobIdToObjectUrl || _blobIdToObjectUrl;
  _autoSizeInput = autoSizeInput || _autoSizeInput;
  if (!_state) throw new Error("initPartyPanel requires state");
  if (!_blobIdToObjectUrl) throw new Error("initPartyPanel requires blobIdToObjectUrl");
  if (!_autoSizeInput) throw new Error("initPartyPanel requires autoSizeInput");
  if (!SaveManager) throw new Error("initPartyPanel: missing SaveManager");
  if (!makePartyMember) throw new Error("initPartyPanel: missing makePartyMember");
  const {
    updateTrackerField,
    updateTrackerCardField,
    setCardPortraitHidden,
    addTrackerCard,
    removeTrackerCard,
    swapTrackerCards,
  } = createStateActions({ state: _state, SaveManager });

  // store Popovers for dynamic card dropdown enhancements
  _Popovers = Popovers || null;

  if (!Array.isArray(_state.tracker.party)) _state.tracker.party = [];
  if (typeof _state.tracker.partySearch !== "string") _state.tracker.partySearch = "";

  // Party sections state (migrate legacy saves safely).
  if (!Array.isArray(_state.tracker.partySections) || _state.tracker.partySections.length === 0) {
    _state.tracker.partySections = [{
      id: "partysec_" + Math.random().toString(36).slice(2) + Date.now().toString(36),
      name: "Main"
    }];
  }
  if (typeof _state.tracker.partyActiveSectionId !== "string" || !_state.tracker.partyActiveSectionId) {
    _state.tracker.partyActiveSectionId = _state.tracker.partySections[0].id;
  }
  // If active id no longer exists, reset to first
  if (!_state.tracker.partySections.some(s => s.id === _state.tracker.partyActiveSectionId)) {
    _state.tracker.partyActiveSectionId = _state.tracker.partySections[0].id;
  }
  // Migrate existing party members to default section
  const defaultSectionId = _state.tracker.partySections[0].id;
  _state.tracker.party.forEach(m => {
    if (!m.sectionId) m.sectionId = defaultSectionId;
  });

  const required = {
    cardsEl: "#partyCards",
    addBtn: "#addPartyBtn",
    searchEl: "#partySearch",
    tabsEl: "#partyTabs",
    addSectionBtn: "#addPartySectionBtn",
    renameSectionBtn: "#renamePartySectionBtn",
    deleteSectionBtn: "#deletePartySectionBtn"
  };
  const guard = requireMany(required, { root: document, setStatus, context: "Party panel" });
  if (!guard.ok) return guard.destroy;
  const {
    cardsEl,
    addBtn,
    searchEl,
    tabsEl,
    addSectionBtn,
    renameSectionBtn,
    deleteSectionBtn
  } = guard.els;
  masonry.attach(cardsEl, MASONRY_OPTIONS);

  async function pickPartyImage(memberId) {
    let pickedBlobId = null;
    const ok = await pickAndStorePortrait({
      itemId: memberId,
      getItemById: (id) => _state?.tracker?.party?.find(m => m.id === id) || null,
      getBlobId: (member) => member.imgBlobId,
      setBlobId: (_member, blobId) => {
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
    updateParty(memberId, { imgBlobId: pickedBlobId });
  }

  function updateParty(id, patch, rerender = true) {
    const updates = Object.entries(patch || {});
    if (!updates.length) return;

    let changed = false;
    updates.forEach(([field, value]) => {
      if (updateTrackerCardField("party", id, field, value, { queueSave: false })) {
        changed = true;
      }
    });
    if (!changed) return;

    // updateTrackerCardField calls above intentionally skip save queuing so patches save once.
    SaveManager.markDirty();
    if (rerender) renderPartyCards();
  }

  function setPartyPortraitHidden(id, hidden) {
    if (!setCardPortraitHidden("party", id, hidden, { queueSave: false })) return;
    SaveManager.markDirty();
    renderPartyCards();
  }

  async function deleteParty(id) {
    const member = _state.tracker.party.find(m => m.id === id);
    if (!member) return;

    if (uiConfirm) {
      const ok = await uiConfirm(`Delete party member "${member.name || "Unnamed"}"?`, { title: "Delete Party Member", okText: "Delete" });
      if (!ok) return;
    }

    if (member.imgBlobId && deleteBlob) {
      try { await deleteBlob(member.imgBlobId); }
      catch (err) { console.warn("Failed to delete party image blob:", err); }
    }

    if (!removeTrackerCard("party", id)) return;
    renderPartyTabs();
    renderPartyCards();
  }

  function setActiveSection(sectionId) {
    updateTrackerField("partyActiveSectionId", sectionId);
    renderPartyTabs();
    renderPartyCards();
  }

  function renderPartyTabs() {
    renderSectionTabs({
      tabsEl,
      sections: _state.tracker.partySections || [],
      activeId: _state.tracker.partyActiveSectionId,
      query: (_state.tracker.partySearch || ""),
      tabClass: "npcTab",
      sectionMatches: (sec, query) =>
        _state.tracker.party.some(m => m.sectionId === sec.id && matchesSearch(m, query)),
      onSelect: (id) => setActiveSection(id),
    });
  }

  function movePartyCard(id, dir) {
    const q = (_state.tracker.partySearch || "").trim();
    const sectionId = _state.tracker.partyActiveSectionId;

    const visible = _state.tracker.party.filter(m =>
      m.sectionId === sectionId && matchesSearch(m, q)
    );

    const pos = visible.findIndex(m => m.id === id);
    const newPos = pos + dir;
    if (pos === -1 || newPos < 0 || newPos >= visible.length) return;
    const action = dir < 0 ? "moveUp" : "moveDown";
    const jumpRun = startJumpDebugRun({
      panel: "party",
      cardId: id,
      action,
      panelEl: _cardsEl,
      getCardEl: () => _cardsEl?.querySelector(`.npcCard[data-card-id="${id}"]`),
    });
    jumpRun?.log("before-swap");

    const aId = visible[pos].id;
    const bId = visible[newPos].id;

    if (!swapTrackerCards("party", aId, bId)) return;
    jumpRun?.log("after-swap");
    renderPartyCards();
    jumpRun?.log("after-render");
    queueJumpDebugCheckpoints(jumpRun);
  }

  // Wire extracted renderer module
  initPartyCards({
    cardsEl,
    matchesSearch,
    enhanceNumberSteppers,
    pickPartyImage,
    updateParty,
    setPartyPortraitHidden,
    movePartyCard,
    deleteParty,
    numberOrNull,
    renderPartyTabs
  });

  // Bind search
  searchEl.value = _state.tracker.partySearch;
  searchEl.addEventListener("input", () => {
    updateTrackerField("partySearch", searchEl.value);
    renderPartyTabs();     // tabs react to search
    renderPartyCards();    // cards react to search
  });

  // Add party member (goes into ACTIVE section)
  addBtn.addEventListener("click", () => {
    const member = makePartyMember();
    member.sectionId = _state.tracker.partyActiveSectionId;
    addTrackerCard("party", member, { atStart: true });
    renderPartyTabs();
    renderPartyCards();
  });

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
    sectionsKey: "partySections",
    activeKey: "partyActiveSectionId",
    idPrefix: "partysec",
    newTitle: "New Party Section",
    renameTitle: "Rename Party Section",
    deleteTitle: "Delete Party Section",
    deleteConfirmText: (secName) => `Delete section "${secName}"? Party members in it will be moved to the first section.`,
    renderTabs: renderPartyTabs,
    renderCards: renderPartyCards,
    onDeleteMoveItems: (deleteId, fallbackId) => {
      _state.tracker.party.forEach(m => {
        if (m.sectionId === deleteId) m.sectionId = fallbackId;
      });
    },
  });

  // Initial render
  renderPartyTabs();
  renderPartyCards();

  // Steppers
  if (enhanceNumberSteppers) enhanceNumberSteppers(document);

  return { updateParty, pickPartyImage, deleteParty, renderPartyTabs };
}
