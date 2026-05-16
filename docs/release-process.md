# Release Process

This document describes the current production release workflow for Campaign Tracker / Lore Ledger as it exists in this repository today.

The standard shipping path is:

1. validate the release candidate locally
2. build the production artifact with Vite
3. merge or push the release commit to `main`
4. let GitHub Pages deploy the built `dist/` output through [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)

There is no dedicated release automation beyond the GitHub Pages workflow. Today that workflow runs `npm ci`, `npm run verify`, installs Playwright Chromium, and runs `npm run test:smoke` in its `Verify and build` job before any Pages deploy, but releases still remain evidence-driven and still rely on manual validation alongside automated checks.

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
- If Git metadata is unavailable, the build falls back to the `package.json` version, which is currently `0.5.0` and should be treated as fallback-only metadata.

Important distinction:

- App release version is separate from persisted data schema versioning.
- The structured save schema is currently version `3`; if a release changes schema or backup format, update migrations and the storage/schema docs in the same change.

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
- `npm run typecheck` passes through the repo-pinned `typescript@5.9.3` toolchain.
- Vite writes the production artifact to `dist/`.
- The build includes hashed JS/CSS assets plus PWA files such as the linked `manifest.webmanifest`, copied public `manifest.json`, `sw.js`, and Workbox output.
- Production base path is `/`.

Do not ship by editing `dist/` manually. Rebuild instead.

## 5. Preview steps

Always preview the production build before shipping.

```bash
npm run preview
```

Then open the preview URL printed by Vite. This repo now builds for the site root, so validate the app from `/`.

Preview checks:

- app shell loads without missing asset errors
- `#tracker`, `#character`, and `#map` still reload correctly
- icons and manifest-backed PWA assets load from the built output
- the in-app `About` dialog shows the expected version/build metadata

Use preview or a deployed production build for PWA and offline checks. `npm run dev` does not register the production service worker.

## 6. Required smoke/testing steps

The repository now defines targeted automated checks in [`package.json`](../package.json). The Pages workflow currently runs `npm run verify` before deploy, which covers `npm run test:run`, `npm run typecheck`, and the production build. It then installs Playwright Chromium and runs the focused 33-test browser smoke suite in `tests/smoke/*.smoke.js` before uploading the Pages artifact. Release validation still requires the manual checklist in addition to those automated checks because PWA/offline, installed-app, and broader cross-browser behavior remain outside the CI gate.

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

- local Chromium browser smoke for app shell and Campaign Hub boot/layout flows, one reload-persistence path, backup export/import in a fresh browser context, invalid import feedback, tracker-page re-init safety, character-page re-init safety, targeted NPC/Party/Location panel regressions around portrait toggles, search/filter, section moves, reorder, collapse, and focus restoration, Combat Workspace card/round/status/embedded-panel flows, plus shared dropdown/popover regressions around enhanced selects and card-menu clickability
- persistence durability across refresh
- Tracker, Character, and Map baseline flows
- backup export, `Reset Everything`, and backup import
- production PWA/offline behavior
- CSP/dev-audit sanity checks when startup or asset-loading behavior changed
- browser coverage of latest Chromium desktop plus latest Firefox desktop before production release
- touch-device coverage when map, drawing, gestures, image picking, or mobile layout changed

Any data-loss, restore, offline-shell, or CSP regression should block release.

Intentional difference from CI:

- CI runs `npm ci`, `npm run verify`, installs Playwright Chromium, runs `npm run test:smoke`, uploads `dist/`, and only then deploys.
- CI browser coverage is intentionally limited to the current Chromium smoke suite; it does not run preview-based service-worker checks, PWA install/offline validation, or broader cross-browser/device coverage.
- Local release validation must continue with `npm run preview` and the manual checklist because CI does not validate PWA/offline, installed-app, full restore, map/touch, or cross-browser behavior.

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
- in that job, runs `npm run verify`
- in that job, installs Playwright Chromium
- in that job, runs `npm run test:smoke`
- in that job, uploads `dist/`
- runs a separate `Deploy` job only after `Verify and build` succeeds

Release-specific implications:

- a failing automated check blocks deploy because the `build` job stops before artifact upload
- local release validation should still run `npm ci`, `npm run verify`, and `npm run test:smoke` so failures are caught before pushing or manually dispatching
- pushing a tag does not deploy on its own
- the built version depends on which tags are available when the workflow runs
- if version metadata is wrong because the tag arrived late, rerun the workflow manually

