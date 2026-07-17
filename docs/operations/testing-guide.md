# Testing Guide

This is the primary current manual testing guide for Lore Ledger. It covers testing philosophy, pre-merge and pre-release checks, persistence and page-by-page manual regression coverage, PWA/offline and CSP checks, and the current automated coverage story. For the current Playwright smoke suite posture, see [`browser-smoke-status.md`](./browser-smoke-status.md). For the 5-minute pre-ship checklist, see [`pre-ship-smoke-test.md`](./pre-ship-smoke-test.md). For post-Vite-change validation, see [`vite-smoke-test.md`](./vite-smoke-test.md). For the CSP dev-mode audit, see [`csp-audit.md`](./csp-audit.md).

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

The automated story is split intentionally:

- `npm run verify` is the canonical build-and-unit gate, and the first gate GitHub Pages CI runs.
- `npm run test:smoke` is the focused Chromium smoke pass for browser-only regressions. It runs locally and in CI.
- PWA/offline, preview-based service-worker behavior, and cross-browser coverage remain **manual release checks**, not CI-gated automation.

### Commands

| Command | What it does |
| --- | --- |
| `npm ci` | Clean install, exactly as CI does it |
| `npm run verify` | The canonical gate: `test:run` + `typecheck` + `build` |
| `npm run test` | Vitest in watch mode |
| `npm run test:run` | Vitest once; append `-- tests/state.migrate.test.js` for one suite |
| `npm run typecheck` | Repo-wide CheckJS pass (pinned `typescript@5.9.3`) |
| `npm run test:smoke` | Playwright Chromium smoke suite, production-mode Vite **dev** server |
| `npm run build && npx playwright test --config playwright.preview.config.js` | The same smokes against the real `dist/` build via `vite preview` — the blocking gate for UI-flow changes (an Apply once passed dev-mode smokes but failed only here). A few dev-only harnesses that `import()` source modules are expected to fail under it; see the config header |
| `npm run preview` | Serves the production build — required for any PWA/offline check |

Use `npm run verify` as the default pre-merge and pre-release check. The narrower commands
are for faster iteration when you already know which area you changed.

### What is covered

**Do not maintain a per-test-file inventory here.** It goes stale on every new test file. For
the current picture:

- **Smoke suite** — [`browser-smoke-status.md`](./browser-smoke-status.md) is the canonical
  source: which spec files exist, what each covers, and what is intentionally manual.
- **Unit suite** — run `npm run test:run` to see the current list.

By theme, the Vitest suite concentrates on the things that can silently destroy user data:

- schema migration, load-time normalization, and the fixture-driven save-compatibility
  contract in `tests/fixtures/saves/` (including that freeform `build: null` characters are
  untouched by builder migrations)
- `sanitizeForSave(...)` not mutating live state buckets
- state-action helpers, including prototype-pollution and path hardening
- startup load behavior for missing, partial, malformed, and legacy-shaped data
- safe blob-replacement ordering, so a failed replacement preserves the old asset
- save-manager lifecycle: debounce, failure banners, retry, reset
- backup export/import invariants, staged writes, rollback, and blob-ID remap
- rules-engine derivation, progression, builder seeding, and custom content
- support/debug-info privacy hardening

The Playwright layer concentrates on browser-only regressions: app boot, Campaign Hub,
reload persistence, a real file backup round trip, tracker and character page re-init
safety, Combat Workspace, dropdown/popover behavior, tab drag-to-reorder, splash handoff,
and the builder wizard happy path.

### What stays manual, by decision

The authoritative list is in
[`browser-smoke-status.md`](./browser-smoke-status.md) → "Manual-only coverage by decision".
In short: broader Character-page depth, `Reset Everything` full-restore runs, map
drawing/gesture/touch behavior, PWA/service-worker/offline behavior, and cross-browser
validation outside Chromium. Those gaps are why the manual sections below are
release-critical. End-to-end CSP verification stays manual because it validates the
deployed runtime boundary, not a missing test.

### Local verification vs CI

- CI starts from a clean Ubuntu runner with Node `20`, runs `npm ci`, then `npm run verify`.
- CI then installs Playwright Chromium and runs `npm run test:smoke` before uploading the Pages artifact.
- CI **stops there**. It does not run `npm run preview`, install or check the PWA, force offline mode, or run the browser/device matrix.
- For the closest local match: `npm ci`, `npm run verify`, `npm run test:smoke`. Install Chromium once with `npx playwright install chromium`.
- Local release validation must continue with the preview/manual sections below.

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
   - Vite configuration, build tooling, or dev server change: see [`vite-smoke-test.md`](./vite-smoke-test.md)
