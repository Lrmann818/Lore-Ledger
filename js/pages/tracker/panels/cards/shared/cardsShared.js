import { safeAsync } from "../../../../../ui/safeAsync.js";
import { createStateActions } from "../../../../../domain/stateActions.js";

/** @typedef {{ id: string, name: string }} SectionEntry */

export function makeSectionId(prefix) {
  return `${prefix}_` + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appendHighlightedText(parentEl, text, query) {
  const source = String(text ?? "");
  const q = String(query ?? "").trim();
  if (!q) {
    parentEl.replaceChildren(document.createTextNode(source));
    return;
  }

  const re = new RegExp(escapeRegExp(q), "gi");
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match = re.exec(source);

  while (match) {
    const start = match.index;
    const end = start + match[0].length;

    if (start > lastIndex) {
      fragment.appendChild(document.createTextNode(source.slice(lastIndex, start)));
    }

    const mark = document.createElement("mark");
    mark.className = "searchMark";
    mark.textContent = source.slice(start, end);
    fragment.appendChild(mark);

    lastIndex = end;
    match = re.exec(source);
  }

  if (lastIndex < source.length) {
    fragment.appendChild(document.createTextNode(source.slice(lastIndex)));
  }

  parentEl.replaceChildren(fragment);
}

/**
 * @param {Object} config
 * @param {HTMLElement} config.tabsEl
 * @param {Array<{id:string,name:string}>} config.sections
 * @param {string} config.activeId
 * @param {string} config.query
 * @param {string} config.tabClass
 * @param {(sec:{id:string,name:string}, query:string) => boolean} config.sectionMatches
 * @param {(sectionId:string) => void} config.onSelect
 */
export function renderSectionTabs({
  tabsEl,
  sections,
  activeId,
  query,
  tabClass,
  sectionMatches,
  onSelect,
}) {
  tabsEl.replaceChildren();
  const q = String(query ?? "").trim().toLowerCase();

  let toShow = (sections || []).filter(sec => {
    if (!q) return true;
    const nameMatch = (sec.name || "").toLowerCase().includes(q);
    if (nameMatch) return true;
    return sectionMatches ? sectionMatches(sec, q) : false;
  });

  toShow.forEach(sec => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${tabClass}${sec.id === activeId ? " active" : ""}`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", sec.id === activeId ? "true" : "false");
    appendHighlightedText(btn, sec.name || "Section", query);
    btn.addEventListener("click", () => onSelect(sec.id));
    tabsEl.appendChild(btn);
  });

  if (toShow.length === 0) {
    const hint = document.createElement("div");
    hint.className = "mutedSmall";
    hint.style.marginLeft = "6px";
    hint.textContent = "No matching sections.";
    tabsEl.appendChild(hint);
  }
}

/**
 * @param {Object} config
 */
export function wireSectionCrud({
  state,
  SaveManager,
  uiPrompt,
  uiAlert,
  uiConfirm,
  setStatus,

  addSectionBtn,
  renameSectionBtn,
  deleteSectionBtn,

  sectionsKey,
  activeKey,
  idPrefix,

  newTitle,
  renameTitle,
  deleteTitle,
  deleteConfirmText,

  renderTabs,
  renderCards,
  onDeleteMoveItems,

  newPromptLabel = "New section name:",
  renamePromptLabel = "Rename section to:",
  minSectionsMessage = "You need at least one section.",
  minSectionsTitle = "Notice",
  missingPromptMessage = "This action needs the in-app prompt dialog, but it isn't available.",
  missingPromptTitle = "Missing Dialog",
  missingConfirmMessage = "This action needs the in-app confirm dialog, but it isn't available.",
  missingConfirmTitle = "Missing Dialog",
  listenerSignal,
}) {
  if (!setStatus) throw new Error("wireSectionCrud requires setStatus");
  const { mutateTracker } = createStateActions({ state, SaveManager });
  const listenerOptions = listenerSignal ? { signal: listenerSignal } : undefined;
  /**
   * @param {Record<string, unknown>} tracker
   * @returns {SectionEntry[]}
   */
  const getSectionList = (tracker) => {
    if (!Array.isArray(tracker[sectionsKey])) tracker[sectionsKey] = [];
    return /** @type {SectionEntry[]} */ (tracker[sectionsKey]);
  };
  /**
   * @param {Record<string, unknown>} tracker
   * @returns {string}
   */
  const getActiveSectionId = (tracker) => (
    typeof tracker[activeKey] === "string" ? tracker[activeKey] : ""
  );

  addSectionBtn.addEventListener(
    "click",
    safeAsync(async () => {
      if (!uiPrompt) {
        await uiAlert?.(missingPromptMessage, { title: missingPromptTitle });
        return;
      }

      const nextNum = (state.tracker[sectionsKey]?.length || 0) + 1;
      const proposed = await uiPrompt(newPromptLabel, {
        defaultValue: `Section ${nextNum}`,
        title: newTitle,
      });
      if (proposed === null) return;

      const name = proposed.trim() || `Section ${nextNum}`;
      const sec = { id: makeSectionId(idPrefix), name };
      const added = mutateTracker((tracker) => {
        const sections = getSectionList(tracker);
        sections.push(sec);
        tracker[activeKey] = sec.id;
        return true;
      });
      if (!added) return;

      renderTabs();
      renderCards();
    }, (err) => {
      console.error(err);
      setStatus("Add section failed.");
    }),
    listenerOptions
  );

  renameSectionBtn.addEventListener(
    "click",
    safeAsync(async () => {
      const sections = getSectionList(state.tracker);
      const activeSectionId = getActiveSectionId(state.tracker);
      const sec = sections.find((s) => s.id === activeSectionId);
      if (!sec) return;

      if (!uiPrompt) {
        await uiAlert?.(missingPromptMessage, { title: missingPromptTitle });
        return;
      }

      const proposed = await uiPrompt(renamePromptLabel, {
        defaultValue: sec.name || "",
        title: renameTitle,
      });
      if (proposed === null) return;

      const renamed = mutateTracker((tracker) => {
        const sections = getSectionList(tracker);
        const activeSectionId = getActiveSectionId(tracker);
        const target = sections.find((s) => s.id === activeSectionId);
        if (!target) return false;
        target.name = proposed.trim() || target.name || "Section";
        return true;
      });
      if (!renamed) return;

      renderTabs();
    }, (err) => {
      console.error(err);
      setStatus("Rename section failed.");
    }),
    listenerOptions
  );

  deleteSectionBtn.addEventListener(
    "click",
    safeAsync(async () => {
      const sections = getSectionList(state.tracker);
      if (sections.length <= 1) {
        await uiAlert?.(minSectionsMessage, { title: minSectionsTitle });
        return;
      }

      const activeSectionId = getActiveSectionId(state.tracker);
      const sec = sections.find((s) => s.id === activeSectionId);
      if (!sec) return;

      if (!uiConfirm) {
        await uiAlert?.(missingConfirmMessage, { title: missingConfirmTitle });
        return;
      }

      const ok = await uiConfirm(deleteConfirmText(sec.name), { title: deleteTitle, okText: "Delete" });
      if (!ok) return;

      const deleted = mutateTracker((tracker) => {
        const list = getSectionList(tracker);
        const activeId = getActiveSectionId(tracker);
        const activeSection = list.find((s) => s.id === activeId);
        if (!activeSection) return false;

        const deleteId = activeSection.id;
        tracker[sectionsKey] = list.filter((s) => s.id !== deleteId);
        const nextSections = getSectionList(tracker);
        const fallbackId = nextSections[0]?.id;
        if (!fallbackId) return false;

        onDeleteMoveItems?.(deleteId, fallbackId);
        tracker[activeKey] = fallbackId;
        return true;
      });
      if (!deleted) return;

      renderTabs();
      renderCards();
    }, (err) => {
      console.error(err);
      setStatus("Delete section failed.");
    }),
    listenerOptions
  );
}
