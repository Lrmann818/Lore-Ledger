# Browser Smoke Status

This note records the current local browser smoke layer for Lore Ledger as it exists in the repo today.

## Current readiness

- GitHub Pages CI gates on `npm ci` and `npm run verify`.
- Browser smoke coverage exists locally through Playwright. Keeping it local-only is the current release-process decision for this version; CI browser provisioning is roadmap work, not unresolved release debt.
- The smoke suite is intentionally focused. It is broad enough to catch key browser-only regressions in Tracker lifecycle and persistence flows, but it is not a replacement for the manual release checklist.

## Current suite

- The current Chromium suite has 16 smoke tests across:
  - `tests/smoke/app.smoke.js`
  - `tests/smoke/backup.smoke.js`
  - `tests/smoke/characterPanelLifecycle.smoke.js`
  - `tests/smoke/dropdownRegression.smoke.js`
  - `tests/smoke/npcPortrait.smoke.js`
  - `tests/smoke/partyLocationPanels.smoke.js`
  - `tests/smoke/trackerPanelLifecycle.smoke.js`
- The suite runs through a dedicated Vite server in production mode on the production base path `/CampaignTracker/`.
- `npm run test:smoke` is local-only by decision for this version. Release validation still depends on the manual coverage described in [`docs/testing-guide.md`](./testing-guide.md).

## Current smoke scope

The suite currently covers:

1. App shell boot and opening the Map workspace.
2. One structured reload-persistence path through campaign title editing.
3. Backup export/import in a fresh browser context plus invalid import failure handling.
4. Tracker page re-init safety so repeated `initTrackerPage(...)` calls do not leave duplicate panel bindings behind.
5. Character page re-init safety so repeated `initCharacterPageUI(...)` calls keep representative panel actions single-bound after teardown/re-init.
6. Targeted tracker card-panel behavior for NPC, Party, and Location panels:
   - portrait toggle and portrait save flows
   - search and location filter behavior
   - section creation and section moves
   - card reorder and collapse incremental patch paths
   - focus restoration after incremental DOM updates
7. Shared dropdown and popover regressions around enhanced selects, body-ported card menus, keyboard-open behavior, and post-rerender clickability.

## Manual-only coverage by decision

Future automation roadmap items, not release-quality debt:

- broader Character-page rendering and persistence behavior beyond the current repeated-init smoke coverage
- `Reset Everything` and full restore runs with images/drawings/text-backed assets
- map drawing, touch gestures, and mobile interaction behavior
- service worker, update-banner, and offline cache behavior

Intentionally out of scope for this version's automated smoke layer:

- broader cross-browser validation outside local Chromium

## Local run notes

- Playwright browsers are not committed and still need a local install step such as `npx playwright install chromium`.
- The suite uses a dedicated Vite server in production mode with the production base path `/CampaignTracker/`.
- PWA/service-worker validation requires separate manual preview or deployed-site checks; the smoke suite does not cover offline behavior, and broader automation there remains roadmap work rather than unresolved release debt.

## Repo touchpoints

- `@playwright/test` as a dev dependency
- `playwright.config.js` targeting the production base path in Chromium smoke tests
- `tests/smoke/*.smoke.js` for the focused browser suite
- `npm run test:smoke` to run the local Chromium smoke suite
