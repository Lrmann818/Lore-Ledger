// @ts-check
// js/pages/character/panels/abilitiesPanel.js
// Character page Abilities panel (abilities + skills + save options)

import { enhanceSelectDropdown } from "../../../ui/selectDropdown.js";
import { flipSwapTwo } from "../../../ui/flipSwap.js";
import { getNoopDestroyApi, requireMany } from "../../../utils/domGuards.js";
import { ACTIVE_CHARACTER_CHANGED_EVENT } from "../../../domain/characterEvents.js";
import { getActiveCharacter, isBuilderCharacter, normalizeCharacterOverrides } from "../../../domain/characterHelpers.js";
import { deriveCharacter } from "../../../domain/rules/deriveCharacter.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { notifyPanelDataChanged, subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";

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
 *   root?: HTMLElement,
 *   selectors?: Record<string, string>,
 *   [key: string]: unknown
 * }} AbilitiesPanelDeps
 */

/**
 * @typedef {{
 *   ability: AbilityKey,
 *   blockEl: HTMLElement,
 *   scoreInput: HTMLInputElement,
 *   saveProfInput: HTMLInputElement,
 *   recalc: (opts?: { markDirty?: boolean, syncFromState?: boolean }) => void
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
 * @param {unknown} value
 * @returns {value is number}
 */
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatSigned(value) {
  return value >= 0 ? `+${value}` : String(value);
}

/**
 * @param {Element} el
 * @param {string} name
 */
