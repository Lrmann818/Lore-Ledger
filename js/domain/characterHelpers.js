// @ts-check
// js/domain/characterHelpers.js — helpers for resolving character entries

/**
 * @typedef {import("../state.js").State} State
 * @typedef {import("../state.js").CharacterEntry} CharacterEntry
 * @typedef {import("../state.js").CharacterOverridesState} CharacterOverridesState
 */

export const CHARACTER_ABILITY_KEYS = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);
export const DEFAULT_CHARACTER_BUILD_VERSION = 2;
export const DEFAULT_CHARACTER_RULESET = "srd-5.1";

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
 * Play-state rest bookkeeping. Hit Dice are stored as spent counts so a
 * missing entry means a full pool, and prepared selections remain separate
 * from guarded builder choices.
 * @returns {{ hitDiceSpent: Record<string, number>, preparedByClass: Record<string, string[]> }}
 */
export function makeDefaultCharacterRestState() {
  return { hitDiceSpent: {}, preparedByClass: {} };
}

/**
 * @returns {{ successes: number, failures: number }}
 */
export function makeDefaultDeathSaves() {
  return { successes: 0, failures: 0 };
}

/**
 * Creates the default level-by-level builder metadata shape (build v2).
 * This opts a character into builder mode without choosing race, class,
 * subclass, background, spells, feats, or any derived automation.
 * @returns {import("../state.js").CharacterBuildState}
 */
