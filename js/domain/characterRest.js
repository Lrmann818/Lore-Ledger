// @ts-check
// Character rest recovery helpers.

/** @typedef {import("../state.js").CharacterEntry} CharacterEntry */
/** @typedef {"shortRest" | "longRest"} CharacterRestType */
/** @typedef {"shortRest" | "longRest" | "shortOrLongRest" | "manual" | "none"} CharacterRecoveryMode */
/** @typedef {{ character: CharacterEntry, changed: boolean }} CharacterRestRecoveryResult */

/**
 * @param {unknown} value
 * @returns {value is CharacterRestType}
 */
function isSupportedRestType(value) {
  return value === "shortRest" || value === "longRest";
}

/**
 * @param {unknown} recovery
 * @param {CharacterRestType} restType
 * @returns {boolean}
 */
function recoveryMatchesRest(recovery, restType) {
  if (recovery === "shortOrLongRest") return true;
  if (restType === "shortRest") return recovery === "shortRest";
  if (restType === "longRest") return recovery === "longRest";
  return false;
}

/**
 * Recovers explicitly tagged current/max resource counters on one character.
 * Untagged, manual, none, and unknown recovery metadata is intentionally ignored.
 *
 * @param {CharacterEntry} character
 * @param {CharacterRestType} restType
 * @returns {CharacterRestRecoveryResult}
 */
export function recoverCharacterForRest(character, restType) {
  if (!character || typeof character !== "object" || !isSupportedRestType(restType)) {
    return { character, changed: false };
  }

  const resources = Array.isArray(character.resources) ? character.resources : [];
  let changed = false;
  const nextResources = resources.map((resource) => {
    if (!resource || typeof resource !== "object") return resource;
    if (!recoveryMatchesRest(resource.recovery, restType)) return resource;
    if (!Number.isFinite(resource.cur) || !Number.isFinite(resource.max)) return resource;
    if (resource.cur >= resource.max) return resource;
    changed = true;
    return { ...resource, cur: resource.max };
  });

  if (!changed) return { character, changed: false };
  return {
    character: {
      ...character,
      resources: nextResources
    },
    changed: true
  };
}