Manual GitHub-side protections not encoded in repo files:

- branch protection, pull request requirements, and required status checks for `main` are GitHub settings, not repository files
- the repo cannot tell you whether those settings are currently enabled
- if you configure a required status check, the relevant job name is `Verify and build` from the `Deploy to GitHub Pages` workflow
- the workflow targets the `github-pages` environment, but any environment protection rules also live in GitHub settings rather than this repo

Path/base assumptions:

- production `base` is `/`
- GitHub Pages production is being prepared for the custom domain `https://lore-ledger.com/`
- the build should include `dist/CNAME` with `lore-ledger.com` via [`public/CNAME`](../public/CNAME)
- the PWA manifest `id`, `start_url`, and `scope` are also `/`
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
- successful `npm run test:smoke` output
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

## 10. App Store / iOS packaging (Capacitor)

Lore Ledger uses [Capacitor](https://capacitorjs.com/) as the native packaging layer for the App Store / TestFlight path.

### Architecture

- Vite still builds the web app to `dist/` as before.
- Capacitor wraps that build in a native iOS Xcode project.
- `capacitor.config.ts` in the project root is the single Capacitor configuration file:
  - `appId: "com.laurenmann.loreledger"`
  - `appName: "Lore Ledger"`
  - `webDir: "dist"`
- Capacitor packages: `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios` — all pinned to `7.6.5`.
- CocoaPods 1.16.2 (installed via Homebrew) manages native iOS dependencies.

### Native project status

The `ios/` Xcode project has been scaffolded and is **tracked in the repo**.

Tracked files include:
- `ios/.gitignore` (inner exclusions managed by Capacitor)
- `ios/App/App.xcodeproj/project.pbxproj`
- `ios/App/App.xcworkspace/contents.xcworkspacedata`
- `ios/App/App/AppDelegate.swift`, `Info.plist`, `Assets.xcassets/`, `Base.lproj/`
- `ios/App/Podfile`, `ios/App/Podfile.lock`

Not tracked (excluded by `ios/.gitignore`):
- `ios/App/Pods/` — CocoaPods dependencies, restored by `pod install`
- `ios/App/App/public/` — web assets, restored by `cap sync ios`
- `ios/App/App/capacitor.config.json` — generated from `capacitor.config.ts`
- `ios/capacitor-cordova-ios-plugins/` — generated
- `DerivedData/`, `xcuserdata/` — Xcode build/user artifacts

### Xcode prerequisite

The system must use full Xcode (not just Command Line Tools) for `pod install` to succeed. If you see an error about `xcodebuild` requiring Xcode, run:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

This is a one-time machine setup step.

### Standard iOS workflow

After a code or dependency change:

```bash
# 1. Build web app and sync into native iOS project
npm run cap:sync:ios

# 2. Open in Xcode to build / archive / run on simulator or device
npm run cap:open:ios
```

`npm run cap:sync:ios` is equivalent to:

```bash
npm run build          # Vite → dist/
npx cap sync ios       # copies dist/ into ios/App/App/public, reruns pod install
```

### Initial setup on a fresh clone

```bash
npm ci
npm run build
npx cap sync ios       # restores Pods and web assets; requires CocoaPods and Xcode
```

### Useful scripts

| Script | Purpose |
|---|---|
| `npm run cap:sync:ios` | Builds web app then syncs into native iOS project |
| `npm run cap:open:ios` | Opens `ios/App/App.xcworkspace` in Xcode |

### Node version note

`@capacitor/cli@8.x` requires Node 22. This project's CI uses Node 20, so all Capacitor packages are pinned to `7.6.5`. Upgrade when CI Node is upgraded to 22.

### Simulator smoke pass (2026-05-16)

**Tested on:** iPhone 17 Pro, iOS 26.5 simulator — Xcode 26.5

#### What was tested via CLI (`xcodebuild` + `xcrun simctl`)

**Build and install:**
- ✅ `xcodebuild` — BUILD SUCCEEDED, no errors
- ✅ App installs: `CFBundleIdentifier = com.laurenmann.loreledger`, `CFBundleDisplayName = Lore Ledger`

**Launch scenarios — all PASS:**
- ✅ Cold launch (fresh install): Campaign Hub renders, `⚡️ WebView loaded`
- ✅ Terminate + relaunch: Campaign Hub renders identically in empty state
- ✅ Uninstall + reinstall (erase): Campaign Hub renders correctly on completely fresh data
- ✅ No native crash on any scenario
- ✅ No WKWebView load failure in console output across all three scenarios

**Storage:**
- ✅ Capacitor kvstore writes on first launch (`lastBinaryVersionName: "1.0"`, `lastBinaryVersionCode: "1"`)
- ✅ IndexedDB directory created and ready; empty at first launch as expected (no user data yet)
- ✅ App data container correctly isolated under `Library/WebKit/com.laurenmann.loreledger/`

**Safe-area analysis (source code + screenshot):**
- ✅ `viewport-fit=cover` in `<meta name="viewport">` — full-screen layout enabled
- ✅ `apple-mobile-web-app-status-bar-style: black-translucent` — status bar correctly overlays content
- ✅ Body has `padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px))` at `max-width: 600px` for non-hub pages
- ✅ Hub page (`#page-hub`) uses `padding-bottom: calc(gutter + var(--hub-safe-area-bottom))` where `--hub-safe-area-bottom: env(safe-area-inset-bottom, 0px)` fires at `max-width: 600px` (iPhone 17 Pro is 402pt wide — matches)
- ✅ Body padding zeroed for hub mode to avoid double-counting; hub handles its own safe insets
- ✅ Top safe area: status bar is visible above content, no overlap with Dynamic Island area (confirmed from screenshots)
- ⚠️ Bottom safe area: CSS structure is correct and should prevent home indicator overlap, but visual scroll-to-bottom verification still requires manual Xcode/device testing

**Known native-context behavior (expected, not bugs):**
- Service worker does not register on `capacitor://localhost` — WKWebView does not support SWs on custom protocols. `updates.js` guards on `"serviceWorker" in navigator` and returns no-ops cleanly. App functions fully; offline capability is the native bundle.
- `100dvh` dynamic viewport height used on hub page; resolves correctly in WKWebView.

#### Limitation: interactive UI testing blocked this session

`simctl` has no touch simulation. AppleScript accessibility and screen recording permissions were not available to this shell process. As a result, the following workflows could NOT be automated and **require manual validation in Xcode or on device**:

| Workflow | Status |
|---|---|
| Create a new campaign | **Needs manual test** |
| Open a campaign | **Needs manual test** |
| Navigate to Tracker | **Needs manual test** |
| Navigate to Character | **Needs manual test** |
| Navigate to Combat | **Needs manual test** |
| Navigate to Map | **Needs manual test** |
| Open Data & Settings | **Needs manual test** |
| Campaign persists after close/reopen | **Needs manual test** |
| Campaign persists after force quit | **Needs manual test** |
| Scroll to bottom of hub (bottom safe area) | **Needs manual test** |
| Keyboard / text input (Campaign Name field) | **Needs manual test** |
| Import / export (native file picker availability) | **Needs manual test** |

To enable automated UI testing in future passes: grant Terminal (or the shell running Claude Code) accessibility access under System Settings → Privacy & Security → Accessibility.

#### Xcode build warnings (not blocking)

| Warning | Source | Action |
|---|---|---|
| `WKProcessPool` deprecated (iOS 15+) | Capacitor/Cordova internals | Upstream Capacitor fix; not our code |
| `[CP] Embed Pods Frameworks` no outputs | CocoaPods/Capacitor build phase | Causes unconditional pod embedding — minor build overhead, not correctness issue |

#### App icon / splash (pre-TestFlight required fix)

The placeholder Capacitor icon and splash screen are installed on the simulator home screen. Replace before any TestFlight or App Store submission:
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/` — replace with Lore Ledger icon set
- `ios/App/App/Assets.xcassets/Splash.imageset/` — replace with Lore Ledger splash

### Next steps before TestFlight

1. Run on a physical iPhone (required for TestFlight, required for real storage/input/audio testing)
2. Configure signing team in Xcode (Signing & Capabilities → App target)
3. Replace placeholder app icon (`ios/App/App/Assets.xcassets/AppIcon.appiconset/`) with Lore Ledger icons
4. Replace placeholder splash screen (`ios/App/App/Assets.xcassets/Splash.imageset/`) with branded splash
5. Manually verify navigation, Data & Settings modal, and bottom safe area on device
6. Archive and upload to TestFlight once signing and assets are ready

---

## 11. Changelog update expectations

This repository maintains a committed [`CHANGELOG.md`](../CHANGELOG.md).

Current expectation for each release:

- update the `[Unreleased]` section before tagging a release
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
