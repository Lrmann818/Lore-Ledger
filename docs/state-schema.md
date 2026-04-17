# Persisted State Schema

## 1. Purpose of this document

This document describes the application state that is persisted by the current codebase, plus the migration and restore expectations that keep older saves usable.

The source of truth is the code, primarily:

- `js/state.js`
- `js/storage/persistence.js`
- `js/storage/backup.js`
- page modules that lazily create persisted fields during normal UI initialization

This is intentionally a maintainer-focused document. It describes the state as it exists today, including a few legacy or duplicated fields that still appear because the app preserves backward compatibility.

Current structured schema version: `6`

## 2. Schema versioning policy

The app tracks a numeric `schemaVersion` at the root of structured state.

Current policy in `js/state.js`:

- `CURRENT_SCHEMA_VERSION` is the single current version number.
- `SCHEMA_MIGRATION_HISTORY` is append-only and should describe every version step.
- `migrateState(raw)` upgrades older data step-by-step until it reaches the current version.
- Unknown future versions are accepted as-is and are not downgraded. This is deliberate so an older build does not clobber a newer save.

Current history:

- `0`: legacy/unversioned saves before `schemaVersion` existed
- `1`: normalized top-level buckets; migrated legacy spells, resources, theme, and map shape
- `2`: ensured `character.inventoryItems` exists and migrated legacy equipment text
- `3`: added campaign-scoped Combat Workspace state with separate workspace and encounter buckets
- `4`: migrated the legacy singleton character object to the multi-character collection `{ activeId, entries[] }`
- `5`: added character-linked NPC/Party card references and the character `status` field
- `6`: added Step 3 rules-engine / character-builder foundation fields on character entries: `build` and `overrides`

Important implementation detail:

- `migrateState(...)` handles structural schema upgrades.
- `normalizeState(...)` runs after migration and applies runtime-only defaults such as calculator and dice state resets.
- `loadAll(...)` performs additional storage-level migrations during startup, especially image/data URL migration and legacy map field folding.

## 3. Top-level state shape

Runtime state still exposes one active campaign through this familiar top-level shape:

```js
{
  schemaVersion: number,
  tracker: object,
  characters: {
    activeId: string | null,
    entries: CharacterEntry[]
  },
  map: object,
  combat: object,
  ui: object,
  appShell: { activeCampaignId: string | null }
}
```

`sanitizeForSave(...)` emits the campaign-shaped part of that runtime state:

```js
{
  schemaVersion: number,
  tracker: object,
  characters: {
    activeId: string | null,
    entries: CharacterEntry[]
  },
  map: object,
  combat: object,
  ui: object
}
```

The main `localStorage["localCampaignTracker_v1"]` value is now a campaign vault, not that raw sanitized object:

```js
{
  vaultVersion: number,
  appShell: {
    activeCampaignId: string | null,
    ui: object
  },
  campaignIndex: {
    order: string[],
    entries: Record<string, CampaignIndexEntry>
  },
  campaignDocs: Record<string, {
    schemaVersion: number,
    tracker: object,
    characters: {
      activeId: string | null,
      entries: CharacterEntry[]
    },
    map: object,
    combat: object
  }>
}
```

`campaignDocs[id]` owns campaign data. `appShell.ui` owns app-level UI preferences such as theme and active tab. Startup projects only the selected active campaign document into the runtime `state.tracker`, `state.characters`, `state.map`, and `state.combat` buckets.

The app also uses companion persisted stores:

- `localStorage["localCampaignTracker_v1"]`: campaign vault
- `localStorage["localCampaignTracker_activeTab"]`: last active top-level tab, mirrored separately from `ui.activeTab`
- IndexedDB `blobs` store: portraits, map backgrounds, and map drawing images
- IndexedDB `texts` store: large spell notes, keyed by `spell_notes_<campaignId>__<spellId>` for active campaign notes, with legacy `spell_notes_<spellId>` keys migrated forward when possible

