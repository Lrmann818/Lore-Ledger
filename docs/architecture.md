# Architecture

This document is the architecture source of truth for the current Lore Ledger / Campaign Tracker codebase. It describes the code that exists today, not a target refactor state. When a change alters startup order, state shape, persistence behavior, or module boundaries, update this file in the same change.

> AI-assisted editing rules live in [`AI_RULES.md`](../AI_RULES.md).

## Design goals

- **Local-first and offline-capable**: the app must function without a backend or live network connection.
- **Single composition root**: shared services and startup order are wired in one place (`app.js`), not scattered across page modules.
- **Explicit mutation and save awareness**: application state changes should be visible in code and should participate in the save lifecycle intentionally.
- **Type-safe vanilla JS at module boundaries**: the app hardens JavaScript with `@ts-check`, JSDoc, and narrow dependency contracts instead of a TypeScript rewrite.
- **Clear page ownership**: tracker, character, and map logic should live in their own page folders, with shared behavior extracted only when it is truly cross-page.
- **CSP-friendly UI**: dialogs, menus, and rendering paths must work under the strict `index.html` CSP without inline handlers or `eval`.
- **Backward-compatible persistence**: saved data, backups, legacy images, and old field names are migrated forward instead of silently discarded.
- **Fail-soft production behavior**: missing DOM anchors or partial init failures should degrade to no-op APIs and status messages instead of white-screening the whole app.

## Type safety and boundary hardening

Lore Ledger remains a vanilla-JS codebase. The current typing model is:

- repo-wide CheckJS configuration in `tsconfig.checkjs.json` with `allowJs` + `checkJs`
- file-level `// @ts-check` on modules that have already been hardened
- JSDoc typedefs, `import(...)` type references, and utility types such as `ReturnType<>` / `Parameters<>`
- ambient declaration files in `types/*.d.ts` for globals, virtual modules, and Node-side Vite config shims

### Where `@ts-check` is currently in use

Current Phase 1 coverage is concentrated in boundary and orchestration modules:

- Composition root: `app.js`
- Canonical state model: `js/state.js`
- Domain layer: all current `js/domain/*`
- Storage layer: all current `js/storage/*`
- Tracker orchestration: `js/pages/tracker/trackerPage.js`, `js/pages/tracker/trackerSectionReorder.js`
- Map orchestration/persistence: `js/pages/map/mapPage.js`, `js/pages/map/mapController.js`, `js/pages/map/mapDrawing.js`, `js/pages/map/mapCanvas.js`, `js/pages/map/mapPersistence.js`
- Character boundary helper: `js/pages/character/characterSectionReorder.js`
- Shared UI primitives: `js/ui/dataPanel.js`, `js/ui/navigation.js`, `js/ui/pagePanelReorder.js`, `js/ui/panelHeaderCollapse.js`, `js/ui/popovers.js`, `js/ui/positioning.js`, `js/ui/safeAsync.js`, `js/ui/saveBanner.js`, `js/ui/settingsPanel.js`, `js/ui/status.js`, `js/ui/theme.js`, `js/ui/topbar/topbar.js`
- Focused shared features/utilities: `js/features/autosize.js`, `js/features/numberSteppers.js`, `js/pwa/updateBanner.js`, `js/pwa/updates.js`, `js/utils/dev.js`

This list is intentionally narrower than the files included by `tsconfig.checkjs.json`. The config covers `app.js`, `boot.js`, `vite.config.js`, `js/**/*.js`, and `types/**/*.d.ts`, but not every included file has been hardened to the same standard yet.

### Where typedefs live

- `js/state.js` is the canonical source for persisted app-state, migration, and map-state typedefs used across the app.
- Domain-specific entity shapes live close to their owners, for example `js/domain/factories.js`.
- Boundary modules usually define their own local dependency/result typedefs beside the functions that consume them.
- Global/build/module declarations live in `types/app-globals.d.ts`, `types/node-shims.d.ts`, and `types/virtual-pwa-register.d.ts`.

### Expectations for future modules

