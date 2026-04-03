// NPC cards panel renderer and wiring.
// Dependencies are injected by initNpcsPanel so this module stays page-agnostic.

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
let _Popovers = null;
let _state = null;
let _blobIdToObjectUrl = null;
let _autoSizeInput = null;

// Injected helper functions.
let _matchesSearch = null;
let _enhanceNumberSteppers = null;
let _pickNpcImage = null;
let _updateNpc = null;
let _setNpcPortraitHidden = null;
let _moveNpcCard = null;
let _moveNpc = null;
let _deleteNpc = null;
let _numberOrNull = null;
const USE_INCREMENTAL_CARDS = true;
const USE_INCREMENTAL_PORTRAIT = true;
const USE_INCREMENTAL_REORDER = true;
const MASONRY_OPTIONS = { panelName: "npc", minCardWidth: 175, gapVar: "--cards-grid-gap" };

const matchesSearch = makeFieldSearchMatcher(["name", "className", "status", "notes"]);

function initNpcCards(deps = {}) {
  _state = deps.state || _state;
  _cardsEl = deps.cardsEl;
  _matchesSearch = deps.matchesSearch;
  _enhanceNumberSteppers = deps.enhanceNumberSteppers;
  _pickNpcImage = deps.pickNpcImage;
  _updateNpc = deps.updateNpc;
  _setNpcPortraitHidden = deps.setNpcPortraitHidden;
  _moveNpcCard = deps.moveNpcCard;
  _moveNpc = deps.moveNpc;
  _deleteNpc = deps.deleteNpc;
  _numberOrNull = deps.numberOrNull;
}

function findNpcCardElById(cardId) {
  return _cardsEl?.querySelector(`.npcCard[data-card-id="${cardId}"]`) || null;
}

function scheduleNpcMasonryRelayout() {
  if (!_cardsEl) return;
  requestAnimationFrame(() => masonry.relayout(_cardsEl));
}

function focusCardCollapseButton(cardId, fallbackEl = null) {
  requestAnimationFrame(() => {
    const btn = findNpcCardElById(cardId)?.querySelector(".cardCollapseBtn") || fallbackEl;
    try { btn?.focus({ preventScroll: true }); } catch { btn?.focus?.(); }
  });
}

function focusNpcCardMoveButton(cardId, dir) {
  requestAnimationFrame(() => {
    const card = findNpcCardElById(cardId);
    if (!card) return;
    const buttons = card.querySelectorAll(".moveBtn");
    const btn = buttons[dir < 0 ? 0 : 1] || buttons[0] || null;
    try { btn?.focus({ preventScroll: true }); } catch { btn?.focus?.(); }
  });
}

function patchNpcCardReorder(cardId, adjacentId, dir) {
  if (!_cardsEl) return false;
  const cardEl = findNpcCardElById(cardId);
  const adjacentEl = findNpcCardElById(adjacentId);
  if (!cardEl || !adjacentEl) return false;
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

  const firstRectA = cardEl.getBoundingClientRect();
  const firstRectB = adjacentEl.getBoundingClientRect();

  const prevScroll = _cardsEl.scrollTop;
  if (dir < 0) _cardsEl.insertBefore(cardEl, adjacentEl);
  else _cardsEl.insertBefore(adjacentEl, cardEl);
  _cardsEl.scrollTop = prevScroll;

  masonry.relayout(_cardsEl);
  if (!prefersReducedMotion) {
    const lastRectA = cardEl.getBoundingClientRect();
    const lastRectB = adjacentEl.getBoundingClientRect();
    const baseA = cardEl.style.transform || "";
    const baseB = adjacentEl.style.transform || "";
    const deltaAX = firstRectA.left - lastRectA.left;
    const deltaAY = firstRectA.top - lastRectA.top;
    const deltaBX = firstRectB.left - lastRectB.left;
    const deltaBY = firstRectB.top - lastRectB.top;

    cardEl.style.transform = baseA
      ? `${baseA} translate(${deltaAX}px, ${deltaAY}px)`
      : `translate(${deltaAX}px, ${deltaAY}px)`;
    adjacentEl.style.transform = baseB
      ? `${baseB} translate(${deltaBX}px, ${deltaBY}px)`
      : `translate(${deltaBX}px, ${deltaBY}px)`;
    cardEl.offsetHeight; // Force reflow so FLIP transition starts from inverted position.

    cardEl.style.transition = "transform 260ms cubic-bezier(.2,.8,.2,1)";
    adjacentEl.style.transition = "transform 260ms cubic-bezier(.2,.8,.2,1)";
    cardEl.style.transform = baseA;
    adjacentEl.style.transform = baseB;

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      cardEl.style.transition = "";
      adjacentEl.style.transition = "";
      cardEl.removeEventListener("transitionend", onEndA);
      adjacentEl.removeEventListener("transitionend", onEndB);
    };
    const onEndA = (evt) => { if (evt.propertyName === "transform") cleanup(); };
    const onEndB = (evt) => { if (evt.propertyName === "transform") cleanup(); };
    cardEl.addEventListener("transitionend", onEndA);
    adjacentEl.addEventListener("transitionend", onEndB);
    setTimeout(cleanup, 260);
  }

  focusNpcCardMoveButton(cardId, dir);
  return true;
}

