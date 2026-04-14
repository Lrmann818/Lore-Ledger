// @ts-check
// js/domain/characterHelpers.js — helpers for resolving character entries

/**
 * @typedef {import("../state.js").State} State
 * @typedef {import("../state.js").CharacterEntry} CharacterEntry
 */

/**
 * Returns the active CharacterEntry for the given state, or null if none exists.
 * Defensive against missing `characters`, missing `entries`, or a bad `activeId`.
 *
 * @param {State | null | undefined} state
 * @returns {CharacterEntry | null}
 */
export function getActiveCharacter(state) {
  const col = state?.characters;
  if (!col || !Array.isArray(col.entries) || col.activeId == null) return null;
  return col.entries.find((e) => e && e.id === col.activeId) ?? null;
}

/**
 * Returns the CharacterEntry with the given id, or null if not found.
 * Defensive against missing `characters`, missing `entries`, or a non-string id.
 *
 * @param {State | null | undefined} state
 * @param {string | null | undefined} id
 * @returns {CharacterEntry | null}
 */
export function getCharacterById(state, id) {
  if (!id || typeof id !== "string") return null;
  const col = state?.characters;
  if (!col || !Array.isArray(col.entries)) return null;
  return col.entries.find((e) => e && e.id === id) ?? null;
}