6. If the change touched themes or boot-time styling, reload once with a non-default theme selected.
   Expected: the saved theme applies immediately with no obvious flash to the wrong theme.
7. If the change touched textarea or editor styling, inspect the affected long-form editors in at least two themes with focused and unfocused states.
   Expected: session notes, loose notes, inventory notes, and any other touched note editor keep the normal control surface, border, placeholder, and focus treatment instead of showing a flatter or transparent fill.
8. If the change touched shared button, dropdown, or collapse styling, inspect one desktop hover-capable viewport and one touch/coarse-pointer viewport.
   Expected: desktop hover remains visible, keyboard `:focus-visible` still has a clear ring, and touch taps do not leave controls painted with hover or pressed fills after release.

## 4. Pre-release minimum checks

Before any release candidate or production deploy, run the full set below in a clean browser profile. For a faster ~5-minute persistence spot-check that covers the highest-risk refresh, undo/redo, and backup round-trip paths, see [`pre-ship-smoke-test.md`](./pre-ship-smoke-test.md). The full pre-release set below remains the canonical release gate.

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
   - On a real touch device when this area was touched, start a horizontal swipe directly on a session pill and confirm the row scrolls naturally; then long-press a pill for roughly half a second and confirm touch reorder still works intentionally with the insertion cue visible.
   - On desktop when this area was touched, drag a session pill and confirm the row stays horizontally fixed during the active reorder while the insertion cue matches the eventual drop position.
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
- If inventory tab drag-to-reorder was touched, drag tabs into a new order, reload, and confirm the order persists. Also confirm rename and delete still work on a reordered tab.

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

Run this when touching startup code, CSP, asset loading, imports, or browser APIs that a
policy may block.

**The procedure lives in [`csp-audit.md`](./csp-audit.md)** — setup, the intentional
DEV-only violation probe, the normal-usage audit flows, and the DEV-off check. Do not
duplicate it here.

Pass criteria for release:

- With `?dev=1`, the intentional inline-script probe produces a clear `[DEV][CSP VIOLATION]`
  console error including `violatedDirective` and `blockedURI`.
- Normal usage (map draw, NPC portrait, backup export/import) produces **no**
  `securitypolicyviolation` events and no unexpected CSP errors.
- Without the dev flag, there is no DEV CSP audit logging and no extra status noise.

Two related platform checks are owned elsewhere; run them from their own docs rather than
from this section:

- **Native iOS image picking** (native action sheet, no in-app source chooser, and the known
  `Take Photo` WKWebView freeze) — see [`ios-packaging.md`](./ios-packaging.md).
- **Backup export destinations** (macOS native Save dialog, iOS/iPadOS Files export picker,
  never a share popover) — see section 9 above.

## 12. Suggested browser/device matrix

| Scope | Minimum coverage | Primary purpose |
| --- | --- | --- |
| Every PR | Latest stable Chrome or Edge on desktop | Fast baseline for UI, persistence, and routing |
| Pre-release | Latest stable Chromium desktop plus latest stable Firefox desktop | Cross-browser check for local storage, IndexedDB, layout, and CSP behavior |
| Touch-heavy or map changes | One touch device: iOS Safari or Android Chrome | Drawing, gestures, portrait/image picking, and mobile layout |
| PWA/offline focused changes | One installed PWA or mobile browser with service worker support | Offline shell, update prompt, and cache behavior |

If only one mobile platform is available, prioritize a real touch device over a desktop emulator.

### How native scaling works, and how to see it

The native-only uplift is `--ui-scale: 1.08`, applied by
`@media (min-width: 601px) and (min-height: 431px) { html.is-native-app { … } }` in
`styles.css`. A second, narrower comfort layer under the same gate raises topbar icons,
brand sizing, popover widths, calculator keys, and panel/section headings through
`--native-*` tokens. The Character page is **deliberately excluded** from that comfort
layer because it already reads correctly at 1.08×.

⚠️ **`is-native-app` is never applied in browser or PWA mode.** To verify this scaling you
must use the real Capacitor native build, or temporarily add `is-native-app` to the `<html>`
element in DevTools at a viewport of at least `601 × 431`. Browser and PWA runs, and native
widths at `600px` and below, must remain visually unchanged.

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
