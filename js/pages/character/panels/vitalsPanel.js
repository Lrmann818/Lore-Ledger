// js/pages/character/panels/vitalsPanel.js
// Character page Vitals panel (Vitals numbers + resource trackers)

import { numberOrNull } from "../../../utils/number.js";
import { safeAsync } from "../../../ui/safeAsync.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { requireMany, getNoopDestroyApi } from "../../../utils/domGuards.js";
import { flipSwapTwo } from "../../../ui/flipSwap.js";
import { getActiveCharacter, isBuilderCharacter } from "../../../domain/characterHelpers.js";
import { deriveCharacter } from "../../../domain/rules/deriveCharacter.js";
import { notifyPanelDataChanged, subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";

function notifyStatus(setStatus, message) {
  if (typeof setStatus === "function") {
    setStatus(message);
    return;
  }
  console.warn(message);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

const BUILDER_OWNED_VITAL_NUMBER_IDS = new Set(["hitDieAmt", "hitDieSize", "charSpeed", "charProf", "charInit"]);
const BREATH_WEAPON_DC_VITAL_KEY = "breathWeaponDC";
const RESOURCE_RECOVERY_OPTIONS = Object.freeze([
  { value: "manual", label: "Manual" },
  { value: "shortRest", label: "Short Rest" },
  { value: "longRest", label: "Long Rest" },
  { value: "shortOrLongRest", label: "Short or Long Rest" },
  { value: "none", label: "Does not recover on rest" }
]);
const RESOURCE_RECOVERY_VALUES = new Set(RESOURCE_RECOVERY_OPTIONS.map((option) => option.value));
const RESOURCE_LONG_PRESS_MS = 550;
const RESOURCE_LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const RESOURCE_INTERACTIVE_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "a[href]",
  "[contenteditable='true']",
  "[role='button']",
  "[role='textbox']",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

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
    const active = getActiveCharacter(state);
    const order = Array.isArray(active?.ui?.vitalsOrder) ? active.ui.vitalsOrder : defaultOrder;
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
    root = document,
    selectors = {},
    autoSizeInput,
    enhanceNumberSteppers,
    uiConfirm,
    setStatus,
  } = deps;

  if (!state || !SaveManager) return getNoopDestroyApi();
  if (!getActiveCharacter(state)) return getNoopDestroyApi();
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
    charSpellDC: "#charSpellDC",
    charStatus: "#charStatus",
    ...selectors
  };
  const guard = requireMany(required, { root, setStatus, context: "Vitals panel" });
  if (!guard.ok) return guard.destroy;
  const { panelEl, wrap, addBtn } = guard.els;
  const deathSaveSuccesses = root.querySelector(selectors.charDeathSaveSuccesses || "#charDeathSaveSuccesses");
  const deathSaveFailures = root.querySelector(selectors.charDeathSaveFailures || "#charDeathSaveFailures");
  if (deathSaveSuccesses) guard.els.charDeathSaveSuccesses = deathSaveSuccesses;
  if (deathSaveFailures) guard.els.charDeathSaveFailures = deathSaveFailures;

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
  let resourceSettingsOverlay = null;
  let pendingResourceLongPress = null;

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

  function markVitalsChanged() {
    markDirty();
    notifyPanelDataChanged("vitals", { source: panelInstance });
  }

  function markCharacterFieldsChanged() {
    markDirty();
    notifyPanelDataChanged("character-fields", { source: panelInstance });
  }

  function getCurrentCharacter() {
    return getActiveCharacter(state);
  }

  function getBuilderDerivedVitals(character) {
    if (!isBuilderCharacter(character)) return null;
    try {
      const derived = deriveCharacter(character);
      return {
        speed: isFiniteNumber(derived?.vitals?.speed) ? derived.vitals.speed : null,
        hitDieAmt: isFiniteNumber(derived?.vitals?.hitDieAmt) ? derived.vitals.hitDieAmt : null,
        hitDieSize: isFiniteNumber(derived?.vitals?.hitDieSize) ? derived.vitals.hitDieSize : null,
        proficiency: isFiniteNumber(derived?.proficiencyBonus) ? derived.proficiencyBonus : null,
        initiative: isFiniteNumber(derived?.initiative) ? derived.initiative : null,
        breathWeaponDC: isFiniteNumber(derived?.dragonbornAncestry?.breathWeapon?.saveDC)
          ? derived.dragonbornAncestry.breathWeapon.saveDC
          : null
      };
    } catch (err) {
      console.warn("Vitals panel builder derivation failed:", err);
      return null;
    }
  }

  /**
   * @param {"speed" | "hitDieAmt" | "hitDieSize" | "proficiency" | "initiative" | "breathWeaponDC"} key
   * @returns {number | null}
   */
  function getBuilderDerivedVitalValue(key) {
    const character = getCurrentCharacter();
    const vitals = getBuilderDerivedVitals(character);
    return vitals ? vitals[key] : null;
  }

  function getSpeedDisplayValue() {
    const character = getCurrentCharacter();
    if (isBuilderCharacter(character)) return getBuilderDerivedVitalValue("speed");
    return character?.speed;
  }

  // Initiative is live-derived from Dex (plus any initiative overrides/feat
  // effects) for builder characters — like speed and proficiency, it is a pure
  // function of the build and stays read-only so it can't desync. Freeform
  // characters keep their manually-entered initiative field.
  function getInitiativeDisplayValue() {
    const character = getCurrentCharacter();
    if (isBuilderCharacter(character)) return getBuilderDerivedVitalValue("initiative");
    return character?.initiative;
  }

  function getHitDieAmtDisplayValue() {
    const character = getCurrentCharacter();
    if (isBuilderCharacter(character)) return getBuilderDerivedVitalValue("hitDieAmt");
    return character?.hitDieAmt;
  }

  function getHitDieSizeDisplayValue() {
    const character = getCurrentCharacter();
    if (isBuilderCharacter(character)) return getBuilderDerivedVitalValue("hitDieSize");
    return character?.hitDieSize;
  }

  function getProficiencyDisplayValue() {
    const character = getCurrentCharacter();
    if (isBuilderCharacter(character)) return getBuilderDerivedVitalValue("proficiency");
    return character?.proficiency;
  }

  function setBuilderOwnedVitalState(input, owned) {
    input.readOnly = owned;
    input.disabled = owned;
    if (owned) {
      input.setAttribute("readonly", "");
      input.setAttribute("aria-readonly", "true");
      input.dataset.builderOwned = "true";
      input.title = "Controlled by Builder Identity.";
      return;
    }
    input.removeAttribute("readonly");
    input.removeAttribute("aria-readonly");
    delete input.dataset.builderOwned;
    if (input.title === "Controlled by Builder Identity.") input.title = "";
  }

  /** @type {Array<{ id: string, path: string | readonly unknown[], getValue: () => unknown, normalizeInput?: (value: unknown) => number | null }>} */
  const vitalNumberFields = [
    { id: "charHpCur", path: "hpCur", getValue: () => getCurrentCharacter()?.hpCur },
    { id: "charHpMax", path: "hpMax", getValue: () => getCurrentCharacter()?.hpMax },
    { id: "hitDieAmt", path: "hitDieAmt", getValue: getHitDieAmtDisplayValue },
    { id: "hitDieSize", path: "hitDieSize", getValue: getHitDieSizeDisplayValue },
    { id: "charAC", path: "ac", getValue: () => getCurrentCharacter()?.ac },
    { id: "charInit", path: "initiative", getValue: getInitiativeDisplayValue },
    { id: "charSpeed", path: "speed", getValue: getSpeedDisplayValue },
    { id: "charProf", path: "proficiency", getValue: getProficiencyDisplayValue },
    { id: "charSpellAtk", path: "spellAttack", getValue: () => getCurrentCharacter()?.spellAttack },
    { id: "charSpellDC", path: "spellDC", getValue: () => getCurrentCharacter()?.spellDC },
  ];
  if (deathSaveSuccesses && deathSaveFailures) {
    vitalNumberFields.splice(2, 0,
      {
        id: "charDeathSaveSuccesses",
        path: ["deathSaves", "successes"],
        getValue: () => Math.max(0, Math.min(3, Number(getCurrentCharacter()?.deathSaves?.successes) || 0)),
        normalizeInput: (value) => Math.max(0, Math.min(3, Math.floor(Number(value) || 0)))
      },
      {
        id: "charDeathSaveFailures",
        path: ["deathSaves", "failures"],
        getValue: () => Math.max(0, Math.min(3, Number(getCurrentCharacter()?.deathSaves?.failures) || 0)),
        normalizeInput: (value) => Math.max(0, Math.min(3, Math.floor(Number(value) || 0)))
      }
    );
  }

  function refreshVitalNumberField(id, getValue) {
    const el = guard.els[id];
    if (!el) return;

    const autosizeOpts = { min: 30, max: 60 };
    const value = getValue();
    if (BUILDER_OWNED_VITAL_NUMBER_IDS.has(id)) {
      setBuilderOwnedVitalState(el, isBuilderCharacter(getCurrentCharacter()));
    }
    el.value = (value === null || value === undefined) ? "" : String(value);

    if (typeof autoSizeInput === "function") {
      el.classList.add("autosize");
      autoSizeInput(el, autosizeOpts);
    }
  }

  function refreshProficiencyField() {
    refreshVitalNumberField("charProf", getProficiencyDisplayValue);
  }

  function getBreathWeaponDCValue() {
    const value = getBuilderDerivedVitalValue("breathWeaponDC");
    return isFiniteNumber(value) ? value : null;
  }

  function renderBreathWeaponDCTile() {
    const existing = wrap.querySelector(`.charTile[data-vital-key="${BREATH_WEAPON_DC_VITAL_KEY}"]`);
    const saveDC = getBreathWeaponDCValue();

    if (saveDC == null) {
      existing?.remove();
      return;
    }

    const tile = existing || document.createElement("div");
    if (!existing) {
      tile.className = "charTile builderDerivedVitalTile";
      tile.dataset.vitalKey = BREATH_WEAPON_DC_VITAL_KEY;

      const label = document.createElement("div");
      label.className = "charTileLabel";
      label.textContent = "Breath Weapon DC";
      tile.appendChild(label);

      const value = document.createElement("div");
      value.className = "builderDerivedVitalValue";
      value.setAttribute("aria-readonly", "true");
      tile.appendChild(value);

      wrap.appendChild(tile);
    }

    const valueEl = tile.querySelector(".builderDerivedVitalValue");
    if (valueEl) valueEl.textContent = String(saveDC);
  }

  function refreshBuilderOwnedVitalNumberFields() {
    const shouldRefreshBuilderOwnedVitals = isBuilderCharacter(getCurrentCharacter()) ||
      guard.els.hitDieAmt?.dataset.builderOwned === "true" ||
      guard.els.hitDieSize?.dataset.builderOwned === "true" ||
      guard.els.charSpeed?.dataset.builderOwned === "true" ||
      guard.els.charInit?.dataset.builderOwned === "true";
    if (shouldRefreshBuilderOwnedVitals) {
      refreshVitalNumberField("hitDieAmt", getHitDieAmtDisplayValue);
      refreshVitalNumberField("hitDieSize", getHitDieSizeDisplayValue);
      refreshVitalNumberField("charSpeed", getSpeedDisplayValue);
      refreshVitalNumberField("charInit", getInitiativeDisplayValue);
    }
    refreshProficiencyField();
  }

  function refreshVitalsNumbers() {
    vitalNumberFields.forEach(({ id, getValue }) => {
      refreshVitalNumberField(id, getValue);
    });
    renderBreathWeaponDCTile();
  }

  function bindVitalsNumbers() {
    refreshVitalsNumbers();

    vitalNumberFields.forEach(({ id, path, getValue, normalizeInput }) => {
      const el = guard.els[id];
      if (!el) return;

      const autosizeOpts = { min: 30, max: 60 };

      addListener(el, "input", () => {
        if (destroyed) return;
        if (BUILDER_OWNED_VITAL_NUMBER_IDS.has(id) && isBuilderCharacter(getCurrentCharacter())) {
          refreshVitalNumberField(id, getValue);
          return;
        }
        const nextValue = typeof normalizeInput === "function" ? normalizeInput(el.value) : numberOrNull(el.value);
        const currentValue = getValue();
        if ((currentValue ?? null) === nextValue) {
          if (typeof autoSizeInput === "function") autoSizeInput(el, autosizeOpts);
          return;
        }
        const updated = updateCharacterField(path, nextValue, { queueSave: false });
        if (!updated) return;
        if (typeof autoSizeInput === "function") autoSizeInput(el, autosizeOpts);
        markVitalsChanged();
      });
    });
  }

  function refreshStatusField() {
    const el = guard.els.charStatus;
    if (!el) return;
    if (document.activeElement === el) return;
    el.value = getCurrentCharacter()?.status ?? "";
    if (typeof autoSizeInput === "function") autoSizeInput(el, { min: 60, max: 300 });
  }

  function bindStatusField() {
    refreshStatusField();
    const el = guard.els.charStatus;
    if (!el) return;
    if (typeof autoSizeInput === "function") {
      el.classList.add("autosize");
      autoSizeInput(el, { min: 60, max: 300 });
    }
    addListener(el, "input", () => {
      if (destroyed) return;
      const nextValue = el.value;
      const currentValue = getCurrentCharacter()?.status ?? "";
      if (currentValue === nextValue) return;
      const updated = updateCharacterField("status", nextValue, { queueSave: false });
      if (!updated) return;
      if (typeof autoSizeInput === "function") autoSizeInput(el, { min: 60, max: 300 });
      markCharacterFieldsChanged();
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

  function getResourceIndex(resourceId, fallbackIndex) {
    const resources = getCurrentCharacter()?.resources;
    if (!Array.isArray(resources)) return -1;
    if (resourceId) {
      const byId = resources.findIndex((item) => item?.id === resourceId);
      if (byId !== -1) return byId;
    }
    return Number.isInteger(fallbackIndex) && fallbackIndex >= 0 && fallbackIndex < resources.length
      ? fallbackIndex
      : -1;
  }

  function getResourceLabel(resource, fallbackIndex) {
    const name = String(resource?.name ?? "").trim();
    return name || `Resource ${fallbackIndex + 1}`;
  }

  function normalizeRecoveryValue(value) {
    return RESOURCE_RECOVERY_VALUES.has(value) ? value : "manual";
  }

  function isInteractiveResourceTarget(target, tile) {
    if (!(target instanceof HTMLElement)) return false;
    const interactive = target.closest(RESOURCE_INTERACTIVE_SELECTOR);
    return !!interactive && interactive !== tile;
  }

  function ensureResourceSettingsDialog() {
    if (resourceSettingsOverlay && document.contains(resourceSettingsOverlay)) return resourceSettingsOverlay;

    const overlay = document.createElement("div");
    overlay.id = "resourceRecoveryDialogOverlay";
    overlay.className = "modalOverlay resourceRecoveryDialogOverlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");

    const panel = document.createElement("div");
    panel.className = "modalPanel resourceRecoveryDialogPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "resourceRecoveryDialogTitle");
    panel.setAttribute("tabindex", "-1");

    const header = document.createElement("div");
    header.className = "uiDialogHeader";

    const title = document.createElement("div");
    title.className = "modalTitle";
    title.id = "resourceRecoveryDialogTitle";
    title.textContent = "Resource Settings";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "npcSmallBtn";
    close.dataset.resourceRecoveryCancel = "true";
    close.setAttribute("aria-label", "Close Resource Settings");
    close.textContent = "X";

    header.appendChild(title);
    header.appendChild(close);

    const body = document.createElement("div");
    body.className = "uiDialogBody resourceRecoveryDialogBody";

    const nameField = document.createElement("div");
    nameField.className = "resourceRecoveryField";

    const nameLabel = document.createElement("div");
    nameLabel.className = "modalLabel";
    nameLabel.textContent = "Resource";

    const nameValue = document.createElement("div");
    nameValue.className = "resourceRecoveryName";
    nameValue.dataset.resourceRecoveryName = "true";

    nameField.appendChild(nameLabel);
    nameField.appendChild(nameValue);

    const recoveryField = document.createElement("label");
    recoveryField.className = "resourceRecoveryField";
    recoveryField.setAttribute("for", "resourceRecoverySelect");

    const recoveryLabel = document.createElement("span");
    recoveryLabel.className = "modalLabel";
    recoveryLabel.textContent = "Recovery";

    const select = document.createElement("select");
    select.id = "resourceRecoverySelect";
    select.className = "settingsSelect resourceRecoverySelect";
    RESOURCE_RECOVERY_OPTIONS.forEach((option) => {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = option.label;
      select.appendChild(el);
    });

    recoveryField.appendChild(recoveryLabel);
    recoveryField.appendChild(select);

    body.appendChild(nameField);
    body.appendChild(recoveryField);

    const footer = document.createElement("div");
    footer.className = "uiDialogFooter";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "npcSmallBtn";
    cancel.dataset.resourceRecoveryCancel = "true";
    cancel.textContent = "Cancel";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "npcSmallBtn";
    save.dataset.resourceRecoverySave = "true";
    save.textContent = "Save";

    footer.appendChild(cancel);
    footer.appendChild(save);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    resourceSettingsOverlay = overlay;
    return overlay;
  }

  function closeResourceSettingsDialog({ restoreFocus = true } = {}) {
    const overlay = resourceSettingsOverlay;
    if (!overlay || overlay.hidden) return;
    const openerResourceId = overlay.dataset.resourceId || "";
    const openerResourceIndex = Number(overlay.dataset.resourceIndex);
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    delete overlay.dataset.resourceId;
    delete overlay.dataset.resourceIndex;
    if (!restoreFocus) return;
    requestAnimationFrame(() => {
      if (destroyed) return;
      const opener = Array.from(wrap.querySelectorAll(".resourceTile")).find((tile) => {
        if (!(tile instanceof HTMLElement)) return false;
        if (openerResourceId) return tile.dataset.resourceId === openerResourceId;
        return Number(tile.dataset.resourceIndex) === openerResourceIndex;
      });
      try { opener?.focus?.({ preventScroll: true }); } catch { opener?.focus?.(); }
    });
  }

  function openResourceSettingsDialog(resourceId, fallbackIndex, opener = null) {
    if (destroyed) return;
    const index = getResourceIndex(resourceId, fallbackIndex);
    const resource = getCurrentCharacter()?.resources?.[index];
    if (!resource) return;

    const overlay = ensureResourceSettingsDialog();
    const nameEl = overlay.querySelector("[data-resource-recovery-name]");
    const select = overlay.querySelector("#resourceRecoverySelect");
    if (!(select instanceof HTMLSelectElement)) return;

    overlay.dataset.resourceId = resource?.id ? String(resource.id) : "";
    overlay.dataset.resourceIndex = String(index);
    if (nameEl) nameEl.textContent = getResourceLabel(resource, index);
    select.value = normalizeRecoveryValue(resource.recovery);

    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    try { select.focus({ preventScroll: true }); } catch { select.focus(); }
  }

  function saveResourceSettingsDialog() {
    const overlay = resourceSettingsOverlay;
    if (!overlay || overlay.hidden) return;
    const select = overlay.querySelector("#resourceRecoverySelect");
    if (!(select instanceof HTMLSelectElement)) return;
    const resourceId = overlay.dataset.resourceId || "";
    const fallbackIndex = Number(overlay.dataset.resourceIndex);
    const nextRecovery = normalizeRecoveryValue(select.value);
    const updated = mutateCharacter((character) => {
      const resources = Array.isArray(character.resources) ? character.resources : [];
      let index = -1;
      if (resourceId) index = resources.findIndex((item) => item?.id === resourceId);
      if (index === -1 && Number.isInteger(fallbackIndex)) index = fallbackIndex;
      const resource = resources[index];
      if (!resource) return false;
      if (resource.recovery === nextRecovery) return false;
      resource.recovery = nextRecovery;
      return true;
    }, { queueSave: false });
    if (updated) markVitalsChanged();
    closeResourceSettingsDialog();
  }

  function cancelPendingResourceLongPress() {
    if (!pendingResourceLongPress) return;
    clearTimeout(pendingResourceLongPress.timer);
    pendingResourceLongPress = null;
  }

  function startResourceLongPress(event, tile) {
    cancelPendingResourceLongPress();
    const pointerEvent = /** @type {PointerEvent} */ (event);
    const startX = Number.isFinite(pointerEvent.clientX) ? pointerEvent.clientX : 0;
    const startY = Number.isFinite(pointerEvent.clientY) ? pointerEvent.clientY : 0;
    const resourceId = tile.dataset.resourceId || "";
    const resourceIndex = Number(tile.dataset.resourceIndex);
    pendingResourceLongPress = {
      tile,
      resourceId,
      resourceIndex,
      startX,
      startY,
      timer: setTimeout(() => {
        pendingResourceLongPress = null;
        openResourceSettingsDialog(resourceId, resourceIndex, tile);
      }, RESOURCE_LONG_PRESS_MS)
    };
  }

  function handleResourcePointerMove(event) {
    if (!pendingResourceLongPress) return;
    const pointerEvent = /** @type {PointerEvent} */ (event);
    const x = Number.isFinite(pointerEvent.clientX) ? pointerEvent.clientX : pendingResourceLongPress.startX;
    const y = Number.isFinite(pointerEvent.clientY) ? pointerEvent.clientY : pendingResourceLongPress.startY;
    const moved = Math.hypot(x - pendingResourceLongPress.startX, y - pendingResourceLongPress.startY);
    if (moved > RESOURCE_LONG_PRESS_MOVE_TOLERANCE_PX) cancelPendingResourceLongPress();
  }

  function ensureVitalsTip() {
    if (panelEl.querySelector(".vitalsResourceTip")) return;
    const tip = document.createElement("div");
    tip.className = "mutedSmall vitalsResourceTip";
    tip.textContent = "Tip: press and hold a resource tile to choose how it recovers on rests.";
    wrap.insertAdjacentElement?.("afterend", tip) || panelEl.appendChild(tip);
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

    const currentOrder = getCurrentCharacter()?.ui?.vitalsOrder;
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
    markVitalsChanged();

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
    const currentCharacter = getCurrentCharacter();
    if (!currentCharacter) return;

    Array.from(wrap.querySelectorAll('.charTile[data-vital-key^="res:"]')).forEach((el) => el.remove());
    renderBreathWeaponDCTile();

    const resources = Array.isArray(currentCharacter.resources) ? currentCharacter.resources : [];
    resources.forEach((r, idx) => {
      const tile = document.createElement("div");
      tile.className = "charTile resourceTile";
      if (r.id) tile.dataset.resourceId = r.id;
      tile.dataset.resourceIndex = String(idx);
      tile.dataset.vitalKey = `res:${r.id || idx}`;
      tile.tabIndex = 0;
      tile.setAttribute("tabindex", "0");
      tile.setAttribute("role", "button");
      tile.setAttribute("aria-label", `Open recovery settings for ${getResourceLabel(r, idx)}`);

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
        const nextName = title.textContent ?? "";
        const updated = mutateCharacter((character) => {
          const resource = character.resources?.find((item) => item?.id === r.id);
          if (!resource) return false;
          if ((resource.name ?? "") === nextName) return false;
          resource.name = nextName;
          return true;
        }, { queueSave: false });
        if (!updated) return;
        markVitalsChanged();
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
      del.disabled = resources.length <= 1;
      addListener(
        del,
        "click",
        safeAsync(async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const currentResources = getCurrentCharacter()?.resources;
          if (!Array.isArray(currentResources) || currentResources.length <= 1) return;
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
          markVitalsChanged();
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
        const nextCur = numberOrNull(cur.value);
        const updated = mutateCharacter((character) => {
          const resource = character.resources?.find((item) => item?.id === r.id);
          if (!resource) return false;
          if ((resource.cur ?? null) === nextCur) return false;
          resource.cur = nextCur;
          return true;
        }, { queueSave: false });
        if (!updated) return;
        autoSizeInput?.(cur, { min: 30, max: 60 });
        markVitalsChanged();
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
        const nextMax = numberOrNull(max.value);
        const updated = mutateCharacter((character) => {
          const resource = character.resources?.find((item) => item?.id === r.id);
          if (!resource) return false;
          if ((resource.max ?? null) === nextMax) return false;
          resource.max = nextMax;
          return true;
        }, { queueSave: false });
        if (!updated) return;
        autoSizeInput?.(max, { min: 30, max: 60 });
        markVitalsChanged();
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
    ensureVitalsTip();
    setupVitalsTileReorder({
      state,
      SaveManager,
      panelEl,
      gridEl: wrap,
      actions: { updateCharacterField, mutateCharacter }
    });
  }

  bindVitalsNumbers();
  bindStatusField();

  addListener(addBtn, "click", () => {
    if (destroyed) return;
    ensureResourceArray();
    mutateCharacter((character) => {
      character.resources.push(newResource());
      return true;
    }, { queueSave: false });
    markVitalsChanged();
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

  addListener(wrap, "keydown", (event) => {
    if (destroyed) return;
    const e = /** @type {KeyboardEvent} */ (event);
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const tile = target.closest(".resourceTile");
    if (!(tile instanceof HTMLElement) || target !== tile) return;
    e.preventDefault();
    openResourceSettingsDialog(tile.dataset.resourceId || "", Number(tile.dataset.resourceIndex), tile);
  });

  addListener(wrap, "pointerdown", (event) => {
    if (destroyed) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const tile = target.closest(".resourceTile");
    if (!(tile instanceof HTMLElement)) return;
    if (isInteractiveResourceTarget(target, tile)) return;
    startResourceLongPress(event, tile);
  });
  addListener(wrap, "pointermove", handleResourcePointerMove);
  addListener(wrap, "pointerup", cancelPendingResourceLongPress);
  addListener(wrap, "pointercancel", cancelPendingResourceLongPress);
  addListener(wrap, "pointerleave", cancelPendingResourceLongPress);

  addListener(document, "keydown", (event) => {
    const e = /** @type {KeyboardEvent} */ (event);
    if (e.key !== "Escape") return;
    if (!resourceSettingsOverlay || resourceSettingsOverlay.hidden) return;
    e.preventDefault();
    closeResourceSettingsDialog();
  });

  addListener(document, "click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!resourceSettingsOverlay || resourceSettingsOverlay.hidden) return;
    if (target.closest("[data-resource-recovery-cancel]")) {
      event.preventDefault();
      closeResourceSettingsDialog();
      return;
    }
    if (target.closest("[data-resource-recovery-save]")) {
      event.preventDefault();
      saveResourceSettingsDialog();
    }
  });

  setupVitalsTileReorder({
    state,
    SaveManager,
    panelEl,
    gridEl: wrap,
    actions: { updateCharacterField, mutateCharacter }
  });
  renderResources();

  addDestroy(subscribePanelDataChanged("vitals", (detail) => {
    if (destroyed || detail.source === panelInstance) return;
    refreshVitalsNumbers();
    renderResources();
  }));

  addDestroy(subscribePanelDataChanged("character-fields", (detail) => {
    if (destroyed || detail.source === panelInstance) return;
    refreshBuilderOwnedVitalNumberFields();
    renderBreathWeaponDCTile();
    setupVitalsTileReorder({
      state,
      SaveManager,
      panelEl,
      gridEl: wrap,
      actions: { updateCharacterField, mutateCharacter }
    });
    refreshStatusField();
  }));

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (let i = destroyFns.length - 1; i >= 0; i--) {
        destroyFns[i]?.();
      }
      cancelPendingResourceLongPress();
      resourceSettingsOverlay?.remove?.();
      resourceSettingsOverlay = null;
    }
  };
}
