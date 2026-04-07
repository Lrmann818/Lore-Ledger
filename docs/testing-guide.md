# Testing Guide

This is the primary current manual testing guide for Campaign Tracker / Lore Ledger. It pulls together the current release/regression guidance from `docs/SMOKE_TEST.md`, `SMOKE_TEST.md`, and `docs/CSP_AUDIT.md`, while still treating those shorter docs as supplemental checklists and pointing to the current automated coverage for migration, persistence, backup/import, and save-lifecycle behavior.

## 1. Testing philosophy

The project is currently validated primarily through manual testing. There is now targeted automated coverage for the main data-integrity paths, but most user-facing behavior continues to rely on browser-level verification. Because the app is local-first and splits persistence across `localStorage`, IndexedDB blobs, IndexedDB texts, and PWA caches, the highest-risk regressions are:

- data loss after refresh
- broken image or drawing persistence
- failed backup/restore recovery
- offline/PWA regressions in production builds
- CSP or asset-loading failures that block normal usage

Use the smallest test set that matches the change, but always bias toward validating real user flows rather than isolated UI clicks.

Standard setup:

- Use a local server or Vite; never test from `file://`.
- Use `npm run dev` for day-to-day UI, routing, theme, and CSP diagnostics.
- Use `npm run build` and `npm run preview` or a deployed production build for PWA/offline checks. Dev does not register the service worker.
- Prefer a clean browser profile for release validation and any persistence-sensitive checks.
- Optional Windows helper for a clean profile:

```powershell
.\scripts\open-clean-profile.ps1 -Url "http://localhost:5500"
```

Treat any data-loss, restore, offline-shell, or CSP regression as a merge/release blocker.

## 2. Current automated coverage

Vitest is the current unit test runner, and Playwright provides a focused local browser smoke layer. The automated story is split intentionally:

- `npm run verify` is the canonical build-and-unit gate and matches what GitHub Pages CI runs today.
- `npm run test:smoke` is a separate local Chromium smoke pass for browser-only regressions. Keeping it out of CI is the current release-process decision for this version; CI browser provisioning is roadmap work, not release-quality debt.

Canonical local verification commands:

- `npm ci`
  Expected: installs dependencies the same way CI does on a clean runner. Use this when you want the closest local match to GitHub Actions, especially after dependency or lockfile changes.
- `npm run verify`
  Expected: runs the canonical automated local gate: `npm run test:run` and `npm run build`.
- `npm run preview`
  Expected: serves the production build for browser-only validation that CI does not cover.
- `npm run test:smoke`
  Expected: starts a controlled Vite server in production mode on the repo's GitHub Pages base path and runs the current 16-test local Chromium smoke suite covering app boot, map-shell rendering, reload persistence, backup export/import in a fresh browser context, invalid import feedback, tracker-page re-init safety, character-page re-init safety, targeted tracker card-panel behavior, and recent dropdown/popover regression coverage.

Focused dev commands:

- `npm test`
  Expected: starts Vitest in watch mode for local development.
- `npm run test:run`
  Expected: runs the current automated suite once and exits.
- `npm run test:run -- tests/state.migrate.test.js`
  Expected: runs only the migration-focused suite for `migrateState(...)`.

Current automated scope is intentionally targeted:

