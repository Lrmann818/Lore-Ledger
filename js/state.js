// @ts-check
// js/state.js — app-wide state + schema migration

import { DEV_MODE } from "./utils/dev.js";
import { isBuilderCharacter, normalizeCharacterOverrides } from "./domain/characterHelpers.js";

export const STORAGE_KEY = "localCampaignTracker_v1";
export const ACTIVE_TAB_KEY = "localCampaignTracker_activeTab";

// Save schema versioning
export const CURRENT_SCHEMA_VERSION = 7;

/** @typedef {import("./domain/factories.js").NpcCard & PortraitRef} NpcCard */
/** @typedef {import("./domain/factories.js").PartyMemberCard & PortraitRef} PartyMemberCard */
/** @typedef {import("./domain/factories.js").LocationCard & PortraitRef} LocationCard */

/**
 * Schema version history (append-only).
 * For each new schema version:
 * 1) Add a new entry here.
 * 2) Add a migration function in migrateState().
 * 3) Add it to SCHEMA_MIGRATIONS with key N mapping to migrateToV(N+1).
 */
export const SCHEMA_MIGRATION_HISTORY = Object.freeze([
  {
    version: 0,
    date: "2026-02-19",
    changes: "Legacy/unversioned saves before schemaVersion existed."
  },
  {
    version: 1,
    date: "2026-02-19",
    changes: "Normalized top-level buckets and migrated legacy spells/resources/theme/map fields."
  },
  {
    version: 2,
    date: "2026-02-19",
    changes: "Ensured character.inventoryItems exists and migrated legacy equipment text."
  },
  {
    version: 3,
    date: "2026-04-11",
    changes: "Added campaign-scoped Combat Workspace state with separate workspace and encounter buckets."
  },
  {
    version: 4,
    date: "2026-04-14",
    changes: "Migrated singleton character to characters collection { activeId, entries[] } for multi-character support."
  },
  {
    version: 5,
    date: "2026-04-15",
    changes: "Added character-linked NPC/Party card references and character status field."
  },
  {
    version: 6,
    date: "2026-04-16",
    changes: "Added Step 3 rules-engine foundation fields on character entries: build and overrides."
  },
  {
    version: 7,
    date: "2026-04-29",
    changes: "Added manual Abilities & Features card storage on character entries."
  }
]);

/** @typedef {number | null} NullableNumber */

/** @typedef {Record<string, number>} NumberLookup */

/** @typedef {Record<string, boolean>} BooleanLookup */

/**
 * @typedef {{
 *   title: string,
 *   notes: string,
 *   [key: string]: unknown
 * }} NotesEntry
 */

/**
 * @typedef {{
 *   imgBlobId?: string | null,
 *   imgDataUrl?: string,
 *   [key: string]: unknown
 * }} PortraitRef
 */

/**
 * @typedef {{
 *   score: NullableNumber,
 *   mod: NullableNumber,
 *   save: NullableNumber
 * }} AbilityScoreRow
 */

/**
 * @typedef {{
 *   str: AbilityScoreRow,
 *   dex: AbilityScoreRow,
 *   con: AbilityScoreRow,
 *   int: AbilityScoreRow,
 *   wis: AbilityScoreRow,
 *   cha: AbilityScoreRow
 * }} CharacterAbilities
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   cur: NullableNumber,
 *   max: NullableNumber,
 *   [key: string]: unknown
 * }} CharacterResource
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   sourceType: string,
 *   activation: string,
 *   rangeArea: string,
 *   saveDc: string,
 *   damageEffect: string,
 *   attackRoll?: string,
 *   damageRoll?: string,
 *   effectText?: string,
 *   description: string
 * }} ManualFeatureCard
 */

/**
 * @typedef {{
 *   id?: string,
 *   name?: string,
 *   bonus?: string | number | null,
 *   damage?: string,
 *   range?: string,
 *   type?: string,
 *   notes?: string,
 *   [key: string]: unknown
 * }} AttackEntry
 */

/**
 * @typedef {{
 *   used?: NullableNumber | string,
 *   total?: NullableNumber | string,
 *   list?: string,
 *   [key: string]: unknown
 * }} LegacySpellBucket
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   notesCollapsed: boolean,
 *   known: boolean,
 *   prepared: boolean,
 *   expended: boolean,
 *   [key: string]: unknown
 * }} CharacterSpell
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   hasSlots: boolean,
 *   used: NullableNumber,
 *   total: NullableNumber,
 *   collapsed: boolean,
 *   spells: CharacterSpell[],
 *   [key: string]: unknown
 * }} CharacterSpellLevel
 */

/**
 * @typedef {{
 *   levels: CharacterSpellLevel[],
 *   cantrips?: string,
 *   lvl1?: LegacySpellBucket,
 *   lvl2?: LegacySpellBucket,
 *   lvl3?: LegacySpellBucket,
 *   [key: string]: unknown
 * }} CharacterSpells
 */

/**
 * @typedef {{
 *   pp: number,
 *   gp: number,
 *   ep: number,
 *   sp: number,
 *   cp: number,
 *   [key: string]: unknown
 * }} MoneyState
 */

/**
 * @typedef {{
 *   traits: string,
 *   ideals: string,
 *   bonds: string,
 *   flaws: string,
 *   notes: string,
 *   [key: string]: unknown
 * }} PersonalityState
 */

/**
 * @typedef {{
 *   textareaHeights: NumberLookup,
 *   [key: string]: unknown
 * }} CharacterUiState
 */

/**
 * @typedef {{
 *   textareaHeights: NumberLookup,
 *   textareaHeigts?: NumberLookup,
 *   sectionOrder?: string[],
 *   theme?: string,
 *   [key: string]: unknown
 * }} TrackerUiState
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string
 * }} TrackerSection
 */

