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

  function findTileByVitalKey(vitalKey) {
    return Array.from(grid.querySelectorAll(".charTile")).find((t) => t.dataset.vitalKey === vitalKey) || null;
  }

  function moveVital(key, dir) {
    const currentOrder = state.character.ui?.vitalsOrder;
    const i = Array.isArray(currentOrder) ? currentOrder.indexOf(key) : -1;
    const j = i + dir;
    if (i === -1 || j < 0 || !Array.isArray(currentOrder) || j >= currentOrder.length) return;
    const adjacentKey = currentOrder[j];
    const tileEl = findTileByVitalKey(key);
    const adjacentEl = findTileByVitalKey(adjacentKey);

    const moved = mutateCharacter((character) => {
      const order = character.ui?.vitalsOrder;
      if (!Array.isArray(order)) return false;
      const i = order.indexOf(key);
      if (i === -1) return false;
      const j = i + dir;
      if (j < 0 || j >= order.length) return false;
      [order[i], order[j]] = [order[j], order[i]];
      return true;
    }, { queueSave: false });
    if (!moved) return;
    SaveManager.markDirty();

    const prevScroll = panel.scrollTop;
    const didSwap = flipSwapTwo(tileEl, adjacentEl, {
      durationMs: 260,
      easing: "cubic-bezier(.22,1,.36,1)",
      swap: () => {
        if (dir < 0) grid.insertBefore(tileEl, adjacentEl);
        else grid.insertBefore(adjacentEl, tileEl);
        panel.scrollTop = prevScroll;
      },
    });
    if (!didSwap) applyOrder();
  }

  function makeMoveBtn(label, title, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "moveBtn";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(e.currentTarget);
      requestAnimationFrame(() => {
        try { b.focus({ preventScroll: true }); } catch { b.focus?.(); }
      });
    });
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

    wrap.appendChild(makeMoveBtn("↑", "Move up", () => moveVital(key, -1)));
    wrap.appendChild(makeMoveBtn("↓", "Move down", () => moveVital(key, +1)));

    header.appendChild(wrap);
  }

  Array.from(grid.querySelectorAll(".charTile")).forEach(attachMoves);
  applyOrder();
}

