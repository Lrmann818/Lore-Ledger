// @ts-check
// Centralized, lightweight state mutation helpers.
import { DEV_MODE, withAllowedStateMutation } from "../utils/dev.js";

/** @typedef {import("../state.js").State} State */
/** @typedef {typeof import("../state.js").state["tracker"]["npcs"][number]} TrackerCard */
/** @typedef {"party" | "npcs" | "locationsList"} TrackerCardListKey */
/** @typedef {"party" | "npc" | "npcs" | "location" | "locations" | "locationslist"} TrackerCardType */
/** @typedef {{ queueSave?: boolean, atStart?: boolean }} MutationOptions */
/** @typedef {{ markDirty?: () => void }} SaveManagerLike */
/**
 * @typedef {{
 *   state?: State,
 *   SaveManager?: SaveManagerLike
 * }} CreateStateActionsDeps
 */
/**
 * @typedef {{
 *   mutateState: (mutator: (state: State) => unknown, options?: MutationOptions) => unknown,
 *   mutateCharacter: (mutator: (character: State["character"], state: State) => unknown, options?: MutationOptions) => unknown,
 *   mutateTracker: (mutator: (tracker: State["tracker"], state: State) => unknown, options?: MutationOptions) => unknown,
 *   setPath: (path: string | readonly unknown[], value: unknown, options?: MutationOptions) => boolean,
 *   updateCharacterField: (path: string | readonly unknown[], value: unknown, options?: MutationOptions) => boolean,
 *   updateTrackerField: (path: string | readonly unknown[], value: unknown, options?: MutationOptions) => boolean,
 *   updateMapField: (path: string | readonly unknown[], value: unknown, options?: MutationOptions) => boolean,
 *   updateTrackerCardField: (type: TrackerCardType, id: string, field: string | readonly unknown[], value: unknown, options?: MutationOptions) => boolean,
 *   setCardPortraitHidden: (type: TrackerCardType, id: string, hidden: unknown, options?: MutationOptions) => boolean,
 *   addTrackerCard: (type: TrackerCardType, card: TrackerCard, options?: MutationOptions) => boolean,
 *   removeTrackerCard: (type: TrackerCardType, id: string, options?: MutationOptions) => TrackerCard | null,
 *   swapTrackerCards: (type: TrackerCardType, aId: string, bId: string, options?: MutationOptions) => boolean
 * }} StateActions
 */

/** @type {Readonly<Record<TrackerCardType, TrackerCardListKey>>} */
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

const LEGACY_HIT_DIE_ALIAS_MESSAGE =
  "[state] character.hitDieAmount is a legacy save alias. Use character.hitDieAmt instead; migrateState() is the canonical normalization point.";

/**
 * @param {string | readonly unknown[] | null | undefined} path
 * @returns {string[]}
 */
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

/**
 * @param {unknown} target
 * @param {string | readonly unknown[]} path
 * @param {unknown} value
 * @returns {boolean}
 */
function setPathValue(target, path, value) {
  const segments = toPathSegments(path);
  if (!target || typeof target !== "object" || segments.length === 0) return false;

  /** @type {Record<string, unknown>} */
  let cur = /** @type {Record<string, unknown>} */ (target);
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    const next = cur[key];
    if (!next || typeof next !== "object") cur[key] = {};
    cur = /** @type {Record<string, unknown>} */ (cur[key]);
  }

  cur[segments[segments.length - 1]] = value;
  return true;
}

/**
 * @param {string | readonly unknown[] | null | undefined} path
 * @param {"root" | "character"} [scope]
 * @returns {void}
 */
function assertNoLegacyHitDieAliasPath(path, scope = "root") {
  if (!DEV_MODE) return;
  const segments = toPathSegments(path);
  const writesLegacyAlias = scope === "character"
    ? segments[0] === "hitDieAmount"
    : segments[0] === "character" && segments[1] === "hitDieAmount";
  if (writesLegacyAlias) {
    throw new Error(LEGACY_HIT_DIE_ALIAS_MESSAGE);
  }
}

/**
 * @param {unknown} type
 * @returns {TrackerCardListKey | null}
 */
function resolveTrackerListKey(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return TRACKER_CARD_LIST_BY_TYPE[normalized] || null;
}

/**
 * @param {State} state
 * @param {TrackerCardListKey} listKey
 * @returns {TrackerCard[]}
 */
function ensureTrackerList(state, listKey) {
  if (!state.tracker || typeof state.tracker !== "object") {
    state.tracker = /** @type {State["tracker"]} */ ({});
  }
  if (!Array.isArray(state.tracker[listKey])) state.tracker[listKey] = [];
  return /** @type {TrackerCard[]} */ (state.tracker[listKey]);
}

/**
 * @param {SaveManagerLike | undefined} SaveManager
 * @param {MutationOptions | undefined} options
 * @returns {void}
 */
