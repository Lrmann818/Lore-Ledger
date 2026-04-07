# Release Process

This document describes the current production release workflow for Campaign Tracker / Lore Ledger as it exists in this repository today.

The standard shipping path is:

1. validate the release candidate locally
2. build the production artifact with Vite
3. merge or push the release commit to `main`
4. let GitHub Pages deploy the built `dist/` output through [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)

There is no dedicated release automation beyond the GitHub Pages workflow. Today that workflow runs `npm ci`, `npm run test:run`, and `npm run build` in its `Verify and build` job before any Pages deploy, but releases still remain evidence-driven and still rely on manual validation alongside automated checks.

## 1. Release philosophy

- Release from the real repository state, not from hand-edited files in `dist/`.
- Treat persistence, backup/restore, PWA/offline behavior, and CSP regressions as release blockers. Those are the highest-risk areas for this local-first app.
- Prefer one clearly identified release commit on `main` with a matching semver tag.
- Keep the workflow boring and repeatable: tag, build, preview, smoke test, then ship.
- When release behavior changes, update the maintainer docs in the same change instead of relying on tribal knowledge.

## 2. Versioning rules

User-visible app versioning is computed in [`vite.config.js`](../vite.config.js), not by manually bumping [`package.json`](../package.json).

- Accepted release tag formats are `vX.Y.Z` and `X.Y.Z`.
- Production build version is computed as `MAJOR.MINOR.(tagPatch + commitsSinceTag)`.
- Dev builds append `-dev`.
- The short Git SHA is also exposed to the app UI through `__APP_BUILD__` / `APP_BUILD`.
- If Git metadata is unavailable, the build falls back to the `package.json` version, which is currently `0.0.0` and should be treated as fallback-only metadata.

Important distinction:

- App release version is separate from persisted data schema versioning.
- The structured save schema is currently version `2`; if a release changes schema or backup format, update migrations and the storage/schema docs in the same change.

## 3. Tagging expectations

- Tag the exact commit you intend to ship.
- Use a semver release tag, preferably with the `v` prefix for consistency, for example `v0.4.1`.
- Push the tag to origin so the build environment can see it.
- Treat the tag as immutable once published.

For this repo, tag timing matters:

- The Pages workflow reads Git tags during `npm run build`.
- A tag by itself does not deploy anything because [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) only runs on pushes to `main` and on manual dispatch.
- If you create or push the release tag after the `main` push has already deployed, rerun the workflow manually so the build can pick up the new tag-based version.

Typical flow:

```bash
git tag v0.4.1
git push origin main v0.4.1
```

If `main` was already pushed before the tag existed remotely, use GitHub's `workflow_dispatch` on the Pages workflow to rebuild with the correct version metadata.

## 4. Build steps

Use Node `20` for release builds when possible so local behavior matches the Pages workflow.

1. Make sure the release commit is the one you intend to ship.
2. Make sure the intended semver tag exists locally and is attached to that commit.
3. Install dependencies with the lockfile:

```bash
npm ci
```

4. Run the canonical automated release gate:

```bash
npm run verify
```

For the closest local match to CI, run `npm ci` first, then `npm run verify`.

Expected result:

- `npm run test:run` passes.
- Vite writes the production artifact to `dist/`.
- The build includes hashed JS/CSS assets plus PWA files such as the linked `manifest.webmanifest`, copied public `manifest.json`, `sw.js`, and Workbox output.
- Production base path is `/CampaignTracker/`.

Do not ship by editing `dist/` manually. Rebuild instead.

## 5. Preview steps

Always preview the production build before shipping.

```bash
npm run preview
```

Then open the preview URL printed by Vite. Because this repo builds for the GitHub Pages base path, validate the app under `/CampaignTracker/` if the server root is not the correct entry point.

Preview checks:

- app shell loads without missing asset errors
- `#tracker`, `#character`, and `#map` still reload correctly
- icons and manifest-backed PWA assets load from the built output
- the in-app `About` dialog shows the expected version/build metadata

Use preview or a deployed production build for PWA and offline checks. `npm run dev` does not register the production service worker.

## 6. Required smoke/testing steps

The repository now defines targeted automated checks in [`package.json`](../package.json). The Pages workflow currently runs `npm run test:run` plus the production build before deploy. A focused 10-test Playwright browser smoke suite also exists locally in `tests/smoke/*.smoke.js`, but it is not yet part of CI. Release validation still requires the manual checklist in addition to those automated checks.

Primary sources:

- [`docs/testing-guide.md`](./testing-guide.md)
- [`docs/SMOKE_TEST.md`](./SMOKE_TEST.md)
- [`docs/PWA_NOTES.md`](./PWA_NOTES.md)
- [`docs/CSP_AUDIT.md`](./CSP_AUDIT.md)

Minimum pre-release expectation:

1. Run `npm run verify`.
2. Run `npm run test:smoke`.
3. Use a clean browser profile.
4. Run the full pre-release checklist in [`docs/testing-guide.md`](./testing-guide.md).

If Chromium is not installed for Playwright on that machine yet, run `npx playwright install chromium` once before `npm run test:smoke`.

That means covering at least:

- local Chromium browser smoke for app shell boot, one reload-persistence path, backup export/import in a fresh browser context, invalid import feedback, tracker-page re-init safety, character-page re-init safety, and targeted NPC/Party/Location panel regressions around portrait toggles, search/filter, section moves, reorder, collapse, and focus restoration
- persistence durability across refresh
- Tracker, Character, and Map baseline flows
- backup export, `Reset Everything`, and backup import
- production PWA/offline behavior
- CSP/dev-audit sanity checks when startup or asset-loading behavior changed
- browser coverage of latest Chromium desktop plus latest Firefox desktop before production release
- touch-device coverage when map, drawing, gestures, image picking, or mobile layout changed

