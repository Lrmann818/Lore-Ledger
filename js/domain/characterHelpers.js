// @ts-check
// js/domain/characterHelpers.js — helpers for resolving character entries

/**
 * @typedef {import("../state.js").State} State
 * @typedef {import("../state.js").CharacterEntry} CharacterEntry
 * @typedef {import("../state.js").CharacterOverridesState} CharacterOverridesState
 */

export const CHARACTER_ABILITY_KEYS = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);
export const DEFAULT_CHARACTER_BUILD_VERSION = 1;
export const DEFAULT_CHARACTER_RULESET = "srd-5.2.1";

/**
 * Creates the Step 3 foundation override shape.
 * Keep this object plain and JSON-safe; it is persisted on character entries.
 * @returns {{
 *   abilities: Record<string, number>,
 *   saves: Record<string, number>,
 *   skills: Record<string, number>,
 *   initiative: number
 * }}
 */
export function makeDefaultCharacterOverrides() {
  const zeroByAbility = () => Object.fromEntries(CHARACTER_ABILITY_KEYS.map((key) => [key, 0]));
  return {
    abilities: zeroByAbility(),
    saves: zeroByAbility(),
    skills: {},
    initiative: 0
  };
}

/**
 * Creates the minimal Step 3 builder metadata shape.
 * This opts a character into builder mode without choosing species, class,
 * subclass, background, spells, feats, or any derived automation.
 * @returns {import("../state.js").CharacterBuildState}
 */
export function makeDefaultCharacterBuild() {
  const neutralAbilities = Object.fromEntries(CHARACTER_ABILITY_KEYS.map((key) => [key, 10]));
  return {
    version: DEFAULT_CHARACTER_BUILD_VERSION,
    ruleset: DEFAULT_CHARACTER_RULESET,
    speciesId: null,
    classId: null,
    subclassId: null,
    backgroundId: null,
    level: 1,
    abilityMethod: "manual",
    abilities: {
      base: neutralAbilities
    },
    choicesByLevel: {}
  };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainPersistedObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function finiteNumberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {unknown} value
 * @returns {Record<string, number>}
 */
function normalizeAbilityOverrideLookup(value) {
  const source = isPlainPersistedObject(value) ? value : {};
  /** @type {Record<string, number>} */
  const out = {};
  for (const key of CHARACTER_ABILITY_KEYS) {
    out[key] = finiteNumberOrZero(source[key]);
  }
  return out;
}

/**
 * @param {unknown} value
 * @returns {Record<string, number>}
 */
function normalizeSkillOverrideLookup(value) {
  const source = isPlainPersistedObject(value) ? value : {};
  /** @type {Record<string, number>} */
  const out = {};
  for (const [key, entry] of Object.entries(source)) {
    const trimmedKey = key.trim();
    if (!trimmedKey) continue;
    const n = Number(entry);
    if (Number.isFinite(n)) out[trimmedKey] = n;
  }
  return out;
}

/**
 * Normalizes the persisted Step 3 foundation override shape.
 * Keep this helper as the single source of truth for migration and derivation.
 *
 * @param {unknown} value
 * @returns {CharacterOverridesState}
 */
export function normalizeCharacterOverrides(value) {
  const source = isPlainPersistedObject(value) ? value : {};
  return {
    ...makeDefaultCharacterOverrides(),
    abilities: normalizeAbilityOverrideLookup(source.abilities),
    saves: normalizeAbilityOverrideLookup(source.saves),
    skills: normalizeSkillOverrideLookup(source.skills),
    initiative: finiteNumberOrZero(source.initiative)
  };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumberLike(value) {
  if (value === "" || value == null) return false;
  return Number.isFinite(Number(value));
}

/**
 * @param {Record<string, unknown>} build
 * @returns {boolean}
 */
function hasMeaningfulBuilderShape(build) {
  if (isFiniteNumberLike(build.version)) return true;
  if (isNonEmptyString(build.ruleset)) return true;
  if (isNonEmptyString(build.speciesId)) return true;
  if (isNonEmptyString(build.classId)) return true;
  if (isNonEmptyString(build.subclassId)) return true;
  if (isNonEmptyString(build.backgroundId)) return true;
  if (isFiniteNumberLike(build.level)) return true;
  if (isNonEmptyString(build.abilityMethod)) return true;
  if (isPlainPersistedObject(build.abilities)) return true;
  if (isPlainPersistedObject(build.abilityBase)) return true;
  return isPlainPersistedObject(build.choicesByLevel);
}

/**
 * @param {unknown} character
 * @returns {boolean}
 */
export function isBuilderCharacter(character) {
  if (!isPlainPersistedObject(character)) return false;
  const build = /** @type {{ build?: unknown }} */ (character).build;
  return isPlainPersistedObject(build) && hasMeaningfulBuilderShape(build);
}

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
    build: null,
    overrides: makeDefaultCharacterOverrides(),
    imgBlobId: null,
    name,
    classLevel: "",
    status: "",
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

/**
 * Creates a default CharacterEntry with minimal builder metadata enabled.
 * @param {string} [name] display name (defaults to "New Builder Character")
 * @returns {CharacterEntry}
 */
export function makeDefaultBuilderCharacterEntry(name = "New Builder Character") {
  return {
    ...makeDefaultCharacterEntry(name),
    build: makeDefaultCharacterBuild()
  };
}
