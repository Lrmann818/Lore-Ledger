# Browser Smoke Status

This note records the current local browser smoke layer for Lore Ledger as it exists in the repo today. It is the canonical source for the current Playwright automation posture — what is covered, what is intentionally manual, and what is out of scope for this version. The broader testing strategy and manual checks live in [`testing-guide.md`](./testing-guide.md).

## Current readiness

- GitHub Pages CI gates on `npm ci`, `npm run verify`, and `npm run test:smoke` after installing Playwright Chromium.
- Browser smoke coverage exists through Playwright locally and in the Pages workflow. CI browser coverage is intentionally limited to the current Chromium smoke suite; PWA/offline automation and broader browser coverage remain roadmap work, not unresolved release debt.
- The smoke suite is intentionally focused. It is broad enough to catch key browser-only regressions in Campaign Hub, Tracker lifecycle, Combat Workspace, and persistence flows, but it is not a replacement for the manual release checklist.

## Current suite

- The current Chromium suite has 61 smoke tests (2026-07-18, green under both the dev-mode and production-preview configs) across:
  - `tests/smoke/app.smoke.js`
  - `tests/smoke/attackEditor.smoke.js`
  - `tests/smoke/attackKeyboard.smoke.js`
  - `tests/smoke/backup.smoke.js`
  - `tests/smoke/builderWizard.smoke.js`
  - `tests/smoke/characterMapPolish.smoke.js`
  - `tests/smoke/characterPanelLifecycle.smoke.js`
  - `tests/smoke/characterRest.smoke.js`
  - `tests/smoke/combatShell.smoke.js`
  - `tests/smoke/customContent.smoke.js`
  - `tests/smoke/dropdownRegression.smoke.js`
  - `tests/smoke/highElfCantrip.smoke.js`
  - `tests/smoke/levelUp.smoke.js`
  - `tests/smoke/npcPortrait.smoke.js`
  - `tests/smoke/partyLocationPanels.smoke.js`
  - `tests/smoke/sessionTabReorder.smoke.js`
  - `tests/smoke/sessionTabTouch.smoke.js`
  - `tests/smoke/splash.smoke.js`
  - `tests/smoke/structuredVitals.smoke.js`
  - `tests/smoke/trackerPanelLifecycle.smoke.js`
- The suite runs through a dedicated Vite server in production mode on the production base path `/`.
- `npm run test:smoke` runs locally and in CI. Release validation still depends on the manual coverage described in [`docs/testing-guide.md`](./testing-guide.md).
- **Production-preview variant (2026-07-17):** `npm run build && npx playwright test
  --config playwright.preview.config.js` runs the same suite against the real
  `dist/` build via `vite preview`. This is the blocking gate for UI-flow
  changes (a dialog Apply once passed dev-mode smokes but failed only under
  preview). Since 2026-07-18 the **full suite passes under both configs**
  (61/61): the seven harnesses that used to `import()` source modules into the
  page (`backup`, `characterPanelLifecycle` ×4, one `combatShell` case,
  `trackerPanelLifecycle`) were reworked onto preview-safe seams — see
  "Preview-safe harness rules" below. Reworking the lifecycle harnesses onto
  the real campaign-shell cycle also exposed and fixed a genuine teardown
  leak: the character page controller created by its internal `rerender()`
  used to escape `destroyCampaignModules()`, staying live while the app sat on
  the Hub (`destroyActiveCharacterPageUI()` in
  `js/pages/character/characterPage.js` now resolves the live controller at
  destroy time).

## Preview-safe harness rules

The preview config serves only the built `dist/` bundle. Repository source
paths such as `js/...` or `tests/...` do not exist there, so a smoke harness
must never depend on browser-side dynamic `import()` of source modules — that
pattern fails against the bundle by construction (it is also a weaker test:
it exercises a synthetic module graph instead of the shipped app). The final
gate for any smoke-harness change is:

```bash
npm run test:smoke                                                  # dev-mode gate
npm run build && npx playwright test --config playwright.preview.config.js  # production gate
```

Both must be fully green. Write harnesses against these seams, all of which
behave identically under both configs:

1. **Visible UI** — real clicks, fills, and dialogs (`submitPromptDialog(...)`
   in `tests/smoke/helpers/smokeApp.js` drives the shared prompt dialog).
2. **The real campaign-shell lifecycle** — `cycleCampaignShell(...)` /
   `reopenCampaignFromHub(...)` leave for the Hub and re-enter, which runs the
   production `destroyCampaignModules()` → `initCampaignModules()` path. This
   is the preview-safe replacement for the old dev-only pattern of importing
   page modules and re-initializing them by hand, and it tests the real
   teardown wiring instead of a synthetic one.
