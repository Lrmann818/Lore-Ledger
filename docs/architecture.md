# Architecture

This doc captures intended module boundaries, aligned with the current refactor implementation.

## Design goals

- **Offline-first**: everything works without a network.
- **Modular**: page modules are isolated and wired from one composition root.
- **CSP-friendly**: avoid inline handlers/eval and keep dialog/storage flows safe.
- **Low global surface area**: prefer ES modules + injected deps over globals.

> Editing rules for AI-assisted changes live in `/AI_RULES.md`.

## Top-level entrypoints

### `index.html`
- Defines the app shell and page sections (`#page-tracker`, `#page-character`, `#page-map`).
- Loads `boot.js` in `<head>` and `app.js` as an ES module at the end of `<body>`.
- Defines strict CSP and all required DOM anchors for page/panel modules.

### `boot.js`
- Runs before `app.js`.
- Reads the Vite-defined `__APP_VERSION__` constant and exposes `window.__APP_VERSION__`/`window.APP_VERSION`.
- Reads persisted theme from local storage and applies `document.documentElement.dataset.theme` early to avoid flash/mismatch.

### `app.js`
- Acts as the composition root.
- Creates shared services (state guard, SaveManager, Popovers, Theme, status API, shared image picker).
- Loads/migrates persisted state, then wires global UI and page modules.
- Owns startup order and dependency injection, but not page-level rendering details.

## Startup and wiring flow (current)

1. Install the dev state mutation guard (`installStateMutationGuard`) and use the guarded `appState`.
2. Build shared services:
   - `SaveManager` (`createSaveManager`)
   - popover manager (`createPopoverManager`)
   - theme manager (`createThemeManager`)
   - shared file picker (`createFilePicker`)
3. Load persisted state via `loadAll(...)` (migration + legacy image/map conversions).
4. Initialize shared UI systems:
   - dialogs (`initDialogs`)
   - theme (`Theme.initFromState`)
   - top navigation (`initTopTabsNavigation`)
   - settings/data panel (`setupSettingsPanel`)
   - topbar widgets (`initTopbarUI`)
5. Initialize pages/features:
   - tracker page (`initTrackerPage`) which also initializes character page UI
   - textarea and numeric autosize helpers
   - map page (`setupMapPage` -> map controller)
6. Flush once after startup (`SaveManager.flush()`), then mark save lifecycle ready (`SaveManager.init()`).

## Module layers and dependency direction

### `js/state.js`
- Canonical state defaults + schema migration + serialization sanitization.
- Also owns map-manager helpers (`ensureMapManager`, `getActiveMap`, `newMapEntry`).

### `js/domain/*`
- Domain-level helpers:
  - `factories.js` for tracker entity creation (`makeNpc`, `makePartyMember`, `makeLocation`)
  - `stateActions.js` for explicit state mutation helpers (`createStateActions`)

### `js/storage/*`
- Persistence layer:
  - localStorage (`persistence.js`)
  - IndexedDB (`idb.js`, `blobs.js`, `texts-idb.js`)
  - backup/import/reset (`backup.js`)
  - save lifecycle manager (`saveManager.js`)

### `js/ui/*`
- Shared UI infrastructure:
  - dialogs (`dialogs.js`)
  - popovers/dropdowns (`popovers.js`, `selectDropdown.js`)
  - navigation/theme/status/settings/topbar helpers
  - generic bindings/reorder/collapse helpers

### `js/features/*`
- Reusable flows/helpers not tied to one page:
  - autosize
  - image picking/cropping/portrait flow
  - number steppers

### `js/pages/*`
- Page-specific orchestration and panel/controller modules:
  - tracker
  - character
  - map

### `js/utils/*`
- Low-level utilities (`dev.js`, `domGuards.js`, numeric helpers, etc.).

### Direction (as implemented)
- `app.js` imports from all layers and wires them together.
- `js/pages/*` depends on `ui`, `features`, `domain`, `utils`, and receives storage functions via injected deps.
- `js/ui/*` is mostly page-agnostic; `ui/panelHeaderCollapse.js` intentionally consumes `domain/stateActions.js`.
- `js/storage/*` is mostly UI-agnostic; current exception: `storage/backup.js` uses `ui/dialogs.js` for confirm/alert UX.
- `js/state.js` does not import from pages/ui/storage.

## Page module boundaries

### Tracker page (`js/pages/tracker/*`)
- Entry: `initTrackerPage(deps)`.
- Wires campaign title/misc bindings, tracker section reorder, and panel modules:
  - `panels/sessions.js`
  - `panels/npcCards.js`
  - `panels/partyCards.js`
  - `panels/locationCards.js`