export function makeDefaultCharacterBuild() {
  const neutralAbilities = Object.fromEntries(CHARACTER_ABILITY_KEYS.map((key) => [key, 10]));
  return {
    version: DEFAULT_CHARACTER_BUILD_VERSION,
    ruleset: DEFAULT_CHARACTER_RULESET,
    raceId: null,
    subraceId: null,
    backgroundId: null,
    abilities: {
      method: "manual",
      base: neutralAbilities
    },
    levels: [],
    subclassByClass: {},
    choicesByLevel: {},
    spellcasting: {},
    equipment: {
      armorId: null,
      shield: false,
      weaponIds: [],
      startingChoices: {},
      notes: ""
    }
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
 * @returns {{ successes: number, failures: number }}
 */
export function normalizeDeathSaves(value) {
  const source = isPlainPersistedObject(value) ? value : {};
  const clamp = (candidate) => {
    const parsed = Number(candidate);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(3, Math.floor(parsed)));
  };
  return { successes: clamp(source.successes), failures: clamp(source.failures) };
}

/**
 * @param {unknown} value
 * @returns {{ hitDiceSpent: Record<string, number>, preparedByClass: Record<string, string[]> }}
 */
export function normalizeCharacterRestState(value) {
  const source = isPlainPersistedObject(value) ? value : {};
  const hitDiceSpentSource = isPlainPersistedObject(source.hitDiceSpent) ? source.hitDiceSpent : {};
  /** @type {Record<string, number>} */
  const hitDiceSpent = {};
  for (const [poolId, rawSpent] of Object.entries(hitDiceSpentSource)) {
    const key = poolId.trim();
    const spent = Number(rawSpent);
    if (!key || !Number.isFinite(spent)) continue;
    const normalized = Math.max(0, Math.floor(spent));
    if (normalized > 0) hitDiceSpent[key] = normalized;
  }

  const preparedSource = isPlainPersistedObject(source.preparedByClass) ? source.preparedByClass : {};
  /** @type {Record<string, string[]>} */
  const preparedByClass = {};
  for (const [classId, rawIds] of Object.entries(preparedSource)) {
    const key = classId.trim();
    if (!key || !Array.isArray(rawIds)) continue;
    const ids = [...new Set(rawIds.filter((id) => typeof id === "string").map((id) => id.trim()).filter(Boolean))];
    if (ids.length) preparedByClass[key] = ids;
  }
  return { hitDiceSpent, preparedByClass };
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
  if (isNonEmptyString(build.raceId)) return true;
  if (isNonEmptyString(build.subraceId)) return true;
  if (isNonEmptyString(build.classId)) return true;
  if (isNonEmptyString(build.subclassId)) return true;
  if (isNonEmptyString(build.backgroundId)) return true;
  if (isFiniteNumberLike(build.level)) return true;
  if (Array.isArray(build.levels)) return true;
  if (isPlainPersistedObject(build.abilities)) return true;
  if (isPlainPersistedObject(build.abilityBase)) return true;
  if (isPlainPersistedObject(build.subclassByClass)) return true;
  if (isPlainPersistedObject(build.spellcasting)) return true;
  if (isPlainPersistedObject(build.equipment)) return true;
  return isPlainPersistedObject(build.choicesByLevel);
}

const LEGACY_BUILD_ID_PREFIXES = Object.freeze({
  raceId: "race_",
  subraceId: "subrace_",
  backgroundId: "background_",
  classId: "class_",
  subclassId: "subclass_"
});

/**
 * @param {unknown} value
 * @param {string} prefix
 * @returns {string | null}
 */
function normalizeContentIdField(value, prefix) {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id) return null;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumberOrNull(value) {
  if (value === "" || value == null) return null;
  let n;
  try {
    n = Number(value);
  } catch {
    return null;
  }
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalizes a persisted build object into the level-by-level v2 shape.
 * The single source of truth for the v1 → v2 build migration: legacy
 * "kind_id" content ids become bare registry ids and legacy classId+level
 * expands into the levels array. Unknown extra fields are preserved.
 *
 * @param {unknown} value
 * @returns {import("../state.js").CharacterBuildState | null}
 */
export function normalizeCharacterBuild(value) {
  if (!isPlainPersistedObject(value)) return null;
  const source = /** @type {Record<string, unknown>} */ (value);
  if (!hasMeaningfulBuilderShape(source)) return null;

  const out = /** @type {import("../state.js").CharacterBuildState} */ ({ ...source });
  out.version = DEFAULT_CHARACTER_BUILD_VERSION;
  out.ruleset = isNonEmptyString(source.ruleset) ? String(source.ruleset).trim() : DEFAULT_CHARACTER_RULESET;
  out.raceId = normalizeContentIdField(source.raceId, LEGACY_BUILD_ID_PREFIXES.raceId);
  out.subraceId = normalizeContentIdField(source.subraceId, LEGACY_BUILD_ID_PREFIXES.subraceId);
  out.backgroundId = normalizeContentIdField(source.backgroundId, LEGACY_BUILD_ID_PREFIXES.backgroundId);

  // Abilities: keep base scores, default the method.
  const abilitiesSource = isPlainPersistedObject(source.abilities) ? source.abilities : {};
  const baseSource = isPlainPersistedObject(abilitiesSource.base)
    ? abilitiesSource.base
    : (isPlainPersistedObject(source.abilityBase) ? source.abilityBase : {});
  /** @type {Record<string, number>} */
  const base = {};
  for (const key of CHARACTER_ABILITY_KEYS) {
    const n = finiteNumberOrNull(baseSource[key]);
    if (n != null) base[key] = n;
  }
  out.abilities = {
    ...abilitiesSource,
    method: isNonEmptyString(abilitiesSource.method) ? String(abilitiesSource.method).trim() : "manual",
    base
  };
  delete out.abilityBase;

  // Levels: prefer the stored array; otherwise expand legacy classId+level.
  /** @type {Array<{ classId: string, hp: number | null }>} */
  const levels = [];
  if (Array.isArray(source.levels)) {
    for (const row of source.levels) {
      if (levels.length >= 20) break;
      if (!isPlainPersistedObject(row)) continue;
      const classId = normalizeContentIdField(row.classId, LEGACY_BUILD_ID_PREFIXES.classId);
      if (!classId) continue;
      levels.push({ classId, hp: finiteNumberOrNull(row.hp) });
    }
  }
  if (!levels.length) {
    const legacyClassId = normalizeContentIdField(source.classId, LEGACY_BUILD_ID_PREFIXES.classId);
    const legacyLevel = finiteNumberOrNull(source.level);
    if (legacyClassId) {
      // A malformed/missing legacy level still keeps the class at level 1
      // rather than silently dropping the class selection.
      const count = legacyLevel != null && legacyLevel >= 1
        ? Math.min(20, Math.trunc(legacyLevel))
        : 1;
      for (let i = 0; i < count; i += 1) levels.push({ classId: legacyClassId, hp: null });
    }
  }
  out.levels = levels;
  delete out.classId;
  delete out.level;

  // Subclasses: keep the map; fold a legacy subclassId under the first class.
  /** @type {Record<string, string>} */
  const subclassByClass = {};
  if (isPlainPersistedObject(source.subclassByClass)) {
    for (const [classId, subclassId] of Object.entries(source.subclassByClass)) {
      const cleanClass = normalizeContentIdField(classId, LEGACY_BUILD_ID_PREFIXES.classId);
      const cleanSubclass = normalizeContentIdField(subclassId, LEGACY_BUILD_ID_PREFIXES.subclassId);
      if (cleanClass && cleanSubclass) subclassByClass[cleanClass] = cleanSubclass;
    }
  }
  const legacySubclassId = normalizeContentIdField(source.subclassId, LEGACY_BUILD_ID_PREFIXES.subclassId);
  if (legacySubclassId && levels.length && !subclassByClass[levels[0].classId]) {
    subclassByClass[levels[0].classId] = legacySubclassId;
  }
  out.subclassByClass = subclassByClass;
  delete out.subclassId;

  out.choicesByLevel = isPlainPersistedObject(source.choicesByLevel) ? source.choicesByLevel : {};

  // Spellcasting selections keyed by classId.
  /** @type {Record<string, { cantripIds: string[], knownIds: string[], preparedIds: string[] }>} */
  const spellcasting = {};
  if (isPlainPersistedObject(source.spellcasting)) {
    for (const [classId, selection] of Object.entries(source.spellcasting)) {
      const cleanClass = normalizeContentIdField(classId, LEGACY_BUILD_ID_PREFIXES.classId);
      if (!cleanClass || !isPlainPersistedObject(selection)) continue;
      const toIdList = (list) => Array.isArray(list)
        ? list.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())
        : [];
      spellcasting[cleanClass] = {
        cantripIds: toIdList(selection.cantripIds),
        knownIds: toIdList(selection.knownIds),
        preparedIds: toIdList(selection.preparedIds)
      };
    }
  }
  out.spellcasting = spellcasting;

  const equipmentSource = isPlainPersistedObject(source.equipment) ? source.equipment : {};
  out.equipment = {
    ...equipmentSource,
    armorId: isNonEmptyString(equipmentSource.armorId) ? String(equipmentSource.armorId).trim() : null,
    shield: equipmentSource.shield === true,
    weaponIds: Array.isArray(equipmentSource.weaponIds)
      ? equipmentSource.weaponIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())
      : [],
    startingChoices: isPlainPersistedObject(equipmentSource.startingChoices) ? equipmentSource.startingChoices : {},
    notes: typeof equipmentSource.notes === "string" ? equipmentSource.notes : ""
  };

  return out;
}

