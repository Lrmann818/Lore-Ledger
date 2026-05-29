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

Vitest is the current unit test runner, and Playwright provides a focused Chromium browser smoke layer. The automated story is split intentionally:

- `npm run verify` is the canonical build-and-unit gate and is the first automated gate GitHub Pages CI runs today.
- `npm run test:smoke` is the focused Chromium smoke pass for browser-only regressions. It now runs locally and in GitHub Pages CI after Playwright Chromium is installed.
- PWA/offline, preview-based service-worker behavior, and broader cross-browser coverage are still manual release checks, not CI-gated automation in this version.

Canonical local verification commands:

- `npm ci`
  Expected: installs dependencies the same way CI does on a clean runner. Use this when you want the closest local match to GitHub Actions, especially after dependency or lockfile changes.
- `npm run verify`
  Expected: runs the canonical automated local gate: `npm run test:run`, `npm run typecheck`, and `npm run build`.
- `npm run typecheck`
  Expected: runs the repo-wide CheckJS pass through the repo-pinned `typescript@5.9.3` compiler.
- `npm run preview`
  Expected: serves the production build for browser-only validation that CI does not cover.
- `npm run test:smoke`
  Expected: starts a controlled Vite server in production mode on the repo's GitHub Pages base path and runs the current local Chromium smoke suite covering app boot, Campaign Hub flows/layouts, managed splash handoff, map-shell rendering, reload persistence, backup export/import in a fresh browser context, invalid import feedback, tracker-page re-init safety, character-page re-init safety, targeted tracker card-panel behavior, Combat Workspace card/round/status/embedded-panel behavior, and recent dropdown/popover regression coverage.

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
- `tests/storage.backup.test.js` covers backup export shape, explicit native-document-export/save-picker/direct-download strategy selection, native export success/cancel/failure handling, save-picker success/cancel behavior, referenced blob/text collection, import validation failures, staged blob/text writes before state swap, rollback attempts for touched text IDs on covered failure paths, cleanup of staged assets after pre-swap failures, and blob-ID remap fallback when an import collides with an existing blob id.
- `tests/support.test.js` covers the focused support helpers: safe debug-info formatting, mailto generation, runtime/context capability hints, and route/query-string hardening so copied debug info stays privacy-safe.
- `tests/dataPanel.support.test.js` covers `Data & Settings` -> `Support` wiring, support summary display, `Report Bug`, `Copy Debug Info`, hub-versus-active-campaign debug snapshots, clipboard success, and both copy/mailto fallback paths when platform features are unavailable.
- `tests/imagePicker.test.js` covers the image picker: file selection returning the chosen File, clean cancellation via the cancel event, `image/*` accept attribute (which produces the native iOS Photo Library / Take Photo / Files action sheet), absence of any in-app source chooser overlay, and request serialization so concurrent picks do not race.
- `tests/sessionsPanel.test.js` covers session tab click selection, drag-to-reorder (stable-id commitment, release-click suppression after drag), sub-threshold pointer movement that must not trigger reorder or click suppression, drag followed by rename preserving the reordered position via stable id, and drag followed by delete leaving no stale tab entries in state or DOM.
- `tests/smoke/app.smoke.js` covers top-level shell boot in Chromium, opening the Map workspace, and a campaign-title reload-persistence check against the dedicated production-mode Vite server.
- `tests/smoke/backup.smoke.js` covers save-picker selection in a desktop installed-PWA-like runtime, direct-download export/import round trips in Chromium when the picker is unavailable, and visible failure handling for invalid JSON import input.
- `tests/smoke/combatShell.smoke.js` covers the Combat tab shell, Combat Cards, round controls, HP/temp HP actions, AC display, status effects, turn undo, tracker writeback for HP/status labels, role/order/remove/clear flows, mobile stacking, and embedded panel selection/reorder/source-panel behavior. Death Saves visibility, checkbox interaction, long-press stabilization, and TestFlight portrait-card layout still need explicit manual QA.
- Native/TestFlight-only tablet and desktop-width UI scaling is intentionally gated to Capacitor-style runtimes and only activates above the shared `600px` mobile shell breakpoint. Browser/PWA runs and native widths at `600px` and below should remain visually unchanged. The scale uplift (`--ui-scale: 1.08`) is app-wide and routes through CSS custom-property tokens inherited from `html.is-native-app`. It covers: all plain `button` elements (global `font-size: var(--label-font-size)` via the shared button rule), Campaign Hub shell/layout/panel gaps, campaign count badge padding, campaign card padding, empty-state padding, hero-copy/divider gaps, section-header/form gaps, map toolbar brush-size-label gap, color-picker grid cell size/gap/padding, dropdown button gap, dropdown group label padding, map bar bottom margin, vitals tile label font-size (`charTileLabel`), resource title font-size, skill-row span font-size, save-options labels/grid/row gaps, and all previously covered topbar, character, combat, tracker, settings, calculator, and dice surfaces. A second, narrowly scoped comfort layer (appended at the bottom of `styles.css` under the same `@media (min-width: 601px) and (min-height: 431px) { html.is-native-app { … } }` gate) targets only the shell surfaces that need more than 1.08× to feel intentional on tablet/desktop: topbar icon sizes (`--native-icon-size`), topbar brand sizing (`--native-topbar-title-size` for `#campaignTitle` plus `--native-topbar-status-size` for the smaller `#statusText` line), the shared topbar control-height override (`--native-btn-min-h` via `--topbar-control-height` for nav and icon buttons together), calc/dice popover widths (`--native-popover-w`) and button heights (`--native-popover-btn-h`), calculator key font size (`--native-calc-key-font`), panel/section-heading font sizes (`--native-popup-title`, `--native-section-head`), settings panel width (`--native-panel-w`), and the map toolbar "Map" label weight. The Character page is deliberately excluded from this comfort layer because it already looks correct at 1.08×. Manual verification of this scaling must be done in the actual Capacitor native build or by temporarily adding `is-native-app` to the `<html>` element in DevTools at a viewport ≥ 601×431 — the class is not applied in browser or PWA mode.
- `tests/smoke/npcPortrait.smoke.js` covers NPC portrait crop/save behavior plus incremental tracker-card patch paths for portrait toggles, search, section moves, reorder, collapse, and focus restoration.
- `tests/smoke/partyLocationPanels.smoke.js` covers the same controller-scoped tracker-card behaviors for Party and Location panels, including location type filtering.
- `tests/smoke/trackerPanelLifecycle.smoke.js` covers repeated `initTrackerPage(...)` calls and checks that tracker panel listeners stay single-bound after re-init.
- `tests/smoke/sessionTabReorder.smoke.js` covers session tab drag-to-reorder in a real browser: adding a second session, dragging the first tab past the second tab's midpoint, confirming the DOM order changes, and confirming the reordered order survives a full page reload via localStorage persistence.
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
- real-browser Campaign Hub first-run, layout, rename/delete, app boot, and one simple reload-persistence path through a Vite production-mode server
- one real file download/upload backup round trip in Chromium using the production base path
- tracker panel lifecycle cleanup that makes repeated tracker-page init safer
- character page lifecycle cleanup that makes repeated character-page init safer for the current destroyable panel/controller surface
- tracker incremental DOM patch paths for portrait toggles, reorder, collapse, section moves, search/filter-visible lists, and focus restoration in the tracker card panels
- Combat Workspace behavior for combat tab layout, card actions, HP/temp HP, status timing, turn undo, tracker HP/status-label writeback exceptions, mobile stacking, and embedded character panels
- shared dropdown/popover interaction paths for enhanced selects and tracker card menus after rerender
- session tab drag-to-reorder: stable-midpoint index calculation, commit-on-drop ordering, sub-threshold no-op, rename-after-reorder id stability, delete-after-reorder cleanup, and reload persistence

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