- `tests/state.migrate.test.js` covers supported legacy migration paths, current-schema normalization, malformed or partial payload repair, inventory backfill, active-inventory clamping, and idempotence.
- `tests/state.sanitize.test.js` covers `sanitizeForSave(...)` top-level copy behavior so save/export sanitization does not mutate the live tracker/character buckets.
- `tests/stateActions.test.js` covers `createStateActions(...)`, including queue-save semantics, tracker-card type aliases, and prototype-pollution/path-hardening guards.
- `tests/storage.persistence.test.js` covers `saveAllLocal(...)` sanitized writes plus `loadAll(...)` behavior for missing storage, corrupt storage, stale-bucket replacement, legacy `imgDataUrl` migration, default-map repair, hit-die alias save/load compatibility, and a representative save/load round trip.
- `tests/storage.blobReplacement.test.js` covers the hardened blob replacement contract: write new, apply new reference, flush structured save, then delete old, with rollback on failure.
- `tests/assetReplacementFlows.test.js` covers portrait/map replacement failure paths so old asset references remain intact when the replacement save cannot be committed.
- `tests/storage.saveManager.test.js` covers the local save lifecycle: dirty-delay timing, debounce behavior, `flush()` results, failure banner behavior, retry after failure, repeated dirty cycles, and `init()` reset behavior.
- `tests/storage.backup.test.js` covers backup export shape, referenced blob/text collection, import validation failures, staged blob/text writes before state swap, rollback attempts for touched text IDs on covered failure paths, cleanup of staged assets after pre-swap failures, and blob-ID remap fallback when an import collides with an existing blob id.
- `tests/smoke/app.smoke.js` covers top-level shell boot in Chromium, opening the Map workspace, and a campaign-title reload-persistence check against the dedicated production-mode Vite server.
- `tests/smoke/backup.smoke.js` covers backup export to a real download, import of that backup into a fresh Chromium browser context, and visible failure handling for invalid JSON import input.
- `tests/smoke/npcPortrait.smoke.js` covers NPC portrait crop/save behavior plus incremental tracker-card patch paths for portrait toggles, search, section moves, reorder, collapse, and focus restoration.
- `tests/smoke/partyLocationPanels.smoke.js` covers the same controller-scoped tracker-card behaviors for Party and Location panels, including location type filtering.
- `tests/smoke/trackerPanelLifecycle.smoke.js` covers repeated `initTrackerPage(...)` calls and checks that tracker panel listeners stay single-bound after re-init.
- `tests/smoke/characterPanelLifecycle.smoke.js` covers repeated `initCharacterPageUI(...)` calls and checks that representative Character page panel actions stay single-bound after teardown/re-init.
- `tests/smoke/dropdownRegression.smoke.js` covers shared dropdown/popover behavior, including enhanced select opening, tracker card menu clickability in the body-ported menu path, and dropdown wiring after rerender.

Critical paths currently protected by automation:

- schema upgrades and load-time normalization for saved state
- local save serialization that strips runtime-only fields while leaving hit-die alias normalization to migration
- startup load behavior when stored data is missing, partial, malformed, or legacy-shaped
- `sanitizeForSave(...)` behavior that must not mutate live top-level tracker/character buckets
- save-aware state-action helper behavior, including prototype-pollution/path hardening on helper paths
- safe blob replacement ordering so replacement failures preserve the previously referenced portrait/map asset
- save-manager failure handling that keeps unsaved-state warnings and recovery behavior honest
- backup import/export invariants, including covered failure cleanup/rollback paths and imported asset preservation on those paths
- one representative structured save/load round trip for the current persisted state shape
- one real-browser boot path through a Vite production-mode server plus one simple reload-persistence check
- one real file download/upload backup round trip in Chromium using the production base path
- tracker panel lifecycle cleanup that makes repeated tracker-page init safer
- character page lifecycle cleanup that makes repeated character-page init safer for the current destroyable panel/controller surface
- tracker incremental DOM patch paths for portrait toggles, reorder, collapse, section moves, search/filter-visible lists, and focus restoration in the tracker card panels
- shared dropdown/popover interaction paths for enhanced selects and tracker card menus after rerender

Manual release checks that remain by decision:

- Broader Character-page rendering and persistence depth beyond the current repeated-init smoke check is a future automation roadmap item, not release-quality debt.
- `Reset Everything` plus full browser restore runs that include images, drawings, and text-backed assets are a future automation roadmap item, not release-quality debt.
- Map drawing, gesture, and touch/mobile behavior beyond basic shell boot is a future automation roadmap item, not release-quality debt.
- PWA install, offline shell, update-banner, cache, and service-worker behavior are a future automation roadmap item, not release-quality debt.
- Cross-browser UI differences outside local Chromium smoke are intentionally out of scope for automated coverage in this version and stay in the manual browser/device matrix.
- End-to-end CSP/startup verification in a real browser session remains a required manual release check because it validates the deployed browser/runtime boundary rather than a missing automated test.

Those gaps are why the manual sections below remain release-critical.

Use `npm run verify` as the default automated pre-merge and pre-release check. The narrower Vitest commands are for faster iteration when you already know which area you are changing.

Intentional differences between local verification and CI:

- CI always starts from a clean Ubuntu runner with Node `20` and runs `npm ci` before the automated gate.
- Local verification can reuse an existing install; run `npm ci && npm run verify` when you want the closest local CI match.
- CI stops after the automated gate. The Pages workflow does not currently install Chromium or run `npm run test:smoke`.
- Local release validation should still include `npm run test:smoke` when browser-level behavior changed, plus the manual browser checks below.

### Conventions for future automated tests