/**
 * @typedef {{
 *   campaignTitle: string,
 *   sessions: NotesEntry[],
 *   sessionSearch: string,
 *   activeSessionIndex: number,
 *   npcs: NpcCard[],
 *   npcSections: TrackerSection[],
 *   npcActiveSectionId: string,
 *   npcActiveGroup: string,
 *   npcSearch: string,
 *   party: PartyMemberCard[],
 *   partySections: TrackerSection[],
 *   partyActiveSectionId: string,
 *   partySearch: string,
 *   locationsList: LocationCard[],
 *   locSections: TrackerSection[],
 *   locActiveSectionId: string,
 *   locSearch: string,
 *   locFilter: string,
 *   misc: string,
 *   locations?: string,
 *   ui: TrackerUiState,
 *   [key: string]: unknown
 * }} TrackerState
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   bgBlobId: string | null,
 *   drawingBlobId: string | null,
 *   brushSize: number,
 *   colorKey: string,
 *   [key: string]: unknown
 * }} MapEntry
 */

/**
 * @typedef {{
 *   activeTool: string,
 *   brushSize: number,
 *   viewScale?: number,
 *   [key: string]: unknown
 * }} MapUiState
 */

/**
 * @typedef {{
 *   count: number,
 *   sides: number,
 *   mod: number,
 *   mode: "normal" | "adv" | "dis",
 *   [key: string]: unknown
 * }} DiceLastState
 */

/**
 * @typedef {{
 *   t?: number,
 *   text: string,
 *   [key: string]: unknown
 * }} DiceHistoryEntry
 */

/**
 * @typedef {{
 *   history: DiceHistoryEntry[],
 *   last?: DiceLastState,
 *   [key: string]: unknown
 * }} DiceUiState
 */

/**
 * @typedef {{
 *   history: unknown[],
 *   [key: string]: unknown
 * }} CalcUiState
 */

/**
 * @typedef {{
 *   theme: string,
 *   textareaHeights: NumberLookup,
 *   panelCollapsed: BooleanLookup,
 *   dice?: DiceUiState,
 *   calc?: CalcUiState,
 *   [key: string]: unknown
 * }} RootUiState
 */

/**
 * @typedef {{
 *   version?: number,
 *   ruleset?: string,
 *   raceId?: string | null,
 *   classId?: string | null,
 *   subclassId?: string | null,
 *   backgroundId?: string | null,
 *   level?: number,
 *   abilities?: { base?: NumberLookup, [key: string]: unknown },
 *   choicesByLevel?: Record<string, unknown>,
 *   [key: string]: unknown
 * }} CharacterBuildState
 */

/**
 * @typedef {{
 *   abilities: NumberLookup,
 *   saves: NumberLookup,
 *   skills: NumberLookup,
 *   initiative: number,
 *   [key: string]: unknown
 * }} CharacterOverridesState
 */

/**
 * @typedef {{
 *   imgBlobId: string | null,
 *   build: CharacterBuildState | null,
 *   overrides: CharacterOverridesState,
 *   imgDataUrl?: string,
 *   name: string,
 *   classLevel: string,
 *   status: string,
 *   race: string,
 *   background: string,
 *   alignment: string,
 *   experience: NullableNumber,
 *   features: string,
 *   hpCur: NullableNumber,
 *   hpMax: NullableNumber,
 *   hitDieAmt: NullableNumber,
 *   hitDieAmount?: NullableNumber,
 *   hitDieSize: NullableNumber,
 *   ac: NullableNumber,
 *   initiative: NullableNumber,
 *   speed: NullableNumber,
 *   proficiency: NullableNumber,
 *   spellAttack: NullableNumber,
 *   spellDC: NullableNumber,
 *   resources: CharacterResource[],
 *   manualFeatureCards: ManualFeatureCard[],
 *   abilities: CharacterAbilities,
 *   skills: Record<string, unknown>,
 *   skillsNotes: string,
 *   armorProf: string,
 *   weaponProf: string,
 *   toolProf: string,
 *   languages: string,
 *   attacks: AttackEntry[],
 *   spells: CharacterSpells,
 *   inventoryItems: NotesEntry[],
 *   activeInventoryIndex: number,
 *   inventorySearch: string,
 *   equipment: string,
 *   money: MoneyState,
 *   personality: PersonalityState,
 *   ui?: CharacterUiState,
 *   resourceName?: string,
 *   resourceCur?: NullableNumber,
 *   resourceMax?: NullableNumber,
 *   [key: string]: unknown
 * }} CharacterState
 */

/**
 * A CharacterState with a mandatory id field.
 * @typedef {CharacterState & { id: string }} CharacterEntry
 */

/**
 * @typedef {{
 *   activeId: string | null,
 *   entries: CharacterEntry[]
 * }} CharactersCollection
 */

/**
 * @typedef {{
 *   activeMapId: string | null,
 *   maps: MapEntry[],
 *   undo: unknown[],
 *   redo: unknown[],
 *   ui?: MapUiState,
 *   bgBlobId?: string | null,
 *   drawingBlobId?: string | null,
 *   bgDataUrl?: string,
 *   drawingDataUrl?: string,
 *   brushSize?: number,
 *   colorKey?: string,
 *   character?: CharacterState,
 *   [key: string]: unknown
 * }} MapState
 */

/**
 * @typedef {{
 *   activeMapId: string | null,
 *   maps: MapEntry[],
 *   ui?: MapUiState,
 *   bgBlobId?: string | null,
 *   drawingBlobId?: string | null,
 *   bgDataUrl?: string,
 *   drawingDataUrl?: string,
 *   brushSize?: number,
 *   colorKey?: string,
 *   [key: string]: unknown
 * }} PersistedMapState
 */

