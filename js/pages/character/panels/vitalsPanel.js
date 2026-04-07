// js/pages/character/panels/vitalsPanel.js
// Character page Vitals panel (Vitals numbers + resource trackers)

import { numberOrNull } from "../../../utils/number.js";
import { safeAsync } from "../../../ui/safeAsync.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { requireMany, getNoopDestroyApi } from "../../../utils/domGuards.js";
import { flipSwapTwo } from "../../../ui/flipSwap.js";

function notifyStatus(setStatus, message) {
  if (typeof setStatus === "function") {
    setStatus(message);
    return;
  }
  console.warn(message);
}

function setupVitalsTileReorder({ state, SaveManager, panelEl, gridEl, actions = null }) {
  const panel = panelEl || document.getElementById("charVitalsPanel");
  const grid = gridEl || document.getElementById("charVitalsTiles") || panel?.querySelector(".charTiles");
  if (!panel || !grid) return;
  const localActions = actions || createStateActions({ state, SaveManager });
  const { mutateCharacter } = localActions;
  if (typeof mutateCharacter !== "function") return;

  const tiles = Array.from(grid.querySelectorAll(".charTile")).filter((t) => t.dataset.vitalKey);
  const defaultOrder = tiles.map((t) => t.dataset.vitalKey).filter(Boolean);

  mutateCharacter((character) => {
    if (!character.ui) character.ui = {};
    if (!Array.isArray(character.ui.vitalsOrder) || character.ui.vitalsOrder.length === 0) {
      character.ui.vitalsOrder = defaultOrder.slice();
    } else {
      const set = new Set(defaultOrder);
      const cleaned = character.ui.vitalsOrder.filter((k) => set.has(k));
      for (const k of defaultOrder) if (!cleaned.includes(k)) cleaned.push(k);
      character.ui.vitalsOrder = cleaned;
    }
    return true;
  }, { queueSave: false });

  function applyOrder() {
    const order = state.character.ui.vitalsOrder || defaultOrder;
    const map = new Map(Array.from(grid.querySelectorAll(".charTile")).map((t) => [t.dataset.vitalKey, t]));
    order.forEach((k) => {
      const el = map.get(k);
      if (el) grid.appendChild(el);
    });
  }

  function makeMoveBtn(label, title, key, dir) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "moveBtn";
    b.textContent = label;
    b.title = title;
    b.dataset.moveDirection = String(dir);
    b.dataset.vitalKey = key;
    return b;
  }

  function ensureVitalHeader(tileEl) {
    const resHeader = tileEl.querySelector(":scope > .resourceHeader");
    if (resHeader) return resHeader;

    const existing = tileEl.querySelector(":scope > .vitalHeader");
    if (existing) return existing;

    const label = tileEl.querySelector(":scope > .charTileLabel");
    if (!label) return null;

    const header = document.createElement("div");
    header.className = "vitalHeader";
    tileEl.insertBefore(header, label);
    header.appendChild(label);
    return header;
  }

  function attachMoves(tileEl) {
    const key = tileEl.dataset.vitalKey;
    if (!key) return;

    const header = ensureVitalHeader(tileEl);
    if (!header) return;

    if (header.querySelector(`[data-vital-moves="${key}"]`)) return;

    const wrap = document.createElement("div");
    wrap.className = "vitalMoves";
    wrap.dataset.vitalMoves = key;

    wrap.appendChild(makeMoveBtn("↑", "Move up", key, -1));
    wrap.appendChild(makeMoveBtn("↓", "Move down", key, +1));

    header.appendChild(wrap);
  }

  Array.from(grid.querySelectorAll(".charTile")).forEach(attachMoves);
  applyOrder();
}