- Keep tests behavior-focused and tied to real exported module APIs such as `migrateState(...)`, `loadAll(...)`, `createSaveManager(...)`, and `importBackup(...)`.
- Prefer one test file per module or critical flow under `tests/*.test.js`, named after the area under test.
- Lock in current compatibility behavior before refactoring persistence or migration code, even when the current behavior is permissive or a little odd.
- Mock browser-only surfaces explicitly in the test so the expectation stays about Lore Ledger behavior, not Vitest environment quirks.
- Assert user-safety outcomes first: preserved data, rejected bad input, rollback on failure, stripped runtime-only state, and stable state after retries.
- When a storage or migration change adds a new supported legacy path or failure mode, add or update tests in the same change.

### CheckJS / JSDoc validation status

The repo also has a repo-wide static-validation path for vanilla JS:

- `tsconfig.checkjs.json` enables `allowJs` + `checkJs` for `app.js`, `boot.js`, `vite.config.js`, `js/**/*.js`, and `types/**/*.d.ts`.
- The currently hardened `@ts-check` surface is narrower than that repo-wide include set and is concentrated in `app.js`, `js/state.js`, all current `js/domain/*` and `js/storage/*` modules, tracker/map orchestration modules, several shared UI primitives, and focused utility/feature modules.
- The broad pass is currently clean and is useful when touching typing work, dependency boundaries, or JSDoc contracts.
- It is still a separate manual check rather than part of `npm run verify` or the current CI gate.
- There is currently no dedicated `package.json` script for this. When maintainers want the broad diagnostic run, the current command is:

```bash
npm exec --yes --package typescript@5.9.3 -- tsc -p tsconfig.checkjs.json
```

## 3. Pre-merge minimum checks

Run these before merging any user-visible change:

1. Run `npm run verify`.
   Expected: the same automated gate CI uses passes locally.
2. If the change touched an existing `@ts-check` module, JSDoc typedefs, `types/*.d.ts`, or module boundary contracts, run the CheckJS command from section 2 when practical.
   Expected: the current broad pass stays clean when you run it, even though it remains an extra manual check rather than part of the canonical `npm run verify` gate.
3. Open the app in `npm run dev` or another local served environment.
   Expected: the changed area loads cleanly and normal interaction does not produce unexpected console errors.
4. Reload the relevant top-level route.
   Expected: `#tracker`, `#character`, and `#map` continue to restore the same page after reload when that area was touched.
5. Run the detailed checks for the affected surface:
   - Persistence or storage change: sections 5 and 9
   - Tracker change: section 6
   - Character change: section 7
   - Map, drawing, or image change: section 8
   - PWA, assets, routing base path, or build-output change: section 10
   - CSP, boot, startup, or asset-loading change: section 11
6. If the change touched themes or boot-time styling, reload once with a non-default theme selected.
   Expected: the saved theme applies immediately with no obvious flash to the wrong theme.

## 4. Pre-release minimum checks

Before any release candidate or production deploy, run the full set below in a clean browser profile:

1. Run `npm run verify`.
2. Complete section 5, including refresh durability and intentional non-persistence checks.
3. Complete sections 6, 7, and 8 for Tracker, Character, and Map.
4. Complete section 9 using a real exported backup file and `Reset Everything`.
5. Complete section 10 against the built preview or deployed site.
6. Complete section 11 with `?dev=1`, then repeat a quick normal flow without the dev flag.
7. Cover the browser/device matrix in section 12.
8. Capture failure evidence using section 13.

Intentional difference from CI:

- CI runs `npm ci`, then the same automated gate as `npm run verify`, and stops before any browser-level validation.
- The current browser smoke suite is intentionally local-only in this version; CI does not provision Chromium or run `npm run test:smoke`, and changing that is roadmap work rather than unresolved release debt.
- Local release validation must continue with the preview/manual sections because CI does not exercise real browser persistence, offline/PWA behavior, or cross-browser interaction flows.

## 5. Persistence regression checks

Use these whenever persistence, save timing, storage migration, image handling, or page initialization changes.

Recommended seeded data:

- one Tracker NPC with a portrait
- one Character portrait plus at least one spell note body
- one Map with a background image and visible drawing

Checks:

1. Refresh durability
   - Edit seeded data on each page.
   - Refresh once.
   - Expected: text, numbers, portraits, spell notes, map background, and map drawing all remain.
2. Active tab restoration
   - Open `#tracker`, `#character`, and `#map` one at a time and reload on each.
   - Expected: the same top-level page remains active after reload.
