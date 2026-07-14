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
import { getActiveCharacter, isBuilderCharacter } from "../../../domain/characterHelpers.js";
import { getAttackRecalculationProposal } from "../../../domain/attackRecalculation.js";
import { getActiveContentRegistry, listContentByKind } from "../../../domain/rules/registry.js";
import { notifyPanelDataChanged, subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";

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
    root = document,
    selectors = {},
    uiConfirm,
    autoSizeInput,
    setStatus,
  } = deps;

  if (!state) throw new Error("initAttacksPanel requires state");
  if (!SaveManager) throw new Error("initAttacksPanel requires SaveManager");

  const { mutateCharacter } = createStateActions({ state, SaveManager });
  if (!getActiveCharacter(state)) return null;
  mutateCharacter((character) => {
    if (!Array.isArray(character.attacks)) character.attacks = [];
    return true;
  }, { queueSave: false });

  const required = {
    panelEl: "#charAttacksPanel",
    listEl: "#attackList",
    addBtn: "#addAttackBtn",
    ...selectors
  };
  const guard = requireMany(required, { root, setStatus, context: "Weapons panel" });
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
  const panelInstance = {};

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
    const currentCharacter = getActiveCharacter(state);
    return Array.isArray(currentCharacter?.attacks) ? currentCharacter.attacks : [];
  }

  function markAttacksChanged() {
    notifyPanelDataChanged("weapons", { source: panelInstance });
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

    // Explicit, user-requested only: recalculation never runs automatically
    // (see docs/audits/builder-completion-matrix.md #9). Freeform characters
    // have no build to recalculate from, so they get no button.
    if (isBuilderCharacter(getActiveCharacter(state))) {
      const recalc = document.createElement("button");
      recalc.type = "button";
      recalc.className = "attackRecalcBtn";
      recalc.textContent = "Recalc";
      recalc.title = "Recalculate from Build";
      recalc.setAttribute("aria-label", "Recalculate from Build");
      actions.appendChild(recalc);
    }

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
    const updated = mutateCharacter((character) => {
      if (!Array.isArray(character.attacks)) return false;
      const idx = character.attacks.findIndex((item) => item.id === id);
      if (idx === -1) return false;
      const current = character.attacks[idx];
      const nextEntries = Object.entries(patch);
      const changed = nextEntries.some(([key, value]) => current?.[key] !== value);
      if (!changed) return false;
      character.attacks[idx] = { ...character.attacks[idx], ...patch };
      return true;
    });
    if (updated) markAttacksChanged();
    return updated;
  }

  async function deleteAttack(id) {
    if (destroyed) return;

    if (uiConfirm) {
      const ok = await uiConfirm("Delete this weapon?", { title: "Delete Weapon", okText: "Delete" });
      if (destroyed || !ok) return;
    }

    const removed = mutateCharacter((character) => {
      if (!Array.isArray(character.attacks)) character.attacks = [];
      const before = character.attacks.length;
      character.attacks = character.attacks.filter((item) => item.id !== id);
      return character.attacks.length !== before;
    });
    if (!removed || destroyed) return;
    markAttacksChanged();
    renderAttacks();
  }

  // --- Recalculate from Build ---------------------------------------------
  // Preview-first dialog (the Vitals resource-settings precedent): the
  // domain proposal is rendered field by field, the user can uncheck any
  // proposed change, Cancel/Escape never mutates, and Apply patches the one
  // attack atomically. Unlinked attacks get an explicit weapon picker —
  // display names are never used to guess a source.

  let recalcOverlay = null;
  /** current dialog session: { attackId, proposal, weaponId } */
  let recalcSession = null;

  function ensureRecalcDialog() {
    if (recalcOverlay) return recalcOverlay;

    const overlay = document.createElement("div");
    overlay.className = "modalOverlay attackRecalcOverlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");

    const panel = document.createElement("div");
    panel.className = "modalPanel attackRecalcPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "attackRecalcDialogTitle");
    panel.setAttribute("tabindex", "-1");

    const header = document.createElement("div");
    header.className = "uiDialogHeader";
    const title = document.createElement("div");
    title.className = "modalTitle";
    title.id = "attackRecalcDialogTitle";
    title.textContent = "Recalculate from Build";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "npcSmallBtn";
    close.dataset.recalcCancel = "true";
    close.setAttribute("aria-label", "Close Recalculate from Build");
    close.textContent = "✕";
    header.appendChild(title);
    header.appendChild(close);

    const body = document.createElement("div");
    body.className = "uiDialogBody attackRecalcBody";

    const footer = document.createElement("div");
    footer.className = "uiDialogFooter attackRecalcFooter";

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    addListener(overlay, "click", (event) => {
      const target = event.target;
      if (target === overlay) { closeRecalcDialog(); return; }
      if (target instanceof HTMLElement && target.closest("[data-recalc-cancel]")) {
        closeRecalcDialog();
      }
    });

    // Capture-phase so an open dialog owns Escape/Tab before page handlers.
    addListener(document, "keydown", (event) => {
      if (overlay.hidden || destroyed) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRecalcDialog();
        return;
      }
      if (event.key === "Tab") {
        const focusables = /** @type {HTMLElement[]} */ (Array.from(panel.querySelectorAll(
          "button:not([disabled]), input:not([disabled]), select:not([disabled])"
        ))).filter((node) => !node.closest("[hidden]"));
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey) {
          if (document.activeElement === first || document.activeElement === panel) {
            event.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }, { capture: true });

    recalcOverlay = overlay;
    return overlay;
  }

  function closeRecalcDialog() {
    if (!recalcOverlay || recalcOverlay.hidden) return;
    const openerAttackId = recalcSession?.attackId || "";
    recalcSession = null;
    recalcOverlay.hidden = true;
    recalcOverlay.setAttribute("aria-hidden", "true");
    const opener = listEl.querySelector(
      `.attackRow[data-attack-id="${openerAttackId}"] .attackRecalcBtn`
    );
    requestAnimationFrame(() => {
      if (destroyed) return;
      try { opener?.focus?.({ preventScroll: true }); } catch { opener?.focus?.(); }
    });
  }

  function currentAttack(attackId) {
    return getAttacks().find((item) => item?.id === attackId) || null;
  }

  function footerButton(label, { primary = false } = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "npcSmallBtn";
    btn.textContent = label;
    if (!primary) btn.dataset.recalcCancel = "true";
    return btn;
  }

  function renderRecalcDialog() {
    const overlay = ensureRecalcDialog();
    const body = overlay.querySelector(".attackRecalcBody");
    const footer = overlay.querySelector(".attackRecalcFooter");
    if (!body || !footer || !recalcSession) return;
    body.replaceChildren();
    footer.replaceChildren();

    const { proposal } = recalcSession;
    const addText = (text, className = "") => {
      const el = document.createElement("div");
      if (className) el.className = className;
      el.textContent = text;
      body.appendChild(el);
      return el;
    };

    if (proposal.status === "unavailable") {
      addText(proposal.reason);
      footer.appendChild(footerButton("Close"));
      return;
    }

    if (proposal.status === "unlinked") {
      addText(proposal.reason);
      const pickerLabel = document.createElement("label");
      pickerLabel.className = "attackRecalcPickerLabel";
      const labelText = document.createElement("span");
      labelText.className = "modalLabel";
      labelText.textContent = "Weapon";
      const select = document.createElement("select");
      select.className = "settingsSelect attackRecalcWeaponSelect";
      select.setAttribute("aria-label", "Weapon to link this entry to");
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose a weapon";
      select.appendChild(placeholder);
      const weapons = listContentByKind(getActiveContentRegistry(), "weapon")
        .map((entry) => ({
          value: entry.id,
          label: entry.source === "custom" ? `${entry.name} (custom)` : entry.name
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      for (const weapon of weapons) {
        const option = document.createElement("option");
        option.value = weapon.value;
        option.textContent = weapon.label;
        select.appendChild(option);
      }
      pickerLabel.appendChild(labelText);
      pickerLabel.appendChild(select);
      body.appendChild(pickerLabel);

      const previewBtn = footerButton("Preview Changes", { primary: true });
      previewBtn.disabled = true;
      addListener(select, "change", () => { previewBtn.disabled = !select.value; });
      addListener(previewBtn, "click", () => {
        if (!select.value || !recalcSession) return;
        const attack = currentAttack(recalcSession.attackId);
        const character = getActiveCharacter(state);
        if (!attack || !character) { closeRecalcDialog(); return; }
        recalcSession.weaponId = select.value;
        recalcSession.proposal = getAttackRecalculationProposal(
          attack, character, getActiveContentRegistry(), { weaponId: select.value }
        );
        renderRecalcDialog();
      });
      footer.appendChild(footerButton("Cancel"));
      footer.appendChild(previewBtn);
      requestAnimationFrame(() => { try { select.focus({ preventScroll: true }); } catch { select.focus(); } });
      return;
    }

    if (proposal.status === "no-change") {
      addText(`Checked against ${proposal.weaponName}: ${proposal.reason}`);
      footer.appendChild(footerButton("Close"));
      return;
    }

    // status === "ready"
    addText(`Proposed from ${proposal.weaponName} and your current build. Uncheck anything you want to keep as-is — your name and notes are never changed.`, "mutedSmall attackRecalcIntro");
    if (proposal.patch && proposal.patch.builderSeed) {
      addText(`Applying will also link this entry to ${proposal.weaponName} for future recalculations.`, "mutedSmall");
    }

    const rows = document.createElement("div");
    rows.className = "attackRecalcRows";
    for (const field of proposal.fields) {
      const row = document.createElement("div");
      row.className = "attackRecalcRow";
      row.dataset.field = field.key;
      if (field.changed) {
        const applyLabel = document.createElement("label");
        applyLabel.className = "attackRecalcApply";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.dataset.recalcField = field.key;
        checkbox.setAttribute("aria-label", `Apply new ${field.label.toLowerCase()}`);
        const labelSpan = document.createElement("span");
        labelSpan.textContent = field.label;
        applyLabel.appendChild(checkbox);
        applyLabel.appendChild(labelSpan);
        row.appendChild(applyLabel);
        const values = document.createElement("span");
        values.className = "attackRecalcValues";
        values.textContent = `${field.current || "(empty)"} changes to ${field.proposed || "(empty)"}`;
        row.appendChild(values);
      } else {
        const labelSpan = document.createElement("span");
        labelSpan.className = "attackRecalcLabel";
        labelSpan.textContent = field.label;
        row.appendChild(labelSpan);
        const values = document.createElement("span");
        values.className = "attackRecalcValues mutedSmall";
        values.textContent = `unchanged (${field.current || "(empty)"})`;
        row.appendChild(values);
      }
      rows.appendChild(row);
    }
    body.appendChild(rows);

    const applyBtn = footerButton("Apply Changes", { primary: true });
    const syncApplyEnabled = () => {
      const anyChecked = !!body.querySelector("[data-recalc-field]:checked");
      const linkOnly = !!(proposal.patch && proposal.patch.builderSeed);
      applyBtn.disabled = !anyChecked && !linkOnly;
    };
    addListener(body, "change", syncApplyEnabled);
    syncApplyEnabled();
    addListener(applyBtn, "click", () => applyRecalcDialog());
    footer.appendChild(footerButton("Cancel"));
    footer.appendChild(applyBtn);
    requestAnimationFrame(() => {
      const first = body.querySelector("[data-recalc-field]") || applyBtn;
      try { first?.focus?.({ preventScroll: true }); } catch { first?.focus?.(); }
    });
  }

  function applyRecalcDialog() {
    if (!recalcSession || destroyed) return;
    const { attackId, proposal } = recalcSession;
    if (proposal.status !== "ready" || !proposal.patch) { closeRecalcDialog(); return; }
    const body = recalcOverlay?.querySelector(".attackRecalcBody");
    /** accepted subset of the proposed patch — applied in one mutation */
    const patch = {};
    for (const [key, value] of Object.entries(proposal.patch)) {
      if (key === "builderSeed") { patch.builderSeed = value; continue; }
      const checkbox = body?.querySelector(`[data-recalc-field="${key}"]`);
      if (!checkbox || checkbox.checked) patch[key] = value;
    }
    if (!Object.keys(patch).length) { closeRecalcDialog(); return; }
    const updated = patchAttack(attackId, patch);
    closeRecalcDialog();
    if (updated) {
      renderAttacks();
      if (typeof setStatus === "function") setStatus("Weapon recalculated from build.");
    }
  }

  function openRecalcDialog(attackId) {
    if (destroyed) return;
    const attack = currentAttack(attackId);
    const character = getActiveCharacter(state);
    if (!attack || !character) return;
    const overlay = ensureRecalcDialog();
    recalcSession = {
      attackId,
      weaponId: "",
      proposal: getAttackRecalculationProposal(attack, character, getActiveContentRegistry())
    };
    renderRecalcDialog();
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    const panel = overlay.querySelector(".attackRecalcPanel");
    try { panel?.focus?.({ preventScroll: true }); } catch { panel?.focus?.(); }
  }

  function addAttack() {
    if (destroyed) return;

    const added = mutateCharacter((character) => {
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
    if (!added) return;
    markAttacksChanged();
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
    markAttacksChanged();

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

      const recalcBtn = target.closest(".attackRecalcBtn");
      if (recalcBtn instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();
        openRecalcDialog(attackId);
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

  addDestroy(subscribePanelDataChanged("weapons", (detail) => {
    if (destroyed || detail.source === panelInstance) return;
    renderAttacks();
  }));

  addDestroy(() => {
    recalcSession = null;
    recalcOverlay?.remove?.();
    recalcOverlay = null;
  });

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