export function initVitalsPanel(deps = {}) {
  const {
    state,
    SaveManager,
    autoSizeInput,
    enhanceNumberSteppers,
    uiConfirm,
    setStatus,
  } = deps;

  if (!state || !SaveManager) return getNoopDestroyApi();
  const { updateCharacterField, mutateCharacter } = createStateActions({ state, SaveManager });
  mutateCharacter(() => true, { queueSave: false });

  const required = {
    panelEl: "#charVitalsPanel",
    wrap: "#charVitalsTiles",
    addBtn: "#addResourceBtn",
    charHpCur: "#charHpCur",
    charHpMax: "#charHpMax",
    hitDieAmt: "#hitDieAmt",
    hitDieSize: "#hitDieSize",
    charAC: "#charAC",
    charInit: "#charInit",
    charSpeed: "#charSpeed",
    charProf: "#charProf",
    charSpellAtk: "#charSpellAtk",
    charSpellDC: "#charSpellDC"
  };
  const guard = requireMany(required, { root: document, setStatus, context: "Vitals panel" });
  if (!guard.ok) return guard.destroy;
  const { panelEl, wrap, addBtn } = guard.els;

  /** @type {Array<() => void>} */
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

  function markDirty() {
    try { SaveManager.markDirty(); } catch { /* ignore */ }
  }

  const vitalNumberFields = [
    { id: "charHpCur", path: "hpCur", getValue: () => state.character.hpCur },
    { id: "charHpMax", path: "hpMax", getValue: () => state.character.hpMax },
    { id: "hitDieAmt", path: "hitDieAmt", getValue: () => state.character.hitDieAmt },
    { id: "hitDieSize", path: "hitDieSize", getValue: () => state.character.hitDieSize },
    { id: "charAC", path: "ac", getValue: () => state.character.ac },
    { id: "charInit", path: "initiative", getValue: () => state.character.initiative },
    { id: "charSpeed", path: "speed", getValue: () => state.character.speed },
    { id: "charProf", path: "proficiency", getValue: () => state.character.proficiency },
    { id: "charSpellAtk", path: "spellAttack", getValue: () => state.character.spellAttack },
    { id: "charSpellDC", path: "spellDC", getValue: () => state.character.spellDC },
  ];

  function bindVitalsNumbers() {
    vitalNumberFields.forEach(({ id, path, getValue }) => {
      const el = guard.els[id];
      if (!el) return;

      const autosizeOpts = { min: 30, max: 60 };
      const value = getValue();
      el.value = (value === null || value === undefined) ? "" : String(value);

      if (typeof autoSizeInput === "function") {
        el.classList.add("autosize");
        autoSizeInput(el, autosizeOpts);
      }

      addListener(el, "input", () => {
        if (destroyed) return;
        updateCharacterField(path, numberOrNull(el.value), { queueSave: false });
        if (typeof autoSizeInput === "function") autoSizeInput(el, autosizeOpts);
        markDirty();
      });
    });
  }

  function newResource() {
    return {
      id: `res_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`,
      name: "",
      cur: null,
      max: null
    };
  }

  function ensureResourceArray() {
    mutateCharacter((character) => {
      if (!Array.isArray(character.resources)) character.resources = [];
      if (character.resources.length === 0) {
        character.resources.push(newResource());
      }
      return true;
    }, { queueSave: false });
  }

  function focusMoveButtonForVital(key, dir, fallbackBtn = null) {
    if (destroyed) return;
    requestAnimationFrame(() => {
      if (destroyed) return;
      const tileEl = Array.from(wrap.querySelectorAll(".charTile"))
        .find((tile) => tile.dataset.vitalKey === key);
      const target = tileEl?.querySelector(`.vitalMoves .moveBtn[data-move-direction="${dir}"]`) || fallbackBtn;
      try { target?.focus?.({ preventScroll: true }); } catch { target?.focus?.(); }
    });
  }

  function moveVital(key, dir, focusBtn = null) {
    if (destroyed) return;

    const currentOrder = state.character.ui?.vitalsOrder;
    const i = Array.isArray(currentOrder) ? currentOrder.indexOf(key) : -1;
    const j = i + dir;
    if (i === -1 || j < 0 || !Array.isArray(currentOrder) || j >= currentOrder.length) return;
    const adjacentKey = currentOrder[j];
    const tileEl = wrap.querySelector(`.charTile[data-vital-key="${key}"]`);
    const adjacentEl = wrap.querySelector(`.charTile[data-vital-key="${adjacentKey}"]`);

    const moved = mutateCharacter((character) => {
      const order = character.ui?.vitalsOrder;
      if (!Array.isArray(order)) return false;
      const from = order.indexOf(key);
      if (from === -1) return false;
      const to = from + dir;
      if (to < 0 || to >= order.length) return false;
      [order[from], order[to]] = [order[to], order[from]];
      return true;
    }, { queueSave: false });
    if (!moved) return;
    markDirty();

    const prevScroll = panelEl.scrollTop;
    const didSwap = flipSwapTwo(tileEl, adjacentEl, {
      durationMs: 260,
      easing: "cubic-bezier(.22,1,.36,1)",
      swap: () => {
        if (dir < 0) wrap.insertBefore(tileEl, adjacentEl);
        else wrap.insertBefore(adjacentEl, tileEl);
        panelEl.scrollTop = prevScroll;
      },
    });
    if (didSwap) {
      focusMoveButtonForVital(key, dir, focusBtn);
      return;
    }

    setupVitalsTileReorder({
      state,
      SaveManager,
      panelEl,
      gridEl: wrap,
      actions: { updateCharacterField, mutateCharacter }
    });
    focusMoveButtonForVital(key, dir, focusBtn);
  }

  function renderResources() {
    if (destroyed) return;

    ensureResourceArray();

    Array.from(wrap.querySelectorAll('.charTile[data-vital-key^="res:"]')).forEach((el) => el.remove());

    (state.character.resources || []).forEach((r, idx) => {
      const tile = document.createElement("div");
      tile.className = "charTile resourceTile";
      tile.dataset.resourceId = r.id;
      tile.dataset.vitalKey = `res:${r.id}`;

      const header = document.createElement("div");
      header.className = "resourceHeader";

      const title = document.createElement("div");
      title.className = "resourceTitle";
      title.setAttribute("contenteditable", "true");
      title.setAttribute("spellcheck", "false");
      title.setAttribute("role", "textbox");
      title.setAttribute("aria-label", "Resource name");
      title.dataset.placeholder = "Resource";
      title.textContent = (r.name ?? "").trim();

      addListener(title, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          title.blur();
        }
      });

      addListener(title, "input", () => {
        if (destroyed) return;
        const updated = mutateCharacter((character) => {
          const resource = character.resources?.find((item) => item?.id === r.id);
          if (!resource) return false;
          resource.name = title.textContent ?? "";
          return true;
        }, { queueSave: false });
        if (!updated) return;
        markDirty();
      });

      addListener(title, "blur", () => {
        const t = (title.textContent ?? "").trim();
        if (!t) title.textContent = "";
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "iconBtn danger resourceDeleteBtn";
      del.title = "Remove this resource";
      del.textContent = "X";
      del.disabled = (state.character.resources.length <= 1);
      addListener(
        del,
        "click",
        safeAsync(async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (state.character.resources.length <= 1) return;
          const name = (r.name || "").trim();
          const label = name ? `"${name}"` : "this resource tracker";
          if (!(await uiConfirm(`Delete ${label}?`, { title: "Delete Resource", okText: "Delete" }))) return;
          const removed = mutateCharacter((character) => {
            const removeIdx = character.resources?.findIndex((item) => item?.id === r.id) ?? -1;
            if (removeIdx === -1) return false;
            character.resources.splice(removeIdx, 1);
            return true;
          }, { queueSave: false });
          if (!removed) return;
          markDirty();
          renderResources();
        }, (err) => {
          console.error(err);
          notifyStatus(setStatus, "Delete resource failed.");
        })
      );

      header.appendChild(title);

      const footer = document.createElement("div");
      footer.className = "resourceFooterRow";

      const nums = document.createElement("div");
      nums.className = "resourceNums";

      const cur = document.createElement("input");
      cur.type = "number";
      cur.placeholder = "Cur";
      cur.classList.add("autosize");
      cur.value = (r.cur === null || r.cur === undefined) ? "" : String(r.cur);
      autoSizeInput?.(cur, { min: 30, max: 60 });
      addListener(cur, "input", () => {
        if (destroyed) return;
        const updated = mutateCharacter((character) => {
          const resource = character.resources?.find((item) => item?.id === r.id);
          if (!resource) return false;
          resource.cur = numberOrNull(cur.value);
          return true;
        }, { queueSave: false });
        if (!updated) return;
        autoSizeInput?.(cur, { min: 30, max: 60 });
        markDirty();
      });

      const slash = document.createElement("span");
      slash.className = "hpSlash";
      slash.textContent = "/";

      const max = document.createElement("input");
      max.type = "number";
      max.placeholder = "Max";
      max.classList.add("autosize");
      max.value = (r.max === null || r.max === undefined) ? "" : String(r.max);
      autoSizeInput?.(max, { min: 30, max: 60 });
      addListener(max, "input", () => {
        if (destroyed) return;
        const updated = mutateCharacter((character) => {
          const resource = character.resources?.find((item) => item?.id === r.id);
          if (!resource) return false;
          resource.max = numberOrNull(max.value);
          return true;
        }, { queueSave: false });
        if (!updated) return;
        autoSizeInput?.(max, { min: 30, max: 60 });
        markDirty();
      });

      nums.appendChild(cur);
      nums.appendChild(slash);
      nums.appendChild(max);

      footer.appendChild(nums);
      footer.appendChild(del);

      tile.appendChild(header);
      tile.appendChild(footer);

      wrap.appendChild(tile);
    });

    enhanceNumberSteppers?.(wrap);
    setupVitalsTileReorder({
      state,
      SaveManager,
      panelEl,
      gridEl: wrap,
      actions: { updateCharacterField, mutateCharacter }
    });
  }

  bindVitalsNumbers();

  addListener(addBtn, "click", () => {
    if (destroyed) return;
    ensureResourceArray();
    mutateCharacter((character) => {
      character.resources.push(newResource());
      return true;
    }, { queueSave: false });
    markDirty();
    renderResources();
  });

  addListener(wrap, "click", (event) => {
    if (destroyed) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const moveBtn = target.closest(".vitalMoves .moveBtn");
    if (!(moveBtn instanceof HTMLButtonElement)) return;

    const key = moveBtn.dataset.vitalKey;
    const dir = Number(moveBtn.dataset.moveDirection);
    if (!key || (dir !== -1 && dir !== 1)) return;

    event.preventDefault();
    event.stopPropagation();
    moveVital(key, dir, moveBtn);
  });

  setupVitalsTileReorder({
    state,
    SaveManager,
    panelEl,
    gridEl: wrap,
    actions: { updateCharacterField, mutateCharacter }
  });
  renderResources();

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