- New shared infrastructure, persistence code, state/domain helpers, and page-orchestration modules should start with `// @ts-check`.
- Prefer importing existing typedefs from the owning module over recreating broad inline object shapes.
- Type dependency objects narrowly. `deps` contracts should describe the real functions and options being passed, not broad placeholder records.
- Keep runtime validation at persistence and import boundaries. Static typing complements `migrateState(...)`, backup validation, and DOM/file guards; it does not replace them.

### Current exceptions

- The repo-wide CheckJS pass is currently clean through `npm run typecheck`, which uses the repo-pinned `typescript@5.9.3` compiler and now runs inside `npm run verify` plus the current GitHub Pages CI gate.
- Some included files still rely on the broader config/JSDoc path without file-level `// @ts-check`; keep file-level hardening claims narrower than repo-wide clean-pass claims.
- `boot.js`, `vite.config.js`, and other supporting modules are included in the broader config for diagnostics, but they should not be described as fully boundary-hardened unless that work has actually landed.

## Top-level entrypoints

### `index.html`

- Defines the app shell, topbar, page sections, modal roots, and all DOM anchors required by page and shared UI modules.
- Owns the three top-level pages:
  - `#page-tracker`
  - `#page-character`
  - `#page-map`
- Owns the shared status line (`#statusText`), top navigation tabs, calculator/dice dropdown markup, and the Data & Settings panel shell.
- Loads `boot.js` in `<head>`, `styles.css`, and `app.js` at the end of `<body>`.
- Defines the runtime CSP. This is an architectural constraint, not a cosmetic choice.

### `boot.js`

- Runs before `app.js`.
- Reads Vite build metadata and exposes:
  - `window.__APP_VERSION__` / `window.APP_VERSION`
  - `window.__APP_BUILD__` / `window.APP_BUILD`
- Reads the current saved state from `localStorage["localCampaignTracker_v1"]`.
- Applies `document.documentElement.dataset.theme` early from persisted theme state to avoid theme flash/mismatch.
- Does not initialize app modules or load page logic.

### `app.js`

- Is the composition root.
- Imports `./js/pwa/pwa.js` so production builds register PWA update behavior.
- Installs the dev state mutation guard over the exported `state` object from `js/state.js`.
- Creates shared services:
  - `SaveManager`
  - popover manager
  - theme manager
  - shared image picker
  - status API surface
- Loads and migrates persisted state.
- Initializes shared UI and page modules in a fixed order.
- Owns dependency injection. Deep modules should not reach back into `app.js`.

## Startup and runtime flow

### Startup sequence

1. `boot.js` runs first and applies the saved theme plus version/build globals.
2. `app.js` loads, installs the dev mutation guard, and exposes `globalThis.__APP_STATE__` in DEV mode.
3. `app.js` creates app-lifetime services:
   - shared file picker (`createFilePicker`)
   - `SaveManager` (`createSaveManager`)
   - exit-save hooks (`installExitSave`)
   - popover manager (`createPopoverManager`)
   - theme manager (`createThemeManager`)
4. The bootstrap IIFE creates the status API (`createStatus`) and installs global error handlers.
5. Startup state work is wrapped in `withAllowedStateMutationAsync(...)` so guard-protected startup mutations are explicit.
6. `loadAllPersist(...)`:
   - reads `localStorage["localCampaignTracker_v1"]`
   - parses and migrates data through `migrateState(...)`
   - replaces the existing `state` object's top-level buckets via the storage-layer `replaceStateBuckets(...)` helper
   - clears map undo/redo
   - migrates legacy image data URLs into IndexedDB blobs
   - folds legacy map fields into the current multi-map structure
   - calls `ensureMapManager()`
   - marks the app dirty so migrated state is written back once
7. Shared UI modules initialize in this order:
   - `initDialogs()`
   - `Theme.initFromState()`
   - `initTopTabsNavigation(...)`
   - `setupSettingsPanel(...)`
   - `initTopbarUI(...)`
8. Page/features initialize in this order:
   - `autosizeAllNumbers()`
   - `setupTextareaSizing(...)`
   - `initTrackerPage(...)`
   - `setupMapPage(...)`
9. `initTrackerPage(...)` currently also initializes:
   - tracker campaign title + misc bindings
   - tracker panel reordering
   - tracker panels (sessions, NPCs, party, locations)
   - `initCharacterPageUI(...)`
   - `initPanelHeaderCollapse(...)`
   - number stepper enhancement