function patchNpcCardCollapsed(cardId, collapsed, focusEl = null) {
  const card = findNpcCardElById(cardId);
  if (!card) return false;

  card.classList.toggle("collapsed", !!collapsed);
  const collapsible = card.querySelector(".npcCollapsible");
  if (collapsible) collapsible.hidden = !!collapsed;
  const footer = card.querySelector(".npcCardFooter");
  if (footer) footer.hidden = !!collapsed;

  const toggle = card.querySelector(".cardCollapseBtn");
  if (toggle) {
    toggle.setAttribute("aria-label", collapsed ? "Expand card" : "Collapse card");
    toggle.setAttribute("aria-expanded", (!collapsed).toString());
    toggle.textContent = collapsed ? "\u25bc" : "\u25b2";
  }

  scheduleNpcMasonryRelayout();
  focusCardCollapseButton(cardId, focusEl || toggle);
  return true;
}

function focusElementWithoutScroll(el) {
  if (!el) return;
  requestAnimationFrame(() => {
    try { el.focus({ preventScroll: true }); } catch { el.focus?.(); }
  });
}

function patchNpcCardPortrait(cardId, hidden, focusEl = null) {
  const card = findNpcCardElById(cardId);
  if (!card) return false;

  const npc = _state?.tracker?.npcs?.find((n) => n.id === cardId);
  if (!npc) return false;

  const headerRow = card.querySelector(".npcHeaderRow");
  const body = card.querySelector(".npcCardBodyStack");
  if (!headerRow || !body) return false;

  headerRow.querySelectorAll(".cardPortraitToggleBtnHeader").forEach((btn) => btn.remove());
  card.querySelector(".npcPortraitTop")?.remove();

  const portrait = renderCardPortrait({
    blobId: npc.imgBlobId,
    altText: npc.name || "NPC Portrait",
    blobIdToObjectUrl: _blobIdToObjectUrl,
    onPick: () => _pickNpcImage(npc.id),
    isHidden: !!hidden,
    onToggleHidden: (nextHidden) => _setNpcPortraitHidden?.(npc.id, nextHidden),
    headerControlsEl: headerRow,
    onImageLoad: scheduleNpcMasonryRelayout,
  });
  if (portrait) card.insertBefore(portrait, body);

  const nextFocusEl = focusEl && focusEl.isConnected
    ? focusEl
    : (hidden
      ? headerRow.querySelector(".cardPortraitToggleBtnHeader")
      : card.querySelector(".npcPortraitTop .cardPortraitToggleBtnOverlay"));

  scheduleNpcMasonryRelayout();
  focusElementWithoutScroll(nextFocusEl);
  return true;
}