- Card panels share helpers under `panels/cards/shared/*` (search, footer/header controls, portrait rendering, section select, etc.).
- Also initializes character UI (`initCharacterPageUI`) as part of tracker/character bootstrap.

### Character page (`js/pages/character/*`)
- Entry: `initCharacterPageUI(deps)`.
- Delegates to panel modules:
  - `basicsPanel`, `vitalsPanel`, `abilitiesPanel`, `proficienciesPanel`
  - `attackPanel`, `spellsPanel`, `equipmentPanel`, `personalityPanel`
- Includes character section reorder + collapsible textarea state wiring.

### Map page (`js/pages/map/*`)
- Entry: `setupMapPage(deps)` manages active map-page controller lifecycle.
- Core controller: `createMapController(...)` with API `{ init, load, destroy, render, serialize }`.
- Controller composes focused modules:
  - canvas/render (`mapCanvas.js`)
  - drawing actions (`mapDrawing.js`)
  - history stack (`mapHistory.js`)
  - persistence helpers (`mapPersistence.js`)
  - background image actions (`mapBackgroundActions.js`)
  - gestures/pan-zoom (`mapGestures.js`)
  - pointer drawing handlers (`mapPointerHandlers.js`)
  - toolbar/list UI (`mapToolbarUI.js`, `mapListUI.js`)
  - color/math utils (`mapUtils.js`)

## Dependency injection (`deps` object) pattern

Most page/panel modules accept a single `deps` object and validate required dependencies up front.

Common injected deps include:
- `state`
- `SaveManager`
- status surface (`setStatus`)
- dialog APIs (`uiAlert`, `uiConfirm`, `uiPrompt`)
- popover manager (`Popovers`)
- storage helpers (`putBlob`, `deleteBlob`, `blobIdToObjectUrl`, `putText`, `getText`, etc.)
- domain helpers/factories (`createStateActions`, `makeNpc`, `makePartyMember`, `makeLocation`)

This keeps wiring centralized in `app.js`, reduces hidden coupling, and makes modules easier to refactor/test.

## Naming conventions (current)

- `create*`: build a service/controller/helper object (for example `createMapController`, `createSaveManager`, `createPopoverManager`).
- `init*`: initialize and wire a concrete UI module/panel/page section.
- `setup*`: higher-level composition wrappers or one-time setup helpers (for example `setupMapPage`, `setupSettingsPanel`, `setupTextareaSizing`, `setupPagePanelReorder`).

## Lifecycle expectations

- Controller/service modules usually expose `destroy()` for teardown.
- Map controller exposes `init/load/destroy` and is torn down before re-init in `setupMapPage`.
- Many UI modules are idempotent by design (dataset guards + noop destroy fallback via `getNoopDestroyApi()`).
- Listener ownership is explicit in controller-driven modules (commonly via `AbortController`).

## Cross-cutting systems

- **Save lifecycle**: `SaveManager` centralizes dirty/saving/saved/error state, debounce, and flush.
- **Persistence flow**: `persistence.loadAll()` migrates legacy shapes and blob/data-url state; `saveAllLocal()` writes sanitized state.
- **State mutation guard (dev)**: `utils/dev.js` proxies state and warns/throws on direct writes outside allowed mutation scopes.
- **State action helpers**: `domain/stateActions.js` provides explicit mutation helpers that also queue save.
- **Popovers/dropdowns**: shared manager in `ui/popovers.js`, with `ui/selectDropdown.js` and topbar/map integrations.
- **Dialogs**: CSP-safe modal replacements in `ui/dialogs.js` (`uiAlert`, `uiConfirm`, `uiPrompt`).
- **Search highlight overlay**: `ui/searchHighlightOverlay.js`, used in sessions, tracker cards, and equipment notes.

## CSP and DOM safety

- CSP is enforced at `index.html` (no inline script handlers, `script-src 'self'`).
- UI modules use explicit DOM guards (`requireEl`) and fail soft with status reporting when anchors are missing.
- Dialog/search rendering paths use DOM APIs and `textContent` for user text instead of raw HTML injection.

## Adding a new page/section

1. Add page markup to `index.html` (for example `#page-foo`).
2. Add a matching tab button with `data-tab="foo"`.
3. Create `js/pages/foo/*` module(s) with `init*`/`setup*` entry function(s) that take `deps`.
4. Wire the new page in `app.js` by passing required dependencies.
5. Keep page-specific logic in `js/pages/foo/*`; keep shared UI/storage behavior in their existing layers.