State only stores references such as `imgBlobId`, `bgBlobId`, `drawingBlobId`, and spell IDs. It does not inline binary files or long spell note text in the main JSON payload.

## 4. Tracker state breakdown

`state.tracker` is a mix of campaign content and persisted tracker-page UI state.

### Core fields

- `campaignTitle: string`
- `sessions: Array<{ title: string, notes: string }>`
- `sessionSearch: string`
- `activeSessionIndex: number`
- `npcs: NpcCard[]`
- `npcActiveGroup: string`
  - Legacy compatibility field.
  - Defaults to `"friendly"`.
  - Current UI uses section-based grouping instead.
- `npcSearch: string`
- `party: PartyMember[]`
- `partySearch: string`
- `locationsList: LocationCard[]`
- `locSearch: string`
- `locFilter: string`
  - Current UI values are `"all"`, `"town"`, `"dungeon"`, `"region"`, `"other"`.
- `misc: string`
- `ui: object`

### Sessions

Sessions are index-based, not ID-based:

```js
{ title: string, notes: string }
```

Notes:

- `activeSessionIndex` must always be clamped to the array bounds.
- There is no stable session ID today, so migrations that reorder or split sessions must preserve index semantics carefully.

### NPCs

Current NPC record shape comes from `makeNpc(...)`:

```js
{
  id: string,
  sectionId: string,
  group: string,
  name: string,
  notes: string,
  status: string,
  className: string,
  hpMax: number | null,
  hpCurrent: number | null,
  imgBlobId: string | null,
  portraitHidden: boolean,
  collapsed: boolean
}
```

Notes:

- `sectionId` is the current grouping field.
- `group` is retained for backward compatibility with older fixed-group NPC saves.
- `imgBlobId` points to the IndexedDB blob store.

NPC section metadata is created lazily by the NPC panel if missing:

```js
npcSections: Array<{ id: string, name: string }>
npcActiveSectionId: string
```

### Party

Current party member shape comes from `makePartyMember(...)`:

```js
{
  id: string,
  sectionId: string,
  name: string,
  notes: string,
  status: string,
  className: string,
  hpMax: number | null,
  hpCurrent: number | null,
  imgBlobId: string | null,
  portraitHidden: boolean,
  collapsed: boolean
}
```

Party section metadata is also lazy-created:

```js
partySections: Array<{ id: string, name: string }>
partyActiveSectionId: string
```

### Locations

Current location shape comes from `makeLocation(...)`:

```js
{
  id: string,
  sectionId: string,
  title: string,
  notes: string,
  type: string,
  imgBlobId: string | null,
  portraitHidden: boolean,
  collapsed: boolean
}
```

Location section metadata is lazy-created:

```js
locSections: Array<{ id: string, name: string }>
locActiveSectionId: string
```

### Tracker UI sub-bucket

`tracker.ui` exists in default state and currently may contain:

- `textareaHeights: Record<string, number>`
  - Legacy bucket. Root `ui.textareaHeights` is the current canonical textarea-height store.
- `sectionOrder: string[]`
  - Persisted tracker page panel order.
  - Values are tracker panel DOM IDs such as `sessionPanel`, `npcPanel`, `partyPanel`, `locationsPanel`, `miscPanel`.
- `theme: string`
  - Legacy duplicate of root `ui.theme`.
  - Current code can still write it from the data/settings panel.

Older saves may also contain the typo `tracker.ui.textareaHeigts`. Current code tolerates it and copies it into `tracker.ui.textareaHeights`.

## 5. Character state breakdown

`state.characters` is the canonical multi-character collection:

```js
characters: {
  activeId: string | null,
  entries: CharacterEntry[]
}
```

`state.characters.entries[]` contains character sheet content, some lazily-created per-panel settings, and a few legacy compatibility fields. `state.characters.activeId` selects the active entry. Character panels resolve that entry through `getActiveCharacter(state)` and write through state action helpers such as `mutateCharacter(...)` and `updateCharacterField(...)`.