10. `setupMapPage(...)` creates a map controller, loads `state.map`, and initializes the live map canvas/controller runtime.
11. `SaveManager.flush()` runs once after startup so migrations and normalization writes are persisted.
12. `SaveManager.init()` resets the save lifecycle UI to a clean saved state.

### Steady-state runtime flow

- UI events mutate the guarded `appState` object directly or through `createStateActions(...)`.
- Save-aware mutations call `SaveManager.markDirty()`.
- `SaveManager` debounces writes, updates the status line, and serializes the sanitized main state into local storage.
- Binary assets and long-form spell notes are written to IndexedDB separately; the main save persists only the IDs and structured metadata needed to find them again.
- Page navigation shows/hides top-level pages, updates `state.ui.activeTab`, updates the URL hash, and also persists the active tab under `localStorage["localCampaignTracker_activeTab"]`.
- Best-effort save flushes also run on `beforeunload`, `pagehide`, and when the document becomes hidden.

## Module layers and dependency direction

### Layer map

- `app.js`
  - Composition root and startup ordering.
- `js/state.js`
  - State defaults, schema versioning, migration, save sanitization, and current map-manager helpers (`ensureMapManager`, `getActiveMap`, `newMapEntry`).
- `js/domain/*`
  - Domain helpers:
    - `factories.js`
    - `stateActions.js`
- `js/storage/*`
  - Persistence and backup layer:
    - `persistence.js`
    - `saveManager.js`
    - `idb.js`
    - `blobs.js`
    - `texts-idb.js`
    - `backup.js`
- `js/ui/*`
  - Shared UI infrastructure and generic UI state helpers.
- `js/features/*`
  - Reusable flows that are not page-specific but are higher-level than `utils`.
- `js/pages/*`
  - Page-level orchestration and page-specific panels/controllers.
- `js/pwa/*`
  - PWA service worker registration, update detection, and update banner behavior.
- `js/utils/*`
  - Low-level helpers with minimal app knowledge.

### Dependency direction rules

1. `app.js` may import from any layer. No other module should import from `app.js`.
2. `js/state.js` is below UI, storage, and pages. It should not import from `js/pages/*`, `js/ui/*`, or `js/storage/*`.
3. `js/domain/*` should stay below pages and shared UI. It may depend on `js/utils/*`.
4. `js/storage/*` owns browser persistence details and should stay page-agnostic.
   - Current exception: `js/storage/backup.js` imports `js/ui/dialogs.js` for confirm/alert UX.
5. `js/ui/*` should be page-agnostic shared infrastructure.
   - It may depend on `js/domain/*`, `js/utils/*`, and in limited cases `js/pwa/*`.
   - It should not import page modules.
6. `js/features/*` may depend on `js/ui/*`, `js/domain/*`, and `js/utils/*`, but should not import `js/pages/*`.
7. `js/pages/*` may depend on `js/ui/*`, `js/features/*`, `js/domain/*`, `js/utils/*`, and injected storage functions.
8. `js/pages/*` should not become a shared dependency for other layers.
   - Current implemented exception: `js/pages/tracker/trackerPage.js` imports `js/pages/character/characterPage.js` and owns character-page bootstrap.
9. Prefer dependency injection through a `deps` object over adding new cross-layer imports.
10. Avoid circular imports. If two modules need each other, extract a lower-level helper into `domain`, `ui`, `features`, or `utils` instead.

## State model and persistence boundaries

### Canonical in-memory state

- `js/state.js` exports a single canonical `state` object.
- `app.js` wraps that object with the dev mutation guard and uses the guarded `appState` everywhere.
- Load/import preserve the root `state` object, but they replace its top-level buckets (`tracker`, `character`, `map`, `ui`) via `replaceStateBuckets(...)`.
- Code can safely keep the root `state` reference, but it should not assume old references to nested buckets survive a load/import boundary.

Top-level state buckets:

- `state.schemaVersion`
- `state.tracker`
- `state.character`
- `state.map`
- `state.ui`

### Persisted stores

- Main structured save:
  - `localStorage["localCampaignTracker_v1"]`
  - written by `saveAllLocal(...)`
  - payload comes from `sanitizeForSave(...)`