/**
 * @typedef {{
 *   panelOrder: string[],
 *   embeddedPanels: string[],
 *   panelCollapsed: BooleanLookup,
 *   [key: string]: unknown
 * }} CombatWorkspaceState
 */

/**
 * @typedef {{
 *   id: string | null,
 *   createdAt: string | null,
 *   updatedAt: string | null,
 *   round: number,
 *   activeParticipantId: string | null,
 *   elapsedSeconds: number,
 *   secondsPerTurn: number,
 *   participants: unknown[],
 *   undoStack: unknown[],
 *   [key: string]: unknown
 * }} CombatEncounterState
 */

/**
 * @typedef {{
 *   workspace: CombatWorkspaceState,
 *   encounter: CombatEncounterState,
 *   [key: string]: unknown
 * }} CombatState
 */

/**
 * @typedef {{
 *   activeCampaignId: string | null,
 *   [key: string]: unknown
 * }} AppShellState
 */

/**
 * @typedef {{
 *   playHubOpenSound: boolean,
 *   [key: string]: unknown
 * }} AppPreferencesState
 */

/**
 * @typedef {{
 *   preferences: AppPreferencesState,
 *   [key: string]: unknown
 * }} AppRuntimeState
 */

/**
 * @typedef {{
 *   theme: string,
 *   textareaHeights: NumberLookup,
 *   panelCollapsed: BooleanLookup,
 *   calc?: Record<string, unknown>,
 *   [key: string]: unknown
 * }} PersistedUiState
 */

/**
 * @typedef {{
 *   schemaVersion: number,
 *   tracker: TrackerState,
 *   characters: CharactersCollection,
 *   map: MapState,
 *   combat: CombatState,
 *   ui: RootUiState,
 *   app: AppRuntimeState,
 *   appShell: AppShellState,
 *   [key: string]: unknown
 * }} State
 */

/**
 * @typedef {{
 *   schemaVersion: number,
 *   tracker: TrackerState | undefined,
 *   characters: CharactersCollection | undefined,
 *   map: PersistedMapState,
 *   combat: CombatState | undefined,
 *   ui: PersistedUiState,
 *   app: AppRuntimeState,
 *   [key: string]: unknown
 * }} SanitizedState
 */

/** @typedef {State | SanitizedState} StateLike */

/** @type {State} */
export const state = {
  // Used to migrate older saves/backups as the app evolves.
  schemaVersion: CURRENT_SCHEMA_VERSION,
  tracker: {
    campaignTitle: "My Campaign",
    sessions: [{ title: "Session 1", notes: "" }],
    sessionSearch: "",
    activeSessionIndex: 0,
    npcs: [],                 // array of npc objects
    npcSections: [],
    npcActiveSectionId: "",
    npcActiveGroup: "friendly",
    npcSearch: "",
    party: [],
    partySections: [],
    partyActiveSectionId: "",
    partySearch: "",
    locationsList: [],
    locSections: [],
    locActiveSectionId: "",
    locSearch: "",
    locFilter: "all",
    misc: "",
    ui: { textareaHeights: {} }
  },
  characters: {
    activeId: null,
    entries: []
  },
  map: {
    // Multi-map support
    activeMapId: null,
    maps: [], // array of { id, name, bgBlobId, drawingBlobId, brushSize, colorKey }

    // undo/redo stacks (in-memory only; never persisted)
    undo: [],
    redo: []
  },
  combat: {
    workspace: {
      panelOrder: [],
      embeddedPanels: [],
      panelCollapsed: {}
    },
    encounter: {
      id: null,
      createdAt: null,
      updatedAt: null,
      round: 1,
      activeParticipantId: null,
      elapsedSeconds: 0,
      secondsPerTurn: 6,
      participants: [],
      undoStack: []
    }
  },
  ui: { theme: "system", textareaHeights: {}, panelCollapsed: {} },
  app: {
    preferences: {
      playHubOpenSound: false
    }
  },
  appShell: { activeCampaignId: null }
};

const DICE_LAST_DEFAULTS = Object.freeze({
  count: 1,
  sides: 20,
  mod: 0,
  mode: "normal"
});