The legacy singleton `state.character` key is accepted only by migration/backward-compatibility paths for old saves/backups. Do not add new production code that reads or writes `state.character`.

### Basics and vitals

- `imgBlobId: string | null`
- `name: string`
- `classLevel: string`
- `race: string`
- `background: string`
- `alignment: string`
- `experience: number | null`
- `features: string`
- `hpCur: number | null`
- `hpMax: number | null`
- `hitDieAmt: number | null`
  - Canonical persisted field.
  - Seeded by `js/state.js`, written by the Vitals panel, and enforced by migration-time normalization.
- `hitDieAmount?: number | null`
  - Legacy compatibility alias only.
  - Incoming saves that still use this name are normalized to `hitDieAmt` during `migrateState(...)`.
  - DEV save/export code warns if runtime state still contains this alias; runtime writes should use `hitDieAmt`.
- `hitDieSize: number | null`
- `ac: number | null`
- `initiative: number | null`
- `speed: number | null`
- `proficiency: number | null`
- `spellAttack: number | null`
- `spellDC: number | null`

### Step 3 builder foundation

Every character entry now carries builder metadata, but migrated characters stay in freeform/manual mode by default:

```js
{
  build: null | {
    version?: number,
    ruleset?: string,
    speciesId?: string | null,
    classId?: string | null,
    subclassId?: string | null,
    backgroundId?: string | null,
    level?: number,
    abilityMethod?: string,
    abilities?: {
      base?: Record<"str" | "dex" | "con" | "int" | "wis" | "cha", number>
    },
    choicesByLevel?: object
  },
  overrides: {
    abilities: { str: number, dex: number, con: number, int: number, wis: number, cha: number },
    saves: { str: number, dex: number, con: number, int: number, wis: number, cha: number },
    skills: Record<string, number>,
    initiative: number
  }
}
```

Notes:

- `build: null` means the character is freeform/manual.
- Step 3 Phase 2 adds a minimal `New Builder Character` creation path that seeds this build object with level 1, null content IDs, neutral base abilities, and empty choices. The full builder wizard is not shipped yet.
- A `build` object with recognized Step 3 builder fields opts the character into builder-derived interpretation for pure rules helpers.
- Migration never infers builder choices from existing freeform fields such as `classLevel`, `race`, `background`, abilities, or skills.
- `overrides` is persisted JSON-safe data for first-slice derivations only: ability totals, save totals, skill totals, and initiative.
- The first Step 3 rules derivation is pure. It is not wired into migration, passive load, or materialization flows.
- Step 3 Phase 3A did not change the schema. The Builder Summary panel is display-only UI for builder characters. It reads derived class/level, species, background, level, proficiency bonus, and ability totals/modifiers without adding schema fields or persisting derived values back into `classLevel`, `race`, `background`, `proficiency`, abilities, or other flat fields.
- Step 3 Phase 3B also did not change the schema. The Builder Identity panel edits only `build.speciesId`, `build.classId`, `build.backgroundId`, and `build.level` for builder characters, using builtin SRD-safe content IDs from the code-shipped registry. Selecting "Not selected" stores `null` for the relevant content ID. It does not persist derived values into flat fields, does not lock existing freeform fields, and does not add ability editing, subclass choices, custom content, HP/AC/spell automation, or a full builder wizard.
- Builtin SRD content is code-shipped under `js/domain/rules/`; custom content persistence is intentionally not part of schema v6.

### Resources

`resources` is the canonical multi-resource tracker:

```js
Array<{
  id: string,
  name: string,
  cur: number | null,
  max: number | null
}>
```

Notes:

- `migrateState(...)` upgrades legacy single-resource fields (`resourceName`, `resourceCur`, `resourceMax`) into the first array entry, then deletes those legacy fields.
- The default state allows `resources: []`.
- The Vitals panel lazily creates one default resource entry when it initializes and finds the array empty.

### Abilities

