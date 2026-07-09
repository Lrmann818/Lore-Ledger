# Lore Ledger

`Lore-Ledger` is the GitHub repository for `Lore Ledger`, a local-first D&D campaign companion built with vanilla HTML, CSS, and JavaScript. It runs entirely in the browser, persists data on-device, and is packaged for GitHub Pages as an installable Progressive Web App (PWA).

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
- Tracker-card linking through `js/domain/cardLinking.js`
- A freeform-compatible character builder: builder characters carry `build` and `overrides` metadata, freeform characters keep `build: null`
- A split persistence layer for structured state, images, and long-form text
- Tracker card panels built around destroyable instance-scoped controllers instead of hidden singleton runtime state
- A narrow shared tracker-card DOM patch helper, with card-body rendering and collection-specific rules still kept local to each panel
- Production PWA behavior handled through Vite and `vite-plugin-pwa`
- Maintainer docs for architecture, CSP checks, and smoke testing under [`docs/`](docs)

## 3. Feature overview

- Campaign Hub for creating campaigns, switching the active campaign, renaming campaigns, and deleting campaigns
- Tracker page for campaign title, reorderable session tabs and notes, NPC cards, party cards, location cards, and loose notes
- Sectioned tracker collections with add/rename/delete controls, search inputs, and portrait/image support for cards
- Combat Workspace with participant cards sourced from tracker entries, HP/temp HP actions, role/order controls, status effects, round timing, undo for turn advances, and embedded Vitals, Spells, Weapons / Attacks, Equipment, and Abilities / Skills panels that are live views of the canonical active character
- Character page with multi-character selection, `...` actions for New/Rename/Delete Character, New Builder Character, Add to NPCs/Party, Export/Import Character, an empty-state "Create your first character" prompt, portrait, identity fields, vitals, resources, abilities and skills, proficiencies, weapons, spells, equipment, inventory tabs, money, and personality notes
- SRD 5.1 character builder: a guided, multi-step creation wizard backed by a shipped content registry, with rules-driven derivation for the sheet. Freeform (manual) characters remain fully supported alongside builder characters. See [`docs/reference/builder-scope-greenlist.md`](docs/reference/builder-scope-greenlist.md) for exactly what content ships
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

Two load-bearing character rules, because they are easy to get wrong:

- Active character data lives in `state.characters.entries`, selected by `state.characters.activeId` and resolved through `getActiveCharacter(state)`. The legacy singleton `state.character` key is valid **only** in migration/backward-compatibility code.
- Builder characters have `build !== null` and derive sheet values from their build; freeform characters have `build: null` and stay fully manual. **The two modes are deliberately distinct and must not be collapsed.**

Everything else — module boundaries, panel lifecycle and `destroy()` contracts, tracker-card
linking, character portability, builder scope and schema shape — is documented rather than
summarized here, because this README goes stale faster than the docs do:

- [`docs/architecture.md`](docs/architecture.md) — module boundaries and current architecture rules
- [`docs/features/multi-character-design.md`](docs/features/multi-character-design.md) — character architecture rules
- [`docs/reference/builder-scope-greenlist.md`](docs/reference/builder-scope-greenlist.md) — what SRD content actually ships
- [`docs/state-schema.md`](docs/state-schema.md) — persisted shape and current schema version
- [`AGENTS.md`](AGENTS.md) — the rules that win on conflict

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

```bash
npm run test          # Vitest, watch mode
npm run test:run      # Vitest, once
npm run typecheck     # CheckJS via tsconfig.checkjs.json
npm run verify        # test:run + typecheck + build -- the canonical local gate
npm run test:smoke    # Playwright smoke suite (Chromium)
```

Run one suite directly with `npm run test:run -- tests/state.migrate.test.js`. If Playwright
Chromium is not installed on this machine yet, run `npx playwright install chromium` once.
For the closest local match to CI, start from `npm ci`, then `npm run verify` and
`npm run test:smoke`.

