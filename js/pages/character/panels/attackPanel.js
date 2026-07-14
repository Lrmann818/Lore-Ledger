// js/pages/character/panels/attackPanel.js
// Attacks / Weapons panel (Character page + combat embedded host)
//
// Production notes:
// - This module owns ONLY the Attacks panel UI.
// - It must be safe if init is called more than once and fully clean up on destroy.
//
// Structured attacks (rows carrying a `calc` block — see
// js/domain/attackCalculation.js) derive their bonus/damage/range/type live
// from the character through the one canonical calculator, for both builder
// and freeform characters. Those fields render read-only and update
// automatically when abilities or proficiency change — no recalculate action.
// The per-row Edit dialog owns the structured inputs, explicit adjustments,
// intentional fixed mode, and legacy-row conversion. Legacy rows (no `calc`)
// keep their editable text fields so the simple "just type it" path still
// works. `name`, `notes`, `id`, and row order stay user-owned everywhere.
import { safeAsync } from "../../../ui/safeAsync.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { flipSwapTwo } from "../../../ui/flipSwap.js";
import { requireMany } from "../../../utils/domGuards.js";
import { getActiveCharacter } from "../../../domain/characterHelpers.js";
import {
  ATTACK_CALC_MODES,
  buildWeaponAttackCalc,
  getAttackDisplayModel,
  getAttackSourceWeaponId,
  isWeaponProficient,
  normalizeAttackCalc
} from "../../../domain/attackCalculation.js";
import { deriveCharacter } from "../../../domain/rules/deriveCharacter.js";
import { getActiveContentRegistry, getContentByKind, listContentByKind } from "../../../domain/rules/registry.js";
import { notifyPanelDataChanged, subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";

const ATTACK_FIELD_BY_CLASS = Object.freeze({
  attackName: "name",
  attackBonus: "bonus",
  attackDamage: "damage",
  attackRange: "range",
  attackType: "type",
});

const ABILITY_KEYS = /** @type {const} */ (["str", "dex", "con", "int", "wis", "cha"]);
const ABILITY_LABEL = Object.freeze({
  str: "Strength", dex: "Dexterity", con: "Constitution",
  int: "Intelligence", wis: "Wisdom", cha: "Charisma"
});

const CALC_MODE_LABEL = Object.freeze({
  weapon: "Calculated — from a weapon",
  ability: "Calculated — from an ability",
  spell: "Calculated — spell attack",
  fixed: "Fixed value (no calculation)"
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

  function currentAttack(attackId) {
    return getAttacks().find((item) => item?.id === attackId) || null;
  }

  /**
   * Derived character for this render pass. Live-derived structured attacks
   * read their display values from here, so ability/proficiency changes flow
   * automatically. Null-safe: derivation failure falls back to stored strings.
   * @returns {ReturnType<typeof deriveCharacter> | null}
   */
  function deriveActive() {
    const character = getActiveCharacter(state);
    if (!character) return null;
    try {
      return deriveCharacter(character, getActiveContentRegistry());
    } catch (err) {
      console.warn("Attacks panel derivation failed:", err);
      return null;
    }
  }

  function markAttacksChanged() {
    notifyPanelDataChanged("weapons", { source: panelInstance });
  }

  function createMoveButton(direction, disabled) {
    const isUp = direction < 0;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "moveBtn";
    btn.textContent = isUp ? "↑" : "↓";
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

    const derived = deriveActive();
    const registry = getActiveContentRegistry();
    const frag = document.createDocumentFragment();
    for (let i = 0; i < attacks.length; i++) {
      frag.appendChild(renderAttackRow(attacks[i], i, attacks.length, derived, registry));
    }
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

  /**
   * @param {string} labelText
   * @param {string} value
   * @param {string} valueClass
   * @returns {HTMLElement}
   */
  function readonlyValueBlock(labelText, value, valueClass) {
    const wrap = document.createElement("div");
    wrap.className = "attackDerivedField";
    const label = document.createElement("span");
    label.className = "attackDerivedLabel";
    label.textContent = labelText;
    const val = document.createElement("span");
    val.className = `attackDerivedValue ${valueClass}`;
    val.textContent = value || "—";
    wrap.appendChild(label);
    wrap.appendChild(val);
    return wrap;
  }

  function renderAttackRow(attack, index, total, derived, registry) {
    const model = derived
      ? getAttackDisplayModel(attack, derived, registry)
      : { mode: normalizeAttackCalc(attack?.calc)?.mode || "legacy", derived: false,
          bonus: attack?.bonus || "", damage: attack?.damage || "",
          range: attack?.range || "", type: attack?.type || "", warnings: [] };
    const isDerived = model.derived === true;

    const row = document.createElement("div");
    row.className = "attackRow";
    if (isDerived) row.classList.add("attackRowDerived");
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
    headerActions.appendChild(createMoveButton(-1, index === 0));
    headerActions.appendChild(createMoveButton(+1, index >= total - 1));
    top.appendChild(headerActions);

    row.appendChild(top);

    if (isDerived) {
      // Structured, live-derived: read-only values + an editor entry point.
      const middle = document.createElement("div");
      middle.className = "attackMiddle attackDerivedRow";
      middle.appendChild(readonlyValueBlock("Attack", model.bonus, "attackBonusValue"));
      middle.appendChild(readonlyValueBlock("Damage", model.damage, "attackDamageValue"));
      row.appendChild(middle);

      const bottom = document.createElement("div");
      bottom.className = "attackBottom attackDerivedRow";
      bottom.appendChild(readonlyValueBlock("Range", model.range, "attackRangeValue"));
      bottom.appendChild(readonlyValueBlock("Type", model.type, "attackTypeValue"));

      const actions = document.createElement("div");
      actions.className = "attackActions";
      actions.appendChild(makeEditButton());
      actions.appendChild(makeDeleteButton());
      bottom.appendChild(actions);
      row.appendChild(bottom);

      const meta = document.createElement("div");
      meta.className = "attackMetaRow";
      const badge = document.createElement("span");
      badge.className = "attackDerivedBadge";
      badge.textContent = calcModeShortLabel(model.mode);
      meta.appendChild(badge);
      for (const warning of model.warnings || []) {
        const warn = document.createElement("span");
        warn.className = "attackWarning";
        warn.textContent = warning;
        meta.appendChild(warn);
      }
      row.appendChild(meta);
    } else {
      // Legacy snapshot or fixed override: editable text fields.
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
      row.appendChild(middle);

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
      actions.appendChild(makeEditButton());
      actions.appendChild(makeDeleteButton());

      bottom.appendChild(range);
      bottom.appendChild(type);
      bottom.appendChild(actions);
      row.appendChild(bottom);

      if (model.mode === "fixed") {
        const meta = document.createElement("div");
        meta.className = "attackMetaRow";
        const badge = document.createElement("span");
        badge.className = "attackDerivedBadge attackFixedBadge";
        badge.textContent = "Fixed value";
        meta.appendChild(badge);
        row.appendChild(meta);
      }
    }

    return row;
  }

  function makeEditButton() {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "attackEditBtn";
    edit.textContent = "Edit";
    edit.title = "Edit weapon calculation";
    edit.setAttribute("aria-label", "Edit weapon calculation");
    return edit;
  }

  function makeDeleteButton() {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "attackDeleteBtn danger";
    del.textContent = "X";
    del.title = "Delete weapon";
    del.setAttribute("aria-label", "Delete weapon");
    return del;
  }

  function calcModeShortLabel(mode) {
    if (mode === "weapon") return "Auto (weapon)";
    if (mode === "ability") return "Auto (ability)";
    if (mode === "spell") return "Auto (spell)";
    return "Calculated";
  }

  function patchAttack(id, patch) {
    if (destroyed) return false;
    const updated = mutateCharacter((character) => {
      if (!Array.isArray(character.attacks)) return false;
      const idx = character.attacks.findIndex((item) => item.id === id);
      if (idx === -1) return false;
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

  // --- Structured attack editor -------------------------------------------
  // Preview-first dialog (the Vitals resource-settings / recalc precedent).
  // Reads the attack's calc block into a draft, previews the derived result
  // live, and applies one atomic patch on confirm. Cancel/Escape never mutate.
  // Weapon linking is explicit — display names are never used to guess a
  // source. Retiring this replaces the old broken "Recalculate from Build".

  let editorOverlay = null;
  /** @type {{ attackId: string, calc: import("../../../domain/attackCalculation.js").AttackCalc, fixed: { bonus: string, damage: string, range: string, type: string } } | null} */
  let editorSession = null;

  function ensureEditorDialog() {
    if (editorOverlay) return editorOverlay;

    const overlay = document.createElement("div");
    overlay.className = "modalOverlay attackEditorOverlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");

    const panel = document.createElement("div");
    panel.className = "modalPanel attackEditorPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "attackEditorDialogTitle");
    panel.setAttribute("tabindex", "-1");

    const header = document.createElement("div");
    header.className = "uiDialogHeader";
    const title = document.createElement("div");
    title.className = "modalTitle";
    title.id = "attackEditorDialogTitle";
    title.textContent = "Weapon Calculation";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "npcSmallBtn";
    close.dataset.attackEditorCancel = "true";
    close.setAttribute("aria-label", "Close weapon calculation editor");
    close.textContent = "✕";
    header.appendChild(title);
    header.appendChild(close);

    const body = document.createElement("div");
    body.className = "uiDialogBody attackEditorBody";

    const footer = document.createElement("div");
    footer.className = "uiDialogFooter attackEditorFooter";

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    addListener(overlay, "click", (event) => {
      const target = event.target;
      if (target === overlay) { closeEditorDialog(); return; }
      if (target instanceof HTMLElement && target.closest("[data-attack-editor-cancel]")) {
        closeEditorDialog();
      }
    });

    addListener(document, "keydown", (event) => {
      if (overlay.hidden || destroyed) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeEditorDialog();
        return;
      }
      if (event.key === "Tab") {
        const focusables = /** @type {HTMLElement[]} */ (Array.from(panel.querySelectorAll(
          "button:not([disabled]), input:not([disabled]), select:not([disabled])"
        ))).filter((node) => !node.closest("[hidden]") && node.offsetParent !== null);
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

    editorOverlay = overlay;
    return overlay;
  }

  function closeEditorDialog() {
    if (!editorOverlay || editorOverlay.hidden) return;
    const openerAttackId = editorSession?.attackId || "";
    editorSession = null;
    editorOverlay.hidden = true;
    editorOverlay.setAttribute("aria-hidden", "true");
    const opener = listEl.querySelector(
      `.attackRow[data-attack-id="${openerAttackId}"] .attackEditBtn`
    );
    requestAnimationFrame(() => {
      if (destroyed) return;
      try { opener?.focus?.({ preventScroll: true }); } catch { opener?.focus?.(); }
    });
  }

  /**
   * @param {HTMLElement} parent
   * @param {string} labelText
   * @returns {{ field: HTMLElement, control: HTMLElement }}
   */
  function editorField(parent, labelText) {
    const field = document.createElement("label");
    field.className = "attackEditorField";
    const span = document.createElement("span");
    span.className = "modalLabel";
    span.textContent = labelText;
    field.appendChild(span);
    parent.appendChild(field);
    return { field, control: field };
  }

  function makeSelect(options, value) {
    const select = document.createElement("select");
    select.className = "settingsSelect";
    for (const opt of options) {
      const el = document.createElement("option");
      el.value = opt.value;
      el.textContent = opt.label;
      if (opt.value === value) el.selected = true;
      select.appendChild(el);
    }
    return select;
  }

  function abilityOptions(autoLabel) {
    return [
      { value: "", label: autoLabel },
      ...ABILITY_KEYS.map((key) => ({ value: key, label: ABILITY_LABEL[key] }))
    ];
  }

  function renderEditorDialog() {
    const overlay = ensureEditorDialog();
    const body = overlay.querySelector(".attackEditorBody");
    const footer = overlay.querySelector(".attackEditorFooter");
    if (!body || !footer || !editorSession) return;
    body.replaceChildren();
    footer.replaceChildren();

    const { calc, fixed } = editorSession;
    const registry = getActiveContentRegistry();

    // Mode selector.
    const modeField = editorField(body, "Calculation");
    const modeSelect = makeSelect(
      ATTACK_CALC_MODES.map((mode) => ({ value: mode, label: CALC_MODE_LABEL[mode] })),
      calc.mode
    );
    modeSelect.setAttribute("aria-label", "How this weapon is calculated");
    modeField.control.appendChild(modeSelect);
    addListener(modeSelect, "change", () => {
      editorSession.calc.mode = /** @type {any} */ (modeSelect.value);
      // When switching into weapon mode with no weapon yet, default proficient
      // from the character's proficiencies once a weapon is chosen.
      renderEditorDialog();
    });

    if (calc.mode !== "fixed") {
      renderCalculatedFields(body, calc, registry);
    } else {
      renderFixedFields(body, fixed);
    }

    // Live preview.
    const preview = document.createElement("div");
    preview.className = "attackEditorPreview";
    const previewLabel = document.createElement("div");
    previewLabel.className = "mutedSmall";
    previewLabel.textContent = "Preview";
    preview.appendChild(previewLabel);
    const previewLine = document.createElement("div");
    previewLine.className = "attackEditorPreviewLine";
    preview.appendChild(previewLine);
    body.appendChild(preview);
    refreshEditorPreview(previewLine);

    // Footer.
    const cancel = footerButton("Cancel");
    const apply = footerButton("Apply", { primary: true });
    addListener(apply, "click", () => applyEditorDialog());
    footer.appendChild(cancel);
    footer.appendChild(apply);

    requestAnimationFrame(() => {
      try { modeSelect.focus({ preventScroll: true }); } catch { modeSelect.focus(); }
    });
  }

  function renderCalculatedFields(body, calc, registry) {
    if (calc.mode === "weapon") {
      const weaponField = editorField(body, "Weapon");
      const weapons = listContentByKind(registry, "weapon")
        .map((entry) => ({ value: entry.id, label: entry.source === "custom" ? `${entry.name} (custom)` : entry.name }))
        .sort((a, b) => a.label.localeCompare(b.label));
      const select = makeSelect([{ value: "", label: "Choose a weapon" }, ...weapons], calc.weaponId);
      select.setAttribute("aria-label", "Weapon this attack uses");
      weaponField.control.appendChild(select);
      addListener(select, "change", () => {
        editorSession.calc.weaponId = select.value;
        // Default proficiency from the character when a weapon is picked.
        const derived = deriveActive();
        const weapon = select.value ? getContentByKind(registry, "weapon", select.value) : null;
        if (derived && weapon) editorSession.calc.proficient = isWeaponProficient(derived, weapon);
        renderEditorDialog();
      });
    }

    const abilityField = editorField(body, calc.mode === "weapon" ? "Attack ability (override)" : "Attack ability");
    const autoLabel = calc.mode === "spell" ? "Spellcasting ability" : (calc.mode === "weapon" ? "Auto (weapon rule)" : "Choose ability");
    const abilitySelect = makeSelect(abilityOptions(autoLabel), calc.ability);
    abilitySelect.setAttribute("aria-label", "Ability used for the attack roll");
    abilityField.control.appendChild(abilitySelect);
    addListener(abilitySelect, "change", () => {
      editorSession.calc.ability = abilitySelect.value;
      refreshEditorPreviewFromDom();
    });

    // Proficiency.
    const profField = document.createElement("label");
    profField.className = "attackEditorCheckField";
    const profCheck = document.createElement("input");
    profCheck.type = "checkbox";
    profCheck.checked = calc.proficient;
    profCheck.setAttribute("aria-label", "Add proficiency bonus");
    const profText = document.createElement("span");
    profText.textContent = "Proficient (add proficiency bonus)";
    profField.appendChild(profCheck);
    profField.appendChild(profText);
    body.appendChild(profField);
    addListener(profCheck, "change", () => {
      editorSession.calc.proficient = profCheck.checked;
      refreshEditorPreviewFromDom();
    });

    // Base damage (ability/spell modes; weapon uses the weapon record).
    if (calc.mode !== "weapon") {
      const dmgField = editorField(body, "Base damage dice");
      const dmgInput = document.createElement("input");
      dmgInput.type = "text";
      dmgInput.className = "settingsInput attackEditorText";
      dmgInput.placeholder = "1d8";
      dmgInput.value = calc.baseDamage;
      dmgInput.setAttribute("aria-label", "Base damage dice");
      dmgField.control.appendChild(dmgInput);
      addListener(dmgInput, "input", () => {
        editorSession.calc.baseDamage = dmgInput.value.trim();
        refreshEditorPreviewFromDom();
      });
    }

    // Add ability to damage.
    const addDmgField = document.createElement("label");
    addDmgField.className = "attackEditorCheckField";
    const addDmgCheck = document.createElement("input");
    addDmgCheck.type = "checkbox";
    addDmgCheck.checked = calc.addAbilityToDamage;
    addDmgCheck.setAttribute("aria-label", "Add ability modifier to damage");
    const addDmgText = document.createElement("span");
    addDmgText.textContent = "Add ability modifier to damage";
    addDmgField.appendChild(addDmgCheck);
    addDmgField.appendChild(addDmgText);
    body.appendChild(addDmgField);
    addListener(addDmgCheck, "change", () => {
      editorSession.calc.addAbilityToDamage = addDmgCheck.checked;
      renderEditorDialog();
    });

    if (calc.addAbilityToDamage) {
      const dmgAbilityField = editorField(body, "Damage ability");
      const dmgAbilitySelect = makeSelect(abilityOptions("Same as attack"), calc.damageAbility);
      dmgAbilitySelect.setAttribute("aria-label", "Ability added to damage");
      dmgAbilityField.control.appendChild(dmgAbilitySelect);
      addListener(dmgAbilitySelect, "change", () => {
        editorSession.calc.damageAbility = dmgAbilitySelect.value;
        refreshEditorPreviewFromDom();
      });
    }

    if (calc.mode !== "weapon") {
      const typeField = editorField(body, "Damage type");
      const typeInput = document.createElement("input");
      typeInput.type = "text";
      typeInput.className = "settingsInput attackEditorText";
      typeInput.placeholder = "Fire";
      typeInput.value = calc.damageType;
      typeInput.setAttribute("aria-label", "Damage type");
      typeField.control.appendChild(typeInput);
      addListener(typeInput, "input", () => {
        editorSession.calc.damageType = typeInput.value.trim();
        refreshEditorPreviewFromDom();
      });

      const rangeField = editorField(body, "Range");
      const rangeInput = document.createElement("input");
      rangeInput.type = "text";
      rangeInput.className = "settingsInput attackEditorText";
      rangeInput.placeholder = "Melee, or 30/120 ft.";
      rangeInput.value = calc.range;
      rangeInput.setAttribute("aria-label", "Range");
      rangeField.control.appendChild(rangeInput);
      addListener(rangeInput, "input", () => {
        editorSession.calc.range = rangeInput.value.trim();
        refreshEditorPreviewFromDom();
      });
    }

    // Explicit adjustments (kept separate from the calculated base).
    const adjRow = document.createElement("div");
    adjRow.className = "attackEditorAdjustments";
    const atkAdjField = editorField(adjRow, "Attack adjustment");
    const atkAdj = numberInput(calc.attackAdjustment, "Extra attack bonus");
    atkAdjField.control.appendChild(atkAdj);
    addListener(atkAdj, "input", () => {
      editorSession.calc.attackAdjustment = Number(atkAdj.value) || 0;
      refreshEditorPreviewFromDom();
    });
    const dmgAdjField = editorField(adjRow, "Damage adjustment");
    const dmgAdj = numberInput(calc.damageAdjustment, "Extra damage bonus");
    dmgAdjField.control.appendChild(dmgAdj);
    addListener(dmgAdj, "input", () => {
      editorSession.calc.damageAdjustment = Number(dmgAdj.value) || 0;
      refreshEditorPreviewFromDom();
    });
    body.appendChild(adjRow);
  }

  function renderFixedFields(body, fixed) {
    const hint = document.createElement("div");
    hint.className = "mutedSmall";
    hint.textContent = "Type the final values. Nothing recalculates in fixed mode.";
    body.appendChild(hint);

    const rows = /** @type {const} */ ([
      ["bonus", "Attack bonus", "+5"],
      ["damage", "Damage", "1d8+3"],
      ["range", "Range", "Melee"],
      ["type", "Damage type", "Slashing"]
    ]);
    for (const [key, labelText, placeholder] of rows) {
      const f = editorField(body, labelText);
      const input = document.createElement("input");
      input.type = "text";
      input.className = "settingsInput attackEditorText";
      input.placeholder = placeholder;
      input.value = fixed[key];
      input.setAttribute("aria-label", labelText);
      f.control.appendChild(input);
      addListener(input, "input", () => {
        editorSession.fixed[key] = input.value;
        refreshEditorPreviewFromDom();
      });
    }
  }

  function numberInput(value, ariaLabel) {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "settingsInput attackEditorNumber";
    input.value = String(value || 0);
    input.setAttribute("aria-label", ariaLabel);
    return input;
  }

  function footerButton(label, { primary = false } = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "npcSmallBtn";
    btn.textContent = label;
    if (!primary) btn.dataset.attackEditorCancel = "true";
    return btn;
  }

  /** Recomputes the preview from the current draft calc/fixed state. */
  function refreshEditorPreview(previewLine) {
    if (!editorSession || !previewLine) return;
    const { calc, fixed } = editorSession;
    if (calc.mode === "fixed") {
      previewLine.textContent = formatPreviewLine(fixed.bonus, fixed.damage, fixed.range, fixed.type);
      return;
    }
    const derived = deriveActive();
    if (!derived) { previewLine.textContent = "Preview unavailable."; return; }
    const attack = currentAttack(editorSession.attackId) || {};
    const model = getAttackDisplayModel({ ...attack, calc }, derived, getActiveContentRegistry());
    previewLine.textContent = formatPreviewLine(model.bonus, model.damage, model.range, model.type);
    const warnLine = editorOverlay?.querySelector(".attackEditorPreviewWarn");
    warnLine?.remove();
    if (model.warnings && model.warnings.length) {
      const warn = document.createElement("div");
      warn.className = "attackWarning attackEditorPreviewWarn";
      warn.textContent = model.warnings[0];
      previewLine.insertAdjacentElement("afterend", warn);
    }
  }

  function refreshEditorPreviewFromDom() {
    const previewLine = editorOverlay?.querySelector(".attackEditorPreviewLine");
    if (previewLine instanceof HTMLElement) refreshEditorPreview(previewLine);
  }

  function formatPreviewLine(bonus, damage, range, type) {
    const parts = [];
    if (bonus) parts.push(`Attack ${bonus}`);
    if (damage) parts.push(`Damage ${damage}${type ? ` ${type.toLowerCase()}` : ""}`);
    else if (type) parts.push(type);
    if (range) parts.push(range);
    return parts.length ? parts.join(" · ") : "Nothing to show yet.";
  }

  function applyEditorDialog() {
    if (!editorSession || destroyed) return;
    const { attackId, calc, fixed } = editorSession;
    const attack = currentAttack(attackId);
    if (!attack) { closeEditorDialog(); return; }

    /** @type {Record<string, unknown>} */
    const patch = {};
    if (calc.mode === "fixed") {
      patch.calc = { ...calc };
      patch.bonus = fixed.bonus.trim();
      patch.damage = fixed.damage.trim();
      patch.range = fixed.range.trim();
      patch.type = fixed.type.trim();
    } else {
      patch.calc = { ...calc };
      // Snapshot the current derived values as a stored fallback (used only
      // if a future derivation fails, e.g. an unset ability). The display
      // reads live, so this is not a synced copy.
      const derived = deriveActive();
      if (derived) {
        const model = getAttackDisplayModel({ ...attack, calc }, derived, getActiveContentRegistry());
        patch.bonus = model.bonus;
        patch.damage = model.damage;
        patch.range = model.range;
        patch.type = model.type;
      }
      // Weapon mode: stamp the stable provenance marker so the link survives
      // renames. Non-weapon modes clear any stale marker.
      if (calc.mode === "weapon" && calc.weaponId) {
        patch.builderSeed = `weapon:${calc.weaponId}`;
      } else if (getAttackSourceWeaponId(attack)) {
        patch.builderSeed = "";
      }
    }

    const updated = patchAttack(attackId, patch);
    closeEditorDialog();
    if (updated) {
      renderAttacks();
      if (typeof setStatus === "function") setStatus("Weapon calculation updated.");
    }
  }

  /**
   * Seeds a fresh draft calc from the attack's current state. Legacy rows
   * (no calc) open in weapon mode so the user can link a weapon, but nothing
   * is inferred from the name — the weapon starts unchosen.
   * @param {Record<string, unknown>} attack
   * @returns {import("../../../domain/attackCalculation.js").AttackCalc}
   */
  function draftCalcFor(attack) {
    const existing = normalizeAttackCalc(attack.calc);
    if (existing) return { ...existing };
    const linkedWeaponId = getAttackSourceWeaponId(attack);
    if (linkedWeaponId) {
      const derived = deriveActive();
      const weapon = getContentByKind(getActiveContentRegistry(), "weapon", linkedWeaponId);
      return buildWeaponAttackCalc(linkedWeaponId, {
        proficient: derived && weapon ? isWeaponProficient(derived, weapon) : true
      });
    }
    // A brand-new or legacy row with no provenance: default to ability mode so
    // the user gets structured controls immediately.
    return {
      mode: "ability", weaponId: "", ability: "str", proficient: true,
      baseDamage: typeof attack.damage === "string" ? attack.damage.replace(/[+-]\d+$/, "").trim() : "",
      damageAbility: "", addAbilityToDamage: true,
      damageType: typeof attack.type === "string" ? attack.type : "",
      range: typeof attack.range === "string" ? attack.range : "",
      attackAdjustment: 0, damageAdjustment: 0
    };
  }

  function openAttackEditor(attackId) {
    if (destroyed) return;
    const attack = currentAttack(attackId);
    const character = getActiveCharacter(state);
    if (!attack || !character) return;
    const overlay = ensureEditorDialog();
    editorSession = {
      attackId,
      calc: draftCalcFor(attack),
      fixed: {
        bonus: typeof attack.bonus === "string" ? attack.bonus : "",
        damage: typeof attack.damage === "string" ? attack.damage : "",
        range: typeof attack.range === "string" ? attack.range : "",
        type: typeof attack.type === "string" ? attack.type : ""
      }
    };
    renderEditorDialog();
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    const panel = overlay.querySelector(".attackEditorPanel");
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

      const editBtn = target.closest(".attackEditBtn");
      if (editBtn instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();
        openAttackEditor(attackId);
        return;
      }

      const deleteBtn = target.closest(".attackDeleteBtn");
      if (!(deleteBtn instanceof HTMLButtonElement)) return;

      event.preventDefault();
      event.stopPropagation();
      await deleteAttack(attackId);
    }, (err) => {
      console.error(err);
      if (typeof setStatus === "function") setStatus("Weapon action failed.");
      else console.warn("Weapon action failed.");
    })
  );

  renderAttacks();

  addDestroy(subscribePanelDataChanged("weapons", (detail) => {
    if (destroyed || detail.source === panelInstance) return;
    renderAttacks();
  }));

  // Structured attacks derive live from abilities and proficiency. When those
  // inputs change elsewhere (freeform ability edits, proficiency edits), the
  // Attacks panel re-renders so derived values update automatically — no
  // recalc action. Guard against stealing focus mid-inline-edit or clobbering
  // an open editor. (Builder ability changes route through a full page
  // re-init, so this covers the freeform live-update path.)
  const rerenderIfDerivedAttacks = () => {
    if (destroyed) return;
    if (editorOverlay && !editorOverlay.hidden) return;
    if (listEl.contains(document.activeElement)) return;
    const hasDerived = getAttacks().some((attack) => {
      const calc = normalizeAttackCalc(attack?.calc);
      return calc && calc.mode !== "fixed";
    });
    if (hasDerived) renderAttacks();
  };
  addDestroy(subscribePanelDataChanged("character-fields", (detail) => {
    if (detail.source === panelInstance) return;
    rerenderIfDerivedAttacks();
  }));
  addDestroy(subscribePanelDataChanged("vitals", (detail) => {
    if (detail.source === panelInstance) return;
    rerenderIfDerivedAttacks();
  }));

  addDestroy(() => {
    editorSession = null;
    editorOverlay?.remove?.();
    editorOverlay = null;
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
