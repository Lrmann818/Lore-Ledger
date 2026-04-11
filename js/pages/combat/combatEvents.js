// @ts-check

export const COMBAT_ENCOUNTER_CHANGED_EVENT = "combat:encounterChanged";

/**
 * @param {Record<string, unknown>} [detail]
 * @returns {void}
 */
export function notifyCombatEncounterChanged(detail = {}) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(COMBAT_ENCOUNTER_CHANGED_EVENT, { detail }));
}