`abilities` is keyed by ability name:

```js
{
  str: object,
  dex: object,
  con: object,
  int: object,
  wis: object,
  cha: object
}
```

Current panel logic treats the canonical per-ability fields as:

- `score: number | null`
- `saveProf: boolean`

However, current default state still seeds legacy-shaped entries:

```js
{ score: null, mod: null, save: null }
```

Important implications:

- `mod` and `save` are not authoritative in current code.
- The Abilities panel derives modifier and save values from `score`, proficiency, and `saveOptions`.
- Older or default-derived saves may still contain `mod` and `save`.

### Skills

`skills` is an object keyed by skill ID/name.

Current canonical shape used by the Abilities panel:

```js
{
  level: "none" | "half" | "prof" | "expert",
  misc: number,
  value: number
}
```

Notes:

- Older saves may contain `{ prof: boolean, value: number }`.
- The Abilities panel lazily upgrades those records to the new `level`-based shape.
- `value` is persisted today, but it is derived and recomputed from the linked ability modifier, proficiency settings, and misc bonus.

Related fields:

- `skillsNotes: string`
- `saveOptions`

`saveOptions` is lazy-created by the Abilities panel:

```js
{
  misc: {
    str: number,
    dex: number,
    con: number,
    int: number,
    wis: number,
    cha: number
  },
  modToAll: string
}
```

### Proficiencies

- `armorProf: string`
- `weaponProf: string`
- `toolProf: string`
- `languages: string`

### Attacks

`attacks` is an array of weapon/attack rows:

```js
Array<{
  id: string,
  name: string,
  notes: string,
  bonus: string,
  damage: string,
  range: string,
  type: string
}>
```

Note:

- `notes` is still created on new records, even though the current UI does not expose it.

### Spells

Structured spell state is:

```js
{
  levels: Array<{
    id: string,
    label: string,
    hasSlots: boolean,
    used: number | null,
    total: number | null,
    collapsed: boolean,
    spells: Array<{
      id: string,
      name: string,
      notesCollapsed: boolean,
      known: boolean,
      prepared: boolean,
      expended: boolean
    }>
  }>
}
```

Notes:

- `migrateState(...)` upgrades legacy spell buckets such as `cantrips`, `lvl1`, `lvl2`, and `lvl3` into `spells.levels`.
- The Spells panel lazily seeds default levels (`Cantrips`, `1st Level`, `2nd Level`, `3rd Level`) if `levels` is empty.
- The long-form text body for each spell is not stored in structured state.
- It lives in IndexedDB `texts`.
  - Active campaign key format: `spell_notes_<campaignId>__<spellId>`.
  - Legacy key format accepted during migration: `spell_notes_<spellId>`.

### Inventory, equipment, and money

- `inventoryItems: Array<{ title: string, notes: string }>`
- `activeInventoryIndex: number`
- `inventorySearch: string`
- `equipment: string`
  - Legacy compatibility field.
  - Current UI uses `inventoryItems` as the canonical inventory representation.
  - Migration copies legacy text into the first inventory item when needed, but the `equipment` field is not deleted.
- `money: { pp: number, gp: number, ep: number, sp: number, cp: number }`

### Personality

`personality` is:

```js
{
  traits: string,
  ideals: string,
  bonds: string,
  flaws: string,
  notes: string
}
```

### Character UI sub-bucket

Each character entry's `ui` object is mostly lazy-created. Current code may place these fields there:

- `sectionOrder: string[]`
  - Character page panel order.
  - Values are character panel DOM IDs such as `charBasicsPanel`, `charVitalsPanel`, `charAbilitiesPanel`, `charProfPanel`, `charAttacksPanel`, `charSpellsPanel`, `charEquipmentPanel`, `charPersonalityPanel`.
- `vitalsOrder: string[]`
  - Order of vitals/resource tiles.
  - Built-in tile keys come from DOM `data-vital-key` values.
  - Resource tiles use keys like `res:<resourceId>`.