export function initVitalsPanel(deps = {}) {
  const {
    state,
    SaveManager,
    bindNumber,
    autoSizeInput,
    enhanceNumberSteppers,
    uiConfirm,
    setStatus,
  } = deps;

  if (!state || !SaveManager || !bindNumber) return;
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

  function bindVitalsNumbers() {
    bindNumber("charHpCur", () => state.character.hpCur, (v) => updateCharacterField("hpCur", v, { queueSave: false }));
    bindNumber("charHpMax", () => state.character.hpMax, (v) => updateCharacterField("hpMax", v, { queueSave: false }));
    bindNumber("hitDieAmt", () => state.character.hitDieAmt, (v) => updateCharacterField("hitDieAmt", v, { queueSave: false }));
    bindNumber("hitDieSize", () => state.character.hitDieSize, (v) => updateCharacterField("hitDieSize", v, { queueSave: false }));
    bindNumber("charAC", () => state.character.ac, (v) => updateCharacterField("ac", v, { queueSave: false }));
    bindNumber("charInit", () => state.character.initiative, (v) => updateCharacterField("initiative", v, { queueSave: false }));
    bindNumber("charSpeed", () => state.character.speed, (v) => updateCharacterField("speed", v, { queueSave: false }));
    bindNumber("charProf", () => state.character.proficiency, (v) => updateCharacterField("proficiency", v, { queueSave: false }));
    bindNumber("charSpellAtk", () => state.character.spellAttack, (v) => updateCharacterField("spellAttack", v, { queueSave: false }));
    bindNumber("charSpellDC", () => state.character.spellDC, (v) => updateCharacterField("spellDC", v, { queueSave: false }));
  }

  function refreshVitalsNumbers() {
    const fields = [
      ["charHpCur", state.character.hpCur],
      ["charHpMax", state.character.hpMax],
      ["hitDieAmt", state.character.hitDieAmt],
      ["hitDieSize", state.character.hitDieSize],
      ["charAC", state.character.ac],
      ["charInit", state.character.initiative],
      ["charSpeed", state.character.speed],
      ["charProf", state.character.proficiency],
      ["charSpellAtk", state.character.spellAttack],
      ["charSpellDC", state.character.spellDC],
    ];

    fields.forEach(([id, value]) => {
      const el = guard.els[id];
      if (!el) return;
      el.value = (value === null || value === undefined) ? "" : String(value);
    });
  }

  function autoSizeVitals() {
    [
      "charHpCur",
      "charHpMax",
      "hitDieAmt",
      "hitDieSize",
      "charAC",
      "charInit",
      "charSpeed",
      "charProf",
      "charSpellAtk",
      "charSpellDC",
    ].forEach((id) => {
      const el = guard.els[id];
      if (!el) return;
      el.classList.add("autosize");
      autoSizeInput(el, { min: 30, max: 60 });
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

  function setAndSave() {
    SaveManager.markDirty();
  }

  function renderResources() {
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

      title.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          title.blur();
        }
      });

      title.addEventListener("input", () => {
        const updated = mutateCharacter((character) => {
          const resource = character.resources?.find((item) => item?.id === r.id);
          if (!resource) return false;
          resource.name = title.textContent ?? "";
          return true;
        }, { queueSave: false });
        if (!updated) return;
        setAndSave();
      });

      title.addEventListener("blur", () => {
        const t = (title.textContent ?? "").trim();
        if (!t) title.textContent = "";
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "iconBtn danger resourceDeleteBtn";
      del.title = "Remove this resource";
      del.textContent = "X";
      del.disabled = (state.character.resources.length <= 1);
      del.addEventListener(
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
          setAndSave();
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
      autoSizeInput(cur, { min: 30, max: 60 });
      cur.addEventListener("input", () => {
        const updated = mutateCharacter((character) => {
          const resource = character.resources?.find((item) => item?.id === r.id);
          if (!resource) return false;
          resource.cur = numberOrNull(cur.value);
          return true;
        }, { queueSave: false });
        if (!updated) return;
        setAndSave();
      });

      const slash = document.createElement("span");
      slash.className = "hpSlash";
      slash.textContent = "/";

      const max = document.createElement("input");
      max.type = "number";
      max.placeholder = "Max";
      max.classList.add("autosize");
      max.value = (r.max === null || r.max === undefined) ? "" : String(r.max);
      autoSizeInput(max, { min: 30, max: 60 });
      max.addEventListener("input", () => {
        const updated = mutateCharacter((character) => {
          const resource = character.resources?.find((item) => item?.id === r.id);
          if (!resource) return false;
          resource.max = numberOrNull(max.value);
          return true;
        }, { queueSave: false });
        if (!updated) return;
        setAndSave();
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

    enhanceNumberSteppers(wrap);
    setupVitalsTileReorder({
      state,
      SaveManager,
      panelEl,
      gridEl: wrap,
      actions: { updateCharacterField, mutateCharacter }
    });
  }

  if (panelEl.dataset.vitalsInit === "1") {
    refreshVitalsNumbers();
    autoSizeVitals();
    renderResources();
    return getNoopDestroyApi();
  }
  panelEl.dataset.vitalsInit = "1";

  bindVitalsNumbers();
  autoSizeVitals();

  addBtn.addEventListener("click", () => {
    ensureResourceArray();
    mutateCharacter((character) => {
      character.resources.push(newResource());
      return true;
    }, { queueSave: false });
    setAndSave();
    renderResources();
  });

  setupVitalsTileReorder({
    state,
    SaveManager,
    panelEl,
    gridEl: wrap,
    actions: { updateCharacterField, mutateCharacter }
  });
  renderResources();
}
