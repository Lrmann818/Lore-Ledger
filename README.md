# Campaign Tracker

`CampaignTracker` is the repository for `Lore Ledger`, a local-first D&D campaign companion built with vanilla HTML, CSS, and JavaScript. It runs entirely in the browser, persists data on-device, and is packaged for GitHub Pages as an installable Progressive Web App (PWA).

## 1. Project overview

Lore Ledger brings Campaign Hub plus four working areas into one browser app:

- A `Campaign Hub` for creating, opening, renaming, deleting, and re-importing campaigns
- A `Tracker` workspace for sessions, NPCs, party members, locations, and general notes
- A `Combat` workspace for encounter cards, round controls, status timing, and embedded character panels
- A `Character` workspace for a player character sheet and related notes
- A `Map` workspace for image-backed drawing, pan/zoom, and annotation

The app is intentionally lightweight: no backend, no account system, no server database, and no framework runtime beyond the browser and the Vite toolchain used for development and builds.

## 2. Why the app exists / current direction

The project exists to keep campaign context in one place without requiring a hosted service or network connection. The current codebase direction is focused on reliability and maintainability more than surface-area growth: clearer module boundaries, explicit state mutation helpers, safer CSP-friendly UI flows, stronger local persistence and migration behavior, and predictable GitHub Pages releases.

That direction is visible in the current structure:

- A single composition root in `app.js`
- A campaign vault persistence model that separates app-shell UI from per-campaign documents
- Schema-aware state migration in `js/state.js`
- Completed multi-character state with `state.characters.activeId` selecting entries from `state.characters.entries`
- Schema v5 tracker-card linking through `js/domain/cardLinking.js`
- A split persistence layer for structured state, images, and long-form text
- Tracker card panels built around destroyable instance-scoped controllers instead of hidden singleton runtime state
- A narrow shared tracker-card DOM patch helper, with card-body rendering and collection-specific rules still kept local to each panel
- Production PWA behavior handled through Vite and `vite-plugin-pwa`
- Maintainer docs for architecture, CSP checks, and smoke testing under [`docs/`](docs)

## 3. Feature overview

- Campaign Hub for creating campaigns, switching the active campaign, renaming campaigns, and deleting campaigns
- Tracker page for campaign title, session tabs and notes, NPC cards, party cards, location cards, and loose notes
- Sectioned tracker collections with add/rename/delete controls, search inputs, and portrait/image support for cards
- Combat Workspace with participant cards sourced from tracker entries, HP/temp HP actions, role/order controls, status effects, round timing, undo for turn advances, and embedded Vitals, Spells, Weapons / Attacks, Equipment, and Abilities / Skills panels that are live views of the canonical active character
- Character page with multi-character selection, `...` actions for New/Rename/Delete Character, Add to NPCs/Party, Export/Import Character, an empty-state "Create your first character" prompt, portrait, identity fields, vitals, resources, abilities and skills, proficiencies, weapons, spells, equipment, inventory tabs, money, and personality notes
- Spell management with dynamic spell levels and per-spell notes
- Character portability through `.ll-character.json` export/import, including portrait and spell-note bundling across campaigns
- Map page with multiple maps, background image upload/removal, mouse/touch drawing, pan/zoom gestures, brush and eraser tools, brush size and color controls, and persisted drawings
- Topbar utilities including a clock, calculator, and dice roller
- `Data & Settings` for theme selection, a Support section (`Report Bug`, `Copy Debug Info`, and nearby version/build metadata), backup export/import, update checks, targeted storage cleanup, and full reset
- Local auto-save and backup restore flows designed around browser storage rather than a server

## 4. Tech stack

