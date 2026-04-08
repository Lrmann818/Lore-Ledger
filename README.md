# Campaign Tracker

`CampaignTracker` is the repository for `Lore Ledger`, a local-first D&D campaign companion built with vanilla HTML, CSS, and JavaScript. It runs entirely in the browser, persists data on-device, and is packaged for GitHub Pages as an installable Progressive Web App (PWA).

## 1. Project overview

Lore Ledger brings three working areas into one browser app:

- A `Tracker` workspace for sessions, NPCs, party members, locations, and general notes
- A `Character` workspace for a player character sheet and related notes
- A `Map` workspace for image-backed drawing, pan/zoom, and annotation

The app is intentionally lightweight: no backend, no account system, no server database, and no framework runtime beyond the browser and the Vite toolchain used for development and builds.

## 2. Why the app exists / current direction

The project exists to keep campaign context in one place without requiring a hosted service or network connection. The current codebase direction is focused on reliability and maintainability more than surface-area growth: clearer module boundaries, explicit state mutation helpers, safer CSP-friendly UI flows, stronger local persistence and migration behavior, and predictable GitHub Pages releases.

That direction is visible in the current structure:

- A single composition root in `app.js`
- Schema-aware state migration in `js/state.js`
- A split persistence layer for structured state, images, and long-form text
- Tracker card panels built around destroyable instance-scoped controllers instead of hidden singleton runtime state
- A narrow shared tracker-card DOM patch helper, with card-body rendering and collection-specific rules still kept local to each panel
- Production PWA behavior handled through Vite and `vite-plugin-pwa`
- Maintainer docs for architecture, CSP checks, and smoke testing under [`docs/`](docs)

## 3. Feature overview

- Tracker page for campaign title, session tabs and notes, NPC cards, party cards, location cards, and loose notes
- Sectioned tracker collections with add/rename/delete controls, search inputs, and portrait/image support for cards
- Character page with portrait, identity fields, vitals, resources, abilities and skills, proficiencies, weapons, spells, equipment, inventory tabs, money, and personality notes
- Spell management with dynamic spell levels and per-spell notes
- Map page with multiple maps, background image upload/removal, mouse/touch drawing, pan/zoom gestures, brush and eraser tools, brush size and color controls, and persisted drawings
- Topbar utilities including a clock, calculator, and dice roller
- Data and settings panel for theme selection, backup export/import, update checks, targeted storage cleanup, and full reset
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
- `js/pages/*` contains page-specific orchestration for `tracker`, `character`, and `map`
- `js/domain/*` contains explicit state action helpers and entity factories

For a deeper maintainer view, see [`docs/architecture.md`](docs/architecture.md).

Current tracker-specific architecture notes:

- `initTrackerPage(...)` destroys the previous tracker-page controller before re-initializing Tracker wiring.
- The NPC, Party, and Location panels now return real `destroy()` APIs and own listener cleanup through `AbortController`.
- Shared tracker-card dedupe is intentionally narrow today: `js/pages/tracker/panels/cards/shared/cardIncrementalPatchShared.js` only owns incremental DOM patch mechanics, while filtering, section defaults, toolbar wiring, and card-body renderers remain panel-local.

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
- `tests/smoke/npcPortrait.smoke.js` covers NPC portrait crop/save plus incremental tracker-card patch behavior for search, section moves, reorder, collapse, and focus restoration.
- `tests/smoke/partyLocationPanels.smoke.js` covers the same tracker-card behavior for Party and Location panels, including location type filtering.
- `tests/smoke/trackerPanelLifecycle.smoke.js` covers repeated `initTrackerPage(...)` calls so tracker panel lifecycle cleanup stays single-bound after re-init.
- `tests/smoke/characterPanelLifecycle.smoke.js` covers repeated `initCharacterPageUI(...)` calls so Character page re-init keeps spells, equipment, and representative panel actions single-bound after teardown/re-init.
- `tests/smoke/dropdownRegression.smoke.js` covers shared dropdown/popover behavior, including enhanced select opening, tracker card menu clickability in the body-ported menu path, and dropdown wiring after rerender.

Run the test suite in watch mode:

```bash
npm test
```

Run the suite once:

```bash
npm run test:run
```

Run the same automated verification CI uses:

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

`npm run test:smoke` runs the current 16-test Playwright suite against a controlled Vite server started in production mode on the repo's GitHub Pages base path. Keeping that suite local-only is the current release-process decision for this version; preview-based PWA/offline validation remains manual, and CI/browser-expansion work is roadmap hardening rather than unresolved release debt.

This is intentionally targeted coverage, not full-app automation. Automation now covers migration, `sanitizeForSave(...)`, `createStateActions(...)`, safe asset replacement ordering, local save/load, a representative structured save/load round trip, save-manager behavior, backup/import logic, basic browser boot, one reload-persistence path, a file-based backup round trip into a fresh browser context, tracker-page re-init safety, character-page re-init safety, targeted NPC/Party/Location panel regression paths, and shared dropdown/popover regressions. `Reset Everything`, broader Character-page coverage beyond the current lifecycle smoke, map drawing/touch behavior, and PWA/offline behavior remain manual release checks today; broader automation for those areas is roadmap work, while broader automated cross-browser coverage remains out of scope for this version.