- CI always starts from a clean Ubuntu runner with Node `20`, runs `npm ci`, then runs `npm run verify`.
- CI installs Playwright Chromium and runs `npm run test:smoke` before uploading the Pages artifact.
- Local verification can reuse an existing install; run `npm ci`, `npm run verify`, and `npm run test:smoke` when you want the closest local CI match. Install Chromium once with `npx playwright install chromium` if needed.
- CI stops after the automated browser smoke gate. It does not run `npm run preview`, install/check the PWA, force offline mode, or run the manual cross-browser/device matrix.
- Local release validation should still include the preview/manual browser checks below.

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
- `npm run typecheck` is the dedicated script for this pass, and it is part of `npm run verify` plus the current CI gate.
- The repo pins `typescript@5.9.3` as a dev dependency so this pass does not depend on a maintainer's globally cached or locally installed TypeScript version.
- Maintainers can still run the broad diagnostic directly with:

```bash
npm run typecheck
```

## 3. Pre-merge minimum checks

Run these before merging any user-visible change:

1. Run `npm run verify`.
   Expected: the same build-and-unit gate CI runs first passes locally.
2. If the change touched an existing `@ts-check` module, JSDoc typedefs, `types/*.d.ts`, or module boundary contracts, use `npm run typecheck` directly when you want a faster isolated typing pass during iteration.
   Expected: the current broad pass stays clean when you run it.
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