3. **Persisted storage** — read/write `localStorage["localCampaignTracker_v1"]`
   directly, and read IndexedDB through public browser APIs
   (`readStoredSpellNote(...)` mirrors the persisted texts-store contract from
   `js/storage/idb.js` + `js/storage/texts-idb.js`; update it alongside any
   storage-shape change).
4. **The DEV-mode `__APP_STATE__` escape hatch** — available under both
   configs because they serve on `127.0.0.1` (`detectDevMode()` treats local
   hosts as DEV). Use it for state assertions, not for driving mutations.
5. **Node-side setup** — file fixtures, `addInitScript` environment shaping,
   and Playwright APIs run in the test process and are always safe.

Do not add new globals or production code branches for tests, do not skip or
expected-fail tests under one config, and do not branch selectors per
environment.

## Current smoke scope

The suite currently covers:

1. App shell boot, Campaign Hub first-run/create/open/rename/delete flows, and Hub responsive layout checks.
2. Opening the Map workspace and one structured reload-persistence path through campaign title editing.
3. Backup export/import in a fresh browser context plus invalid import failure handling.
4. Tracker page re-init safety: repeated real campaign-shell cycles (Hub round trips through `destroyCampaignModules()` → `initCampaignModules()`) leave the static add/section controls single-bound.
5. Character page re-init safety: the same real shell cycles keep representative panel actions (attacks, spell levels, inventory tabs, resources, abilities/skills) single-bound, verify the dynamically injected ability controls are removed at the Hub and rebuilt exactly once, and pin persistence of edits across the cycle.
6. Targeted tracker card-panel behavior for NPC, Party, and Location panels:
   - portrait toggle and portrait save flows
   - search and location filter behavior
   - section creation and section moves
   - card reorder and collapse incremental patch paths
   - focus restoration after incremental DOM updates
7. Shared dropdown and popover regressions around enhanced selects, body-ported card menus, keyboard-open behavior, and post-rerender clickability.
8. Combat Workspace shell, Combat Cards, round controls, HP/temp HP, AC display, status effects, turn undo, tracker HP/status-label writeback exceptions, mobile stacking, and embedded panel selection/reorder/source-panel behavior. Manual QA still covers zero-HP Death Saves replacement, pass/fail checkbox behavior, Stabilize confirmation, editable combat-card AC on touch hardware, and iPhone portrait/landscape combat-card layout.
9. Session tab drag-to-reorder in a real browser (`sessionTabReorder.smoke.js`): stable-id commit-on-drop ordering, drop-cue rendering, active-drag scroll locking, and reorder persistence across a full page reload.
10. Touch-pointer session tab behavior (`sessionTabTouch.smoke.js`): quick swipes stay native scrolling; deliberate hold-to-drag reorder still works.
11. Native-style splash handoff (`splash.smoke.js`): the managed splash holds through the minimum duration and reveals the active campaign shell without leaving the Hub visible.
12. Character/Map polish breakpoints (`characterMapPolish.smoke.js`): narrow two-column Ability card header spacing, single-column mobile fallback, and Map workspace title/toolbar shell stability at narrow widths.
13. Builder wizard happy path (`builderWizard.smoke.js`): create a Dragonborn through identity → race choices (Draconic Ancestry) → manual abilities → summary → Finish; verifies the created character is in builder mode, finish-time seeding lands in Features/Traits and Languages, the derived Breath Weapon card renders in Abilities & Features, the Builder Summary panel appears, and the seeded sheet survives a full reload.

## Manual-only coverage by decision

Future automation roadmap items, not release-quality debt:

- broader Character-page rendering and persistence behavior beyond the current repeated-init smoke coverage
- `Reset Everything` and full restore runs with images/drawings/text-backed assets
- map drawing, touch gestures, and mobile interaction behavior
- service worker, update-banner, and offline cache behavior

Intentionally out of scope for this version's automated smoke layer:

- broader cross-browser validation outside local Chromium

## Local run notes

- Playwright browsers are not committed. CI installs Chromium before the smoke run; local machines still need a one-time install step such as `npx playwright install chromium`.
- The suite uses a dedicated Vite server in production mode with the production base path `/`.
- PWA/service-worker validation requires separate manual preview or deployed-site checks; the smoke suite does not cover offline behavior, and broader automation there remains roadmap work rather than unresolved release debt.

## Repo touchpoints

- `@playwright/test` as a dev dependency
- `playwright.config.js` targeting the production base path in Chromium smoke tests
- `playwright.preview.config.js` running the identical suite against the built `dist/` via `vite preview`
- `tests/smoke/*.smoke.js` for the focused browser suite, with shared preview-safe helpers in `tests/smoke/helpers/smokeApp.js`
- `npm run test:smoke` to run the local Chromium smoke suite
- `npm run build && npx playwright test --config playwright.preview.config.js` for the production-preview gate