- Separate active-tab key:
  - `localStorage["localCampaignTracker_activeTab"]`
  - written by `initTopTabsNavigation(...)`
- IndexedDB database:
  - `localCampaignTracker_db`
  - object stores:
    - `blobs`
    - `texts`

### Persisted main-save state

Persisted through `sanitizeForSave(...)` into `localStorage["localCampaignTracker_v1"]`:

- `state.schemaVersion`
- `state.tracker`
- `state.character`
- `state.map` except runtime-only history
- `state.ui` except runtime-only calculator/dice state

Important persisted UI/state examples:

- Root UI:
  - `state.ui.theme`
  - `state.ui.textareaHeights`
  - `state.ui.panelCollapsed`
  - `state.ui.activeTab`
- Tracker page UI:
  - `state.tracker.ui.sectionOrder`
- Character page UI:
  - `state.character.ui.sectionOrder`
  - `state.character.ui.vitalsOrder`
  - `state.character.ui.abilityOrder`
  - `state.character.ui.abilityCollapse`
  - `state.character.ui.textareaCollapse`
- Map UI:
  - `state.map.ui.activeTool`
  - `state.map.ui.brushSize`
  - `state.map.ui.viewScale`
- Per-map persisted fields:
  - `bgBlobId`
  - `drawingBlobId`
  - `brushSize`
  - `colorKey`

### Persisted outside the main save

- IndexedDB `blobs` stores:
  - character portrait blobs
  - NPC portrait blobs
  - party portrait blobs
  - location image blobs
  - map background blobs
  - map drawing blobs
- IndexedDB `texts` stores:
  - spell notes keyed by `textKey_spellNotes(spellId)`
- `localStorage["localCampaignTracker_activeTab"]` stores the last active top-level page separately from the main save so page restore does not depend on a dirty-save cycle.

### Runtime-only state

Runtime-only state currently includes:

- `state.map.undo`
- `state.map.redo`
- `state.ui.dice`
- `state.ui.calc.history`
- map controller runtime canvas/image/gesture/pointer state
- `blobs.js` object URL cache
- `SaveManager` lifecycle state (`SAVED`, `DIRTY`, `SAVING`, `ERROR`)

Important rule: a field living on `state` does **not** guarantee that it is persisted. `sanitizeForSave(...)` is the source of truth for what survives a save/export.

### Canonical-vs-legacy UI buckets

- Cross-app UI state belongs in `state.ui`.
- `state.tracker.ui` and `state.character.ui` are page-scoped UI buckets.
- The current code still preserves some legacy `tracker.ui` data:
  - theme fallback/read paths in `dataPanel.js`
  - textarea-height migration in `setupTextareaSizing(...)`
- Do not add new cross-app UI settings under `tracker.ui`.

### Schema migration rules

- Current schema version: `2`
- Migration lives in `migrateState(...)` in `js/state.js`.
- `normalizeState(...)` restores runtime-only UI defaults after migration/load/import.
- Unknown future schema versions are accepted as-is to avoid destructive downgrade behavior.

When adding persisted state:

1. Add the default shape in `js/state.js`.
2. Append schema history in `SCHEMA_MIGRATION_HISTORY`.
3. Add/extend a migration step in `migrateState(...)` if older saves need backfill.
4. Decide whether the new field belongs in the main save, IndexedDB, or runtime-only state.
5. Update `sanitizeForSave(...)` if the new field is runtime-only.

## Save lifecycle summary

### Main structured save lifecycle

1. A UI event mutates structured state.
2. The mutating code calls `SaveManager.markDirty()` unless it intentionally opted out with `queueSave: false`.
3. `SaveManager`:
   - marks the app dirty
   - delays the visible `DIRTY` status slightly to avoid flicker
   - debounces save calls
4. `SaveManager.flush()`:
   - transitions to `SAVING`
   - calls `saveAllLocal()`
   - `saveAllLocal()` sanitizes the state and writes `localStorage["localCampaignTracker_v1"]`
   - transitions to `SAVED` or `ERROR`
5. `installExitSave(...)` triggers best-effort flushes on background/exit events.

### Split payload lifecycle

Not all user-visible data follows the same write path:

- Portraits and map images:
  - written to IndexedDB immediately through `putBlob(...)`
  - structured state keeps only blob IDs
  - `SaveManager.markDirty()` is still required so the blob IDs are saved into the main state payload
- Map drawing snapshots:
  - `persistDrawingSnapshot(...)` converts the drawing layer to PNG
  - replaces the previous `drawingBlobId`
  - marks the main state dirty so the new blob ID is persisted
- Spell notes:
  - saved separately through `putText(...)`
  - keyed by `textKey_spellNotes(spellId)`
  - deleted separately when spells or spell levels are deleted
  - not embedded in `state.character.spells`

### Backup/reset lifecycle

- Export:
  - `exportBackup(...)` bundles sanitized structured state plus all referenced blobs and all stored texts into a versioned JSON file.
- Import:
  - validates file size and JSON shape
  - migrates incoming state
  - restores blobs/texts first
  - replaces the live state's top-level buckets on the existing root object
  - saves the imported structured state through `saveAll()`
  - selectively removes old blob/text records that are no longer referenced after a successful save
  - reloads the app
- Reset / clear-images / clear-texts:
  - flush first
  - update state and/or IDB
  - reload afterward for a clean runtime

## Page-by-page ownership boundaries

### Tracker page: `js/pages/tracker/*`

Entry point:

- `initTrackerPage(deps)`

Page-level ownership:

- `#page-tracker`
- campaign title binding (`#campaignTitle` -> `state.tracker.campaignTitle`)
- `#misc` -> `state.tracker.misc`
- tracker page panel ordering via `setupTrackerSectionReorder(...)`

Panel ownership:

- `panels/sessions.js`
  - owns `state.tracker.sessions`
  - owns `state.tracker.sessionSearch`
  - owns `state.tracker.activeSessionIndex`
- `panels/npcCards.js`
  - owns `state.tracker.npcs`
  - owns `state.tracker.npcSections`
  - owns `state.tracker.npcActiveSectionId`
  - migrates legacy `state.tracker.npcActiveGroup`
- `panels/partyCards.js`
  - owns `state.tracker.party`
  - owns `state.tracker.partySearch`
  - owns `state.tracker.partySections`
  - owns `state.tracker.partyActiveSectionId`
- `panels/locationCards.js`
  - owns `state.tracker.locationsList`
  - owns `state.tracker.locSearch`
  - owns `state.tracker.locFilter`
  - owns `state.tracker.locSections`
  - owns `state.tracker.locActiveSectionId`

Current tracker lifecycle model:

- `initTrackerPage(deps)` destroys the previous tracker-page controller before wiring a new one.
- The tracker-page controller owns a page-local destroy stack and registers child `destroy()` APIs returned by tracker panels, Character bootstrap, panel-collapse wiring, and number-stepper enhancement.
- Repeated tracker-page init now depends on explicit teardown, not singleton skip flags.
- Tracker card panels (`npcCards`, `partyCards`, `locationCards`) are instance-scoped controller closures. Their mutable runtime state stays inside the controller instance rather than in hidden module-singleton variables.
- Each tracker card controller owns its listeners through an `AbortController`, detaches masonry on teardown, and returns a real `destroy()` API.
- `locationCards.js` also tears down its enhanced filter dropdown as part of controller destroy.

Tracker card shared-helper boundary:

- `js/pages/tracker/panels/cards/shared/cardIncrementalPatchShared.js` is the current narrow shared extraction for NPC/party/location incremental DOM patch behavior.
- It owns only DOM-facing mechanics shared across those three panels:
  - card lookup by `data-card-id`
  - masonry relayout scheduling
  - focus restoration helpers
  - FLIP-style reorder patching
  - collapsed-state patching
  - portrait DOM patching
- It does not own tracker state shape, collection-specific mutations, search/filter rules, toolbar behavior, migration/defaulting, or card-body rendering.
- Fallback full rerender shells remain panel-local by design. Extracting that shell is intentionally out of scope for the current app/version and should only be revisited if a later change needs to touch all three panels together.

Tracker-card shared helper boundary:

- `js/pages/tracker/panels/cards/shared/*` is shared only by tracker card-style panels (`npcCards`, `partyCards`, `locationCards`).
- Put tracker-card-specific shared behavior there only if it applies to at least two of those panels.
- Do not use that folder as a generic shared UI dumping ground.
- What intentionally remains panel-local today:
  - visible-item selectors and collection keys
  - search/filter rules
  - section bootstrap/defaulting and delete-reassignment rules
  - location-only toolbar/filter wiring
  - card-body rendering and field event wiring
  - panel-specific save-aware mutation helpers

Current implemented coupling:

- `initTrackerPage(...)` currently also calls `initCharacterPageUI(...)`.
- `initTrackerPage(...)` also initializes `initPanelHeaderCollapse(...)` and the global number-stepper enhancement.
- Contributors should treat this as a current bootstrap seam, not as a general pattern to copy into new page modules.

### Character page: `js/pages/character/*`

Entry point:

- `initCharacterPageUI(deps)`

Current bootstrap owner:

- `initCharacterPageUI(...)` is invoked from `initTrackerPage(...)`, not directly from `app.js`.

Page-level ownership:

- `#page-character`
- character page panel ordering via `setupCharacterSectionReorder(...)`
- page-local bind helpers used by panel modules (`bindText`, `bindNumber`)

Panel ownership:

- `panels/basicsPanel.js`
  - `state.character.name`
  - `classLevel`
  - `race`
  - `background`
  - `alignment`
  - `experience`
  - `features`
  - `imgBlobId`
  - document title sync
- `panels/vitalsPanel.js`
  - HP, AC, initiative, speed, proficiency, spell attack/DC, hit-die fields
  - `state.character.resources`
  - `state.character.ui.vitalsOrder`
- `panels/abilitiesPanel.js`
  - `state.character.abilities`
  - skills/skill notes
  - `state.character.ui.abilityOrder`
  - `state.character.ui.abilityCollapse`
- `panels/proficienciesPanel.js`
  - armor/weapon/tool/language text fields
- `panels/attackPanel.js`
  - `state.character.attacks`
- `panels/spellsPanel.js`
  - `state.character.spells.levels`
  - per-spell notes in IndexedDB `texts`
- `panels/equipmentPanel.js`
  - `state.character.inventoryItems`
  - `state.character.activeInventoryIndex`
  - `state.character.inventorySearch`
  - `state.character.money`
  - legacy migration from `state.character.equipment`
- `panels/personalityPanel.js`
  - `state.character.personality`
  - collapsible textarea state via `state.character.ui.textareaCollapse`

Character-specific boundary notes:

- Only spell notes use separate IndexedDB text storage. Other character notes stay in the main structured save.
- Character portrait storage uses the shared image flow, but ownership of `state.character.imgBlobId` stays in character modules.
- `initCharacterPageUI(...)` now destroys the previous character-page controller before re-initializing the page.
- `equipmentPanel.js` and `spellsPanel.js` now return real `destroy()` APIs and clean up their owned listeners/runtime work on teardown.
- Some older Character panels still rely on dataset guards or module-local state. Full tracker-panel lifecycle parity is future refactor roadmap work, not a release blocker for the current character-page destroy/re-init contract.

### Map page: `js/pages/map/*`

Entry point:

- `setupMapPage(deps)`

Controller boundary:

- `setupMapPage(...)` creates and owns one active map controller at a time.
- The controller API is `{ init, load, destroy, render, serialize }`.

Persistent map state ownership:

- `state.map.activeMapId`
- `state.map.maps`
- `state.map.ui.activeTool`
- `state.map.ui.brushSize`
- `state.map.ui.viewScale`
- per-map:
  - `id`
  - `name`
  - `bgBlobId`
  - `drawingBlobId`
  - `brushSize`
  - `colorKey`

Runtime map state ownership:

- live canvases and drawing contexts
- loaded background `Image`
- pointer session state
- gesture session state
- current toolbar/list UI controller references
- current listener `AbortController`

Submodule ownership inside the map page:

- `mapCanvas.js`
  - canvas creation and final render composition
- `mapDrawing.js`
  - draw/erase stroke behavior and restore/clear helpers
- `mapHistory.js`
  - in-memory undo/redo stack
- `mapPersistence.js`
  - load/save drawing and background blob helpers