Any data-loss, restore, offline-shell, or CSP regression should block release.

Intentional difference from CI:

- CI runs `npm ci`, then `npm run test:run`, then `npm run build`, uploads `dist/`, and only then deploys.
- CI does not yet provision Chromium or run `npm run test:smoke`.
- Local release validation must continue with `npm run preview`, `npm run test:smoke`, and the manual checklist because CI does not validate browser-only persistence, backup/restore, PWA/offline, or cross-browser behavior.

## 7. Packaging steps

### Standard production artifact

The real deployable production artifact for this project is the built `dist/` directory from `npm run build`.

That is the artifact uploaded and deployed by the Pages workflow.

### Optional source snapshot zip

Use this when you want a clean repository snapshot outside of the normal Pages deployment path.

Windows PowerShell:

```powershell
.\scripts\make-zip.ps1
```

Bash:

```bash
bash scripts/make-zip.sh
```

Behavior:

- output file name: `refactor-export-YYYYMMDD-HHMM.zip`
- default output directory: `release/`
- verification message: `Release zip is clean`

### Optional runtime-only zip

Use this only for alternate/manual runtime packaging workflows, not as the standard GitHub Pages release artifact.

```bash
bash scripts/make-pages-zip.sh
```

Behavior:

- output file name: `LoreLedger-web-YYYYMMDD-HHMM.zip`
- default output directory: `release/`
- verification message: `Pages zip is clean`
- packages the current runtime-oriented repo files rooted around `index.html`, `styles.css`, `app.js`, `boot.js`, `js/`, and `icons/`

Important note:

- This runtime zip is not the normal Pages deployment path for this repo.
- Standard production shipping should still go through `npm run build` and deployment of `dist/`.

### Verification helpers

You can re-verify an existing zip manually:

```bash
bash scripts/verify-zip.sh ./release/<zip-name>.zip
```

Or for the runtime/pages zip mode:

```bash
bash scripts/verify-zip.sh --mode pages ./release/<zip-name>.zip
```

## 8. GitHub Pages deployment notes

Current deploy behavior is defined in [`.github/workflows/pages.yml`](../.github/workflows/pages.yml).

What it does today:

- triggers on pushes to `main`
- also supports manual `workflow_dispatch`
- runs a `Verify and build` job first
- in that job, checks out the repository with full history and tags
- in that job, uses Node `20`
- in that job, runs `npm ci`
- in that job, runs `npm run test:run`
- in that job, runs `npm run build`
- in that job, uploads `dist/`
- runs a separate `Deploy` job only after `Verify and build` succeeds

Release-specific implications:

- a failing automated check blocks deploy because the `build` job stops before artifact upload
- local release validation should still run `npm ci` and `npm run verify` so failures are caught before pushing or manually dispatching
- pushing a tag does not deploy on its own
- the built version depends on which tags are available when the workflow runs
- if version metadata is wrong because the tag arrived late, rerun the workflow manually

Manual GitHub-side protections not encoded in repo files:

- branch protection, pull request requirements, and required status checks for `main` are GitHub settings, not repository files
- the repo cannot tell you whether those settings are currently enabled
- if you configure a required status check, the relevant job name is `Verify and build` from the `Deploy to GitHub Pages` workflow
- the workflow targets the `github-pages` environment, but any environment protection rules also live in GitHub settings rather than this repo

Path/base assumptions:

- production `base` is `/CampaignTracker/`
- the PWA manifest `id`, `start_url`, and `scope` are also `/CampaignTracker/`
- Workbox navigation fallback is built from that same base

If the GitHub Pages path ever changes, update all of these together in [`vite.config.js`](../vite.config.js):

- `base`
- PWA manifest `id`
- PWA manifest `start_url`
- PWA manifest `scope`
- Workbox navigation fallback paths

## 9. Release evidence checklist

Capture and keep the following evidence for each production release:

- release commit SHA
- release tag name
- successful `npm run verify` output
- preview or deployed URL used for validation
- browser coverage used for the release check
- confirmation that backup export, reset, and import all worked
- confirmation that map image/drawing persistence worked after refresh
- confirmation that offline shell loading worked from a production build
- confirmation that the in-app `About` dialog shows the expected version, build, and schema
- link to the successful GitHub Pages workflow run
- deployed Pages URL

If optional zip packaging was used, also record:

- zip file name
- which script produced it
- successful `Release zip is clean` or `Pages zip is clean` verification output

For failures, follow the evidence guidance in [`docs/testing-guide.md`](./testing-guide.md).

## 10. Changelog update expectations

This repository does not currently maintain a committed `CHANGELOG.md`.

Current expectation for each release:

- summarize user-visible changes in the GitHub release notes, tag notes, or release PR description
- update [`README.md`](../README.md) when release behavior, build behavior, or deployment expectations change
- update this document when the release workflow changes
- update [`docs/testing-guide.md`](./testing-guide.md) when release validation expectations change

If the release changes persistence or compatibility behavior, also update:

- [`docs/state-schema.md`](./state-schema.md)
- [`docs/storage-and-backups.md`](./storage-and-backups.md)

That is especially important for:

- schema version changes
- backup format changes
- migration behavior changes
- newly persisted or intentionally non-persisted UI/runtime state
