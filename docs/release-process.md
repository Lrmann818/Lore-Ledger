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

#### App icon / splash status

- ✅ **App icon is correct** — `AppIcon.appiconset/lore-ledger-icon-1024.png` is 1024×1024; `Contents.json` declares it as the universal iOS icon. Xcode generates the required size variants (e.g. 120×120 @2x) automatically from this source.
- ✅ **Splash screen is branded Lore Ledger artwork** — `Splash.imageset/` contains the 941×1672 branded splash (`public/splash.png`: dark candlelit scholar aesthetic, "Lore Ledger / Keep Your World Within Reach" with d20 and feather quill). Declared at @1x/@2x/@3x in `Contents.json`; `LaunchScreen.storyboard` displays it with `scaleAspectFill`. Confirmed correct — this is not the Capacitor placeholder.

### Xcode native build fix (2026-05-16)

**Problem:** Opening `App.xcworkspace` in Xcode and building produced these errors:
- `error: Sandbox: bash deny(1) file-read-data … Pods-App-frameworks.sh`
- `module 'Cordova' not found` / `could not build module 'Capacitor'`

**Root cause:** Xcode 15+ introduced `ENABLE_USER_SCRIPT_SANDBOXING = YES` as the default project setting. This sandboxes script phases so they can only access explicitly declared input/output files. The CocoaPods `[CP] Embed Pods Frameworks` phase doesn't declare its inputs, so the sandbox blocked access to `Pods-App-frameworks.sh`. The module errors were downstream of this failure.

**Fix:** Set `ENABLE_USER_SCRIPT_SANDBOXING = NO` in both Debug and Release build configurations in `ios/App/App.xcodeproj/project.pbxproj` (lines 278 and 342).

**Result:** `xcodebuild -workspace App.xcworkspace` → **BUILD SUCCEEDED**, no errors. One remaining non-blocking warning:
- `[CP] Embed Pods Frameworks` has no declared outputs — CocoaPods cosmetic warning, causes unconditional pod embedding on every build but doesn't break correctness.

**Note:** `pod install` (run by `cap sync ios`) may not preserve this setting if it regenerates `project.pbxproj`. If the sandbox error reappears after a sync, re-apply the change or add `ENABLE_USER_SCRIPT_SANDBOXING = NO` to the App target's build settings manually in Xcode.

**Signing:** `DEVELOPMENT_TEAM = 7BLL25Q48N` is already set in both Debug and Release build configurations. Automatic signing is enabled. No manual team configuration is needed for local builds; for TestFlight distribution, verify the provisioning profile and certificate are valid in Xcode → Signing & Capabilities.

**Workspace requirement:** Always open and build from `ios/App/App.xcworkspace`, never from `ios/App/App.xcodeproj`. The `.xcworkspace` includes the CocoaPods `Pods.xcodeproj` that provides the Capacitor and Cordova frameworks. The `npm run cap:open:ios` script opens the workspace correctly.

### Physical-device build fix (2026-05-16)

**Problem:** Simulator build succeeded; physical-device (iPhone 14 Pro Max) build failed with 21 `CapacitorCordova` issues. The actual CLI errors were:
```
error: double-quoted include "CAPPluginMethod.h" in framework header, expected angle-bracketed instead
error: use of '@import' in framework header is discouraged, including this header requires -fmodules
error: (fatal) module 'Cordova' not found
error: (fatal) could not build module 'Capacitor'
```

**Root cause:** The Capacitor and CapacitorCordova targets have `ENABLE_MODULE_VERIFIER = YES` in their target build settings. The `modules-verifier` tool runs as a separate binary when building for `iphoneos` (arm64 physical device) and enforces strict framework header hygiene — double-quoted includes and `@import` statements are treated as hard errors, not warnings. `CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER = NO` in the target xcconfigs does not suppress these because the `modules-verifier` tool doesn't read that flag. The simulator build escaped this because the incremental build cache had pre-verified results from a prior successful run.

**Fix — two-part (2026-05-16):**

*Part 1 — Podfile `post_install`:* Broadened the hook to apply to **all** pod targets (not just Capacitor and CapacitorCordova by name — the original name filter had a silent mismatch). Sets both:
- `ENABLE_MODULE_VERIFIER = NO`
- `CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER = NO`

*Part 2 — Post-install patch script:* CocoaPods re-enforces `ENABLE_MODULE_VERIFIER = YES` for `DEFINES_MODULE` targets during its own project write, which runs **after** the `post_install` hook. The Podfile hook alone could not reliably persist the setting. A Ruby patch script (`scripts/patch-pods.rb`) performs a gsub on the pbxproj after pod install is completely finished. It is invoked automatically by `npm run cap:sync:ios` and is available standalone as `npm run ios:fix-pods`.

**Result:** All 6 `ENABLE_MODULE_VERIFIER` entries in `Pods.xcodeproj/project.pbxproj` are confirmed `NO` after `cap sync ios`. `xcodebuild -destination 'generic/platform=iOS'` → **BUILD SUCCEEDED**. Simulator build also still succeeds.

**Standard workflow — use these npm scripts, not raw pod install:**
```bash
npm run cap:sync:ios   # build → cap sync → pod install → patch Pods project
# OR if you need to run pod install separately:
cd ios/App && pod install && cd ../.. && npm run ios:fix-pods
```

If you run `pod install` directly without following it with `npm run ios:fix-pods`, the Pods project will have `ENABLE_MODULE_VERIFIER = YES` and the physical-device build will fail again.

### Build and device status