- Vanilla `HTML`, `CSS`, and ES module `JavaScript`
- [`Vite`](https://vitejs.dev/) for local development, production builds, and preview
- [`Vitest`](https://vitest.dev/) for targeted unit tests around state migration, persistence, backup/import, and save lifecycle behavior
- Vanilla-JS type safety through `tsconfig.checkjs.json`, file-level `// @ts-check`, JSDoc typedefs/imports, and repo-local `.d.ts` shims under `types/`
- [`vite-plugin-pwa`](https://vite-pwa-org.netlify.app/) / Workbox for service worker registration, precaching, and update prompts
- Browser persistence via `localStorage` and `IndexedDB`
- GitHub Actions and GitHub Pages for production deployment
- No backend API, authentication layer, or external database

CI currently builds with `Node 20` in [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

## 5. Architecture summary

At a high level, the app is wired as a modular vanilla JS application:

- `index.html` defines the app shell, root page sections, modal anchors, and the CSP
- `boot.js` applies the saved theme early and exposes app version/build metadata
- `app.js` is the composition root that wires shared services, persistence, and page modules
- `js/state.js` owns default state, schema version history, migration, and save sanitization
- `js/storage/*` handles `localStorage`, IndexedDB blobs, IndexedDB text storage, backup import/export, and save lifecycle management
- `js/ui/*` contains shared interface systems such as dialogs, navigation, settings, popovers, theme handling, and topbar widgets
- `js/features/*` holds reusable flows such as image picking/cropping, portrait handling, autosizing, and number steppers
- `js/pages/*` contains page-specific orchestration for `hub`, `tracker`, `combat`, `character`, and `map`
- `js/domain/*` contains explicit state action helpers and entity factories

For a deeper maintainer view, see [`docs/architecture.md`](docs/architecture.md).

Current tracker-specific architecture notes:

- `initTrackerPage(...)` destroys the previous tracker-page controller before re-initializing Tracker wiring.
- The NPC, Party, and Location panels now return real `destroy()` APIs and own listener cleanup through `AbortController`.
- Shared tracker-card dedupe is intentionally narrow today: `js/pages/tracker/panels/cards/shared/cardIncrementalPatchShared.js` only owns incremental DOM patch mechanics, while filtering, section defaults, toolbar wiring, and card-body renderers remain panel-local.

Current character-specific architecture notes:

- Multi-character support is complete and verified. Active character data lives in `state.characters.entries`, selected by `state.characters.activeId`.
- The legacy singleton `state.character` key is valid only in migration/backward-compatibility handling for old saves/backups.
- Character panels resolve the active entry through `getActiveCharacter(state)` and write through helpers such as `mutateCharacter(...)` and `updateCharacterField(...)`.
- Combat embedded character panels are live alternate views of canonical active character data. They use active-character change events and panel invalidation/rebinding rather than duplicate character data or a sync store.
- NPC and Party tracker-card linking is complete. Linked cards store `characterId` and use `js/domain/cardLinking.js` so shared fields read from and write to the canonical character entry; card notes remain card-only.
- Character export/import portability is complete. `js/domain/characterPortability.js` validates files before state mutation, restores portrait and spell-note payloads into the destination campaign, and always assigns imported characters fresh IDs.
- Step 3 character builder/rules engine work remains future scope.

## 5.1 Type safety in vanilla JS

The repo is still plain JavaScript. Current type safety comes from `tsconfig.checkjs.json` plus JSDoc, not from a TypeScript rewrite.

- File-level `// @ts-check` is now in use for the composition root (`app.js`), `js/state.js`, all current `js/domain/*` and `js/storage/*` modules, map page orchestration/persistence modules, tracker page orchestration modules, several shared UI primitives, and focused utility/feature modules such as `js/features/autosize.js`, `js/features/numberSteppers.js`, and `js/utils/dev.js`.
- Shared typedefs mostly live beside the code that owns them. The main persisted-state and migration types live in `js/state.js`; ambient browser/build shims live in `types/*.d.ts`.
- `tsconfig.checkjs.json` includes `app.js`, `boot.js`, `vite.config.js`, `js/**/*.js`, and `types/**/*.d.ts`, so the broader repo can be checked with CheckJS as a diagnostic even where older files are outside the current file-level-hardened set.
- The repo-wide CheckJS pass is currently clean through `npm run typecheck`, which uses the repo-pinned `typescript@5.9.3` and is part of `npm run verify` plus the current CI gate.

## 6. Local development

Install dependencies:

```bash
npm ci
```

Run the local dev server:

```bash
npm run dev
```

Useful development notes:

- Dev mode is automatically enabled on local hosts such as `localhost`, `127.0.0.1`, `::1`, and `*.local`
- `?dev=1` forces dev mode on
- `?dev=0` forces dev mode off
- `?stateGuard=warn` enables the mutation guard in warning mode
- `?stateGuard=throw` enables the mutation guard in throwing mode
- `?stateGuard=off` disables the mutation guard
- Recommended local URL for refactor work: `/?dev=1&stateGuard=warn`

With the state guard enabled, direct out-of-scope writes warn or throw and point maintainers back toward `createStateActions(...)` helpers. A quick console check in dev mode is:

```js
__APP_STATE__.tracker.campaignTitle = "Guard test"
```

## 7. Automated tests

The repo now includes targeted automation in two layers:

- `tests/state.migrate.test.js` covers `migrateState(...)` in `js/state.js`, including supported legacy upgrade paths, current-schema normalization, and malformed or partial inputs.
- `tests/state.sanitize.test.js` covers `sanitizeForSave(...)` payload-copy behavior so save/export sanitization does not mutate the live tracker/character buckets.
- `tests/stateActions.test.js` covers `createStateActions(...)`, including its public helper surface, queue-save behavior, tracker-card type aliases, and unsafe path rejection.
- `tests/storage.persistence.test.js` covers `loadAll(...)` and `saveAllLocal(...)`, including sanitized saves, legacy image migration, stale-bucket replacement, and corrupt-storage fallback behavior.
- `tests/storage.blobReplacement.test.js` covers the blob replacement hardening path: write new blob, apply the new reference, flush the structured save, then delete the old blob, with rollback when a flush fails.
- `tests/assetReplacementFlows.test.js` covers portrait/map replacement failure paths so old asset references survive when the replacement save cannot be committed.
- `tests/storage.saveManager.test.js` covers the local save manager lifecycle, including dirty/saving/saved transitions, debounce behavior, retries after failure, and reset behavior.
- `tests/storage.backup.test.js` covers backup export/import validation, staged blob/text writes, text rollback on failed imports, and blob-ID remap behavior during import.
- `tests/smoke/app.smoke.js` covers app shell boot, opening the Map workspace, and a simple reload-persistence check in Chromium.
- `tests/smoke/backup.smoke.js` covers backup export, import into a fresh browser context, and visible failure handling for invalid backup files in Chromium.
- `tests/smoke/combatShell.smoke.js` covers the Combat tab shell, Combat Cards, round controls, HP/temp HP actions, status effects, turn undo, tracker writeback for HP/status labels, role/order/remove/clear flows, mobile stacking, and embedded panel selection/reorder/source-panel behavior.
- `tests/smoke/npcPortrait.smoke.js` covers NPC portrait crop/save plus incremental tracker-card patch behavior for search, section moves, reorder, collapse, and focus restoration.
- `tests/smoke/partyLocationPanels.smoke.js` covers the same tracker-card behavior for Party and Location panels, including location type filtering.
- `tests/smoke/trackerPanelLifecycle.smoke.js` covers repeated `initTrackerPage(...)` calls so tracker panel lifecycle cleanup stays single-bound after re-init.
- `tests/smoke/characterPanelLifecycle.smoke.js` covers repeated `initCharacterPageUI(...)` calls so Character page re-init keeps spells, equipment, and representative panel actions single-bound after teardown/re-init; Step 1 smoke helpers now account for fresh campaigns having no active character until one is created.
- `tests/smoke/dropdownRegression.smoke.js` covers shared dropdown/popover behavior, including enhanced select opening, tracker card menu clickability in the body-ported menu path, and dropdown wiring after rerender.

Run the test suite in watch mode:

```bash
npm test
```

Run the suite once:

```bash
npm run test:run
```

Run the same build-and-unit verification CI uses:

```bash
npm run verify
```

Run the repo-wide CheckJS pass directly:

```bash
npm run typecheck
```

Run the local browser smoke suite:

```bash
npm run test:smoke
```

If Playwright Chromium is not installed yet on this machine, install it once first:

```bash
npx playwright install chromium
```

Run one suite directly:

```bash
npm run test:run -- tests/state.migrate.test.js
```

`npm run test:smoke` runs the current 33-test Playwright suite against a controlled Vite server started in production mode on the repo's GitHub Pages base path. GitHub Pages CI now installs Playwright Chromium and runs this smoke suite after `npm run verify`; preview-based PWA/offline validation remains manual, and broader browser/PWA automation is roadmap hardening rather than unresolved release debt.

This is intentionally targeted coverage, not full-app automation. Automation now covers migration, `sanitizeForSave(...)`, `createStateActions(...)`, safe asset replacement ordering, local save/load, a representative structured save/load round trip, save-manager behavior, backup/import logic, basic browser boot, Campaign Hub first-run/layout/rename/delete paths, one reload-persistence path, a file-based backup round trip into a fresh browser context, tracker-page re-init safety, character-page re-init safety, Step 1 multi-character fresh-campaign behavior, targeted NPC/Party/Location panel regression paths, Combat Workspace card/round/status/embedded-panel paths, and shared dropdown/popover regressions. `Reset Everything`, broader Character-page coverage beyond the current lifecycle smoke, map drawing/touch behavior, and PWA/offline behavior remain manual release checks today; broader automation for those areas is roadmap work, while broader automated cross-browser coverage remains out of scope for this version.

`npm run verify` is the canonical local build-and-unit readiness check. It runs `npm run test:run`, `npm run typecheck`, and `npm run build`, matching the first automated gate in CI. It does not replace `npm run test:smoke`, `npm run preview`, or the browser-level manual checks needed for release validation.

For the closest local match to CI, start from a clean install with `npm ci`, then run `npm run verify` and `npm run test:smoke`. If Playwright Chromium is not installed locally yet, run `npx playwright install chromium` once first.

Static validation is also available directly through `npm run typecheck` for the vanilla-JS codebase via `tsconfig.checkjs.json`. That repo-wide CheckJS pass is currently clean and now ships as part of `npm run verify` and the current CI gate.

## 8. Build and preview

Build the production output into `dist/`:

```bash
npm run build
```

Preview the built app locally:

```bash
npm run preview
```

### Optional packaging scripts

The repo also keeps packaging scripts for backup/share workflows outside the normal Vite `dist/` deployment path.

Source snapshot zip:

Windows (PowerShell):

```powershell
.\scripts\make-zip.ps1
```

Linux/macOS/Chromebook (Bash):

```bash
bash scripts/make-zip.sh
```

Notes:

- Output format: `refactor-export-YYYYMMDD-HHMM.zip`
- Verification output includes: `Release zip is clean`
- Optional output folder:

```powershell
.\scripts\make-zip.ps1 -OutputDir .\exports
```

```bash
bash scripts/make-zip.sh ./exports
```

Runtime-only pages zip:

```bash
bash scripts/make-pages-zip.sh
```

Notes:

- Output format: `LoreLedger-web-YYYYMMDD-HHMM.zip`
- Verification output includes: `Pages zip is clean`
- Optional output folder:

```bash
bash scripts/make-pages-zip.sh ./artifacts
```

The runtime-only zip is for alternate/manual packaging workflows. Standard GitHub Pages deployment in this repo uses the built `dist/` output instead.

## 9. Versioning

Version metadata is resolved at build time in [`vite.config.js`](vite.config.js).

- Use a semver tag such as `v0.4.0` or `0.4.0` to set the major, minor, and baseline patch
- Production build version is computed as `MAJOR.MINOR.(tagPatch + commitsSinceTag)`
- Dev builds append `-dev`
- The build also exposes the short Git SHA when available
- If Git metadata is unavailable, the app falls back to `package.json` version metadata and the build SHA may be empty

## 10. Support and diagnostics

`Data & Settings` includes a small `Support` section for production troubleshooting.

- `Report Bug` opens a prefilled `mailto:` draft to `support@lore-ledger.com` when the current browser/app context allows email-app handoff.
- `Copy Debug Info` copies a deliberately narrow plain-text snapshot. If clipboard APIs are unavailable or denied, the app shows the same snapshot in a dialog instead of failing silently.
- The snapshot includes version/build metadata, runtime mode/context, whether a campaign is active, the current top-level page, a few browser capability hints relevant to support, a timestamp, and the user agent.
- The snapshot does not include campaign notes, map content, exported backup payloads, blob ids, query-string contents, or other large/private user data.
- In installed PWA or package-style contexts, `mailto:` behavior is still platform-dependent. If no email app opens, use `Copy Debug Info` and send that block manually.

Example baseline tag flow:

```bash
git tag v0.4.0
git push origin v0.4.0
```

`package.json` currently keeps a placeholder version and should be treated as the fallback path rather than the primary release source of truth.

## 11. GitHub Pages deployment notes

- Production base path is `/` in [`vite.config.js`](vite.config.js)
- GitHub Pages production is being prepared for the custom domain `https://lore-ledger.com/`
- The repo tracks [`public/CNAME`](public/CNAME) so Vite copies `lore-ledger.com` into the built artifact as `dist/CNAME`
- Hash-based navigation is preserved for `#tracker`, `#character`, and `#map`
- The Pages workflow is defined in [`.github/workflows/pages.yml`](.github/workflows/pages.yml)
- On pushes to `main` and on manual dispatch, the workflow runs a `Verify and build` job that does `npm ci`, `npm run verify`, installs Playwright Chromium, runs `npm run test:smoke`, uploads `dist/`, and only then runs `Deploy`
- Local equivalent: `npm ci`, then `npm run verify` and `npm run test:smoke`; release validation still also needs `npm run preview` plus the manual checks in [`docs/testing-guide.md`](docs/testing-guide.md)
- If you deploy manually, publish the contents of `dist/`, not the repository root

If the GitHub Pages path ever changes, update the following together:

- Vite `base`
- PWA manifest `id`, `start_url`, and `scope`
- Workbox navigation fallback paths

## 12. Persistence and storage overview

The app is local-first and stores data in the browser:

- Structured app state is saved to `localStorage` under `localCampaignTracker_v1` as a campaign vault with app-shell UI, campaign index metadata, and isolated per-campaign documents
- The active tab is saved separately under `localCampaignTracker_activeTab`
- IndexedDB database `localCampaignTracker_db` stores binary assets in `blobs` and large text payloads in `texts`
- Portraits, map background images, and persisted map drawings are stored as IndexedDB blobs
- Spell notes are stored separately in IndexedDB text storage with campaign-scoped keys
- `loadAll()` migrates older saved shapes, wraps legacy single-campaign saves into a one-campaign vault, and migrates legacy image data URLs into the current schema/storage model during startup
- Backup export is campaign-level: it bundles the currently active campaign's sanitized state, referenced images, and referenced text notes into a JSON file
- Backup import is campaign-level: it validates, migrates, stages blob/text writes before the state swap, attempts to restore touched text IDs if a later step fails, saves into the active campaign or creates a new campaign when importing from the hub, and then reloads the app after a successful save
- Character export/import is single-character portability: it writes a `.ll-character.json` file with one character, portrait data, and spell notes, then imports it as a new standalone character in the active destination campaign
- Vitest coverage now protects `migrateState(...)`, startup load/save behavior, backup import/export logic, and the local save lifecycle, which improves confidence in saved-state integrity without replacing manual browser-level verification

Intentionally non-persistent runtime state:

- Map undo/redo history
- Dice history
- Calculator history

For maintainers, this split matters: copying `localStorage` alone is not a complete backup of a populated app.

## 13. PWA / offline behavior overview

Production builds register a service worker through `vite-plugin-pwa`. Dev builds do not register the service worker.

- The app shell and built assets are precached so the site can reopen offline after it has been loaded online at least once
- Same-origin navigation requests use a `NetworkFirst` strategy with a `3` second timeout and fall back to cached `index.html`
- Same-origin images use a `CacheFirst` runtime cache
- Cross-origin images are not included in the runtime image cache rule
- Update handling uses a prompt flow: when a new version is available, the app can show an in-app refresh banner
- The settings panel also exposes a `Check for updates` action
- Old caches are cleaned up during updates via `cleanupOutdatedCaches: true`

See [`docs/PWA_NOTES.md`](docs/PWA_NOTES.md) for offline test steps and cache reset guidance.

## 14. Documentation index

Core maintainer docs:

- [`docs/architecture.md`](docs/architecture.md) - module boundaries, startup order, dependency direction, and page wiring
- [`docs/storage-and-backups.md`](docs/storage-and-backups.md) - current localStorage/IndexedDB responsibilities, save lifecycle, backup/import flow, and reset behavior
- [`docs/state-schema.md`](docs/state-schema.md) - persisted state shape, schema history, migration rules, and restore compatibility notes
- [`docs/testing-guide.md`](docs/testing-guide.md) - current automated test commands plus the manual release/regression checklist
- [`docs/release-process.md`](docs/release-process.md) - tagging, verification, packaging, deploy, and release checklist
- [`docs/security-privacy.md`](docs/security-privacy.md) - local-data, CSP, import/export, and privacy expectations
- [`docs/character-portability.md`](docs/character-portability.md) - single-character export/import format and import-ordering rationale
- [`docs/troubleshooting.md`](docs/troubleshooting.md) - common recovery steps for save, import, offline, and build issues
- [`docs/browser-smoke-plan.md`](docs/browser-smoke-plan.md) - current Playwright smoke scope and the manual gaps it does not replace
- [`docs/PWA_NOTES.md`](docs/PWA_NOTES.md) - offline cache behavior, update prompts, and cache reset steps

Supplemental checklists and support docs:

- [`docs/CSP_AUDIT.md`](docs/CSP_AUDIT.md) - dev-mode CSP verification checklist
- [`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md) - persistence-focused manual smoke checklist
- [`SMOKE_TEST.md`](SMOKE_TEST.md) - short Vite/offline validation checklist
- [`AI_RULES.md`](AI_RULES.md) - repository editing rules for AI-assisted changes
- [`.github/workflows/pages.yml`](.github/workflows/pages.yml) - production Pages build/deploy workflow

Branch planning/history notes kept in `docs/`:

- [`docs/lore-ledger-final-remaining-closure-plan.md`](docs/lore-ledger-final-remaining-closure-plan.md) - branch closure plan and review-prep notes
- [`docs/lore-ledger-closure-branch-commit-tracker.md`](docs/lore-ledger-closure-branch-commit-tracker.md) - branch work tracker and commit checklist

## 15. Current status / known limitations

- The app is single-user and browser-local. There is no sync, login, or shared backend.
- Clearing site data or switching browser profiles will remove local data unless a backup JSON has been exported first.
- Offline support is a production-build feature; `npm run dev` does not exercise the service worker path.
- Map undo/redo is intentionally in-memory only and resets on refresh.
- GitHub Pages custom-domain deployment assumes the site root `/` and the target host `lore-ledger.com`.
- Automated tests now cover migration, local persistence, backup/import, save-manager behavior, and targeted Chromium smoke coverage; full manual release validation is still required for broader UI, full restore runs with images/drawings/text-backed assets, PWA/offline behavior, and cross-browser coverage.
