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
import { createCardIncrementalDomPatcher } from "./cards/shared/cardIncrementalPatchShared.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { requireMany } from "../../../utils/domGuards.js";
import { startJumpDebugRun, queueJumpDebugCheckpoints } from "../../../ui/jumpDebug.js";
import * as masonry from "../../../ui/masonryLayout.js";

/** @typedef {import("../../../domain/factories.js").NpcCard} NpcCard */

const USE_INCREMENTAL_CARDS = true;
const USE_INCREMENTAL_PORTRAIT = true;
const USE_INCREMENTAL_REORDER = true;
const MASONRY_OPTIONS = { panelName: "npc", minCardWidth: 175, gapVar: "--cards-grid-gap" };
const matchesSearch = makeFieldSearchMatcher(["name", "className", "status", "notes"]);

function createNpcCardsController(deps = {}) {
  const {
    state,
    SaveManager,
    Popovers,
    uiPrompt,
    uiAlert,
    uiConfirm,
    setStatus,
    makeNpc,
    enhanceNumberSteppers,
    numberOrNull,
    pickCropStorePortrait,
    ImagePicker,
    deleteBlob,
    putBlob,
    cropImageModal,
    getPortraitAspect,
    blobIdToObjectUrl,
    autoSizeInput,
    cardsEl,
    addBtn,
    searchEl,
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
  addDestroy(() => masonry.detach(cardsEl));

  /**
   * @param {string} npcId
   * @returns {NpcCard | null}
   */
  const getNpcById = (npcId) => state?.tracker?.npcs?.find((npc) => npc.id === npcId) || null;
  const getSearchQuery = () => (state?.tracker?.npcSearch || "").trim();
  const getVisibleNpcs = () => {
    const sectionId = state.tracker.npcActiveSectionId;
    const query = getSearchQuery();
    return state.tracker.npcs
      .filter((npc) => (npc.sectionId || "") === sectionId)
      .filter((npc) => matchesSearch(npc, query));
  };
  const cardDomPatcher = createCardIncrementalDomPatcher({
    cardsEl,
    blobIdToObjectUrl,
  });
  const scheduleNpcMasonryRelayout = () => cardDomPatcher.scheduleMasonryRelayout();
  const focusCardCollapseButton = (cardId, fallbackEl = null) => cardDomPatcher.focusCollapseButton(cardId, fallbackEl);
  const patchNpcCardReorder = (cardId, adjacentId, dir) => cardDomPatcher.patchReorder(cardId, adjacentId, dir);
  const patchNpcCardCollapsed = (cardId, collapsed, focusEl = null) => cardDomPatcher.patchCollapsed(cardId, collapsed, focusEl);
  const patchNpcCardPortrait = (cardId, hidden, focusEl = null) => cardDomPatcher.patchPortrait({
    cardId,
    hidden,
    focusEl,
    getItemById: getNpcById,
    getBlobId: (npc) => npc.imgBlobId,
    getAltText: (npc) => npc.name || "NPC Portrait",
    onPick: (npc) => pickNpcImage(npc.id),
    onToggleHidden: (npc, nextHidden) => setNpcPortraitHidden(npc.id, nextHidden),
  });

  function renderNpcCards() {
    if (!state) return;

    const prevScroll = cardsEl.scrollTop;
    const shouldMaskRerender = prevScroll > 0;
    if (shouldMaskRerender) cardsEl.classList.add("cardsRerenderMask");

    const raf = requestAnimationFrame;
    const renderRun = startJumpDebugRun({
      panel: "npc",
      cardId: "render",
      action: "render",
      panelEl: cardsEl,
      getCardEl: () => cardsEl?.querySelector(".trackerCard"),
    });
    renderRun?.log("before-dom-rebuild");

    const query = getSearchQuery();
    const list = getVisibleNpcs();
    cardsEl.innerHTML = "";

    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "mutedSmall";
      empty.textContent = query
        ? "No NPCs match your search in this section."
        : "No NPCs in this section yet. Click “+ Add NPC”.";
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

    list.forEach((npc) => cardsEl.appendChild(renderNpcCard(npc)));
    if (enhanceNumberSteppers) enhanceNumberSteppers(cardsEl);

    masonry.attach(cardsEl, MASONRY_OPTIONS);
    masonry.relayout(cardsEl);
    raf(() => raf(() => {
      cardsEl.scrollTop = prevScroll;
      if (shouldMaskRerender) cardsEl.classList.remove("cardsRerenderMask");
    }));
    renderRun?.log("after-dom-rebuild-relayout");
    queueJumpDebugCheckpoints(renderRun);
  }

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
    const visible = getVisibleNpcs();
    const pos = visible.findIndex((npc) => npc.id === id);
    const newPos = pos + dir;
    if (pos === -1 || newPos < 0 || newPos >= visible.length) return;

    const action = dir < 0 ? "moveUp" : "moveDown";
    const jumpRun = startJumpDebugRun({
      panel: "npc",
      cardId: id,
      action,
      panelEl: cardsEl,
      getCardEl: () => cardsEl?.querySelector(`.trackerCard[data-card-id="${id}"]`),
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
    const ok = await pickAndStorePortrait({
      itemId: npcId,
      getItemById: getNpcById,
      getBlobId: (npc) => npc.imgBlobId,
      setBlobId: (_npc, blobId) => updateTrackerCardField("npc", npcId, "imgBlobId", blobId, { queueSave: false }),
      deps: {
        pickCropStorePortrait,
        ImagePicker,
        cropImageModal,
        getPortraitAspect,
        deleteBlob,
        putBlob,
        SaveManager,
        uiAlert,
      },
      setStatus,
    });
    if (!ok) return;
    renderNpcCards();
  }

  async function deleteNpc(id) {
    const npc = getNpcById(id);
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

  function renderNpcCard(npc) {
    const card = document.createElement("div");
    card.className = "trackerCard npcCard npcCardStack";
    card.dataset.npcId = npc.id;
    card.dataset.cardId = npc.id;

    const isCollapsed = !!npc.collapsed;
    card.classList.toggle("collapsed", isCollapsed);

    const body = document.createElement("div");
    body.className = "npcCardBodyStack";

    const headerRow = document.createElement("div");
    headerRow.className = "npcHeaderRow";

    const nameInput = document.createElement("input");
    nameInput.className = "npcField npcNameBig";
    nameInput.placeholder = "Name";
    nameInput.value = npc.name || "";
    nameInput.addEventListener("input", () => updateNpc(npc.id, { name: nameInput.value }, false));

    const moveUp = createMoveButton({
      direction: -1,
      onMove: () => {
        moveNpcCard(npc.id, -1);
      },
    });

    const moveDown = createMoveButton({
      direction: +1,
      onMove: () => {
        moveNpcCard(npc.id, +1);
      },
    });

    const toggle = createCollapseButton({
      isCollapsed,
      onToggle: () => {
        const currentCollapsed = !!getNpcById(npc.id)?.collapsed;
        const nextCollapsed = !currentCollapsed;
        const action = currentCollapsed ? "expand" : "collapse";
        const jumpRun = startJumpDebugRun({
          panel: "npc",
          cardId: npc.id,
          action,
          panelEl: cardsEl,
          getCardEl: () => cardsEl?.querySelector(`.trackerCard[data-card-id="${npc.id}"]`) || card,
        });
        jumpRun?.log("before-click-handler");

        const x = window.scrollX;
        const y = window.scrollY;

        updateNpc(npc.id, { collapsed: nextCollapsed }, false);
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

    const portrait = renderCardPortrait({
      blobId: npc.imgBlobId,
      altText: npc.name || "NPC Portrait",
      blobIdToObjectUrl,
      onPick: () => pickNpcImage(npc.id),
      isHidden: !!npc.portraitHidden,
      onToggleHidden: (hidden) => setNpcPortraitHidden(npc.id, hidden),
      headerControlsEl: headerRow,
      onImageLoad: scheduleNpcMasonryRelayout,
    });
    headerRow.appendChild(toggle);

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
    autoSizeInput(classInput, { min: 60, max: 200 });
    classInput.addEventListener("input", () => updateNpc(npc.id, { className: classInput.value }, false));

    const classBlock = document.createElement("div");
    classBlock.className = "npcRowBlock";
    classBlock.appendChild(classLabel);
    classBlock.appendChild(classInput);

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
    autoSizeInput(hpCur, { min: 30, max: 70 });
    hpCur.addEventListener("input", () => {
      autoSizeInput(hpCur, { min: 30, max: 70 });
      updateNpc(npc.id, { hpCurrent: numberOrNull(hpCur.value) }, false);
    });

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
    autoSizeInput(hpMax, { min: 30, max: 70 });
    hpMax.addEventListener("input", () => {
      autoSizeInput(hpMax, { min: 30, max: 70 });
      updateNpc(npc.id, { hpMax: numberOrNull(hpMax.value) }, false);
    });

    hpWrap.appendChild(hpCur);
    hpWrap.appendChild(slash);
    hpWrap.appendChild(hpMax);

    hpRow.appendChild(hpLabel);
    hpRow.appendChild(hpWrap);

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
    autoSizeInput(statusInput, { min: 60, max: 300 });
    statusInput.addEventListener("input", () => updateNpc(npc.id, { status: statusInput.value }, false));

    statusBlock.appendChild(statusLabel);
    statusBlock.appendChild(statusInput);

    const notesBlock = document.createElement("div");
    notesBlock.className = "npcBlock";

    const notesLabel = document.createElement("div");
    notesLabel.className = "npcMiniLabel";
    notesLabel.textContent = "Notes";

    const notesArea = document.createElement("textarea");
    notesArea.className = "npcTextarea npcNotesBox";
    notesArea.placeholder = "Anything important...";
    notesArea.value = npc.notes || "";
    notesArea.addEventListener("input", () => updateNpc(npc.id, { notes: notesArea.value }, false));

    notesBlock.appendChild(notesLabel);
    notesBlock.appendChild(notesArea);

    const footer = document.createElement("div");
    footer.className = "npcCardFooter";

    const { sectionWrap } = createSectionSelectRow({
      sections: state.tracker.npcSections || [],
      value: npc.sectionId || state.tracker.npcActiveSectionId,
      onChange: (newVal) => {
        updateNpc(npc.id, { sectionId: newVal }, true);
        renderNpcTabs();
      },
      enhanceSelectOnce,
      Popovers,
      enhanceSelectDropdown,
      buttonClass: "cardSelectBtn",
      optionClass: "swatchOption",
      groupLabelClass: "dropdownGroupLabel",
      preferRight: true
    });

    const del = createDeleteButton({
      className: "npcSmallBtn danger",
      text: "Delete",
      onDelete: () => deleteNpc(npc.id),
    });

    footer.appendChild(sectionWrap);
    footer.appendChild(del);

    collapsible.appendChild(classBlock);
    collapsible.appendChild(hpRow);
    collapsible.appendChild(statusBlock);
    collapsible.appendChild(notesBlock);

    body.appendChild(headerRow);
    body.appendChild(collapsible);

    if (portrait) card.appendChild(portrait);
    card.appendChild(body);
    footer.hidden = isCollapsed;
    card.appendChild(footer);

    const getNpcQuery = () => (state.tracker.npcSearch || "");
    attachCardSearchHighlights({
      cardEl: card,
      getQuery: getNpcQuery,
      attachSearchHighlightOverlay,
    });

    return card;
  }

  function setActiveSection(sectionId) {
    updateTrackerField("npcActiveSectionId", sectionId);
    renderNpcTabs();
    renderNpcCards();
  }

  function renderNpcTabs() {
    renderSectionTabs({
      tabsEl,
      sections: state.tracker.npcSections || [],
      activeId: state.tracker.npcActiveSectionId,
      query: state.tracker.npcSearch || "",
      tabClass: "npcTab",
      sectionMatches: (sec, query) =>
        state.tracker.npcs.some((npc) => npc.sectionId === sec.id && matchesSearch(npc, query)),
      onSelect: (id) => setActiveSection(id),
    });
  }

  function setSearch(query) {
    updateTrackerField("npcSearch", query);
    renderNpcTabs();
    renderNpcCards();
  }

  function addNpc() {
    const npc = makeNpc({ sectionId: state.tracker.npcActiveSectionId });
    addTrackerCard("npc", npc, { atStart: true });
    renderNpcTabs();
    renderNpcCards();
  }

  function init() {
    if (initialized || destroyed) return;
    initialized = true;

    // Init-owned listeners and observers must share the same explicit teardown
    // path so tracker page re-init cannot leave duplicate bindings behind.
    masonry.attach(cardsEl, MASONRY_OPTIONS);

    searchEl.value = state.tracker.npcSearch;
    addListener(searchEl, "input", () => {
      setSearch(searchEl.value);
    });

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
          (tracker.npcs || []).forEach((npc) => {
            if (npc.sectionId === deleteId) npc.sectionId = fallbackId;
          });
          return true;
        }, { queueSave: false });
      },
      listenerSignal,
    });

    renderNpcTabs();
    renderNpcCards();

    addListener(addBtn, "click", () => {
      addNpc();
    });

    if (enhanceNumberSteppers) enhanceNumberSteppers(document);
  }

  return {
    init,
    render() {
      renderNpcCards();
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
    pickCropStorePortrait,
    ImagePicker,
    deleteBlob,
    putBlob,
    cropImageModal,
    getPortraitAspect,
    blobIdToObjectUrl,
    autoSizeInput,
  } = deps;
  const state = deps.state;

  if (!state) throw new Error("initNpcsPanel requires state");
  if (!blobIdToObjectUrl) throw new Error("initNpcsPanel requires blobIdToObjectUrl");
  if (!autoSizeInput) throw new Error("initNpcsPanel requires autoSizeInput");
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
  } = createStateActions({ state, SaveManager });

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

      (tracker.npcs || []).forEach((npc) => {
        if (!npc.sectionId) npc.sectionId = groupToSecId[npc.group] || friendly.id;
      });

      if (typeof tracker.npcActiveGroup === "string") {
        tracker.npcActiveSectionId = groupToSecId[tracker.npcActiveGroup] || friendly.id;
      }
    }

    if (typeof tracker.npcActiveSectionId !== "string" || !tracker.npcActiveSectionId) {
      tracker.npcActiveSectionId = tracker.npcSections[0].id;
    }
    if (!tracker.npcSections.some((section) => section.id === tracker.npcActiveSectionId)) {
      tracker.npcActiveSectionId = tracker.npcSections[0].id;
    }

    const defaultSectionId = tracker.npcSections[0].id;
    (tracker.npcs || []).forEach((npc) => {
      if (!npc.sectionId) npc.sectionId = defaultSectionId;
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

  const controller = createNpcCardsController({
    state,
    SaveManager,
    Popovers: Popovers || null,
    uiPrompt,
    uiAlert,
    uiConfirm,
    setStatus,
    makeNpc,
    enhanceNumberSteppers,
    numberOrNull,
    pickCropStorePortrait,
    ImagePicker,
    deleteBlob,
    putBlob,
    cropImageModal,
    getPortraitAspect,
    blobIdToObjectUrl,
    autoSizeInput,
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