- `mapBackgroundActions.js`
  - background upload/remove behavior
- `mapGestures.js`
  - pan/zoom/view-scale behavior
- `mapPointerHandlers.js`
  - pointer-to-drawing coordination
- `mapToolbarUI.js`
  - active tool, color, brush size, undo/redo, clear
- `mapListUI.js`
  - add/rename/delete/switch map UI
- `mapUtils.js`
  - map color/math helpers

Map boundary rule:

- Canvas, drawing, gesture, and map-list logic should stay in `js/pages/map/*`.
- Shared UI modules should not know about map canvas internals.

## Shared UI infrastructure boundaries

### Shared UI systems in `js/ui/*`

- `dialogs.js`
  - CSP-safe replacement for native `alert`, `confirm`, and `prompt`
- `navigation.js`
  - top-level page switching, URL hash syncing, and persisted active-tab restore
- `settingsPanel.js` + `dataPanel.js`
  - Data & Settings modal wiring
  - theme changes
  - export/import/reset
  - storage maintenance
  - update checks
- `theme.js`
  - theme resolution and system-theme listener management
- `topbar/*`
  - clock
  - calculator
  - dice roller
- `popovers.js` + `selectDropdown.js` + `positioning.js` + `topbarPopover.js`
  - shared dropdown/popover behavior and placement
- `pagePanelReorder.js`
  - generic two-column panel reorder engine
- `panelHeaderCollapse.js`
  - generic panel collapse/expand persistence for `section.panel`
- `collapsibleTextareas.js`
  - generic textarea collapse/expand persistence used by character-page textareas
- `status.js`
  - shared status line and global error surface
- `searchHighlightOverlay.js`
  - in-field search highlight overlay
- `masonryLayout.js`, `flipSwap.js`
  - generic layout/animation helpers
- `safeAsync.js`
  - promise wrapper for async event handlers
- `bindings.js`
  - generic text/number/contenteditable/checkbox bind helpers

### UI boundary rules

- Shared UI modules may own generic UI state and DOM behavior.
- Shared UI modules should not own tracker/character/map business rules.
- Shared UI modules should validate required DOM anchors with `requireEl(...)` / `requireMany(...)`.
- Shared UI modules should fail soft in production and provide a `destroy()` no-op fallback where practical.

### Narrow global hooks that already exist

The current codebase intentionally exposes a few narrow globals:

- version/build metadata from `boot.js`
- `window.openDataPanel`
- `globalThis.__APP_STATE__` in DEV mode

These are existing seams, not a preferred extension mechanism. New behavior should use module imports or injected callbacks unless there is no reasonable alternative.

## Dependency injection (`deps`) pattern

Most page entries, controllers, and panel modules accept a single `deps` object and validate required values up front.

Common injected dependencies:

- `state`
- `SaveManager`
- `setStatus`
- `uiAlert`, `uiConfirm`, `uiPrompt`
- `Popovers`
- blob helpers:
  - `putBlob`
  - `deleteBlob`
  - `blobIdToObjectUrl`
- text helpers:
  - `putText`
  - `getText`
  - `deleteText`
  - `textKey_spellNotes`
- domain helpers and factories:
  - `createStateActions(...)`
  - `makeNpc`
  - `makePartyMember`
  - `makeLocation`

Rules:

- If a deep module needs storage, dialogs, or page services, inject them.
- Do not add new hidden global dependencies when a `deps` field will do.
- Prefer a single `deps` object over a long positional parameter list.

## Naming conventions and lifecycle expectations

### Naming conventions

- `create*`
  - build a service/controller/helper object
  - examples: `createSaveManager`, `createMapController`, `createThemeManager`
- `init*`
  - initialize and wire a concrete UI module/panel/widget/page
  - examples: `initTrackerPage`, `initTopbarUI`, `initDialogs`
- `setup*`
  - higher-level one-time composition or configuration helpers
  - examples: `setupMapPage`, `setupSettingsPanel`, `setupTextareaSizing`

### Lifecycle expectations

- Modules that own listeners or long-lived resources should return a `destroy()` API.
- Prefer `AbortController` for listener ownership.
- Re-initializable modules should clean up previous instances before creating new ones.
- Shared init helpers commonly return `getNoopDestroyApi()` when prerequisites are missing.

