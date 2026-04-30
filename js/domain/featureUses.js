// @ts-check
// Character-owned use tracking for derived feature-specific counters.

/** @typedef {import("../state.js").FeatureUseState} FeatureUseState */
/** @typedef {import("../state.js").FeatureUsesState} FeatureUsesState */
/** @typedef {import("./rules/deriveCharacter.js").DerivedFeatureAction} DerivedFeatureAction */

const FEATURE_USE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeUseCount(value) {
  const parsed = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

/**
 * @param {number} value
 * @param {number} max
 * @returns {number}
 */
function clampUseCount(value, max) {
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

/**
 * @param {unknown} value
 * @returns {FeatureUsesState}
 */
export function normalizeFeatureUses(value) {
  if (!isPlainObject(value)) return {};
  /** @type {FeatureUsesState} */
  const normalized = {};
  for (const [id, rawEntry] of Object.entries(value)) {
    const featureId = String(id).trim();
    if (!FEATURE_USE_ID_PATTERN.test(featureId) || !isPlainObject(rawEntry)) continue;
    normalized[featureId] = { current: normalizeUseCount(rawEntry.current) };
  }
  return normalized;
}

/**
 * @param {unknown} recovery
 * @param {"shortRest" | "longRest"} restType
 * @returns {boolean}
 */
export function featureUseRecoveryMatchesRest(recovery, restType) {
  if (recovery === "shortOrLongRest") return true;
  if (restType === "shortRest") return recovery === "shortRest";
  if (restType === "longRest") return recovery === "longRest";
  return false;
}

/**
 * @param {unknown} featureUses
 * @param {DerivedFeatureAction} feature
 * @returns {number | null}
 */
export function getFeatureUseCurrent(featureUses, feature) {
  const max = feature.useTracking?.max;
  if (!Number.isFinite(max) || max < 0) return null;
  const normalized = normalizeFeatureUses(featureUses);
  const stored = normalized[feature.id]?.current;
  return clampUseCount(stored ?? max, max);
}

/**
 * @param {unknown} featureUses
 * @param {DerivedFeatureAction} feature
 * @param {"decrement" | "increment" | "reset"} operation
 * @returns {{ featureUses: FeatureUsesState, changed: boolean }}
 */
export function updateFeatureUseCount(featureUses, feature, operation) {
  const max = feature.useTracking?.max;
  if (!Number.isFinite(max) || max < 0) {
    return { featureUses: normalizeFeatureUses(featureUses), changed: false };
  }
  const normalized = normalizeFeatureUses(featureUses);
  const current = clampUseCount(normalized[feature.id]?.current ?? max, max);
  let nextCurrent = current;
  if (operation === "decrement") nextCurrent = Math.max(0, current - 1);
  else if (operation === "increment") nextCurrent = Math.min(max, current + 1);
  else if (operation === "reset") nextCurrent = max;
  if (nextCurrent === current) return { featureUses: normalized, changed: false };
  return {
    featureUses: {
      ...normalized,
      [feature.id]: { current: nextCurrent }
    },
    changed: true
  };
}

/**
 * @param {unknown} featureUses
 * @param {DerivedFeatureAction[]} derivedFeatures
 * @param {"shortRest" | "longRest"} restType
 * @returns {{ featureUses: FeatureUsesState, changed: boolean }}
 */
export function recoverDerivedFeatureUses(featureUses, derivedFeatures, restType) {
  const normalized = normalizeFeatureUses(featureUses);
  let changed = false;
  /** @type {FeatureUsesState} */
  let nextFeatureUses = normalized;

  for (const feature of derivedFeatures) {
    const tracking = feature.useTracking;
    if (!tracking || !featureUseRecoveryMatchesRest(tracking.recovery, restType)) continue;
    const max = Number.isFinite(tracking.max) && tracking.max >= 0 ? Math.trunc(tracking.max) : null;
    if (max == null) continue;
    const current = clampUseCount(normalized[feature.id]?.current ?? max, max);
    if (current >= max) continue;
    if (!changed) nextFeatureUses = { ...normalized };
    nextFeatureUses[feature.id] = { current: max };
    changed = true;
  }

  return { featureUses: nextFeatureUses, changed };
}
