// @ts-check
// js/pages/character/panels/abilitiesPanel.js
// Character page Abilities panel (abilities + skills + save options)

import { enhanceSelectDropdown } from "../../../ui/selectDropdown.js";
import { flipSwapTwo } from "../../../ui/flipSwap.js";
import { getNoopDestroyApi, requireMany } from "../../../utils/domGuards.js";

/** @typedef {import("../../../storage/saveManager.js").SaveManager} SaveManager */
/** @typedef {import("../../../ui/popovers.js").PopoversApi} PopoversApi */
/** @typedef {import("../../../ui/popovers.js").PopoverHandle} PopoverHandle */

/**
 * @typedef {"str" | "dex" | "con" | "int" | "wis" | "cha"} AbilityKey
 */

/**
 * @typedef {"none" | "half" | "prof" | "expert"} SkillLevel
 */

/**
 * @typedef {{
 *   score: number,
 *   saveProf: boolean,
 *   [key: string]: unknown
 * }} AbilityState
 */

/**
 * @typedef {{
 *   level: SkillLevel,
 *   misc: number,
 *   value: number,
 *   prof?: boolean,
 *   [key: string]: unknown
 * }} SkillState
 */

/**
 * @typedef {{
 *   misc: Record<AbilityKey, number>,
 *   modToAll: string,
 *   [key: string]: unknown
 * }} SaveOptionsState
 */

/**
 * @typedef {{
 *   abilities?: Record<string, unknown>,
 *   skills?: Record<string, unknown>,
 *   skillsNotes?: string,
 *   ui?: Record<string, unknown>,
 *   saveOptions?: Record<string, unknown>,
 *   [key: string]: unknown
 * }} CharacterPanelState
 */

/**
 * @typedef {{
 *   character?: CharacterPanelState,
 *   [key: string]: unknown
 * }} AbilitiesPanelState
 */

/**
 * @typedef {{
 *   state?: AbilitiesPanelState,
 *   SaveManager?: SaveManager,
 *   Popovers?: PopoversApi,
 *   setStatus?: ((message: string, opts?: { stickyMs?: number }) => void) | undefined,
 *   [key: string]: unknown
 * }} AbilitiesPanelDeps
 */

/**
 * @typedef {{
 *   ability: AbilityKey,
 *   blockEl: HTMLElement,
 *   scoreInput: HTMLInputElement,
 *   saveProfInput: HTMLInputElement,
 *   recalc: (opts?: { markDirty?: boolean }) => void
 * }} AbilityController
 */

const ABILITY_KEYS = /** @type {const} */ (["str", "dex", "con", "int", "wis", "cha"]);

const ABILITY_SUFFIX_BY_KEY = /** @type {Record<AbilityKey, string>} */ ({
  str: "Str",
  dex: "Dex",
  con: "Con",
  int: "Int",
  wis: "Wis",
  cha: "Cha"
});