- `abilityOrder: string[]`
  - Order of ability blocks, typically `["str", "dex", "con", "int", "wis", "cha"]`.
- `abilityCollapse: Record<string, boolean>`
  - Per-ability skill-list collapsed state.
- `textareaCollapse: Record<string, boolean>`
  - Collapsed/open state for collapsible text areas or containers, keyed by target DOM ID.
- `textareaHeights: Record<string, number>`
  - Created by migration for older saves, but current textarea sizing logic uses root `ui.textareaHeights`, not this bucket.
- `_applySectionOrder: Function`
  - Runtime-only function attached by the character page reorder helper.
  - Not serializable and therefore not meaningfully persisted.

### Character page Step 1 UI

The Character page now includes:

- character selector
- `...` actions menu
- New Character
- Rename Character
- Delete Character
- empty-state "Create your first character" prompt

Fresh campaigns can have `characters.activeId: null` and `characters.entries: []` until a character is created.

## 6. Map state breakdown

`state.map` is the persisted map manager state plus in-memory undo/redo stacks.

Current structured shape:

```js
{
  activeMapId: string | null,
  maps: Array<{
    id: string,
    name: string,
    bgBlobId: string | null,
    drawingBlobId: string | null,
    brushSize: number,
    colorKey: string
  }>,
  undo: string[],
  redo: string[],
  ui: {
    activeTool: string,
    brushSize: number,
    viewScale?: number
  }
}
```

### Map entries

Each map entry currently contains:

- `id: string`
- `name: string`
- `bgBlobId: string | null`
- `drawingBlobId: string | null`
- `brushSize: number`
- `colorKey: string`

Notes:

- `bgBlobId` and `drawingBlobId` reference IndexedDB blobs.
- `ensureMapManager()` guarantees at least one map exists and that `activeMapId` points to a valid entry.

### Map UI state

Current persisted map UI fields:

- `map.ui.activeTool`
  - `"brush"` or `"eraser"`
- `map.ui.brushSize`
  - Shared active brush size
- `map.ui.viewScale`
  - Current zoom scale, normalized by the map controller

Important nuance:

- `map.maps[*].brushSize` and `map.ui.brushSize` are both stored.
- Current UI uses `map.ui.brushSize` as the live shared brush size and also syncs that value into the active map entry.
- This means `brushSize` currently behaves more like duplicated state than a clean per-map preference.

### Undo/redo

- `map.undo` and `map.redo` are arrays of drawing snapshot data URLs while the app is running.
- They are intentionally removed by `sanitizeForSave(...)`.
- They are reset to empty arrays after load/import.

## 7. Combat state breakdown

`state.combat` is the campaign-scoped state bucket for Combat Workspace. It backs the Combat tab, Combat Cards, round controls, status timing, workspace layout, and the selected embedded character panels.

Current structured shape:

```js
{
  workspace: {
    panelOrder: string[],
    embeddedPanels: string[],
    panelCollapsed: Record<string, boolean>
  },
  encounter: {
    id: string | null,
    createdAt: string | null,
    updatedAt: string | null,
    round: number,
    activeParticipantId: string | null,
    elapsedSeconds: number,
    secondsPerTurn: number,
    participants: unknown[],
    undoStack: unknown[]
  }
}
```

### Workspace

`combat.workspace` owns long-lived per-campaign Combat Workspace layout/configuration:

- `panelOrder`
  - Ordered core Combat panel IDs.
  - Current core panel IDs are `combatCardsPanel` and `combatRoundPanel`.
  - Defaults to `[]`, which lets the page use its default ordering.
- `embeddedPanels`
  - Selected embedded character panel IDs.
  - Current supported IDs are `vitals`, `spells`, and `weapons`.
  - Defaults to `[]`.
- `panelCollapsed`
  - Collapsed state for core Combat panels and embedded panel DOM IDs.
  - Core keys use panel IDs such as `combatRoundPanel`; embedded keys use `combatEmbeddedPanel_${panelId}`.
  - Defaults to `{}`.