3. Cross-store persistence
   - Confirm structured fields, blob-backed images, drawing snapshots, and text-backed spell notes all survive the same reload cycle.
4. Persisted UI state when touched by the change
   - Verify the affected search text, filters, collapse state, panel order, textarea size, or active selection survives reload.
5. Intentional non-persistence
   - On `Map`, draw one extra stroke, use `Undo`, then `Redo`, then refresh.
   - Without drawing anything new, press `Undo` and `Redo` again.
   - Expected: the final drawing state persists, but the pre-refresh undo/redo history does not.
   - Also remember that dice history and calculator history are runtime-only.

## 6. Tracker page checks

Baseline checks:

1. Campaign and sessions
   - Edit the campaign title.
   - Add or rename a session, enter notes, switch sessions, and reload.
   - Expected: title, session notes, and active session are preserved.
2. NPCs
   - Add an NPC.
   - Set `Name`, `Class / Role`, `HP Cur`, `HP Max`, `Status`, and notes.
   - Add a portrait image and reload.
   - Expected: the NPC card, field values, and portrait persist.
3. Party
   - Add a party member, edit its main fields, add a portrait if relevant, and reload.
   - Expected: data and images persist.
4. Locations
   - Add a location, set title/type/notes, add an image if relevant, and reload.
   - Expected: data and images persist.

Additional checks when the change touched Tracker rendering or organization:

- Create sections for NPCs, Party, or Locations; move cards between sections; reload; confirm the section assignment persists.
- Use search and filter controls, especially location filtering, and confirm the affected behavior still matches the visible cards.
- Collapse and expand cards, or reorder/collapse Tracker panels if touched, then reload and confirm the UI state persists.
- Watch for duplicate event behavior after rerenders. One click should equal one action.

## 7. Character page checks

Baseline checks:

1. Basics
   - Set character identity fields such as name, class/level, race, background, alignment, experience, and features.
   - Add a character portrait and reload.
   - Expected: fields and portrait persist.
2. Vitals and resources
   - Edit HP, AC, initiative, speed, proficiency, spell attack, spell DC, and at least one resource tracker.
   - Reload.
   - Expected: values persist.
3. Abilities and skills
   - Change at least one ability score and one proficiency/save setting.
   - Expected: derived modifiers, saves, and skills recalculate consistently and remain correct after reload.
4. Attacks, spells, and inventory
   - Add one attack row, one spell, one inventory item, and edit money values.
   - Add a spell note body and reload.
   - Expected: structured rows persist, and the spell note body also persists.
5. Personality and notes
   - Edit one or more personality/notes textareas and reload.
   - Expected: content persists.

Additional checks when the change touched Character-specific UI persistence:

- Reorder Character panels and confirm the order survives reload.
- Reorder vitals/resources or ability blocks if the change touched those systems.
- Verify textarea sizing/collapse behavior still persists for any field using persisted UI sizing.
- If inventory search or the active inventory item changed, confirm the selection/search state survives reload.

## 8. Map page checks

Baseline checks:

1. Map image and drawing persistence
   - Open `Map`.
   - Set a map image.
   - Draw at least one visible stroke.
   - Refresh once.
   - Expected: the map image and drawing remain visible.
2. Undo/redo behavior
   - Draw an additional stroke.
   - Click `Undo`, then `Redo`.
   - Refresh once.
   - Without drawing again, click `Undo` and `Redo`.
   - Expected: the drawing itself persists, but the old undo/redo stack does not.

Additional checks when the change touched map management, tools, or gestures:

- Add a second map, rename it, switch between maps, and verify each map keeps its own background/drawing state.
- Use brush and eraser tools, change brush size and color, and confirm the final rendered state is correct after reload.
- Verify pan/zoom behavior if canvas gestures or view state changed.
- If `Remove Image`, `Clear Map`, or delete-map behavior changed, confirm the action affects only the intended map.
- On a touch-capable device, verify drawing and gesture behavior with touch input.

## 9. Backup/import/export checks

Run this flow whenever persistence, import/export, blobs, texts, or migrations change. It is also a required pre-release check.

1. Seed representative data:
   - Tracker NPC with portrait
   - Character portrait and spell note
   - Map background and drawing
2. Open `Data & Settings`.
3. Under `Backups`, click `Export Backup (.json)` and save the file.
4. Under `Danger Zone`, click `Reset Everything` and confirm.
   Expected: the app reloads to a clean/default state.