function removeElementAttribute(el, name) {
  if (typeof el.removeAttribute === "function") {
    el.removeAttribute(name);
    return;
  }
  /** @type {{ attributes?: { delete?: (name: string) => void }, [key: string]: unknown }} */ (/** @type {unknown} */ (el)).attributes?.delete?.(name);
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
  const { state, SaveManager, Popovers, setStatus, root, selectors } = deps;
  if (!state || !SaveManager || !Popovers) return getNoopDestroyApi();

  // Scope all panel-internal element lookups to `root` when provided.
  // Cross-panel elements (charProf, legacy abStr fields) use document directly.
  const scope = root instanceof HTMLElement ? root : document;

  const required = {
    panel: "#charAbilitiesPanel",
    abilityGrid: "#charAbilitiesPanel .abilityGrid",
    ...(selectors || {})
  };
  const guard = requireMany(required, { root: scope, setStatus, context: "Abilities panel" });
  if (!guard.ok) {
    return /** @type {{ destroy: () => void }} */ (guard.destroy || getNoopDestroyApi());
  }

  const panelEl = guard.els.panel instanceof HTMLElement ? guard.els.panel : null;
  const abilityGrid = guard.els.abilityGrid instanceof HTMLElement ? guard.els.abilityGrid : null;
  if (!panelEl || !abilityGrid) return getNoopDestroyApi();

  if (!getActiveCharacter(/** @type {any} */ (state))) return getNoopDestroyApi();
  const { mutateCharacter } = createStateActions({ state: /** @type {any} */ (state), SaveManager });

  mutateCharacter((character) => {
    const panelCharacter = /** @type {CharacterPanelState} */ (character);
    if (!isRecord(panelCharacter.abilities)) panelCharacter.abilities = {};
    if (!isRecord(panelCharacter.skills)) panelCharacter.skills = {};
    if (!isRecord(panelCharacter.ui)) panelCharacter.ui = {};
    return true;
  }, { queueSave: false });

  /** @type {Array<() => void>} */
  const destroyFns = [];
  const addDestroy = (destroyFn) => {
    if (typeof destroyFn === "function") destroyFns.push(destroyFn);
  };

  const listenerController = new AbortController();
  const listenerSignal = listenerController.signal;
  addDestroy(() => listenerController.abort());
  const panelSource = { panelId: "abilities" };

  let destroyed = false;
  const builderHintId = `charAbilitiesBuilderHint_${Math.random().toString(36).slice(2, 8)}`;
  /** @type {HTMLElement | null} */
  let builderHintEl = null;
  /** @type {PopoverHandle | null} */
  let openSkillHandle = null;

  /** @type {Map<AbilityKey, AbilityController>} */
  const abilityControllers = new Map();
  /** @type {() => void} */
  let syncAdjustmentControls = () => {};

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

  /**
   * @returns {CharacterPanelState | null}
   */
  function getCharacter() {
    return /** @type {CharacterPanelState | null} */ (getActiveCharacter(/** @type {any} */ (state)));
  }

  /**
   * @returns {boolean}
   */
  function isCurrentBuilderCharacter() {
    return isBuilderCharacter(getCharacter());
  }

  /**
   * @param {unknown} character
   * @returns {boolean}
   */
  function hasValidBuilderAbilityBaseShape(character) {
    if (!isBuilderCharacter(character) || !isRecord(character)) return false;
    const build = character.build;
    if (!isRecord(build) || !isRecord(build.abilities)) return false;
    const base = build.abilities.base;
    if (!isRecord(base)) return false;
    return ABILITY_KEYS.every((key) => isFiniteNumber(base[key]));
  }

  /**
   * @returns {Record<AbilityKey, { score: number, modifier: number }> | null}
   */
  function getBuilderDerivedAbilityDisplay() {
    const character = getCharacter();
    if (!isBuilderCharacter(character)) return null;
    if (!hasValidBuilderAbilityBaseShape(character)) return null;

    let derived;
    try {
      derived = deriveCharacter(character);
    } catch (err) {
      console.warn("Abilities panel builder derivation failed:", err);
      return null;
    }

    if (!derived || derived.mode !== "builder" || !isRecord(derived.abilities)) return null;

    /** @type {Partial<Record<AbilityKey, { score: number, modifier: number }>>} */
    const display = {};
    for (const key of ABILITY_KEYS) {
      const ability = derived.abilities[key];
      if (!isRecord(ability)) return null;
      if (!isFiniteNumber(ability.total) || !isFiniteNumber(ability.modifier)) return null;
      display[key] = {
        score: ability.total,
        modifier: ability.modifier
      };
    }

    return /** @type {Record<AbilityKey, { score: number, modifier: number }>} */ (display);
  }

  /**
   * @param {AbilityKey} key
   * @returns {{ score: number, modifier: number, builderOwned: boolean } | null}
   */
  function getBuilderAbilityDisplayForKey(key) {
    const display = getBuilderDerivedAbilityDisplay();
    if (!display || !display[key]) return null;
    return {
      score: display[key].score,
      modifier: display[key].modifier,
      builderOwned: true
    };
  }

  /**
   * @param {AbilityKey} key
   * @returns {boolean}
   */
  function getAbilitySaveProfForRead(key) {
    const character = getCharacter();
    const abilities = isRecord(character?.abilities) ? character.abilities : {};
    const row = isRecord(abilities[key]) ? abilities[key] : {};
    return row.saveProf === true;
  }

  /**
   * @param {AbilityKey} key
   * @returns {Record<string, unknown>}
   */
  function ensureAbilityRecordForWrite(key) {
    const abilities = ensureAbilityMap();
    const raw = abilities[key];
    if (isRecord(raw)) return raw;
    /** @type {Record<string, unknown>} */
    const created = {};
    abilities[key] = created;
    return created;
  }

  /**
   * @returns {HTMLElement}
   */
  function ensureBuilderHint() {
    if (builderHintEl instanceof HTMLElement) return builderHintEl;
    const hint = document.createElement("p");
    hint.id = builderHintId;
    hint.className = "builderSheetHint builderAbilitiesNote";
    hint.textContent = "Builder mode ability scores are controlled by Builder Abilities for now.";
    hint.hidden = true;
    panelEl.insertBefore(hint, abilityGrid);
    builderHintEl = hint;
    addDestroy(() => hint.remove());
    return hint;
  }

  /**
   * @param {boolean} visible
   */
  function syncBuilderHint(visible) {
    const hint = ensureBuilderHint();
    hint.hidden = !visible;
    if (visible) {
      abilityGrid.setAttribute("aria-describedby", builderHintId);
    } else {
      removeElementAttribute(abilityGrid, "aria-describedby");
    }
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
    const character = getCharacter();
    if (!character) return {};
    if (!isRecord(character.abilities)) character.abilities = {};
    return /** @type {Record<string, unknown>} */ (character.abilities);
  }

  /**
   * @returns {Record<string, unknown>}
   */
  function ensureSkillMap() {
    const character = getCharacter();
    if (!character) return {};
    if (!isRecord(character.skills)) character.skills = {};
    return /** @type {Record<string, unknown>} */ (character.skills);
  }

  /**
   * @returns {Record<string, unknown>}
   */
  function ensureCharacterUi() {
    const character = getCharacter();
    if (!character) return {};
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
    const character = getCharacter();
    if (!character) return /** @type {SaveOptionsState} */ ({ misc: { ...DEFAULT_SAVE_MISC }, modToAll: "" });
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
   * @returns {SaveOptionsState}
   */
  function readSaveOptionsShape() {
    const character = getCharacter();
    const source = isRecord(character?.saveOptions) ? character.saveOptions : {};
    const sourceMisc = isRecord(source.misc) ? source.misc : {};
    /** @type {Record<AbilityKey, number>} */
    const misc = { ...DEFAULT_SAVE_MISC };
    for (const key of ABILITY_KEYS) {
      const n = Number(sourceMisc[key] || 0);
      misc[key] = Number.isFinite(n) ? n : 0;
    }
    return /** @type {SaveOptionsState} */ ({
      misc,
      modToAll: typeof source.modToAll === "string" ? source.modToAll : ""
    });
  }

  /**
   * @param {AbilityKey} key
   * @returns {number}
   */
  function readBuilderAbilityAdjustment(key) {
    const character = getCharacter();
    if (!hasValidBuilderAbilityBaseShape(character)) return 0;
    return normalizeCharacterOverrides(character?.overrides).abilities[key] || 0;
  }

  /**
   * @param {AbilityKey} key
   * @param {unknown} rawValue
   * @returns {boolean}
   */
  function updateBuilderAbilityAdjustment(key, rawValue) {
    const character = getCharacter();
    if (!hasValidBuilderAbilityBaseShape(character)) return false;

    const nextValue = Number(rawValue || 0);
    if (!Number.isFinite(nextValue)) return false;

    const currentValue = readBuilderAbilityAdjustment(key);
    if (Object.is(currentValue, nextValue)) return false;

    const updated = mutateCharacter((currentCharacter) => {
      if (!hasValidBuilderAbilityBaseShape(currentCharacter)) return false;
      const panelCharacter = /** @type {Record<string, unknown>} */ (currentCharacter);
      if (!isRecord(panelCharacter.overrides)) panelCharacter.overrides = {};
      const overrides = /** @type {Record<string, unknown>} */ (panelCharacter.overrides);
      if (!isRecord(overrides.abilities)) overrides.abilities = {};
      const abilityOverrides = /** @type {Record<string, unknown>} */ (overrides.abilities);
      abilityOverrides[key] = nextValue;
      return true;
    }, { queueSave: false });

    if (!updated) return false;
    markDirty();
    recalcAllAbilities({ syncFromState: true });
    notifyPanelDataChanged("character-fields", { source: panelSource });
    return true;
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
    const character = getCharacter();
    if (isBuilderCharacter(character)) {
      try {
        const derived = deriveCharacter(character);
        return isFiniteNumber(derived?.proficiencyBonus) ? derived.proficiencyBonus : 0;
      } catch (err) {
        console.warn("Abilities panel builder proficiency derivation failed:", err);
        return 0;
      }
    }

    // charProf is in the Vitals panel — always look it up via document (cross-panel dep).
    // If absent (e.g. embedded combat context with no Vitals panel), fall back to state.
    const profEl = document.getElementById("charProf");
    if (profEl instanceof HTMLInputElement) return Number(profEl.value || 0);
    return Number(getActiveCharacter(/** @type {any} */ (state))?.proficiency || 0);
  }

  /**
   * @param {AbilityKey} key
   * @returns {number}
   */
  function getAbilityModifierForCalculation(key) {
    const builderDisplay = getBuilderAbilityDisplayForKey(key);
    if (builderDisplay) return builderDisplay.modifier;
    return computeAbilityMod(ensureAbilityShape(key).score);
  }

  /**
   * @param {AbilityKey} key
   * @returns {number}
   */
  function getExtraSaveMod(key) {
    const builderDisplay = getBuilderDerivedAbilityDisplay();
    const saveOptions = builderDisplay ? readSaveOptionsShape() : ensureSaveOptionsShape();
    const misc = Number(saveOptions.misc[key] || 0);
    const pick = saveOptions.modToAll;
    if (!isAbilityKey(pick)) return misc;
    return misc + (builderDisplay?.[pick]?.modifier ?? getAbilityModifierForCalculation(pick));
  }

  /**
   * @param {AbilityKey} key
   * @returns {number}
   */
  function computeSaveForAbility(key) {
    const abilityState = ensureAbilityShape(key);
    const mod = getAbilityModifierForCalculation(key);
    return mod + (abilityState.saveProf ? getProfBonus() : 0) + getExtraSaveMod(key);
  }

  /**
   * @param {AbilityKey} key
   * @param {number | string} score
   * @param {number | string} mod
   * @param {number | string} save
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

  /**
   * @param {AbilityKey} key
   * @param {boolean} builderOwned
   */
  function syncLegacyAbilityScoreOwnership(key, builderOwned) {
    const suffix = ABILITY_SUFFIX_BY_KEY[key];
    const scoreEl = getInputById(`ab${suffix}`);
    if (!scoreEl) return;
    scoreEl.disabled = builderOwned;
    scoreEl.readOnly = builderOwned;
    if (builderOwned) {
      scoreEl.setAttribute("aria-readonly", "true");
      scoreEl.setAttribute("title", "Controlled by Builder Abilities.");
    } else {
      removeElementAttribute(scoreEl, "aria-readonly");
      removeElementAttribute(scoreEl, "title");
    }
  }

  /**
   * @param {{ syncFromState?: boolean }} [opts]
   */
  function recalcAllAbilities(opts = {}) {
    syncBuilderHint(isCurrentBuilderCharacter());
    syncAdjustmentControls();
    for (const controller of abilityControllers.values()) {
      controller.recalc({ syncFromState: opts.syncFromState !== false });
    }
  }

  /**
   * @param {AbilityKey} key
   */
  function bindLegacyAbilityScoreField(key) {
    const suffix = ABILITY_SUFFIX_BY_KEY[key];
    const legacyInput = getInputById(`ab${suffix}`);
    if (!legacyInput) return;

    const builderDisplay = getBuilderAbilityDisplayForKey(key);
    const builderOwned = isCurrentBuilderCharacter();
    if (builderOwned) {
      legacyInput.value = builderDisplay ? String(builderDisplay.score) : "";
      syncLegacyAbilityScoreOwnership(key, true);
    } else {
      legacyInput.value = String(ensureAbilityShape(key).score);
      syncLegacyAbilityScoreOwnership(key, false);
    }
    addListener(legacyInput, "input", () => {
      if (destroyed) return;
      const controller = abilityControllers.get(key);
      const ownedDisplay = getBuilderAbilityDisplayForKey(key);
      if (isCurrentBuilderCharacter()) {
        legacyInput.value = ownedDisplay ? String(ownedDisplay.score) : "";
        controller?.recalc({ syncFromState: true });
        return;
      }
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

  const skillsNotesRaw = scope.querySelector("#charSkillsNotes");
  const skillsNotesEl = (skillsNotesRaw instanceof HTMLInputElement || skillsNotesRaw instanceof HTMLTextAreaElement)
    ? skillsNotesRaw : null;
  if (skillsNotesEl) {
    const character = getCharacter();
    skillsNotesEl.value = typeof character?.skillsNotes === "string" ? character.skillsNotes : "";
    addListener(skillsNotesEl, "input", () => {
      if (destroyed) return;
      const updated = mutateCharacter((currentCharacter) => {
        currentCharacter.skillsNotes = skillsNotesEl.value;
        return true;
      }, { queueSave: false });
      if (!updated) return;
      markDirty();
    });
  }

  // charProf is in the Vitals panel — always a cross-panel document lookup.
  // When it is present (character page), bind a live DOM listener.
  // When absent (embedded combat context), subscribe to the vitals channel so
  // proficiency changes from the embedded Vitals panel still trigger recalc.
  const profInput = document.getElementById("charProf");
  if (profInput instanceof HTMLInputElement) {
    addListener(profInput, "input", () => {
      if (destroyed) return;
      recalcAllAbilities({ syncFromState: true });
    });
  } else {
    addDestroy(subscribePanelDataChanged("vitals", () => {
      if (!destroyed) recalcAllAbilities({ syncFromState: true });
    }));
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    addListener(window, ACTIVE_CHARACTER_CHANGED_EVENT, () => {
      if (!destroyed) recalcAllAbilities({ syncFromState: true });
    });
  }

  addDestroy(subscribePanelDataChanged("character-fields", () => {
    if (!destroyed) recalcAllAbilities({ syncFromState: true });
  }));

  (function setupSaveOptionsDropdown() {
    // Use scope (panel root) so both the character page and combat embedded instances
    // each find their own button/menu without conflicting with each other.
    const btn = scope.querySelector("#saveOptionsBtn");
    const menu = scope.querySelector("#saveOptionsMenu");
    if (!(btn instanceof HTMLElement) || !(menu instanceof HTMLElement)) return;

    /** @type {Partial<Record<AbilityKey, HTMLInputElement>>} */
    const miscInputs = {};

    function isBuilderAdjustmentMode() {
      return hasValidBuilderAbilityBaseShape(getCharacter());
    }

    function isMalformedBuilderAdjustmentMode() {
      const character = getCharacter();
      return isBuilderCharacter(character) && !hasValidBuilderAbilityBaseShape(character);
    }

    syncAdjustmentControls = () => {
      const builderAdjustmentMode = isBuilderAdjustmentMode();
      const malformedBuilderMode = isMalformedBuilderAdjustmentMode();
      const saveOptions = readSaveOptionsShape();

      for (const key of ABILITY_KEYS) {
        const input = miscInputs[key];
        if (!input) continue;
        if (builderAdjustmentMode) {
          input.value = String(readBuilderAbilityAdjustment(key));
          input.disabled = false;
          input.readOnly = false;
        } else if (malformedBuilderMode) {
          input.value = "";
          input.disabled = true;
          input.readOnly = true;
        } else {
          input.value = String(Number(saveOptions.misc[key] || 0));
          input.disabled = false;
          input.readOnly = false;
        }
      }
    };

    for (const key of ABILITY_KEYS) {
      const input = scope.querySelector(`#miscSave_${key}`);
      if (!(input instanceof HTMLInputElement)) continue;
      miscInputs[key] = input;
      addListener(input, "input", () => {
        if (destroyed) return;
        if (isBuilderAdjustmentMode()) {
          if (!updateBuilderAbilityAdjustment(key, input.value)) syncAdjustmentControls();
          return;
        }
        if (isMalformedBuilderAdjustmentMode()) {
          syncAdjustmentControls();
          return;
        }
        ensureSaveOptionsShape().misc[key] = Number(input.value || 0);
        recalcAllAbilities();
        markDirty();
      });
    }

    syncAdjustmentControls();

    const select = scope.querySelector("#saveModToAllSelect");
    if (!(select instanceof HTMLSelectElement)) return;
    select.value = readSaveOptionsShape().modToAll || "";
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
   * @returns {(opts?: { markDirty?: boolean, syncFromState?: boolean }) => void}
   */
  function createAbilityRecalc(ability, blockEl, scoreInput, saveProfInput, modEl, saveEl) {
    return ({ markDirty: shouldMarkDirty = false, syncFromState = false } = {}) => {
      if (destroyed) return;

      const builderDisplay = getBuilderAbilityDisplayForKey(ability);
      const builderOwned = isCurrentBuilderCharacter();
      let score;
      let mod;
      if (builderDisplay) {
        score = builderDisplay.score;
        mod = builderDisplay.modifier;
        if (syncFromState) saveProfInput.checked = getAbilitySaveProfForRead(ability);
      } else if (builderOwned) {
        score = null;
        mod = null;
        if (syncFromState) saveProfInput.checked = getAbilitySaveProfForRead(ability);
      } else if (syncFromState) {
        const abilityState = ensureAbilityShape(ability);
        score = abilityState.score;
        mod = computeAbilityMod(score);
        saveProfInput.checked = abilityState.saveProf;
      } else {
        score = Number(scoreInput.value || 10);
        mod = computeAbilityMod(score);
      }
      const save = mod == null
        ? null
        : mod + (saveProfInput.checked ? getProfBonus() : 0) + getExtraSaveMod(ability);

      scoreInput.value = score == null ? "" : String(score);
      scoreInput.disabled = builderOwned;
      scoreInput.readOnly = builderOwned;
      if (builderOwned) {
        scoreInput.setAttribute("aria-readonly", "true");
        scoreInput.setAttribute("aria-describedby", builderHintId);
        scoreInput.setAttribute("title", "Controlled by Builder Abilities.");
      } else {
        removeElementAttribute(scoreInput, "aria-readonly");
        removeElementAttribute(scoreInput, "aria-describedby");
        removeElementAttribute(scoreInput, "title");
      }

      modEl.textContent = mod == null ? "—" : formatSigned(mod);
      saveEl.textContent = save == null ? "—" : formatSigned(save);
      syncLegacyAbilityFields(
        ability,
        score == null ? "" : score,
        mod == null ? "" : mod,
        save == null ? "" : save
      );
      syncLegacyAbilityScoreOwnership(ability, builderOwned);

      for (const valueEl of Array.from(blockEl.querySelectorAll("[data-skill-value]"))) {
        if (!(valueEl instanceof HTMLElement)) continue;
        const skillKey = valueEl.dataset.skillValue;
        if (!skillKey) continue;

        const skillState = ensureSkillState(skillKey);
        if (mod == null) {
          valueEl.textContent = "—";
        } else {
          const total = mod + profAddForLevel(skillState.level, getProfBonus()) + Number(skillState.misc || 0);
          valueEl.textContent = formatSigned(total);
          if (!builderOwned) skillState.value = total;
        }
      }

      if (builderOwned) {
        if (shouldMarkDirty) ensureAbilityRecordForWrite(ability).saveProf = saveProfInput.checked;
      } else {
        const abilityState = ensureAbilityShape(ability);
        abilityState.score = score;
        abilityState.saveProf = saveProfInput.checked;
      }

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

    const builderDisplay = getBuilderAbilityDisplayForKey(ability);
    if (builderDisplay) {
      scoreInput.value = String(builderDisplay.score);
      saveProfInput.checked = getAbilitySaveProfForRead(ability);
    } else if (isCurrentBuilderCharacter()) {
      scoreInput.value = "";
      saveProfInput.checked = getAbilitySaveProfForRead(ability);
    } else {
      const abilityState = ensureAbilityShape(ability);
      scoreInput.value = String(abilityState.score);
      saveProfInput.checked = abilityState.saveProf;
    }

    const recalc = createAbilityRecalc(
      ability,
      blockEl,
      scoreInput,
      saveProfInput,
      modEl,
      saveEl
    );

    addListener(scoreInput, "input", () => {
      if (isCurrentBuilderCharacter()) {
        recalc({ syncFromState: true });
        return;
      }
      recalc({ markDirty: true });
    });
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

    recalc({ syncFromState: true });
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

    mutateCharacter((character) => {
      const panelCharacter = /** @type {CharacterPanelState} */ (character);
      if (!isRecord(panelCharacter.ui)) panelCharacter.ui = {};
      const ui = /** @type {Record<string, unknown>} */ (panelCharacter.ui);
      const currentOrder = Array.isArray(ui.abilityOrder)
        ? ui.abilityOrder.filter((value) => typeof value === "string")
        : [];
      const defaultSet = new Set(defaultOrder);
      const cleaned = currentOrder.filter((key) => defaultSet.has(key));
      for (const key of defaultOrder) {
        if (!cleaned.includes(key)) cleaned.push(key);
      }
      ui.abilityOrder = cleaned;
      return true;
    }, { queueSave: false });

    const applyOrder = () => {
      const ui = ensureCharacterUi();
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
      const ui = ensureCharacterUi();
      const order = Array.isArray(ui.abilityOrder) ? ui.abilityOrder : [];
      const from = order.indexOf(key);
      const to = from + dir;
      if (from === -1 || to < 0 || to >= order.length) return;

      const adjacentKey = order[to];
      const movedEl = abilityGrid.querySelector(`.abilityBlock[data-ability="${key}"]`);
      const adjacentEl = abilityGrid.querySelector(`.abilityBlock[data-ability="${adjacentKey}"]`);

      const moved = mutateCharacter((character) => {
        const panelCharacter = /** @type {CharacterPanelState} */ (character);
        if (!isRecord(panelCharacter.ui)) return false;
        const freshOrder = Array.isArray(panelCharacter.ui.abilityOrder) ? panelCharacter.ui.abilityOrder : [];
        const freshFrom = freshOrder.indexOf(key);
        const freshTo = freshFrom + dir;
        if (freshFrom === -1 || freshTo < 0 || freshTo >= freshOrder.length) return false;
        [freshOrder[freshFrom], freshOrder[freshTo]] = [freshOrder[freshTo], freshOrder[freshFrom]];
        return true;
      }, { queueSave: false });
      if (!moved) return;
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
  recalcAllAbilities({ syncFromState: true });

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