| Target | Verified |
|---|---|
| iOS Simulator (iPhone 17 Pro, arm64) | ✅ BUILD SUCCEEDED (xcodebuild) |
| Generic iOS / iphoneos SDK (arm64) | ✅ BUILD SUCCEEDED (xcodebuild) |
| Physical iPhone 14 Pro Max — build + install + launch | ✅ CONFIRMED (2026-05-16) |
| Physical iPhone 14 Pro Max — full interactive smoke pass | ✅ ALL PASS (2026-05-16) |

### Physical-device smoke pass (2026-05-16)

**Device:** iPhone 14 Pro Max  
**All 14 checks PASS.**

| Check | Result |
|---|---|
| App launches | ✅ PASS |
| Campaign Hub appears | ✅ PASS |
| Create campaign "Native Device Test" | ✅ PASS |
| Campaign appears in archive/list | ✅ PASS |
| Open the campaign | ✅ PASS |
| Navigate to Tracker | ✅ PASS |
| Navigate to Character | ✅ PASS |
| Navigate to Combat | ✅ PASS |
| Navigate to Map | ✅ PASS |
| Open Data & Settings | ✅ PASS |
| Tap text field — keyboard behavior usable | ✅ PASS |
| Scroll to bottom — nothing hidden behind home indicator | ✅ PASS |
| Close/reopen — "Native Device Test" persists | ✅ PASS |
| Force quit/reopen — "Native Device Test" persists | ✅ PASS |

**Remaining Xcode warnings (non-blocking — no action required):**

| Warning | Source | Status |
|---|---|---|
| `WKProcessPool` deprecated (iOS 15+) | CapacitorCordova dependency code | Non-blocking; upstream Capacitor fix |
| `[CP] Embed Pods Frameworks` has no declared outputs | CocoaPods build phase | Non-blocking; CocoaPods cosmetic warning |

### Next steps before TestFlight

1. ✅ ~~Configure signing team~~ — `DEVELOPMENT_TEAM = 7BLL25Q48N` already set in project
2. ✅ ~~Fix app icon~~ — `lore-ledger-icon-1024.png` (1024×1024) in place, correctly declared
3. ✅ ~~Fix physical-device build errors~~ — Module verifier disabled via Podfile hook + `scripts/patch-pods.rb`
4. ✅ ~~Physical-device build, install, and launch~~ — confirmed on iPhone 14 Pro Max
5. ✅ ~~Manual interactive smoke pass~~ — all 14 checks pass on iPhone 14 Pro Max
6. ✅ ~~Replace placeholder splash screen~~ — branded artwork was already in place (`Splash.imageset/`, 941×1672); confirmed correct (2026-05-16)
7. Prepare App Store metadata: app description, screenshots, privacy policy URL, content rating, keywords
8. ✅ ~~Legal/content audit~~ — SRD attribution not required for this version (see audit below)
9. Verify provisioning profile and distribution certificate in Xcode → Signing & Capabilities (switch to App Store distribution profile)
10. Prepare App Store metadata: app description, screenshots, privacy policy URL, content rating, keywords
11. Archive and upload to TestFlight

### Legal/content audit (2026-05-16)

**Determination: SRD attribution is NOT required for this version.**

**Scope audited:**
- All JS/JSON/HTML source files imported by the production entry point
- `dist/` output (JS bundle, CSS, static assets) after `npm run build`
- Synced iOS web assets under `ios/App/App/public/` after `npm run cap:sync:ios`
- `public/` static assets (images, icons, audio, manifest)
- User-visible surfaces: About dialog, Support section, Data/Settings modal

**Search terms checked:** SRD, System Reference Document, Wizards, Wizards of the Coast, Creative Commons, CC-BY, D&D, Dungeons, Dragonborn, Draconic Ancestry, Breath Weapon, race, class, background, spell, spellcasting, proficiency bonus, ability score, saving throw, monster, equipment, rules, compendium, registry, rulesEngine, rules-engine, ancestry, species, classFeatures, racialTraits, spellList, SRD 5.1, SRD 5.2.1

**Findings:**

| Category | Finding |
|---|---|
| SRD data files (races, spells, classes, equipment) | None — no JSON/data files ship; no lookup tables exist in source or bundle |
| SRD rules text (descriptions, tables, mechanics) | None — no SRD rules content in any source or shipped file |
| Specific SRD species names (Dragonborn, Dwarf, Elf, etc.) | None — zero hits in source or bundle |
| Character sheet fields (`race`, `class`, `background`, `spell`) | Freeform text inputs — blank by default; user types anything; not SRD-derived |
| Dice icons (d4–d100 SVGs) | Standard geometric dice shapes — common game tool, not D&D IP |
| Audio (`the-lore-ledger.mp3`) | Original composition by filename and naming convention; no third-party attribution noted in source |
| Hub background images (`.webp`) | Original artwork by naming convention; no third-party attribution noted in source |
| About dialog | Shows app name, version, schema version, storage keys — no SRD/legal text |
| SRD references in repo | Only in non-shipping dev docs: `CLAUDE.md`, `NEW-FEATURES-ROADMAP.md`, `MULTI-CHARACTER_DESIGN.md` |

**Why the character sheet fields do not trigger SRD attribution:** Fields like `Race`, `Class/Level`, `Background`, `Spells`, `Equipment` are generic freeform text inputs. The shipped state schema stores `race: string`, `background: string` etc. as user-typed values with no default or lookup data. The SRD builder described in `MULTI-CHARACTER_DESIGN.md` (green list of species/classes/spells) is a planned future feature, not present in this build.

**Future reminder:** SRD attribution (e.g., CC BY 4.0 per the Creative Commons SRD license) will be required before shipping the character builder/rules-engine feature if it ships SRD-derived species, class features, spell lists, or equipment tables. Add in-app attribution in the About or Legal screen at that time.

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