const APP_PREFERENCES_DEFAULTS = Object.freeze({
  playHubOpenSound: false
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} rawPreferences
 * @returns {AppPreferencesState}
 */
function normalizeAppPreferences(rawPreferences) {
  const preferences = isPlainObject(rawPreferences) ? { ...rawPreferences } : {};
  preferences.playHubOpenSound = preferences.playHubOpenSound === true
    ? true
    : APP_PREFERENCES_DEFAULTS.playHubOpenSound;
  return /** @type {AppPreferencesState} */ (preferences);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {BooleanLookup}
 */
function normalizeBooleanLookup(value) {
  const source = isRecord(value) ? value : {};
  /** @type {BooleanLookup} */
  const out = {};
  for (const [key, entry] of Object.entries(source)) {
    if (entry === true) out[key] = true;
  }
  return out;
}

/**
 * @param {unknown} workspace
 * @returns {CombatWorkspaceState}
 */
function normalizeCombatWorkspaceState(workspace) {
  const source = isRecord(workspace) ? workspace : {};
  return {
    panelOrder: Array.isArray(source.panelOrder)
      ? source.panelOrder.filter((panelId) => typeof panelId === "string")
      : [],
    embeddedPanels: Array.isArray(source.embeddedPanels)
      ? source.embeddedPanels.filter((panelId) => typeof panelId === "string")
      : [],
    panelCollapsed: normalizeBooleanLookup(source.panelCollapsed)
  };
}

/**
 * @param {unknown} rawApp
 * @returns {AppRuntimeState}
 */
export function normalizeAppState(rawApp) {
  const app = isPlainObject(rawApp) ? { ...rawApp } : {};
  app.preferences = normalizeAppPreferences(app.preferences);
  return /** @type {AppRuntimeState} */ (app);
}

function clampDiceSides(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return DICE_LAST_DEFAULTS.sides;
  return Math.max(2, Math.min(1000, n));
}

function normalizeDiceMode(mode) {
  return (mode === "adv" || mode === "dis") ? mode : DICE_LAST_DEFAULTS.mode;
}

/**
 * Apply runtime-only UI defaults after load/import migration.
 * Dice count/mod are always reset on full load.
 * @param {State} data
 * @returns {State}
 */
export function normalizeState(data) {
  data.app = normalizeAppState(data.app);

  if (!data.appShell || typeof data.appShell !== "object" || Array.isArray(data.appShell)) {
    data.appShell = { activeCampaignId: null };
  }
  if (typeof data.appShell.activeCampaignId !== "string" || !data.appShell.activeCampaignId.trim()) {
    data.appShell.activeCampaignId = null;
  }

  if (!data.ui || typeof data.ui !== "object") {
    data.ui = { theme: "system", textareaHeights: {}, panelCollapsed: {} };
  }
  if (!data.ui.dice || typeof data.ui.dice !== "object") data.ui.dice = { history: [] };
  data.ui.dice.history = [];

  const prevLast = (data.ui.dice.last && typeof data.ui.dice.last === "object")
    ? data.ui.dice.last
    : /** @type {Partial<DiceLastState>} */ ({});
  data.ui.dice.last = {
    ...prevLast,
    count: DICE_LAST_DEFAULTS.count,
    mod: DICE_LAST_DEFAULTS.mod,
    sides: clampDiceSides(prevLast.sides),
    mode: normalizeDiceMode(prevLast.mode)
  };
  if (!data.ui.calc || typeof data.ui.calc !== "object") data.ui.calc = { history: [] };
  data.ui.calc.history = [];

  return data;
}

/**
 * Remove ephemeral UI from persistence/export payloads.
 * @param {StateLike | null | undefined} source
 * @param {{ currentSchemaVersion?: number, devAssertLegacyAliases?: boolean }} [opts]
 * @returns {SanitizedState}
 */
export function sanitizeForSave(source, opts = {}) {
  const {
    currentSchemaVersion = CURRENT_SCHEMA_VERSION,
    devAssertLegacyAliases = DEV_MODE
  } = opts;
  const input = /** @type {Partial<StateLike>} */ ((source && typeof source === "object") ? source : {});
  const shallowCopySaveBucket = (value) => (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? { ...value }
    : value;

  const serializableTracker = shallowCopySaveBucket(input.tracker);

  // Serialize the characters collection (new shape). Shallow-copy the container,
  // but leave entries as-is (they are plain data objects).
  const inputCharacters = /** @type {Partial<StateLike> & { characters?: CharactersCollection }} */ (input).characters;
  const serializableCharacters = (
    inputCharacters &&
    typeof inputCharacters === "object" &&
    !Array.isArray(inputCharacters)
  )
    ? { ...inputCharacters }
    : undefined;

  if (devAssertLegacyAliases && serializableCharacters?.entries) {
    for (const entry of serializableCharacters.entries) {
      if (entry && typeof entry === "object" && "hitDieAmount" in entry) {
        console.warn(
          "[state] Unexpected character entry.hitDieAmount found during save/export. " +
          "migrateState() is the canonical normalization point; runtime writes should use hitDieAmt."
        );
      }
    }
  }

  const serializableMap = { ...(input.map || {}) };
  delete serializableMap.undo;
  delete serializableMap.redo;

  const serializableCombat = shallowCopySaveBucket(input.combat);
  if (serializableCombat && typeof serializableCombat === "object" && !Array.isArray(serializableCombat)) {
    serializableCombat.workspace = normalizeCombatWorkspaceState(serializableCombat.workspace);
  }

  const serializableUi = { ...(input.ui || {}) };
  delete serializableUi.dice;
  if (serializableUi.calc && typeof serializableUi.calc === "object") {
    const serializableCalc = { ...serializableUi.calc };
    delete serializableCalc.history;
    if (Object.keys(serializableCalc).length === 0) {
      delete serializableUi.calc;
    } else {
      serializableUi.calc = serializableCalc;
    }
  }

  const serializableApp = normalizeAppState(input.app);

  return {
    schemaVersion: input.schemaVersion ?? currentSchemaVersion,
    tracker: /** @type {TrackerState | undefined} */ (serializableTracker),
    characters: /** @type {CharactersCollection | undefined} */ (serializableCharacters),
    map: /** @type {PersistedMapState} */ (serializableMap),
    combat: /** @type {CombatState | undefined} */ (serializableCombat),
    ui: /** @type {PersistedUiState} */ (serializableUi),
    app: serializableApp
  };
}

/**
 * Seeds or backfills inventory items from legacy character.equipment text.
 * Kept pure so the v2 inventory migration edge cases can be tested directly.
 * @param {unknown} inventoryItems
 * @param {unknown} legacyEquipment
 * @returns {unknown[]}
 */
export function backfillInventoryItemsFromLegacyEquipment(inventoryItems, legacyEquipment) {
  const legacy = typeof legacyEquipment === "string" ? legacyEquipment : "";

  if (!Array.isArray(inventoryItems) || inventoryItems.length === 0) {
    return [{ title: "Inventory", notes: legacy || "" }];
  }

  const hasAnyNotes = inventoryItems.some((item) => (
    !!item &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    typeof item.notes === "string" &&
    item.notes.trim()
  ));

  if (hasAnyNotes || !legacy || !legacy.trim()) return inventoryItems;

  const nextItems = inventoryItems.slice();
  const first = (
    nextItems[0] &&
    typeof nextItems[0] === "object" &&
    !Array.isArray(nextItems[0])
  )
    ? { ...nextItems[0] }
    : { title: "Inventory", notes: "" };

  if (!first.notes || !String(first.notes).trim()) first.notes = legacy;
  if (!first.title) first.title = "Inventory";
  nextItems[0] = first;
  return nextItems;
}
// ---------- Map manager (multiple maps) ----------
/**
 * @param {string} [name]
 * @returns {MapEntry}
 */
export function newMapEntry(name = "World Map") {
  return {
    id: `map_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`,
    name: name || "World Map",
    bgBlobId: null,
    drawingBlobId: null,
    brushSize: 6,
    colorKey: "grey"
  };
}

// Exported because app.js (and backup import/export) need to call it.
export function ensureMapManager() {
  if (!state.map || typeof state.map !== "object") {
    state.map = { activeMapId: null, maps: [], undo: [], redo: [] };
  }
  if (!Array.isArray(state.map.maps)) state.map.maps = [];

  // UI / preferences (tool + shared brush size)
  if (!state.map.ui || typeof state.map.ui !== "object") state.map.ui = { activeTool: "brush", brushSize: 6 };
  if (typeof state.map.ui.activeTool !== "string") state.map.ui.activeTool = "brush"; // brush | eraser
  if (typeof state.map.ui.brushSize !== "number") state.map.ui.brushSize = 6;

  if (!state.map.maps.length) {
    const m = newMapEntry("World Map");
    state.map.maps.push(m);
    state.map.activeMapId = m.id;
  }
  if (!state.map.activeMapId || !state.map.maps.some(m => m.id === state.map.activeMapId)) {
    state.map.activeMapId = state.map.maps[0].id;
  }

  // Ensure each entry has the expected fields
  state.map.maps.forEach(m => {
    if (!m.id) m.id = newMapEntry().id;
    if (!m.name) m.name = "Map";
    if (m.bgBlobId === undefined) m.bgBlobId = null;
    if (m.drawingBlobId === undefined) m.drawingBlobId = null;
    if (typeof m.brushSize !== "number") m.brushSize = 6;
    if (typeof m.colorKey !== "string") m.colorKey = "grey";
  });

  // Migration / sync: if UI size looks unset but maps have sizes, prefer active map's size
  const active = state.map.maps.find(m => m.id === state.map.activeMapId) || state.map.maps[0];
  if (!Number.isFinite(state.map.ui.brushSize)) state.map.ui.brushSize = (active?.brushSize ?? 6);
}

/**
 * @returns {MapEntry}
 */
export function getActiveMap() {
  ensureMapManager();
  return /** @type {MapEntry} */ (
    state.map.maps.find(m => m.id === state.map.activeMapId) || state.map.maps[0]
  );
}

/************************ Save / Load ***********************/

/**
 * @param {unknown} raw
 * @returns {State}
 */
export function migrateState(raw) {
  // Accept either a full state object or a partial/legacy blob.
  const data = /** @type {Omit<Partial<State>, "tracker" | "character" | "map" | "ui"> & {
   *   tracker?: Partial<TrackerState> & Record<string, unknown>,
   *   character?: Partial<CharacterState> & Record<string, unknown>,
   *   map?: Partial<MapState> & Record<string, unknown>,
   *   ui?: Partial<RootUiState> & Record<string, unknown>,
   *   [key: string]: unknown
   * }} */ ((raw && typeof raw === "object") ? raw : {});

  // Older saves won't have schemaVersion.
  const parsedVersion = Number(data.schemaVersion);
  let v = Number.isFinite(parsedVersion) ? Math.trunc(parsedVersion) : 0;
  if (v < 0) v = 0;

  /**
   * @param {Record<string, unknown>} parent
   * @param {string} key
   * @returns {Record<string, unknown>}
   */
  function ensureObj(parent, key) {
    if (!parent[key] || typeof parent[key] !== "object" || Array.isArray(parent[key])) parent[key] = {};
    return /** @type {Record<string, unknown>} */ (parent[key]);
  }
  /**
   * @param {Record<string, unknown>} parent
   * @param {string} key
   * @returns {unknown[]}
   */
  function ensureArr(parent, key) {
    if (!Array.isArray(parent[key])) parent[key] = [];
    return /** @type {unknown[]} */ (parent[key]);
  }

  function migrateToV1() {
    // --- Legacy: character sheet accidentally stored inside map.character ---
    // Only lift map.character if we're still in the old shape (no `characters` yet).
    if (!data.characters && !data.character && data.map && data.map.character) {
      data.character = data.map.character;
      delete data.map.character;
    } else if (data.map && data.map.character) {
      // map.character is a legacy artifact; remove it regardless
      delete data.map.character;
    }

    // Ensure top-level buckets exist.
    // Only create `character` if we haven't already migrated to `characters`.
    ensureObj(data, "tracker");
    if (!data.characters) {
      ensureObj(data, "character");
    }
    ensureObj(data, "map");

    // Tracker UI defaults + typo fix
    const t = /** @type {Partial<TrackerState> & Record<string, unknown>} */ (data.tracker);
    ensureObj(t, "ui");
    if (t.ui?.textareaHeigts && !t.ui.textareaHeights) {
      t.ui.textareaHeights = t.ui.textareaHeigts;
    }
    ensureObj(t.ui, "textareaHeights");
    if (!Array.isArray(t.sessions)) t.sessions = [{ title: "Session 1", notes: "" }];
    if (!Array.isArray(t.npcs)) t.npcs = [];
    if (!Array.isArray(t.party)) t.party = [];
    if (!Array.isArray(t.locationsList)) t.locationsList = [];
    if (typeof t.campaignTitle !== "string") t.campaignTitle = "My Campaign";
    if (typeof t.activeSessionIndex !== "number") t.activeSessionIndex = 0;

    // Character defaults — only run if there is still a legacy `character` key to normalize.
    // After migrateToV4, `character` will be deleted and `characters` used instead.
    // Map defaults, UI, and theme migration always run regardless.
    if (data.character) {
    const c = /** @type {Partial<CharacterState> & Record<string, unknown>} */ (data.character);
    if (!("imgBlobId" in c)) c.imgBlobId = null;
    if (!c.money || typeof c.money !== "object") c.money = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
    if (!c.personality || typeof c.personality !== "object") {
      c.personality = { traits: "", ideals: "", bonds: "", flaws: "", notes: "" };
    }
    if (!Array.isArray(c.resources)) c.resources = [];
    ensureObj(c, "abilities");
    ensureObj(c, "skills");
    ensureObj(c, "ui");
    ensureObj(c.ui, "textareaHeights");
    c.inventoryItems = /** @type {NotesEntry[]} */ (
      backfillInventoryItemsFromLegacyEquipment(c.inventoryItems, c.equipment)
    );

    if (typeof c.activeInventoryIndex !== "number") c.activeInventoryIndex = 0;
    if (c.activeInventoryIndex < 0) c.activeInventoryIndex = 0;
    if (c.activeInventoryIndex >= c.inventoryItems.length) c.activeInventoryIndex = c.inventoryItems.length - 1;

    if (typeof c.inventorySearch !== "string") c.inventorySearch = "";

    // Spells v2 shape + legacy migration
    if (!c.spells || typeof c.spells !== "object") c.spells = { levels: [] };
    // If spells was stored in legacy shape (cantrips/lvl1/lvl2/lvl3), migrate once.
    const looksLegacySpells =
      ("cantrips" in c.spells) || ("lvl1" in c.spells) || ("lvl2" in c.spells) || ("lvl3" in c.spells);

    if (looksLegacySpells && (!Array.isArray(c.spells.levels) || c.spells.levels.length === 0)) {
      const parseLines = (txt) => String(txt || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);

      const newTextId = (prefix = "id") => `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
      const newSpell = (name = "") => ({ id: newTextId("spell"), name: name || "", notesCollapsed: true, known: true, prepared: false, expended: false });
      const newSpellLevel = (label, hasSlots = true) => ({ id: newTextId("spellLevel"), label: label || "New Level", hasSlots: !!hasSlots, used: null, total: null, collapsed: false, spells: [] });

      const levels = [];
      const can = newSpellLevel("Cantrips", false);
      for (const n of parseLines(c.spells.cantrips)) can.spells.push(newSpell(n));
      levels.push(can);

      const legacyLvls = [c.spells.lvl1, c.spells.lvl2, c.spells.lvl3];
      for (let i = 0; i < legacyLvls.length; i++) {
        const n = i + 1;
        const l = legacyLvls[i] || { used: null, total: null, list: "" };
        const label = n === 1 ? "1st Level" : n === 2 ? "2nd Level" : "3rd Level";
        const level = newSpellLevel(label, true);
        level.used = (typeof l.used === "number") ? l.used : (l.used === "" ? null : (l.used == null ? null : Number(l.used)));
        level.total = (typeof l.total === "number") ? l.total : (l.total === "" ? null : (l.total == null ? null : Number(l.total)));
        for (const name of parseLines(l.list)) level.spells.push(newSpell(name));
        levels.push(level);
      }

      c.spells = { levels };
    } else {
      if (!Array.isArray(c.spells.levels)) c.spells.levels = [];
    }

    // Vitals resources: migrate legacy single-resource fields into the first resource tile, then remove legacy fields.
    if (!Array.isArray(c.resources)) c.resources = [];
    const hasLegacyResource = ("resourceName" in c) || ("resourceCur" in c) || ("resourceMax" in c);
    if (c.resources.length === 0 && hasLegacyResource) {
      const hasAny = !!(c.resourceName || c.resourceCur != null || c.resourceMax != null);
      if (hasAny) {
        c.resources.push({
          id: `res_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`,
          name: c.resourceName || "",
          cur: (c.resourceCur ?? null),
          max: (c.resourceMax ?? null)
        });
      }
    }
    // Always remove legacy fields so the app has a single source of truth.
    delete c.resourceName;
    delete c.resourceCur;
    delete c.resourceMax;

    if ((!("hitDieAmt" in c) || c.hitDieAmt == null) && ("hitDieAmount" in c)) {
      c.hitDieAmt = /** @type {NullableNumber} */ (c.hitDieAmount ?? null);
    }
    if (!("hitDieAmt" in c)) c.hitDieAmt = null;
    delete c.hitDieAmount;
    if (!("hitDieSize" in c)) c.hitDieSize = null;
    } // end if (data.character)

    // Map defaults (multi-map manager expects these)
    const m = /** @type {Partial<MapState> & Record<string, unknown>} */ (data.map);
    ensureArr(m, "maps");
    ensureObj(m, "ui");
    if (typeof m.ui.activeTool !== "string") m.ui.activeTool = "brush";
    if (typeof m.ui.brushSize !== "number") m.ui.brushSize = 6;
    if (!m.activeMapId) m.activeMapId = null;

    // Root UI bucket used by textarea persistence helpers
    ensureObj(data, "ui");
    const rootUi = /** @type {Partial<RootUiState> & Record<string, unknown>} */ (data.ui);
    ensureObj(rootUi, "textareaHeights");
    ensureObj(rootUi, "panelCollapsed");

    // ---- THEME MIGRATION (important) ----
    if (!data.ui) data.ui = { theme: "system", textareaHeights: {}, panelCollapsed: {} };

    // Prefer root ui.theme
    if (typeof rootUi.theme !== "string") {
      // Fallback to legacy tracker.ui.theme if present
      if (typeof t.ui?.theme === "string") {
        rootUi.theme = t.ui.theme;
      } else {
        rootUi.theme = "system";
      }
    }
  }

  function migrateToV2() {
    // Ensure inventoryItems exists even for v1 saves (schemaVersion already 1).
    // Skip if already migrated to the new `characters` shape.
    if (data.characters) return;
    if (!data.character) {
      data.character = /** @type {Partial<CharacterState> & Record<string, unknown>} */ ({});
    }
    const c = /** @type {Partial<CharacterState> & Record<string, unknown>} */ (data.character);
    c.inventoryItems = /** @type {NotesEntry[]} */ (
      backfillInventoryItemsFromLegacyEquipment(c.inventoryItems, c.equipment)
    );
  }

  function migrateToV3() {
    const combat = ensureObj(data, "combat");
    const workspace = normalizeCombatWorkspaceState(combat.workspace);
    combat.workspace = workspace;
    const encounter = ensureObj(combat, "encounter");

    encounter.id = typeof encounter.id === "string" && encounter.id.trim() ? encounter.id : null;
    encounter.createdAt = typeof encounter.createdAt === "string" && encounter.createdAt.trim() ? encounter.createdAt : null;
    encounter.updatedAt = typeof encounter.updatedAt === "string" && encounter.updatedAt.trim() ? encounter.updatedAt : null;

    const parsedRound = Number(encounter.round);
    encounter.round = Number.isFinite(parsedRound) && parsedRound >= 1
      ? Math.trunc(parsedRound)
      : 1;

    encounter.activeParticipantId =
      typeof encounter.activeParticipantId === "string" && encounter.activeParticipantId.trim()
        ? encounter.activeParticipantId
        : null;

    const parsedElapsedSeconds = Number(encounter.elapsedSeconds);
    encounter.elapsedSeconds = Number.isFinite(parsedElapsedSeconds) && parsedElapsedSeconds >= 0
      ? parsedElapsedSeconds
      : 0;

    const parsedSecondsPerTurn = Number(encounter.secondsPerTurn);
    encounter.secondsPerTurn = Number.isFinite(parsedSecondsPerTurn) && parsedSecondsPerTurn > 0
      ? parsedSecondsPerTurn
      : 6;

    if (!Array.isArray(encounter.participants)) encounter.participants = [];
    if (!Array.isArray(encounter.undoStack)) encounter.undoStack = [];
  }

  /**
   * Returns true if the character object has any meaningful user data
   * (as opposed to being a freshly-initialized empty default).
   * @param {unknown} c
   * @returns {boolean}
   */
  function isCharacterMeaningful(c) {
    if (!c || typeof c !== "object" || Array.isArray(c)) return false;
    const ch = /** @type {Record<string, unknown>} */ (c);
    const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;
    const nonNull = (v) => v != null;

    if (nonEmptyStr(ch.name)) return true;
    if (nonEmptyStr(ch.classLevel)) return true;
    if (nonEmptyStr(ch.race)) return true;
    if (nonEmptyStr(ch.background)) return true;
    if (nonEmptyStr(ch.alignment)) return true;
    if (nonEmptyStr(ch.features)) return true;
    if (nonEmptyStr(ch.armorProf)) return true;
    if (nonEmptyStr(ch.weaponProf)) return true;
    if (nonEmptyStr(ch.toolProf)) return true;
    if (nonEmptyStr(ch.languages)) return true;
    if (nonEmptyStr(ch.skillsNotes)) return true;
    if (nonEmptyStr(ch.equipment)) return true;
    if (nonNull(ch.hpCur) || nonNull(ch.hpMax)) return true;
    if (nonNull(ch.hitDieAmt) || nonNull(ch.hitDieSize)) return true;
    if (nonNull(ch.ac) || nonNull(ch.initiative) || nonNull(ch.speed)) return true;
    if (nonNull(ch.proficiency) || nonNull(ch.spellAttack) || nonNull(ch.spellDC)) return true;
    if (nonNull(ch.experience)) return true;
    if (nonNull(ch.imgBlobId) && typeof ch.imgBlobId === "string") return true;
    if (Array.isArray(ch.resources) && ch.resources.length > 0) return true;
    if (Array.isArray(ch.attacks) && ch.attacks.length > 0) return true;
    if (ch.spells && typeof ch.spells === "object" && !Array.isArray(ch.spells)) {
      const spells = /** @type {Record<string, unknown>} */ (ch.spells);
      if (Array.isArray(spells.levels) && spells.levels.length > 0) return true;
      // Legacy spells shape
      if (nonEmptyStr(spells.cantrips) || spells.lvl1 || spells.lvl2 || spells.lvl3) return true;
    }
    if (ch.abilities && typeof ch.abilities === "object") {
      const abilities = /** @type {Record<string, unknown>} */ (ch.abilities);
      for (const val of Object.values(abilities)) {
        if (val && typeof val === "object" && !Array.isArray(val)) {
          const row = /** @type {Record<string, unknown>} */ (val);
          if (row.score != null) return true;
        }
      }
    }
    if (ch.personality && typeof ch.personality === "object" && !Array.isArray(ch.personality)) {
      const p = /** @type {Record<string, unknown>} */ (ch.personality);
      if (nonEmptyStr(p.traits) || nonEmptyStr(p.ideals) || nonEmptyStr(p.bonds) ||
          nonEmptyStr(p.flaws) || nonEmptyStr(p.notes)) return true;
    }
    if (Array.isArray(ch.inventoryItems)) {
      if (ch.inventoryItems.length > 1) return true;
      if (ch.inventoryItems.length === 1) {
        const item = ch.inventoryItems[0];
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const inv = /** @type {Record<string, unknown>} */ (item);
          if (nonEmptyStr(inv.notes)) return true;
          if (nonEmptyStr(inv.title) && inv.title !== "Inventory") return true;
        }
      }
    }
    return false;
  }

  function migrateToV4() {
    const newCharacterId = () => `char_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;

    // If the new `characters` shape already exists and is valid, we're already migrated.
    // Clean up any stale `character` key (may be re-created by migrateToV1's ensureObj).
    const existingRaw = data.characters;
    const existing = existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
      ? /** @type {CharactersCollection & Record<string, unknown>} */ (existingRaw)
      : null;
    if (existing && Array.isArray(existing.entries)) {
      // Already new shape — ensure shape integrity and remove stale character key.
      const seenIds = new Set();
      existing.entries = /** @type {CharacterEntry[]} */ (existing.entries
        .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        .map((entry) => {
          const normalized = /** @type {CharacterEntry & Record<string, unknown>} */ (entry);
          const currentId = typeof normalized.id === "string" ? normalized.id.trim() : "";
          const nextId = currentId && !seenIds.has(currentId) ? currentId : newCharacterId();
          normalized.id = nextId;
          seenIds.add(nextId);
          return normalized;
        }));
      if (existing.activeId !== null && typeof existing.activeId !== "string") {
        existing.activeId = null;
      }
      // Validate activeId points to a real entry
      if (existing.activeId !== null) {
        const hasEntry = existing.entries.some((e) => e && e.id === existing.activeId);
        if (!hasEntry) existing.activeId = existing.entries.length > 0 ? existing.entries[0].id : null;
      }
      if ("character" in data) delete data.character;
      return;
    }

    // Migrate from old character key to new characters shape.
    const c = data.character;
    if (isCharacterMeaningful(c)) {
      const id = newCharacterId();
      data.characters = { activeId: id, entries: [{ id, .../** @type {object} */ (c) }] };
    } else {
      data.characters = { activeId: null, entries: [] };
    }
    if ("character" in data) delete data.character;
  }

  function migrateToV5() {
    const tracker = ensureObj(data, "tracker");
    const ensureCardCharacterIds = (items) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const card = /** @type {Record<string, unknown>} */ (item);
        if (!("characterId" in card)) card.characterId = null;
        else if (typeof card.characterId !== "string") card.characterId = null;
      }
    };

    ensureCardCharacterIds(tracker.npcs);
    ensureCardCharacterIds(tracker.party);

    const characters = data.characters && typeof data.characters === "object" && !Array.isArray(data.characters)
      ? /** @type {CharactersCollection & Record<string, unknown>} */ (data.characters)
      : null;
    const entries = Array.isArray(characters?.entries) ? characters.entries : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const character = /** @type {Record<string, unknown>} */ (entry);
      if (typeof character.status !== "string") character.status = "";
    }
  }

  function migrateToV6() {
    const characters = data.characters && typeof data.characters === "object" && !Array.isArray(data.characters)
      ? /** @type {CharactersCollection & Record<string, unknown>} */ (data.characters)
      : null;
    const entries = Array.isArray(characters?.entries) ? characters.entries : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const character = /** @type {Record<string, unknown>} */ (entry);
      if (
        !("build" in character) ||
        (
          character.build !== null &&
          !isBuilderCharacter({ build: character.build })
        )
      ) {
        character.build = null;
      }
      character.overrides = normalizeCharacterOverrides(character.overrides);
    }
  }

  function migrateToV7() {
    const cleanFeatureText = (value) => typeof value === "string" ? value.trim() : "";
    const normalizeManualFeatureCard = (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const source = /** @type {Record<string, unknown>} */ (value);
      const id = cleanFeatureText(source.id);
      if (!id) return null;
      return {
        id,
        name: cleanFeatureText(source.name),
        sourceType: cleanFeatureText(source.sourceType),
        activation: cleanFeatureText(source.activation),
        rangeArea: cleanFeatureText(source.rangeArea),
        saveDc: cleanFeatureText(source.saveDc),
        damageEffect: cleanFeatureText(source.damageEffect),
        attackRoll: cleanFeatureText(source.attackRoll),
        damageRoll: cleanFeatureText(source.damageRoll),
        effectText: cleanFeatureText(source.effectText),
        description: cleanFeatureText(source.description)
      };
    };
    const characters = data.characters && typeof data.characters === "object" && !Array.isArray(data.characters)
      ? /** @type {CharactersCollection & Record<string, unknown>} */ (data.characters)
      : null;
    const entries = Array.isArray(characters?.entries) ? characters.entries : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const character = /** @type {Record<string, unknown>} */ (entry);
      character.manualFeatureCards = Array.isArray(character.manualFeatureCards)
        ? character.manualFeatureCards.map(normalizeManualFeatureCard).filter(Boolean)
        : [];
    }
  }

  const SCHEMA_MIGRATIONS = Object.freeze({
    0: migrateToV1,
    1: migrateToV2,
    2: migrateToV3,
    3: migrateToV4,
    4: migrateToV5,
    5: migrateToV6,
    6: migrateToV7
  });

  function applyMigrationStep(version) {
    const migrate = SCHEMA_MIGRATIONS[version];
    if (typeof migrate !== "function") return false;
    migrate();
    return true;
  }

  // Unknown future versions are accepted as-is to avoid downgrade/clobbering.
  if (v > CURRENT_SCHEMA_VERSION) {
    return normalizeState(/** @type {State} */ (data));
  }

  while (v < CURRENT_SCHEMA_VERSION) {
    if (!applyMigrationStep(v)) break;
    v += 1;
  }

  // Re-apply invariant-preserving migrations even for already-current saves so
  // partial or malformed payloads still regain the required bucket structure.
  migrateToV1();
  migrateToV2();
  migrateToV3();
  // migrateToV4 is idempotent: if characters already exists, it normalizes it
  // and removes any stale character key that migrateToV1 may have re-created.
  migrateToV4();
  migrateToV5();
  migrateToV6();
  migrateToV7();

  data.schemaVersion = CURRENT_SCHEMA_VERSION;
  return normalizeState(/** @type {State} */ (data));
}