- CI runs `npm ci`, `npm run verify`, installs Playwright Chromium, and runs `npm run test:smoke`.
- CI stops after the focused Chromium smoke suite. It does not exercise preview-based service-worker behavior, offline/PWA behavior, installed-app behavior, or cross-browser interaction flows.
- Local release validation must continue with the preview/manual sections because those browser/PWA checks remain outside the CI gate.

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
   - Add or rename a session, enter notes, switch sessions, drag session tabs into a new order, and reload.
   - Expected: title, session notes, active session, and the reordered session-tab order are preserved.
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
   Expected on supported macOS/desktop browsers and installed PWAs: a native Save dialog opens with `campaign-backup-YYYY-MM-DD.json` suggested, you choose the destination, and a real `.json` file is written there.
   Expected on unsupported desktop browsers: the browser falls back to a real `campaign-backup-YYYY-MM-DD.json` download, usually in Downloads depending on browser settings.
   Expected on macOS desktop browsers and installed PWAs in all cases: do not see a share popover with only Copy/Edit Extensions.
   Expected on iPhone/iPad native/TestFlight builds: the app opens a native Files export/save picker, not a share popover, and the backup is saved as a real `.json` file to the chosen destination.
   Expected on iOS browser/PWA contexts: stay on the web save path; do not assume a native share/export picker is available.
   For installed PWAs, also note the visible `Version x.y.z • Build <sha>` line in `Data & Settings` or the `About` dialog so you can prove which build produced the file.
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

If export-path diagnosis is needed on a maintainer machine:

1. In DevTools Console, run `localStorage.setItem("loreledger:debug-backup-export", "1")`.
2. Export a backup again.
3. Inspect the `[backup-export]` console entries for platform, user agent, touch points, display-mode/PWA detection, `showSaveFilePicker` availability, `navigator.share` availability, Capacitor presence/platform/native flags, native plugin availability, selected strategy, and attempted delivery path.
4. Clear the flag afterward with `localStorage.removeItem("loreledger:debug-backup-export")`.

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
- For installed PWAs, do not trust the running app version until you confirm the `Version`/`Build` line in `Data & Settings` or `About` matches the build you just deployed. This app uses prompt-style service-worker updates, so an installed app can continue running an older cached bundle until the user refreshes/applies the update.

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
3. Native iOS/TestFlight image-picking flow
   - On a real iPhone native/TestFlight build, open any portrait picker and confirm the **native iOS action sheet** appears directly — `Photo Library`, `Take Photo`, and `Files` options are shown by iOS, not by a Lore Ledger modal.
   - No Lore Ledger source chooser (no "Add image" overlay) should appear.
   - Choose `Photo Library`, select an image, and confirm Lore Ledger opens it in the crop modal.
   - Choose `Files`, select an image, and confirm Lore Ledger opens it in the crop modal.
   - Cancel the picker and confirm the app returns cleanly with no stuck overlay.
   - ⚠️ **Known issue — Take Photo**: Selecting `Take Photo` from the native WKWebView file-input action sheet may cause the app to freeze after the user captures a photo. This is a known iOS/WKWebView bug. Do not reintroduce the custom in-app source modal as a workaround; a dedicated Capacitor native-camera bridge is the correct long-term fix. Document any freeze on a real device and track it separately.