/**
 * Deep-clones a build object into a fresh, fully-detached plain object.
 *
 * The active character's `build` is read from `getActiveCharacter(state)`,
 * which — in dev/local/preview and `?dev=1` sessions — returns values wrapped
 * by the state-mutation guard's recursive Proxy (see js/utils/dev.js). Passing
 * such a proxied object to `structuredClone()` throws a `DataCloneError`
 * ("could not be cloned"). A JSON round-trip reads through the proxy get-traps
 * and produces plain data, matching how the rest of the app detaches state
 * (e.g. materializeDerivedCharacterFields, campaign vault, backup). Build data
 * is always JSON-safe, so nothing is lost. Shared here so both the creation
 * wizard and the Level Up wizard clone builds the same way.
 *
 * @param {unknown} build
 * @returns {unknown}
 */
export function clonePlainBuild(build) {
  try {
    return JSON.parse(JSON.stringify(build ?? null));
  } catch {
    return null;
  }
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
  const inventoryId = `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
    deathSaves: makeDefaultDeathSaves(),
    rest: makeDefaultCharacterRestState(),
    ac: null,
    initiative: null,
    speed: null,
    proficiency: null,
    spellAttack: null,
    spellDC: null,

    resources: [],
    manualFeatureCards: [],
    featureUses: {},

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

    inventoryItems: [{ id: inventoryId, title: "Inventory", notes: "" }],
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