5. Open `Data & Settings` again and import the backup file from step 3.
6. Wait for import to finish.
   Expected: import triggers an automatic page refresh.
7. After refresh, verify that prior data returns:
   - Tracker cards and portraits
   - Character data, portrait, and spell note text
   - Map background image and drawing

If import/export code changed, also try one bad input path such as invalid JSON or an unsupported file and confirm the app fails safely instead of partially replacing live data.

For pure `migrateState(...)` changes, the automated Vitest suite documents the current structural behavior. This manual flow is still required because import/export also exercises file parsing, blob restoration, text restoration, reload timing, and startup storage migration outside `migrateState(...)`.

## 10. PWA/offline checks

Use a production build or deployed production site for this section.

1. Run `npm run build`.
2. Run `npm run preview` or open the deployed build.
3. Verify built assets load correctly.
   - Favicon and apple-touch icon load.
   - Dice, settings, calculator, and other UI icons render.
   - The built page exposes a manifest and registers a service worker in production.
4. Open the site once while online.
5. In DevTools, open `Application` and confirm an active service worker is registered.
6. In DevTools `Network`, enable `Offline`.
7. Reload the page.
   Expected: the app shell still loads and `#tracker`, `#character`, and `#map` still work offline.

When the change touched update handling:

- Use the `Check for updates` action in `Data & Settings` and confirm it does not error.
- If you have a staged newer build available, verify the update banner appears and the `Refresh` / `Later` actions behave correctly.

If caches become stale during testing:

1. Unregister the service worker in DevTools.
2. Clear site data in DevTools `Application` -> `Storage`.
3. Close all app tabs, reopen online, and refresh once.

## 11. CSP/security checks

Run this when touching startup code, CSP, asset loading, imports, or browser APIs that may be blocked by policy.

Setup:

1. Serve the app from a local server.
2. Open `http://localhost:5500/?dev=1` or the equivalent dev URL with `?dev=1`.
3. Open DevTools Console.

Intentional DEV-only violation check:

```js
const s = document.createElement("script");
s.textContent = "window.__cspInlineProbe = 'blocked-if-csp-is-working'";
document.head.appendChild(s);
```

Expected result:

- Console shows a clear `[DEV][CSP VIOLATION]` error
- The logged object includes the violation details such as directive and blocked URI

Normal usage audit flows with `?dev=1`:

1. Map draw flow
   - Set a map image, draw on the map, refresh, and confirm persistence.
2. NPC portrait flow
   - Add an NPC, set a name, pick a portrait, refresh, and confirm persistence.
3. Backup flow
   - Export a backup, reset everything, import the backup, and confirm restoration.

Expected result for all normal flows:

- No `securitypolicyviolation` events during normal usage
- No unexpected CSP errors in Console

DEV-off check:

1. Open the app without the dev flag, for example `http://localhost:5500/` or `?dev=0`.
2. Repeat one quick normal flow such as map drawing.

Expected result:

- No DEV CSP audit logging
- No extra CSP audit status noise during normal use

## 12. Suggested browser/device matrix

| Scope | Minimum coverage | Primary purpose |
| --- | --- | --- |
| Every PR | Latest stable Chrome or Edge on desktop | Fast baseline for UI, persistence, and routing |
| Pre-release | Latest stable Chromium desktop plus latest stable Firefox desktop | Cross-browser check for local storage, IndexedDB, layout, and CSP behavior |
| Touch-heavy or map changes | One touch device: iOS Safari or Android Chrome | Drawing, gestures, portrait/image picking, and mobile layout |
| PWA/offline focused changes | One installed PWA or mobile browser with service worker support | Offline shell, update prompt, and cache behavior |

If only one mobile platform is available, prioritize a real touch device over a desktop emulator.

## 13. What evidence to capture on failure

For any failed check, record:

- the exact section and step that failed
- expected result versus actual result
- app version, commit SHA, and whether you were using `npm run dev`, `npm run preview`, or a deployed URL
- browser name/version, OS, device type, and whether a clean profile was used
- whether the failure happened online or offline
- screenshot or short video of the failure
- relevant Console errors, network failures, service worker details, or CSP logs
- the exported backup file, corrupted input file, or sample image involved when the failure is storage-related
- whether the issue reproduces after a hard refresh or in a fresh browser profile

When the failure involves persistence or recovery, include exactly which artifacts were lost: text fields, portraits, spell notes, map background, map drawing, or UI state.