`combat.workspace` is intentionally limited to those composition fields. Migration and save sanitization strip copied spell lists, spell-note bodies, notes bodies, and other mirrored content from this bucket.

### Encounter

`combat.encounter` owns disposable active-encounter state:

- `id: string | null`
- `createdAt: string | null`
- `updatedAt: string | null`
- `round: number`
  - Defaults to `1`.
- `activeParticipantId: string | null`
- `elapsedSeconds: number`
  - Defaults to `0`.
- `secondsPerTurn: number`
  - Defaults to `6`.
- `participants: unknown[]`
  - Current entries are Combat participants normalized by `js/domain/combat.js`.
  - Each participant stores an encounter-local `id`, display `name`, `role`, `source` reference, `hpCurrent`, `hpMax`, `tempHp`, and structured `statusEffects`.
  - Multiple participants may point at the same tracker source card.
- `undoStack: unknown[]`
  - Current entries are turn-advance undo records.
  - Undo records store before/after round, active participant, elapsed time, and participant status-effect snapshots.

Notes:

- Combat is stored in each campaign document, not in app-shell UI.
- Combat participants are encounter-local. Role, order, active participant, timer state, duplicate participant entries, and status timing do not write back to tracker cards.
- Direct Combat HP/temp HP actions intentionally write `hpCurrent` and `tempHp` back to the source tracker card when the source still exists.
- Direct Combat status edits intentionally mirror visible status labels back to the source tracker card's text status field for NPC and party sources; duration timing remains encounter-local.
- Embedded Combat panels host the canonical Character page Vitals, Spells, and Weapons / Attacks panel modules as live alternate views of the active character. They resolve `getActiveCharacter(state)`, read/write canonical `state.characters.entries[]` data, and update through active-character change events plus panel invalidation/rebinding rather than copied data, duplicate state, or a sync store.
- Older campaign docs without `combat` migrate to the default split shape.
- Malformed `workspace` or `encounter` buckets are repaired defensively by `migrateState(...)`.

## 8. UI state breakdown

Root `state.ui` is the canonical shared UI bucket for app-wide preferences.

Current fields:

- `theme: string`
  - Canonical theme ID.
  - Current allowed values are:
    - `system`
    - `dark`
    - `light`
    - `purple`
    - `teal`
    - `green`
    - `blue`
    - `red`
    - `red-gold`
    - `rose`
    - `beige`
    - `slate`
    - `forest`
    - `ember`
    - `sepia`
    - `arcane`
    - `arcane-gold`
- `textareaHeights: Record<string, number>`
  - Canonical textarea height store, keyed by DOM ID.
- `panelCollapsed: Record<string, boolean>`
  - Collapsed state for top-level `section.panel` elements, keyed by panel DOM ID.
- `activeTab: string`
  - Current top-level page tab (`tracker`, `character`, `map`, etc.).
  - Also mirrored immediately into `localStorage["localCampaignTracker_activeTab"]`.
- `calc`
  - Current code only uses `calc.history`.
  - This history is runtime-only and stripped on save/export.
- `dice`
  - Current code uses:
    - `dice.history`
    - `dice.last = { count, sides, mod, mode }`
  - Entire `ui.dice` is runtime-only and stripped on save/export.

## 9. Persisted vs runtime-only / derived fields

### Persisted in structured JSON

These survive `sanitizeForSave(...)` and are written into the active campaign document or app-shell UI inside the campaign vault:

- all normal `tracker`, `character`, `map`, `combat`, and `ui` content fields
- UI/search/filter/index state such as `sessionSearch`, `locFilter`, `activeSessionIndex`, `inventorySearch`, and `ui.activeTab`
- panel order and collapse preferences
- blob ID references such as `imgBlobId`, `bgBlobId`, `drawingBlobId`

### Persisted separately from structured JSON