Coverage is **intentionally targeted, not full-app automation.** Unit tests concentrate on
persistence: migration, save sanitization, state actions, blob replacement ordering, save
lifecycle, and backup import/export. The Playwright suite covers app boot, Campaign Hub,
reload persistence, a backup round trip, tracker/character page re-init safety, Combat
Workspace, and shared dropdown regressions.

`Reset Everything`, map drawing and touch behavior, and PWA/offline behavior remain **manual
release checks**. Broader cross-browser automation is out of scope for this version.

For what is automated versus intentionally manual, see
[`docs/operations/browser-smoke-status.md`](docs/operations/browser-smoke-status.md). For the
full testing procedure, see [`docs/operations/testing-guide.md`](docs/operations/testing-guide.md).

## 8. Build and preview

Build the production output into `dist/`:

```bash
npm run build
```

Preview the built app locally:

```bash
npm run preview
```

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
- Local equivalent: `npm ci`, then `npm run verify` and `npm run test:smoke`; release validation still also needs `npm run preview` plus the manual checks in [`docs/operations/testing-guide.md`](docs/operations/testing-guide.md)
- If you deploy manually, publish the contents of `dist/`, not the repository root

If the GitHub Pages path ever changes, update the following together:

- Vite `base`
- PWA manifest `id`, `start_url`, and `scope`
- Workbox navigation fallback paths

## 12. Persistence and storage overview

The app is local-first. Data lives in the browser, split across three stores:

- `localStorage["localCampaignTracker_v1"]` — the campaign vault: app-shell UI, campaign index, and isolated per-campaign documents. Active tab is separate, under `localCampaignTracker_activeTab`.
- IndexedDB `localCampaignTracker_db` → `blobs` — portraits, map backgrounds, persisted map drawings.
- IndexedDB `localCampaignTracker_db` → `texts` — long spell notes, campaign-scoped keys.

**Copying `localStorage` alone is not a complete backup of a populated app.** Use the
in-app backup export, which bundles the active campaign's sanitized state plus its
referenced images and text notes.

Intentionally **non-persistent** runtime state: map undo/redo history, dice history,
calculator history.

Full detail — save lifecycle, blob-replacement rollback, import staging, reset behavior —
lives in [`docs/operations/storage-and-backups.md`](docs/operations/storage-and-backups.md).
The persisted shape and migration rules live in [`docs/state-schema.md`](docs/state-schema.md).

## 13. PWA / offline behavior overview

Production builds register a service worker through `vite-plugin-pwa`. **Dev builds do not** —
use `npm run preview` for any PWA or offline validation.

The app shell and built assets are precached, so the site reopens offline once it has loaded
online at least once. Updates use a prompt flow with an in-app refresh banner, and
`Data & Settings` exposes a `Check for updates` action.

Strategies, cache rules, offline test steps, and cache reset guidance are in
[`docs/operations/pwa-notes.md`](docs/operations/pwa-notes.md).

## 14. Documentation index

See [`docs/README.md`](docs/README.md) — the full index, with each doc marked canonical,
historical, or planning-only.

Start points: [`AGENTS.md`](AGENTS.md) for the agent rules and task-specific doc map,
[`docs/architecture.md`](docs/architecture.md) for module boundaries,
[`docs/operations/testing-guide.md`](docs/operations/testing-guide.md) for testing, and
[`docs/operations/release-process.md`](docs/operations/release-process.md) for shipping.

## 15. Current status / known limitations

- The app is single-user and browser-local. There is no sync, login, or shared backend.
- Clearing site data or switching browser profiles will remove local data unless a backup JSON has been exported first.
- Offline support is a production-build feature; `npm run dev` does not exercise the service worker path.
- Map undo/redo is intentionally in-memory only and resets on refresh.
- GitHub Pages custom-domain deployment assumes the site root `/` and the target host `lore-ledger.com`.
- Automated tests now cover migration, local persistence, backup/import, save-manager behavior, and targeted Chromium smoke coverage; full manual release validation is still required for broader UI, full restore runs with images/drawings/text-backed assets, PWA/offline behavior, and cross-browser coverage.