function renderNpcCards() {
  if (!_state) return;
  const prevScroll = _cardsEl.scrollTop; // keep scroll position
  const shouldMaskRerender = prevScroll > 0;
  if (shouldMaskRerender) _cardsEl.classList.add("cardsRerenderMask");
  const raf = requestAnimationFrame;
  const renderRun = startJumpDebugRun({
    panel: "npc",
    cardId: "render",
    action: "render",
    panelEl: _cardsEl,
    getCardEl: () => _cardsEl?.querySelector(".npcCard"),
  });
  renderRun?.log("before-dom-rebuild");

  const sectionId = _state.tracker.npcActiveSectionId;
  const q = (_state.tracker.npcSearch || "").trim();

  const list = _state.tracker.npcs
    .filter(n => (n.sectionId || "") === sectionId)
    .filter(n => _matchesSearch(n, q));

  _cardsEl.innerHTML = "";

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "mutedSmall";
    empty.textContent = q
      ? "No NPCs match your search in this section."
      : "No NPCs in this section yet. Click “+ Add NPC”.";
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

  list.forEach(npc => _cardsEl.appendChild(renderNpcCard(npc)));
  _enhanceNumberSteppers(_cardsEl);

  masonry.attach(_cardsEl, MASONRY_OPTIONS);
  masonry.relayout(_cardsEl);
  raf(() => raf(() => {
    _cardsEl.scrollTop = prevScroll;
    if (shouldMaskRerender) _cardsEl.classList.remove("cardsRerenderMask");
  }));
  renderRun?.log("after-dom-rebuild-relayout");
  queueJumpDebugCheckpoints(renderRun);
}

