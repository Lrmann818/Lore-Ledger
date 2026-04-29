// @ts-check
// Manual/custom Abilities & Features card normalization and use tracking helpers.

/** @typedef {import("../state.js").ManualFeatureCard} ManualFeatureCard */
/** @typedef {import("../state.js").LimitedUseConfig} LimitedUseConfig */

const RECOVERY_MODES = new Set(["manual", "shortRest", "longRest", "shortOrLongRest", "none"]);

/**
 * @param {unknown} value
 * @returns {string}
 */
export function cleanManualFeatureText(value) {
  return typeof value === "string" ? value.trim() : "";
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
 * @param {unknown} value
 * @returns {LimitedUseConfig | undefined}
 */
export function normalizeLimitedUseConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = /** @type {Record<string, unknown>} */ (value);
  if (source.enabled !== true) return undefined;
  const max = normalizeUseCount(source.max);
  const current = Math.min(normalizeUseCount(source.current), max);
  const recovery = RECOVERY_MODES.has(String(source.recovery)) ? String(source.recovery) : "manual";
  return {
    enabled: true,
    label: cleanManualFeatureText(source.label),
    current,
    max,
    recovery: /** @type {LimitedUseConfig["recovery"]} */ (recovery)
  };
}

/**
 * @param {unknown} value
 * @returns {ManualFeatureCard | null}
 */
export function normalizeManualFeatureCard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = /** @type {Record<string, unknown>} */ (value);
  const id = cleanManualFeatureText(source.id);
  if (!id) return null;
  const card = {
    id,
    name: cleanManualFeatureText(source.name),
    sourceType: cleanManualFeatureText(source.sourceType),
    activation: cleanManualFeatureText(source.activation),
    rangeArea: cleanManualFeatureText(source.rangeArea),
    saveDc: cleanManualFeatureText(source.saveDc),
    damageEffect: cleanManualFeatureText(source.damageEffect),
    attackRoll: cleanManualFeatureText(source.attackRoll),
    damageRoll: cleanManualFeatureText(source.damageRoll),
    effectText: cleanManualFeatureText(source.effectText),
    description: cleanManualFeatureText(source.description)
  };
  const limitedUse = normalizeLimitedUseConfig(source.limitedUse);
  if (limitedUse) {
    return { ...card, limitedUse };
  }
  return card;
}

/**
 * @param {unknown} value
 * @returns {ManualFeatureCard[]}
 */
export function normalizeManualFeatureCards(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeManualFeatureCard).filter(
    /** @param {ManualFeatureCard | null} x @returns {x is ManualFeatureCard} */
    (x) => x !== null
  );
}

/**
 * @param {LimitedUseConfig | undefined} limitedUse
 * @param {"decrement" | "increment" | "reset"} operation
 * @returns {{ limitedUse: LimitedUseConfig | undefined, changed: boolean }}
 */
export function updateLimitedUseCount(limitedUse, operation) {
  const normalized = normalizeLimitedUseConfig(limitedUse);
  if (!normalized) return { limitedUse: undefined, changed: false };
  let current = normalized.current;
  if (operation === "decrement") current = Math.max(0, current - 1);
  else if (operation === "increment") current = Math.min(normalized.max, current + 1);
  else if (operation === "reset") current = normalized.max;
  if (current === normalized.current) return { limitedUse: normalized, changed: false };
  return { limitedUse: { ...normalized, current }, changed: true };
}

/**
 * @param {unknown} recovery
 * @param {"shortRest" | "longRest"} restType
 * @returns {boolean}
 */
export function limitedUseRecoveryMatchesRest(recovery, restType) {
  if (recovery === "shortOrLongRest") return true;
  if (restType === "shortRest") return recovery === "shortRest";
  if (restType === "longRest") return recovery === "longRest";
  return false;
}