function maybeQueueSave(SaveManager, options) {
  if (options?.queueSave === false) return;
  // SaveManager.markDirty() is this app's queue-save mechanism.
  SaveManager?.markDirty?.();
}

/**
 * @param {CreateStateActionsDeps} [deps]
 * @returns {StateActions}
 */
export function createStateActions({ state, SaveManager } = {}) {
  if (!state || typeof state !== "object") {
    throw new Error("createStateActions: state is required");
  }

  /**
   * @param {(state: State) => unknown} mutator
   * @param {MutationOptions} [options]
   * @returns {unknown}
   */
  function mutateState(mutator, options = {}) {
    if (typeof mutator !== "function") return false;
    const result = withAllowedStateMutation(() => {
      return mutator(state);
    });
    if (result === false) return false;
    maybeQueueSave(SaveManager, options);
    return result;
  }

  /**
   * @param {(character: State["character"], state: State) => unknown} mutator
   * @param {MutationOptions} [options]
   * @returns {unknown}
   */
  function mutateCharacter(mutator, options = {}) {
    if (typeof mutator !== "function") return false;
    const result = withAllowedStateMutation(() => {
      if (!state.character || typeof state.character !== "object") {
        state.character = /** @type {State["character"]} */ ({});
      }
      return mutator(state.character, state);
    });
    if (result === false) return false;
    maybeQueueSave(SaveManager, options);
    return result;
  }

  /**
   * @param {(tracker: State["tracker"], state: State) => unknown} mutator
   * @param {MutationOptions} [options]
   * @returns {unknown}
   */
  function mutateTracker(mutator, options = {}) {
    if (typeof mutator !== "function") return false;
    const result = withAllowedStateMutation(() => {
      if (!state.tracker || typeof state.tracker !== "object") {
        state.tracker = /** @type {State["tracker"]} */ ({});
      }
      return mutator(state.tracker, state);
    });
    if (result === false) return false;
    maybeQueueSave(SaveManager, options);
    return result;
  }

  /**
   * @param {string | readonly unknown[]} path
   * @param {unknown} value
   * @param {MutationOptions} [options]
   * @returns {boolean}
   */
  function setPath(path, value, options = {}) {
    const updated = withAllowedStateMutation(() => {
      assertNoLegacyHitDieAliasPath(path, "root");
      return setPathValue(state, path, value);
    });
    if (!updated) return false;
    maybeQueueSave(SaveManager, options);
    return true;
  }

  /**
   * @param {string | readonly unknown[]} path
   * @param {unknown} value
   * @param {MutationOptions} [options]
   * @returns {boolean}
   */
  function updateCharacterField(path, value, options = {}) {
    const updated = withAllowedStateMutation(() => {
      assertNoLegacyHitDieAliasPath(path, "character");
      if (!state.character || typeof state.character !== "object") {
        state.character = /** @type {State["character"]} */ ({});
      }
      return setPathValue(state.character, path, value);
    });
    if (!updated) return false;
    maybeQueueSave(SaveManager, options);
    return true;
  }

  /**
   * @param {string | readonly unknown[]} path
   * @param {unknown} value
   * @param {MutationOptions} [options]
   * @returns {boolean}
   */
  function updateTrackerField(path, value, options = {}) {
    const updated = withAllowedStateMutation(() => {
      if (!state.tracker || typeof state.tracker !== "object") {
        state.tracker = /** @type {State["tracker"]} */ ({});
      }
      return setPathValue(state.tracker, path, value);
    });
    if (!updated) return false;
    maybeQueueSave(SaveManager, options);
    return true;
  }

  /**
   * @param {string | readonly unknown[]} path
   * @param {unknown} value
   * @param {MutationOptions} [options]
   * @returns {boolean}
   */
  function updateMapField(path, value, options = {}) {
    const updated = withAllowedStateMutation(() => {
      if (!state.map || typeof state.map !== "object") {
        state.map = /** @type {State["map"]} */ ({});
      }
      return setPathValue(state.map, path, value);
    });
    if (!updated) return false;
    maybeQueueSave(SaveManager, options);
    return true;
  }

  /**
   * @param {TrackerCardType} type
   * @param {string} id
   * @param {string | readonly unknown[]} field
   * @param {unknown} value
   * @param {MutationOptions} [options]
   * @returns {boolean}
   */
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

  /**
   * @param {TrackerCardType} type
   * @param {TrackerCard} card
   * @param {MutationOptions} [options]
   * @returns {boolean}
   */
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

  /**
   * @param {TrackerCardType} type
   * @param {string} id
   * @param {MutationOptions} [options]
   * @returns {TrackerCard | null}
   */
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

  /**
   * @param {TrackerCardType} type
   * @param {string} aId
   * @param {string} bId
   * @param {MutationOptions} [options]
   * @returns {boolean}
   */
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

  /**
   * @param {TrackerCardType} type
   * @param {string} id
   * @param {unknown} hidden
   * @param {MutationOptions} [options]
   * @returns {boolean}
   */
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