- images and drawings live in IndexedDB `blobs`
- spell note bodies live in IndexedDB `texts`
- `ui.activeTab` is mirrored to its own localStorage key so tab changes restore even when no full save has happened yet

### Runtime-only or stripped before save/export

- `map.undo`
- `map.redo`
- `ui.dice`
- `ui.calc.history`
- `character.ui._applySectionOrder`
- controller/runtime DOM state, active gesture state, canvas references, popover registrations, and similar in-memory helpers

### Persisted today, but logically derived or legacy

These are currently part of saved state, even though they are not clean canonical source-of-truth fields:

- `character.abilities[*].mod`
- `character.abilities[*].save`
- `character.skills[*].value`
- `character.equipment`
- `tracker.npcActiveGroup`
- `tracker.ui.theme`
- `tracker.ui.textareaHeights`
- `character.ui.textareaHeights`
- duplicated brush size state across `map.ui.brushSize` and `map.maps[*].brushSize`

When touching these areas, prefer documenting and migrating toward one canonical field rather than adding more duplication.

## 10. Migration expectations

Current migration flow has three layers.

### A. Structural migration in `migrateState(raw)`

Expected behavior:

- accept a full state object, partial object, or legacy blob
- treat missing `schemaVersion` as version `0`
- clamp negative versions up to `0`
- fill missing buckets and fields without overwriting existing user data
- leave unknown future versions untouched

Current structural migrations:

- `0 -> 1`
  - move legacy `map.character` into top-level `character`
  - ensure top-level `tracker`, `character`, and `map`
  - normalize tracker defaults and fix `textareaHeigts`
  - normalize character defaults
  - migrate legacy spells into `spells.levels`
  - migrate legacy single-resource fields into `resources`
  - ensure map manager basics (`maps`, `activeMapId`, `map.ui`)
  - ensure root `ui` exists and migrate legacy theme into root `ui.theme`
- `1 -> 2`
  - ensure `character.inventoryItems` exists
  - migrate legacy `character.equipment` text into the first inventory item when needed
- `2 -> 3`
  - ensure campaign-scoped `combat.workspace` exists
  - ensure campaign-scoped `combat.encounter` exists
  - repair malformed Combat Workspace fields to safe defaults without touching unrelated campaign data
- `3 -> 4`
  - migrate the legacy singleton `character` into `characters: { activeId, entries[] }`
  - repair malformed character collection IDs and active selection
  - remove stale singleton `character` once the collection exists
- `4 -> 5`
  - add `characterId: null` to NPC and Party cards when missing
  - add `status: ""` to character entries when missing or malformed
  - do not add character links to Location cards
- `5 -> 6`
  - add `build: null` to character entries when missing or malformed
  - normalize `overrides` to the Step 3 foundation shape
  - preserve existing flat freeform character fields exactly
  - do not materialize derived values or infer builder state during migration

### Automated migration coverage

The repo now includes a Vitest suite for `migrateState(...)` in `tests/state.migrate.test.js`.

Current covered behavior:

- valid historical migration paths and schema upgrades, including legacy `map.character`, spell-bucket, single-resource, and inventory migrations
- already-current saves that should still receive normalization of runtime-only UI state such as dice and calculator history
- malformed, partial, or risky inputs that document today's behavior, including permissive repair paths and malformed `schemaVersion: 1` inventory shapes that are repaired during backfill

This coverage is intentionally scoped to structural migration behavior in `js/state.js`. Separate storage/backup tests now cover parts of startup load and import behavior, but this section should still be read as the source of truth for the pure JSON migration contract rather than a claim of full end-to-end browser persistence automation.

### B. Runtime normalization in `normalizeState(...)`

Expected behavior:

- clear calculator history
- clear dice history
- rebuild `ui.dice.last`
- always reset dice `count` and `mod`
- clamp dice `sides`
- normalize dice `mode`

This step intentionally removes ephemeral topbar history from full reload/import flows.

### C. Startup storage migration in `loadAll(...)`

Expected behavior:

