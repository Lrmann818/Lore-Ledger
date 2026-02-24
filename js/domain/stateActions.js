// @ts-nocheck
// Centralized, lightweight state mutation helpers.
import { withAllowedStateMutation } from "../utils/dev.js";

const TRACKER_CARD_LIST_BY_TYPE = Object.freeze({
  party: "party",
  npc: "npcs",
  npcs: "npcs",
  location: "locationsList",
  locations: "locationsList",
  locationslist: "locationsList",
});

const BLOCKED_PATH_SEGMENTS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
]);

function toPathSegments(path) {
  if (Array.isArray(path)) {
    const segments = path
      .map((seg) => String(seg ?? "").trim())
      .filter(Boolean);
    const blocked = segments.find(
      (seg) => BLOCKED_PATH_SEGMENTS.has(seg),
    );
    if (blocked) {
      throw new Error(`Unsafe path segment "${blocked}" in path "${JSON.stringify(path)}"`);
    }
    return segments;
  }
  if (typeof path !== "string") return [];
  const segments = path
    .split(".")
    .map((seg) => seg.trim())
    .filter(Boolean);
  const blocked = segments.find(
    (seg) => BLOCKED_PATH_SEGMENTS.has(seg),
  );
  if (blocked) {
    throw new Error(`Unsafe path segment "${blocked}" in path "${String(path)}"`);
  }
  return segments;
}

function setPathValue(target, path, value) {
  const segments = toPathSegments(path);
  if (!target || typeof target !== "object" || segments.length === 0) return false;

  let cur = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    if (!cur[key] || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key];
  }

  cur[segments[segments.length - 1]] = value;
  return true;
}

function resolveTrackerListKey(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return TRACKER_CARD_LIST_BY_TYPE[normalized] || null;
}

function ensureTrackerList(state, listKey) {
  if (!state.tracker || typeof state.tracker !== "object") state.tracker = {};
  if (!Array.isArray(state.tracker[listKey])) state.tracker[listKey] = [];
  return state.tracker[listKey];
}

function maybeQueueSave(SaveManager, options) {
  if (options?.queueSave === false) return;
  // SaveManager.markDirty() is this app's queue-save mechanism.
  SaveManager?.markDirty?.();
}

export function createStateActions({ state, SaveManager } = {}) {
  if (!state || typeof state !== "object") {
    throw new Error("createStateActions: state is required");
  }

  function mutateState(mutator, options = {}) {
    if (typeof mutator !== "function") return false;
    const result = withAllowedStateMutation(() => {
      return mutator(state);
    });
    if (result === false) return false;
    maybeQueueSave(SaveManager, options);
    return result;
  }

  function mutateCharacter(mutator, options = {}) {
    if (typeof mutator !== "function") return false;
    const result = withAllowedStateMutation(() => {
      if (!state.character || typeof state.character !== "object") state.character = {};
      return mutator(state.character, state);
    });
    if (result === false) return false;
    maybeQueueSave(SaveManager, options);
    return result;
  }

  function mutateTracker(mutator, options = {}) {
    if (typeof mutator !== "function") return false;
    const result = withAllowedStateMutation(() => {
      if (!state.tracker || typeof state.tracker !== "object") state.tracker = {};
      return mutator(state.tracker, state);
    });
    if (result === false) return false;
    maybeQueueSave(SaveManager, options);
    return result;
  }

  function setPath(path, value, options = {}) {
    const updated = withAllowedStateMutation(() => {
      return setPathValue(state, path, value);
    });
    if (!updated) return false;
    maybeQueueSave(SaveManager, options);
    return true;
  }

  function updateCharacterField(path, value, options = {}) {
    const updated = withAllowedStateMutation(() => {
      if (!state.character || typeof state.character !== "object") state.character = {};
      return setPathValue(state.character, path, value);
    });
    if (!updated) return false;
    maybeQueueSave(SaveManager, options);
    return true;
  }

  function updateTrackerField(path, value, options = {}) {
    const updated = withAllowedStateMutation(() => {
      if (!state.tracker || typeof state.tracker !== "object") state.tracker = {};
      return setPathValue(state.tracker, path, value);
    });
    if (!updated) return false;
    maybeQueueSave(SaveManager, options);
    return true;
  }

  function updateMapField(path, value, options = {}) {
    const updated = withAllowedStateMutation(() => {
      if (!state.map || typeof state.map !== "object") state.map = {};
      return setPathValue(state.map, path, value);
    });
    if (!updated) return false;
    maybeQueueSave(SaveManager, options);
    return true;
  }

  function updateTrackerCardField(type, id, field, value, options = {}) {
    const listKey = resolveTrackerListKey(type);
    if (!listKey) return false;

    const updated = withAllowedStateMutation(() => {
      const list = ensureTrackerList(state, listKey);
      const card = list.find((item) => item && item.id === id);
      if (!card || typeof card !== "object") return false;
      return setPathValue(card, field, value);
    });
    if (!updated) return false;
    maybeQueueSave(SaveManager, options);
    return true;
  }

  function addTrackerCard(type, card, options = {}) {
    const listKey = resolveTrackerListKey(type);
    if (!listKey) return false;

    withAllowedStateMutation(() => {
      const list = ensureTrackerList(state, listKey);
      if (options?.atStart) list.unshift(card);
      else list.push(card);
    });

    maybeQueueSave(SaveManager, options);
    return true;
  }

  function removeTrackerCard(type, id, options = {}) {
    const listKey = resolveTrackerListKey(type);
    if (!listKey) return null;

    const removed = withAllowedStateMutation(() => {
      const list = ensureTrackerList(state, listKey);
      const idx = list.findIndex((item) => item && item.id === id);
      if (idx === -1) return null;
      const [taken] = list.splice(idx, 1);
      return taken;
    });
    if (!removed) return null;
    maybeQueueSave(SaveManager, options);
    return removed;
  }

  function swapTrackerCards(type, aId, bId, options = {}) {
    const listKey = resolveTrackerListKey(type);
    if (!listKey) return false;

    const didSwap = withAllowedStateMutation(() => {
      const list = ensureTrackerList(state, listKey);
      const aIdx = list.findIndex((item) => item && item.id === aId);
      const bIdx = list.findIndex((item) => item && item.id === bId);
      if (aIdx === -1 || bIdx === -1 || aIdx === bIdx) return false;
      const tmp = list[aIdx];
      list[aIdx] = list[bIdx];
      list[bIdx] = tmp;
      return true;
    });
    if (!didSwap) return false;

    maybeQueueSave(SaveManager, options);
    return true;
  }

  function setCardPortraitHidden(type, id, hidden, options = {}) {
    return updateTrackerCardField(type, id, "portraitHidden", !!hidden, options);
  }

  return {
    mutateState,
    mutateCharacter,
    mutateTracker,
    setPath,
    updateCharacterField,
    updateTrackerField,
    updateMapField,
    updateTrackerCardField,
    setCardPortraitHidden,
    addTrackerCard,
    removeTrackerCard,
    swapTrackerCards,
  };
}