4. Backup flow
   - On supported macOS desktop browser/PWA, export a backup and confirm a native Save dialog lets you choose the destination and writes a real `.json` file there.
   - On unsupported desktop browser/PWA, export a backup and confirm the fallback download still produces a real `.json` file.
   - On an installed iPhone TestFlight build, export a backup and confirm the native Files export picker opens instead of a share popover, then save `campaign-backup-YYYY-MM-DD.json` and confirm it is visible in Files.
   - On an installed iPad TestFlight build, repeat the same flow and confirm the native Files export picker still allows choosing a destination and saving a real `.json` file.
   - On an Apple Silicon Mac running the iOS TestFlight build when available, export a backup and confirm Finder presents a native save/export destination flow rather than the Copy/Edit Extensions share popover.
   - Reset everything, import the exported backup, and confirm restoration.

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

When a change touches native/TestFlight layout scaling, add this manual matrix on top of the normal browser/device coverage:

- iPhone native/TestFlight portrait at `<=600px`
  Expected: mobile sizing is unchanged and no new horizontal scrolling or clipping appears.
- iPhone native/TestFlight landscape at `<=600px`
  Expected: still uses the mobile shell with unchanged scale and no new overflow in headers, cards, or controls.
- iPad/native tablet portrait at `>=601px` — check all workspaces:
  - Campaign Hub: campaign cards, badge text, hub panel padding, eyebrow labels, and action buttons all appear visually larger than the browser/PWA equivalent.
  - Tracker: NPC/Party/Location card titles, panel-control buttons, search inputs, section headers, and collapse buttons all scale with the uplift.
  - Character: existing scale uplift from the previous pass remains; ability stats, skill labels, charTile padding, and fieldLabel text continue to scale.
  - Combat: combat modal paddings, stat tiles, death-save layout, combat status chips, and round-stats grid all scale.
  - Map: map-select and tool-button font sizes, color picker swatches, and dropdown paddings all scale.
  - Settings/Dialogs: settings label, modal title, modal button padding, and data-panel section padding all scale.
  - Calculator/Dice: display font, key padding, key height, history-item font, and dropdown padding all scale.
  - Collapse buttons and panel-control search/filter inputs: visible size increase vs. the browser/PWA equivalent.
  Expected for all surfaces: native-only scale uplift is visible across text, buttons, chips, and panel spacing; underlying layout structure is unchanged.
- iPad/native tablet landscape and desktop-width native wrapper at `>=601px`
  Expected: the same app-wide native-only scale uplift remains readable across all workspaces, with no horizontal scrolling and no obvious overlap in panel headers, spell rows, combat cards, portrait cards, or calculator/dice dropdowns.

## 13. What evidence to capture on failure

For any failed check, record:

- the exact section and step that failed
- expected result versus actual result
- app version, commit SHA, and whether you were using `npm run dev`, `npm run preview`, or a deployed URL
- browser name/version, OS, device type, and whether a clean profile was used
- if the app is open, include `Data & Settings` -> `Support` -> `Copy Debug Info`; it is the fastest way to capture version, build id, runtime label/context, campaign-active status, current page, support capability hints, timestamp, and user agent without copying saved campaign data
- whether the failure happened online or offline
- screenshot or short video of the failure
- relevant Console errors, network failures, service worker details, or CSP logs
- the exported backup file, corrupted input file, or sample image involved when the failure is storage-related
- whether the issue reproduces after a hard refresh or in a fresh browser profile

When the failure involves persistence or recovery, include exactly which artifacts were lost: text fields, portraits, spell notes, map background, map drawing, or UI state.
