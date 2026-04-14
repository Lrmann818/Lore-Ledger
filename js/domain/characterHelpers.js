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

/**
 * Creates a new CharacterEntry with all default fields populated.
 * @param {string} [name] display name (defaults to "New Character")
 * @returns {CharacterEntry}
 */
export function makeDefaultCharacterEntry(name = "New Character") {
  const id = `char_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    imgBlobId: null,
    name,
    classLevel: "",
    race: "",
    background: "",
    alignment: "",
    experience: null,
    features: "",

    hpCur: null,
    hpMax: null,
    hitDieAmt: null,
    hitDieSize: null,
    ac: null,
    initiative: null,
    speed: null,
    proficiency: null,
    spellAttack: null,
    spellDC: null,

    resources: [],

    abilities: {
      str: { score: null, mod: null, save: null },
      dex: { score: null, mod: null, save: null },
      con: { score: null, mod: null, save: null },
      int: { score: null, mod: null, save: null },
      wis: { score: null, mod: null, save: null },
      cha: { score: null, mod: null, save: null }
    },
    skills: {},
    skillsNotes: "",

    armorProf: "",
    weaponProf: "",
    toolProf: "",
    languages: "",

    attacks: [],

    spells: {
      levels: []
    },

    inventoryItems: [{ title: "Inventory", notes: "" }],
    activeInventoryIndex: 0,
    inventorySearch: "",
    equipment: "",
    money: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },

    personality: {
      traits: "",
      ideals: "",
      bonds: "",
      flaws: "",
      notes: ""
    }
  };
}