function renderNpcCard(npc) {
  const card = document.createElement("div");
  card.className = "npcCard npcCardStack";
  card.dataset.npcId = npc.id;
  card.dataset.cardId = npc.id;

  const isCollapsed = !!npc.collapsed;
  card.classList.toggle("collapsed", isCollapsed);

  // --- Main stacked fields ---
  const body = document.createElement("div");
  body.className = "npcCardBodyStack";

  // Header row: Name + collapse toggle
  const headerRow = document.createElement("div");
  headerRow.className = "npcHeaderRow";

  const nameInput = document.createElement("input");
  nameInput.className = "npcField npcNameBig";
  nameInput.placeholder = "Name";
  nameInput.value = npc.name || "";
  nameInput.addEventListener("input", () => _updateNpc(npc.id, { name: nameInput.value }, false));

  const moveUp = createMoveButton({
    direction: -1,
    onMove: () => {
      _moveNpcCard(npc.id, -1);
    },
  });

  const moveDown = createMoveButton({
    direction: +1,
    onMove: () => {
      _moveNpcCard(npc.id, +1);
    },
  });

  const toggle = createCollapseButton({
    isCollapsed,
    onToggle: () => {
      const currentCollapsed = !!_state?.tracker?.npcs?.find(n => n.id === npc.id)?.collapsed;
      const nextCollapsed = !currentCollapsed;
      const action = currentCollapsed ? "expand" : "collapse";
      const jumpRun = startJumpDebugRun({
        panel: "npc",
        cardId: npc.id,
        action,
        panelEl: _cardsEl,
        getCardEl: () => _cardsEl?.querySelector(`.npcCard[data-card-id="${npc.id}"]`) || card,
      });
      jumpRun?.log("before-click-handler");

      // Preserve page scroll position. NPC re-render rebuilds the card DOM,
      // which can cause the browser to jump to the top when the focused button disappears.
      const x = window.scrollX;
      const y = window.scrollY;

      _updateNpc(npc.id, { collapsed: nextCollapsed }, false);
      jumpRun?.log("after-state-update");

      if (USE_INCREMENTAL_CARDS && patchNpcCardCollapsed(npc.id, nextCollapsed, toggle)) {
        jumpRun?.log("after-incremental-patch");
        queueJumpDebugCheckpoints(jumpRun);
        return;
      }

      renderNpcCards();
      jumpRun?.log("after-render");
      queueJumpDebugCheckpoints(jumpRun);
      requestAnimationFrame(() => {
        window.scrollTo(x, y);
        focusCardCollapseButton(npc.id);
      });
    },
  });

  headerRow.appendChild(nameInput);
  headerRow.appendChild(moveUp);
  headerRow.appendChild(moveDown);

  // --- Portrait (full-width top) ---
  const portrait = renderCardPortrait({
    blobId: npc.imgBlobId,
    altText: npc.name || "NPC Portrait",
    blobIdToObjectUrl: _blobIdToObjectUrl,
    onPick: () => _pickNpcImage(npc.id),
    isHidden: !!npc.portraitHidden,
    onToggleHidden: (hidden) => _setNpcPortraitHidden?.(npc.id, hidden),
    headerControlsEl: headerRow,
    onImageLoad: scheduleNpcMasonryRelayout,
  });
  headerRow.appendChild(toggle);

  // Collapsible content: everything below name

  // Class (label + input)
  const collapsible = document.createElement("div");
  collapsible.className = "npcCollapsible";
  collapsible.hidden = isCollapsed;

  const classLabel = document.createElement("div");
  classLabel.className = "npcMiniLabel";
  classLabel.textContent = "Class";

  const classInput = document.createElement("input");
  classInput.className = "npcField npcClass";
  classInput.placeholder = "Class / Role";
  classInput.value = npc.className || "";
  classInput.classList.add("autosize");
  _autoSizeInput(classInput, { min: 60, max: 200 });
  classInput.addEventListener("input", () => _updateNpc(npc.id, { className: classInput.value }, false));

  const classBlock = document.createElement("div");
  classBlock.className = "npcRowBlock";
  classBlock.appendChild(classLabel);
  classBlock.appendChild(classInput);

  // HP row
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
  hpCur.value = npc.hpCurrent ?? "";
  _autoSizeInput(hpCur, { min: 30, max: 70 });
  hpCur.addEventListener("input", () =>{ _autoSizeInput(hpCur, { min: 30, max: 70 }); _updateNpc(npc.id, { hpCurrent: _numberOrNull(hpCur.value) }, false); });

  const slash = document.createElement("span");
  slash.className = "muted";
  slash.textContent = "/";

  const hpMax = document.createElement("input");
  hpMax.className = "npcField npcHpInput";
  hpMax.classList.add("num-lg");
  hpMax.classList.add("autosize");
  hpMax.type = "number";
  hpMax.placeholder = "Max";
  hpMax.value = npc.hpMax ?? "";
  _autoSizeInput(hpMax, { min: 30, max: 70 });
  hpMax.addEventListener("input", () => { _autoSizeInput(hpMax, { min: 30, max: 70 }); _updateNpc(npc.id, { hpMax: _numberOrNull(hpMax.value) }, false); });

  hpWrap.appendChild(hpCur);
  hpWrap.appendChild(slash);
  hpWrap.appendChild(hpMax);

  hpRow.appendChild(hpLabel);
  hpRow.appendChild(hpWrap);

  // Status
  const statusBlock = document.createElement("div");
  statusBlock.className = "npcRowBlock";

  const statusLabel = document.createElement("div");
  statusLabel.className = "npcMiniLabel";
  statusLabel.textContent = "Status Effects";

  const statusInput = document.createElement("input");
  statusInput.className = "npcField";
  statusInput.classList.add("statusInput");
  statusInput.placeholder = "Poisoned, Charmed…";
  statusInput.value = npc.status || "";
  _autoSizeInput(statusInput, { min: 60, max: 300 });
  statusInput.addEventListener("input", () => _updateNpc(npc.id, { status: statusInput.value }, false));

  statusBlock.appendChild(statusLabel);
  statusBlock.appendChild(statusInput);

  // Notes (fixed-height + scroll)
  const notesBlock = document.createElement("div");
  notesBlock.className = "npcBlock";

  const notesLabel = document.createElement("div");
  notesLabel.className = "npcMiniLabel";
  notesLabel.textContent = "Notes";

  const notesArea = document.createElement("textarea");
  notesArea.className = "npcTextarea npcNotesBox";
  notesArea.placeholder = "Anything important...";
  notesArea.value = npc.notes || "";
  notesArea.addEventListener("input", () => _updateNpc(npc.id, { notes: notesArea.value }, false));

  // True in-field search highlight is attached for all inputs/textareas
  // near the end of renderNpcCard (after the query getter is defined).

  notesBlock.appendChild(notesLabel);
  notesBlock.appendChild(notesArea);

  // --- Footer actions ---
  const footer = document.createElement("div");
  footer.className = "npcCardFooter";

  // Move between sections via dropdown (same pattern as Party).
  const { sectionWrap } = createSectionSelectRow({
    sections: _state.tracker.npcSections || [],
    value: npc.sectionId || _state.tracker.npcActiveSectionId,
    onChange: (newVal) => {
      _updateNpc(npc.id, { sectionId: newVal }, true);
      // If tabs are search-filtered like Party, ensure they stay accurate.
      renderNpcTabs();
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
    onDelete: () => _deleteNpc(npc.id),
  });

  footer.appendChild(sectionWrap);
  footer.appendChild(del);

  // Build card
  collapsible.appendChild(classBlock);
  collapsible.appendChild(hpRow);
  collapsible.appendChild(statusBlock);
  collapsible.appendChild(notesBlock);

  body.appendChild(headerRow);
  body.appendChild(collapsible);

  if (portrait) card.appendChild(portrait);
  card.appendChild(body);
  // Footer should also collapse
  footer.hidden = isCollapsed;
  card.appendChild(footer);


  // True in-field search highlight (every occurrence)
  const _getNpcQuery = () => (_state.tracker.npcSearch || "");
  // Search highlight: exclude HP inputs entirely (cur/max) so numeric HP never gets marked.
  attachCardSearchHighlights({
    cardEl: card,
    getQuery: _getNpcQuery,
    attachSearchHighlightOverlay,
  });

  return card;
}

// (Move buttons removed in favor of section dropdown)


// Initialize NPC panel wiring + CRUD handlers.
export function initNpcsPanel(deps = {}) {
  const {
    SaveManager,
    Popovers,
    uiPrompt,
    uiAlert,
    uiConfirm,
    setStatus,
    makeNpc,
    enhanceNumberSteppers,
    numberOrNull,
    // portrait flow deps
    pickCropStorePortrait,
    ImagePicker,
    deleteBlob,
    putBlob,
    cropImageModal,
    getPortraitAspect,
    blobIdToObjectUrl,
    autoSizeInput,
  } = deps;
  _state = deps.state;
  _blobIdToObjectUrl = blobIdToObjectUrl || _blobIdToObjectUrl;
  _autoSizeInput = autoSizeInput || _autoSizeInput;
  if (!_state) throw new Error("initNpcsPanel requires state");
  if (!_blobIdToObjectUrl) throw new Error("initNpcsPanel requires blobIdToObjectUrl");
  if (!_autoSizeInput) throw new Error("initNpcsPanel requires autoSizeInput");
  if (!SaveManager) throw new Error("initNpcsPanel: missing SaveManager");
  if (!makeNpc) throw new Error("initNpcsPanel: missing makeNpc");
  const {
    updateTrackerField,
    updateTrackerCardField,
    setCardPortraitHidden,
    addTrackerCard,
    removeTrackerCard,
    swapTrackerCards,
    mutateTracker,
  } = createStateActions({ state: _state, SaveManager });

  _Popovers = Popovers || null;

  mutateTracker((tracker) => {
    // Migrate legacy NPC textarea text into the first NPC note (if present).
    // Only runs if npcs is not an array.
    if (!Array.isArray(tracker.npcs)) {
      const old = String(tracker.npcs || "").trim();
      tracker.npcs = [];
      if (old) {
        tracker.npcs.push(makeNpc({ group: "undecided", name: "Imported NPC Notes", notes: old }));
      }
    }

    if (typeof tracker.npcSearch !== "string") tracker.npcSearch = "";

    // --- NPC Sections (migrate older group-based saves safely) ---
    // Older versions used fixed groups: friendly/undecided/foe.
    // Newer versions use dynamic sections with add/rename/delete.
    if (!Array.isArray(tracker.npcSections) || tracker.npcSections.length === 0) {
      const mk = (name) => ({
        id: "npcsec_" + Math.random().toString(36).slice(2) + Date.now().toString(36),
        name
      });
      const friendly = mk("Friendly");
      const undecided = mk("Undecided");
      const foe = mk("Foe");
      tracker.npcSections = [friendly, undecided, foe];

      const groupToSecId = {
        friendly: friendly.id,
        undecided: undecided.id,
        foe: foe.id,
      };
      // Migrate existing NPCs into the matching section
      (tracker.npcs || []).forEach(n => {
        if (!n.sectionId) n.sectionId = groupToSecId[n.group] || friendly.id;
      });

      // If older saves had npcActiveGroup, map it over
      if (typeof tracker.npcActiveGroup === "string") {
        tracker.npcActiveSectionId = groupToSecId[tracker.npcActiveGroup] || friendly.id;
      }
    }

    // Ensure active section exists
    if (typeof tracker.npcActiveSectionId !== "string" || !tracker.npcActiveSectionId) {
      tracker.npcActiveSectionId = tracker.npcSections[0].id;
    }
    if (!tracker.npcSections.some(s => s.id === tracker.npcActiveSectionId)) {
      tracker.npcActiveSectionId = tracker.npcSections[0].id;
    }

    // If any NPC lacks a sectionId, put it in the first section
    const defaultSectionId = tracker.npcSections[0].id;
    (tracker.npcs || []).forEach(n => {
      if (!n.sectionId) n.sectionId = defaultSectionId;
    });
    return true;
  }, { queueSave: false });

  const required = {
    cardsEl: "#npcCards",
    addBtn: "#addNpcBtn",
    searchEl: "#npcSearch",
    tabsEl: "#npcTabs",
    addSectionBtn: "#addNpcSectionBtn",
    renameSectionBtn: "#renameNpcSectionBtn",
    deleteSectionBtn: "#deleteNpcSectionBtn"
  };
  const guard = requireMany(required, { root: document, setStatus, context: "NPC panel" });
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

  function updateNpc(id, patch, rerender = true) {
    const updates = Object.entries(patch || {});
    if (!updates.length) return;

    let changed = false;
    updates.forEach(([field, value]) => {
      if (updateTrackerCardField("npc", id, field, value, { queueSave: false })) {
        changed = true;
      }
    });
    if (!changed) return;

    SaveManager.markDirty();
    if (rerender) renderNpcCards();
  }

  function setNpcPortraitHidden(id, hidden) {
    if (!setCardPortraitHidden("npc", id, hidden, { queueSave: false })) return;
    SaveManager.markDirty();
    const focusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (USE_INCREMENTAL_CARDS && USE_INCREMENTAL_PORTRAIT && patchNpcCardPortrait(id, hidden, focusEl)) return;
    renderNpcCards();
  }

  function moveNpcCard(id, dir) {
    const sectionId = _state.tracker.npcActiveSectionId;
    const q = (_state.tracker.npcSearch || "").trim();

    // Build the same visible list logic as renderNpcCards()
    const visible = _state.tracker.npcs
      .filter(n => (n.sectionId || "") === sectionId)
      .filter(n => matchesSearch(n, q));

    const pos = visible.findIndex(n => n.id === id);
    const newPos = pos + dir;
    if (pos === -1 || newPos < 0 || newPos >= visible.length) return;
    const action = dir < 0 ? "moveUp" : "moveDown";
    const jumpRun = startJumpDebugRun({
      panel: "npc",
      cardId: id,
      action,
      panelEl: _cardsEl,
      getCardEl: () => _cardsEl?.querySelector(`.npcCard[data-card-id="${id}"]`),
    });
    jumpRun?.log("before-swap");

    const aId = visible[pos].id;
    const bId = visible[newPos].id;

    if (!swapTrackerCards("npc", aId, bId)) return;
    jumpRun?.log("after-swap");

    if (USE_INCREMENTAL_CARDS && USE_INCREMENTAL_REORDER && patchNpcCardReorder(aId, bId, dir)) {
      jumpRun?.log("after-incremental-reorder");
      queueJumpDebugCheckpoints(jumpRun);
      return;
    }

    renderNpcCards();
    jumpRun?.log("after-render");
    queueJumpDebugCheckpoints(jumpRun);
  }

  async function pickNpcImage(npcId) {
    let pickedBlobId = null;
    const ok = await pickAndStorePortrait({
      itemId: npcId,
      getItemById: (id) => _state?.tracker?.npcs?.find(n => n.id === id) || null,
      getBlobId: (npc) => npc.imgBlobId,
      setBlobId: (_npc, blobId) => {
        pickedBlobId = blobId;
      },
      deps: {
        pickCropStorePortrait,
        ImagePicker,
        cropImageModal,
        getPortraitAspect,
        deleteBlob,
        putBlob,
      },
      setStatus,
    });
    if (!ok) return;
    updateNpc(npcId, { imgBlobId: pickedBlobId });
  }

  async function deleteNpc(id) {
    const npc = _state.tracker.npcs.find(n => n.id === id);
    if (!npc) return;

    if (uiConfirm) {
      const ok = await uiConfirm(`Delete NPC "${npc.name || "Unnamed"}"?`, { title: "Delete NPC", okText: "Delete" });
      if (!ok) return;
    }

    if (npc.imgBlobId && deleteBlob) {
      try { await deleteBlob(npc.imgBlobId); }
      catch (err) { console.warn("Failed to delete npc image blob:", err); }
    }

    if (!removeTrackerCard("npc", id)) return;
    renderNpcTabs();
    renderNpcCards();
  }

  // Wire extracted renderer module
  initNpcCards({
    cardsEl,
    Popovers,
    matchesSearch,
    enhanceNumberSteppers,
    pickNpcImage,
    updateNpc,
    setNpcPortraitHidden,
    moveNpcCard,
    deleteNpc,
    numberOrNull,
  });

  function setActiveSection(sectionId) {
    updateTrackerField("npcActiveSectionId", sectionId);
    renderNpcTabs();
    renderNpcCards();
  }

  function renderNpcTabs() {
    renderSectionTabs({
      tabsEl,
      sections: _state.tracker.npcSections || [],
      activeId: _state.tracker.npcActiveSectionId,
      query: (_state.tracker.npcSearch || ""),
      tabClass: "npcTab",
      sectionMatches: (sec, query) =>
        _state.tracker.npcs.some(n => n.sectionId === sec.id && matchesSearch(n, query)),
      onSelect: (id) => setActiveSection(id),
    });
  }

  // Bind search
  searchEl.value = _state.tracker.npcSearch;
  searchEl.addEventListener("input", () => {
    updateTrackerField("npcSearch", searchEl.value);
    renderNpcTabs();
    renderNpcCards();
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
    sectionsKey: "npcSections",
    activeKey: "npcActiveSectionId",
    idPrefix: "npcsec",
    newTitle: "New NPC Section",
    renameTitle: "Rename NPC Section",
    deleteTitle: "Delete NPC Section",
    deleteConfirmText: (secName) => `Delete section "${secName}"? NPCs in it will be moved to the first section.`,
    renderTabs: renderNpcTabs,
    renderCards: renderNpcCards,
    onDeleteMoveItems: (deleteId, fallbackId) => {
      mutateTracker((tracker) => {
        (tracker.npcs || []).forEach(n => {
          if (n.sectionId === deleteId) n.sectionId = fallbackId;
        });
        return true;
      }, { queueSave: false });
    },
  });

  // Initial render
  renderNpcTabs();
  renderNpcCards();

  // Add NPC
  addBtn.addEventListener("click", () => {
    const npc = makeNpc({ sectionId: _state.tracker.npcActiveSectionId });
    addTrackerCard("npc", npc, { atStart: true });
    renderNpcTabs();
    renderNpcCards();
  });

  // Steppers (covers initial render + any fixed inputs)
  if (enhanceNumberSteppers) enhanceNumberSteppers(document);
}
