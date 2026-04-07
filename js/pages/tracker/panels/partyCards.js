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
import { createCardIncrementalDomPatcher } from "./cards/shared/cardIncrementalPatchShared.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { requireMany } from "../../../utils/domGuards.js";
import { startJumpDebugRun, queueJumpDebugCheckpoints } from "../../../ui/jumpDebug.js";
import * as masonry from "../../../ui/masonryLayout.js";

/** @typedef {import("../../../domain/factories.js").PartyMemberCard} PartyMemberCard */

const USE_INCREMENTAL_CARDS = true;
const USE_INCREMENTAL_PORTRAIT = true;
const USE_INCREMENTAL_REORDER = true;
const MASONRY_OPTIONS = { panelName: "party", minCardWidth: 175, gapVar: "--cards-grid-gap" };
const matchesSearch = makeFieldSearchMatcher(["name", "className", "status", "notes"]);

function createPartyCardsController(deps = {}) {
  const {
    state,
    SaveManager,
    Popovers,
    uiPrompt,
    uiAlert,
    uiConfirm,
    setStatus,
    makePartyMember,
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
   * @param {string} memberId
   * @returns {PartyMemberCard | null}
   */
  const getPartyMemberById = (memberId) => state?.tracker?.party?.find((member) => member.id === memberId) || null;
  const getSearchQuery = () => (state?.tracker?.partySearch || "").trim();
  const parseNumberOrNull = (value) => (
    typeof numberOrNull === "function"
      ? numberOrNull(value)
      : (value === "" || value == null ? null : Number(value))
  );
  const getVisibleParty = () => {
    const sectionId = state.tracker.partyActiveSectionId;
    const query = getSearchQuery();
    return state.tracker.party
      .filter((member) => member.sectionId === sectionId)
      .filter((member) => matchesSearch(member, query));
  };
  const cardDomPatcher = createCardIncrementalDomPatcher({
    cardsEl,
    blobIdToObjectUrl,
  });
  const schedulePartyMasonryRelayout = () => cardDomPatcher.scheduleMasonryRelayout();
  const focusPartyCardCollapseButton = (cardId, fallbackEl = null) => cardDomPatcher.focusCollapseButton(cardId, fallbackEl);
  const patchPartyCardReorder = (cardId, adjacentId, dir) => cardDomPatcher.patchReorder(cardId, adjacentId, dir);
  const patchPartyCardCollapsed = (cardId, collapsed, focusEl = null) => cardDomPatcher.patchCollapsed(cardId, collapsed, focusEl);
  const patchPartyCardPortrait = (cardId, hidden, focusEl = null) => cardDomPatcher.patchPortrait({
    cardId,
    hidden,
    focusEl,
    getItemById: getPartyMemberById,
    getBlobId: (member) => member.imgBlobId,
    getAltText: (member) => member.name || "Party Member Portrait",
    onPick: (member) => pickPartyImage(member.id),
    onToggleHidden: (member, nextHidden) => setPartyPortraitHidden(member.id, nextHidden),
  });

  function renderPartyCards() {
    if (!state) return;

    const prevScroll = cardsEl.scrollTop;
    const shouldMaskRerender = prevScroll > 0;
    if (shouldMaskRerender) cardsEl.classList.add("cardsRerenderMask");

    const raf = requestAnimationFrame;
    const renderRun = startJumpDebugRun({
      panel: "party",
      cardId: "render",
      action: "render",
      panelEl: cardsEl,
      getCardEl: () => cardsEl?.querySelector(".trackerCard"),
    });
    renderRun?.log("before-dom-rebuild");

    const query = getSearchQuery();
    const list = getVisibleParty();
    cardsEl.innerHTML = "";

    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "mutedSmall";
      empty.textContent = query
        ? "No party members match your search in this section."
        : "No party members in this section yet. Click “+ Add Member”.";
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

    list.forEach((member) => cardsEl.appendChild(renderPartyCard(member)));
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

    SaveManager.markDirty();
    if (rerender) renderPartyCards();
  }

  function setPartyPortraitHidden(id, hidden) {
    if (!setCardPortraitHidden("party", id, hidden, { queueSave: false })) return;
    SaveManager.markDirty();
    const focusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (USE_INCREMENTAL_CARDS && USE_INCREMENTAL_PORTRAIT && patchPartyCardPortrait(id, hidden, focusEl)) return;
    renderPartyCards();
  }

  function movePartyCard(id, dir) {
    const visible = getVisibleParty();
    const pos = visible.findIndex((member) => member.id === id);
    const newPos = pos + dir;
    if (pos === -1 || newPos < 0 || newPos >= visible.length) return;

    const action = dir < 0 ? "moveUp" : "moveDown";
    const jumpRun = startJumpDebugRun({
      panel: "party",
      cardId: id,
      action,
      panelEl: cardsEl,
      getCardEl: () => cardsEl?.querySelector(`.trackerCard[data-card-id="${id}"]`),
    });
    jumpRun?.log("before-swap");

    const aId = visible[pos].id;
    const bId = visible[newPos].id;

    if (!swapTrackerCards("party", aId, bId)) return;
    jumpRun?.log("after-swap");

    if (USE_INCREMENTAL_CARDS && USE_INCREMENTAL_REORDER && patchPartyCardReorder(aId, bId, dir)) {
      jumpRun?.log("after-incremental-reorder");
      queueJumpDebugCheckpoints(jumpRun);
      return;
    }

    renderPartyCards();
    jumpRun?.log("after-render");
    queueJumpDebugCheckpoints(jumpRun);
  }

  async function pickPartyImage(memberId) {
    const ok = await pickAndStorePortrait({
      itemId: memberId,
      getItemById: getPartyMemberById,
      getBlobId: (member) => member.imgBlobId,
      setBlobId: (_member, blobId) => updateTrackerCardField("party", memberId, "imgBlobId", blobId, { queueSave: false }),
      deps: {
        pickCropStorePortrait,
        ImagePicker,
        deleteBlob,
        putBlob,
        cropImageModal,
        getPortraitAspect,
        SaveManager,
        uiAlert,
      },
      setStatus,
    });
    if (!ok) return;
    renderPartyCards();
  }

  async function deleteParty(id) {
    const member = getPartyMemberById(id);
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

  function renderPartyCard(member) {
    const card = document.createElement("div");
    card.className = "trackerCard npcCardStack";
    card.dataset.cardId = member.id;

    const isCollapsed = !!member.collapsed;
    card.classList.toggle("collapsed", isCollapsed);

    const body = document.createElement("div");
    body.className = "npcCardBodyStack";

    const headerRow = document.createElement("div");
    headerRow.className = "npcHeaderRow";

    const nameInput = document.createElement("input");
    nameInput.className = "npcField npcNameBig";
    nameInput.placeholder = "Name";
    nameInput.value = member.name || "";
    nameInput.addEventListener("input", () => updateParty(member.id, { name: nameInput.value }, false));

    const moveUp = createMoveButton({
      direction: -1,
      onMove: () => {
        movePartyCard(member.id, -1);
      },
    });

    const moveDown = createMoveButton({
      direction: +1,
      onMove: () => {
        movePartyCard(member.id, +1);
      },
    });

    const toggle = createCollapseButton({
      isCollapsed,
      onToggle: () => {
        const currentCollapsed = !!getPartyMemberById(member.id)?.collapsed;
        const nextCollapsed = !currentCollapsed;
        const action = currentCollapsed ? "expand" : "collapse";
        const jumpRun = startJumpDebugRun({
          panel: "party",
          cardId: member.id,
          action,
          panelEl: cardsEl,
          getCardEl: () => cardsEl?.querySelector(`.trackerCard[data-card-id="${member.id}"]`) || card,
        });
        jumpRun?.log("before-click-handler");

        updateParty(member.id, { collapsed: nextCollapsed }, false);
        jumpRun?.log("after-state-update");

        if (USE_INCREMENTAL_CARDS && patchPartyCardCollapsed(member.id, nextCollapsed, toggle)) {
          jumpRun?.log("after-incremental-patch");
          queueJumpDebugCheckpoints(jumpRun);
          return;
        }

        renderPartyCards();
        jumpRun?.log("after-render");
        focusPartyCardCollapseButton(member.id);
        queueJumpDebugCheckpoints(jumpRun);
      },
    });

    headerRow.appendChild(nameInput);
    headerRow.appendChild(moveUp);
    headerRow.appendChild(moveDown);

    const portrait = renderCardPortrait({
      blobId: member.imgBlobId,
      altText: member.name || "Party Member Portrait",
      blobIdToObjectUrl,
      onPick: () => pickPartyImage(member.id),
      isHidden: !!member.portraitHidden,
      onToggleHidden: (hidden) => setPartyPortraitHidden(member.id, hidden),
      headerControlsEl: headerRow,
      onImageLoad: schedulePartyMasonryRelayout,
    });
    headerRow.appendChild(toggle);

    const collapsible = document.createElement("div");
    collapsible.className = "npcCollapsible";
    collapsible.hidden = isCollapsed;

    const classRow = document.createElement("div");
    classRow.className = "npcRowBlock";

    const classLabel = document.createElement("div");
    classLabel.className = "npcMiniLabel";
    classLabel.textContent = "Class";

    const classInput = document.createElement("input");
    classInput.className = "npcField npcClass";
    classInput.placeholder = "Class / Role";
    classInput.value = member.className || "";
    classInput.classList.add("autosize");
    autoSizeInput(classInput, { min: 60, max: 200 });
    classInput.addEventListener("input", () => updateParty(member.id, { className: classInput.value }, false));

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
    hpCur.value = member.hpCurrent ?? "";
    autoSizeInput(hpCur, { min: 30, max: 70 });
    hpCur.addEventListener("input", () => {
      autoSizeInput(hpCur, { min: 30, max: 70 });
      updateParty(member.id, { hpCurrent: parseNumberOrNull(hpCur.value) }, false);
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
    hpMax.value = member.hpMax ?? "";
    autoSizeInput(hpMax, { min: 30, max: 70 });
    hpMax.addEventListener("input", () => {
      autoSizeInput(hpMax, { min: 30, max: 70 });
      updateParty(member.id, { hpMax: parseNumberOrNull(hpMax.value) }, false);
    });

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
    statusInput.value = member.status || "";
    autoSizeInput(statusInput, { min: 60, max: 300 });
    statusInput.addEventListener("input", () => updateParty(member.id, { status: statusInput.value }, false));

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
    notesArea.value = member.notes || "";
    notesArea.addEventListener("input", () => updateParty(member.id, { notes: notesArea.value }, false));

    notesBlock.appendChild(notesLabel);
    notesBlock.appendChild(notesArea);

    collapsible.appendChild(classRow);
    collapsible.appendChild(hpRow);
    collapsible.appendChild(statusRow);
    collapsible.appendChild(notesBlock);

    const footer = document.createElement("div");
    footer.className = "npcCardFooter";

    const { sectionWrap } = createSectionSelectRow({
      sections: state.tracker.partySections || [],
      value: member.sectionId || state.tracker.partyActiveSectionId,
      onChange: (newVal) => {
        updateParty(member.id, { sectionId: newVal }, true);
        renderPartyTabs();
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
      onDelete: () => deleteParty(member.id),
    });

    footer.appendChild(sectionWrap);
    footer.appendChild(del);

    body.appendChild(headerRow);
    body.appendChild(collapsible);

    if (portrait) card.appendChild(portrait);
    card.appendChild(body);

    footer.hidden = isCollapsed;
    card.appendChild(footer);

    attachCardSearchHighlights({
      cardEl: card,
      getQuery: () => (state.tracker.partySearch || ""),
      attachSearchHighlightOverlay,
    });

    return card;
  }

  function setActiveSection(sectionId) {
    updateTrackerField("partyActiveSectionId", sectionId);
    renderPartyTabs();
    renderPartyCards();
  }

  function renderPartyTabs() {
    renderSectionTabs({
      tabsEl,
      sections: state.tracker.partySections || [],
      activeId: state.tracker.partyActiveSectionId,
      query: state.tracker.partySearch || "",
      tabClass: "npcTab",
      sectionMatches: (sec, query) =>
        state.tracker.party.some((member) => member.sectionId === sec.id && matchesSearch(member, query)),
      onSelect: (id) => setActiveSection(id),
    });
  }

  function setSearch(query) {
    updateTrackerField("partySearch", query);
    renderPartyTabs();
    renderPartyCards();
  }

  function addPartyMember() {
    const member = makePartyMember({ sectionId: state.tracker.partyActiveSectionId });
    addTrackerCard("party", member, { atStart: true });
    renderPartyTabs();
    renderPartyCards();
  }

  function init() {
    if (initialized || destroyed) return;
    initialized = true;

    masonry.attach(cardsEl, MASONRY_OPTIONS);

    searchEl.value = state.tracker.partySearch;
    addListener(searchEl, "input", () => {
      setSearch(searchEl.value);
    });

    addListener(addBtn, "click", () => {
      addPartyMember();
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
        mutateTracker((tracker) => {
          (tracker.party || []).forEach((member) => {
            if (member.sectionId === deleteId) member.sectionId = fallbackId;
          });
          return true;
        }, { queueSave: false });
      },
      listenerSignal,
    });

    renderPartyTabs();
    renderPartyCards();

    if (enhanceNumberSteppers) enhanceNumberSteppers(document);
  }

  return {
    init,
    render() {
      renderPartyCards();
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

// Initialize Party panel wiring + CRUD handlers.
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
  const state = deps.state;

  if (!state) throw new Error("initPartyPanel requires state");
  if (!blobIdToObjectUrl) throw new Error("initPartyPanel requires blobIdToObjectUrl");
  if (!autoSizeInput) throw new Error("initPartyPanel requires autoSizeInput");
  if (!SaveManager) throw new Error("initPartyPanel: missing SaveManager");
  if (!makePartyMember) throw new Error("initPartyPanel: missing makePartyMember");

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
    if (!Array.isArray(tracker.party)) tracker.party = [];
    if (typeof tracker.partySearch !== "string") tracker.partySearch = "";

    if (!Array.isArray(tracker.partySections) || tracker.partySections.length === 0) {
      tracker.partySections = [{
        id: "partysec_" + Math.random().toString(36).slice(2) + Date.now().toString(36),
        name: "Main",
      }];
    }
    if (typeof tracker.partyActiveSectionId !== "string" || !tracker.partyActiveSectionId) {
      tracker.partyActiveSectionId = tracker.partySections[0].id;
    }
    if (!tracker.partySections.some((section) => section.id === tracker.partyActiveSectionId)) {
      tracker.partyActiveSectionId = tracker.partySections[0].id;
    }

    const defaultSectionId = tracker.partySections[0].id;
    tracker.party.forEach((member) => {
      if (!member.sectionId) member.sectionId = defaultSectionId;
    });
    return true;
  }, { queueSave: false });

  const required = {
    cardsEl: "#partyCards",
    addBtn: "#addPartyBtn",
    searchEl: "#partySearch",
    tabsEl: "#partyTabs",
    addSectionBtn: "#addPartySectionBtn",
    renameSectionBtn: "#renamePartySectionBtn",
    deleteSectionBtn: "#deletePartySectionBtn",
  };
  const guard = requireMany(required, { root: document, setStatus, context: "Party panel" });
  if (!guard.ok) return guard.destroy;

  const controller = createPartyCardsController({
    state,
    SaveManager,
    Popovers: Popovers || null,
    uiPrompt,
    uiAlert,
    uiConfirm,
    setStatus,
    makePartyMember,
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
