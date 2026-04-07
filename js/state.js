// @ts-check
// js/state.js — app-wide state + schema migration

import { DEV_MODE } from "./utils/dev.js";

export const STORAGE_KEY = "localCampaignTracker_v1";
export const ACTIVE_TAB_KEY = "localCampaignTracker_activeTab";

// Save schema versioning
export const CURRENT_SCHEMA_VERSION = 2;

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
 *   imgBlobId: string | null,
 *   imgDataUrl?: string,
 *   name: string,
 *   classLevel: string,
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
 *   character: CharacterState,
 *   map: MapState,
 *   ui: RootUiState,
 *   [key: string]: unknown
 * }} State
 */

/**
 * @typedef {{
 *   schemaVersion: number,
 *   tracker: TrackerState | undefined,
 *   character: CharacterState | undefined,
 *   map: PersistedMapState,
 *   ui: PersistedUiState,
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
  character: {
    imgBlobId: null,
    name: "",
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


    // New: multiple resource trackers in Vitals
    resources: [], // array of { id, name, cur, max }

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

    attacks: [], // {id,name,bonus,damage,range,type,notes}

    spells: {
      // Spells v2 (dynamic levels). Legacy spell fields are migrated in migrateState.
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
  },
  map: {
    // Multi-map support
    activeMapId: null,
    maps: [], // array of { id, name, bgBlobId, drawingBlobId, brushSize, colorKey }

    // undo/redo stacks (in-memory only; never persisted)
    undo: [],
    redo: []
  },
  ui: { theme: "system", textareaHeights: {}, panelCollapsed: {} }
};

const DICE_LAST_DEFAULTS = Object.freeze({
  count: 1,
  sides: 20,
  mod: 0,
  mode: "normal"
});

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

  const serializableCharacter = shallowCopySaveBucket(input.character);
  if (
    devAssertLegacyAliases &&
    serializableCharacter &&
    typeof serializableCharacter === "object" &&
    !Array.isArray(serializableCharacter) &&
    ("hitDieAmount" in serializableCharacter)
  ) {
    console.warn(
      "[state] Unexpected character.hitDieAmount found during save/export. " +
      "migrateState() is the canonical normalization point; runtime writes should use hitDieAmt."
    );
  }

  const serializableMap = { ...(input.map || {}) };
  delete serializableMap.undo;
  delete serializableMap.redo;

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

  return {
    schemaVersion: input.schemaVersion ?? currentSchemaVersion,
    tracker: /** @type {TrackerState | undefined} */ (serializableTracker),
    character: /** @type {CharacterState | undefined} */ (serializableCharacter),
    map: /** @type {PersistedMapState} */ (serializableMap),
    ui: /** @type {PersistedUiState} */ (serializableUi)
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
    if (!data.character && data.map && data.map.character) {
      data.character = data.map.character;
      delete data.map.character;
    }

    // Ensure top-level buckets exist
    ensureObj(data, "tracker");
    ensureObj(data, "character");
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

    // Character defaults (only fill missing, never overwrite)
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
    // Ensure inventoryItems exists even for v1 saves (schemaVersion already 1)
    if (!data.character) {
      data.character = /** @type {Partial<CharacterState> & Record<string, unknown>} */ ({});
    }
    const c = /** @type {Partial<CharacterState> & Record<string, unknown>} */ (data.character);
    c.inventoryItems = /** @type {NotesEntry[]} */ (
      backfillInventoryItemsFromLegacyEquipment(c.inventoryItems, c.equipment)
    );
  }

  const SCHEMA_MIGRATIONS = Object.freeze({
    0: migrateToV1,
    1: migrateToV2
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

  data.schemaVersion = CURRENT_SCHEMA_VERSION;
  return normalizeState(/** @type {State} */ (data));
}