const DEFAULT_SAVE_MISC = /** @type {Record<AbilityKey, number>} */ ({
  str: 0,
  dex: 0,
  con: 0,
  int: 0,
  wis: 0,
  cha: 0
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return !!value && typeof value === "object";
}

/**
 * @param {string} value
 * @returns {value is AbilityKey}
 */
function isAbilityKey(value) {
  return /** @type {readonly string[]} */ (ABILITY_KEYS).includes(value);
}

/**
 * @param {string} id
 * @returns {HTMLInputElement | null}
 */
function getInputById(id) {
  const el = document.getElementById(id);
  return el instanceof HTMLInputElement ? el : null;
}

/**
 * @param {string} id
 * @returns {HTMLSelectElement | null}
 */
function getSelectById(id) {
  const el = document.getElementById(id);
  return el instanceof HTMLSelectElement ? el : null;
}

/**
 * @param {string} id
 * @returns {HTMLInputElement | HTMLTextAreaElement | null}
 */
function getTextFieldById(id) {
  const el = document.getElementById(id);
  return (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ? el : null;
}

/**
 * @param {number} score
 * @returns {number}
 */
function computeAbilityMod(score) {
  return Math.floor((score - 10) / 2);
}

/**
 * @param {SkillLevel} level
 * @param {number} profBonus
 * @returns {number}
 */
function profAddForLevel(level, profBonus) {
  if (level === "half") return Math.floor(profBonus / 2);
  if (level === "prof") return profBonus;
  if (level === "expert") return profBonus * 2;
  return 0;
}

/**
 * @param {SkillLevel} level
 * @returns {string}
 */
function labelForLevel(level) {
  if (level === "half") return "½";
  if (level === "prof") return "✓";
  if (level === "expert") return "★";
  return "—";
}

/**
 * @param {AbilitiesPanelDeps} [deps]
 * @returns {{ destroy: () => void }}
 */
export function initAbilitiesPanel(deps = {}) {
  const { state, SaveManager, Popovers, setStatus } = deps;
  if (!state || !SaveManager || !Popovers) return getNoopDestroyApi();

  const required = {
    panel: "#charAbilitiesPanel",
    abilityGrid: "#charAbilitiesPanel .abilityGrid"
  };
  const guard = requireMany(required, { root: document, setStatus, context: "Abilities panel" });
  if (!guard.ok) {
    return /** @type {{ destroy: () => void }} */ (guard.destroy || getNoopDestroyApi());
  }

  const panelEl = guard.els.panel instanceof HTMLElement ? guard.els.panel : null;
  const abilityGrid = guard.els.abilityGrid instanceof HTMLElement ? guard.els.abilityGrid : null;
  if (!panelEl || !abilityGrid) return getNoopDestroyApi();

  const character = isRecord(state.character)
    ? /** @type {CharacterPanelState} */ (state.character)
    : (state.character = /** @type {CharacterPanelState} */ ({}));

  if (!isRecord(character.abilities)) character.abilities = {};
  if (!isRecord(character.skills)) character.skills = {};
  if (!isRecord(character.ui)) character.ui = {};

  /** @type {Array<() => void>} */
  const destroyFns = [];
  const addDestroy = (destroyFn) => {
    if (typeof destroyFn === "function") destroyFns.push(destroyFn);
  };

  const listenerController = new AbortController();
  const listenerSignal = listenerController.signal;
  addDestroy(() => listenerController.abort());

  let destroyed = false;
  /** @type {PopoverHandle | null} */
  let openSkillHandle = null;

  /** @type {Map<AbilityKey, AbilityController>} */
  const abilityControllers = new Map();

  /**
   * @param {EventTarget | null | undefined} target
   * @param {string} type
   * @param {(event: Event) => void} handler
   * @param {AddEventListenerOptions | boolean} [options]
   */
  function addListener(target, type, handler, options) {
    if (!target || typeof target.addEventListener !== "function") return;
    const listenerOptions =
      typeof options === "boolean"
        ? { capture: options }
        : (options || {});
    target.addEventListener(type, handler, { ...listenerOptions, signal: listenerSignal });
  }

  function markDirty() {
    try { SaveManager.markDirty(); } catch { /* noop */ }
  }

  function closeOpenSkillMenu() {
    if (!openSkillHandle) return;
    try { openSkillHandle.close(); } catch { /* noop */ }
    openSkillHandle = null;
  }

  addDestroy(closeOpenSkillMenu);

  /**
   * @returns {Record<string, unknown>}
   */
  function ensureAbilityMap() {
    if (!isRecord(character.abilities)) character.abilities = {};
    return /** @type {Record<string, unknown>} */ (character.abilities);
  }

  /**
   * @returns {Record<string, unknown>}
   */
  function ensureSkillMap() {
    if (!isRecord(character.skills)) character.skills = {};
    return /** @type {Record<string, unknown>} */ (character.skills);
  }

  /**
   * @returns {Record<string, unknown>}
   */
  function ensureCharacterUi() {
    if (!isRecord(character.ui)) character.ui = {};
    return /** @type {Record<string, unknown>} */ (character.ui);
  }

  /**
   * @returns {Record<string, boolean>}
   */
  function ensureAbilityCollapseState() {
    const ui = ensureCharacterUi();
    if (!isRecord(ui.abilityCollapse)) ui.abilityCollapse = {};
    return /** @type {Record<string, boolean>} */ (ui.abilityCollapse);
  }

  /**
   * @returns {SaveOptionsState}
   */
  function ensureSaveOptionsShape() {
    if (!isRecord(character.saveOptions)) character.saveOptions = {};
    const saveOptions = /** @type {Record<string, unknown>} */ (character.saveOptions);
    if (!isRecord(saveOptions.misc)) saveOptions.misc = { ...DEFAULT_SAVE_MISC };
    const misc = /** @type {Record<string, unknown>} */ (saveOptions.misc);

    for (const key of ABILITY_KEYS) {
      misc[key] = Number(misc[key] || 0);
    }

    if (typeof saveOptions.modToAll !== "string") saveOptions.modToAll = "";

    return /** @type {SaveOptionsState} */ (saveOptions);
  }

  /**
   * @param {AbilityKey} key
   * @returns {AbilityState}
   */
  function ensureAbilityShape(key) {
    const abilities = ensureAbilityMap();
    const raw = abilities[key];

    if (!isRecord(raw)) {
      const created = /** @type {AbilityState} */ ({ score: 10, saveProf: false });
      abilities[key] = created;
      return created;
    }

    if (typeof raw.score !== "number" || !Number.isFinite(raw.score)) raw.score = 10;
    raw.saveProf = !!raw.saveProf;
    return /** @type {AbilityState} */ (raw);
  }

  /**
   * @param {string} skillKey
   * @returns {SkillState}
   */
  function ensureSkillState(skillKey) {
    const skills = ensureSkillMap();
    const raw = skills[skillKey];

    if (isRecord(raw) && typeof raw.level === "string") {
      const level = raw.level;
      raw.level =
        level === "half" || level === "prof" || level === "expert"
          ? level
          : "none";
      raw.misc = Number(raw.misc || 0);
      raw.value = Number(raw.value || 0);
      return /** @type {SkillState} */ (raw);
    }

    const legacy = isRecord(raw) ? raw : {};
    const migrated = /** @type {SkillState} */ ({
      level: legacy.prof ? "prof" : "none",
      misc: Number(legacy.misc || 0),
      value: Number(legacy.value || 0)
    });
    skills[skillKey] = migrated;
    return migrated;
  }

  function getProfBonus() {
    return Number(getInputById("charProf")?.value || 0);
  }

  /**
   * @param {AbilityKey} key
   * @returns {number}
   */
  function getExtraSaveMod(key) {
    const saveOptions = ensureSaveOptionsShape();
    const misc = Number(saveOptions.misc[key] || 0);
    const pick = saveOptions.modToAll;
    if (!isAbilityKey(pick)) return misc;
    const pickedScore = ensureAbilityShape(pick).score;
    return misc + computeAbilityMod(pickedScore);
  }

  /**
   * @param {AbilityKey} key
   * @returns {number}
   */
  function computeSaveForAbility(key) {
    const abilityState = ensureAbilityShape(key);
    const mod = computeAbilityMod(abilityState.score);
    return mod + (abilityState.saveProf ? getProfBonus() : 0) + getExtraSaveMod(key);
  }

  /**
   * @param {AbilityKey} key
   * @param {number} score
   * @param {number} mod
   * @param {number} save
   */
  function syncLegacyAbilityFields(key, score, mod, save) {
    const suffix = ABILITY_SUFFIX_BY_KEY[key];

    const scoreEl = getInputById(`ab${suffix}`);
    if (scoreEl) scoreEl.value = String(score);

    const modInput = getInputById(`ab${suffix}Mod`);
    if (modInput) modInput.value = String(mod);

    const saveInput = getInputById(`ab${suffix}Save`);
    if (saveInput) saveInput.value = String(save);
  }

  function recalcAllAbilities() {
    for (const controller of abilityControllers.values()) {
      controller.recalc();
    }
  }

  /**
   * @param {AbilityKey} key
   */
  function bindLegacyAbilityScoreField(key) {
    const suffix = ABILITY_SUFFIX_BY_KEY[key];
    const legacyInput = getInputById(`ab${suffix}`);
    if (!legacyInput) return;

    legacyInput.value = String(ensureAbilityShape(key).score);
    addListener(legacyInput, "input", () => {
      if (destroyed) return;
      const controller = abilityControllers.get(key);
      const nextScore = Number(legacyInput.value || 10);
      ensureAbilityShape(key).score = nextScore;
      if (controller) {
        controller.scoreInput.value = String(nextScore);
        controller.recalc({ markDirty: true });
        return;
      }
      syncLegacyAbilityFields(
        key,
        nextScore,
        computeAbilityMod(nextScore),
        computeSaveForAbility(key)
      );
      markDirty();
    });
  }

  for (const key of ABILITY_KEYS) {
    bindLegacyAbilityScoreField(key);
  }

  const skillsNotesEl = getTextFieldById("charSkillsNotes");
  if (skillsNotesEl) {
    skillsNotesEl.value = typeof character.skillsNotes === "string" ? character.skillsNotes : "";
    addListener(skillsNotesEl, "input", () => {
      if (destroyed) return;
      character.skillsNotes = skillsNotesEl.value;
      markDirty();
    });
  }

  const profInput = getInputById("charProf");
  if (profInput) {
    addListener(profInput, "input", () => {
      if (destroyed) return;
      recalcAllAbilities();
    });
  }

  (function setupSaveOptionsDropdown() {
    const btn = document.getElementById("saveOptionsBtn");
    const menu = document.getElementById("saveOptionsMenu");
    if (!(btn instanceof HTMLElement) || !(menu instanceof HTMLElement)) return;

    const saveOptions = ensureSaveOptionsShape();

    for (const key of ABILITY_KEYS) {
      const input = getInputById(`miscSave_${key}`);
      if (!input) continue;
      input.value = String(Number(saveOptions.misc[key] || 0));
      addListener(input, "input", () => {
        if (destroyed) return;
        ensureSaveOptionsShape().misc[key] = Number(input.value || 0);
        recalcAllAbilities();
        markDirty();
      });
    }

    const select = getSelectById("saveModToAllSelect");
    if (select) {
      select.value = saveOptions.modToAll || "";
      const enhancedDropdown = enhanceSelectDropdown({
        select,
        Popovers,
        buttonClass: "settingsSelectBtn",
        optionClass: "swatchOption",
        groupLabelClass: "dropdownGroupLabel",
        preferRight: true,
        exclusive: false
      });
      addDestroy(() => {
        try { enhancedDropdown?.destroy?.(); } catch { /* noop */ }
      });

      try { select.dispatchEvent(new Event("selectDropdown:sync")); } catch { /* noop */ }

      addListener(select, "change", () => {
        if (destroyed) return;
        ensureSaveOptionsShape().modToAll = isAbilityKey(select.value) ? select.value : "";
        recalcAllAbilities();
        markDirty();
      });
    }

    const popoverHandle = Popovers.register({
      button: btn,
      menu,
      preferRight: true,
      closeOnOutside: true,
      closeOnEsc: true,
      stopInsideClick: true,
      wireButton: true
    });

    addDestroy(() => {
      try { popoverHandle?.destroy?.(); } catch { /* noop */ }
    });
  })();

  /**
   * @param {string} skillKey
   * @returns {HTMLInputElement}
   */
  function createSkillCheckbox(skillKey) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.skillProf = skillKey;
    return checkbox;
  }

  /**
   * @param {HTMLElement} rowEl
   * @param {string} skillKey
   * @returns {HTMLButtonElement}
   */
  function ensureSkillMenuButton(rowEl, skillKey) {
    const existingBtn = rowEl.querySelector(`.skillProfBtn[data-skill-prof-btn="${skillKey}"]`);
    const checkbox = rowEl.querySelector(`[data-skill-prof="${skillKey}"]`);
    if (existingBtn instanceof HTMLButtonElement) {
      if (checkbox instanceof Element) checkbox.remove();
      return existingBtn;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "skillProfBtn";
    btn.dataset.skillProfBtn = skillKey;
    btn.setAttribute("aria-expanded", "false");
    rowEl.insertBefore(btn, checkbox instanceof Element ? checkbox : rowEl.firstChild);
    if (checkbox instanceof Element) checkbox.remove();
    return btn;
  }

  /**
   * @param {HTMLButtonElement} btn
   * @param {SkillLevel} level
   */
  function syncSkillButton(btn, level) {
    btn.textContent = labelForLevel(level);
    btn.title = "Skill options";
  }

  /**
   * @param {string} skillKey
   * @param {HTMLButtonElement} btn
   * @param {() => void} onValueChange
   * @returns {HTMLDivElement}
   */
  function buildSkillMenu(skillKey, btn, onValueChange) {
    const menu = document.createElement("div");
    menu.className = "dropdownMenu skillProfMenu";
    menu.hidden = true;

    const skillState = ensureSkillState(skillKey);

    /**
     * @param {string} labelText
     * @param {boolean} checked
     * @returns {{ wrap: HTMLLabelElement, cb: HTMLInputElement }}
     */
    function buildSkillLevelRow(labelText, checked) {
      const wrap = document.createElement("label");
      wrap.className = "skillMenuRow";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked;

      const text = document.createElement("span");
      text.textContent = labelText;

      wrap.appendChild(cb);
      wrap.appendChild(text);
      return { wrap, cb };
    }

    const half = buildSkillLevelRow("Half proficient", skillState.level === "half");
    const prof = buildSkillLevelRow("Proficient", skillState.level === "prof");
    const expert = buildSkillLevelRow("Expert (double)", skillState.level === "expert");

    /**
     * @param {SkillLevel} next
     */
    function setLevel(next) {
      const nextState = ensureSkillState(skillKey);
      nextState.level = next;

      half.cb.checked = next === "half";
      prof.cb.checked = next === "prof";
      expert.cb.checked = next === "expert";
      syncSkillButton(btn, next);
      onValueChange();
    }

    addListener(half.cb, "change", () => setLevel(half.cb.checked ? "half" : "none"));
    addListener(prof.cb, "change", () => setLevel(prof.cb.checked ? "prof" : "none"));
    addListener(expert.cb, "change", () => setLevel(expert.cb.checked ? "expert" : "none"));

    const miscWrap = document.createElement("div");
    miscWrap.className = "skillMenuMisc";

    const miscLabel = document.createElement("div");
    miscLabel.className = "skillMenuLabel";
    miscLabel.textContent = "Misc bonus";

    const miscInput = document.createElement("input");
    miscInput.type = "number";
    miscInput.value = String(Number(skillState.misc || 0));
    miscInput.className = "skillMiscInput";

    addListener(miscInput, "input", () => {
      const nextState = ensureSkillState(skillKey);
      nextState.misc = Number(miscInput.value || 0);
      onValueChange();
    });

    miscWrap.appendChild(miscLabel);
    miscWrap.appendChild(miscInput);

    menu.appendChild(half.wrap);
    menu.appendChild(prof.wrap);
    menu.appendChild(expert.wrap);
    menu.appendChild(document.createElement("hr"));
    menu.appendChild(miscWrap);

    document.body.appendChild(menu);
    return menu;
  }

  /**
   * @param {AbilityKey} ability
   * @param {HTMLElement} blockEl
   * @param {HTMLInputElement} scoreInput
   * @param {HTMLInputElement} saveProfInput
   * @param {HTMLElement} modEl
   * @param {HTMLElement} saveEl
   * @returns {(opts?: { markDirty?: boolean }) => void}
   */
  function createAbilityRecalc(ability, blockEl, scoreInput, saveProfInput, modEl, saveEl) {
    return ({ markDirty: shouldMarkDirty = false } = {}) => {
      if (destroyed) return;

      const abilityState = ensureAbilityShape(ability);
      const score = Number(scoreInput.value || 10);
      const mod = computeAbilityMod(score);
      const save = mod + (saveProfInput.checked ? getProfBonus() : 0) + getExtraSaveMod(ability);

      modEl.textContent = `${mod >= 0 ? "+" : ""}${mod}`;
      saveEl.textContent = `${save >= 0 ? "+" : ""}${save}`;
      syncLegacyAbilityFields(ability, score, mod, save);

      for (const valueEl of Array.from(blockEl.querySelectorAll("[data-skill-value]"))) {
        if (!(valueEl instanceof HTMLElement)) continue;
        const skillKey = valueEl.dataset.skillValue;
        if (!skillKey) continue;

        const skillState = ensureSkillState(skillKey);
        const total = mod + profAddForLevel(skillState.level, getProfBonus()) + Number(skillState.misc || 0);
        valueEl.textContent = `${total >= 0 ? "+" : ""}${total}`;
        skillState.value = total;
      }

      abilityState.score = score;
      abilityState.saveProf = saveProfInput.checked;

      if (shouldMarkDirty) markDirty();
    };
  }

  /**
   * @param {HTMLElement} blockEl
   * @returns {AbilityController | null}
   */
  function setupAbilityBlock(blockEl) {
    const ability = blockEl.dataset.ability;
    if (!ability || !isAbilityKey(ability)) return null;

    const scoreInput = blockEl.querySelector(".abilityScore");
    const modEl = blockEl.querySelector('[data-stat="mod"]');
    const saveEl = blockEl.querySelector('[data-stat="save"]');
    const saveProfInput = blockEl.querySelector('[data-stat="saveProf"]');

    if (
      !(scoreInput instanceof HTMLInputElement) ||
      !(modEl instanceof HTMLElement) ||
      !(saveEl instanceof HTMLElement) ||
      !(saveProfInput instanceof HTMLInputElement)
    ) {
      return null;
    }

    const abilityState = ensureAbilityShape(ability);
    scoreInput.value = String(abilityState.score);
    saveProfInput.checked = abilityState.saveProf;

    const recalc = createAbilityRecalc(
      ability,
      blockEl,
      scoreInput,
      saveProfInput,
      modEl,
      saveEl
    );

    addListener(scoreInput, "input", () => recalc({ markDirty: true }));
    addListener(saveProfInput, "change", () => recalc({ markDirty: true }));

    const header = blockEl.querySelector(".abilityHeader");
    const skills = blockEl.querySelector(".abilitySkills");
    const collapseState = ensureAbilityCollapseState();
    if (skills instanceof HTMLElement) {
      skills.style.display = collapseState[ability] ? "none" : "";
    }

    if (header instanceof HTMLElement && skills instanceof HTMLElement) {
      addListener(header, "click", (event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest("input, button, label, select, textarea")) return;

        const nowCollapsed = skills.style.display !== "none";
        skills.style.display = nowCollapsed ? "none" : "";
        ensureAbilityCollapseState()[ability] = nowCollapsed;
        markDirty();
      });
    }

    for (const rowEl of Array.from(blockEl.querySelectorAll(".skillRow"))) {
      if (!(rowEl instanceof HTMLElement)) continue;

      const existingBtn = rowEl.querySelector(".skillProfBtn[data-skill-prof-btn]");
      const existingCheckbox = rowEl.querySelector("[data-skill-prof]");
      const skillKey =
        (existingBtn instanceof HTMLButtonElement ? existingBtn.dataset.skillProfBtn : null) ||
        (existingCheckbox instanceof HTMLElement ? existingCheckbox.dataset.skillProf : null);

      if (!skillKey) continue;

      const btn = ensureSkillMenuButton(rowEl, skillKey);
      syncSkillButton(btn, ensureSkillState(skillKey).level);

      const menu = buildSkillMenu(skillKey, btn, () => recalc({ markDirty: true }));
      const popoverHandle = Popovers.register({
        button: btn,
        menu,
        preferRight: true,
        closeOnOutside: true,
        closeOnEsc: true,
        stopInsideClick: true,
        wireButton: false
      });

      addListener(btn, "click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!popoverHandle) return;

        if (openSkillHandle === popoverHandle && !menu.hidden) {
          closeOpenSkillMenu();
          return;
        }

        closeOpenSkillMenu();
        Popovers.open(popoverHandle.reg, { exclusive: false });
        openSkillHandle = popoverHandle;
      });

      addDestroy(() => {
        if (!rowEl.isConnected) return;
        if (!rowEl.querySelector(`[data-skill-prof="${skillKey}"]`)) {
          rowEl.insertBefore(createSkillCheckbox(skillKey), rowEl.firstChild);
        }
        btn.remove();
      });
      addDestroy(() => {
        try { popoverHandle?.destroy?.(); } catch { /* noop */ }
      });
      addDestroy(() => menu.remove());
    }

    recalc();
    return {
      ability,
      blockEl,
      scoreInput,
      saveProfInput,
      recalc
    };
  }

  (function setupAbilityBlockReorder() {
    const blocks = Array.from(abilityGrid.querySelectorAll(".abilityBlock"))
      .filter((blockEl) => blockEl instanceof HTMLElement);
    const defaultOrder = blocks
      .map((blockEl) => blockEl.dataset.ability)
      .filter((value) => typeof value === "string");

    const ui = ensureCharacterUi();
    const currentOrder = Array.isArray(ui.abilityOrder)
      ? ui.abilityOrder.filter((value) => typeof value === "string")
      : [];
    const defaultSet = new Set(defaultOrder);
    const cleaned = currentOrder.filter((key) => defaultSet.has(key));
    for (const key of defaultOrder) {
      if (!cleaned.includes(key)) cleaned.push(key);
    }
    ui.abilityOrder = cleaned;

    const applyOrder = () => {
      const order = Array.isArray(ui.abilityOrder) ? ui.abilityOrder : defaultOrder;
      const blockMap = new Map(
        blocks.map((blockEl) => [blockEl.dataset.ability, blockEl])
      );

      for (const key of order) {
        const blockEl = blockMap.get(key);
        if (blockEl) abilityGrid.appendChild(blockEl);
      }
    };

    /**
     * @param {AbilityKey} key
     * @param {-1 | 1} dir
     * @param {HTMLButtonElement | null} focusBtn
     */
    const moveAbility = (key, dir, focusBtn = null) => {
      if (destroyed) return;
      const order = Array.isArray(ui.abilityOrder) ? ui.abilityOrder : [];
      const from = order.indexOf(key);
      const to = from + dir;
      if (from === -1 || to < 0 || to >= order.length) return;

      const adjacentKey = order[to];
      const movedEl = abilityGrid.querySelector(`.abilityBlock[data-ability="${key}"]`);
      const adjacentEl = abilityGrid.querySelector(`.abilityBlock[data-ability="${adjacentKey}"]`);

      [order[from], order[to]] = [order[to], order[from]];
      markDirty();

      if (!(movedEl instanceof HTMLElement) || !(adjacentEl instanceof HTMLElement)) {
        applyOrder();
        return;
      }

      const prevPanelScroll = panelEl.scrollTop;
      const activeEl = document.activeElement;
      const keepFocusOnActive = !!(
        activeEl instanceof HTMLElement &&
        (movedEl.contains(activeEl) || adjacentEl.contains(activeEl)) &&
        activeEl.matches("input, textarea, select")
      );

      const didSwap = flipSwapTwo(movedEl, adjacentEl, {
        durationMs: 260,
        easing: "cubic-bezier(.22,1,.36,1)",
        swap: () => {
          if (dir < 0) abilityGrid.insertBefore(movedEl, adjacentEl);
          else abilityGrid.insertBefore(adjacentEl, movedEl);
          panelEl.scrollTop = prevPanelScroll;
        },
      });

      if (!didSwap) {
        applyOrder();
        return;
      }

      if (keepFocusOnActive && activeEl instanceof HTMLElement) {
        requestAnimationFrame(() => {
          try { activeEl.focus({ preventScroll: true }); } catch { activeEl.focus(); }
          panelEl.scrollTop = prevPanelScroll;
        });
        return;
      }

      if (focusBtn) {
        requestAnimationFrame(() => {
          try { focusBtn.focus({ preventScroll: true }); } catch { focusBtn.focus(); }
        });
      }
    };

    /**
     * @param {HTMLElement} blockEl
     */
    const attachMoves = (blockEl) => {
      const key = blockEl.dataset.ability;
      if (!key || !isAbilityKey(key)) return;

      const header = blockEl.querySelector(".abilityHeader");
      if (!(header instanceof HTMLElement)) return;

      /** @type {HTMLElement | null} */
      let wrap = header.querySelector(`[data-ability-moves="${key}"]`);
      if (!(wrap instanceof HTMLElement)) {
        wrap = document.createElement("div");
        wrap.className = "abilityMoves";
        wrap.dataset.abilityMoves = key;
        header.appendChild(wrap);
      }

      wrap.replaceChildren();

      const moveUp = document.createElement("button");
      moveUp.type = "button";
      moveUp.className = "moveBtn";
      moveUp.textContent = "↑";
      moveUp.title = "Move ability up";
      moveUp.dataset.abilityKey = key;
      moveUp.dataset.moveDirection = "-1";

      const moveDown = document.createElement("button");
      moveDown.type = "button";
      moveDown.className = "moveBtn";
      moveDown.textContent = "↓";
      moveDown.title = "Move ability down";
      moveDown.dataset.abilityKey = key;
      moveDown.dataset.moveDirection = "1";

      wrap.appendChild(moveUp);
      wrap.appendChild(moveDown);

      addDestroy(() => {
        if (wrap instanceof HTMLElement) wrap.remove();
      });
    };

    for (const blockEl of blocks) {
      attachMoves(blockEl);
    }

    addListener(abilityGrid, "click", (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      const moveBtn = event.target.closest(".abilityMoves .moveBtn");
      if (!(moveBtn instanceof HTMLButtonElement)) return;

      const key = moveBtn.dataset.abilityKey;
      const dir = Number(moveBtn.dataset.moveDirection);
      if (!key || !isAbilityKey(key) || (dir !== -1 && dir !== 1)) return;

      event.preventDefault();
      event.stopPropagation();
      moveAbility(key, /** @type {-1 | 1} */ (dir), moveBtn);
    });

    applyOrder();
  })();

  for (const blockEl of abilityGrid.querySelectorAll(".abilityBlock")) {
    if (!(blockEl instanceof HTMLElement)) continue;
    const controller = setupAbilityBlock(blockEl);
    if (!controller) continue;
    abilityControllers.set(controller.ability, controller);
  }

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