`npm run verify` is the canonical local readiness check. It runs `npm run test:run`, `npm run typecheck`, and `npm run build`, matching the automated checks in CI. It does not replace `npm run preview` or the browser-level manual checks needed for release validation.

For the closest local match to CI, start from a clean install with `npm ci`, then run `npm run verify`. CI does not currently run `npm run test:smoke`.

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

Example baseline tag flow:

```bash
git tag v0.4.0
git push origin v0.4.0
```

`package.json` currently keeps a placeholder version and should be treated as the fallback path rather than the primary release source of truth.

## 10. GitHub Pages deployment notes

- Production base path is `/CampaignTracker/` in [`vite.config.js`](vite.config.js)
- Hash-based navigation is preserved for `#tracker`, `#character`, and `#map`
- The Pages workflow is defined in [`.github/workflows/pages.yml`](.github/workflows/pages.yml)
- On pushes to `main` and on manual dispatch, the workflow runs a `Verify and build` job that does `npm ci` and `npm run verify`, uploads `dist/`, and only then runs `Deploy`
- Local equivalent: `npm ci`, then `npm run verify`; release validation still also needs `npm run preview` plus the manual checks in [`docs/testing-guide.md`](docs/testing-guide.md)
- If you deploy manually, publish the contents of `dist/`, not the repository root

If the GitHub Pages path ever changes, update the following together:

- Vite `base`
- PWA manifest `id`, `start_url`, and `scope`
- Workbox navigation fallback paths

## 11. Persistence and storage overview

The app is local-first and stores data in the browser:

- Structured app state is saved to `localStorage` under `localCampaignTracker_v1`
- The active tab is saved separately under `localCampaignTracker_activeTab`
- IndexedDB database `localCampaignTracker_db` stores binary assets in `blobs` and large text payloads in `texts`
- Portraits, map background images, and persisted map drawings are stored as IndexedDB blobs
- Spell notes are stored separately in IndexedDB text storage
- `loadAll()` migrates older saved shapes and legacy image data URLs into the current schema/storage model during startup
- Backup export bundles sanitized state, stored images, and stored text into a JSON file; backup import validates, migrates, stages blob/text writes before the state swap, attempts to restore touched text IDs if a later step fails, and then reloads the app after a successful save
- Vitest coverage now protects `migrateState(...)`, startup load/save behavior, backup import/export logic, and the local save lifecycle, which improves confidence in saved-state integrity without replacing manual browser-level verification

Intentionally non-persistent runtime state:

- Map undo/redo history
- Dice history
- Calculator history

For maintainers, this split matters: copying `localStorage` alone is not a complete backup of a populated app.

## 12. PWA / offline behavior overview

Production builds register a service worker through `vite-plugin-pwa`. Dev builds do not register the service worker.

- The app shell and built assets are precached so the site can reopen offline after it has been loaded online at least once
- Same-origin navigation requests use a `NetworkFirst` strategy with a `3` second timeout and fall back to cached `index.html`
- Same-origin images use a `CacheFirst` runtime cache
- Cross-origin images are not included in the runtime image cache rule
- Update handling uses a prompt flow: when a new version is available, the app can show an in-app refresh banner
- The settings panel also exposes a `Check for updates` action
- Old caches are cleaned up during updates via `cleanupOutdatedCaches: true`

See [`docs/PWA_NOTES.md`](docs/PWA_NOTES.md) for offline test steps and cache reset guidance.

## 13. Documentation index

Core maintainer docs:

- [`docs/architecture.md`](docs/architecture.md) - module boundaries, startup order, dependency direction, and page wiring
- [`docs/storage-and-backups.md`](docs/storage-and-backups.md) - current localStorage/IndexedDB responsibilities, save lifecycle, backup/import flow, and reset behavior
- [`docs/state-schema.md`](docs/state-schema.md) - persisted state shape, schema history, migration rules, and restore compatibility notes
- [`docs/testing-guide.md`](docs/testing-guide.md) - current automated test commands plus the manual release/regression checklist
- [`docs/release-process.md`](docs/release-process.md) - tagging, verification, packaging, deploy, and release checklist
- [`docs/security-privacy.md`](docs/security-privacy.md) - local-data, CSP, import/export, and privacy expectations
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

## 14. Current status / known limitations

- The app is single-user and browser-local. There is no sync, login, or shared backend.
- Clearing site data or switching browser profiles will remove local data unless a backup JSON has been exported first.
- Offline support is a production-build feature; `npm run dev` does not exercise the service worker path.
- Map undo/redo is intentionally in-memory only and resets on refresh.
- GitHub Pages deployment assumes the `/CampaignTracker/` base path today.
- Automated tests now cover migration, local persistence, backup/import, and save-manager behavior; broader UI, real browser-storage, backup/restore end-to-end, and PWA validation is still manual.
