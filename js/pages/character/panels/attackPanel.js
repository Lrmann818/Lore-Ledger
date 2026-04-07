// js/pages/character/panels/attackPanel.js
// Attacks / Weapons panel (Character page)
//
// Production notes:
// - This module should ONLY own the Attacks panel UI.
// - It should not call other Character-page wiring helpers (reorder, abilities, etc).
// - It must be safe if init is called more than once and fully clean up on destroy.
import { safeAsync } from "../../../ui/safeAsync.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { flipSwapTwo } from "../../../ui/flipSwap.js";
import { requireMany } from "../../../utils/domGuards.js";

const ATTACK_FIELD_BY_CLASS = Object.freeze({
  attackName: "name",
  attackBonus: "bonus",
  attackDamage: "damage",
  attackRange: "range",
  attackType: "type",
});

export function initAttacksPanel(deps = {}) {
  const {
    state,
    SaveManager,
    uiConfirm,
    autoSizeInput,
    setStatus,
  } = deps;

  if (!state) throw new Error("initAttacksPanel requires state");
  if (!SaveManager) throw new Error("initAttacksPanel requires SaveManager");

  if (!state.character) state.character = {};
  if (!Array.isArray(state.character.attacks)) state.character.attacks = [];

  const { mutateCharacter } = createStateActions({ state, SaveManager });

  const required = {
    panelEl: "#charAttacksPanel",
    listEl: "#attackList",
    addBtn: "#addAttackBtn",
  };
  const guard = requireMany(required, { root: document, setStatus, context: "Weapons panel" });
  if (!guard.ok) return guard.destroy;
  const { panelEl, listEl, addBtn } = guard.els;

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

  function newAttackId() {
    return "atk_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getAttacks() {
    return Array.isArray(state.character?.attacks) ? state.character.attacks : [];
  }

  function createMoveButton(direction, disabled) {
    const isUp = direction < 0;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "moveBtn";
    btn.textContent = isUp ? "\u2191" : "\u2193";
    btn.title = isUp ? "Move weapon up" : "Move weapon down";
    btn.setAttribute("aria-label", isUp ? "Move weapon up" : "Move weapon down");
    btn.dataset.moveDirection = String(direction);
    btn.disabled = !!disabled;
    return btn;
  }

  function renderAttacks() {
    if (destroyed) return;

    listEl.replaceChildren();

    const attacks = getAttacks();
    if (!attacks.length) {
      const empty = document.createElement("div");
      empty.className = "mutedSmall";
      empty.textContent = "No weapons yet. Click “+ Weapon”.";
      listEl.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (let i = 0; i < attacks.length; i++) frag.appendChild(renderAttackRow(attacks[i], i, attacks.length));
    listEl.appendChild(frag);
  }

  function syncMoveButtonsState() {
    const rows = Array.from(listEl.querySelectorAll(".attackRow"));
    const last = rows.length - 1;
    rows.forEach((row, idx) => {
      const up = row.querySelector('.attackHeaderActions .moveBtn[aria-label="Move weapon up"]');
      const down = row.querySelector('.attackHeaderActions .moveBtn[aria-label="Move weapon down"]');
      if (up) up.disabled = idx === 0;
      if (down) down.disabled = idx === last;
    });
  }

  function focusMoveButtonForAttack(id, dir) {
    const row = listEl.querySelector(`.attackRow[data-attack-id="${id}"]`);
    if (!row) return;
    const selector = dir < 0
      ? '.attackHeaderActions .moveBtn[aria-label="Move weapon up"]'
      : '.attackHeaderActions .moveBtn[aria-label="Move weapon down"]';
    const target = row.querySelector(selector);
    requestAnimationFrame(() => {
      try { target?.focus?.({ preventScroll: true }); } catch { target?.focus?.(); }
    });
  }

  function renderAttackRow(attack, index, total) {
    const row = document.createElement("div");
    row.className = "attackRow";
    row.dataset.attackId = attack.id;

    const top = document.createElement("div");
    top.className = "attackTop";

    const name = document.createElement("input");
    name.className = "attackName";
    name.placeholder = "Dagger";
    name.value = attack.name || "";
    autoSizeInput?.(name, { min: 50, max: 200 });
    top.appendChild(name);

    const headerActions = document.createElement("div");
    headerActions.className = "attackHeaderActions";

    const moveUp = createMoveButton(-1, index === 0);
    const moveDown = createMoveButton(+1, index >= total - 1);

    headerActions.appendChild(moveUp);
    headerActions.appendChild(moveDown);
    top.appendChild(headerActions);

    const middle = document.createElement("div");
    middle.className = "attackMiddle";

    const bonus = document.createElement("input");
    bonus.className = "attackBonus";
    bonus.placeholder = "+5";
    bonus.value = attack.bonus || "";
    autoSizeInput?.(bonus, { min: 30, max: 60 });

    const dmg = document.createElement("input");
    dmg.className = "attackDamage";
    dmg.placeholder = "1d6+2";
    dmg.value = attack.damage || "";
    autoSizeInput?.(dmg, { min: 40, max: 160 });

    middle.appendChild(bonus);
    middle.appendChild(dmg);

    const bottom = document.createElement("div");
    bottom.className = "attackBottom";

    const range = document.createElement("input");
    range.className = "attackRange";
    range.placeholder = "80/320";
    range.value = attack.range || "";
    autoSizeInput?.(range, { min: 50, max: 150 });

    const type = document.createElement("input");
    type.className = "attackType";
    type.placeholder = "Piercing";
    type.value = attack.type || "";
    autoSizeInput?.(type, { min: 40, max: 150 });

    const actions = document.createElement("div");
    actions.className = "attackActions";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "attackDeleteBtn danger";
    del.textContent = "X";
    del.title = "Delete weapon";
    del.setAttribute("aria-label", "Delete weapon");

    actions.appendChild(del);

    bottom.appendChild(range);
    bottom.appendChild(type);
    bottom.appendChild(actions);

    row.appendChild(top);
    row.appendChild(middle);
    row.appendChild(bottom);

    return row;
  }

  function patchAttack(id, patch) {
    if (destroyed) return false;
    return mutateCharacter((character) => {
      if (!Array.isArray(character.attacks)) return false;
      const idx = character.attacks.findIndex((item) => item.id === id);
      if (idx === -1) return false;
      character.attacks[idx] = { ...character.attacks[idx], ...patch };
      return true;
    });
  }

  async function deleteAttack(id) {
    if (destroyed) return;

    if (uiConfirm) {
      const ok = await uiConfirm("Delete this weapon?", { title: "Delete Weapon", okText: "Delete" });
      if (destroyed || !ok) return;
    }

    mutateCharacter((character) => {
      if (!Array.isArray(character.attacks)) character.attacks = [];
      character.attacks = character.attacks.filter((item) => item.id !== id);
      return true;
    });
    if (destroyed) return;
    renderAttacks();
  }

  function addAttack() {
    if (destroyed) return;

    mutateCharacter((character) => {
      if (!Array.isArray(character.attacks)) character.attacks = [];
      character.attacks.unshift({
        id: newAttackId(),
        name: "",
        notes: "",
        bonus: "",
        damage: "",
        range: "",
        type: "",
      });
      return true;
    });
    renderAttacks();
  }

  function moveAttack(id, dir, btn) {
    if (destroyed) return;

    const list = getAttacks();
    const i = list.findIndex((item) => item?.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;

    const attackEl = listEl.querySelector(`.attackRow[data-attack-id="${id}"]`);
    const adjacentId = list[j]?.id;
    const adjacentEl = adjacentId
      ? listEl.querySelector(`.attackRow[data-attack-id="${adjacentId}"]`)
      : null;

    const didMove = mutateCharacter((character) => {
      if (!Array.isArray(character.attacks)) return false;
      const from = character.attacks.findIndex((item) => item?.id === id);
      const to = from + dir;
      if (from < 0 || to < 0 || to >= character.attacks.length) return false;
      [character.attacks[from], character.attacks[to]] = [character.attacks[to], character.attacks[from]];
      return true;
    }, { queueSave: false });
    if (!didMove) return;
    SaveManager.markDirty();

    const prevListScroll = listEl.scrollTop;
    const prevPanelScroll = panelEl.scrollTop;
    const didSwap = flipSwapTwo(attackEl, adjacentEl, {
      durationMs: 260,
      easing: "cubic-bezier(.22,1,.36,1)",
      swap: () => {
        if (dir < 0) listEl.insertBefore(attackEl, adjacentEl);
        else listEl.insertBefore(adjacentEl, attackEl);
        listEl.scrollTop = prevListScroll;
        panelEl.scrollTop = prevPanelScroll;
      },
    });
    if (didSwap) {
      syncMoveButtonsState();
      requestAnimationFrame(() => {
        try { btn?.focus?.({ preventScroll: true }); } catch { btn?.focus?.(); }
      });
      return;
    }

    renderAttacks();
    focusMoveButtonForAttack(id, dir);
  }

  addListener(addBtn, "click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    addAttack();
  });

  addListener(listEl, "input", (event) => {
    if (destroyed) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const row = target.closest(".attackRow");
    if (!(row instanceof HTMLElement)) return;
    const attackId = row.dataset.attackId;
    if (!attackId) return;

    const fieldClass = Object.keys(ATTACK_FIELD_BY_CLASS).find((className) => target.classList.contains(className));
    if (!fieldClass) return;

    patchAttack(attackId, { [ATTACK_FIELD_BY_CLASS[fieldClass]]: target.value });
  });

  addListener(
    listEl,
    "click",
    safeAsync(async (event) => {
      if (destroyed) return;

      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const row = target.closest(".attackRow");
      if (!(row instanceof HTMLElement)) return;
      const attackId = row.dataset.attackId;
      if (!attackId) return;

      const moveBtn = target.closest(".moveBtn");
      if (moveBtn instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();
        const dir = Number(moveBtn.dataset.moveDirection);
        if (dir === -1 || dir === 1) moveAttack(attackId, dir, moveBtn);
        return;
      }

      const deleteBtn = target.closest(".attackDeleteBtn");
      if (!(deleteBtn instanceof HTMLButtonElement)) return;

      event.preventDefault();
      event.stopPropagation();
      await deleteAttack(attackId);
    }, (err) => {
      console.error(err);
      if (typeof setStatus === "function") setStatus("Delete weapon failed.");
      else console.warn("Delete weapon failed.");
    })
  );

  renderAttacks();

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
