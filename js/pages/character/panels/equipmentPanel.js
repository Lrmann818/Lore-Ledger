// Character Equipment panel (Inventory + Money).
// Inventory uses tabbed notes + toolbar actions (add/rename/delete/search).
//
// State shape (stored in state.character):
//   inventoryItems: [{ title, notes }]
//   activeInventoryIndex: number
//   inventorySearch: string

import { attachSearchHighlightOverlay } from "../../../ui/searchHighlightOverlay.js";
import { safeAsync } from "../../../ui/safeAsync.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { requireMany, getNoopDestroyApi } from "../../../utils/domGuards.js";
import { numberOrNull } from "../../../utils/number.js";

function notifyStatus(setStatus, message) {
  if (typeof setStatus === "function") {
    setStatus(message);
    return;
  }
  console.warn(message);
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

export function initEquipmentPanel(deps = {}) {
  const {
    state,
    SaveManager,
    uiPrompt,
    uiAlert,
    uiConfirm,
    autoSizeInput,
    setStatus
  } = deps;

  if (!state) {
    console.warn("initEquipmentPanel: missing state");
    return getNoopDestroyApi();
  }
  if (!SaveManager) {
    console.warn("initEquipmentPanel: missing SaveManager");
    return getNoopDestroyApi();
  }

  const { updateCharacterField, mutateCharacter } = createStateActions({ state, SaveManager });

  const required = {
    panelEl: "#charEquipmentPanel",
    tabsEl: "#inventoryTabs",
    notesBoxEl: "#inventoryNotesBox",
    searchEl: "#inventorySearch",
    addBtn: "#addInventoryBtn",
    renameBtn: "#renameInventoryBtn",
    deleteBtn: "#deleteInventoryBtn",
    moneyPP: "#moneyPP",
    moneyGP: "#moneyGP",
    moneyEP: "#moneyEP",
    moneySP: "#moneySP",
    moneyCP: "#moneyCP"
  };
  const guard = requireMany(required, { root: document, setStatus, context: "Equipment panel" });
  if (!guard.ok) return guard.destroy;
  const {
    tabsEl,
    notesBoxEl,
    searchEl,
    addBtn,
    renameBtn,
    deleteBtn,
    moneyPP,
    moneyGP,
    moneyEP,
    moneySP,
    moneyCP
  } = guard.els;

  const destroyFns = [];
  const addDestroy = (destroyFn) => {
    if (typeof destroyFn === "function") destroyFns.push(destroyFn);
  };

  const listenerController = new AbortController();
  const listenerSignal = listenerController.signal;
  addDestroy(() => listenerController.abort());

  let destroyed = false;

  const addListener = (target, type, handler, options) => {
    if (!target || typeof target.addEventListener !== "function") return;
    const listenerOptions =
      typeof options === "boolean"
        ? { capture: options }
        : (options || {});
    target.addEventListener(type, handler, { ...listenerOptions, signal: listenerSignal });
  };

  function ensureInventoryDefaults() {
    mutateCharacter((character) => {
      if (!Array.isArray(character.inventoryItems)) {
        const legacy = typeof character.equipment === "string" ? character.equipment : "";
        character.inventoryItems = [{ title: "Inventory", notes: legacy || "" }];
      } else {
        const legacy = typeof character.equipment === "string" ? character.equipment : "";
        const hasAnyNotes = character.inventoryItems.some((item) => item && typeof item.notes === "string" && item.notes.trim());
        if (!hasAnyNotes && legacy && String(legacy).trim()) {
          if (!character.inventoryItems[0]) character.inventoryItems[0] = { title: "Inventory", notes: "" };
          if (!character.inventoryItems[0].notes || !String(character.inventoryItems[0].notes).trim()) {
            character.inventoryItems[0].notes = legacy;
          }
          if (!character.inventoryItems[0].title) character.inventoryItems[0].title = "Inventory";
        }
      }

      if (character.inventoryItems.length === 0) {
        character.inventoryItems.push({ title: "Inventory", notes: "" });
      }
      if (typeof character.activeInventoryIndex !== "number") character.activeInventoryIndex = 0;
      if (character.activeInventoryIndex < 0) character.activeInventoryIndex = 0;
      if (character.activeInventoryIndex >= character.inventoryItems.length) {
        character.activeInventoryIndex = character.inventoryItems.length - 1;
      }
      if (typeof character.inventorySearch !== "string") character.inventorySearch = "";
      if (!character.money) character.money = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };

      return true;
    }, { queueSave: false });
  }

  function markDirty() {
    try { SaveManager.markDirty(); } catch { /* ignore */ }
  }

  function renderInventoryTabs() {
    if (destroyed) return;

    tabsEl.replaceChildren();

    const query = (state.character.inventorySearch || "").trim().toLowerCase();
    const items = Array.isArray(state.character.inventoryItems) ? state.character.inventoryItems : [];
    const itemsToShow = items
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => {
        if (!query) return true;
        const title = (item.title || "").toLowerCase();
        const notes = (item.notes || "").toLowerCase();
        return title.includes(query) || notes.includes(query);
      });

    itemsToShow.forEach(({ item, idx }) => {
      const btn = document.createElement("button");
      btn.className = "sessionTab" + (idx === state.character.activeInventoryIndex ? " active" : "");
      btn.type = "button";
      appendHighlightedText(btn, item.title || `Item ${idx + 1}`, state.character.inventorySearch || "");
      btn.addEventListener("click", () => switchInventoryItem(idx));
      tabsEl.appendChild(btn);
    });

    const current = items[state.character.activeInventoryIndex];
    notesBoxEl.value = current?.notes || "";
    notesHighlight.update();

    if (itemsToShow.length === 0) {
      const hint = document.createElement("div");
      hint.className = "mutedSmall";
      hint.style.marginLeft = "6px";
      hint.textContent = "No matching items.";
      tabsEl.appendChild(hint);
    }
  }

  function switchInventoryItem(idx) {
    const updated = mutateCharacter((character) => {
      const items = character.inventoryItems || [];
      const current = items[character.activeInventoryIndex];
      if (current) current.notes = notesBoxEl.value;
      character.activeInventoryIndex = idx;
      return true;
    }, { queueSave: false });

    if (!updated || destroyed) return;
    markDirty();
    renderInventoryTabs();
    notesBoxEl.focus();
  }

  function ensureMoney() {
    mutateCharacter((character) => {
      if (!character.money) character.money = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
      return true;
    }, { queueSave: false });
  }

  function bindMoneyInput(input, key) {
    if (!input) return;

    const autosizeOpts = { min: 30, max: 320 };
    input.value = state.character.money?.[key] == null ? "" : String(state.character.money[key]);

    if (typeof autoSizeInput === "function") {
      input.classList.add("autosize");
      autoSizeInput(input, autosizeOpts);
    }

    addListener(input, "input", () => {
      ensureMoney();
      updateCharacterField(`money.${key}`, numberOrNull(input.value) ?? 0, { queueSave: false });
      if (typeof autoSizeInput === "function") autoSizeInput(input, autosizeOpts);
      markDirty();
    });
  }

  ensureInventoryDefaults();
  searchEl.value = state.character.inventorySearch || "";

  const notesHighlight = attachSearchHighlightOverlay(
    notesBoxEl,
    () => state.character.inventorySearch || ""
  );
  addDestroy(() => notesHighlight.destroy());

  addListener(searchEl, "input", () => {
    updateCharacterField("inventorySearch", searchEl.value, { queueSave: false });
    markDirty();
    renderInventoryTabs();
  });

  addListener(notesBoxEl, "input", () => {
    const updated = mutateCharacter((character) => {
      const current = character.inventoryItems?.[character.activeInventoryIndex];
      if (!current) return false;
      current.notes = notesBoxEl.value;
      return true;
    }, { queueSave: false });
    if (!updated) return;
    markDirty();
  });

  addListener(
    addBtn,
    "click",
    safeAsync(async () => {
      mutateCharacter((character) => {
        const current = character.inventoryItems?.[character.activeInventoryIndex];
        if (!current) return false;
        current.notes = notesBoxEl.value;
        return true;
      }, { queueSave: false });

      const nextNum = (state.character.inventoryItems?.length || 0) + 1;
      const defaultTitle = `Item ${nextNum}`;
      const proposed = await uiPrompt?.("Name this item:", {
        defaultValue: defaultTitle,
        title: "New Inventory Item"
      });

      if (destroyed || proposed === null || proposed === undefined) return;

      const name = String(proposed).trim();
      const finalTitle = name || defaultTitle;

      mutateCharacter((character) => {
        character.inventoryItems.push({
          title: finalTitle,
          notes: ""
        });
        character.activeInventoryIndex = character.inventoryItems.length - 1;
        return true;
      }, { queueSave: false });

      if (destroyed) return;
      markDirty();
      renderInventoryTabs();
      notesBoxEl.focus();
    }, (err) => {
      console.error(err);
      notifyStatus(setStatus, "Add inventory item failed.");
    })
  );

  addListener(
    renameBtn,
    "click",
    safeAsync(async () => {
      const current = state.character.inventoryItems?.[state.character.activeInventoryIndex];
      if (!current) return;

      const proposed = await uiPrompt?.("Rename item tab to:", {
        defaultValue: current.title || "",
        title: "Rename Item"
      });
      if (destroyed || proposed === null || proposed === undefined) return;

      mutateCharacter((character) => {
        const item = character.inventoryItems?.[character.activeInventoryIndex];
        if (!item) return false;
        item.title = String(proposed).trim() || item.title || `Item ${character.activeInventoryIndex + 1}`;
        return true;
      }, { queueSave: false });

      if (destroyed) return;
      markDirty();
      renderInventoryTabs();
    }, (err) => {
      console.error(err);
      notifyStatus(setStatus, "Rename inventory item failed.");
    })
  );

  addListener(
    deleteBtn,
    "click",
    safeAsync(async (event) => {
      if ((state.character.inventoryItems?.length || 0) <= 1) {
        await uiAlert?.("You need at least one inventory item.", { title: "Notice" });
        const target = event?.target;
        if (target && typeof target === "object" && "value" in target) target.value = "";
        return;
      }

      const ok = await uiConfirm?.("Delete this inventory item? This cannot be undone.", {
        title: "Delete Item",
        okText: "Delete"
      });
      if (destroyed || !ok) return;

      mutateCharacter((character) => {
        const idx = character.activeInventoryIndex;
        character.inventoryItems.splice(idx, 1);
        character.activeInventoryIndex = Math.max(0, idx - 1);
        return true;
      }, { queueSave: false });

      if (destroyed) return;
      markDirty();
      renderInventoryTabs();
    }, (err) => {
      console.error(err);
      notifyStatus(setStatus, "Delete inventory item failed.");
    })
  );

  bindMoneyInput(moneyPP, "pp");
  bindMoneyInput(moneyGP, "gp");
  bindMoneyInput(moneyEP, "ep");
  bindMoneyInput(moneySP, "sp");
  bindMoneyInput(moneyCP, "cp");

  renderInventoryTabs();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (let i = destroyFns.length - 1; i >= 0; i--) {
        destroyFns[i]?.();
      }
    }
  };
}