- load the campaign vault from localStorage, or wrap a legacy single-campaign JSON payload into a one-campaign vault
- normalize the vault and resolve a valid active campaign id
- project the active campaign into the long-lived root `state` object's campaign buckets
- clear `map.undo` and `map.redo`
- convert legacy `imgDataUrl` fields into blob IDs
- fold legacy top-level map image and drawing fields into the default map entry
- fold legacy top-level map brush/color fields into the default map entry
- fix `tracker.ui.textareaHeigts` typo
- migrate legacy unscoped spell-note text IDs into the active legacy campaign scope when wrapping old saves
- mark the save as dirty so the migrated shape is written back once

This startup step is why some compatibility work lives outside `migrateState(...)`: it depends on IndexedDB blob storage, not just JSON reshaping.

## 11. Rules for adding new fields safely

1. Pick one canonical owner for each new field.
   Avoid storing the same preference in multiple places unless there is a clear compatibility reason and a documented migration plan.

2. Decide whether the field belongs in structured JSON, IndexedDB blobs, IndexedDB texts, or runtime-only memory.
   Do not inline large binary or long-form text into the main state payload.

3. If the field is persisted, add it to the default state only when that makes sense for every save.
   Otherwise create it lazily in the owning module and document that it is optional but persisted.

4. If the new field changes persisted meaning or shape, bump `CURRENT_SCHEMA_VERSION`, append to `SCHEMA_MIGRATION_HISTORY`, and add a migration step.
   Migrations should fill missing values and preserve user data instead of overwriting existing content.

5. Update `sanitizeForSave(...)` when a field should never be persisted.
   Runtime helpers, function references, undo stacks, and ephemeral histories should be stripped there.

6. Update backup/import behavior if the field needs special handling.
   Blob IDs, text IDs, and any cross-store references must stay restorable.

7. Clamp or validate any index-based references during migration.
   Current examples are `activeSessionIndex` and `activeInventoryIndex`.

8. Avoid persisting derived values unless there is a concrete reason.
   If a derived cache must be kept for compatibility, document which other field is the real source of truth.

9. If a field is created lazily by a panel/module, make that module defensive.
   Current code often initializes missing arrays/objects on first render; future additions should do the same.

10. Update this document when adding or redefining persisted state.
   The doc should stay aligned with code, including known legacy fields and migration boundaries.

## 12. Backward compatibility guidelines for imports/restores

Current import/restore behavior is intentionally permissive.

### Accepted incoming formats

The backup loader currently accepts:

- a raw state object
- `{ version: 1, state: ... }`
- `{ version: 2, state: ..., blobs: ..., texts: ... }`

Top-level validation is intentionally shallow:

- `schemaVersion` must be numeric when present
- `tracker`, `character`, `map`, `combat`, and `ui` must be objects when present

Deep shape repair is left to migration and normal startup logic.

### Expected compatibility behavior

Future restore-compatible changes should preserve these properties:

- older state blobs should still pass through `migrateState(...)`
- missing images or texts should not make the whole restore fail
- blob IDs should be preserved when possible and remapped when necessary
- every remapped blob ID must be rewritten everywhere it is referenced
- future schema versions should not be downgraded or rewritten blindly by older code
- restore should continue to preserve the root `state` object while replacing its top-level buckets, unless the app intentionally changes that contract

### Important current nuance

Import restores state, blobs, and texts, then reloads the app. That means:

- `importBackup(...)` handles validation, state migration, blob/text staging, and blob ID remapping
- failed imports attempt to restore previously touched text IDs before surfacing the error
- startup `loadAll(...)` still gets a chance to run on the reloaded app and finalize any startup-only compatibility work

In practice, that means new compatibility work should be placed in one of these buckets:

- `migrateState(...)` for pure JSON/schema changes
- startup persistence helpers for storage-backed conversions
- both, if a change has structural and storage-backed parts

Keeping that split clear is the best way to avoid restores behaving differently from normal app startup.