Current reality to be aware of:

- Character page re-init is controller-owned now, but some older Character-panel modules still rely on dataset guards or module-local state.
- The tracker NPC/party/location panels no longer follow that pattern; they are instance-scoped controllers with explicit teardown.
- Do not copy hidden singleton runtime state into new modules unless there is a strong reason and the lifecycle tradeoff is documented.

## Guidance for where new code should go

- New app-wide startup ordering or shared service wiring:
  - `app.js`
- New persisted state defaults, schema history, migrations, or save sanitization:
  - `js/state.js`
- New explicit mutation helpers or factories:
  - `js/domain/*`
- New local persistence/backups/IndexedDB behavior:
  - `js/storage/*`
- New shared UI primitives or generic DOM infrastructure:
  - `js/ui/*`
- New reusable cross-page flows:
  - `js/features/*`
- New page-specific controller/panel logic:
  - `js/pages/<page>/*`
- New tracker-card shared logic used by NPC/party/location cards:
  - `js/pages/tracker/panels/cards/shared/*`
- New low-level helpers without page/storage knowledge:
  - `js/utils/*`
- New service-worker/update behavior:
  - `js/pwa/*`

Placement rule:

- Default to the narrowest existing boundary that fits.
- Only create a new shared abstraction after at least two concrete callers need the same behavior.

## Anti-patterns to avoid

- Writing directly to `localStorage` or IndexedDB from page modules when a storage helper already exists.
- Treating every field on `state` as persisted without checking `sanitizeForSave(...)`.
- Adding new cross-app UI state under `tracker.ui` instead of `state.ui`.
- Importing page modules into shared UI/storage/features layers.
- Copying tracker/character bootstrap coupling into new page modules.
- Adding new narrow globals on `window` when injection or normal imports would work.
- Mutating persisted state without calling `SaveManager.markDirty()` or an action helper that queues saves.
- Bypassing `createStateActions(...)` in code paths where explicit save-aware mutation helpers are available.
- Storing large binary/text payloads inline in the main save when the existing IndexedDB stores are the right fit.
- Mixing migration logic, DOM rendering, and storage I/O in the same module.
- Using raw `innerHTML` for user content instead of DOM APIs / `textContent`.
- Reimplementing dialogs/popovers/navigation instead of using the shared infrastructure already in `js/ui/*`.

## Safe extension rules for future contributors and AI assistants

1. Start from the current boundaries. Extend an existing page/storage/ui module before inventing a new layer.
2. If you add persisted data, update `js/state.js` defaults and migration logic in the same change.
3. If you add runtime-only state under `state`, strip it in `sanitizeForSave(...)` and restore defaults in `normalizeState(...)` if needed.
4. If you add large text or images, store payloads in IndexedDB and persist only IDs/references in the main save.
5. Keep page-specific business rules in `js/pages/<page>/*`.
6. Keep generic UI behavior in `js/ui/*` and reusable flows in `js/features/*`.
7. Validate DOM anchors with `requireMany(...)` / `requireEl(...)` and provide fail-soft behavior outside DEV.
8. Own listeners explicitly and return `destroy()` when a module has real lifecycle.
9. Preserve CSP-safe patterns: use shared dialogs, DOM APIs, and explicit event listeners.
10. Update this document when changing:
   - startup order
   - state shape
   - persistence contract
   - page/module ownership
   - dependency direction rules

## Adding a new page or panel

### Adding a new top-level page

1. Add the page shell to `index.html` as `#page-<name>`.
2. Add a matching top-level tab button with `data-tab="<name>"`.
3. Create `js/pages/<name>/*` with an `init*` or `setup*` entry that accepts `deps`.
4. Wire that page from `app.js`.
5. Add any new persisted state to `js/state.js`.
6. Keep page-specific logic inside `js/pages/<name>/*`.

### Adding a new panel to an existing page

1. Add the required DOM anchors to that page section in `index.html`.
2. Create the panel module under the page's existing folder.
3. Initialize it from the page entry module, not directly from `app.js` unless it is truly cross-page.
4. If the panel adds persisted layout/collapse state, put that state in the owning page's UI bucket or root `state.ui` as appropriate.
